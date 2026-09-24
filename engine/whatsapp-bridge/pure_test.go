package main

import (
	"strings"
	"testing"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"google.golang.org/protobuf/proto"
)

func TestParseChat(t *testing.T) {
	ok := map[string]string{
		"59899123456@s.whatsapp.net":    "59899123456@s.whatsapp.net",
		" 59899123456@s.whatsapp.net ":  "59899123456@s.whatsapp.net",
		"59899123456:12@s.whatsapp.net": "59899123456@s.whatsapp.net", // a device is not a chat
		"123456789012345@lid":           "123456789012345@lid",
	}
	for in, want := range ok {
		got, err := parseChat(in)
		if err != nil || got.String() != want {
			t.Errorf("parseChat(%q) = %v, %v; want %s", in, got, err, want)
		}
	}
	// ParseJID is permissive: all of these parse, and none is a person.
	for _, bad := range []string{"", "@s.whatsapp.net", "59899123456", "1203630@g.us",
		"status@broadcast", "123@newsletter", "59899123456@"} {
		if got, err := parseChat(bad); err == nil {
			t.Errorf("parseChat(%q) = %v; want an error", bad, got)
		}
	}
}

func TestValidMessageID(t *testing.T) {
	for _, id := range []string{"3EB0C767D26A8D7E1C2A", "ABCDEF0123456789", "wamid_1-2"} {
		if !validMessageID(id) {
			t.Errorf("%q should be valid", id)
		}
	}
	for _, id := range []string{"", "../../etc", "a b", strings.Repeat("A", 129), "id/1"} {
		if validMessageID(id) {
			t.Errorf("%q should be refused", id)
		}
	}
}

func TestTextOf(t *testing.T) {
	cases := []struct {
		msg                 *waE2E.Message
		kind, text, replyTo string
	}{
		{&waE2E.Message{Conversation: proto.String("hola")}, "text", "hola", ""},
		{&waE2E.Message{ExtendedTextMessage: &waE2E.ExtendedTextMessage{
			Text:        proto.String("sí, ese"),
			ContextInfo: &waE2E.ContextInfo{StanzaID: proto.String("ABC123")},
		}}, "text", "sí, ese", "ABC123"},
		{&waE2E.Message{ImageMessage: &waE2E.ImageMessage{Caption: proto.String("mirá")}}, "image", "mirá", ""},
		{&waE2E.Message{VideoMessage: &waE2E.VideoMessage{Caption: proto.String("video")}}, "video", "video", ""},
		{&waE2E.Message{DocumentMessage: &waE2E.DocumentMessage{Caption: proto.String("factura")}}, "document", "factura", ""},
		{&waE2E.Message{AudioMessage: &waE2E.AudioMessage{}}, "audio", "", ""},
		{&waE2E.Message{StickerMessage: &waE2E.StickerMessage{}}, "sticker", "", ""},
		// Not messages a person wrote: skipped.
		{&waE2E.Message{ReactionMessage: &waE2E.ReactionMessage{Text: proto.String("+1")}}, "", "", ""},
		{&waE2E.Message{SenderKeyDistributionMessage: &waE2E.SenderKeyDistributionMessage{}}, "", "", ""},
		{nil, "", "", ""},
	}
	for i, c := range cases {
		kind, text, reply := textOf(c.msg)
		if kind != c.kind || text != c.text || reply != c.replyTo {
			t.Errorf("case %d: got (%q, %q, %q), want (%q, %q, %q)", i, kind, text, reply, c.kind, c.text, c.replyTo)
		}
	}
}

func TestEchoSetIsBounded(t *testing.T) {
	s := newEchoSet(3)
	for _, id := range []string{"a", "b", "c", "d"} {
		s.add(id)
	}
	if s.has("a") {
		t.Error("the oldest id should have fallen out")
	}
	for _, id := range []string{"b", "c", "d"} {
		if !s.has(id) {
			t.Errorf("%s should still be there", id)
		}
	}
	s.add("b") // a repeat does not push anything out
	if !s.has("c") {
		t.Error("a repeated add evicted an id")
	}
}

func TestSplitText(t *testing.T) {
	if got := splitText("  hola  ", 4096); len(got) != 1 || got[0] != "hola" {
		t.Errorf("short text: %q", got)
	}
	if got := splitText("   ", 4096); len(got) != 0 {
		t.Errorf("blank text should be no parts: %q", got)
	}
	// Paragraphs first.
	text := strings.Repeat("a", 30) + "\n\n" + strings.Repeat("b", 30)
	got := splitText(text, 40)
	if len(got) != 2 || got[0] != strings.Repeat("a", 30) || got[1] != strings.Repeat("b", 30) {
		t.Errorf("paragraph split: %q", got)
	}
	// Words, never mid-word when there is a space.
	got = splitText("uno dos tres cuatro cinco", 10)
	for _, part := range got {
		if len([]rune(part)) > 10 || strings.HasPrefix(part, " ") {
			t.Errorf("bad part %q in %q", part, got)
		}
	}
	if strings.Join(got, " ") != "uno dos tres cuatro cinco" {
		t.Errorf("words lost: %q", got)
	}
	// Runes, not bytes: 5000 «ñ» are two messages, the first exactly 4096.
	got = splitText(strings.Repeat("ñ", 5000), maxMessage)
	if len(got) != 2 || len([]rune(got[0])) != 4096 || len([]rune(got[1])) != 904 {
		t.Errorf("rune split: %d parts", len(got))
	}
}

func TestAvatarHostAllowed(t *testing.T) {
	for _, u := range []string{
		"https://pps.whatsapp.net/v/t61/abc.jpg?oh=1",
		"https://mmg.whatsapp.net/x",
		"https://scontent.xx.fbcdn.net/y",
	} {
		if !avatarHostAllowed(u) {
			t.Errorf("%s should be allowed", u)
		}
	}
	for _, u := range []string{
		"http://pps.whatsapp.net/x",       // not https
		"https://whatsapp.net.evil.com/x", // suffix trick
		"https://evilwhatsapp.net/x",      // not a subdomain
		"https://169.254.169.254/latest",  // metadata
		"file:///etc/passwd",
		"::not a url",
	} {
		if avatarHostAllowed(u) {
			t.Errorf("%s should be refused", u)
		}
	}
}

func TestIsRateLimit(t *testing.T) {
	if !isRateLimit(&whatsmeow.IQError{Code: 429, Text: "rate-overlimit"}) {
		t.Error("an IQ 429 is a rate limit")
	}
	if isRateLimit(&whatsmeow.IQError{Code: 404, Text: "item-not-found"}) || isRateLimit(nil) {
		t.Error("a 404 or nil is not")
	}
}
