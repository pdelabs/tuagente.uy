# Team pivot — status as of 8/19/2026

To pick back up in a new session. Since 8/22/2026 it's ONE monorepo: the kit
lives in `hermes-kit/` inside the tuagente.uy repo (`worktree-pivot-equipo`
branch; the kit's history came in via subtree). `main` still knows nothing
about the pivot, and rolling back means deleting the branch. The old
hermes-kit repo is now archived.

## What the pivot is

From "one assistant" to **a team**: the client hires roles separately
(marketing, support, sales, accounting, and the bespoke assistant). Each role
is a **Hermes profile** in the same container — its own SOUL, skills, memory,
name, and face. Reference price ~1000 UYU/role, **not published until the
real cost is measured** (one day of images on Mr.Wobble cost US$1.51: that
eats the price).

## Decisions made (don't reopen without a reason)

- **No receptionist persona.** Routing is the app's job, not a sixth
  character. With a single role there's no routing. Sign-up: pick a role →
  name it (option A).
- **Work stays global; the role is an attribute** (chip/signature). The ONLY
  per-role view is the Team tab (`/app/team`, `?role=<id>` for the profile).
- **Chat = one room.** `@` directs the turn to someone (it doesn't insert
  text), `/` files, `#` tickets. Without `@`, a router inside the adapter
  decides (a short prompt straight to the provider, ~300 tokens, it doesn't
  run the full agent). Responses are signed; a teammate's turn travels as
  `[X said] …`, never as `assistant` — otherwise the next one reads it as its
  own (measured).
- **The adapter stores the room** (`policy/rooms/*.jsonl`, append-only): the
  engine IGNORES the client's session_id and mints one per turn, so engine
  sessions can't carry a multi-role conversation on their own.
- **Accounting is READ-ONLY** (DGI/e-invoicing). Not up for debate.
- **Anti-punt rule** in every identity.md: never refer out something it
  actually can do.
- **Closed role catalog** in `policy/roles/catalog.json` (the agent can't
  rewrite what its client is paying for). `routing` is a commercial field:
  slack = a paid role with no work. Not shown to the client.
- **Capabilities**: the client picks from a curated menu; NO auto-installing
  skills (see the `rol-multitasker-y-capacidades` memory). The generalist
  "Assistant" role is still missing (the East case).
- Honcho (third-party SaaS memory): **discarded** — client data would leave
  the container.

## What's built and tested

**hermes-kit** (`github.com/luisgurmendez/hermes-kit`, PRIVATE, Luis's
personal account — NOT the orbit one):
- `roles/`: catalog.json (identities with a face per role), `build_role.py`
  (composes the SOUL = kit:base + identity.md, FAILS if an identity redefines
  base rules), 4 roles with an identity.md and **12 curated flows** (3 per
  role).
- Adapter: `GET /portal/roles`, `assignee` on tickets, `POST
  /portal/chat/stream` (role + room + router), `rooms.py` + `GET
  /portal/rooms[/id]` to read a conversation and `POST`/`DELETE
  /portal/rooms/<id>` to name one or throw it away (598aa56 — the sidebar's
  two menu items used to go to the engine, which has never heard of a room),
  `portal.role` SSE event before the first token. The adapter suite is 83
  tests.
- `tools/hire-role.sh <role> <agent>`: build + install + **its own key** (the
  engine fails closed: the portal's key → 401 on `/p/<role>/`) + **gateway
  restart** (`profiles_to_serve` only runs at startup) + **symlink of the
  role's workspace to the shared one** (otherwise the deliverable lands
  somewhere no screen shows it — tested end-to-end with a real ticket).

**Portal** (tuagente.uy, `worktree-pivot-equipo` branch):
- `lib/roles.tsx` (useRoles/RoleChip/RoleSignature), Team tab + profile, chip
  on the Board, full room-based chat with persistent rooms.
- Usage is BACK (8/19): the number comes straight from the provider. `GET
  /portal/usage` (renamed from `/portal/uso`) in the adapter queries
  `https://openrouter.ai/api/v1/key` with the agent's key (server-side — the
  key never reaches the browser), caches for 5 minutes, and serves
  today/month/total/limit. The manifest turns on `usage` only if
  `OPENROUTER_API_KEY` is present. The old, already-English-named
  `/portal/usage` endpoint and `costs.jsonl` died along with the old number.
  "Usage" is still removed from Home.
- An agent with no roster ⇒ portal identical to today's (the `roles` module
  set to false).

**Lab**: ~~`scratchpad/agente-lab`~~ — **deleted 24/8/2026** in the fleet
cleanup wave, Luis' order. It was 4 hired roles (Vera/Beto/Nina/Tino)
against a local portal on 8090, in a tmp scratchpad, with no containers
left running. Nothing in it was a client's: no SOUL, no identity, an empty
`channel_directory.json`. **Its OpenRouter key `lab-equipo-spike` (US$5
cap) is still live and now has no user — revoke it** (see pending 14).
Rebuilding the lab is `new-agent.sh` plus four `hire-role.sh` runs; what
does not come back is the state those roles had accumulated, which is what
pending 8 and 9 were going to be measured against.

**Lab quirk (Mac only):** Docker Desktop's file-sharing caches the size of
bind-mounted files; after rewriting `policy/roles/catalog.json` from the
host, the adapter can read it TRUNCATED to the old size (JSONDecodeError at
`line <last>`). `docker restart lab-portal-adapter` clears it. Doesn't happen
on a remote Linux box. This is exactly why `deja()` in `hire-role.sh` writes
via tmp+mv (afde4bf).

## Done 8/19 (waves 1-4, orchestrated with subagents + a validator each)

- **Capabilities catalog v2** (b659ad2): 25 rows, base/menu levels,
  `social-package` as ONE offering. It came out of 3 research pieces + a
  devil's-advocate pass: `notes/capabilities-50-verdict.md` and
  `notes/capabilities-research/`.
- **install.sh per role** (81ad2d6): mechanical split in
  `roles/skills_split.py` (intersection of ready roles + fallbacks +
  base-capability skills); no-roster backward compatibility verified with a
  byte-for-byte diff; curator turned off.
- **Hiring pipeline** (181df5b + afde4bf): `POST /portal/roles/request`
  (append-only ledger), `GET /portal/roles` with hired/requested/named,
  `hire-role.sh --from-request|--name|--look-file` writing the name into the
  SOUL during a temp build. E2E green against the live lab.
- **Portal** (84b6c77 + 853e643): team sign-up flow (pick a role → name it →
  request → wait → trimmed-down onboarding with business+channel), Team
  intro, and "hire another role" from the tab (`?hire=<role>`). An agent with
  a team never sees the single-agent naming flow.

## Done 8/19, second batch (waves 5-6)

- **"What it can do" on the role's profile**: base capabilities shown as
  included (no button), active ones, and the menu grouped and collapsed. The
  chat card learned the same trick: an inactive base capability says
  "avisanos", not "pedila". Visual QA against the migrated lab (already
  running the new install + catalog v2: agent-check 0 failures, portal-check
  passes).
- **Assistant role ("Lola")**: identity with the anti-punt rule and the
  capability skill's flow, routing = roster fallback that doesn't steal work
  from the specialist roles, 3 flows built on base capabilities. The split
  logic didn't move.
- **"¿Qué necesitás que haga?"**: POST /portal/capabilities/suggest (one call
  to the provider, router pattern, ids validated against the menu, `no_match`
  falls back to the whole menu without flagging anything); the request
  travels with `capabilities` and `hire-role.sh` prints them out when hiring
  (never auto-installs). The question shows up both during sign-up AND when
  hiring from Team. 47 tests.

## Done 8/19, third batch (waves 7-8)

- **Real end-to-end run** with a throwaway agent built from scratch
  (`scratchpad/agente-e2e`, ports 8652/8653 — **deleted 24/8/2026**, it had
  stopped running well before that): sign-up → Lola →
  "¿qué necesitás?" (real matching: it flagged quotes+invoices+tenders for a
  hardware store) → named "Rita" → request with capabilities → hire
  --from-request → `/p/assistant` 200 with its own key and 401 with the
  portal's → the wait screen opened on its own in the trimmed-down
  onboarding. It caught TWO real bugs: missing `multiplex_profiles` in the
  base config (4636790) and the early flip that greeted "Lola" where the
  client had typed "Rita" (beaa7c4).
- **Usage tells the truth** (3761691 + 7e6c864): `GET /portal/usage` against
  OpenRouter, the lying code path deleted, the tab un-hidden.
- **COST PER ROLE MEASURED** (the number that was blocking pricing): US$0.026
  per real average turn — conversational US$0.006, with tools US$0.062. 30
  turns/day ≈ US$23/month (eats up almost the entire ~US$25 price); 10
  turns/day ≈ US$7.7/month (31%). Still WITHOUT images: that was the 9x of
  the gap. The mix drives it, not the turn count.

## Done 8/19, fourth batch (wave 9)

- **The two skills in the paying cluster** (eaaf0bb): `quotes` (the client's
  format and price list, a bootstrap that asks questions, an authorized
  discount shown as a visible line with a reason, never a made-up price) and
  `invoices-to-data` (CFE extraction with unreadable fields left
  blank-and-flagged, RUT check-digit mod-11 validation, the batch never goes
  in without the client seeing it). Already live in the lab.
- **build_role.py rewrites paths** (same batch): specialist skills travel
  inside the profile and their text used to cite a pruned `/opt/kit/skills/`
  — the lab's brand-kit had ALL its scripts dead and nobody knew.
- **`hire-role.sh --update`** (07434b7): a kit update reaches a live role
  without renaming it or rotating its key. It also closed out the old
  pending items 8/9: the lab's 4 roles + Rita now run today's dist, and the
  spike's pre-dist support role got rebuilt clean.

## Done 8/19 (night): connections

- **LIVE WhatsApp bridge in the lab** (0e542ea): locally audited image, kit
  template fixed (it named a service/port/image that didn't exist; the truth
  is `whatsapp-bridge:8080`, the adapter's default). The pairing QR is served
  on the Connections tab — still need Luis to scan it with a THROWAWAY
  number. Note: `pair/status` returns a weird `{"error":"not found"}` — worth
  a look. For remote boxes: push the image to a registry of ours first.
- **Google consent-ready**: the engine's `setup.py` has the scopes hardcoded
  (all 8, Gmail included — the runbook's `--services` flag does NOT exist;
  noted in connections/google-workspace.md). The flow runs outside with
  narrowed scopes (sheets/drive/calendar/docs): URL minted with PKCE, still
  needs Luis's consent click, and `google_exchange.py` installs the token in
  the lab and runs --check-live on its own. If this repeats 3 times →
  tools/connect-google.py. The old test token (drive.readonly) REFRESHES:
  the OAuth app is healthy.
- **Role ↔ connection in the portal** (1bb09aa): "Necesita WhatsApp para
  empezar" now requests the connection right there, using the SAME ticket
  contract that Connections reads (tested live: Beto's card created the
  ticket and flipped to "Pedida" in the same tick). Self-service only when
  the Connections gate allows it — `setup_flow` was just lying about it
  (WhatsApp has a QR and a warning).

## Done 8/20: mining agency-agents (wave 10)

Analysis of github.com/msitarzewski/agency-agents (MIT, 125 persona-agents):
they're NOT competitors to our roles (they're personas for lending context,
with no approval gate, no delivery, no permissions — their Hermes plugin is
an open roster + delegation, the opposite of our decisions). What it DID have
was method, and it got transplanted, translated (6cd7a66): exit conditions +
"should I close the ticket?" + the six questions before quoting a price +
alternatives to discounting (sales/quotes), a complaints protocol as a new
flow `queja-de-cliente` + the four messages that escalate (support),
month-end close in four days with "a discrepancy gets investigated or
reported" (accounting), and the three-tier triage + "one thing, not seven" +
"the recording is content, not the boss" (assistant). All five live roles
already run it (--update, naming intact). And `tools/check-clones.py`
(99519d5) landed, wired into build_role: 15/30 thresholds measured against
the corpus (worst honest pair 3.8%, real clone 97%).

## Done 8/21-22: landing goes team-based + one visual signature per role

Landing and blog repositioned around the team model ($U 1,500/published
role, USD 200 deductible diagnostic, no more adding up "the five"): real
catalog faces via `agentito-svg.mjs` (single geometry source across
portal/landing/CLI, byte-for-byte goldens). Then, a hierarchy flip requested
by Luis: **custom comes first** — the Team section says "Every role gets
built to order" and the five become starting points (pill + subtitle + step
2 "We'll build your team" + a sixth card "The sixth one is yours" + FAQ);
Lola stopped carrying the "custom" badge alone. And looks made coherent with
the role, one signature look each: Vera spiral + sparkles (lost the
glasses), Beto ears + cheek dots (no bow), Nina redone in pink with a random
draw Luis asked for (ring + cheek dots + tongue + sparkles + decisive brows,
no tie; new c-pink tint), Tino glasses + bow, Lola redone from scratch in
coral (round shape + freckles + big eyes, no tie; its card takes the coral
tint that Nina freed up). `roles/catalog.json` changed (identity.look) +
goldens regenerated on purpose + the landing. Live agents don't change face
(naming overrides the catalog).

Then (8/22): a new **`hat`** axis (none/cap/beret/top-hat) in the SVG module,
the bow and the tie REDRAWN so they read clearly (the bow was a 17-unit blob
at the edge of the body; the tie spilled 9 units outside), and **scarf** as
`suit: 3` (a band + a tail with fringe). Rule: the hat covers the upper
antennas (0/1/4/5); ears (antenna 3) coexist fine. HEADS UP: the `.riv` file
doesn't know how to draw any of this yet — that's why the naming dice roll
now pulls from `RIVE_AXES` (app/app/lib/agentito.tsx), the table of what the
Rive canvas actually shows, and nobody in the catalog sports a hat/scarf yet.
Still needs a session with rivemcp to add the `sombrero` input + the suit
redraws into public/agentito.riv and bring `RIVE_AXES` up to par with
`LOOK_AXES`. To try variants there's a playground: `node
hermes-kit/tools/preview-agentito.mjs` → localhost:8077 (every variant of
each axis as live thumbnails, a dice-roll button, and the JSON ready to paste
into the catalog). Meanwhile the only visible divergence is the old bow/tie
on a hired agent's portal Rive canvas if it has them (today: only Tino, the
bow). ALL OF THIS UNCOMMITTED: waiting on Luis's OK because the push deploys
tuagente.uy to production.

## Done 2026-08-23 (later): plugin system phases 1-3 SHIPPED and validated

The plan below was executed the same day, after the full-English translation
landed. Phases 1, 2, 3a and 3b are done — 41 commits on local main, each
phase implemented by one Opus agent and adversarially validated by another
(12 defects found and fixed across the four validation waves). State at the
end of phase 3 — the porting wave below took it to 13: registry at
hermes-kit/plugins/ with 7 plugins (5 system + transcribe +
invoices-to-data), dependency graph enforced at build (check-plugins,
build_role, skills_split, install.sh) AND at boot (adapter refuses to boot on
a broken /opt/plugins), /opt/plugins ships computed per-agent sets with
confined loud removal, promises is now plugins/flow/engine/ (first engine
surface), portal API renames done (engine_plugins, adapter_version — the bare
word "plugin" is the kit's). See notes/plugin-system-plan.md for the live
status. NOT PUSHED — awaiting Luis.

AND THEN PHASE 4 CHANGED SHAPE AND SHIPPED THE SAME DAY. Luis's call: no new
plugin and no webscraping — PORT WHAT EXISTS and finish the migration. So phase
4 is the porting wave, not the first new surface: `quotes`, `brand-kit`,
`social-content`, `post-image` and `drive-inbox` became plugins, `capability`
became the SIXTH system plugin (it is core product machinery and client plugins
have to be able to depend on it), and `capabilities/catalog.json` gained
`installs.plugins` with a check that refuses a row pointing at the wrong home.
The registry is 13 plugins; `hermes-kit/skills/` is down to `no-images` and
`no-web-search`, which stay because they are the engine's fallback notes —
harness, not product. Nothing moved on an agent but `/opt/plugins`: the five
dists are byte for byte what they were, and a transition fixture installed
before the wave and updated after it gained exactly the new set members.
The old phase 4 is now phase 5 and waits for a client to need it; phase 6
(dynamic portal tab) rides with the first tab-bearing plugin.

## Done 2026-08-23: plugin system planned (in English, like everything from now on)

Luis's call: every custom client build must land as a reusable PLUGIN — code
+ MCP + portal tab + agent skills in one package. The plan is agreed and
landed in **notes/plugin-system-plan.md**: registry at hermes-kit/plugins/,
plugin.json manifest (id/version/description/requires/surfaces/system),
fail-loud dependency resolution at build AND boot, system plugins
kanban→approvals/deliverables/artifacts/flows, install per-agent / expose
per-role. Phase 1 is NOT started on purpose: Phase 0 is a separate session
translating the whole codebase to English (file names included — the
spanglish ends here; new rule: English for everything except client-facing
copy).

## Done 2026-08-24: the knobs a role never inherited, and four things nobody read

Eight commits on local main (ae377d5..ca7be15), each proven against the live
local agent or against a fixture, never against reasoning alone.

- **A hired role now runs the AGENT's knobs** (ae377d5) — item 13, and the gap
  was bigger than the entry said: no kanban toolset, no gate hooks, the curator
  loose over the only copy of the role's craft skills, on top of the model, the
  preamble and the disabled engine skills. `tools/profile_config.py` projects
  `data/config.yaml` into the profile at hire and at `--update`, minus four keys
  it names with reasons; `agent-check.py` fails naming the knob. Item 13 above
  has the whole story and the one thing it does NOT fix.
- **Two porting-validator escalations closed** (3f32d88, 8487017): a plugin's
  `requires.connections` / `requires.toolsets` are crossed against the files that
  own those ids, from `check-plugins.py` (build side, never boot); and a
  `level: base` capability promising a kit skill nobody wrote now stops the SOLO
  install too, which used to exit 0 in silence while the team one exited 1.
  Both written up in `notes/plugin-system-plan.md`, under phase 4.
- **The name and the face have one home** (ca7be15): `roles/catalog.json`.
  `roles/<id>/role.json` carried a second copy, the build shipped it, and the
  adapter reads the installed one ABOVE the catalog — so the 22/8 redesign
  reached the roster and never reached anybody already hired. All five had
  drifted and none had the `hat` axis. `build_role.py` injects it now and a
  source manifest that carries one is a build failure. The client's own rename
  is untouched by design: it lives in `policy/roles/identities.json`, above both.
- **Five deploy-report bugs** (5738a0d, f98150e, b2dca3e, 9413e6b, 87f7d2e):
  `hire-role.sh` reads the container's name off the compose instead of guessing
  it from the directory (the `sed 's/^agente-//'` is gone; `with-config-open.sh`
  and `close-config.sh` carried it until 80e7489, which moved the reader into
  `tools/compose-container.sh` and pointed all three at it); `new-agent.sh`
  stopped sending the
  installer's HEADS UP notices to /dev/null; the `secrets.env` template stopped
  handing the container its own hints as values (measured: all four variables
  came up SET, to prose); `/portal/plugins` answers seven on a solo agent, not
  six; and onboarding step 5 passes the ports, because on a shared host the
  defaults greet somebody else's agent and pass.

Live agent at the end: agent-check 34 ok / 0 warnings / 0 failures, portal-check
15 ok / 0 failures, both profiles served with the agent's model, `/portal/roles`
serving the roster's faces, `/portal/plugins` serving 11. The five dists are byte
for byte 8e6757b's except the five `role.json`, which change in `identity` and
`_comment` only.

## Done 2026-08-24 (later): the guard reaches a teammate, and it was not off

Six commits on local main (871bd0b..95528ba). The wave went in to give a role's
home the plugins the engine looks for; measuring it first turned the problem
inside out, so the entry starts with what was actually true.

**WHAT WE BELIEVED:** the `promises` guard never runs for a teammate, because
the engine discovers user plugins in `HERMES_HOME/plugins`
(`hermes_cli/plugins.py:1369`), the compose mounts ours over `/opt/data/plugins`
-- the DEFAULT profile's home -- and a role's home has no `plugins/`.

**WHAT IS TRUE.** That paragraph describes what a role's home RESOLVES, and it
is right about that: 55 plugins under `/opt/data`, 54 under a role's, the
missing one being `promises`. It is not what the running gateway does. The
engine's `PluginManager` is a process singleton (`plugins.py:2048-2056`)
whose `_discovered` latch makes the scan happen once (`plugins.py:1279,1305`),
the gateway serves every profile in ONE process, and
it scopes a turn with a context-local `HERMES_HOME` override
(`profiles.py:950-990`). So discovery happens ONCE, under whichever home
touched it first, and everybody else inherits that. Reproduced in the container
both ways:

    first discovery under /opt/data      the guard runs on the client's turns
                                         AND on a teammate's -- but the plugin
                                         had read its folder from the process
                                         env at import, so on a teammate's turn
                                         it judged them against the CLIENT's
                                         disk (which has no flows/ at all,
                                         while marketing's has three)
    first discovery under a role's home  54 found, promises not loaded, and the
                                         CLIENT's own turn came back with ZERO
                                         transform_llm_output callbacks

The second row is the one that mattered: whether the client had the guard was a
race on who spoke first after a restart. Not "the teammate has no guard" -- "the
guard is a coin flip, and when it lands it may be reading the wrong person's
folder", which is worse, because a guard that contradicts a teammate telling the
truth teaches the client to ignore it.

**THE FIX, three parts, none of which works alone:**

- `hire-role.sh` links `profiles/<role>/plugins -> ../../plugins` (871bd0b), on
  every hire and every `--update`. Relative on purpose: it resolves inside the
  container and from the host, where `agent-check.py` reads it -- an absolute
  `/opt/data/plugins` would dangle on every host and the check would have
  nothing to read. With the link and nothing else, the role discovers all 55 and
  loads `promises` **enabled: False**.
- `plugins` joins the projection (7025341): it was the fourth key
  `profile_config.py` withheld, on a reason the link had just removed. The
  denylist is three keys now.
- The plugin resolves the home AT CALL TIME (95528ba), through
  `get_hermes_home()` instead of `os.environ` read once at import. One process,
  one module, and now a different folder per turn.

**THE CHECKS.** `agent-check.py` gains "roles: profiles see the agent's plugins"
(7c1e88a), which names four states apart: no `plugins/`, a real directory
instead of a link, a dangling link, and a link pointing elsewhere (it prints the
target). All four exercised -- three on the live agent, the dangling one on a
copy with `data/plugins` removed -- and all four healed by `--update`. And the
promises check now calls the HOOK twice with two different homes through a
stubbed `hermes_constants`: same process, opposite answers, which nothing frozen
at import can do. It is what failed against the local agent before the fix
shipped.

**Folded in:** the knob-drift message gave up 19 characters before `Heal:`
(0e4066e) -- with `plugins` in the projection the five-role worst case was 278
of the 300 and a sixth took it to 290; and `hire-role.sh` now runs
`check-plugins.py` before building (03b187b), so a misspelt `requires.toolsets`
or `requires.connections` id stops a hire instead of installing a plugin that
asks the engine for a word it does not know. Measured: `imagegen` for
`image_gen` exits 1 before anything is built.

Live agent at the end: agent-check **35 ok / 0 warnings / 0 failures**,
portal-check 15 ok / 0 failures, both roles' homes resolving the same 55 plugins
and the same 48 enabled as the default (identical set hash), no new `Skipping
secondary profile` on any boot, `/portal/plugins` 11. The measured turn: asked
marketing for an example of a badly written message, it answered *"Queda
definido: todos los lunes a las 9:30 se hará un chequeo de contratos…"* and the
guard appended the correction to the live response, with
`hermes_plugins.promises: … appended the correction` in `agent.log`. The five
dists are byte for byte identical to before the wave. Spend for the whole wave:
US$0.017.

**Left open, and it is not this wave's:** the guard's phrase list does not catch
*"Dejé definido y andando…"* -- a real sentence this role produced. `review()`
needs a CLOSING_CLAIM from `promises.py`'s list and only recognises the `queda
/ quedó` forms. Widening that list is a false-positive question and deserves its
own measurement.

## Pending (in order)

1. **Cost RE-MEASURED on correctly configured roles (2026-08-24, local
   agent).** The old row — conversational US$0.006 · with tools US$0.062 ·
   US$0.026 per average turn — is **SUPERSEDED: it was measured on
   MISCONFIGURED profiles.** Those roles ran `z-ai/glm-5.2`, with no kanban
   toolset, the engine's default preamble and no gate hooks, because the knob
   projection did not exist yet (see the 24/8 entry). The numbers below come
   from the same two roles after that fix.

   Config measured on: `openai/gpt-5.6-luna`, `reasoning_effort: max`,
   `toolsets: [kanban]` plus the 12-toolset `platform_toolsets` list, the
   three gate hooks, the `promises` plugin, the portal `platform_hints`
   preamble, curator off. `agent-check.py` was 35 ok · 0 failures going in.
   Roles: accounting (Tino) and marketing (Vera).

   METHOD: turns sent the way `chat/page.tsx` sends them in room mode —
   `POST /portal/chat/stream`, full history, `stream: true`, a pinned `role`,
   a `sala_…` room id — serialized one at a time, reading the delta off
   `GET https://openrouter.ai/api/v1/key` (the uncached version of what
   `/portal/usage` serves) polled until it stopped moving. The per-turn
   deltas sum EXACTLY to what the key moved, so nothing leaked between turns.

   **THE ENGINE ALREADY KNOWS THE NUMBER, and that is the useful discovery.**
   `session_model_usage.estimated_cost_usd` (`cost_source=provider_models_api`)
   matched OpenRouter to the last decimal on every session: 0.01329354 vs
   0.013293 and 0.06288972 vs 0.062890 for marketing, 0.00832391 vs 0.008324
   and 0.03609663 vs 0.036097 for accounting. On this configuration the
   "estimate" IS the charge, per session and per `task`, queryable without
   asking the provider. Future cost work does not need a key-polling harness.

   | turn | role | tool calls | s | US$ |
   |---|---|---|---|---|
   | conv 1 (cold room) | Vera | 1 | 17 | 0.007002 |
   | conv 2 | Vera | 1 | 15 | 0.002376 |
   | conv 3 | Vera | 3 | 24 | 0.003915 |
   | conv 1 (cold room) | Tino | 0 | 9 | 0.006004 |
   | conv 2 | Tino | 0 | 9 | 0.000982 |
   | conv 3 | Tino | 0 | 11 | 0.001338 |
   | tool 1 — deliverable written | Tino | 22 | 94 | 0.023238 |
   | tool 2 — deliverable written | Tino | 12 | 79 | 0.012859 |
   | tool 1 — approval, refused for missing data | Vera | 42 | 156 | 0.048492 |
   | tool 2 — approval, refused for missing data | Vera | 20 | 45 | 0.014397 |

   - **Conversational: US$0.0036/turn** (6 turns, range 0.00098–0.00700).
   - **With tools: US$0.0247/turn** (4 turns, range 0.0129–0.0485).
   - **Room router: US$0.000071/turn** (5 routing calls measured directly).
     A turn nobody `@`-addressed pays this on top; it is 2% of a
     conversational turn and rounds away.
   - **Vision: NOT EXERCISED. Zero vision calls in all 10 turns** — no
     `task='vision'` row in either profile, no vision tool invoked. See the
     image caveat below for why the log still settles something important.
   - Image: **US$0.10/placa carried over from 8/19, NOT re-measured**, and
     the rationale for carrying it does NOT fully hold — see below.

   **THE CONVERSATIONAL WIN IS MOSTLY PROMPT CACHE AND SHOULD NOT BE BANKED.**
   Split by position in the room: the FIRST turn of a room costs US$0.0065,
   every turn after it US$0.0022 — with `cache_read_tokens` around 44k per
   call against `input_tokens` in the single digits. US$0.0065 is essentially
   the OLD US$0.006. A client who sends ten messages spread across a day pays
   close to the old number; only a burst of consecutive turns gets the cheap
   ones. What genuinely moved is the tool path: **US$0.062 → US$0.0247, 2.5x
   cheaper**, and that does not depend on cache timing.

   **A CONFIG BUG IS INSIDE THE TOOL-HEAVY NUMBER, and it is fixable.** Four
   skills — `approval`, `capability`, `deliverable`, `flow` — exist BOTH in
   each profile's own `skills/` and in the read-only `/opt/kit/skills` mount,
   so the engine refuses to resolve them: *"Ambiguous skill name
   'deliverable/SKILL.md': 2 skills match across your local skills dir and
   external_dirs. Refusing to guess."* 13 collisions in today's `errors.log`.
   The roles then flail — 42 tool calls on Vera's worst turn, five of them
   `session_search` — and that single turn is US$0.0485, half the tool-heavy
   spend of the whole wave. Vera never produced the approval at all. **The
   tool-heavy figure above is therefore an upper bound measured on a broken
   skills index**, and de-duplicating those four skills should lower it.

   THE MIX MATH, recomputed. Same weighting the old row used (solving
   `.006w + .062(1-w) = .026` gives w≈2/3 — two conversational turns per turn
   with tools), 10 placas/month at US$0.10, against ~US$25/role:

   | | blended turn | 10 turns/day | 30 turns/day |
   |---|---|---|---|
   | OLD (wrong config) | US$0.0246 | US$8.4/mo — 34% of price | US$23.2/mo — **93%** |
   | NEW (as measured) | US$0.0107 | US$4.2/mo — 17% of price | US$10.6/mo — 42% |
   | NEW, cache-pessimistic | US$0.0126 | US$4.8/mo — 19% of price | US$12.3/mo — 49% |

   ("cache-pessimistic" prices every conversational turn at the cold
   US$0.0065, i.e. a client who never sends two messages in a row.)

   **THE MARGIN STORY CHANGED, at exactly the end that was scary.** At the
   realistic mix the cost roughly halves (34% → 17-19% of price). What moved
   is the case the old row flagged as what-breaks-it: 30 turns/day went from
   US$23/month — eating the entire published $U 1.500 — to US$10.6-12.3,
   which leaves the price standing. The only shape that still eats it is 30
   TOOL-HEAVY turns every single day (US$23.3/month, 93%), and that was
   US$56.8 — 227% of price — on the old numbers. $U 1.500/role/month is no
   longer backed by numbers from the wrong profile.

   **IMAGE: THE CARRY-OVER RATIONALE IS HALF TRUE, AND THE HALF THAT IS FALSE
   IS THE EXPENSIVE ONE.** Confirmed images still cannot be generated here:
   `check_image_generation_requirements returned False` AND
   `check_bfl_requirements returned False` on every turn, so both image paths
   are stripped from the index and no image key exists on this agent. The
   proposed rationale was that a placa is priced per-image by the image model,
   independently of the profile knobs that were wrong. **That is true only for
   the generation call itself.** The engine logs, on every single turn:

       agent.auxiliary_client: Vision auto-detect: using main provider
       openrouter (openai/gpt-5.6-luna)

   Vision resolves to the MAIN chat model on the MAIN key — not a separate
   vision provider. So the post-image workflow's mandatory LOOK pass is billed
   as a chat turn at the role's own model and `reasoning_effort`, which are
   precisely the knobs that were misconfigured. And reasoning dominates output
   on this config: 18,315 of 21,247 output tokens on marketing's tool session.
   A task-scoped pass does get its own costed row — the `approval` task showed
   up as one (5 calls, US$0.00066) — so the LOOK pass IS separately
   attributable once an image key exists. **Verdict: US$0.10/placa is an
   unverified carry-over for the raw image call, and the true per-placa
   composite (generation + LOOK + the conversational turn that decides to call
   it) has never been measured on a correct profile. Needs a Mr.Wobble-style
   setup with a real image key.** Note also that 8/19's "one day of images on
   Mr.Wobble cost US$1.51" is 15 placas at US$0.10, not 10.

   Still open: the pricing decision itself (Luis).


   (Since measured: see notes/image-cost-anatomy.md — the per-placa
   composite came out US$0.357 from Mr.Wobble's ledger, the US$0.10 was
   the price of a provider the plugin cannot call, and the US$1.51 "day"
   was the ledger's cumulative total misread as daily.)
1b. **DONE (23/8, on the local agent).** The "Skipping secondary profile ...
   port-binding api_server" warning was not noise: the gateway starts NO
   adapters for a skipped profile and drops it from `served_profiles`
   (measured by pulling accounting's config.yaml back out and rebooting:
   `['default', 'marketing']`). It only LOOKED benign because /p/<role>/ is
   answered off a directory scan the skip never touches. The cause was the distribution
   shipping no `config.yaml` at all: the container's `API_SERVER_KEY` then
   turns api_server on for every profile from the environment. Now
   `roles/build_role.py` ships the pin, `hire-role.sh --update` passes
   `--force-config` and fails if the boot it caused logs a new skip, and
   `agent-check.py` has "roles: no profile binds the shared port". (032b271, 0e2bf7e) Both roles
   on the local agent were healed with `--update` and the room answered:
   routed to `accounting`, `finish_reason=stop`, 6 API calls.
4. **CLOSED 24/8 — Mr.Wobble was decommissioned, not migrated** (Luis'
   order). The safety check first: it was tuagente.uy's own agent, not a
   client's — identity `Mr.Wobbly` / empresa "Tu agente", one Telegram DM
   with Luis as its only channel, and a `workspace/` that held nothing but
   our own marketing. Then all six containers removed with `compose down`
   over both compose files, **no `-v`**. `/opt/agentes/tuagente/` (178 MB)
   and the 13/8 pre-reset tarball stay on that VPS untouched; the runbook
   to bring it back is in `fleet.md`. **What stopped with it: the daily
   `contenido-instagram-diario` cron** — nobody produces tuagente.uy's own
   Instagram content now, and both `*.agentes.tuagente.uy` domains answer
   nothing.
5. Orphaned engine sessions (one per room turn) pile up in each profile — we
   decided to leave them and just note it.
6. **CLOSED 24/8, and the answer was no.** The sweep found exactly two
   agent trees under `~/Desktop/Luis/Projects/` (every
   `docker-compose*.yml` pinning `nousresearch/hermes-agent` was checked):
   `tuagente-local-agent` (live, ours) and `agente-east`.
   **`agente-east` IS a client agent and was NOT deleted.** It is not the
   "communications trial" the key name `east-comunicacion` suggests: its
   `SOUL.md` opens *"Sos el agente de East Comunicación"*, names Cata — a
   comunicadora in Punta del Este who produces interviews for TV and radio
   — as the person who directs and approves, and defines her two flows
   (`entrevistas-tv`, `radio-viva`). The tree holds real interview material
   and a `google_client_secret.json`, and **the agent is LIVE on its own
   VPS** (ssh `east`, containers up 13 days, verified the same day). The
   local directory is a second copy of a client's data, not scratch; it
   stays until Luis decides otherwise with Cata's agent in mind.
   Deleted instead, both throwaway and both in tmp scratchpads:
   `agente-lab` and `agente-e2e`. Nothing else under `Projects/` is an
   agent — `hermes-kit/` is the archived pre-monorepo kit repo and
   `_respaldo-lamano/` is La Mano's retirement backup.
7. Assistant role + expand the capabilities catalog (6 today, ~30 possible;
   add `vision` and `code_execution` first).
8. **Measure the curator in the lab instead of inferring it.**
   `config.base.yaml` already turns off `curator.enabled`, because on an
   agent with a team the ONLY copy of a specialist skill lives in
   `data/profiles/<role>/skills/` — which belongs to the agent, is writable,
   and looks to the engine like "agent-created", i.e. archivable after 90
   days unused (`engine-knobs.md:370-388`). The knob is belt and suspenders;
   the measurement is still missing, and **the lab it was going to be
   measured in was deleted on 24/8** — this now starts with rebuilding a
   lab. It's two questions: (a) does
   `is_curation_eligible` return True for a skill that `hermes profile
   install` put there?, and (b) can `skill_manage` overwrite a profile's
   skill, or does it hit something? Both get answered in the lab, with the
   four roles already hired.
9. **MOOT as written (24/8): the lab was deleted, so its four roles do not
   exist any more.** What survives is the lesson, and it applies to any
   agent hired before v0.1.1 — including the two roles on the local agent.
   The original entry: **the lab's four roles are carrying an old
   `transcribe` skill inside support.** They were hired with `role.json` v0.1.0, which declared it;
   today's distribution is v0.1.1 with four skills. `hermes profile install`
   doesn't remove what's already there: they need `hermes profile update`
   (or a reinstall), then verify that support ends up with
   approval/deliverable/flow/capability and nothing else.
10. **`drive-inbox` doesn't reach any agent with a team.** It's the only one
    `skills_split.py --orphan` lists: no role declares it and it isn't a
    fallback note. And the canonical example in
    `plugins/flow/skills/flow/create_flow.py:21-24` — which does travel to everyone,
    because `flow` is shared — builds its sample flow with `--trigger drive`
    and `--skills drive-inbox,…`. Either we give it an owner (support? the
    "Assistant"?) or we drop the example: right now we're teaching every
    role to build a flow with a skill it doesn't have.
11. **A client who hires ONLY support ends up without `artifact`.** It's the
    only one of the four that doesn't declare it, and `artifact` is what's
    behind the portal's visualizations screen (`deliverable`→Files,
    `approval`→Approvals, `artifact`→Artifacts): they hire their role and a
    tab is left with nothing behind it. Decide whether support declares it
    (bumping v0.1.1 → v0.1.2) or whether the screen turns itself off when
    it's missing.
12. **`requests.jsonl` doesn't survive the capability rename.** `imagenes`
    and four others got merged into `social-package`, so the requests
    already logged carry ids the new catalog doesn't have. Nothing breaks —
    the file is append-only and the portal reads the catalog — but any
    historical analysis of what clients requested won't line up before and
    after. An analysis note, not a task.

13. **A role inherits NONE of the agent's config knobs, and that is
    measured, not feared** (23/8, local agent, resolving the engine's own
    loader under each home). `data/config.yaml` belongs to the DEFAULT
    profile; a secondary profile reads its own, and ours carries one line.
    Side by side:

        default profile           accounting
        model    gpt-5.6-luna     model    None  -> engine default, and the
                                                    live turn ran on
                                                    z-ai/glm-5.2
        toolsets [kanban]         toolsets [hermes-cli]
        platform_hints api_server platform_hints (none) -> the role gets the
                                                    engine's "assume plain
                                                    text, no markdown"
                                                    preamble, the one the kit
                                                    replaces on purpose
        skills.disabled 66        skills.disabled 0     -> all 70 engine
                                                    skills indexed for the role
        external_dirs /opt/kit/skills   external_dirs (none)

    So every cost and quality number measured for a role was measured on
    another model with another prompt.

    **DONE (24/8, ae377d5), and the gap was bigger than this entry.** Proving
    the fix turned up three more, each of them product and not tuning:

        api_server toolsets   the default's twelve, WITHOUT kanban and WITH
                              browser, cronjob and delegation -- the teammate
                              cannot touch the board, and the three doors the
                              kit closes on purpose are open
        hooks                 0 pre_tool_call against the default's 3: THE GATE
                              WAS NOT THERE on a teammate's turn (installing
                              software, signing as `portal`, self-unblocking)
        curator               ON, over `profiles/<role>/skills/`, which on a
                              team agent is the only copy of that role's craft
        display.file_mutation_verifier
                              ON -- a host path stapled onto the client's answer

    A DENYLIST, NOT AN ALLOWLIST. Every knob in `compose/config.base.yaml` was
    written as how this PRODUCT behaves, not how the default profile behaves,
    so the default is that it travels; `tools/profile_config.py` names the four
    that cannot and why (`api_server`, `platforms`, `gateway`, `plugins`). The
    copy happens at the hire, where the agent's config is one `docker exec`
    away: `hire-role.sh` rewrites the built distribution's `config.yaml` before
    installing, on a first hire and on `--update`. The distribution still ships
    the pin alone, so the five dists did not change a byte.
    `agent-check.py` fails naming the knob, through the same module.

    Both roles on the local agent healed with `--update`: identical to the
    default profile on every projected knob, 34 ok / 0 failures, and a room
    turn to accounting logged `API call #1: model=openai/gpt-5.6-luna`. The
    numbers in 1 can be re-measured now, and they have to be: they were taken
    on z-ai/glm-5.2 with no kanban tools.

    CLOSED THE SAME WEEK, and the diagnosis in the entry was half right --
    see «Done 2026-08-24 (later)» below. A role's home does get a `plugins`
    link now, `plugins` is no longer one of the keys that stay behind, and
    the guard fired on a live marketing turn. What the entry had wrong is the
    word "does not run": in the live gateway the plugin manager is a process
    SINGLETON, so the guard did run on a teammate's turn -- against the
    client's disk -- and, depending on which profile spoke first after a boot,
    sometimes ran for nobody at all.

14. ~~Revoke `lab-equipo-spike`~~ **DONE 2026-08-24**: disabled via the
    provisioning API the same day this pending was written (the sweeps crossed
    in flight). `east-comunicacion` stays alive — but see the note about WHOSE
    key that is in the fleet report.

## Luis's ground rules

Code AND comments **in English** (client-facing copy in rioplatense
Spanish). **No protective programming** — let it break hard. The whole pivot
lives in the worktree in case of rollback. In design ping-pong: keep answers
short.
