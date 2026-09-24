package main

// The parts with no socket in them: what a JID has to be, what a message says,
// which of our own sends came back, how a long answer is cut, and which hosts a
// profile picture may be downloaded from. Everything here is unit-tested
// (pure_test.go); nothing here talks to WhatsApp.

import (
	"errors"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"unicode/utf8"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
)

// A JID the bridge accepts from the engine. `types.ParseJID` is PERMISSIVE — it
// answers "" or "@s.whatsapp.net" without an error — so a JID with no user or
// no server is refused here, and only the two servers a person lives on are
// accepted: a phone number (`s.whatsapp.net`) or a hidden id (`lid`). Groups,
// broadcasts and newsletters are out in v1, and refusing them here is what
// keeps a model from addressing one.
func parseChat(raw string) (types.JID, error) {
	jid, err := types.ParseJID(strings.TrimSpace(raw))
	if err != nil {
		return types.JID{}, err
	}
	if jid.User == "" || jid.Server == "" {
		return types.JID{}, errors.New("a chat needs a user and a server")
	}
	if !isPersonChat(jid) {
		return types.JID{}, errors.New("only one-to-one chats: " + jid.Server + " is not one")
	}
	return jid.ToNonAD(), nil
}

// Is this a chat with ONE person? The status broadcast, broadcast lists,
// newsletters and groups are all something else, and v1 answers none of them.
func isPersonChat(jid types.JID) bool {
	return jid.Server == types.DefaultUserServer || jid.Server == types.HiddenUserServer
}

// A message id that came from a peer is UNTRUSTED: it travels into the engine,
// into a database key and possibly into a path. WhatsApp's own are hex or
// base-32-ish ASCII; anything else is not forwarded.
var messageIDShape = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)

func validMessageID(id string) bool { return messageIDShape.MatchString(id) }

// What a message says, and what kind it is. Enough for v1: the text of a text,
// and the caption of an image, a video or a document. Every other kind that is
// still a message a person sent arrives with its `kind` and no text, so the
// agent can say «me mandaste un audio» instead of pretending nothing came.
//
// An empty kind is NOT A MESSAGE: a reaction, a poll, a protocol message, a
// sender-key distribution with nothing else in it. Those are skipped.
func textOf(m *waE2E.Message) (kind, text, replyTo string) {
	if m == nil {
		return "", "", ""
	}
	switch {
	case m.GetConversation() != "":
		return "text", m.GetConversation(), ""
	case m.GetExtendedTextMessage() != nil:
		e := m.GetExtendedTextMessage()
		return "text", e.GetText(), e.GetContextInfo().GetStanzaID()
	case m.GetImageMessage() != nil:
		i := m.GetImageMessage()
		return "image", i.GetCaption(), i.GetContextInfo().GetStanzaID()
	case m.GetVideoMessage() != nil:
		v := m.GetVideoMessage()
		return "video", v.GetCaption(), v.GetContextInfo().GetStanzaID()
	case m.GetDocumentMessage() != nil:
		d := m.GetDocumentMessage()
		return "document", d.GetCaption(), d.GetContextInfo().GetStanzaID()
	case m.GetAudioMessage() != nil:
		return "audio", "", m.GetAudioMessage().GetContextInfo().GetStanzaID()
	case m.GetStickerMessage() != nil:
		return "sticker", "", ""
	case m.GetLocationMessage() != nil:
		return "location", "", ""
	case m.GetContactMessage() != nil:
		return "contact", "", ""
	}
	return "", "", ""
}

// The ids of what this bridge sent, so their echo is dropped. BOUNDED: the
// oldest id falls out when a new one comes in, and an echo arrives seconds
// after its send, not a thousand sends later.
type echoSet struct {
	mu    sync.Mutex
	ids   map[string]struct{}
	order []string
	max   int
}

func newEchoSet(max int) *echoSet {
	return &echoSet{ids: map[string]struct{}{}, max: max}
}

func (s *echoSet) add(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.ids[id]; ok {
		return
	}
	s.ids[id] = struct{}{}
	s.order = append(s.order, id)
	if len(s.order) > s.max {
		delete(s.ids, s.order[0])
		s.order = s.order[1:]
	}
}

func (s *echoSet) has(id string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, ok := s.ids[id]
	return ok
}

// WhatsApp's own ceiling on one text message, in characters.
const maxMessage = 4096

// A reply longer than one message, cut where a person would cut it: the last
// paragraph break, else the last line break, else the last space before the
// limit — a hard cut only for a single word longer than the limit. Counted in
// RUNES, because «ñ» is two bytes and one character.
func splitText(text string, max int) []string {
	text = strings.TrimSpace(text)
	var parts []string
	for utf8.RuneCountInString(text) > max {
		runes := []rune(text)
		head := string(runes[:max])
		cut := -1
		for _, sep := range []string{"\n\n", "\n", " "} {
			if i := strings.LastIndex(head, sep); i > 0 {
				cut = i
				break
			}
		}
		if cut <= 0 {
			cut = len(head)
		}
		parts = append(parts, strings.TrimSpace(text[:cut]))
		text = strings.TrimSpace(text[cut:])
	}
	if text != "" {
		parts = append(parts, text)
	}
	return parts
}

// A profile picture is downloaded ONLY from WhatsApp's own CDNs, over https.
// The URL comes from the server, and a bridge that fetched whatever it was
// told would be one misparsed stanza away from fetching anything.
func avatarHostAllowed(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" {
		return false
	}
	host := strings.ToLower(u.Hostname())
	return strings.HasSuffix(host, ".whatsapp.net") || strings.HasSuffix(host, ".fbcdn.net")
}

// `rate-overlimit` is an ANTI-ABUSE SIGNAL, not a transient error: retrying
// through it deepens the restriction, and that is how a number gets banned.
// whatsmeow surfaces it as an IQ error with code 429 or the text itself.
func isRateLimit(err error) bool {
	if err == nil {
		return false
	}
	var iq *whatsmeow.IQError
	if errors.As(err, &iq) && iq.Code == 429 {
		return true
	}
	return strings.Contains(err.Error(), "rate-overlimit") || strings.Contains(err.Error(), "429")
}
