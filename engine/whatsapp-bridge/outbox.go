package main

// What the bridge tells the engine, and what it keeps until the engine heard it.
//
// PUSH, BECAUSE A REPLY HAS TO BE FAST. Every event is written to
// `bridge_events` FIRST — in whatsmeow's own SQLite file, one database and no
// second one — and then posted to the engine's webhook. A post that fails is
// retried after 1, 2 and 4 seconds; if the engine is still not there the event
// simply stays undelivered and the next wake-up (a new event, or the 30 s
// clock) replays everything undelivered, in order. `GET /events?after=N` reads
// the same table, delivered or not, so an engine that starts can ask for what
// it may have missed. Delivered rows are pruned after a week.

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"time"
)

const outboxSchema = `
CREATE TABLE IF NOT EXISTS bridge_events (
	seq        INTEGER PRIMARY KEY AUTOINCREMENT,
	event_id   TEXT NOT NULL UNIQUE,
	body       TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	delivered  INTEGER NOT NULL DEFAULT 0
)`

type outbox struct {
	db      *sql.DB
	webhook string
	token   string
	apiKey  string
	wake    chan struct{}
	http    *http.Client
}

func newOutbox(db *sql.DB, webhook, token, apiKey string) (*outbox, error) {
	if _, err := db.Exec(outboxSchema); err != nil {
		return nil, err
	}
	return &outbox{
		db: db, webhook: webhook, token: token, apiKey: apiKey,
		wake: make(chan struct{}, 1),
		http: &http.Client{Timeout: 10 * time.Second},
	}, nil
}

// One event, written down and on its way. `fields` is the event's own payload;
// `seq`, `event_id`, `type` and `at` are added here, so every event has the
// same four. An `event_id` already written is the same event twice — whatsmeow
// redelivers a message after a reconnect — and is dropped by the UNIQUE key.
func (o *outbox) emit(eventID, kind string, fields map[string]any) {
	fields["event_id"] = eventID
	fields["type"] = kind
	fields["at"] = time.Now().Unix()
	body, _ := json.Marshal(fields)
	res, err := o.db.Exec(
		`INSERT OR IGNORE INTO bridge_events (event_id, body, created_at) VALUES (?, ?, ?)`,
		eventID, string(body), time.Now().Unix())
	if err != nil {
		log.Printf("outbox: could not write %s: %v", kind, err)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return
	}
	select {
	case o.wake <- struct{}{}:
	default:
	}
}

type storedEvent struct {
	seq  int64
	body string
}

func (o *outbox) since(after int64, onlyPending bool, limit int) ([]storedEvent, error) {
	q := `SELECT seq, body FROM bridge_events WHERE seq > ?`
	if onlyPending {
		q += ` AND delivered = 0`
	}
	rows, err := o.db.Query(q+` ORDER BY seq LIMIT ?`, after, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []storedEvent
	for rows.Next() {
		var e storedEvent
		if err := rows.Scan(&e.seq, &e.body); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// The body with its `seq`, which only exists once the row does.
func withSeq(e storedEvent) []byte {
	var fields map[string]any
	_ = json.Unmarshal([]byte(e.body), &fields)
	fields["seq"] = e.seq
	out, _ := json.Marshal(fields)
	return out
}

func (o *outbox) post(body []byte) bool {
	req, _ := http.NewRequest(http.MethodPost, o.webhook, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Bridge-Token", o.token)
	// The engine serves every plugin route behind the client's key; the bridge
	// lives in the same container and reads it from the same env.
	req.Header.Set("Authorization", "Bearer "+o.apiKey)
	res, err := o.http.Do(req)
	if err != nil {
		return false
	}
	res.Body.Close()
	return res.StatusCode/100 == 2
}

// IN ORDER, AND ONE AT A TIME: an event that cannot be delivered holds back
// the ones behind it, so the engine never reads an edit before its message.
func (o *outbox) deliver() {
	pending, err := o.since(0, true, 100)
	if err != nil {
		log.Printf("outbox: %v", err)
		return
	}
	for _, e := range pending {
		ok := false
		for _, wait := range []time.Duration{0, time.Second, 2 * time.Second, 4 * time.Second} {
			time.Sleep(wait)
			if ok = o.post(withSeq(e)); ok {
				break
			}
		}
		if !ok {
			return
		}
		o.db.Exec(`UPDATE bridge_events SET delivered = 1 WHERE seq = ?`, e.seq)
	}
}

func (o *outbox) run(ctx context.Context) {
	clock := time.NewTicker(30 * time.Second)
	defer clock.Stop()
	for {
		o.deliver()
		o.db.Exec(`DELETE FROM bridge_events WHERE delivered = 1 AND created_at < ?`,
			time.Now().Add(-7*24*time.Hour).Unix())
		select {
		case <-ctx.Done():
			return
		case <-o.wake:
		case <-clock.C:
		}
	}
}
