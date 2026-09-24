package main

// One WhatsApp number, one whatsmeow client, and everything that happens to it.
//
// THE RULES THIS FILE KEEPS, each one paid for by somebody (Orbit's connector,
// 2026-09):
//
//   - A PAIRING ATTEMPT GETS A FRESH CLIENT. `GetQRChannel` leaves an event
//     handler behind when an attempt ends a certain way, and on a reused client
//     that orphan disconnects the NEXT socket. So every attempt builds a new
//     client over the device store, and a client that is replaced is
//     disconnected and has its handlers removed. Its QR context is cancelled
//     BEFORE the disconnect, which is the order that lets the emitter tear
//     itself down.
//   - EVENT HANDLERS ONLY ENQUEUE. Slow work inside a whatsmeow handler
//     deadlocks it or drops events, and a handler that adds a handler
//     deadlocks for sure. The handler puts the event on `b.events`; `work()`
//     does everything else.
//   - NOTHING IS ENUMERATED. No contact list, no group list, no profile picture
//     that nobody asked for: bulk avatar fetches got a number banned on
//     2026-09-01. The bridge answers inbound messages and looks things up one at
//     a time, when asked.
//   - `rate-overlimit` STOPS THAT CLASS OF CALL FOR 30 MINUTES. It is an
//     anti-abuse signal; retrying through it is how a restriction becomes a ban.
//   - ONE SEND AT A TIME, through one mutex, each with 30 s to finish.
//     Overlapping sends misdelivered in another project.
//   - `StreamReplaced` MEANS ANOTHER PROCESS HAS THE SESSION: stop, never fight.

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/skip2/go-qrcode"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	waLog "go.mau.fi/whatsmeow/util/log"
	"google.golang.org/protobuf/proto"
)

const (
	stateUnpaired     = "unpaired"
	statePairing      = "pairing"
	stateConnecting   = "connecting"
	stateConnected    = "connected"
	stateDisconnected = "disconnected"
	stateLoggedOut    = "logged_out"
	stateBanned       = "banned"

	rateLimitPause = 30 * time.Minute
	sendTimeout    = 30 * time.Second
	partGap        = 800 * time.Millisecond
)

var (
	errNotConnected  = errors.New("whatsapp is not connected")
	errRateLimited   = errors.New("whatsapp asked us to slow down (rate-overlimit): paused for 30 minutes")
	errAlreadyPaired = errors.New("this number is already linked: log out first")
)

type status struct {
	State     string `json:"state"`
	Phone     string `json:"phone"`
	PushName  string `json:"push_name"`
	Since     int64  `json:"since"`
	LastError string `json:"last_error"`
}

type pairing struct {
	State     string `json:"state"` // pending | completed | timeout | error | cancelled
	QRPNG     string `json:"qr_png"`
	ExpiresAt int64  `json:"expires_at"`
	Error     string `json:"error,omitempty"`
	cancel    context.CancelFunc
	client    *whatsmeow.Client
}

// An event and the client it came from: a replaced client's stragglers are
// dropped by `work()` instead of being read as the current number's.
type tagged struct {
	cli *whatsmeow.Client
	evt any
}

type bridge struct {
	mu        sync.Mutex
	container *sqlstore.Container
	client    *whatsmeow.Client
	status    status
	pair      *pairing
	limited   map[string]time.Time

	sendMu  sync.Mutex
	events  chan tagged
	out     *outbox
	echo    *echoSet
	avatars *avatars
}

func newBridge(container *sqlstore.Container, out *outbox) *bridge {
	b := &bridge{
		container: container,
		limited:   map[string]time.Time{},
		events:    make(chan tagged, 4096),
		out:       out,
		echo:      newEchoSet(1000),
	}
	b.avatars = newAvatars(b)
	return b
}

// ── state ──────────────────────────────────────────────────────────────────

func (b *bridge) setState(state, reason string) {
	b.mu.Lock()
	changed := b.status.State != state
	b.status.State = state
	b.status.LastError = reason
	if changed {
		b.status.Since = time.Now().Unix()
	}
	b.mu.Unlock()
	if changed {
		b.out.emit(randomID("conn"), "connection.changed", map[string]any{"state": state, "reason": reason})
	}
}

func (b *bridge) snapshot() status {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.status
}

func (b *bridge) current() *whatsmeow.Client {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.client
}

// The client, when it is the one a message can go out through.
func (b *bridge) connected() *whatsmeow.Client {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.status.State != stateConnected || b.client == nil {
		return nil
	}
	return b.client
}

func (b *bridge) isLimited(class string) bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	return time.Now().Before(b.limited[class])
}

func (b *bridge) limit(class string, err error) {
	b.mu.Lock()
	b.limited[class] = time.Now().Add(rateLimitPause)
	b.mu.Unlock()
	log.Printf("rate-overlimit on %s: pausing that class for 30 minutes (%v)", class, err)
}

// ── the client ─────────────────────────────────────────────────────────────

func (b *bridge) newClient(ctx context.Context) (*whatsmeow.Client, error) {
	device, err := b.container.GetFirstDevice(ctx)
	if err != nil {
		return nil, err
	}
	cli := whatsmeow.NewClient(device, waLog.Stdout("whatsmeow", "WARN", false))
	cli.EnableAutoReconnect = true
	// HISTORY SYNC IS IGNORED IN V1: not downloaded, not forwarded, never
	// waited on. The agent answers what arrives from now on.
	cli.ManualHistorySyncDownload = true
	cli.AddEventHandler(func(evt any) { b.events <- tagged{cli, evt} })
	return cli, nil
}

// whatsmeow's Connect can hang on a handshake that never finishes; Disconnect
// can block on a socket that is already half gone.
func connectWithTimeout(cli *whatsmeow.Client) error {
	done := make(chan error, 1)
	go func() { done <- cli.Connect() }()
	select {
	case err := <-done:
		return err
	case <-time.After(30 * time.Second):
		return errors.New("connect timed out after 30s")
	}
}

func disconnectWithTimeout(cli *whatsmeow.Client) {
	done := make(chan struct{})
	go func() { cli.Disconnect(); close(done) }()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		log.Printf("disconnect timed out after 5s, moving on")
	}
}

// retire drops a client for good: off the socket, and no handler of it left
// to hear the next one.
func retire(cli *whatsmeow.Client) {
	if cli == nil {
		return
	}
	disconnectWithTimeout(cli)
	cli.RemoveEventHandlers()
}

// At boot: a linked number reconnects, an unlinked one waits for a pairing.
// The first connect is retried every 30 s; after it, whatsmeow's own
// auto-reconnect keeps the socket up.
func (b *bridge) start(ctx context.Context) error {
	cli, err := b.newClient(ctx)
	if err != nil {
		return err
	}
	if cli.Store.ID == nil {
		cli.RemoveEventHandlers()
		b.setState(stateUnpaired, "")
		return nil
	}
	b.mu.Lock()
	b.client = cli
	b.mu.Unlock()
	b.setState(stateConnecting, "")
	go func() {
		for b.current() == cli {
			err := connectWithTimeout(cli)
			if err == nil {
				return
			}
			b.setState(stateDisconnected, err.Error())
			select {
			case <-ctx.Done():
				return
			case <-time.After(30 * time.Second):
			}
		}
	}()
	return nil
}

// ── pairing ────────────────────────────────────────────────────────────────

func (b *bridge) startPairing() (string, error) {
	b.mu.Lock()
	if b.pair != nil && b.pair.State == "pending" {
		b.mu.Unlock()
		return "pending", nil
	}
	old := b.client
	b.client = nil
	b.mu.Unlock()
	retire(old)

	cli, err := b.newClient(context.Background())
	if err != nil {
		return "", err
	}
	if cli.Store.ID != nil {
		// Linked, just not connected: pairing again would need a logout first,
		// and reconnecting is what this state actually wants.
		cli.RemoveEventHandlers()
		b.start(context.Background())
		return "", errAlreadyPaired
	}
	ctx, cancel := context.WithCancel(context.Background())
	codes, err := cli.GetQRChannel(ctx)
	if err != nil {
		cancel()
		cli.RemoveEventHandlers()
		return "", err
	}
	p := &pairing{State: "pending", cancel: cancel, client: cli}
	b.mu.Lock()
	b.pair = p
	b.client = cli
	b.mu.Unlock()
	b.setState(statePairing, "")
	b.out.emit(randomID("pair"), "pairing.updated", map[string]any{"state": "pending"})
	go b.runPairing(ctx, p, cli, codes)
	return "pending", nil
}

func (b *bridge) runPairing(ctx context.Context, p *pairing, cli *whatsmeow.Client, codes <-chan whatsmeow.QRChannelItem) {
	if err := connectWithTimeout(cli); err != nil {
		b.endPairing(p, "error", err.Error())
		return
	}
	// QR codes rotate on their own (60 s the first, 20 s each after) and the
	// channel closes itself after the last one; this is the ceiling over it.
	guard := time.NewTimer(3 * time.Minute)
	defer guard.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-guard.C:
			b.endPairing(p, "timeout", "")
			return
		case item, ok := <-codes:
			if !ok {
				return
			}
			switch item.Event {
			case whatsmeow.QRChannelEventCode:
				png, _ := qrcode.Encode(item.Code, qrcode.Medium, 320)
				b.mu.Lock()
				p.QRPNG = "data:image/png;base64," + base64.StdEncoding.EncodeToString(png)
				p.ExpiresAt = time.Now().Add(item.Timeout).Unix()
				b.mu.Unlock()
				b.out.emit(randomID("pair"), "pairing.updated",
					map[string]any{"state": "pending", "expires_at": p.ExpiresAt})
			case whatsmeow.QRChannelSuccess.Event:
				// The socket reconnects on its own after a pairing, and the
				// `Connected` it emits is what says «connected».
				b.endPairing(p, "completed", "")
				return
			case whatsmeow.QRChannelTimeout.Event:
				b.endPairing(p, "timeout", "")
				return
			default:
				reason := item.Event
				if item.Error != nil {
					reason = item.Error.Error()
				}
				b.endPairing(p, "error", reason)
				return
			}
		}
	}
}

// endPairing closes an attempt. One that did not complete takes its client
// with it: cancel the QR context first, then the socket, then the handlers.
func (b *bridge) endPairing(p *pairing, state, reason string) {
	b.mu.Lock()
	if p.State != "pending" {
		b.mu.Unlock()
		return
	}
	p.State, p.QRPNG, p.Error = state, "", reason
	dropped := state != "completed" && b.client == p.client
	if dropped {
		b.client = nil
	}
	b.mu.Unlock()
	b.out.emit(randomID("pair"), "pairing.updated", map[string]any{"state": state, "reason": reason})
	if state == "completed" {
		// Unless the `Connected` that follows a pairing got here first.
		b.mu.Lock()
		still := b.status.State == statePairing
		if still {
			b.status.State, b.status.Since = stateConnecting, time.Now().Unix()
		}
		b.mu.Unlock()
		if still {
			b.out.emit(randomID("conn"), "connection.changed", map[string]any{"state": stateConnecting, "reason": ""})
		}
		return
	}
	p.cancel()
	retire(p.client)
	if dropped {
		b.setState(stateUnpaired, reason)
	}
}

func (b *bridge) pairingNow() *pairing {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.pair == nil {
		return nil
	}
	copy := *b.pair
	return &copy
}

func (b *bridge) cancelPairing() {
	b.mu.Lock()
	p := b.pair
	b.mu.Unlock()
	if p != nil {
		b.endPairing(p, "cancelled", "")
	}
}

// ── logout ─────────────────────────────────────────────────────────────────

// Logout while connected (it tells WhatsApp to unlink this device, then
// disconnects and wipes the store), then the handlers. When the unlink call
// fails the local session is wiped anyway: the owner asked for it to be gone,
// and the phone's «Dispositivos vinculados» still lists it until she removes
// it there — `last_error` says so.
func (b *bridge) logout() {
	b.mu.Lock()
	cli := b.client
	b.client = nil
	b.mu.Unlock()
	reason := ""
	if cli != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if err := cli.Logout(ctx); err != nil {
			reason = "unlink not confirmed by WhatsApp: " + err.Error()
			disconnectWithTimeout(cli)
			if cli.Store.ID != nil {
				cli.Store.Delete(ctx)
			}
		}
		cli.RemoveEventHandlers()
	}
	b.avatars.clear()
	b.setState(stateUnpaired, reason)
}

// ── the worker: everything a handler must not do ───────────────────────────

func (b *bridge) work() {
	for t := range b.events {
		if b.current() != t.cli {
			continue
		}
		switch e := t.evt.(type) {
		case *events.Message:
			b.onMessage(t.cli, e)
		case *events.Connected:
			b.mu.Lock()
			if t.cli.Store.ID != nil {
				b.status.Phone = "+" + t.cli.Store.ID.User
			}
			b.status.PushName = t.cli.Store.PushName
			b.mu.Unlock()
			b.setState(stateConnected, "")
			go b.presencePing(t.cli)
		case *events.Disconnected:
			if b.snapshot().State == stateConnected {
				b.setState(stateDisconnected, "socket closed; reconnecting")
			}
		case *events.StreamReplaced:
			t.cli.EnableAutoReconnect = false
			go retire(t.cli)
			b.mu.Lock()
			b.client = nil
			b.mu.Unlock()
			b.setState(stateDisconnected, "stream_replaced: another process took this session")
		case *events.LoggedOut:
			// whatsmeow already wiped the store for this one.
			go retire(t.cli)
			b.mu.Lock()
			b.client = nil
			b.mu.Unlock()
			b.setState(stateLoggedOut, e.Reason.String())
		case *events.TemporaryBan:
			b.setState(stateBanned, e.String())
		case *events.ConnectFailure:
			b.mu.Lock()
			b.status.LastError = fmt.Sprintf("connect failure %d: %s", int(e.Reason), e.Message)
			b.mu.Unlock()
		}
	}
}

// The chat a person is, keyed by their PHONE: WhatsApp may address the same
// person by a hidden id (`@lid`), and one person has to be one chat.
func phoneChat(cli *whatsmeow.Client, info types.MessageInfo) types.JID {
	chat := info.Chat.ToNonAD()
	if chat.Server != types.HiddenUserServer {
		return chat
	}
	alt := info.SenderAlt
	if info.IsFromMe {
		alt = info.RecipientAlt
	}
	if alt.Server == types.DefaultUserServer {
		return alt.ToNonAD()
	}
	pn, err := cli.Store.LIDs.GetPNForLID(context.Background(), chat)
	if err == nil && !pn.IsEmpty() {
		return pn.ToNonAD()
	}
	return chat
}

func phoneOf(chat types.JID) string {
	if chat.Server == types.DefaultUserServer {
		return "+" + chat.User
	}
	return ""
}

func contactName(cli *whatsmeow.Client, chat types.JID) string {
	info, err := cli.Store.Contacts.GetContact(context.Background(), chat)
	if err != nil || !info.Found {
		return ""
	}
	for _, name := range []string{info.FullName, info.FirstName, info.BusinessName} {
		if name != "" {
			return name
		}
	}
	return ""
}

func (b *bridge) onMessage(cli *whatsmeow.Client, e *events.Message) {
	info := e.Info
	// One-to-one chats only: this skips groups, the status broadcast,
	// broadcast lists and newsletters in one check. View-once is not kept.
	if !isPersonChat(info.Chat) || e.IsViewOnce {
		return
	}
	chat := phoneChat(cli, info)
	if pm := e.Message.GetProtocolMessage(); pm != nil {
		id := pm.GetKey().GetID()
		if !validMessageID(id) {
			return
		}
		switch pm.GetType() {
		case waE2E.ProtocolMessage_REVOKE:
			b.out.emit("revoke:"+chat.User+":"+id, "message.revoked",
				map[string]any{"chat_jid": chat.String(), "message_id": id})
		case waE2E.ProtocolMessage_MESSAGE_EDIT:
			_, text, _ := textOf(pm.GetEditedMessage())
			b.out.emit("edit:"+chat.User+":"+id+":"+randomID(""), "message.edited",
				map[string]any{"chat_jid": chat.String(), "message_id": id, "text": text})
		}
		return
	}
	kind, text, replyTo := textOf(e.Message)
	if kind == "" || !validMessageID(info.ID) {
		return
	}
	// OUR OWN SEND, coming back: dropped. What the OWNER types on her phone is
	// also «from me», and that one is forwarded — it is how the engine knows
	// she took the conversation over.
	if info.IsFromMe && b.echo.has(info.ID) {
		return
	}
	origin, pushName := "contact", info.PushName
	if info.IsFromMe {
		origin, pushName = "owner_phone", ""
	}
	fields := map[string]any{
		"chat_jid":     chat.String(),
		"sender_phone": phoneOf(chat),
		"push_name":    pushName,
		"contact_name": contactName(cli, chat),
		"message_id":   info.ID,
		"timestamp":    info.Timestamp.Unix(),
		"kind":         kind,
		"text":         text,
		"origin":       origin,
	}
	if validMessageID(replyTo) {
		fields["reply_to"] = replyTo
	}
	b.out.emit("msg:"+chat.User+":"+info.ID, "message.received", fields)
}

// ── what goes out ──────────────────────────────────────────────────────────

// PRESENCE AVAILABLE, THEN UNAVAILABLE: a linked device that never shows
// itself goes idle after about 30 days and WhatsApp unlinks it. Sent on every
// `Connected` and once a week (main.go); unavailable right after, so the
// owner's phone keeps getting its notifications.
func (b *bridge) presencePing(cli *whatsmeow.Client) {
	if b.isLimited("presence") {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	for i, state := range []types.Presence{types.PresenceAvailable, types.PresenceUnavailable} {
		if i > 0 {
			time.Sleep(2 * time.Second)
		}
		if err := cli.SendPresence(ctx, state); err != nil {
			if isRateLimit(err) {
				b.limit("presence", err)
			}
			log.Printf("presence %s: %v", state, err)
			return
		}
	}
}

// send puts one answer on the wire, cut into WhatsApp-sized messages with a
// short gap between them. ONE AT A TIME for the whole bridge.
func (b *bridge) send(to types.JID, text, replyTo string) (string, int64, error) {
	cli := b.connected()
	if cli == nil {
		return "", 0, errNotConnected
	}
	if b.isLimited("send") {
		return "", 0, errRateLimited
	}
	b.sendMu.Lock()
	defer b.sendMu.Unlock()
	var lastID string
	var lastTS int64
	for i, part := range splitText(text, maxMessage) {
		if i > 0 {
			time.Sleep(partGap)
		}
		msg := &waE2E.Message{Conversation: proto.String(part)}
		if i == 0 && replyTo != "" {
			// A reply names the quoted message AND who wrote it (Participant):
			// without it WhatsApp draws no quote.
			msg = &waE2E.Message{ExtendedTextMessage: &waE2E.ExtendedTextMessage{
				Text: proto.String(part),
				ContextInfo: &waE2E.ContextInfo{
					StanzaID:    proto.String(replyTo),
					Participant: proto.String(to.String()),
				},
			}}
		}
		id := cli.GenerateMessageID()
		b.echo.add(id)
		ctx, cancel := context.WithTimeout(context.Background(), sendTimeout)
		resp, err := cli.SendMessage(ctx, to, msg, whatsmeow.SendRequestExtra{ID: id})
		cancel()
		if err != nil {
			if isRateLimit(err) {
				b.limit("send", err)
				return lastID, lastTS, errRateLimited
			}
			return lastID, lastTS, err
		}
		lastID, lastTS = resp.ID, resp.Timestamp.Unix()
	}
	return lastID, lastTS, nil
}

func (b *bridge) typing(chat types.JID, composing bool) error {
	cli := b.connected()
	if cli == nil {
		return errNotConnected
	}
	if b.isLimited("presence") {
		return errRateLimited
	}
	state := types.ChatPresencePaused
	if composing {
		state = types.ChatPresenceComposing
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	err := cli.SendChatPresence(ctx, chat, state, types.ChatPresenceMediaText)
	if isRateLimit(err) {
		b.limit("presence", err)
	}
	return err
}

func (b *bridge) markRead(chat types.JID, ids []string) error {
	cli := b.connected()
	if cli == nil {
		return errNotConnected
	}
	if b.isLimited("receipt") {
		return errRateLimited
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	err := cli.MarkRead(ctx, ids, time.Now(), chat, chat)
	if isRateLimit(err) {
		b.limit("receipt", err)
	}
	return err
}
