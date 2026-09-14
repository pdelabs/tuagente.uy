# Instagram

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

**Exception: direct messages.** `instagram_manage_messages` requires
Advanced Access **always**, even on your own account. The three DM tools
(`get_conversations`, `get_conversation_messages`, `send_dm`) are declared
but **won't work** until that review happens.

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
