# COMPACT — project status (2026-08-05, early morning)

Distilled context for humans and subagents. **Source of truth for VERIFIED
facts.** Anything that doesn't say "verified" should be treated as a
hypothesis.

## The four repos

| Repo | What it is |
|---|---|
| `tuagente.uy` | public landing + **client portal** (`app/app/`) + `docs/` |
| `hermes-kit` | **what gets installed on each client's agent** (the product) |
| `agente-pdelabs` | La Mano — pdelabs' agent, **client 0** and fixture |
| `pdelabs-landing` | pdelabs.com, unrelated to this |

**PRINCIPLE ZERO:** the portal serves ANY Hermes agent of ANY client.
Nothing client-specific goes into the code or into fixed copy.

## Architecture

Static portal (Next 14) → two services **on the client's agent**:
- **`:8642`** Hermes gateway (native): chat, sessions, jobs.
- **`:8643`** `portal_adapter.py` (our sidecar, lives in the kit): tickets,
  approvals, artifacts, files, activity, usage, capabilities, uploads, and
  the **chat stream proxy** (the gateway serves it without CORS and the
  browser drops it). Today at **v0.20.0**.

Auth: bearer with `API_SERVER_KEY` via magic link `#endpoint=&adapter=&key=`.
`app/app/lib/agent.ts` is the portal's ONLY network entry point.

## The portal (11 tabs)

Inicio · Chat · Pipeline · Aprobaciones · Artefactos · Tareas · Actividad ·
Archivos · Uso · **Conexiones** · Capacidades. Each with its own welcome
screen (`app/app/lib/intros/`). UI kit with no shadows, hairline borders,
lucide icons, zero emojis.

What it can do: chat with rich markdown (code with highlighting, KaTeX,
mermaid, sanitized HTML, artifacts in a sandboxed iframe), attach files,
reference tickets with `#` and files with `@`, create/comment/change the
status of tickets, **correct a draft and approve it**, see the real prompt
behind each scheduled task with its history, and cost in USD by channel and
by model.

**Everything that opens has a URL** (12/8): tab and detail — a task, a
deliverable, a folder, a conversation, an approval request. They travel as
a query on top of the tab (`/app/pipeline?task=t_ab12`,
`/app/files?file=entregables/informe.md`) and NOT as path segments: in the
build every tab is `○ (Static)` and the only `ƒ` is `/app/flows/[slug]`; a
segment per detail would tie the portal to needing a server. Not via hash
either: that's where the credential travels. The full contract — what the
agent can cite, with **which row was tested and which wasn't** — is in
`docs/portal-routes.md`: careful about taking it as fully verified, the
first version of that table said "every row is tested" and three rows were
lying.

Also, the magic link no longer leaves the key in the address bar: it gets
wiped from the hash as soon as it's saved.

A comment from the portal **wakes the agent up** (the adapter sends it the
ticket's card with dates) and **its reply gets published as a comment on
that same ticket**. All the notifications use a single session, hidden from
the chat.

## The kit

`new-agent.sh` (creates the client's repo: compose, `config.yaml` with the
kanban recipe and the expensive toolsets turned off, draft SOUL, skills,
adapter) · `install.sh` (installs/updates; `--diff` against drift) ·
`adapter/` · `skills/` (artifact, deliverable, approval) · `connections/`
(curated catalog + Google runbook) · `soul/` (5 blocks with placeholders) ·
`onboarding/company-brief.md` · `tools/portal-check.py` (**0 failures or it
doesn't ship**) and `tools/agent-check.py` (offline, before powering on:
frontmatter, SOUL with no gaps, the classic config oversights).

## Verified facts about Hermes (MIT, Nous Research)

- **Skills:** they auto-discover (a manifest's mtime+size triggers
  reindexing, no commands or restart needed) but it's **slow** (~20 min
  observed). Every `SKILL.md` **needs frontmatter with `name` and
  `description`**: without it, it gets indexed with an empty description and
  the agent never uses it.
- **Sticky blocking:** a ticket returns on its own to `ready` unless its
  last event is a **typed** `blocked`. Demonstrated with a control: one
  created with `--initial-status blocked` moved to `ready` in ~75 s; one
  blocked via the action held. **An approval request created "blocked"
  reads as approved.** The native tools don't expose the initial status:
  that path isn't reachable.
- **Toolsets:** the `kanban` toolset (12 tools) needs **two** keys in
  `config.yaml`: `toolsets: [kanban]` opens the `check_fn`, and
  `platform_toolsets` with `kanban` per platform gets past the filter the
  gateway uses to assemble the session. With only one, zero kanban tools.
  `kanban` isn't in `CONFIGURABLE_TOOLSETS`, so it can't be requested the
  normal way. Verified on 4/8 with a control on a disposable agent; recipe
  and reproduction in `hermes-kit/notes/native-kanban.md`. **Our plugin got
  deleted**: all it did was declare `kanban` in `provides_tools` and
  unblock it as a side effect.
- **Context:** see the measurement below. Part of the system prompt is
  Hermes talking about itself (it tells the model it's "Hermes Agent by
  Nous Research" and that supporting the runtime is part of its job); we
  don't control that.
- **Crons:** they're created via CLI, not yaml. A task created from a
  portal session delivers to that session, **which can't receive
  messages**: it runs fine and nothing arrives, with no warning.
- **Boards:** the default is `kanban.db`; the rest are at
  `kanban/boards/<slug>/kanban.db` with a `board.json` that already carries
  `project_id`. The adapter lists them and accepts `?board=`; writes go to
  the default.

## Connections (new, 5/8)

The catalog lives in the kit (`connections/catalog.json`) and gets
installed on every agent; the adapter computes status **by presence** of
credentials, files, or plugins and never returns a stored value. Three
states: connected / disconnected / **blocked** (= something of OURS is
missing, typically tuagente's OAuth app).

Nothing gets connected or pasted from the portal: it's **requested**, and
that creates a ticket. Google Workspace (Sheets, Drive, Calendar, Docs) is
already supported by the engine; what's missing is creating a single
"Desktop app"-type OAuth app of ours and reusing it across every client —
see `hermes-kit/connections/google-workspace.md`.

## Context budget, measured (5/8, new agent)

```
system prompt   39.6 KB   (of that, ~11 KB are the kit's SOUL blocks)
tool schemas    67.6 KB   → 60.0 KB with tts and delegation turned off
```

The schemas weigh almost double the entire system prompt: **the lever is
`agent.disabled_toolsets`, not rewriting prose.** kanban alone is only 19.8 KB.

## Verified endpoints

**:8642** — `POST /v1/chat/completions` (OpenAI-style stream) ·
`GET/POST /api/sessions` · `PATCH`/`DELETE /api/sessions/{id}` ·
`POST /api/sessions/{id}/chat/stream` (body `{message}` singular, **native
SSE**, incompatible with the OpenAI parser) ·
`GET /api/jobs?include_disabled=true` (without that it hides the paused
ones!) · `POST /api/jobs/{id}/pause|resume|run` · `GET /health`.

**:8643** — `manifest` · `tickets` (+`/{id}`, POST create, comment, status) ·
`approvals` (+approve with optional `{correction}`; reject with `{reason}`
and optional `{final}`, which also CLOSES the ticket) · `artifacts`
(+`/{id}`, DELETE) · `activity` · `usage` (what OpenRouter actually billed
the agent's key; this is `/portal/uso` under its new English name,
`/portal/usage` — not to be confused with an earlier, unrelated
`/portal/usage` v1 that undercounted by 9x and was retired in favor of
`/portal/uso` back then; the current endpoint is that same `uso`
implementation, just renamed, not the old broken one coming back) ·
`files` (+`/{path}`, always `text/plain`) · `crons/{id}` · `capabilities` ·
`boards` · `POST upload` · `POST sessions/{id}/chat/stream` (proxy) ·
`plugins` (adapter 0.41+: the kit plugins installed at `/opt/plugins`, id,
version, description, system, requires, which surfaces are present and the
tab object verbatim, sorted by id. `/opt/plugins` ships as of the phase-3b
installer: `install.sh` writes `<agent>/plugins/<id>/` and the compose mounts
it `:ro`, so a freshly installed agent answers with its computed set — six on
a solo agent, plus whatever its hired roles declare. Verified over a real
socket against a freshly installed fixture; not yet against a live agent,
because no live agent has been reinstalled since. One installed BEFORE that
answers `[]`, which is the tested behaviour and not an outage — and
`agent-check.py` reports it as pending).

The manifest's `portal_plugin` is `adapter_version` as of adapter 0.41.0 —
same `adapter-<semver>` value, a name that is not the third thing here called
a plugin. `portal-check.py` requires it, so update an agent's adapter before
running the check against it.

## Hard lessons (do NOT repeat)

0. **Verify the client's path, not the piece you just built.** Every gap
   today showed up when Luis pushed, and every one of them died with a
   single command. Before saying "done": run the whole flow from the state
   a client would actually find it in, and separate what's verified from
   what's inferred.
1. **kanban.db: never write SQL to it.** And to read it, `PRAGMA
   query_only`, NOT `mode=ro`: in WAL, a read-only connection creates the
   `-shm` file without write permission and **breaks everyone else who wants
   to write** (it used to take down Hermes' own dashboard at the pace of
   its polling).
2. **The agent's memories override its tools.** It had only ever written
   down the terminal recipe and kept using it even once native tools were
   available. Giving it a new tool includes checking what it has memorized.
3. **Telegram: never diagnose with `getUpdates` from outside** — there's a
   single long-poll per bot: the probe cuts the agent's own connection and
   manufactures the exact failure it's trying to measure. Verify passively
   with `docker logs`.
4. `docker exec` with a heredoc: always `-i`. Files to the browser: always
   `text/plain`. Never `git add -A` while subagents are writing.
5. `hermes kanban`: `--flag=value` options and `--` before positionals.
6. **A ticket has ONE unblock, and it's not the portal's to spend.** On the
   second re-block for the same cause, the engine sends it to `triage` —
   where Approve answers `409` — or splits it with the auto-decomposer
   using the **old body**. That's why rejecting is just a comment signed
   `cliente` and doesn't touch the status: the `unblock` gets spent once,
   on approval. See `docs/PENDING.md`.
7. **What's signed `cliente` wasn't always written by the client.**
   Rejecting and approving-with-correction leave a machine prompt on the
   ticket signed as if it were the client's own ("RECHAZADO POR TU CLIENTE.
   No hagas lo que pediste aprobar…"), and the portal used to show it
   verbatim above a "Vos." Every comment goes through `readComment`
   (`lib/agent.ts`) before it reaches the screen.
7b. **And that filter is applied by LOOKING AT WHO SIGNED IT, not the
   prefix.** Recognizing it by text alone turned the prefix into a light
   switch: a comment from the AGENT that happened to start with "RECHAZADO
   POR TU CLIENTE." came out as «Tu agente · Lo rechazaste» and **with not
   a word of text** — because a rejection shows the reason block, which a
   comment of its own doesn't have. In other words, a channel through which
   the model can hide anything it writes from the screen. Rule: machine
   formats apply only to what the client signs; everything else is shown
   raw. And **no path can return empty**: if the format doesn't match in
   full (a rejection with no reason block), the raw text is shown. Measured
   against the lab agent with comments seeded via CLI, 12/8.
8. **The "internal steps" toggle is for noise, not for bad news.**
   `block_loop_detected` and `decomposed` sound like plumbing and are the
   only two signals that the client's request broke: they're always
   visible. Behind the toggle goes only what doesn't change any decision
   (heartbeats, startups, waits, assignments).
9. **A URL id never gets humanized to pass for a name.**
   `?connection=noexiste-xyz` used to announce "Venís a conectar noexiste
   xyz": the portal inventing a product for the client. Existence check
   first, and if it's not there, `StaleLinkNotice` + the list.

## Aesthetics
M3 expressive from `tailwind.config.ts`: primary #5B4BE8, surface #FBFAFF,
ink #14131F, tonal colors c-violet/c-green/c-coral/c-amber, Jakarta. No
shadows.

## The agentito (7-8/8)
A Rive character in `public/agentito.riv` (21 KB), 100% authored via MCP
(`rivemcp`). The "Agentito" state machine exposes 13 inputs: `miradaX`/
`miradaY` (pupils), `gesto` (which object it pulls out), the `festejar` and
`matear` triggers, and 8 trait axes — tone, antenna, accessory, pupil,
mouth, skin, suit, brows — that give 31 thousand combinations. The client
names it and rolls its look during onboarding.

**The working gestures are pose + gaze** (`gesto` 1-5): thinking is tilting
the head and arching ONE brow (drawn separately, `cejaArco`: it covers the
look's own brows, so it shows up even on agentitos that don't have any);
reading pulls out a book and turns the page; writing, a notepad and a pencil
that scribbles; searching, a magnifying glass sweeping across the face;
doing, a wrench turning a screw (the mouth in a C is a real `boolean_shapes`,
with a hole, so you can see the nut from inside). They're looping animations
inside the `.riv`, each in its own layer (14), each one turning off the
others' objects via opacity; the state machine cross-fades over 220 ms. The
gaze is still driven by code and points at wherever the action is. It used
to be just the pupils, and at 28px that didn't read — the user saw them and
couldn't tell any of them apart. Only "thinking" touches the brows; for the
rest, the object carries the expression. Discarded for being ugly: the
three-dot bubble (it looked like a chat's "typing…"), gears, and **the
hand** — three versions were tried (knuckles, a fist of bars, a mitten) and
none landed: the agentito has no arms, so any hand ends up floating, and at
28px it's just a smudge.

**The naming lives on the agent, not in the browser** (`POST
/portal/identity`, adapter 0.26). The adapter stores it at
`/opt/data/portal_identity.json`, reports it in the manifest (`agent`,
`look`, `named`), writes the name into a bounded block of `SOUL.md` —
between `<!-- portal:identity -->` markers, without touching the onboarding
prose — so the agent INTRODUCES ITSELF that way, and pushes a `setMyName`
to the Telegram bot. Everything outside the agent is best-effort: if
Telegram rate-limits or the SOUL is missing, the naming still went through.
localStorage acts as a cache: from another machine the portal learns from
the agent and doesn't ask for the name again. The bot's **photo** can't be
set via API — `@BotFather` `/setuserpic`, by hand.

**Where it shows up, and nowhere else**: onboarding (large, animated),
sidebar logo (small, SVG), login (SVG), Inicio (small, animated: it brews
mate if nothing's pending, celebrates when a deliverable shows up, looks at
the badge if something's waiting on your ok), and the disconnected screen
(SVG, asleep). It does NOT float around, isn't in every empty state, and
isn't in the module intros.

`lib/agentito.tsx` is where the look lives: types, axes, localStorage, and
`AgentitoAvatar`, the same drawing as a static SVG with no runtime. The Rive
runtime (`@rive-app/react-canvas-lite`, wasm ~330 KB served from `/public`)
only loads via `next/dynamic`, in onboarding and in Inicio.

### The idleness ladder (12/8)
Two new animations, both about the USER'S BOREDOM, not the agent's state —
that's why the clock lives inside `AgentitoRive` and not in the `status`
prop: the portal knows if there's anything pending, not whether you wandered
off to do something else. It only runs with `status === "tranquilo"`. Mate
(~20 s, already existed) → **yawn** (`bostezar` trigger, 1½ min, repeats) →
**the phone** (`gesto = 10`, 4 min): it pulls out the phone FACE DOWN — the
camera sees its back —, the screen washes its face with a beam of four
radial-gradient ellipses, and the eyes read along with the scroll's tugs.

**The click is the payoff.** Moving the mouse does NOT save the phone gesture
(it only reschedules the clock): if `mousemove` cut the gesture short, the
save would never be seen, because you always move the mouse BEFORE
clicking. Only deliberate actions wake it up — click, keypress, scroll,
touch — and there the `.riv` fires `guardarCelu` on its own, via the
condition `gesto != 10`. If work arrives while it's distracted, the
requested gesture wins: it saves the phone and gets on with it.

Shows up in Inicio (64-72 px) and in the chat's welcome screen (144 px). In
the chat's 28px avatar it can't show up: there, the state is always a
working gesture.

The other eight that were tried and did NOT make it are in
`scratchpad/agentito/drafts/` from the 12/8 session (stretching, nodding
off, playing it cool, handing off, powered down, worried, listening,
talking), each with its own `.riv` and gif.

### Verified traps
1. **Z-order runs backward**: a group's children are listed FRONT to back.
   An `add_*` with `group=` lands at the BACK (behind the belly, invisible).
   You have to pull it out to the root and put it back with
   `place:"front"`. Inside the group, though, the order is creation order:
   whatever gets added FIRST stays in front. When drawing an object, add
   front-to-back (the lines before the pages of the book).
2. **The linter lies about blend states**: `validate_riv_structural` flags
   `"transition-target-range"` on both gaze layers from day one. It's a
   false positive: in the real runtime the gaze works fine. Trust
   `export_riv --dryRun` + the browser, not the linter.
3. **Don't eyeball positions**: to calibrate the bulb in the mouth,
   positions were measured by reading pixels off the canvas
   (`scratchpad/rive-test/probe.js`). It showed the math was right and the
   problem was the z-order.
4. **Never write to a Rive input from an effect's cleanup.** `useRive` gets
   declared BEFORE your effects, so on unmount its cleanup runs first and
   destroys the instance: writing afterward throws "Cannot set properties
   of null" and takes down the whole screen (Next's white screen). Happened
   with the chat gestures, at the end of every response. The cleanup only
   cancels the rAF; per-frame writes go through try/catch.
5. **`rivemcp` has an export quota** (3, seems to renew daily). Iterate on
   `save_session` — which writes a `.riv` that works — and spend the export
   only on the file that gets committed. If the quota runs out, the
   `save_session` checkpoint works just as well: the gestures' `.riv` was
   verified in the browser and copied to `public/` from there.
6. **Whatever a gesture moves, someone has to put back.** Rive doesn't
   reset: a property that only your animation writes stays pinned at its
   last value once the gesture ends. Happened with the body's tilt while
   thinking: the agentito stayed crooked forever. Whatever a layer further
   down writes fixes itself (the brows' opacity gets set by the look's
   layer every frame); everything else has to be returned by hand.
   `cuerpo.rotation` resets in `sinMate`, not in `sinGesto`: the mate layer
   runs BEFORE it, so from `sinGesto` we were stomping on the mate
   gesture's tilt. Proven by `scratchpad/drive-reset.js`, which toggles
   every gesture on and off and measures the tip of the antenna.
7. **Trim path breaks if you touch the geometry afterward.** For the
   curved brow, ellipse + stroke + `set_trim_path` was tried: the first arc
   comes out fine, but changing `width`/`height`/`rotation` shatters it into
   little pieces and reapplying the trim doesn't fix it. It ended up being
   three rounded bars forming the arc — ugly to write, but looks the same
   and doesn't break.
8. **`move_object` preserves APPEARANCE, and that includes opacity.**
   Pulling a child out of an invisible group to the root writes opacity 0
   onto it so it stays hidden; putting it back into the group, that opacity
   0 STAYS and the object never shows up again. Happened with the pencil:
   it got moved while `libreta` was at 0 and it disappeared, even though the
   drawing order was right. After moving something inside a group that's
   turned off, check its opacity with `get_object_info`.
9. **An object's STATIC opacity is what shows on the first frame, and
   `sinGesto` doesn't always get there in time.** `herramienta` had been at
   static 1 since day one and it went unnoticed because `sinGesto` turns it
   off on entry; once the phone layer was added, that initial pass stopped
   happening and the wrench appeared floating at rest, in Inicio and in
   chat. The fix isn't touching the state machine: it's making the file's
   rest state the REAL rest state, i.e. static opacity 0 on everything
   `sinGesto` turns off (`libro`, `libreta`, `lupa`, `herramienta`,
   `cejaArco`, `celu`, `luzCelu`). Every gesture turns its own on
   explicitly at frame 0, so setting the statics to 0 breaks nothing.
   Caught by watching the first frame in the browser, not the editor or the
   gif.
10. **`preview_riv_gif` with `stateMachine` LIES about the rest state.** It
   shows the wrench that the real runtime doesn't show. Verified: the
   `save_session` checkpoint is byte-identical to the production `.riv` and
   still renders differently. For the initial state, the browser is the
   only source of truth.
11. **`describe_scene` returns EVERYTHING** — every keyframe with its
   frame, value, interpolation, and the four cubic control points, plus the
   full state-machine graph with conditions and flags. That's what turns
   "merge two animations" into an exact transplant instead of an eyeballed
   redraw. `includeKeyframes:false` gives the structural view, which is
   better for comparing wiring.
12. **`set_gradient_fill` ADDS a fill, it doesn't replace it.** Three calls
   in a row leave three gradients stacked; the symptom was a light washing
   the pupils out to gray. To retouch a gradient you have to delete the
   shape and redo it. And **`set_feather` gets applied but the render
   ignores it**: soft edges come from the gradient, not from the feather.
13. **A linear gradient leaves a hard edge on the sides.** A light that
   only falls off lengthwise shows two straight lines where the shape ends.
   What leaves no visible edge at all is a RADIAL gradient that hits alpha
   0 right at the geometry's edge — if the shape ends where alpha is
   already 0, it can't give itself away — and giving it direction by
   scaling the circle into an ellipse.

### Working in parallel with rivemcp
The MCP session is a SINGLE one, in memory: two agents editing at the same
time step on each other's file. For the ten animations from 12/8,
`scratchpad/agentito/rive-driver.mjs` was used, which spins up a separate
`rivemcp` server per agent over a Unix socket (`start` / `call <tool>
'<json>'` / `stop`). Two details that cost time: the socket has to live in
`tmpdir` with a short name (macOS Unix sockets max out at ~104 characters
and the scratchpad path goes over), and **`call` truncates stdout if you
pipe it** — it calls `process.exit` right after the `console.log` — so you
have to redirect to a file instead.
