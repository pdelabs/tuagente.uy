// whatsapp-bridge: one WhatsApp number for one agent, over whatsmeow.
//
// It runs as a second process in the engine's own container (the entrypoint
// starts it only when the `whatsapp` plugin is enabled), listens on loopback,
// and is spoken to by the engine alone. Everything it knows about the number
// lives in one SQLite file on the state volume — whatsmeow's store plus the
// `bridge_events` outbox — so a restart comes back linked.
//
// Deliberately SMALL: one tenant, one client at a time, standard-library HTTP.
// The engine is where the product lives; this is a socket with manners.
//
// Environment:
//
//	WHATSAPP_BRIDGE_TOKEN  required; every request but /health carries it as X-Bridge-Token
//	API_SERVER_KEY         required; the webhook goes through the engine's own auth
//	WHATSAPP_BRIDGE_ADDR   default 127.0.0.1:8645
//	WHATSAPP_DB            default /state/whatsapp/whatsapp.db
//	WHATSAPP_WEBHOOK       default http://127.0.0.1:8643/internal/whatsapp/events
package main

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"syscall"
	"time"

	_ "github.com/mattn/go-sqlite3"
	"go.mau.fi/whatsmeow/proto/waCompanionReg"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/store/sqlstore"
	waLog "go.mau.fi/whatsmeow/util/log"
)

func env(name, fallback string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	return fallback
}

func randomID(prefix string) string {
	raw := make([]byte, 8)
	rand.Read(raw)
	return prefix + ":" + hex.EncodeToString(raw)
}

func main() {
	token := os.Getenv("WHATSAPP_BRIDGE_TOKEN")
	apiKey := os.Getenv("API_SERVER_KEY")
	if token == "" || apiKey == "" {
		log.Fatal("WHATSAPP_BRIDGE_TOKEN and API_SERVER_KEY are required")
	}
	addr := env("WHATSAPP_BRIDGE_ADDR", "127.0.0.1:8645")
	dbPath := env("WHATSAPP_DB", "/state/whatsapp/whatsapp.db")
	webhook := env("WHATSAPP_WEBHOOK", "http://127.0.0.1:8643/internal/whatsapp/events")

	// How the owner's phone lists this device under «Dispositivos vinculados»:
	// DESKTOP is the one platform that shows the OS name as written.
	store.DeviceProps.PlatformType = waCompanionReg.DeviceProps_DESKTOP.Enum()
	store.SetOSInfo("tuagente.uy", [3]uint32{1, 0, 0})

	if err := os.MkdirAll(filepath.Dir(dbPath), 0o700); err != nil {
		log.Fatal(err)
	}
	db, err := sql.Open("sqlite3", "file:"+dbPath+"?_foreign_keys=on&_journal_mode=WAL&_busy_timeout=5000")
	if err != nil {
		log.Fatal(err)
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer stop()
	container := sqlstore.NewWithDB(db, "sqlite3", waLog.Stdout("store", "WARN", false))
	if err := container.Upgrade(ctx); err != nil {
		log.Fatal(err)
	}
	out, err := newOutbox(db, webhook, token, apiKey)
	if err != nil {
		log.Fatal(err)
	}
	b := newBridge(container, out)
	go b.work()
	go out.run(ctx)
	if err := b.start(ctx); err != nil {
		log.Fatal(err)
	}
	go func() {
		week := time.NewTicker(7 * 24 * time.Hour)
		defer week.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-week.C:
				if cli := b.connected(); cli != nil {
					b.presencePing(cli)
				}
			}
		}
	}()

	srv := &http.Server{Addr: addr, Handler: routes(b, token), ReadHeaderTimeout: 10 * time.Second}
	go func() {
		log.Printf("whatsapp-bridge on %s", addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatal(err)
		}
	}()
	<-ctx.Done()
	log.Printf("stopping")
	shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	srv.Shutdown(shutdown)
	b.mu.Lock()
	cli := b.client
	b.mu.Unlock()
	if cli != nil {
		disconnectWithTimeout(cli)
	}
	db.Close()
}

// ── HTTP ───────────────────────────────────────────────────────────────────

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

func fail(w http.ResponseWriter, code int, err error) {
	writeJSON(w, code, map[string]string{"error": err.Error()})
}

// What an error from a WhatsApp call is, as an HTTP status the engine reads.
func failCall(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, errNotConnected):
		fail(w, http.StatusServiceUnavailable, err)
	case errors.Is(err, errRateLimited):
		fail(w, http.StatusTooManyRequests, err)
	default:
		fail(w, http.StatusBadGateway, err)
	}
}

func routes(b *bridge, token string) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]bool{"ok": true})
	})
	mux.HandleFunc("GET /status", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, b.snapshot())
	})
	mux.HandleFunc("POST /pairing", func(w http.ResponseWriter, r *http.Request) {
		state, err := b.startPairing()
		if errors.Is(err, errAlreadyPaired) {
			fail(w, http.StatusConflict, err)
			return
		}
		if err != nil {
			fail(w, http.StatusBadGateway, err)
			return
		}
		writeJSON(w, 200, map[string]string{"state": state})
	})
	mux.HandleFunc("GET /pairing", func(w http.ResponseWriter, r *http.Request) {
		p := b.pairingNow()
		if p == nil {
			fail(w, http.StatusNotFound, errors.New("no pairing attempt yet"))
			return
		}
		writeJSON(w, 200, p)
	})
	mux.HandleFunc("DELETE /pairing", func(w http.ResponseWriter, r *http.Request) {
		b.cancelPairing()
		writeJSON(w, 200, map[string]bool{"ok": true})
	})
	mux.HandleFunc("POST /logout", func(w http.ResponseWriter, r *http.Request) {
		b.logout()
		writeJSON(w, 200, map[string]bool{"ok": true})
	})
	mux.HandleFunc("POST /messages", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			To      string `json:"to"`
			Text    string `json:"text"`
			ReplyTo string `json:"reply_to"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			fail(w, 400, err)
			return
		}
		to, err := parseChat(body.To)
		if err != nil {
			fail(w, 400, err)
			return
		}
		if len(splitText(body.Text, maxMessage)) == 0 {
			fail(w, 400, errors.New("text is empty"))
			return
		}
		if body.ReplyTo != "" && !validMessageID(body.ReplyTo) {
			fail(w, 400, errors.New("reply_to is not a message id"))
			return
		}
		id, ts, err := b.send(to, body.Text, body.ReplyTo)
		if err != nil {
			failCall(w, err)
			return
		}
		writeJSON(w, 200, map[string]any{"message_id": id, "timestamp": ts})
	})
	mux.HandleFunc("POST /chats/{jid}/typing", func(w http.ResponseWriter, r *http.Request) {
		chat, err := parseChat(r.PathValue("jid"))
		if err != nil {
			fail(w, 400, err)
			return
		}
		var body struct {
			State string `json:"state"`
		}
		json.NewDecoder(r.Body).Decode(&body)
		if body.State != "composing" && body.State != "paused" {
			fail(w, 400, errors.New("state is composing or paused"))
			return
		}
		if err := b.typing(chat, body.State == "composing"); err != nil {
			failCall(w, err)
			return
		}
		writeJSON(w, 200, map[string]bool{"ok": true})
	})
	mux.HandleFunc("POST /chats/{jid}/read", func(w http.ResponseWriter, r *http.Request) {
		chat, err := parseChat(r.PathValue("jid"))
		if err != nil {
			fail(w, 400, err)
			return
		}
		var body struct {
			MessageIDs []string `json:"message_ids"`
		}
		json.NewDecoder(r.Body).Decode(&body)
		for _, id := range body.MessageIDs {
			if !validMessageID(id) {
				fail(w, 400, errors.New("not a message id: "+id))
				return
			}
		}
		if len(body.MessageIDs) == 0 {
			fail(w, 400, errors.New("message_ids is empty"))
			return
		}
		if err := b.markRead(chat, body.MessageIDs); err != nil {
			failCall(w, err)
			return
		}
		writeJSON(w, 200, map[string]bool{"ok": true})
	})
	mux.HandleFunc("GET /contacts/{jid}", func(w http.ResponseWriter, r *http.Request) {
		chat, err := parseChat(r.PathValue("jid"))
		if err != nil {
			fail(w, 400, err)
			return
		}
		cli := b.current()
		if cli == nil {
			fail(w, http.StatusServiceUnavailable, errNotConnected)
			return
		}
		// THE LOCAL STORE ONLY: what whatsmeow already learned from this
		// person's own messages. Never a query to WhatsApp.
		info, err := cli.Store.Contacts.GetContact(r.Context(), chat)
		if err != nil {
			fail(w, 500, err)
			return
		}
		if !info.Found {
			fail(w, 404, errors.New("unknown contact"))
			return
		}
		writeJSON(w, 200, map[string]string{
			"jid": chat.String(), "phone": phoneOf(chat), "name": contactName(cli, chat),
			"push_name": info.PushName, "business_name": info.BusinessName,
		})
	})
	mux.HandleFunc("GET /contacts/{jid}/avatar", func(w http.ResponseWriter, r *http.Request) {
		chat, err := parseChat(r.PathValue("jid"))
		if err != nil {
			fail(w, 404, err)
			return
		}
		pic, err := b.avatars.get(chat)
		if err != nil {
			failCall(w, err)
			return
		}
		if pic == nil {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		w.Header().Set("Content-Type", pic.kind)
		w.Header().Set("Cache-Control", "private, max-age=86400")
		w.Write(pic.bytes)
	})
	mux.HandleFunc("GET /events", func(w http.ResponseWriter, r *http.Request) {
		after, _ := strconv.ParseInt(r.URL.Query().Get("after"), 10, 64)
		found, err := b.out.since(after, false, 500)
		if err != nil {
			fail(w, 500, err)
			return
		}
		list := make([]json.RawMessage, 0, len(found))
		for _, e := range found {
			list = append(list, withSeq(e))
		}
		writeJSON(w, 200, map[string]any{"events": list})
	})

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/health" &&
			subtle.ConstantTimeCompare([]byte(r.Header.Get("X-Bridge-Token")), []byte(token)) != 1 {
			fail(w, http.StatusUnauthorized, errors.New("bad bridge token"))
			return
		}
		mux.ServeHTTP(w, r)
	})
}
