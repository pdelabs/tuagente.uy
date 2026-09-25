# Portal routes — the URL contract

What shape every address of the client's portal has, so **the agent can
quote them** when it notifies by email, and so the client can
share them, go back with the browser button and refresh without losing
sight of what they were looking at.

This **changes nothing in the kit or the SOUL**: it's the contract, written
down. If one day the agent gets taught to send links, it comes from here.

## The base

The origin comes from the client's magic link — normally
`https://app.tuagente.uy`. The **paths are the same for every client**; the
only thing that's each one's own is the domain and what's inside.

**The credential NEVER goes in the link.** It travels in the magic link's
hash (`/app#endpoint=…&adapter=…&key=…`), lands in the browser's
localStorage and the portal strips it from the address bar as soon as it's
saved. None of the links below carries a hash: they're all safe to share
**inside the company** (whoever opens one needs their own session; without
one they see the login screen, which tells them the link leads to something
in their portal and that we'll take them there as soon as they enter).

## The tabs

| Tab | URL |
|---|---|
| Home | `/app/home` |
| Chat | `/app/chat` |
| Inbox | `/app/inbox` |
| Flows | `/app/flows` |
| Board | `/app/pipeline` |
| Approvals | `/app/approvals` |
| Posts | `/app/posts` |
| Brand («Marca») | `/app/brand` |
| Activity | `/app/activity` |
| Files | `/app/files` |
| Usage | `/app/usage` |
| Skills | `/app/skills` |

Bare `/app` redirects to `/app/home`.

**Usage came back on 8/19/2026 and can be quoted again.** It was hidden for
three days because the total only saw what passed through litellm, and image
generation hits the provider directly: the screen said US$0.17 the day
OpenRouter had charged US$1.52. Now the number comes from
`GET /portal/usage`, which asks OpenRouter for that agent's own key. The tab
only shows up if the agent has a provider key (the manifest declares `usage`
for that reason, not from `state.db`).

**Marca (`/app/brand`) has no detail param.** It is one page: the business
context's sections, the agent's open questions, the owner's notes and her
business files. Nothing on it opens in place — a file opens in the Files
viewer (`/app/files?file=negocio/archivos/<name>`) and «Contestar en el chat»
is a `?d=` draft (below). The tab shows when the manifest declares
`business`. Its data is `GET /portal/business` on the adapter base.

## The detail

Everything the client can open has its own address.

**WHAT "TESTED" MEANS HERE.** The previous version of this table said every
row was tested, and it wasn't true: `?connection=` used to invent a product
out of any id, a nonexistent `/app/flows/<slug>` answered "I couldn't reach
your agent", and `?folder=interno` opened a folder with eight files inside
saying "This folder is empty". The agent reads this table to build links: an
optimistic row is a broken link in the client's face. So the column says
exactly what was actually checked.

- **opens** = it loaded in the browser against the lab agent and showed the
  right thing.
- **stale id** = also tested with an id that doesn't exist, and it says so in
  plain language instead of breaking.
- **UNVERIFIED** = it may work perfectly; nobody has looked at it. Don't
  quote it in a notice to the client until someone tests it and updates this
  cell.

Nobody has yet tested, for ANY row, the other two halves of the promise
further down: that "back" closes the detail and that refreshing restores the
exact same view. They're implemented (`routes.tsx`) and not verified one by
one.

| What | URL | Example | Tested (8/12, lab) |
|---|---|---|---|
| A conversation | `/app/chat?conversation=<session id>` | `/app/chat?conversation=api_1786585222_d45ee238` | opens |
| A board task | `/app/pipeline?task=<ticket id>` | `/app/pipeline?task=t_b1fb02ad` | opens |
| A conversation in the Inbox | `/app/inbox?thread=<ticket id>` | `/app/inbox?thread=t_b1fb02ad` | opens · stale id (9/16, lab) |
| An approval request | `/app/approvals?request=<ticket id>` | `/app/approvals?request=t_36dbdd23` | opens · stale id |
| A post | `/app/posts?post=<post id>` | `/app/posts?post=2026-09-15-agente-que-contesta` | opens · stale id (9/14, against a mock adapter) |
| A folder | `/app/files?folder=<path>` | `/app/files?folder=interno` | opens |
| A file | `/app/files?file=<path>` | `/app/files?file=workspace/entregables/2026-08-12-instagram-post-trash-bags-20-off.md` | opens (with the `workspace/` prefix) |
| A flow | `/app/flows/<slug>` | `/app/flows/revision-precios-proveedores` | opens · stale id |
| A system skill | `/app/skills?skill=<name>` | `/app/skills?skill=approval` | opens · stale id |
What's left **UNVERIFIED** inside rows that were otherwise tested:

- `?folder=entregables` (`interno` was tested, which is the hard case, not
  this one).
- `?file=` **without** the `workspace/` prefix.
- `?p=` from chat, which isn't a detail but counts as arriving with intent.

Rules for file routes:

- The path is **relative to the workspace**, without the `workspace/` or
  `/opt/data/workspace/` prefix: `entregables/report.md`, not
  `workspace/entregables/report.md`.
- Slashes travel unescaped (they read better); spaces and accents do get
  escaped (`%20`, `%C3%A9`).
- The `workspace/` prefix (or `/opt/data/workspace/`) **is accepted too**:
  it's how the agent writes its own paths, and the portal strips it on its
  own. So `?file=workspace/entregables/report.md` and
  `?file=entregables/report.md` open the same thing.
- `?file=` alone is enough: the portal derives the folder and leaves it open
  behind the viewer. An extra `?folder=` is for landing somewhere else.
- **A link into `interno/` (or a loose script) turns on the technical
  switch by itself.** Files hides the agent's own scaffolding by default;
  without this, `?folder=interno` used to open the folder and say "This
  folder is empty" with eight files inside, because the filter was eating
  exactly what the link came to show.

`?skill=` works for **every** skill and does the same thing for all of them:
it brings the skill into view and highlights it with its name and summary,
expanding the "Common to the system" drawer if that's where it lives. There is
no editor — the engine serves no skill's text — so a link to one is "look at
which one it is", not "edit it". A name that doesn't exist shows a notice and
leaves the full list in view, instead of doing nothing.

**"Brings it into view" has only been true since 8/12 (second pass).**
Before that, this table's promise was false for the single most common
case: with `?skill=approval` the highlighted row sat at 823px, the window
measured 813, and `scrollY` stayed at **0** — the client landed at the very
top and saw nothing highlighted. Three causes, all three fixed in
`bringIntoView()` (`lib/routes.tsx`), which Approvals now uses too:

- **the smooth scroll never finished** (with `behavior: "instant"` the same
  `scrollIntoView` moves the page to 442): the portal carries
  `html { scroll-behavior: smooth }` globally in `app/globals.css`, so any
  `scrollIntoView` without `behavior: "instant"` is asynchronous; and on top
  of that the animation gets swallowed when there's a container with
  `overflow-hidden` above it — the card that groups the system's skills —
  while the page is still settling;
- **the 150ms `setTimeout` was a bet**: the element shows up once the
  adapter answers, and against a client's agent over the internet that
  takes longer than against the lab. Now it waits until it's there, with a
  cap;
- **and that wait runs on `setTimeout`, NOT on `requestAnimationFrame`.**
  This paragraph used to say the opposite and was an invitation to break it:
  in a background tab the browser doesn't paint frames, so a poll on rAF
  doesn't run even once — measured, `document.hidden` at true and `scrollY`
  at 0 forever. A client opening a link in a new tab is the normal case, not
  the rare one. Timers there still run at ~1 per second, which is enough for
  this. The why is also in `bringIntoView()`'s own comment: if someone
  "fixes" it back to rAF, it breaks exactly the common case.

A `/app/flows/<slug>` that doesn't exist does the same thing: a plain-spoken
notice and the list of flows the agent actually has. It used to answer
"I couldn't reach your agent", which on top of being ugly was a lie.

`?post=` **takes the whole screen**, it doesn't open a modal like the other
details. A post is an image at full width plus the text that goes with it,
and both come out squeezed inside a modal — the client opens it precisely to
look at the image before deciding whether it goes up. The consequence for a
link: there's no background list behind it, and «Cerrar» goes back to the
tab. An id that no longer exists falls back to the same rule as everyone
else: a notice up top and the full list below.

The id is the post's folder in `posteos/`, `<YYYY-MM-DD>-<slug>`
(`2026-09-15-agente-que-contesta`). It's the one id in this table that reads
like a sentence, which is why the tab shows the date and not the id.

`?request=` **also brings the card into view** (same helper), since the
afternoon of 8/12. Before that it didn't: measured in the lab, `scrollY` at
0 with the card starting at 1055px against an 862px window — the client
would open the link to the request waiting on their own approval and land
looking at someone else's request, with its own Approve/Reject pair in
front. The other details don't need this because they open in a modal
(`?task=`, `?file=`), which appears centered
with the background locked.

## `?thread=` — and why `?task=` still works for a mail

**A ticket that came in through a channel lives in the Inbox and nowhere
else.** `source` says which: `mail`, `instagram`, `instagram-dm` and `whatsapp` are a
conversation — somebody wrote in and is waiting — and everything else
(`client`, `agent`, none) is work and stays on the Board. The two tabs are the
same call with a filter: `/portal/tickets?source=channels` and `?source=work`.
So a mail is NOT on `/app/pipeline` any more, and the param that opens it is
`thread` on `/app/inbox` — `conversation` was already taken by the chat's
session and one word cannot name two things.

**A `?task=` link to a mail is not broken and never will be.** The id alone
does not say which screen it belongs to — not in a link the agent quoted last
week, not in the chat's `t_ab12` chip — so the Board reads the ticket, sees a
channel source and forwards to `/app/inbox?thread=…` with `replace`: the link
lands where the conversation is and «back» goes where the client came from.
The chat's chip still opens its own modal with the same thread in it, which is
what it has always done.

The Inbox's own link to Aprobaciones is **the one thing on this page that can
be less precise than the rest**: the engine records no link from a ticket to
the request the agent opened about it, so a card that names the ticket's id in
its text (the mail plugin's does) gets `?request=<id>`. Since 2026-09-24 an
Instagram or WhatsApp answer goes out with no card, so a blocked thread with
no card naming it is one the agent LEFT for the owner, and the banner says so
instead of linking anywhere.

**`?thread=` NAMES A TICKET; WHAT OPENS IS ITS PERSON** (2026-09-24). The
Inbox's list is one row per person (`app/app/inbox/people.ts`): an Instagram
person is every comment ticket and DM ticket with the same `handle`, a
WhatsApp person is their chat (`source_ref`, the jid), and a mail stays one
row per ticket — a mail ticket carries no structured sender. There is no
person param: the ticket id already identifies the person, and every link
that exists (Activity, the chat's chip, the Board's forward) carries a ticket
id. Clicking a row writes the person's LATEST ticket and the timeline opens at
the bottom; a link to any OTHER of their tickets opens the same merged
timeline scrolled to that ticket's first line (for a comment, the «Comentó en
«…»» header). A ticket the list does not have (archived, or past the list's
hundred) opens on its own.

**WHAT THE INBOX ADDS THAT HAS NO URL, ON PURPOSE** (2026-09-24, the messages
tab):

- **The channel filter** (Todos · WhatsApp · Instagram · Mail) is a view of
  the list, not something that opens. A `?thread=` link lands on its thread
  whatever the filter was, and the filter starts at «Todos» on every visit.
- **The WhatsApp pairing QR** (`modules.whatsapp`) is a process on the
  engine, not a place: it is read from `GET /portal/whatsapp/pairing`, and a
  reload mid-scan finds it again because the status says `pairing`, not
  because the URL does.
- **«Desvincular»'s confirmation** is an inline second step on the same line,
  not a modal and not the browser's `confirm()`.

## `?p=` — the chat with the request already sent

`/app/chat?p=<the message>` isn't a detail: it's the portal handing the agent a
request the client just decided on. The chat **sends it the moment it opens**
and clears the param off the URL, so a refresh doesn't send it twice — and so
the sentence has to arrive finished. A link that ends in a colon for the client
to complete lands them in a screen where there is nothing left to complete.

Who builds one today:

- **Flows** — the example cards and the two offers on a flow that lost its
  scheduled task (`app/app/lib/flowExamples.tsx`, `app/app/flows/FlowStatus.tsx`).
- **Posts** — two of them, and for the same reason: the tab never asks the
  agent for anything of its own.
  - «Arreglar esta imagen», under each slide of an open post: the client
    writes in one line what's wrong and the link carries «Arreglá la slide 2
    del posteo «2026-09-15-…»: sacale el signo de pregunta». The face reads the
    message, delegates to the creator, and the creator is the one with
    `replace_slide`. The sentence is gated end to end by
    `engine/tests/test_fix.py`; what nobody has clicked in a browser yet is the
    control itself.
  - «Publicar en Instagram», on every post that hasn't gone out: the link
    carries «Publicá en Instagram el posteo «2026-09-15-…»», the face calls
    `publish_instagram`, and the run STOPS at the approval gate — so this `?p=`
    ends in Aprobaciones and not in an answer. A post that did go out shows the
    «Publicado» chip and the permalink instead, and has no button.
    `engine/tests/test_publish_gate.sh` walks the whole sentence, from the
    message to the card to the client's yes.

## `?d=` — the chat with the message written, NOT sent

`/app/chat?d=<text>` opens a new conversation with the text in the box and the
cursor at its end; the client adds what she wants and sends it herself. Cleaned
off the URL on arrival, and it keeps the chat from reopening the last
conversation over it.

Who builds one today:

- **Inbox** — «Verlo con <agente>», next to the composer: the box starts with
  «Sobre la conversación con Anita (@anitamaral) por Instagram (t_ab12,
  t_cd34):». The composer itself answers the person directly
  (`POST /portal/tickets/{id}/reply`); this is for what needs the agent.

## `?request=` doesn't go stale by rejecting it

Worth saying here because it changes what the link means: **rejecting a
request doesn't remove it from Approvals.** The ticket stays blocked, the
card keeps the "You said no" on it and the agent's answer shows up right
there. It only disappears from the tab once it's approved. So a link to a
request still being negotiated **keeps working**, and the stale-link notice
only shows up once it's truly resolved or the agent withdrew it. The why
(a ticket has exactly one unblock before the engine declares it a loop and
sends it to `triage`) is in `docs/PENDING.md`.

**With one exception, and the client picks it**: rejecting has a checkbox —
"Close the request: this is off the table, don't propose it again" — that
sends `{"final": true}` and closes the ticket (`done`) in the same write as
the comment. That one DOES take the request out of the tab, and from then
on the link shows the stale-link notice, which is correct. Reopening it is
a new request, over chat.

## What the client sees

Ids are never shown: the screen always puts up the **human name** (the
ticket's title, the deliverable's frontmatter
`title`, the conversation's name). An id in the URL is the price of being
able to link to it; it has no reason to reach the client's eyes.

Every detail has a discreet **copy link** button (a little chain icon, next
to close). It copies the address of the thing, without the hash.

## When a link is worth it and when it isn't

- **Inside the portal's own chat it isn't needed.** The agent's markdown
  already turns `t_80ff7609` and file paths into chips that open
  the thing right there. A raw link there is worse.
- **Outside the portal, yes** — an email, a comment read from a
  phone: there the link is the only way for "I left you the report" to be
  something you can open with one tap.
- **One link per notice**, the one for the actual thing. Sending the tab
  (`/app/files`) instead of the deliverable makes them go hunting.

## Why query params and not path segments

The portal is static: at build time every tab comes out as `○ (Static)` and
the only `ƒ (Dynamic, server-rendered on demand)` one is
`/app/flows/[slug]`. A path segment for every detail would multiply that
exception and tie the portal to needing a Node server. With query params,
the detail lives on a page that's already prerendered: the same HTML serves
`/app/pipeline` and `/app/pipeline?task=t_ab12`, and a shared link works the
same served by Vercel or by a plain directory of files.

Hash-routing (`/app#/board/t_ab12`) isn't used either, for one sufficient
reason: **the hash is where the credential lands.** Fighting over that space
with the magic link was asking for trouble.

The mechanics live in `app/app/lib/routes.tsx`: native `history.pushState` /
`replaceState` (Next 14.2 patches them and keeps its own router in sync) and
a `useSyncExternalStore` that listens for `popstate`. Every screen **reads**
from the URL — there's no local copy of "what's open" — and that's what
makes refreshing restore the exact same view.

## A stale link never falls into the void

Links go stale on their own: an approval gets approved, a task gets
archived, a file gets renamed. When the URL's id no longer exists, **every**
screen does the same thing: a plain-spoken notice up top and the full list
below, which is where the client can keep going. Never an endless spinner,
never an error number, never a screen that says nothing.

## Behavior details

- Opening something **pushes** a history entry: "back" closes it, "forward"
  reopens it.
- Closing with the X undoes that entry. If the client **landed** on the
  shared link (there's nothing to undo), the X rewrites the URL to the tab
  instead of kicking them out of the portal.
- Clicking the tab you're already on in the menu closes whatever detail is
  open.
- A link to a specific thing **skips that tab's welcome screen**: whoever
  arrives via a link came to see one thing, not to be introduced to the
  module.

## Retired: `/app/tasks` and `?scheduled=`

**Removed 23/9/2026.** The operator console over Hermes' cron store: its
detail came from `/portal/crons/{id}`, which the engine does not serve (its
manifest says `crons: false`). It was never in the nav; Flows is where a
scheduled job is seen and touched.

## Retired: `/app/artifacts` and `?artifact=`

**Removed 23/9/2026.** Entregas listed the `artifact` plugin's HTML
visualizations through `/portal/artifacts*`, a Hermes-adapter surface: the
plugin has no `core/` half, the engine serves nothing under that path and its
manifest says `artifacts: false`. What the agent delivers on the engine is a
file under `entregables/` (the deliverable plugin), and that lives in Files
(`?file=`) and on its flow's card. An `art_…` id in the chat is plain text now.

## Retired: `/app/connections` and `?connection=`

**Removed 23/9/2026.** Conexiones was a Hermes-adapter module: the catalog,
Google's OAuth dialog, WhatsApp pairing and the per-connection permissions
were all adapter endpoints, and the engine serves none of them (its manifest
says `connections: false`). A flow that is missing a connection says which one
on its own card, and that setting it up is ours; there is no screen to send the
client to. The agent's `connection:<id>` and `permissions:<id>` marks no longer
turn into cards either. A `/app/connections` link now lands on a route the
portal does not have.

## Retired: `/app/team`, `?role=` and `?hire=`

**Removed 30/8/2026 with the team pivot** (`docs/team-pivot-removal.md`,
wave 1). The tab and both parameters existed only on an agent whose adapter
served a roster, and no agent serves one any more.

They are named here and not simply erased because **a link outlives the
screen it pointed at**: anything quoted to a client, pasted into a ticket, or
sitting in someone's history now lands on a route the portal does not have.
Neither was ever a link to hand out — both shipped UNVERIFIED and the
`?hire=` row said in as many words that it was not one — so what is expected
is nothing. If a `/app/team` shows up in a support conversation, this is what
happened to it.
