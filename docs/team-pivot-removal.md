# Removing the team pivot

**Luis' decision, 30/8/2026: back to ONE baptized agent per client.** The
client names it and gives it a face at onboarding, they talk to it, it owns
everything. The plugin framework stays — what goes is per-role exposure.

This file is the running record of the removal. It is not the plan: it says
what has actually been done, wave by wave, and what each wave learned. The
pivot's own record stays where it is (`hermes-kit/notes/team-pivot-status.md`)
— it is the account of what was built and why, and deleting it would throw
away the reasoning along with the code.

Reading order for whoever picks this up: this file, then `hermes-kit/fleet.md`
(«The team pivot, undone») for the live agents, then `docs/portal-routes.md`
for the URL contract.

## The waves

| | What | Status |
|---|---|---|
| 0 | The two live agents: roster, hired profiles, rooms | **done** 30/8 |
| 1 | The portal (`app/app/`) | **done** 30/8 |
| 2 | The landing and the blog — pricing-gated | open |
| 3–6 | The kit: adapter, roles/, tools, checks | open |

Waves 2 and 3–6 have not been started. Nothing below claims otherwise.

## Wave 0 — the live agents

Reversible, operational, and deliberately first: the point was to see what the
portal does the moment the roster leaves, **before deleting a line of it**.

Two agents were touched. **East (`49.13.225.187`) was not, and must not be** —
it is the only agent in the fleet that never saw a roster, which makes it the
pre-pivot reference shape and the thing the portal is being brought back to.

The full measurement table, the backups, and the runbook are in
`hermes-kit/fleet.md`. The short version: three deletions on each agent
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

### Found on the way out, NOT fixed: onboarding can be cut short

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
because on a team agent that gate never fired at all. Left alone deliberately:
fixing it means deciding whether onboarding should read the manifest once at
mount or hold its own completion flag, and that is a decision about
onboarding, not about the pivot.

## What wave 0 left broken, and for whom

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

**And one check lies instead of failing.** `SOUL: identity` still reports OK
with «with no name of its own (a team client never names theirs), works for
"\<empresa\>"». That branch never consulted the roster, so on both live agents
an agent with **no baptism at all** passes on a sentence about a shape that no
longer exists. It is the first thing to delete in wave 5: it hides exactly
what the product now requires.
