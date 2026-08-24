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
  /portal/rooms[/id]`, `portal.role` SSE event before the first token. 20
  tests passing.
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

**Lab**: `scratchpad/agente-lab`, 4 hired roles (Vera/Beto/Nina/Tino), local
portal `nohup npx next start -p 8090` (8090 is the only port in the lab's
CORS). OpenRouter key `lab-equipo-spike`, US$5 cap — **revoke when done**.

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
  (`scratchpad/agente-e2e`, ports 8652/8653, still running): sign-up → Lola →
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
(12 defects found and fixed across the four validation waves). Current state:
registry at hermes-kit/plugins/ with 7 plugins (5 system + transcribe +
invoices-to-data), dependency graph enforced at build (check-plugins,
build_role, skills_split, install.sh) AND at boot (adapter refuses to boot on
a broken /opt/plugins), /opt/plugins ships computed per-agent sets with
confined loud removal, promises is now plugins/flow/engine/ (first engine
surface), portal API renames done (engine_plugins, adapter_version — the bare
word "plugin" is the kit's). See notes/plugin-system-plan.md for the live
status. NOT PUSHED — awaiting Luis. Phase 4 (webscraping service plugin +
first guarded third-party MCP) awaits Luis's scope input; phase 5 (dynamic
portal tab) should ride with phase 4's first tab-bearing plugin.

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

## Pending (in order)

1. **Cost with images: MEASURED (8/19, real lab)** — US$0.10 per turn with
   an image (Vera generated a real 1080x1080 graphic); 10 graphics/month ≈
   US$1. The full mix picture: conversational US$0.006 · with tools US$0.062
   · image US$0.10. A realistic SMB mix (10 turns/day + 10 graphics/month)
   comes out to ~US$8-10/month per role against a ~US$25 price; what breaks
   it is heavy usage (30 heavy turns/day ≈ US$23). The old 9x gap was a
   MEASUREMENT problem, not an economics one. Only the pricing decision is
   left (Luis).
1b. The "Skipping secondary profile ... port-binding api_server" warning on
   every boot with multiplex is benign (measured: `/p/<role>/` answers the
   same either way) but noisy; see if the dist can avoid declaring
   api_server on the profile.
4. Mr.Wobble is still pre-pivot; migrate it whenever Luis wants. Merging to
   main is Luis's call.
5. Orphaned engine sessions (one per room turn) pile up in each profile — we
   decided to leave them and just note it.
6. Old agents (east, etc.): confirm they aren't client agents and delete
   them.
7. Assistant role + expand the capabilities catalog (6 today, ~30 possible;
   add `vision` and `code_execution` first).
8. **Measure the curator in the lab instead of inferring it.**
   `config.base.yaml` already turns off `curator.enabled`, because on an
   agent with a team the ONLY copy of a specialist skill lives in
   `data/profiles/<role>/skills/` — which belongs to the agent, is writable,
   and looks to the engine like "agent-created", i.e. archivable after 90
   days unused (`engine-knobs.md:370-388`). The knob is belt and suspenders;
   the measurement is still missing, and it's two questions: (a) does
   `is_curation_eligible` return True for a skill that `hermes profile
   install` put there?, and (b) can `skill_manage` overwrite a profile's
   skill, or does it hit something? Both get answered in the lab, with the
   four roles already hired.
9. **The lab's four roles are carrying an old `transcribe` skill inside
   support.** They were hired with `role.json` v0.1.0, which declared it;
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

## Luis's ground rules

Code AND comments **in English** (client-facing copy in rioplatense
Spanish). **No protective programming** — let it break hard. The whole pivot
lives in the worktree in case of rollback. In design ping-pong: keep answers
short.
