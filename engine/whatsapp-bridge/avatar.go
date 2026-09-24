package main

// A person's profile picture, ON DEMAND ONLY. Nothing here walks a contact
// list: a portal that draws a face asks for that one face, and the answer is
// cached so the next look at the same Bandeja costs nothing.
//
// Bytes are kept 7 days and «has none» 24 hours. A known picture is re-asked
// with its `ExistingID`, and WhatsApp answers «unchanged» with no URL. At most
// four lookups at once, only from WhatsApp's own CDNs, at most 5 MB. A privacy
// setting that hides the picture from us is the same answer as no picture.

import (
	"context"
	"errors"
	"io"
	"net/http"
	"sync"
	"time"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/types"
)

const (
	avatarKeep     = 7 * 24 * time.Hour
	avatarNoneKeep = 24 * time.Hour
	avatarMaxBytes = 5 << 20
)

type avatar struct {
	id      string
	bytes   []byte
	kind    string
	fetched time.Time
}

type avatars struct {
	b     *bridge
	mu    sync.Mutex
	cache map[string]*avatar
	slots chan struct{}
	http  *http.Client
}

func newAvatars(b *bridge) *avatars {
	return &avatars{b: b, cache: map[string]*avatar{}, slots: make(chan struct{}, 4),
		http: &http.Client{Timeout: 15 * time.Second}}
}

func (a *avatars) clear() {
	a.mu.Lock()
	a.cache = map[string]*avatar{}
	a.mu.Unlock()
}

// get answers the picture, or nil for «none». An error is a lookup that could
// not be made (not connected, rate-limited, the CDN failed).
func (a *avatars) get(jid types.JID) (*avatar, error) {
	key := jid.String()
	a.mu.Lock()
	cached := a.cache[key]
	a.mu.Unlock()
	if cached != nil {
		keep := avatarKeep
		if cached.bytes == nil {
			keep = avatarNoneKeep
		}
		if time.Since(cached.fetched) < keep {
			return orNone(cached), nil
		}
	}
	cli := a.b.connected()
	if cli == nil {
		return nil, errNotConnected
	}
	if a.b.isLimited("avatar") {
		return nil, errRateLimited
	}
	a.slots <- struct{}{}
	defer func() { <-a.slots }()

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	params := &whatsmeow.GetProfilePictureParams{}
	if cached != nil && cached.id != "" {
		params.ExistingID = cached.id
	}
	info, err := cli.GetProfilePictureInfo(ctx, jid, params)
	switch {
	case errors.Is(err, whatsmeow.ErrProfilePictureUnauthorized), errors.Is(err, whatsmeow.ErrProfilePictureNotSet):
		return a.store(key, &avatar{fetched: time.Now()}), nil
	case isRateLimit(err):
		a.b.limit("avatar", err)
		return nil, errRateLimited
	case err != nil:
		return nil, err
	case info == nil && cached != nil:
		// Unchanged since the id we already hold.
		cached.fetched = time.Now()
		return a.store(key, cached), nil
	case info == nil:
		return a.store(key, &avatar{fetched: time.Now()}), nil
	}
	if !avatarHostAllowed(info.URL) {
		return nil, errors.New("profile picture URL is not on a WhatsApp CDN")
	}
	res, err := a.http.Get(info.URL)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, errors.New("profile picture download: " + res.Status)
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, avatarMaxBytes+1))
	if err != nil {
		return nil, err
	}
	if len(data) > avatarMaxBytes {
		return nil, errors.New("profile picture larger than 5 MB")
	}
	kind := res.Header.Get("Content-Type")
	if kind == "" {
		kind = "image/jpeg"
	}
	return a.store(key, &avatar{id: info.ID, bytes: data, kind: kind, fetched: time.Now()}), nil
}

func (a *avatars) store(key string, v *avatar) *avatar {
	a.mu.Lock()
	a.cache[key] = v
	a.mu.Unlock()
	return orNone(v)
}

func orNone(v *avatar) *avatar {
	if v.bytes == nil {
		return nil
	}
	return v
}
