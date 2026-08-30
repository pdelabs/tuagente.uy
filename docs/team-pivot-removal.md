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
| 1 | The portal (`app/app/`) | in progress |
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
