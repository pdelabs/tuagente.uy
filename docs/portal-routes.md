# Portal routes — the URL contract

What shape every address of the client's portal has, so **the agent can
quote them** when it notifies over Telegram or email, and so the client can
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
| Team | `/app/team` |
| Flows | `/app/flows` |
| Board | `/app/pipeline` |
| Approvals | `/app/approvals` |
| Artifacts | `/app/artifacts` |
| Connections | `/app/connections` |
| Activity | `/app/activity` |
| Files | `/app/files` |
| Usage | `/app/usage` |
| Skills | `/app/skills` |
| Scheduled tasks — URL-only, not in the nav on purpose: Flows replaced it as the machine-facing view, the route stays alive for us (`app/app/layout.tsx`) | `/app/tasks` |

Bare `/app` redirects to `/app/home`.

**Usage came back on 8/19/2026 and can be quoted again.** It was hidden for
three days because the total only saw what passed through litellm, and image
generation hits the provider directly: the screen said US$0.17 the day
OpenRouter had charged US$1.52. Now the number comes from
`GET /portal/usage`, which asks OpenRouter for that agent's own key. The tab
only shows up if the agent has a provider key (the manifest declares `usage`
for that reason, not from `state.db`).

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
| An approval request | `/app/approvals?request=<ticket id>` | `/app/approvals?request=t_36dbdd23` | opens · stale id |
| An artifact | `/app/artifacts?artifact=<id>` | `/app/artifacts?artifact=art_1786584384_sales-by-branch` | opens |
| A folder | `/app/files?folder=<path>` | `/app/files?folder=interno` | opens |
| A file | `/app/files?file=<path>` | `/app/files?file=workspace/entregables/2026-08-12-instagram-post-trash-bags-20-off.md` | opens (with the `workspace/` prefix) |
| A flow | `/app/flows/<slug>` | `/app/flows/revision-precios-proveedores` | opens · stale id |
| A connection | `/app/connections?connection=<catalog id>` | `/app/connections?connection=telegram` | opens · stale id |
| A system skill | `/app/skills?skill=<name>` | `/app/skills?skill=approval` | opens · stale id |
| A scheduled task | `/app/tasks?scheduled=<cron id>` | `/app/tasks?scheduled=bb8485784d90` | opens |
| A teammate | `/app/team?role=<role id>` | `/app/team?role=sales` | UNVERIFIED |
| Hiring a role (its naming) | `/app/team?hire=<role id>` | `/app/team?hire=sales` | UNVERIFIED |

Both Team ones **only exist on an agent with a team** (`modules.roles`): on a
single-role agent the tab isn't in the nav and the page is never reached.

`?hire=` is **another parameter, not a mode of `?role=`**: they're two
different things about the same id — looking at someone's profile, or naming
and giving a face to someone who isn't there yet — and folding them into one
parameter would force a second value alongside it to tell the two apart.
It opens the naming screen (the same one hiring uses) and leaves the
request on record; **it doesn't install anything**: that's our own work by
hand, and the card stays "on its way" until then.

**A `?hire=` that can't be requested shows the roster, not a form**: if the
id doesn't exist, if that role is already on the team, if it was already
requested, or if the catalog doesn't call it `ready` yet (requesting it
answers 404), the tab behaves like it would with any stale link. That's why
it's not a link to quote to the client: the one that serves "add someone" is
the tab itself, `/app/team`.

What's left **UNVERIFIED** inside rows that were otherwise tested:

- `?folder=entregables` (`interno` was tested, which is the hard case, not
  this one).
- `?file=` **without** the `workspace/` prefix.
- `?skill=<one of ours>` opening the editor (it was tested that the Edit
  button only shows up where the adapter can actually edit it; the direct
  link into the editor wasn't).
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

`?skill=` works for **every** skill, but they don't all do the same thing,
and that matters when writing the message that goes with the link:

- **One of ours** (the ones we built for that client) opens its text,
  editable.
- **A system one** (the kit's and the engine's) expands the "Common to the
  system" drawer, brings it into view and highlights it with its name and
  summary. It doesn't open an editor because there's nothing to edit: the
  adapter only serves the content of the editable ones. A link to one of
  these is "look at which one it is", not "edit it".
- A name that doesn't exist shows a notice and leaves the full list in view,
  instead of doing nothing.

**"Brings it into view" has only been true since 8/12 (second pass).**
Before that, this table's promise was false for the single most common
case: with `?skill=approval` the highlighted row sat at 823px, the window
measured 813, and `scrollY` stayed at **0** — the client landed at the very
top and saw nothing highlighted. Three causes, all three fixed in
`bringIntoView()` (`lib/routes.tsx`), which Connections and Approvals now
use too:

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

`?connection=` says **three different things** depending on what it finds,
and none of them overclaims. It used to always say the same thing — "You're
here to connect X. It's the one missing for one of your flows" — and with
that it invented two things: the product (with `?connection=doesnt-exist-xyz`
it announced "You're here to connect doesnt exist xyz") and the need (with
any real id, even when the one actually missing was a different one).

- **It exists and isn't connected** → "You're here to connect X", and only
  if the catalog marks it `required` does it add that one of the client's
  flows needs it.
- **It exists and is already connected** → it says so, in green, and marks
  it below.
- **It's not in the catalog** → a stale-link notice with the id in quotes
  and the full list below. The raw id is NEVER humanized to pass it off as
  a product name.

A `/app/flows/<slug>` that doesn't exist does the same thing: a plain-spoken
notice and the list of flows the agent actually has. It used to answer
"I couldn't reach your agent", which on top of being ugly was a lie.

`?request=` **also brings the card into view** (same helper), since the
afternoon of 8/12. Before that it didn't: measured in the lab, `scrollY` at
0 with the card starting at 1055px against an 862px window — the client
would open the link to the request waiting on their own approval and land
looking at someone else's request, with its own Approve/Reject pair in
front. The other details don't need this because they open in a modal
(`?task=`, `?scheduled=`, `?artifact=`, `?file=`), which appears centered
with the background locked.

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
ticket's title, the artifact's title, the deliverable's frontmatter
`title`, the conversation's name). An id in the URL is the price of being
able to link to it; it has no reason to reach the client's eyes.

Every detail has a discreet **copy link** button (a little chain icon, next
to close). It copies the address of the thing, without the hash.

## When a link is worth it and when it isn't

- **Inside the portal's own chat it isn't needed.** The agent's markdown
  already turns `t_80ff7609`, `art_…` and file paths into chips that open
  the thing right there. A raw link there is worse.
- **Outside the portal, yes** — Telegram, email, a comment read from a
  phone: there the link is the only way for "I left you the report" to be
  something you can open with one tap.
- **One link per notice**, the one for the actual thing. Sending the tab
  (`/app/artifacts`) instead of the deliverable makes them go hunting.

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
