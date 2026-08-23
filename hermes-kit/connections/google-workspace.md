# Connecting Google (Sheets, Drive, Calendar, Docs) without putting the client through pain

**The engine already knows how to do this.** The `google-workspace` skill
ships with Hermes and covers Gmail, Calendar, Drive, Docs, and Sheets. What's
missing isn't code: it's that someone has to go through Google's paperwork,
and that someone **cannot be the client**.

> Note: Hermes also bundles its own skill named `google-workspace` (shipped
> disabled, like the rest of the engine's skills) — same name, unrelated to
> our `google-workspace` connection id: this doc is about our own OAuth
> flow, not that skill.

## The problem, in one line

As shipped, the skill asks the user to create a Google Cloud Console
project, enable six APIs, configure the consent screen, and download a JSON
file. An accountant in Pocitos isn't going to do that, and if they try,
they'll get it wrong. That's exactly where a real client's email task got
stuck.

## The way out: one single OAuth app of our own

The OAuth client the skill asks for is of type **"Desktop app"**. Google
treats that client type's secret as **non-confidential** — it's meant to
live inside apps that get distributed — so **we can create just one, ours,
and use it across every agent**.

With that, all the client has to do is: open a link, pick their account,
accept, and hand us back a code. Two minutes, over the phone if needed.

## Runbook — once, on our side

1. Create a project in Google Cloud Console with tuagente's account.
2. Enable the APIs we're going to offer. **Start with Sheets, Drive, Docs,
   and Calendar**, and leave Gmail out on purpose (see the warning below).
3. Create credentials → OAuth client ID → type **Desktop application**.
4. Download the JSON and save it where we keep the team's secrets.
5. Configure the consent screen with tuagente's name and logo: it's what
   the client sees when we ask for permission, and that's where trust is
   won or lost.
6. **Publish the app.** While it's in test mode only the users you add by
   hand work, and **permissions expire after 7 days** — an agent that stops
   reading spreadsheets every week isn't a product.

## HEADS UP: the `--services` flag below doesn't exist (measured 8/19/2026)

The engine's `setup.py` (v2026.7.30) has the scopes HARDCODED — all eight,
full Gmail and Drive included — and doesn't accept narrowing them. But the
check DOES tolerate a token with fewer scopes ("Don't pass scopes — user may
have authorized only a subset"), so the way out is running the OAuth flow
OUTSIDE with only the scopes the client needs and writing the token straight
into `data/google_token.json` (authorized_user format: client_id,
client_secret, refresh_token, scopes). The helper lived in the 8/19
session's scratchpad (`google_auth_url.py` + `google_exchange.py`); once it
comes up a third time, it earns a real spot in the kit as
`tools/connect-google.py`.

## Runbook — per client

1. Copy the JSON from step 4 to the agent as `data/google_client_secret.json`.
2. The skill's own setup can't narrow this (see the HEADS UP above: its
   scopes are hardcoded). Run `tools/connect-google.py` instead, asking for
   **only the scopes that client needs** — the fewer permissions the screen
   asks for, the more people accept. Exact command in "Narrowed scopes"
   below.
3. Send the client the link; they sign in with their account and accept.
4. Verify with `--check`: it has to say `AUTHENTICATED`.
5. Confirm in the portal, Connections tab, that it shows as **Connected**.

## Warnings not worth learning the hard way

- **Gmail via OAuth is expensive.** Reading or sending mail with a Google
  account is a *restricted* permission: to publish the app with it, Google
  requires a third-party security audit. For email we use IMAP/SMTP with an
  app password instead: minutes, zero paperwork, and it serves the client
  just as well.
- **Sheets/Docs/Calendar are *sensitive* permissions** (brand verification,
  no audit needed — the cheap path). **Watch out: full Drive (`drive`,
  `drive.readonly`) is *restricted*, just like Gmail,** since Project
  Strobe: to verify the app with that permission Google requires a security
  assessment (CASA). While the app is published unverified it still works —
  with the "Google hasn't verified this app" screen and a cap of ~100 users
  — which is enough for pilots: we're the ones who click through "Advanced
  → continue", not the client. **Verified live on 6/8/2026** with
  `drive.readonly`: in Testing mode without test users it returns `403
  access_denied`; published in production, consent goes through and the
  token keeps working.
- **Advanced Protection**: if the client's account has it turned on, their
  admin has to authorize our client ID beforehand. Ask about this BEFORE
  scheduling the call, not during it.
- **One agent, one account.** Never share a token between clients, and
  never use tuagente's own account to operate on a client's data.

## Status

**DONE on 6/8/2026.** The app exists (GCP project `tuagente-504715`, Desktop
client, published in production unverified) and the full flow has been
tested end-to-end with a real account: consent → token → `files.list` with
`sharedWithMe=true` working. The OAuth client's JSON lives in
`tuagente.uy/.secrets/google_client_secret.json` (outside git).

## Narrowed scopes: `tools/connect-google.py`

The engine's `setup.py` (v2026.7.30) has the scopes hardcoded and includes
full Gmail — that screen never gets shown to a client. For onboarding, use
the kit's `tools/connect-google.py`: the same Desktop+PKCE flow, but it asks
for ONLY the scopes the case needs (`--secret <path> --scopes
drive.readonly --output google_token.json --url`, then `--code
<redirect-url>` once the client accepts) and writes the token in
`authorized_user` format, which the engine refreshes on its own. The
engine's `--check` will say `AUTHENTICATED (partial)` — that's expected.
