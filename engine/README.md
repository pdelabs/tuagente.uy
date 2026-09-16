# engine — the tuagente.uy agent engine

The engine every client's agent runs on: Pydantic AI 2.43 behind the portal
of `app/app/`. It replaces Hermes (decided 2026-09-14, `docs/PENDING.md`);
how it was proven is in `docs/engine-plan.md` and `docs/engine-verdict.md`.
This file is how to run it.

One FastAPI app serves both of the portal's bases — the gateway (`/api/*`) and
the adapter (`/portal/*`) — and the compose publishes it on `127.0.0.1:8642`
and `127.0.0.1:8643` so the magic link can point both at the same container.

## Run it

```bash
cd engine
cp secrets.env.example secrets.env    # OPENROUTER_API_KEY + API_SERVER_KEY
docker compose up --build -d
docker compose logs -f
```

The container runs as uid 10000 (`docker exec tuagente-core id`), and `state/`
and `workspace/` are bind mounts it has to write. They were made writable with
`chmod 777 state workspace` on the host — enough on Docker Desktop, where the
bind mount does not carry the host's ownership; on a Linux host use
`sudo chown -R 10000:10000 state workspace` instead.

What lives where:

| Path | What |
|---|---|
| `state/core.db` | SQLite (WAL): sessions, messages, history, approvals, events |
| `state/identity.json` | what the client changed from the portal; wins over the seed |
| `workspace/` | the agent's only writable ground: `entrada/` in, `entregables/` out, `outbox/` what a sensitive tool did, `memoria/` what it remembers about the client, `flows/` what runs on its own, `imagenes/` what it drew, `posteos/` the finished posts, `marca/` the brand it writes with — `brand.md` and the fixed assets `place_image` pastes onto a slide |
| `agent/SOUL.md` | the client section + the `core:base` block, mounted read-only |
| `/opt/kit/plugins` | `kit/plugins`, read-only. `CORE_PLUGINS` picks which load, and each one's `core/` surface is what it adds to this engine |


## Instances: one client's agent

`docker-compose.yml` is the LAB: the demo agent plus the trace viewer.
`instance.yml` is the shape every real agent runs in, one container and one
folder:

```
engine/instances/<name>/
  instance.env      INSTANCE=<name>, PORT_GATEWAY, PORT_ADAPTER, CORE_OTEL_* (committed)
  secrets.env       API_SERVER_KEY, OPENROUTER_API_KEY (gitignored)
  agent/            SOUL.md, identity.json (committed: the agent's configuration)
  workspace/        the agent's files, e.g. marca/brand.md (gitignored)
  state/            core.db (gitignored)
```

```bash
docker compose -p <name> -f engine/instance.yml \
    --env-file engine/instances/<name>/instance.env up -d --build
```

The container is `tuagente-<name>`; the magic link points `endpoint` and
`adapter` at the two ports. Our own agent is `instances/tuagente/` on
8652/8653 (`docs/own-agent-plan.md`).

## The magic link

```
http://localhost:8090/app#endpoint=http://127.0.0.1:8642&adapter=http://127.0.0.1:8643&key=<API_SERVER_KEY>
```

`npx next start -p 8090` from the repo root serves the portal. The key is in
`secrets.env`; the link is the only place it travels.

The seeded identity has `contact.channel: "none"`, which the portal reads as
"offer the notification step again". If the walkthrough should skip it, set
`"contact": {"channel": "email", "value": "…"}` in `agent/identity.json` (or
`state/identity.json`, which wins) before opening the link.

## Plugins

**A mechanism is a plugin of the kit, not a module of this engine** — unless it
is the clock, which is the engine's own (see **Flows** below). The six this
engine runs by default —
`CORE_PLUGINS=kanban,approval,deliverable,memory,image,social` — are the kit's
own plugins, in dependency order (`requires.plugins` in each manifest says who
must come first), and each one declares `"surfaces": {"core": "core/"}` in
its `plugin.json`: a directory holding `plugin.py` and, when the mechanism
needs words, an `instructions.md`. `core/plugins.py` imports that file and
calls `register(engine)`, in `CORE_PLUGINS` order.

```
engine/                          the engine, and nothing about any mechanism
  core/config.py                   env -> settings; the base MODULES
  core/plugins.py                  load the plugins, hand each one the engine
  core/agent.py                    model, instructions, toolsets, capabilities
  core/session.py                  a turn: stream, persist, events. BEFORE_PERSIST,
                                   DEFERRED_HANDLER
  core/delegation.py               a delegation as the client sees it (engine)
  core/compaction.py               summarize the history away (engine)
  core/turn_usage.py               what the turn cost (engine)
  core/tracing.py                  spans to Phoenix (engine)
  core/flows.py                    a flow is a file: the model, read/write, next run
  core/scheduler.py                the clock: the 30 s loop, a run, the rows
  core/promises.py                 what it SAID it left running, against the flows
  core/tools/workspace.py          bash, read_file, write_file, list_files
  core/tools/skills.py             the SKILL.md index + skill_view
  core/tools/flows.py              create_flow, set_flow_status
  core/db.py, server/*.py          storage, the two bases, the SSE dialects
  server/flows.py                  /portal/flows*, /api/jobs*

kit/plugins/kanban/core/    the board: board_store.py (the tickets, the
                                   five statuses, the dedupe key, closed_at),
                                   board_routes.py (/portal/tickets*),
                                   board_tools.py (create_ticket,
                                   update_ticket, ungated), instructions.md
kit/plugins/approval/core/  the gate: sensitive.py (the gated toolset),
                                   store.py (the row), render.py (what she
                                   reads), routes.py (/portal/approvals*; the
                                   THREAD is read through the board's route),
                                   instructions.md, and SKILLS = []
kit/plugins/deliverable/core/  nothing to register: instructions.md
kit/plugins/memory/core/    the notebook: plugin.py (the capability, the
                                   rule it carries as `guidance`, and the two
                                   factories it provides — a notebook of its
                                   own, and a read of the client's),
                                   injection.py (the harness's Memory
                                   rendered into the INSTRUCTIONS instead of
                                   appended to the last message),
                                   extraction.py (the after_run pass that
                                   writes what the client said in passing).
                                   No instructions.md
kit/plugins/image/core/     one tool, on nobody: plugin.py PROVIDES
                                   Pydantic AI's ImageGeneration capability,
                                   generate.py is OpenRouter, the PNG and the
                                   picture back. No instructions.md
kit/plugins/social/core/    the post: creator.py (the SUB-AGENT that
                                   makes it), posts.py (save_post, the reader
                                   and the /portal/posts* routes),
                                   creator.md, instructions.md, and
                                   skills/post/SKILL.md, the craft
```

`register(engine)` gets an object with eight verbs that ADD something and no
more:

| verb | what it adds |
|---|---|
| `engine.toolset(ts)` | a toolset the agent gets, gate and all (`EXTRA_TOOLSETS`) |
| `engine.before_persist(fn)` | `(session_id, text) -> text`, run before the answer is persisted |
| `engine.capability(cap)` | an `AbstractCapability` for the Agent (`CAPABILITIES`) |
| `engine.router(router)` | an `APIRouter`, included after the engine's own and before the 404 catch-all |
| `engine.module(name, value)` | what the portal draws; `value` may be a callable, asked when the manifest is read |
| `engine.instructions(text)` | prose into the system prompt |
| `engine.deferred(fn)` | the ONE callable that answers a run stopped at a gated tool |
| `engine.subagent(sub, label)` | a delegate the face can hand work to, and the Spanish name the client reads it under |

plus five that hand a plugin what it needs to BUILD one, and three attributes
that make its `Agent(...)` fit this engine — see **Sub-agents** below:

| verb | what it gives back |
|---|---|
| `engine.tools(*names)` | some of the engine's own tools, by name, as one filtered toolset |
| `engine.identity` | what every agent of this client shares — the SOUL's opening and the `core:base` block. A string, so it renders FIRST |
| `engine.today` | the date line, a callable, so it renders LAST |
| `engine.provide(name, obj)` | an object for the plugins that load after this one |
| `engine.use(name)` | one of those, by name |
| `engine.model` · `engine.model_settings` · `engine.Deps` | what a plugin's `Agent(...)` needs to fit |

Two things are not verbs. **Skills** load from `surfaces.skills` as on any
agent, unless the plugin's module defines `SKILLS` — a list that overrides the
manifest here, and `[]` means it brings none to this engine (`approval`'s
SKILL.md is Hermes-kanban prose). And **`instructions.md`** is read by the
loader, not by the plugin: it goes into the prompt before anything `register()`
adds.

The instructions a run is built from, in order:

```
agent/SOUL.md  +  each enabled plugin's instructions.md  +  the skills index  +  the date line
```

A CAPABILITY'S OWN INSTRUCTIONS COME BEFORE ALL OF THAT, and that is Pydantic
AI's ordering, not ours: the memory guidance, the notebook and the sub-agent
listing are rendered by the capabilities that own them and land at the head of
the prompt, because `InstructionPart.sorted` puts every LITERAL instruction
before every CALLABLE one and the face's whole prompt is one callable. The date
line stays last on purpose — it is the one line that changes by itself, and
everything above it is a stable prefix the provider's cache keeps, which is
nearly all of this engine's conversational saving.

**That sorting is the whole reason a delegate's prompt is a LIST** (see
**Sub-agents**): `engine.identity` is a string and comes first, `engine.today`
is a callable and comes last, and everything the plugin wrote sits between
them. Handing `identity` over as a callable — what it was until 14/09 — put the
SOUL at the END of the creator's prompt, under the memory guidance.

**Where a rule lives is decided by what can enforce it.** In CODE if code can
check it — the gate is on the tool, so asking is not something the model can
forget. In a TOOL'S DESCRIPTION if it is about using that tool — what a request
has to explain is in `send_email`'s docstring and in `ApprovalNote`'s fields. In
the SOUL only if it is about who the agent is: its name, its client, its tone,
its scope, and the list of what THIS company does not do without permission.
Nothing about tools, folders, skills or mechanisms goes in the SOUL. Everything
else is prose about a mechanism, and prose about a mechanism ships WITH the
mechanism — so it is in the prompt only where that plugin is enabled, and when
the mechanism changes there is one file to change. The engine's own mechanisms
follow the same rule from `core/agent.py`: the three lines about flows are
there, next to the tools that make them true.

**Images.** `image` brings one tool and registers it on nobody: it PROVIDES
Pydantic AI's `ImageGeneration` capability, and today the only agent holding it
is the social plugin's creator. `generate_image(prompt, format)` asks
OpenRouter for a SHAPE (`feed` 3:4, `square` 1:1, `story` 9:16 — the provider
does not serve 4:5), writes the picture into `workspace/imagenes/` as
`<YYYY-MM-DD>-<n>.<ext>` with the extension the provider's own `media_type`
says, and hands the model back the line plus the picture itself, as an image.

**And beside every picture it writes its BRIEF**: the same stem with a `.json`
suffix — `imagenes/2026-09-15-1.png` and `imagenes/2026-09-15-1.json` —
carrying `{"prompt", "format", "model", "created_at"}`. It is a convention and
not an internal detail, because the social plugin reads it: `save_post` moves
the brief into the post next to the slide it made and takes it out of
`imagenes/`, so what a picture was made from travels with the picture and
nothing has to remember a path. A picture with no sidecar breaks `save_post`
loudly rather than saving a post whose slides nobody can fix afterwards.

**Posts.** `social` is the plugin that turns the engine into something that
produces work a client looks at, and it is the first one a client BUYS
(`social-package`, which installs it and `image`). It brings one tool,
`save_post` — on its own sub-agent and not on the face, see **Sub-agents** —
and the tool owns the format: the post lands in
`workspace/posteos/<YYYY-MM-DD>-<slug>/` as `post.json` (id, date, format,
caption, alt, alts, hashtags, images, prompts, `flow` when the clock started
the run),
`caption.md` — the caption, a blank line, the hashtags — and `01.png`, `02.png`
…, MOVED out of `imagenes/` so there is one copy of each picture and it is
inside the post. The folder is the check: a second post with the same slug on
the same day is refused, and `replace=True` is the only way past it; another
slug is another post. Prose never says any of that; the tool does, and what
the model cannot be given by code is in `skills/post/SKILL.md` — read
`marca/brand.md` first, the caption formula, and the five-point checklist every
generated slide has to pass before it counts.

**The day's post is a CAROUSEL**, 3 to 5 slides: `01.png` is the hook, the ones
in the middle carry one idea of the caption each in their own words, the last
one is the close with the single ask, and `alts` carries one description per
slide in the same order (`alt` stays the first one's, which is the field the
portal's `Post` reads). The format that says so is `carousel` and it lives in
`save_post` ALONE: a slide is 4:5, which is what `generate_image`'s `feed`
already asks for, so the skill tells the creator to generate every slide as
`feed` and the image plugin's vocabulary stays the three shapes a picture is
cut to. What holds the slides together is not code either — the brief of each
one repeats the shared visual system word for word, because the model never
sees the slide it drew a minute ago.

**THE BRAND'S OWN PICTURES ARE PASTED ON BY CODE, NEVER DRAWN.**
`workspace/marca/` holds the brand: `brand.md`, the file the creator reads
before writing a word, and the fixed assets next to it — a character, an
isologo, whatever that client owns. Asked for one of those in a brief, an image
model draws a different animal every time and misspells the logo, which is why
the brand block forbids them and why `place_image(image, asset, corner,
size=0.28, margin=0.06)` exists: it opens the generated slide, resizes the
asset to `size` × the slide's width keeping its aspect, pastes it WITH ITS OWN
ALPHA AS THE MASK at that corner with `margin` × width of air, and writes a NEW
picture in `imagenes/` — with a sidecar carrying the slide's own brief plus
`[place_image: <asset> at <corner>, size <size>]` and `model` «place_image».
The bare slide stays: the creator looks at both and saves the one it wants.
The folder's listing is the vocabulary — an asset that is not a file in
`marca/` comes back as the list of the ones that are — and the tool answers the
same two things `generate_image` does, the line and the picture, because the
composite has to go through the five-point checklist like anything else. It is
the social plugin's `core/stamp.py`, a second toolset on the creator: it is not
about the post, it is about a picture before there is a post.

```bash
python3 engine/tests/test_place.py     # free, a second, no model
```

Six claims inside the container: the composite landed and the bare slide
stayed, it is the slide's own size, the asset is at the corner asked for with
its transparent quadrant still showing the background (a paste without the mask
puts a cut-out in a black box), the sidecar carries the brief plus the
placement line, the tool answers the picture and not only a path, and an asset
that is not in `marca/` comes back as a `ModelRetry` listing the ones that are.

**WORDS ARE CHANGED WITH `update_caption(post_id, caption, hashtags=None,
alts=None)`, AND A SAVE NEVER DESTROYS.** Both come from the same morning
(2026-09-15, our own agent): asked for a better caption, the creator had no
tool for words, so it called `save_post(replace=True)` with the post's own
pictures as `images` — `replace` deleted the folder, the first `brief_of` died
on a sidecar that had been inside it, and four finished slides were gone. Three
things changed. `update_caption` rewrites the caption, and the hashtags and
alts when they are given, rewrites `caption.md` from the same two fields,
touches no picture and writes `post.updated`; it refuses a post that is already
published, with the permalink, because what went out is not rewritten from
here. `incoming()` refuses any path under `posteos/`, naming the two tools that
do what such a call is reaching for. And `save_post` builds the new post in a
folder of its own (`.armando-<id>`, which the listing skips) and swaps it in
with two renames at the end, so a failure halfway leaves the post that was
there byte for byte and the half-built one on disk.

```bash
python3 engine/tests/test_post_tools.py   # free, a second, no model
```

Three claims inside the container, all about what is left on disk: the picture
of a saved post is refused as a source and the post is untouched; a save that
dies on a missing sidecar leaves the old post whole and the tab listing it
once; and `update_caption` changes the words, keeps the pictures and the
briefs, and refuses both an unknown post and a published one.

**ONE SLIDE CAN BE FIXED WITHOUT TOUCHING THE OTHERS**, and that is what the
briefs are for. `post.json` carries `prompts`, parallel to `images` and `alts`:
the brief each slide was generated from, moved in from `imagenes/` with the
picture. The client asks for the fix in the Posts tab — «Arreglar esta imagen»
under the slide, one line saying what is wrong — and the tab does not call the
agent: it opens `/app/chat?p=Arreglá la slide 2 del posteo «<id>»: …`, which
the chat SENDS. From there it is the normal path: the face delegates, the
creator reads that post's stored brief, changes only what the request asks and
keeps the rest word for word — the whole reason a fixed slide still belongs to
the same carousel — generates it in the same format, looks at it, and calls
`replace_slide(post_id, number, image, reason, alt=None)`, the second tool of
the posts toolset. It puts the picture in as slide `number` (keeping the
`NN.<ext>` naming), replaces that slide's prompt and, when one is given, its
alt, and writes a `post.slide_replaced` event. Any day's post can be fixed, not
only today's, and the caption is never rewritten.

**A FIX DELETES NOTHING.** The slide that was there moves to
`<post>/anteriores/` as `NN-<k>.<ext>`, counting up per slide, and `post.json`
grows a `versions` map keyed by the slide's current file name:

```json
"versions": {"02.png": [{"file": "anteriores/02-1.png", "prompt": "…",
                         "alt": "…", "reason": "la decoración violeta…",
                         "replaced_at": "2026-09-15T18:41:07-03:00"}]}
```

`reason` is a required argument and it is the CLIENT's words about what was
wrong, passed through by the creator: next to the old picture it is the only
thing that says why there are two. Which one is the good one is the client's
call — the Posts tab draws the earlier ones under the slide, and `expand()`
hands each version the `url` its bytes are at. `GET /portal/posts/{id}/{file}`
takes a `:path` so `anteriores/02-1.png` is served like any other piece; the
allowlist is still the post's own listing, so a name that is not in `images` or
in `versions` is a 404, `..` included.

Its three routes are the Posts tab: `GET /portal/posts` (newest first, each
image expanded to `{name, bytes, url}`), `GET /portal/posts/{id}` and
`GET /portal/posts/{id}/{file}`, which answers the bytes with a real
`Content-Type` and an inline `Content-Disposition`. The bytes are served here
and not by `/portal/files`, which answers `text/plain` for everything it has.
`engine.module("posts", True)` is what makes the portal draw the tab.

```bash
python3 engine/tests/test_post.py       # ~3 min, ~US$0.07
python3 engine/tests/test_fix.py        # ~3 min, ~US$0.11
```

`test_fix.py` is the fix's own gate, two turns: one that leaves a carousel and
one that says what is wrong with slide 2. Nine claims — the face delegated and
never called `replace_slide`, that slide's bytes changed, every other slide's
did not, the brief changed but kept a long verbatim run of the old one (the
shared visual block), `post.slide_replaced` in the face's session, an answer
that names the slide, `prompts` served by `/portal/posts/{id}`, the replaced
picture kept under `anteriores/` with its own brief, its alt and the client's
words, and those bytes served as `image/png` through the version's `url`. It
moves the day's post aside and puts it back, like the one above. Measured
2026-09-15: 217 s and US$0.10, the carousel most of it and the fix 49 s — and
the reason reached `post.json` word for word («la decoración violeta dejala
como un arco grande abajo a la derecha»).

One chat turn — «Armá el posteo de hoy para Instagram y guardalo» — and nine
assertions from outside: the folder with its three kinds of file, the listing,
the piece downloading as `image/png`, `modules.posts` in the manifest, a
`post.saved` event in Activity, an answer that does not claim it published,
`delegate_task` in the trail and `save_post` NOT in it, an answer that
names Posteos, and the carousel itself — `format` `carousel`, three slides or
more, one alt each, every `NN.png` on disk and listed in order. The day's post is moved out of the workspace for the length of
the run and moved back at the end, so the run's own post is the only one of
the day and the workspace is left as it was found.

### Publishing

**IT GOES OUT ONLY THROUGH THE GATE.** `publish_instagram(post_id, note)` is
the social plugin's one outward tool and the only thing in this product that
leaves the building: `kit/plugins/social/core/publishing.py`, registered on the
FACE wrapped in `approval_required()` exactly the way the approval plugin
registers `send_email`. Not on the creator — a sub-agent never talks to the
client, and a gated tool inside `delegate_task` does not pause, it kills the
turn (**Sub-agents** below). The client asks for it from Posteos («Publicar en
Instagram», which opens `/app/chat?p=…` like the slide fix does) or just says
so in the chat; the run stops, the request lands in Aprobaciones, and nothing
has happened yet.

**THE TOOL'S ONLY ARGUMENT IS AN ID**, so there is no way to publish a version
of the post the client never saw — and so a card built from the arguments would
say nothing. The social plugin hands the approval plugin a renderer for its own
tool, `engine.provide("approval.render.publish_instagram", publishing.card)`,
and `render.py` looks it up by tool name when a run stops: the card is read off
`post.json` — the slides as pictures (`/portal/posts/{id}/{NN}.png`, fetched by
the portal's markdown renderer with the bearer), the caption, the hashtags, and
a warning with the permalink if it already went out. The slides sit in a
markdown table because the portal cuts a request's EDITABLE text after the last
table row (`splitProposal`), which puts the caption, and only the caption, in
the box the client edits. A correction therefore REPLACES the caption — the
portal sends "use exactly this version" — instead of being appended the way
`send_email`'s is. The pictures are never touched by a correction: a slide
that is wrong is fixed first, with «Arreglar esta imagen».

**THE API IS THE INSTAGRAM API WITH INSTAGRAM LOGIN** (`graph.instagram.com`,
v21.0): a professional account and a long-lived user token, no Facebook Page,
no app review for the account's own owner. `instagram.py` creates one container
per slide, then the `CAROUSEL` with their ids and the caption, polls
`status_code` until `FINISHED` — Instagram fetches the pictures itself, so a
container is not publishable the moment it exists — publishes, and reads the
permalink back. It writes `published: {at, media_id, permalink}` into
`post.json` and one `post.published` event; the Posts tab draws that as the
«Publicado» chip with the link. A post of ONE picture is not a carousel:
Instagram's takes 2 to 10 children, so a single slide goes up as one container.

**INSTAGRAM ONLY TAKES PUBLIC URLS AND THIS ENGINE SERVES EVERY BYTE BEHIND A
BEARER**, so the slides go up to a Cloudflare R2 bucket (S3-compatible, `boto3`)
as `<post_id>/<NN>.png` for the length of the publish and are deleted on the way
out, on the failure path too. The bucket is a doorstep, not a store.

**`boto3` IS NEW IN THE IMAGE, SO EVERY RUNNING AGENT NEEDS `--build` ONCE.**
The kit reaches a container by bind mount and a dependency does not: an
instance restarted without rebuilding imports the social plugin, fails on
`import boto3` and does not come up at all — the plugins are loaded at startup
and a plugin that raises takes the app with it. `docker compose -p <name> -f
engine/instance.yml --env-file engine/instances/<name>/instance.env up -d
--build`, once, per agent.

The environment, on the instance's `secrets.env`, read at call time and ALL of
it before the first upload — so a half-connected agent never leaves pictures in
a bucket for a publish that was never going to happen:

| variable | what |
|---|---|
| `IG_ACCESS_TOKEN` | the long-lived user token. **60 days** |
| `IG_USER_ID` | the Instagram professional account's id |
| `R2_ACCOUNT_ID` | the Cloudflare account the bucket is in |
| `R2_ACCESS_KEY_ID` · `R2_SECRET_ACCESS_KEY` | the bucket's S3 credentials |
| `R2_BUCKET` | where the slides wait |
| `R2_PUBLIC_URL` | its public base, e.g. `https://pub-xxxx.r2.dev` |

A missing one is one Spanish line the agent hands the client — «Falta conectar
Instagram: no está IG_ACCESS_TOKEN» — and it is the one thing in here that is
not protective programming: it is the connection not being set up, which is the
state every agent is in until its client connects the account.

**THE TOKEN EXPIRES SILENTLY EVERY 60 DAYS**, which is how this connection dies
without anyone noticing. `POST /portal/instagram/refresh` calls Meta's
`refresh_access_token` and answers WHEN the new one expires, never the token
itself (the adapter never returns a credential); the refreshed value replaces
the one the process is holding, and since Meta extends the token it is given,
the next refresh from what `secrets.env` still has works as long as it happens
inside the window. It is called by hand today; a flow calls it later
(`docs/PENDING.md`).

```bash
python3 engine/tests/test_instagram.py   # free, a second, no model, no network
bash engine/tests/test_publish_gate.sh   # ~7 s, ~US$0.01, one turn
```

The first one is where the sequence is asserted, because a real publish is one
irreversible thing on a real account and cannot be run twice: the Graph behind
an `httpx.MockTransport` and the bucket behind a recorder, over a throwaway
post, seven claims — the documented order of calls, the public URLs Instagram
was handed and in what order, the caption being exactly what `caption.md`
carries, `published` and the event, the objects deleted, a one-picture post
that is not a carousel, and `NotConnected` naming the variable before a single
byte goes up.

The second is the gate, live, one turn, with `IG_*` and `R2_*` unset — which is
why it can be run as often as it likes. Sixteen claims: the turn pauses with the
pause message and `publish_instagram` in the trail, nothing was published, the
card names the post and carries the caption, the hashtags and both slides as
pictures, the caption is below the last table row, and then the client approves
and the resumed run comes back with «No pude publicarlo: falta conectar
Instagram (`IG_ACCESS_TOKEN`)» — an answer and not a dead turn — the post still
unpublished, the request closed, and both halves in Activity. Last run
2026-09-15: **0 failures, 6.5 s**. A real publish is Luis' to do, with his
token.

## Sub-agents

**The face is the only entry point** — the chat and every flow run — and what
it delegates runs in its own context with its own tools and its own prose.
`docs/subagents-plan.md` is the decision; the mechanism is
`pydantic_ai_harness.SubAgents`, one `delegate_task` tool on the face over
every delegate the plugins registered, built at the end of `plugins.load()`
and added only if there is one.

**A delegate is a real `Agent` the PLUGIN builds**, wrapped in a `SubAgent`.
The example, and today the only one, is the social plugin's creator
(`kit/plugins/social/core/creator.py`):

```python
agent = Agent(
    engine.model,
    deps_type=engine.Deps,
    name="instagram-creator",
    description="Arma un posteo de Instagram listo para revisar: …",
    instructions=[engine.identity, PROSE.read_text(), procedure(), engine.today],
    toolsets=[engine.tools("read_file", "list_files"), posts.toolset()],
    capabilities=[engine.use("image"), engine.use("memory")("instagram-creator")],
    model_settings=engine.model_settings,
)
engine.subagent(SubAgent(agent, timeout_seconds=TIMEOUT, max_calls=2),
                label="creador de posteos")
```

- **It shares the client's identity and nothing else.** `engine.identity` is
  the SOUL's OPENING — who the client is, what the company does — plus the
  `core:base` block minus its last line, «En el chat, respuestas cortas»,
  which is manners for a chat a delegate is not in. Not «Tu alcance», not
  «Cómo escribís», not «Horarios»: that is the FACE's job description. Not the
  plugins' prose and not the skills index either, because a delegate that
  reads about a tool it does not have will try to use it. It is a plain STRING
  and the first item of the list, which is what puts it first in the prompt; a
  SOUL edit reaches a delegate on the next restart.
  `python3 engine/tests/test_identity.py` is the split, asserted against the
  running container and the file on disk — free, no model.
- **Its tools come from the same definitions**, filtered by name with
  `engine.tools(...)` — one `read_file` with one docstring. The flow tools are
  not on offer: creating a flow is a conversation with the client, and a
  sub-agent never has one. An unknown name raises at registration.
- **Its capabilities come from other plugins**, by name. `image` provides its
  `ImageGeneration` and registers nothing; `memory` provides two factories, so
  the creator gets `memoria/instagram-creator/MEMORY.md` next to the face's
  `memoria/main/` — under a rule the social plugin wrote for a worker with no
  chat — and a READ of `memoria/main/` under «Lo que el cliente dijo», with no
  tools on it.
- **The skill is read whole, at build time.** `SKILLS = []` in the social
  plugin: on the face the post skill was an index entry the model had to
  decide to read, and here there is one job, so the procedure IS the
  instructions. The face no longer has the tools that skill names.

**A sub-agent has no gated tools and never talks to the client.** Registration
refuses three shapes: a delegate typed on other deps, one with a fixed output
type (what comes back to the face is `str(output)`), and one carrying an
`approval_required` toolset. That last one is not a precaution — measured:
the gate does NOT come back through `delegate_task` as a pause. The CHILD run
raises, because its own run has no `DeferredToolRequests` among its output
types, and that `UserError` bypasses `contain_errors` and kills the turn; the
client reads «No pude responder: A deferred tool call was present…». Sensitive
tools stay on the face, which is where the conversation is.

**A failure comes back as a message.** `contain_errors=True` and a per-delegate
`timeout_seconds` (`CORE_DELEGATION_TIMEOUT`, fifteen minutes by default — a
carousel is five images and five looks): a crash,
a timeout and an exhausted `max_calls` all return a steering line the face
reads and answers the client from. An image the provider refuses never even
gets that far — it is a `ModelRetry` inside the creator, which reports it.

**Both ends are visible and priced.** `core/delegation.py` writes
`delegation.started` («Le pedí al creador de posteos: <the brief, cut at 120>»)
and `delegation.finished` («El creador de posteos terminó en N s», or «…no
pudo: tardó más de lo que tenía») into the events table on ANY run — a chat
turn, a flow's run, a run resumed after an approval, which has no stream at
all — and `core/session.py` yields the same two off the stream as tool
progress, so the chat's trail is not three silent minutes. The Spanish name is
the `label` the plugin passed; the delegate's id never reaches a screen.
`forward_usage=True`, so the child's tokens are in the turn's `turn_usage`
event, which gains `delegations: N` to say how much of it was not the face.

Two things the portal has not caught up with, neither of them a failure: the
harness's own listing prose in the prompt is English (a library constant, the
only English the model reads), and `app/app/lib/labels.ts` has a row for
`delegate_task` («Repartió el trabajo») but none for `delegation.started` /
`delegation.finished`, so those two trail lines read as the generic «Trabajó un
rato» until somebody adds them.

```bash
python3 engine/tests/test_delegation.py   # ~8 min, ~US$0.23
```

S1-S4 against the running container, nineteen claims: the face delegates and
has neither `generate_image` nor `save_post`; what lands is a CAROUSEL, three
slides or more with one alt each, `01`…`NN` on disk and listed in that order; a
flow's run goes through the same delegation and the post it saves carries the
flow's slug — which is `flow_of` still working, and the proof that the creator
runs on the FACE's deps; both events are in Activity and the usage event says
`delegations: 1` against a turn that delegated nothing (119_587 in / 2_636 out
against 12_884 / 836, US$0.0194 against US$0.0017 — a carousel turn reads five
images, which is where the input tokens are); and a refused image and a
five-second timeout both come back as an answer in Spanish. It moves the day's
post out of the workspace and puts it back.

## Check it

```bash
KEY=$(grep '^API_SERVER_KEY=' engine/secrets.env | cut -d= -f2-)
python3 kit/tools/portal-check.py --key "$KEY" \
    --endpoint http://127.0.0.1:8642 --adapter http://127.0.0.1:8643 \
    --origin http://localhost:8090
```

Last run: **16 ok · 2 warnings · 0 failures**. The two warnings are the modules
the manifest does not declare — `artifacts` and `crons`, out of scope in
`docs/engine-plan.md` and never coming. `kanban`, `approvals`, `usage`, `flows`
and `posts` are declared and answer, and two of those checks look past the
listing: flows crosses it against `/api/jobs`, so a flow that runs on the
clock with no task in the gateway is a failure and not something to notice in
the browser, and posts downloads the newest post's first piece, so a card whose
picture does not come back is one too.

Both chat dialects by hand:

```bash
# New conversation — OpenAI-shaped. The whole local history travels and the
# session is matched from the CLIENT's turns in it (the assistant's are the
# engine's to rewrite, so the browser's copy of one is not the one on disk).
# Ends in `data: [DONE]`.
curl -sN -X POST http://127.0.0.1:8643/portal/chat/stream \
  -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"stream":true,"messages":[{"role":"user","content":"Hola, ¿qué podés hacer por la ferretería?"}]}'

# The session it opened
curl -s -H "Authorization: Bearer $KEY" http://127.0.0.1:8642/api/sessions

# Resumed conversation — session-shaped, named events. A message that makes it
# use a tool shows the whole trail.
curl -sN -X POST http://127.0.0.1:8643/portal/sessions/<id>/chat/stream \
  -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"message":"Listá los archivos del workspace y decime cuántos hay."}'
```

The second one answers, in this order: `run.started`, `tool.started`
(`{"tool_name": "list_files"}`), `message.started`, `assistant.delta` …,
`assistant.completed`, `run.completed`, `done`.

Two things both dialects do at the end of a turn. **What was persisted is what
the bubble ends in**: the session dialect has `assistant.completed`, which the
portal treats as the authoritative content, and the OpenAI one — which only
accumulates deltas — reconciles what it streamed against what was persisted and
sends the difference as one last delta. The promises correction and the pause
message both arrive that way. **A turn that breaks says so**: one assistant
line, `No pude responder: <reason>`, persisted, written to Activity as an
`error` event and streamed in both dialects; then the exception goes on to the
log with its stack.

## Gates

From `docs/engine-plan.md`. Wave 1 owns none of them outright; what it had to
leave standing is here.

| # | Gate | State |
|---|---|---|
| G1 | Fail-closed approval that survives a crash | **passes**: `./tests/test_approval_crash.sh` against the running container — one gated turn, `docker kill`, five rejections, approve with a correction. 32 checks, 0 failures |
| G2 | The existing portal works with only the magic link changed | **portal-check 0 failures**; the browser walkthrough is Wave 5's |
| G3 | Kit plugins load as toolsets, SKILL.md unchanged | **works already**: asked in chat for an informe, the agent read the skill with `skill_view`, ran `/opt/kit/skills/deliverable/deliver.py` and the file landed in `workspace/entregables/`. Nothing in Wave 2 changed that: the plugin's skill still loads from its own frontmatter, unmodified |
| G4 | Compaction | **passes**: `python3 tests/test_compaction.py` — 41 turns on one session, 39 compactions, the persisted history ends at **7 messages** against 82 displayed, and the fact planted at turn 2 is still answered. 249 s, US$0.0198 |
| G5 | The promises check rewrites the PERSISTED message | **passes**: `python3 tests/test_promises.py` — the kit's own 8/13 phrase comes back corrected, the deliverable counter-case comes back untouched, and `GET /api/sessions/{id}/messages` returns the corrected text |
| G6 | Cost per turn on the baseline model | **measured**: `python3 tests/cost.py` — **US$0.000564** conversational and **US$0.000859** with four tool calls, against a baseline of US$0.0036 and US$0.0247. The engine's own estimate matched the provider's meter to the last decimal on both |

## The board

The board is a PLUGIN too — `kit/plugins/kanban/`, loaded because `kanban` is
in `CORE_PLUGINS` — and it is the first thing the other plugins write into: a
mail becomes a ticket, an Instagram comment that reads like a lead becomes a
ticket, and the client finds both on the one screen she already has
(`/app/pipeline`). Take it out of the list and the engine has no tickets table,
no `/portal/tickets*` and no Board tab; what was there before this plugin was
an empty list the engine answered out of `server/portal.py`.

**Two tables, made when the plugin loads.** `tickets` (`id, title, body,
status, tenant, source, source_ref, created_at, updated_at, closed_at`) and
`ticket_comments`, in the engine's own SQLite through `core/db.py`. The id is
`t_` + 12 hex, which is the shape the chat's entity chips recognize
(`app/app/lib/entities.tsx`): the agent names a ticket in its answer and the
portal turns it into a link, with nothing asked of the model but the id.

**The five statuses are the portal's and the plugin invents none.**

| status | column (`app/app/lib/labels.ts`) |
|---|---|
| `ready` | Por hacer |
| `in_progress` | En curso |
| `blocked` | Esperando aprobación — or **Lo estamos viendo** when `source` is `client`, because then the ball is ours |
| `done` | Completado |
| `archived` | off the board; the link still opens it |

A sixth value is refused by the routes (400) and by the tools (`ModelRetry`),
both naming the five: an unknown status falls into «En curso» on the board, and
a ticket that is not moving then reads as one that is. `closed_at` is written
entering `done` or `archived` and cleared leaving them — by the move, never by
the model.

**`source` and `source_ref` say where a ticket came from, and they are the
dedupe.** `client` is one the client made from the portal, `agent` one the
agent opened, and anything else is the plugin that brought it (`mail` +
the message id, `instagram` + the comment id). `(source, source_ref)` is a
UNIQUE index, and `create_ticket` on a pair that is already there answers with
the id that is there and says so: for a plugin that ticks over the same inbox
every five minutes, «already have it» is the normal case and not an error.

**Two tools on the face, not gated.** `create_ticket(title, body, source?,
source_ref?)` and `update_ticket(id, status?, comment?)`. A ticket is internal —
writing one down changes nothing outside the client's own portal — and the gate
is for what the agent does outwards. What they do leave is a trail: every call
writes an event carrying the ticket's id and the session it was made from.

**The ticket's history is the event log, filtered.** `ticket.created`,
`ticket.moved` and `ticket.commented` go into the engine's `events` table with
`ticket_id` in the payload, and the detail reads them back by it — there is no
second timeline, because Activity is where the client reads what her agent did
and a ticket's history has to be the same rows. The Activity line is written by
the code, in Spanish, with the ticket's title and the column's name in it
(«Moví «Consulta por mail» a Completado»).

**The `outcome`** the Board draws above the thread is built from the move that
put the ticket where it is: the words that came with the move, or failing that
the last thing the agent wrote on the ticket. Nothing said about it is no
outcome — a banner reading «Sin detalle» tells the client nothing.

**`/portal/tickets/{id}` IS THIS ROUTER'S, FOR EVERY PLUGIN WITH A THREAD TO
SHOW THERE.** The Approvals tab opens a request with the same call
(`getTicketDetail(approvalId)`), and two routers cannot answer one path:
FastAPI matches whichever registered first and the other is dead code nobody
notices. So the approval plugin hands its lookup over —
`engine.provide("tickets.detail.approvals", store.detail)` — and the board asks
every `tickets.detail.*` it finds for an id that is not a ticket of its own,
at REQUEST time, so neither plugin cares which order they load in.

```bash
python3 engine/tests/test_board.py    # no model, free, a second
```

Both halves: the two tools called directly inside the container, and the five
calls the portal types, over HTTP. It cleans up after itself.

## Approvals

Approvals are a PLUGIN of this engine, not part of it: everything below is in
`kit/plugins/approval/core/`, loaded because `approval` is in
`CORE_PLUGINS`. Take it out of that list and the engine has no gate, no
Approvals tab and not a word about permission in its prompt.

The gate is on the TOOL, not on the model remembering to ask: the toolset in
`sensitive.py` is registered wrapped in `approval_required()`, so the run stops
before the tool body runs. What happens then, in order:

1. The run ends with `DeferredToolRequests` as its output instead of text, and
   `core/session.py` hands it to the plugin's `paused()` through
   `DEFERRED_HANDLER` — the engine knows a run can stop and nothing else.
2. The plugin's `store.py` writes A NEW ROW, one per request: the body rendered
   by its `render.py` from the tool's arguments and its `ApprovalNote`, the
   serialized requests, and THE RUN'S MESSAGES. That last one is what survives
   a `docker kill`. A row is reused ONLY by the resumed run of that same row,
   which names it — a second gated turn on the same conversation opens its own
   row instead of overwriting the card the client is about to approve.
3. The chat gets the pause message, written by the code and persisted like any
   other. The session's own history does NOT advance: a history that ends in an
   unanswered tool call is not replayable by the next turn.
4. Approve and reject both CLAIM the row before resuming: unknown id → 404,
   anything but `pending` → 409, and the row moves to `resolving` with the
   decision on it BEFORE the run starts. Two clicks on the same card used to
   run the tool twice, and a crash between the tool and the row's update left
   the row pending with the mail already sent. A row left in `resolving` by a
   crash stays there: the retry reads the 409, not a second side effect.
5. Reject → the reason is stored as a `cliente` comment and reaches the model as
   `ToolDenied`; the resumed run proposes again on THE SAME ROW, which goes
   back to `pending` with the new tool call ids (the previous ones are gone
   from the row and can never be resumed). A "no" never takes the request out
   of the queue — only `final` closes it.
6. Approve → `ToolApproved`, and a correction rides as `override_args` with
   `client_correction` merged into the call the model made.
7. When the resumed run answers in text, the answer is persisted on the session
   AND appended as an `agente` comment, and the row closes as `approved` or
   `rejected`.

**The resumed branch is appended, never written over the session.** An approval
can sit in the queue for a day while the client keeps talking to the agent, and
the branch the row carries was forked when the run paused. What goes onto the
session's CURRENT history is the branch from the pause point on — the
`ModelResponse` with the tool call, the `ModelRequest` with its result, and
whatever the run said after. The provider reads that as a call answered
immediately, which is what it is. The paused user request itself is not in the
engine's history until the approval resolves; the client sees it in the chat
from the moment she sends it, because the displayed messages and the engine's
history are two different stores.

Approve and reject answer only after the resumed run finished (3–20 s), so the
portal's refresh reads the outcome and not the row as it was a second ago. The
resumed run has no stream attached: its answer shows up in the chat on the next
load, which the plan takes as acceptable for the engine.

**The outbox.** `send_email` is fake, and deliberately so: its whole side effect
is one markdown file in `workspace/outbox/` (`email-<stamp>-<to>.md`) with the
client's correction on a line of its own. It is the only evidence that the tool
ran, and the Files tab shows it.

**THE GATE IS NOT A DEMO ANY MORE**, and this plugin is no longer the only one
that uses it: the social plugin's `publish_instagram` is real, it is gated the
same way, and it draws its own card through this plugin's renderer hook
(**Publishing**, above). There used to be a second fake tool here,
`publish_post`, dropping a file in the outbox and answering «Publicado en
<canal>»; it went out with that change, because two tools with that name and
that promise, one of them fake, is the model choosing between them by the shape
of a sentence.

## Memory

Memory is a PLUGIN too — `kit/plugins/memory/`, loaded because `memory`
is in `CORE_PLUGINS` — and it is the only one whose mechanism comes from a
library: `pydantic-ai-harness==0.31.0`, whose `Memory` capability gives the
agent four tools (`write_memory`, `read_memory`, `search_memory`,
`delete_memory`) and renders a bounded excerpt of the notebook into every
request, inside `<memory>` markers.

**Where it lives, and who can see it.**
`workspace/memoria/main/MEMORY.md` — inside the workspace on purpose. What the
agent believes about a client is the client's to read and to correct, and the
Files tab lists it like any other file. `main/` is the FACE's scope segment and
`MEMORY.md` is the library's constant; the store's journal sits next to it
as `.memory-store.sqlite3` (it is what makes a write atomic across processes)
and the Files tab skips it, because it skips every dotfile. A sub-agent gets
its own notebook next to it — `memoria/instagram-creator/` — through the
factory this plugin provides (**Sub-agents** above); the extraction below stays
on the face alone, because it reads a turn of the CLIENT's conversation and a
sub-agent never has one.

**The notebook is in the INSTRUCTIONS, and that is ours.** The harness appends
its injected part to the LAST model request of every round trip, so on a
request carrying a tool return it is the last thing the model reads before
answering — and it answers it: «Recibido. El horario de los sábados es de 9:00
a 13:00», twice out of two, on the turn where the client had asked for a post.
Every tool loop has had that shape; a delegated turn made it the usual answer,
because it is ONE short tool return where there used to be a long trail of
them. Moving the part to the front of the request fixed the answer and left the
block in the conversation, where a delegated turn's `delegate_task` tool return
still carried a whole copy of the notebook in front of the creator's report.

So it is not in the conversation at all. `injection.Notebook` is the harness's
`Memory` with `inject_memory` off and the notebook rendered through
`get_instructions` instead: read once per run in `for_run`, next to the
guidance that already lived in the instruction channel, still inside its
`<memory>` markers. A LITERAL instruction and not a callable, so it stays above
the date line and inside the run's stable prefix. What it costs is cache — the
tail of a request is cheap to invalidate and the head is not, so the turn after
a write starts cold — and what it buys is a tool return that is the delegate's
report and a persisted history with no `<memory>` in any message part, which
`engine/tests/test_delegation.py` S1.g asserts.

**A sub-agent's rule is its own, and it can read the client's page.** The
factory is `notebook(scope, guidance)`: the face's guidance is written for
someone in a conversation («cuando te dice acordate…») and the creator has no
conversation, so the social plugin writes the three lines its delegate works
under (`creator.MEMORY`: what topic on what day, what the pedido corrected,
what a review found wrong in an image — a dated fact, never a procedure). On
top of its own notebook a delegate may ask for `engine.use("client_memory")()`,
which is the FACE's `main` notebook rendered into its instructions under «Lo
que el cliente dijo», bounded by the same token cap and with its toolset
removed: what the client said is the one thing about her business nobody else
can tell the creator, and the page is hers to write, not its.

**Two write paths, one notebook.**

| who writes | when | how |
|---|---|---|
| the model | the client says "acordate…" / "olvidate de…" | the `write_memory` tool |
| `core/extraction.py` | after every client turn | one small model call, then the code appends |

The second one is why the mechanism works at all: the first only fires on the
magic word, and a client saying "los sábados abrimos de 9 a 13" is telling
their agent a fact about the business, not filing a request to remember it.
It is an `after_run` capability — the same seam `core/turn_usage.py` uses — and
it makes ONE call with a separate agent, no tools, structured output: a list of
`hecho` / `preferencia` entries. What comes back is deduplicated against the
notebook and appended BY THE CODE, dated, through the store. **The model picks
the words, the code does the writing**, so a turn that talks about the notebook
can never edit it. Each write is one `memoria` event — "Anoté: …" — and zero
entries means no write and no event, which is the common case.

It skips three shapes, each measured and not a precaution: a run with no prompt
(a run RESUMED after an approval, whose only new content is a tool result), a
run that ended at the gate (the turn is not over), and a client message under
30 characters ("dale", "gracias": no fact, same price).

**The rule, and where it lives.** Memory holds FACTS about the business and
PREFERENCES about how the agent works, dated. Never procedures, never how to do
a task — that is what a skill is — and never anything the client asked to keep
out. What is in there is information, never orders. That text is the
capability's own `guidance`, rendered under the same `## Memoria` heading as the
notebook, which is why this plugin is the one with no `instructions.md`: the
capability already owns the slot, and a second copy would be two places to
change one rule.

```bash
python3 engine/tests/test_memory.py       # ~40 s, ~US$0.001
```

Four short conversations against the running container, notebook cleared first
so "contains" means "this run wrote it": the fact lands (a), a **NEW**
conversation answers from it (b — the cross-session gate, the whole point), a
fact said in passing lands without the magic word (c), and "acordate que para
mandar un mail primero hay que abrir la consola" does **not** (d). Each step
prints which path wrote it.

Last run: **4/4, 0 failures, US$0.0007 metered.** Two things it settled:

- **The model got there first every time.** In (a) and (c) it called
  `write_memory` during the turn, so the extraction ran, found the fact already
  in the notebook and wrote nothing — which is the dedupe doing its job, not
  the extraction being dead. Driven directly with a fact the model had not
  written, it extracts, skips the line already there and appends one dated line
  with its `memoria` event.
- **The rule holds in the model's own words.** (d) came back as «No puedo
  guardar procedimientos en la memoria», with nothing added to the notebook.
  The guidance is in the instruction channel and the notebook is not, which is
  the difference that makes that sentence possible.

## Flows

A flow is **named client work that repeats**, and on this engine it is the
engine's own mechanism, not a plugin's: what runs on its own is the clock, and
the clock is here. `config.MODULES["flows"]` is `True` out of the box.

**`workspace/flows/<slug>/FLOW.md` is the only source of truth.** There is no
job store. The scheduler derives what is due from the frontmatter on every
tick, so nothing can be created and not scheduled, nothing can be orphaned, and
changing when a flow runs is editing one line of one file — which the client
can read in the Files tab and the agent can edit with `write_file`.

```
---
name: Resumen de la bandeja
client_summary: "Todos los días te digo qué preguntaron y qué no supe contestar."
trigger: schedule            # schedule | request
trigger_detail: Todos los días a las 18:00
cron: '0 18 * * *'           # required iff schedule, forbidden otherwise
timezone: America/Montevideo # defaults to TZ
status: active               # active | paused
connections: []
---

1. Junto los mensajes del día y lo que se respondió.
2. Marco aparte lo que no supe contestar y por qué faltaba el dato.

## Notas técnicas

- Lo que va acá no lo ve el cliente, y la corrida sí lo lee.
```

`core/flows.py` is the model and the reader. Its validators are the rules:
the slug shape, `cron` iff `schedule`, a real cron expression, and a floor of
five minutes between runs (`CORE_FLOWS_MIN_MINUTES`) so an over-eager agent
cannot schedule itself infinite wake-ups. A FLOW.md that does not validate
raises — it takes the tab and the tick with it, which is the point: a flow that
is half a flow is the state nobody notices.

**The loop** (`core/scheduler.py`) is one asyncio task started with the app.
Every 30 s, for each active `schedule` flow, it asks what occurrence is owed —
the last one that has passed since the flow's previous run — and if one is, it
claims the row and runs. **Missed ticks collapse into one run**: an agent that
was off over a weekend does Monday's work once, not sixty times.

**A run is a headless session**, kind `flow`, titled `<name> · <dd/mm HH:MM>`,
one user turn built from the body and the notes, through the same
`session.run_turn` a chat turn goes through: same tools, same gate, same hooks,
same compaction. It shows up in Chat like any other conversation, because it is
the client's — they just did not type in it. A run that stops at the approval
gate pauses exactly like a chat turn does.

**Runs are rows.** `flow_runs(slug, scheduled_at, session_id, started_at,
finished_at, status, error, manual)`, primary key `(slug, scheduled_at)`. **The
insert is the claim**: two ticks racing on one occurrence write one row between
them, and everything a run does happens after the claim comes back true. A row
left `running` is a process that died holding it, and the next start turns it
into an `error` that says so. Every transition writes an event — `flow.started`,
`flow.finished`, `flow.failed` — so Activity shows a failed run without any
prose asking the agent to mention it.

**Two tools**, in `core/tools/flows.py`: `create_flow(spec)` (the rules are the
model's — up to 7 steps of 320 characters, the connections question answered
even if the answer is `ninguna`) and `set_flow_status(slug, active|paused)`.
Editing a flow's body is editing its file, so there is no third tool for it.
The three things code cannot check — close the contract before creating, create
first and tell after, do the first round right now — are the only flow prose in
the prompt (`core/agent.py`).

**The portal contract, from one reader** (`server/flows.py`):

| endpoint | what |
|---|---|
| `GET /portal/flows` | `{available, flows: [Flow]}` — the tab's listing |
| `GET /portal/flows/{slug}` | the same plus `how`, the steps the client reads. 404 if it is not there |
| `GET /api/jobs?include_disabled=true` | one `CronJob` per `schedule` flow, id and name `flujo-<slug>` |
| `POST /api/jobs/{id}/{pause\|resume\|run}` | pause and resume are one line of the FLOW.md; `run` claims this instant and answers at once |

`last_status` is the last FINISHED run and never the one in flight: the portal
reads a status it does not know as "uncertain", and a client reading "we are not
sure how it went" about a run that is still going is worse than reading nothing.
What says a run is happening now is `state`. `results` and `results_total`
travel empty — where a flow's output lands is the business of the plugin that
produces it, and that plugin brings its own view.

```bash
bash engine/tests/test_flows.sh     # ~9 min, ~US$0.005
```

G1, against the running container. It writes a flow with `*/1 * * * *`, brings
the container up with `CORE_FLOWS_MIN_MINUTES=1` through the compose
passthrough, and then: two ticks, two rows a minute apart, one session each;
`docker kill` mid-run and back up 75 s later, where the killed run reads `error`
and the minutes it was away collapse into ONE catch-up run; pause stops the
clock and resume starts it; run-now answers in milliseconds and the row is
marked manual. It takes the flow, its rows and its conversations out on the way
out and puts the container back on the default floor.

## Compaction, promises and what a turn costs (G4, G5, G6)

Three scripts, all run from the repo root against the container that is
already up. None of them needs anything installed on the host.

### G4 — compaction

```bash
python3 engine/tests/test_compaction.py     # ~4 min, ~US$0.02
```

It restarts the container with `CORE_COMPACT_AT_TOKENS=6000` through the
compose passthrough, opens one session, plants a fact at turn 2 ("mi
proveedor de bisagras se llama Ferretería Ríos y entrega los jueves"), drives
38 more turns that each write or read a file, asks about the fact at turn 41,
and puts the default threshold back on the way out.

Last run: **39 compactions, persisted history 7 messages against 82
displayed, 249 s, US$0.0198, the fact still answered.**

Three things it settled, none of them guessable from the docs:

- **The processed list IS what gets persisted.** `ProcessHistory` assigns it
  back to the run state (`_agent_graph.py`: `ctx.state.message_history[:] =
  messages`), so `result.all_messages()` at the end of the run is the
  compacted history and `core/session.py` stores it unchanged. Nothing in
  session.py had to move, and the risk `docs/engine-plan.md` names —
  "persisted vs sent history under a processor" — does not exist here.
- **The context-window fraction is a dead knob on this model.** `CORE_COMPACT_AT`
  is a fraction of the model's window and `openai/gpt-5.6-luna`'s window is
  1_050_000 tokens, so the default 0.6 means 630_000 tokens. What bounds the
  history is `CORE_COMPACT_AT_TOKENS` (4 characters per token over the
  serialized messages). Either one trips compaction; on a small-window model
  the fraction would trip first.
- **Re-summarizing a summary loses the fact.** The first run of this test
  summarized the summary on every turn — 39 games of telephone — and by turn
  41 "Ferretería Ríos" had been replaced by a list of the files written
  since. The fix is in `core/compaction.py` and it is the house rule: the
  code carries the previous summary forward WORD FOR WORD and the model only
  summarizes the turns it has not seen. The running summary is folded back
  through the model only when it passes `SUMMARY_CAP` (4 KB), which happened
  once in 39 compactions and the fact survived it.

### G5 — the promises check rewrites the persisted message

```bash
python3 engine/tests/test_promises.py       # ~30 s, ~US$0.002
```

Three parts: the kit's own case through the BEFORE_PERSIST chain with no model
(the 8/13 phrase gets the correction, a loose deliverable does not), the
natural ask (the agent is told to claim a schedule — the SOUL holds and it
refuses, which is printed), and the seam itself (the agent is made to emit
the claim verbatim, and `GET /api/sessions/{id}/messages` returns the
corrected text). The last one is the gate: what the portal reads back is what
the hook returned, not what the model said.

The guard itself is `core/promises.py`, registered into `BEFORE_PERSIST` at
import like the engine's other hooks, and what it reads is `flows.read_all()`.
It used to be the `flow` plugin's, loading one copy of the module for two
engines; the flows are the engine's now and so is the check that reads them.

The one-line version of the phrase — "Queda definido: viernes a las 9:30 te
mando el control de contratos" — does **not** fire, and that is the module
working: `review()` wants a closing claim AND a recurrence hint, and there is
no recurrence word in that line. The kit's own case carries it in the second
line ("para dejarlo andando").

### G6 — what a turn costs

```bash
python3 engine/tests/cost.py                # ~2 min, ~US$0.002
```

Priced the way `kit/notes/cost-and-engine-findings.md` §1 prices one:
the turn goes through `POST /portal/chat/stream` with the whole history, and
`GET /api/v1/key` is polled until the delta stops moving for 20 s. **Nothing
else can be talking to this agent while it runs** — the first attempt read
US$0.001858 for a conversational turn because the compaction gate's spend was
still landing.

| turn | tools | s | metered US$ | engine US$ | baseline US$ |
|---|---|---|---|---|---|
| conversational | 0 | 2 | 0.000564 | 0.000564 | 0.0036 |
| with tools | 4 | 8 | 0.000859 | 0.000859 | 0.0247 |

The engine's own number is `usage.cost` (genai-prices), written per turn as a
`turn_usage` event by `core/turn_usage.py`. It matched the provider's meter to
the last decimal on both rows, which is §2's finding reproduced on another
engine: the estimate IS the charge, and the polling harness is not needed
again.

**The two money columns are not the same comparison.** The prompt is: 2028
input tokens conversational here against a Hermes turn carrying the platform
preamble and twelve toolsets. But the tool row is also doing less work — four
tool calls against the baseline's 12 to 42, and no deliverable written — so
read US$0.000859 as "a light tool turn on a small prompt", not as "the same
turn for 29× less".

## Known limits

Measured or read in the code, left standing on purpose. None of them is a gate.

- **The compaction summarizer's tokens are not in the turn's usage.**
  `core/turn_usage.py` writes `usage` off the main run's result, and the
  summary is a separate `Agent.run()` inside the `ProcessHistory` capability.
  Its tokens are on the `compaction` event instead, so a turn that compacted
  cost more than its `turn_usage` row says. The provider's own meter, which is
  what `GET /portal/usage` shows, has both.
- **A delegation that dies uncontained leaves a `delegation.started` with no
  end.** The harness emits the end event from inside the delegate tool, so an
  exception that propagates out of it (a shared usage limit, a cancellation, a
  crash with `contain_errors` off) ends the delegation without one. Activity
  then shows what was asked for and never how it went — which is honest, since
  the turn itself ends in the engine's failure line right after it, but a row
  that closes nothing is a row somebody will read as a delegation still
  running.
- **The extraction's tokens are not in the turn's usage either.** Same shape as
  the compaction summarizer above and for the same reason: it is a separate
  `Agent.run()` inside a capability, so a turn that noted something down cost
  more than its `turn_usage` row says. The provider's meter — what
  `GET /portal/usage` shows — has both.
- **Two turns finishing at the same instant can collide on the notebook.** The
  memory store writes compare-and-swap, and the notebook is one file shared by
  every session: the second write of a tie reads a version that moved and
  raises, which reaches the client as "No pude responder" on a turn that was
  already answered. It needs two conversations answering within the same
  fraction of a second to happen, and the engine has one client.
- **`tests/cost.py`'s per-turn numbers are indicative; the aggregate is what
  holds.** It polls OpenRouter's `/api/v1/key` for a delta, and spend lands
  there late and in its own time: the script cannot tell "nothing yet" from
  "zero", and a turn's spend can land while it is reading the next one's, which
  moves money from one row of the table to another. Nothing else may be talking
  to the agent while it runs, and even then read the total, not a cell.
- **Displaying a message and persisting the history are two commits.** SQLite
  writes them one after the other (`db.add_message` then `db.save_history`), so
  a crash in between leaves the client reading an answer the engine will not
  replay. One transaction would fix it; the engine does not need it to answer the
  question it exists to answer.
- **A bash timeout kills the turn instead of the tool.** `subprocess.run(...,
  timeout=60)` raises, nothing catches it, and 60 s of a command now reach the
  client as "No pude responder: Command ... timed out". A tool error the model
  can read and work around would be better, and it is one `except` in
  `core/tools/workspace.py`. The FILE half of that file is done — a path that
  is not there, a folder that is not one and a folder read as a file come back
  as a `ModelRetry` naming the path, since the morning a `read_file` on a
  deleted `post.json` ended a client's turn in «No pude responder: [Errno 2]»
  (`tests/test_workspace_tools.py`). `bash`'s timeout is still a crash.
- **Session matching is O(sessions × messages).** `match_session` reads every
  session's messages out of SQLite to compare user turns on every new
  conversation. At the engine's scale it is microseconds; at a client's it wants
  a hash of the client's turns on the session row.

## Where the next waves plug in

| Seam | Where |
|---|---|
| Anything a PLUGIN brings | its `core/plugin.py` and the seven verbs of `register(engine)` — see **Plugins** above. Everything below is what those verbs write into |
| Extra toolsets (sensitive tools, anything gated) | `EXTRA_TOOLSETS` in `core/agent.py`, appended before the first turn; read when the agent is built |
| Agent capabilities (compaction, `ReinjectSystemPrompt`) | `CAPABILITIES` in `core/agent.py` |
| Text transform before the message is persisted | `BEFORE_PERSIST` in `core/session.py` — a list of `(session_id, text) -> text`, run in order, and what they return is what gets persisted AND what `assistant.completed` carries |
| A run that stopped at a gated tool | `DEFERRED_HANDLER` in `core/session.py` — ONE callable, `(session_id, requests, history) -> text` |
| The event log | `db.append_event(kind, label, status, session_id, payload)` (the plan calls it `events.append`) |
| New tabs | a route in `server/portal.py` (or a router of its own, like `server/extra.py`, or a plugin's) plus its flag in `core/config.py`'s `MODULES` or `engine.module(...)` |
| Anything that wants the run's result — usage, cost, what it answered | an `AbstractCapability` with `after_run`, like `core/turn_usage.py`. It is where the result exists, and it needs nothing from `core/session.py` |
| Work that should run in its own context, with its own tools | `engine.subagent(...)` from the plugin that owns it — see **Sub-agents**. The engine mounts one `SubAgents` capability over all of them |

## What Pydantic AI 2.43 actually does

- `pydantic-ai-slim[openrouter]==2.43.0` — the `openrouter` extra exists under
  that exact name, and `openrouter:openai/gpt-5.6-luna` infers an
  `OpenRouterModel` with no provider wiring of our own.
- Streaming is `async with agent.run_stream_events(...) as events:` — an async
  context manager over an `AgentRunEvents` iterator, not a plain async
  generator. Text arrives as `PartStartEvent(part=TextPart)` +
  `PartDeltaEvent(delta=TextPartDelta)`, a tool starting as
  `FunctionToolCallEvent(part.tool_name)`, and the run closes with a trailing
  `AgentRunResultEvent` whose `.result.all_messages()` is what gets persisted.
- `ProcessHistory(processor)` in `capabilities=` runs the processor before
  every model request of the run — including each round trip of a tool loop,
  which is why `core/compaction.py` keys a guard on `ctx.run_id` — and the
  list it returns REPLACES the run's state, so `all_messages()` is the
  processed one. `ReinjectSystemPrompt()` is a no-op on an agent that uses
  `instructions=` rather than `system_prompt=`: there is no system prompt in
  the history for a summary to drop.
- A capability's typed events are part of `AgentStreamEvent`, so
  `run_stream_events` yields them to the caller like any other event AND
  dispatches them to every capability with an `@on_event` listener. That is why
  a delegation is written down in `core/delegation.py` (which fires on a run
  with no stream too) and shown from `core/session.py` (which is the only place
  the chat's trail is built).
- `result.usage` is a property, not a call, and it carries `cost` — a
  `Decimal | None` from genai-prices. `ctx.context_window_used` is the last
  response's `total_tokens` over `model.context_window`, and `None` until the
  first response of the session.
- Toolsets are `pydantic_ai.toolsets.FunctionToolset`, registered with
  `@toolset.tool` and passed to `Agent(toolsets=[...])`.
- The gate is `toolset.approval_required()`, and it only stops a run if the
  run can END in the request: `output_type=[str, DeferredToolRequests]` is
  passed per run in `core/session.py`. Without it the call raises instead of
  returning the pending calls. Resuming is `agent.run(message_history=…,
  deferred_tool_results=DeferredToolResults(approvals={tool_call_id: …}))`
  with no user prompt. `ToolApproved.override_args` REPLACES the model's
  arguments — merging the correction into them is ours to do.

## Two things that are not optional, and why

- **`--http h11` in the Dockerfile.** uvicorn's default httptools writer
  lowercases every response header name on its way out.
- **The `CanonicalHeaders` middleware in `server/app.py`.** Starlette spells
  every header it writes in lowercase, and `portal-check.py` reads them out of
  `dict(res.headers)` — the case that came off the wire. Lowercase cost four
  CORS failures and one `Content-Type` failure that were pure artifact. The
  kit's own adapter capitalizes them; so does this now.

## Traces (Phoenix, self-hosted)

Every run is a span tree: `invoke_agent` → one `chat <model>` per model
request (messages in and out, tokens, cost) → one `execute_tool <name>` per
tool call (arguments, return). Pydantic AI emits them as OpenTelemetry;
`core/tracing.py` adds the OpenInference processor Phoenix reads and posts
them straight to Phoenix's OTLP endpoint. No Logfire, no collector, no
account.

- Viewer: http://127.0.0.1:6006 (the `phoenix` service in the compose,
  loopback only, data under `state/phoenix/`).
- `CORE_OTEL_ENDPOINT` empty = off. The lab compose points it at the
  service; a client's compose leaves it empty or sets
  `CORE_OTEL_INCLUDE_CONTENT=0` so the spans carry timings and names but no
  prompts, completions or tool arguments.
- **The bytes of an image never travel**, on the lab either:
  `InstrumentationSettings(include_binary_content=False)`. Every post this
  agent makes carries a PNG back through `generate_image` and into the model's
  history, and base64 in a span turns a few kB of text into megabytes of trace
  that nobody can read. The part is still in the span; its content is not.
- REST for scripts: `GET /v1/projects/default/spans?limit=50`.
