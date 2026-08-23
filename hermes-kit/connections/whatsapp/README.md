# WhatsApp

Two paths, and the difference matters more than any technical detail.

## Cloud API (official)

The only supported path for a business number. It requires a WhatsApp
Business account, a Business Manager **verified with Meta**, and a number
that isn't already active on regular WhatsApp.

**How long it takes:** days, because of verification. After that, it's
never touched again.

**Watch the diagnosis:** the WhatsApp Business app (the free one) does NOT
require verification — it's a different thing. A client who already runs a
catalog or ads on Meta probably already has a verified Business Manager,
and for them it's a matter of hours. One who only uses the app starts from
zero. Ask before promising a timeline.

## QR bridge (whatsapp-mcp)

It pairs by scanning a QR code with a regular WhatsApp. Five minutes, and
free.

**The risk, stated plainly:** it uses `whatsmeow`, a reverse-engineered
library for the WhatsApp Web protocol. It violates Meta's terms, which
since 2025 have been aggressively detecting and blocking automation. **The
number can get blocked.**

**Rule:** never on a client's business line. Only on a disposable number,
for a test, and with the risk spelled out in writing beforehand.

## What gets installed

One more service in the compose file (see `compose.yml`), with its Go
bridge and its SQLite database. That SQLite database stores the owner's
message history: it lives inside their volume and never leaves it.

The agent **doesn't talk to this service directly**. It talks to the
decorator, which is the only thing that can reach it and the one that
applies the `tools.json` policy.

## Default policy

Eight tools read and four act (see `tools.json`). It starts with **read
yes, act no** — sending messages gets enabled later, by hand, from the
portal.

`download_media` ended up on the "act" side even though its name suggests
otherwise: it writes to disk and downloads whatever gets sent to it.

## What's left to build

The QR screen in the portal. The bridge exposes it; the portal doesn't show
it yet. Without that, pairing is a task we do ourselves from the console.

---

## What it cost to get this working (8/9/2026)

The repo **doesn't work out of the box**. This is noted because it's the
real cost of this path, and it'll happen again every time Meta changes
something.

1. **`Client outdated (405)`** — the repo pins whatsmeow from March 2025
   and WhatsApp no longer accepts it. It had to be bumped to the August
   2026 version.
2. **Five API changes** in whatsmeow after the update: `Download`,
   `sqlstore.New`, `GetFirstDevice`, `GetGroupInfo`, and
   `Contacts.GetContact` now require a `context.Context`. And Go 1.25 as a
   minimum.
3. **Pairing used to start on its own** when the container came up: it
   requested a QR nobody was looking at, it expired after 3 minutes,
   restarted, and requested another one — burning through sessions for
   good. It's now on-demand.

The patches are in `bridge/main.go.patch`. When updating upstream, they
have to be reapplied.

## Our patches to the bridge

- **On-demand pairing**: `POST /pair/start`, `GET /pair/status`,
  `GET /pair/qr.png`. The REST API always comes up, with or without a
  session.
- **QR as a PNG** in addition to the terminal one, so the portal can
  display it.

The adapter proxies them with auth (`/portal/connections/whatsapp/pair/*`)
and the portal has its own dialog, `WhatsAppDialog.tsx`. The QR gets
fetched with a bearer token and rendered as a blob: an `<img src>` doesn't
send the header, and a pairing code can't be left open.
