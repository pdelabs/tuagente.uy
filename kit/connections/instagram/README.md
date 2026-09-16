# Instagram

> **What the engine does with this connection, both halves.** Publishing is
> `kit/plugins/social/` and READING — the comments AND the direct messages — is
> `kit/plugins/instagram/` (capability `instagram-comments`): a flow every
> fifteen minutes, what is new listed, an answer, a hide or a reply behind the
> approval gate, a lead onto the board as a ticket, the last posts' insights
> handed to the creator that writes the next one, and the token refreshed by the
> flow's first step instead of dying silently at sixty days. Two things that are
> NOT variables of this connection: the username (read once from `/me` and
> cached) and the token in force (a table, because `secrets.env` is outside the
> container). DMs answer under STANDARD access — measured, see below — inside
> Meta's 24-hour window. `engine/README.md`, «Publishing» and «The comments», is
> the whole of it. What follows is the Hermes-era reading half, the 23-tool
> MCP, still unaudited and still not connected.
>
> **Publishing no longer comes from here.** On the `core` engine, the social
> plugin publishes a post by itself —
> `kit/plugins/social/core/instagram.py`, behind the approval gate — over the
> **Instagram API with Instagram Login** (`graph.instagram.com`), which needs
> no Facebook Page and no MCP: five calls, `httpx`, and a public bucket for the
> slides because Instagram fetches the pictures itself. `engine/README.md`,
> «Publishing», is the whole of it. What this file describes is the READING
> half — the 23-tool MCP, still unaudited, still not connected — and it is the
> half that is worth the connection anyway: see below. Both halves want the
> same long-lived token, and the same 60 days are still the thing that kills
> it.

**Official Graph API, starting with reading.** Base:
[`mcpware/instagram-mcp`](https://github.com/mcpware/instagram-mcp) — 23
tools, long-lived token, no private API involved.

## Why reading is half of what matters

An agent that publishes without reading writes blind: it repeats topics,
contradicts what's already gone out, breaks the brand's voice.
`get_media_posts` and `get_media_insights` are the whole reason for this
connection — with them, the weekly flow stops making things up in a vacuum
and writes knowing what's already been said and what worked.

Reading is worth it even if you never turn on publishing.

## Standard vs Advanced, without the shortcut

The rule for Standard Access **isn't "your own accounts"** — that shortcut
is confusing and leads to wrong conclusions. The real rule is: you can
request permission from anyone who has **a role in our Meta app** (admin,
developer, or tester).

| | Standard | Advanced |
|---|---|---|
| App review | no, auto-approved | yes, 2 to 4 weeks |
| Who can connect | only someone with a role in the app | anyone |
| What the client does | accepts an invitation in the Meta developer console | clicks a button |

**The permissions are the same and do the same thing.** The only thing that
changes is who you're allowed to ask.

The practical consequence, which is the one that matters: **a client's
account CAN connect without app review** — add them as a tester and they
accept. That works today. What doesn't work is the onboarding: that client
has to go into the Meta developer console, and that's exactly the client who
has no idea what a token is. Good for **piloting with one or two, not for
selling**.

In other words, app review doesn't unlock new capabilities: **it turns
connecting from a developer screen into something anyone can do**. Request
it once this is actually being sold, and since it's a wait, not work, start
it early.

> Correction: on the first pass I said publishing took 2 to 4 weeks. That
> was wrong. On the second I said "only your own accounts", which is also
> imprecise. What this table says is what stands.

**A requirement that can't be skipped:** the account has to be
**professional** (Business or Creator) and **public**, linked to a Facebook
page. Personal accounts have no API — Meta cut off support for them in
October 2024. Converting one is free, takes 5 minutes, is reversible, and
doesn't lose followers or posts.

**Direct messages: this page used to say "Advanced Access always", and that
was wrong for the Instagram-login API.** Probed on our own account on
16/9/2026 with the long-lived token we already had:
`GET https://graph.instagram.com/v21.0/me/conversations?platform=instagram`
answers `{"data": []}` — an empty inbox, not a permission error. So messages
follow the SAME rule as everything else on this page: Standard Access covers an
account whose owner has a role in our Meta app, and Advanced Access is what lets
any client connect with a button. What DOES gate messages is the client's own
Instagram app: the account has to be professional and **«Permitir acceso a
mensajes»** has to be on (Configuración → Mensajes y respuestas a historias), a
consumer setting no developer dashboard can see or turn on. The engine reads and
answers DMs through `kit/plugins/instagram/`, inside Meta's **24-hour window**:
an app may answer a person up to 24 h after their last message, and each message
of theirs starts it again.

## Why we DON'T use an unofficial MCP

There are several good ones based on `instagrapi` (the private API). We
ruled them out:

| | instagrapi | Official Graph API |
|---|---|---|
| Login | username + password | token |
| Detection | **hours** — generates a new fingerprint every run | none, it's the legitimate path |
| Escalation | challenge → block → 30 days → **permanent ban** | — |
| Own account | — | no app review needed |

With WhatsApp we accept that risk **because the number is disposable**.
Here there's no equivalent: if Meta bans a company's account, the handle,
followers, and history are gone for good. The unofficial MCP gives us
nothing the official one doesn't already give for free.

## Permission split

15 read, 8 act (see `tools.json`). With the connection freshly connected —
**read yes, act no** — the agent sees the 15 read tools and **doesn't even
know** `publish_media`, `delete_comment`, and `send_dm` exist.

Two decisions you can't read off the name alone:

- **`delete_comment` acts** — obviously — but it's worth saying why it
  carries weight: it can't be undone, and having an agent decide to delete
  an angry client's comment is worse than the comment itself.
- **`validate_access_token` reads**, and it matters more than it looks: the
  token lasts 60 days and then **fails silently**. Letting the agent check
  it turns a silent failure into a warning.

## Limits

200 calls per hour. 25 posts per day. Images go out as JPEG.

## What's missing

- **Refresh the token before the 60 days are up.** Without that, the
  connection dies on its own every couple of months and the client finds
  out when the flow fails.
- Connect a real account and run the read tools end-to-end. None of this
  has touched Instagram yet.

## TODO before calling this done

**Audit mcpware's code, not just its README.** The 23 classifications in
`tools.json` came from reading the repo's documentation. With Mercado Pago
that wasn't enough: the three bugs we found — the missing
`X-Idempotency-Key` among them, which could refund money twice — only
turned up once we read the implementation. This one needs to be pulled down
and checked function by function, that each one does what its name says,
and that `read`/`act` matches what it actually touches.
