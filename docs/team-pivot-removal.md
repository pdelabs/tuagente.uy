# Removing the team pivot

**Luis' decision, 30/8/2026: back to ONE baptized agent per client.** The
client names it and gives it a face at onboarding, they talk to it, it owns
everything. The plugin framework stays — what goes is per-role exposure.

This file is the running record of the removal. It is not the plan: it says
what has actually been done, wave by wave, and what each wave learned. The
pivot's own record is **archived**, not deleted: `kit/notes/archive/`
(`team-pivot-status.md`, `spike-profiles.md`) is the account of what was built
and why. What survives roles was lifted out of it first, into
`kit/notes/cost-and-engine-findings.md`.

Reading order for whoever picks this up: this file, then `kit/fleet.md`
(«The team pivot, undone») for the live agents, then `docs/portal-routes.md`
for the URL contract.

## The waves

| | What | Status |
|---|---|---|
| 0 | The two live agents: roster, hired profiles, rooms | **done** 30/8 |
| 1 | The portal (`app/app/`) | **done** 30/8 |
| 2 | The landing and the blog | **done** 30/8 |
| 3 | The adapter | **done** 30/8 |
| 4 | The kit: `roles/`, install, plugins, flows | **done** 30/8 |
| 5 | Checks, tools and the live agents' second pass | **done** 30/8 |
| 6 | The docs and the notes | **done** 30/8 |

The outcome of each, with hashes, is at the bottom of this file.

## Wave 0 — the live agents

Reversible, operational, and deliberately first: the point was to see what the
portal does the moment the roster leaves, **before deleting a line of it**.

Two agents were touched. **East (`49.13.225.187`) was not, and must not be** —
it is the only agent in the fleet that never saw a roster, which makes it the
pre-pivot reference shape and the thing the portal is being brought back to.

The full measurement table, the backups, and the runbook are in
`kit/fleet.md`. The short version: three deletions on each agent
(`policy/roles/catalog.json`, `data/profiles/<role>/`, `policy/rooms/`) and a
restart. The client's baptism is not in any of them.

### What the portal did with the roster gone, at HEAD

This is the observation the wave existed for. The pivot code was untouched —
built at HEAD, served on :8090, pointed at the demo agent a minute after it
lost its two roles:

- **Onboarding opened at the naming step.** «Tu empresa tiene un empleado
  nuevo» / «Va a trabajar para vos todos los días, y todo lo que haga queda a
  la vista en este portal. Empecemos por lo más importante: ponerle nombre.»,
  the animated face with its dice, «¡Hola! Soy ____», and a «Continuar»
  disabled until something is typed.
- **No «Equipo» in the nav**: Inicio · Chat · Flujos · Actividad · Tablero ·
  Entregas · Conexiones · Más.
- **Home greeted solo already**: «Buen día» / «Agente Local, tu agente ·
  última actividad hace 6 días».
- **The chat sidebar listed engine sessions only.** The five rooms were gone
  and nothing replaced them with an error.
- Wrong on its own, and wave 1's job: the composer said «Escribile a tu
  agente…» rather than «Escribile a \<nombre\>…», and the chat's empty state
  was the team one.

**So the portal degrades to the solo shape by itself.** That is the finding
that shaped wave 1: removing the pivot from the portal is deleting dead
branches, not rebuilding a path that was lost. Every solo screen was still
there under a condition.

## Wave 1 — the portal

`app/app/` only. The landing, the blog and the root metadata are wave 2 and
pricing-gated; the adapter and the kit are waves 3–6, so the portal now talks
to an adapter that still serves `/portal/roles` and `/portal/rooms`. It simply
never asks — measured in the browser: the whole session touches
`/portal/manifest`, `/portal/activity`, `/portal/approvals`,
`/portal/chat/stream`, `/api/sessions` and `/api/jobs`, and nothing else.

Six commits, in an order where every one of them compiles: the chat unfork,
layout/home/pipeline, the onboarding unfork, the last references to the team
tab, `agent.ts`, and a comment pass. `agent.ts` went last on purpose — it is
the portal's only network entry point, so nothing comes out of it until
nothing calls it.

### Decisions carried out

- **`@` goes back to files.** The pivot gave `@` to roles and pushed files
  onto `/`. `#` is tickets, `@` is files, `/` is nothing — which is what the
  hint under the composer said all along («escribí # para nombrar una tarea o
  @ para un archivo»). That line was never updated for the pivot, so this
  makes the code agree with the screen rather than the other way round.
- **`/portal/chat/stream` keeps its path**, minus `role` and `room`. With no
  role, the adapter proxies `/v1/chat/completions` on the agent itself with
  the client's own key and no `/p/<role>` prefix, so a turn lands as an engine
  session exactly as before — verified: `api-32aae8f771b8a3d2`, source
  `api_server`. And `route_message()` returns None immediately with no roster,
  so a solo turn does not pay for a routing call.
- **`suggest-capabilities` stays in the adapter.** Its only caller was hiring.
  It loses its caller, not its reason.
- **Kept because they only look like pivot copy**: «Hablame como a cualquiera
  del equipo» (the client's own staff) and «avisale al equipo de tuagente»
  (us). Both predate the pivot.

### The three-zone capability rendering, parked

`team/knowHow.tsx` grouped capabilities into three zones — «Incluido»
(`level: "base"`, no button, which paid off a real debt: the portal used to
offer a button for something the client already had), what is active, and
«Se puede sumar» collapsed behind one row and grouped by `byGroup()`. Plus
one rule: `active === null` means DON'T KNOW and is offered exactly like
`false`.

It is NOT ported. No solo screen asks for it today, and porting a layout with
no caller is how the pivot got big in the first place. It is written down in
full in the delete commit and here. Whoever redesigns Conexiones or the
capability card starts from this paragraph.

### What wave 1 restored

The baptism, and it is the whole point. `layout.tsx` carried
`&& !manifest.modules.roles` on the onboarding gate, so on an agent with a
roster the naming step never rendered, `POST /portal/identity` never carried a
`name`, and no runbook step wrote one either. That is exactly the
`SOUL: identity` failure fleet.md records against our own agent on 24–25/8 —
a failure nobody could close from the portal.

Walked end to end against the demo agent after the change: naming → business →
overview → channel, the SOUL gained «Tu cliente te bautizo **Tuca** desde el
portal», the manifest went `named: false → true`, `agent-check` went from the
team sentence to «portal:identity block — it is «Tuca»», and one chat turn
asked the agent its name and got «Tuca» back. US$0.0056376 for that turn
(22,359 in / 40 out), the only spend of the verification.

Also restored: home's status line («<nombre>, tu agente») **paints on the
first render again** — the pivot made it wait for the roster, so the screen
the client opens every day had a hole where its first sentence goes until a
second request landed.

### Found on the way out, and since FIXED (`3163a62`): onboarding cut short

**A client can lose the last two onboarding steps to a background poll.** The
layout refetches the manifest every 60 s. The channel step writes
`contact.channel`, which makes `onboardingAlreadyAnswered()` true, and the
next poll then unmounts `<Onboarding>` mid-flow — the client is dropped into
the portal without ever seeing the automations carousel or the chat step, and
`onDone` never runs, so the welcome screens are not marked seen either.

Reproduced by contrast on the demo agent, same build, same agent: a slow run
through the flow landed on `/app/home` straight after the channel question; a
fast one reached «¿Qué te saco de encima?» normally.

**It is not this wave's doing** — the gate condition is unchanged, wave 1 only
removed the `modules.roles` conjunct from it, which makes onboarding MORE
likely to render, not less. It is a pre-existing solo bug that the pivot hid,
because on a team agent that gate never fired at all. It was left alone here
deliberately, because fixing it means deciding whether onboarding reads the
manifest once at mount or holds its own completion flag — a decision about
onboarding, not about the pivot. **That decision was taken the same day**
(`3163a62`): the answer is read once, with the session's first manifest, and
onboarding calls `onDone` when ITS flow ends. Both halves reproduced in jsdom
against the real layout.

## What wave 0 left broken, and for whom — BOTH CLOSED

**The roster-less agents are under-skilled, and the kit is what fixes it.**
`agent-check`'s `expected_skills()` hands a team agent the shared split only,
because the craft skills travel inside each hired role's profile. With the
roster gone it asks for the seven a solo agent should have — `artifact`,
`brand-kit`, `drive-inbox`, `invoices-to-data`, `post-image`, `quotes`,
`social-content` — and neither live agent has them outside the profiles that
were just deleted. That is a real gap, not a noisy check: today's solo agent
can do less than a pre-pivot solo agent could.

It is deliberately NOT fixed here. It closes with an `install.sh` pass once
the kit drops the team/solo split (waves 3–6), and doing it earlier would mean
installing against a definition that is about to change.

**CLOSED in `15d833a`, and not by putting the fourteen back** — see "what the
pivot broke", item 4, below. The definition did change: what an agent should
have is what its client bought.

**And one check lies instead of failing.** `SOUL: identity` still reports OK
with «with no name of its own (a team client never names theirs), works for
"\<empresa\>"». That branch never consulted the roster, so on both live agents
an agent with **no baptism at all** passes on a sentence about a shape that no
longer exists. It hides exactly what the product now requires.

**CLOSED in `76b8307`**, which was indeed wave 5's first move: a block with a
company and no name fails now, because onboarding asks for the name FIRST — so
that block means an onboarding that stopped halfway.

---

# The outcome, wave by wave

Written 30/8 at the close of wave 6, from `git log 199b6b4..`. Waves 2 and 5
were landing in the same hours as this was written, so their commit lists are
what was on `main` at the time and may be short by one or two.

## The inventory, measured rather than estimated

Against `199b6b4`, the last commit before wave 0:

| | |
|---|---|
| files deleted outright | **50** |
| of them `kit/roles/` | 32 |
| `kit/tools/` | 8 — `hire-role.sh`, `profile_config.py` + its test, five role goldens |
| `app/app/team/` | 4 |
| `kit/adapter/` | 3 (`rooms.py` and two test suites) |
| `app/app/lib/` | 3 (`roles.tsx`, `hiring.tsx`, `intros/team.tsx`) |
| files archived, not deleted | 2 (`notes/archive/`) |
| code (`.py .tsx .ts .sh .json .mjs .svg`) | 88 files, **+2,761 / −8,721** |
| prose (`.md`) | 59 files, +2,752 / −2,398 |

**Roughly six thousand lines of code net removed, and no product surface lost.**
That ratio is the finding wave 0 predicted and the whole removal confirmed:
every solo screen and every solo path was still there under a condition, so
this was deleting branches rather than rebuilding a road.

## What the pivot broke, and what put it back

Four things, and only the first was a bug anyone reported. The rest were found
by removing the code around them.

1. **THE BAPTISM WAS SUPPRESSED, and that is the whole reason the wave was
   worth doing.** `layout.tsx` carried `&& !manifest.modules.roles` on the
   onboarding gate, so on an agent with a roster the naming step never
   rendered, `POST /portal/identity` never carried a `name`, and no runbook
   step wrote one either — while the business step, which the client DID
   answer, wrote an EMPTY name into the SOUL. That is exactly the `SOUL:
   identity` failure `fleet.md` records against our own agent on 24-25/8, a
   failure nobody could close from the portal. **Restored** in `428c4fc` and
   `ef6c3fb`; **hardened** in `9112761` (a nameless identity write is a 400,
   adapter 0.43.0) and `76b8307` (`agent-check` fails on a block with no name
   instead of passing it with a sentence about a team's shared agent).
   Verified end to end against the demo agent: naming → business → overview →
   channel, the SOUL gained the baptism, the manifest went `named: false →
   true`, and one chat turn asked the agent its name and got it back —
   US$0.0056376, the only spend of the verification.
2. **HOME'S FIRST PAINT.** The status line («<nombre>, tu agente») waited for
   the roster, so the screen a client opens every day had a hole where its
   first sentence goes until a second request landed. **Restored** in
   `428c4fc`: it paints on the first render again.
3. **`@` STOPPED MEANING FILES.** The pivot gave `@` to roles and pushed files
   onto `/`, and never updated the hint under the composer — which had been
   saying «escribí # para nombrar una tarea o @ para un archivo» the whole
   time. **Restored** in `02665aa`, which made the code agree with the screen
   rather than the other way round.
4. **SKILL DELIVERY WENT NARROW, THEN CORRECT.** The pivot split the kit's
   skills: shared ones on the agent, craft ones inside each hired profile. So
   the moment wave 0 deleted the rosters, both live agents were **under-skilled
   in a way no pre-pivot solo agent had been** — `agent-check` asked for seven
   skills that had just left with the profiles. It was NOT closed by putting
   the fourteen back. `6da3081` moved the resolver out of `roles/` and
   `15d833a` made the index follow the purchase: a fresh client gets **8 of the
   kit's 14**, and buying `quotes` and `invoices-to-data` takes it to 10. Two
   things got more correct on the way — `drive-inbox` reaches an agent with a
   folder behind it for the first time (its `SKILL.md` used to sit in every
   client's prompt with nothing under it), and `agent-check` stopped demanding
   a skill the installer was right not to ship.

## Wave 0, outcome — the two live agents

`7897af2`. Reversible and deliberately first: three deletions per agent
(`policy/roles/catalog.json`, `data/profiles/<role>/`, `policy/rooms/`) plus a
restart, with the portal built at HEAD pointed at the result. Table, backups
and runbook in `kit/fleet.md`. Its two loose ends both closed later in
the same day: the under-skilling by `15d833a` (above), and the check that
**lied instead of failing** by `76b8307`.

## Wave 1, outcome — the portal

`02665aa` `428c4fc` `ef6c3fb` `184223f` `a8e5e50` `e6ddcea` `ebd2423`, logged
in `94d08c0`. `app/app/` only, in an order where every commit compiles, with
`agent.ts` last on purpose — the portal's only network entry point, so nothing comes out of it
until nothing calls it. Closed green: `tsc --noEmit` and `npm run build` clean,
and the whole browser session touching `/portal/manifest`, `/portal/activity`,
`/portal/approvals`, `/portal/chat/stream`, `/api/sessions` and `/api/jobs` and
nothing else.

It also found the one bug it did NOT cause: **the 60-s manifest poll could
unmount `<Onboarding>` mid-flow** once the channel step had written
`contact.channel`. Pre-existing — wave 1 only removed the `modules.roles`
conjunct, which makes onboarding MORE likely to render — and fixed separately
in `3163a62`: the answer is read once, with the session's first manifest, and
onboarding owns its own completion. Reproduced in jsdom against the real layout
both ways.

## Wave 2, outcome — the landing and the blog

`0c80296` `647330f` `9daf466` `35098cc`. One agent per company instead of the
roster, plugins instead of hired roles, the metadata and OG card rewritten,
the demo widget's header no longer greeting a team, and the price post
rewritten to «diagnóstico + plugin + mensual». This was the wave that
had been pricing-gated; it stopped being gated when the price stopped being
per role.

## Wave 3, outcome — the adapter

`2b817bd` `fb31719` `41a1ed9` `9112761` `9c4e6cb` `97462d9`. The room's store,
its four routes and its transcript; the chat stream unforked onto one agent,
one key, one prefix; the roster, the hire and the router; the nameless
identity write. **Adapter 0.43.0, a minor because it is a contract
break** — `GET /portal/roles`, `POST /portal/roles/request`,
`GET/POST/DELETE /portal/rooms(/{id})`, the manifest's `roles` flag and the
`role`/`room` fields on both stream routes are gone, and a POST that still
carries one gets a **404 or a 400 rather than being ignored** (`97462d9`), so a
stale portal hears about it instead of quietly getting the agent's own answer.

## Wave 4, outcome — the kit

`24ecccb` `9fc93e2` `6da3081` `184223f` `6c1343f` `d8522b0` `077c5d7`
`048eee4` `15d833a`. `roles/` and the hire deleted whole. What replaced the
roster as the record of what a client has is
`policy/capabilities/purchased.json`, computed into a plugin set and a skill
index by one function everything asks (`24ecccb`,
`15d833a`). Curated flows moved to the plugin whose work they are
(`surfaces.flows`, `9fc93e2`) and land in `data/flows/<slug>/`, where the
client can edit them like the ones the agent wrote.

## Wave 5, outcome — checks, tools, live agents

`76b8307` `44a066b` `1e401f7` `f9dfac0` `39f363c` `7946730`. `agent-check`'s
six role checks and their helpers; `portal-check`'s roles
module; the drawing tools reduced to a look; the clone corpus and the proxy;
the English-migration script; and the two `CLAUDE.md` a new session reads
first.

## Wave 6, outcome — the docs and the notes

`bf37ac7` `f8c893b` `d2aab2b` `fed311e` `2167df3` `e1e0ebb`. The pivot's record
archived and what outlives it extracted; the onboarding
runbook rebuilt around the purchase and, at last, around a VPS; the roadmap's
Team tab replaced by the onboarding direction; PENDING's closed items closed
and its hire report marked historical; COMPACT's status, routes and two new
hard lessons; and five notes that mentioned roles in passing.

## Validated independently, 30/8 — and what it found

A second pass measured the claims above rather than reading them. Everything in
the inventory reproduced: 53 files deleted counting the two archived notes as
deletions, 91 code files at +2,771/−8,792, 59 prose files, and the whole gate
green — 67 adapter tests, 139 tool tests, `check-plugins`, `check-clones`,
`check-adapter-boundaries`, `compare-installers` (73 identical files), `tsc` and
`npm run build`. No Spanish identifier entered the new code.

The measurements the removal rests on, taken again from scratch:

- **A fresh solo install is 7 plugins, 8 flows, 8 skills** — approval, artifact,
  capability, deliverable, flow, kanban, transcribe. Buying `social-package` and
  `invoices-to-data` takes it to **11 plugins, 14 flows, 12 skills**, and a
  `purchased.json` naming an id the catalog does not have stops the install by
  name and writes nothing.
- **The adapter's contract break is real on a booted fixture**: `/portal/roles`,
  `/portal/rooms(/{id})` and `/portal/roles/request` all 404, `role` or `room`
  in the body of either stream route is a 400, the manifest does not contain the
  substring `role` at all, and identity refuses a company before a name (400)
  then accepts name (200) then company (200).
- **Both live agents match `fleet.md` exactly** — the demo at 30 ok · 0 warn ·
  0 failures and 11 plugins, the VPS at 29 ok · 0 warn · 1 failure (the
  identity, correct and expected) and 7 plugins, TLS clean on both hostnames,
  US$0.00 moved on the VPS key. One chat turn asked the demo agent its name and
  got «Tuca», US$0.00567055.
- **The onboarding fix holds under the poll it was written for**, driven against
  the real `layout.tsx` in jsdom: the flow survives a manifest poll at every
  step, and the bug reproduces on the parent commit and on HEAD with only that
  line reverted.

Six documentation defects came out of it, all fixed here, and only ONE of them
was a pivot leftover — `kit/README.md` still delivering skills «to the
profiles». The other five were pre-pivot staleness the removal simply did not
touch: COMPACT's repo table, its tab list, its kit inventory, `fleet.md`
calling East the only agent in the fleet, and a PENDING item the same file
closes 130 lines later. Worth saying plainly: **the removal was clean, and what
the audit found was the debt around it.**

One thing is NOT closed and is written up in `docs/PENDING.md`: a client who
**reloads** between the channel step and the end of onboarding still loses the
last two steps, because the gate reads the agent once on arrival. Same tail as
the poll bug, much rarer, and closing it is a decision about what onboarding is
rather than a patch.

## What is deliberately NOT here

- **East (`49.13.225.187`) was never touched and must not be.** It is the only
  agent in the fleet that never saw a roster, which makes it the pre-pivot
  reference shape and the thing everything above was brought back to.
- **The three-zone capability rendering** from `team/knowHow.tsx` is not
  ported. No solo screen asks for it today, and porting a layout with no caller
  is how the pivot got big in the first place. It is written out in full in
  wave 1's section above and in the delete commit; whoever redesigns Conexiones
  or the capability card starts there.
