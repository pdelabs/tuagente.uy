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
| `workspace/` | the agent's only writable ground: `entrada/` in, `entregables/` out, `correo/` what came attached to a mail, `memoria/` what it remembers about the client, `flows/` what runs on its own, `imagenes/` what it drew, `posteos/` the finished posts, `marca/` the brand it writes with — `brand.md` and the fixed assets `place_image` pastes onto a slide |
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
is the clock, which is the engine's own (see **Flows** below). The ones this
engine runs by default —
`CORE_PLUGINS=kanban,approval,deliverable,memory,image,instagram,social,mail` —
are the kit's own plugins, in dependency order (`requires.plugins` in each
manifest says who must come first, and `instagram` is also in front of `social`
because `social` asks it for two things by name), and each one declares `"surfaces": {"core": "core/"}` in
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
  core/tools/web.py                web_search, web_fetch: the web, with no key
  core/tools/flows.py              create_flow, set_flow_status
  core/db.py, server/*.py          storage, the two bases, the SSE dialects
  server/flows.py                  /portal/flows*, /api/jobs*

kit/plugins/kanban/core/    the board: board_store.py (the tickets, the
                                   five statuses, the dedupe key, closed_at),
                                   board_routes.py (/portal/tickets*),
                                   board_tools.py (create_ticket,
                                   update_ticket, ungated), instructions.md
kit/plugins/approval/core/  the gate, and NO toolset of its own:
                                   store.py (the row), render.py (what she
                                   reads), routes.py (/portal/approvals*; the
                                   THREAD is read through the board's route),
                                   instructions.md, and SKILLS = []
kit/plugins/mail/core/      the inbox: mail_store.py (the connection
                                   and the two tables), mail_imap.py (the
                                   folder, the parsing, the discards),
                                   mail_smtp.py (the reply and its headers),
                                   mail_tools.py (fetch_mail, and send_email
                                   behind the gate, with its card),
                                   instructions.md, skills/inbox/SKILL.md and
                                   flows/bandeja-de-entrada/FLOW.md
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
                                   makes it), looks.py (which look a post
                                   wears and which rest today), posts.py
                                   (save_post, the reader and the
                                   /portal/posts* routes),
                                   creator.md, instructions.md, and
                                   skills/post/SKILL.md, the craft
kit/plugins/instagram/core/ the other half of the account: ig_graph.py
                                   (the Graph calls, and the token in force),
                                   ig_store.py (the comments and the messages
                                   already handled, the thread's other side
                                   with its 24-hour clock, and the account's
                                   own row), ig_tools.py (fetch_comments,
                                   fetch_messages and refresh_if_due on the
                                   face, reply_comment, hide_comment and
                                   send_message behind the gate with their
                                   cards, and recent_performance for the
                                   creator), instructions.md,
                                   skills/comments/SKILL.md and flows/instagram/
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
| `engine.use(name)` | one of those, by name. `engine.use(name, default)` makes it OPTIONAL — for the plugin that may not be installed, not for the one the manifest requires |
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
has to explain is in the gated tool's docstring and in `ApprovalNote`'s fields. In
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

**THE CREATOR SEES THE SLIDE IT FIXES** (`view_slide`). A fix used to travel
as text all the way: the portal's one sentence, the face's delegation, the
brief in `post.json`. The creator's only reader opens text, so it rewrote a
brief for a picture it had never seen — fine for «otro fondo», blind for «el
texto quedó cortado». `view_slide(post_id, number)` hands back the picture the
way `generate_image` does, and `creator.md` has it look before touching the
brief and compare after generating. Measured on the lab: `view_slide`, two
`generate_image`, `replace_slide`, and the headline came back bigger with the
rest of the slide as it was.

The same run found a hole in `replace_slide`: it moved the old slide out BEFORE
reading its brief, and a post saved before briefs were kept (no `prompts`)
died there with the slide missing. It reads everything first now, and such a
post's missing briefs are `None`. Two of our own agent's posts are that old.

**NO TWO POSTS ALIKE IN A ROW, AND CODE IS WHO SAYS SO** (`looks.py`). On our
own agent every post came out dark with thin violet lines (2026-09-20): the
brand file called that look the default, the skill's checklist called it «the
brand», and a model left to choose picks the safe one every day. Nothing about
how posts are made changed to fix it; two things did.

- **The brand declares its looks, as many as it wants.** Every heading
  «### The `name` block» in `marca/brand.md` with a fenced block under it is
  one: the text a slide's brief starts with, word for word. The kit names no
  look. Ours has four, `violet`, `amber`, `photo` and `object`, with one real
  slide of each in `social/looks/`; `ink` and `light`, the two with thin violet
  lines, were retired on 2026-09-21. The skill's checklist says «the look you
  chose» where it used to say «dark background».
- **The look of a post is read off its first brief**, by which block it
  carries, so the model declares nothing and the posts from before have one
  too. `save_post` writes it to `post.json` as `look`.
- **Half the wardrobe rests.** The looks of the last `len(looks) // 2` posts
  are off today: strict alternation with two looks, the last three with six.
  The creator reads it as a CALLABLE instruction (`creator.todays_look`), so it
  is the state of the folder on this delegation and not a rule to remember:
  what the last posts wore, what rests, what is free.
- **And `save_post` refuses a resting look BEFORE IT MOVES A FILE** — the
  pictures stay in `imagenes/` with their sidecars (`peek_brief`, which reads a
  brief without consuming it), no post exists, and the refusal names what is
  free. `look_asked_by_client=True` is the way through when the request names
  a look in so many words.

```bash
python3 engine/tests/test_looks.py   # free, a second, no model
```

Seven claims, on a brand file written for the test and put back on the way out.

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
registers its own. Not on the creator — a sub-agent never talks to the
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
the mail plugin's is. The pictures are never touched by a correction: a slide
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

### The comments and the messages, which are the other half of the account

**PUBLISHING IS THE SOCIAL PLUGIN'S AND READING IS `instagram`'s**, and they are
two plugins because a client buys either one on its own: somebody who posts by
hand still drowns in comments, and somebody who buys the posts may not want us
answering anybody. `kit/plugins/instagram/` is the reading half — the capability
row is `instagram-comments` — over the same door publishing uses
(`graph.instagram.com` v21.0, the same long-lived token, the
`instagram_business_manage_comments` scope it already carries).

**READING IS A FLOW, AND WHAT FIRES IT IS CODE.** The plugin ships
`flows/instagram/FLOW.md` — «Instagram: comentarios y mensajes»,
`trigger: event`, `event: instagram.inbox` — and registers the watcher behind
that name, `ig_tools.watch`: every thirty seconds, with no model, it asks the
Graph for the feed and the conversation list. A post whose `comments_count`
moved is opened; a conversation whose `updated_time` moved is read; nothing
else is, so A QUIET LOOK IS TWO CALLS. Every fifteen minutes a look opens
everything anyway, because the marks are a shortcut Instagram owes us nothing
about. What it finds is the text the run receives («A flow that runs when
something arrives», below), the token's sixty days are renewed from the same
function, and the fetch tools stay on the face for when somebody asks in the
chat. It was a `*/15` cron until 2026-09-20; `UPGRADED` in `plugin.py` is what
moves an installed copy that nobody edited over to the new file, by hash, the
same way `SUPERSEDED` retires a renamed one.

The plugin COPIES THE FLOW INTO `workspace/flows/` WHEN IT LOADS, if it is
not already there and never over what is. The kit is a read-only bind mount and the workspace is the client's, so
there is no install step between them on this engine; a flow turned off is
`status: paused`, which is still a file, so a restart does not switch it back
on. The `mail` plugin does the same thing in the same shape, and the day the
engine grows one helper for it both plugins will use that instead.

**AND A CURATED FLOW THAT GETS RENAMED IS RETIRED, NOT ORPHANED.** That flow was
`comentarios-instagram` until the messages joined it, and a plugin that only ever
copies would have left the client with two flows reading one account every
fifteen minutes. So the plugin also carries `SUPERSEDED`: a slug it used to ship
with the **sha256 of the exact bytes it shipped**. An installed copy that still
hashes to that is deleted; anything else — she paused it, the agent edited it —
is left alone and says so in the log, because a file two people have a claim on
is not one code should decide about quietly. Measured on the lab: the old folder
went, the new one landed, and the Flows tab shows one card.

**INSTAGRAM'S DIRECT MESSAGES ARE IN, AND THE «ADVANCED ACCESS» STORY WAS
WRONG.** `kit/connections/instagram/README.md` said for a year that
`instagram_manage_messages` needed Meta's review even on our own account. Probed
on 16/9/2026 with the token we already had: `GET /v21.0/me/conversations?
platform=instagram` answers `{"data": []}` — an empty inbox, not a permission
error. Messages live under the same rule as everything else on that connection;
what gates them is the CLIENT's own app, «Permitir acceso a mensajes»
(Configuración → Mensajes y respuestas a historias), a consumer setting no
dashboard can see.

**THE PERSON IS THE UNIT, NOT THE MESSAGE**, and that rule cost a real
conversation on our own account (16/9/2026, trace
`0e51460eb36805965a55545755fd2924`). The tick handed back only what was new —
«hola buenas leyeron mi mensaje?» — so the agent answered «sí, vimos tu
mensaje» and asked its qualifying question, never answering the one two messages
up. The context was on the ticket and nothing made it read it. So BOTH ticks now
hand back THREADS: every conversation with something new comes back whole
(oldest first, ours named «Vos», the new ones marked «(nuevo)», the board's
ticket named when there is one), and a new comment comes back with its post, its
parent and the replies already under it. What is NEW is a fact about a row; what
to ANSWER is a fact about a conversation, and no prose can ask a model to go and
find it.

**`fetch_messages()` IS THE SECOND HALF OF THE TICK.** The threads
(`GET /me/conversations?platform=instagram&fields=id,updated_time`), then each
one's messages expanded in the same call
(`?fields=messages{id,created_time,from,to,message}`) — the documented fields and
no others, because a field this flavor does not serve fails the whole call, and
expanded because the documented alternative is one call per message and this
connection has two hundred an hour. Ours are told apart by `from.id`, which is
the account's own id; theirs are new if `instagram_messages` has not seen them.
EVERY message is written down and only the new inbound ones are listed — the
card shows a conversation, and half a conversation reads like a person talking to
a wall. Nothing new: «Sin mensajes nuevos.»

**THE 24 HOURS ARE META'S AND THEY ARE ON THE CARD.** An app may answer a person
up to 24 h after their last message, and each message of theirs starts it again;
`instagram_conversations.last_inbound_at` holds that clock and only ever moves
forward, so reading a thread twice cannot reset a window. `send_message(
conversation_id, text, note)` is gated like the rest and **takes no recipient**:
the IGSID comes off the conversation, which is the only way a model cannot
address a stranger. The card is the person, the window, the ticket, the last ten
messages as table rows oldest first with ours marked, and the draft as the
editable tail. The window is
checked AGAIN in the tool body — a request can sit in the queue overnight — and
past it the tool sends nothing and answers the sentence that says so and says to
use the board instead. The send itself is the one call in this kit that is JSON
with a Bearer header: `POST /{IG_USER_ID}/messages` with `{"recipient": {"id":
…}, "message": {"text": …}}`, which is how Meta documents it.

**A FIRST MESSAGE IS A LEAD, AND A THREAD IS ONE TICKET.** `source="instagram-dm"`
with the CONVERSATION id as `source_ref`, so the second message of the same
person does not open a second ticket — what they say afterwards is a comment on
the one that exists. The skill carries the rest: warmer than a comment, one
question back to qualify, never a price but the diagnóstico's, never a date,
never a conversation carried past where the client would carry it.

**A TICK WITH NOTHING NEW IS ONE LINE.** `fetch_comments()` reads the last ten
posts (`GET /{IG_USER_ID}/media`), then each one's comments with the replies
NESTED (`…/comments?fields=…,replies{…}`), skips the account's own by username,
writes what is left into `instagram_seen` and answers a listing — each comment's
id, the post it is under, who wrote it, what it says, whether it is a reply. If
there is nothing: «Sin comentarios nuevos.», and the run ends there.

**THE USERNAME IS NOT AN ENV.** It is read once from `GET /me?fields=username`
and cached, because it is a fact about the token and not a decision the client
makes — and it is the whole mechanism for telling our own answers apart: the
Graph hands them back nested under the comment they answer, and an agent that
read its own reply as new would answer itself every fifteen minutes.

**ANSWERING AND HIDING GO THROUGH THE GATE**, like everything this product does
outwards. `reply_comment(comment_id, text, note)` is `POST /{comment-id}/
replies` and `hide_comment(comment_id, note)` is `POST /{comment-id}?hide=true`
— hiding, never deleting: it can be undone from the app and the author still
sees it. Both draw their own card through the approval plugin's renderer hook
(`engine.provide("approval.render.reply_comment", …)`), READ OFF DISK and never
off the Graph, because the card is rendered inside the pause path and a network
call there is a run that dies holding a request nobody sees. The card is the
post — its permalink and its first slide, when the media id matches a post in
`posteos/` — then the comment, in a table, and then the draft answer, which is
therefore the editable tail the portal preloads: the client's correction
REPLACES the text, the way a caption's does. Both tools refuse an id that is not
in `instagram_seen`, in Spanish, before anything leaves.

**A LEAD IS A TICKET**, and it is the board's own `create_ticket` with
`source="instagram"` and the comment id as `source_ref` — the pair that is a
UNIQUE index over there, so the same comment never opens two. What makes a
comment a lead, what gets answered, what gets nothing and what gets hidden is
`skills/comments/SKILL.md`; the reply invites them to the address on
`marca/brand.md`, because **DMs are not built and cannot be**:
`instagram_manage_messages` needs Meta's Advanced Access even on the account's
own owner, and `plugin.json` names it as a known limit.

**THE CREATOR READS THE NUMBERS BEFORE IT WRITES.** `recent_performance()` is
the last ten posts with their date, caption, permalink, reach, saves, likes,
comments and shares (`GET /{media-id}/insights`), and it is on the CREATOR
sub-agent and on nobody else: what got saved is what to do more of, and that is
decided before the first word. The plugin offers it as a toolset
(`engine.provide("instagram.performance", …)`) and the social plugin's creator
takes it with `engine.use(name, default=None)` — a real optional dependency,
which is why that default exists at all — so `instagram` loads BEFORE `social`.
Step 2 of the post skill says what to do with it.

**THE TOKEN STOPS DYING SILENTLY, AND THE ENV IS NO LONGER WHERE IT LIVES.**
`refresh_if_due()` is the flow's first step: with fewer than ten days left (or
nothing known about the expiry, which is the state after a connection is set
up) it calls `refresh_access_token`, stores the new token and its expiry in
`instagram_account`, and every Graph call — this plugin's AND the social
plugin's publish — reads that table first and `IG_ACCESS_TOKEN` second. The env
is the SEED and the table is what is in force: the instance's `secrets.env` is
outside the container and nothing in here can write it, so before this a
refreshed token lived in one process's `os.environ` and died with it, which is
exactly how a connection that refreshes itself still expires after sixty days.
The two plugins share it by name — `engine.provide("instagram.token", …)` and
`instagram.token.refreshed` — never by importing each other's module: every
enabled plugin's surface modules live in one `sys.modules` namespace, so an
import would be a bet on which of the two loads first. An agent with publishing
and without comments has no table and nothing changes for it.

```bash
python3 engine/tests/test_instagram_comments.py   # free, a second, no model
python3 engine/tests/test_instagram_messages.py   # free, a second, no model
bash engine/tests/test_comments_gate.sh           # ~2 min, ~US$0.02, three turns
```

The first one is the mechanism, with the Graph behind an `httpx.MockTransport`
and a throwaway post on disk: eight claims — the tick that walks the replies and
skips our own, the second tick that says «Sin comentarios nuevos.», the answer
posted under the right comment with the right text, the correction that replaces
it, the spam hidden and nothing deleted, an id nobody saw refused by both tools,
the card with the slide and the draft as its editable tail, the numbers the
creator reads, and the token renewing itself and being what the NEXT call goes
out with.

The second one is the messages, and it is the only place both clocks can be
asserted — the window, which a live test would have to wait a day to watch shut,
and the thread, which needs a second tick to be a thread at all. Six claims: a
tick that comes back with whole conversations, with the time left and the ticket
on each; THE NUDGE — a second tick carrying one new message and the question
from three messages up, unmarked, which is the regression this rule was bought
with; the documented send (the JSON body, the IGSID off the conversation, the
Bearer header) with the correction replacing the text; a thread whose last
message is twenty-five hours old refused with the sentence that says what to do
instead; a conversation nobody saw refused; and the card with the thread as
table rows, oldest first, and the draft as its tail.

The third is the gate, live, with `IG_*` unset — which is why it can be run as
often as it likes. Three turns: the tick answers «falta conectar Instagram» and
ends normally instead of dying; a seeded comment is answered, the run pauses,
the card carries the post, the comment and the draft below the last table row,
and the client's yes comes back with the missing connection — an answer and not
a dead turn; and the same door for a direct message, whose card carries the
person, what she wrote and how much of the 24 hours is left. Last run
2026-09-16: **0 failures**.

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


**A BRIEF CUT IN HALF NEVER REACHES THE DELEGATE** (`delegation.Delegation.
before_tool_execute`). The client wrote a slide's new text between double
quotes, the face copied her words into the brief, the model did not escape the
first `"`, and in a tool call's JSON that quote ends the string: the creator got
«El cliente pidió: «Saca el» and nothing else, twice, and the face's third,
whole brief hit `max_calls`. The face quotes the client between « » (the
capability's own instructions now say so, and never double quotes), so a brief
that opens « and never closes it stopped mid-quote: it goes back to the face as
a `ModelRetry` BEFORE the delegate runs, which costs a retry and not one of the
delegations. And the portal turns the client's double quotes into « » in the
«Arreglar esta imagen» request, where most of them are typed.
`python3 engine/tests/test_delegation_guard.py` is the gate.

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

In the Inbox the same five are read as a conversation: `ready` is «Nuevo»,
`in_progress` «En curso», `blocked` «Esperando tu ok», `done` «Respondido».

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

**A CHANNEL TICKET IS A CONVERSATION, AND IT LIVES IN THE INBOX.** `mail`,
`instagram` and `instagram-dm` are somebody who wrote in and is waiting for an
answer; `client`, `agent` and nothing are work. `GET /portal/tickets` takes a
`?source=`: `channels` answers with the three (the Inbox, `app/app/inbox/`),
`work` with everything else (the Board), and a bare list of sources
(`?source=mail,instagram`) with exactly those. With no `?source=` it is the
whole board, unchanged — that is the call `portal-check` makes. There is no
second store and no second route: one list, asked two ways. Which sources are
channels is `board_store.CHANNELS`' to say, so the portal asks for the screen
it is drawing and never for a list of plugin names.

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

**THIS PLUGIN REGISTERS NO TOOLSET, and that is what it is now.** It used to
ship two fake sensitive tools so the gate could be shown to work with nothing
real behind it: `publish_post`, which dropped a markdown file in
`workspace/outbox/` and answered «Publicado en <canal>», and `send_email`,
which dropped one and answered as if a mail had gone out. Both are gone, each
one the day the real thing arrived — the social plugin's `publish_instagram`
(**Publishing**, above) and the mail plugin's `send_email` (**Mail**, below).
Two tools with one name, one of them fake, is the model choosing between them
by the shape of a sentence, and `workspace/outbox/` went with them.

What is left here is the MACHINERY and all of it: the wrapper is Pydantic AI's
and the plugin that owns the tool applies it, while the row, the negotiation,
the resume, the card, the page and the one `DEFERRED_HANDLER` that answers a
stopped run are this plugin's. Every gated tool draws its own card through the
renderer hook; a gated tool that files none is read as its name and its
arguments, which is true, ugly, and the reason both of them file one.

## Mail

The inbox is a PLUGIN — `kit/plugins/mail/`, loaded because `mail` is in
`CORE_PLUGINS` — and it is the first thing that writes into the board on its
own. What it sells is one sentence: **every mail becomes a ticket the client
already knows how to read, and the answer waits for her yes.** Take it out of
the list and the agent has no mailbox, no `fetch_mail`, no `send_email` and no
inbox flow; nothing else changes.

**READING IS A FLOW, NOT A LOOP.** The plugin ships one curated flow,
`bandeja-de-entrada`, `*/5 * * * *` — the engine's floor
(`CORE_FLOWS_MIN_MINUTES`) — and its run is one tool call away from doing
nothing: with an empty mailbox `fetch_mail()` answers «Sin mails nuevos.» and
the turn ends there, for about US$0.001. The FLOW.md is copied into
`workspace/flows/` when the plugin loads and NEVER over a file that is already
there: there is no install step between a read-only kit and the client's
workspace, and what she edited is hers. Turning it off is `status: paused`,
which is still a file, so a paused flow is not copied back either.

**`fetch_mail()`** opens `EMAIL_FOLDER` over IMAP, takes the `UNSEEN` messages
oldest first and at most twenty, and for each one:

| what it is | what happens |
|---|---|
| a mail nobody wrote — `List-Unsubscribe`, `Auto-Submitted`, `Precedence: bulk\|list\|junk`, or our own `EMAIL_FROM` as the sender | a ticket opened and moved straight to `done`, with «Descartado: …» on it. It is counted under «descartados: N» and never offered to the model as something to answer |
| an answer to a conversation we have — an id in `In-Reply-To`/`References` that `mail_seen` knows | a COMMENT on that ticket signed by whoever sent it, and the ticket goes back to `ready` |
| anything else | `board.create(title=subject, source="mail", source_ref=<Message-ID>)`: who wrote, when, and the message as plain text |

and then marks it `\Seen` — AFTER the ticket exists, never by the fetch itself
(`BODY.PEEK[]`), because a message marked read by a tick that then died is a
message nobody will ever see again. `mail_seen(message_id, ticket_id, seen_at)`
is the second lock under that flag and the map a reply finds its thread by; the
id of every message WE send goes in it too, since the customer's next answer
quotes ours and not theirs. What comes back to the run is a compact listing:
the ticket id, the sender, the date, the subject and the first lines.

**HTML BECOMES TEXT BY CODE**, with the stdlib's `html.parser` and no
dependency — what the model reads is what a person would read. **Attachments**
are saved under `workspace/correo/<ticket_id>/` and listed in the ticket's
body, which is the one thing that needs the id before the body is finished:
`board_store.set_body` exists for that and has no other caller.

**`send_email(ticket_id, body, note)` IS GATED, ON THE FACE, AND HAS NO `to`.**
The recipient and the subject come off `mail_threads`, written by the code when
the mail arrived, so there is no way for the model to write to somebody who
never wrote — the same shape as `publish_instagram`, whose only argument is a
post id. The flow's prose moves the ticket to `blocked` with «Respuesta lista,
esperando tu ok» before calling it; the gate then stops the run, and the card
this plugin draws (`engine.provide("approval.render.send_email", …)`) carries
the recipient, the subject, the mail itself and the thread's comments QUOTED,
then a one-row table, then the draft. The table is load-bearing twice over: the
portal cuts a request's editable text after the last table row, so the box the
client edits is the answer alone — and the quoting is what stops a mail that
happens to contain a `|` line from moving that cut. A correction REPLACES the
body, because what comes back from that box is a finished mail.

On the yes it goes out over SMTP as `EMAIL_FROM`, with `Subject: Re: …`,
`In-Reply-To` and `References` set so it threads in the customer's mailbox; the
text is appended to the ticket as a comment signed by the address it went out
as, the ticket moves to `done` with that text as its outcome, and Activity gets
one `mail.sent`. On a no the ticket stays `blocked` and the agent proposes
again on the same row, which is what the approval plugin already is.

The environment, read at call time and each one named in its own Spanish line
if it is missing («Falta conectar el correo: no está EMAIL_IMAP_HOST»):

| variable | what |
|---|---|
| `EMAIL_ADDRESS` | the IMAP/SMTP login — the whole address on any provider worth having |
| `EMAIL_PASSWORD` | its password. On Gmail, an app password |
| `EMAIL_IMAP_HOST` | `host[:port]`, 993 and SSL by default |
| `EMAIL_SMTP_HOST` | `host[:port]`, 587 and STARTTLS by default |
| `EMAIL_FROM` | the address the answers go out as (`info@…`). Defaults to `EMAIL_ADDRESS` |
| `EMAIL_FOLDER` | the folder to read, `INBOX` by default. **On Gmail a label is a folder** |
| `EMAIL_TLS` | `0` for plain IMAP/SMTP. The lab's stub is that, and it is decided by this and never by the hostname |

**THE CRAFT IS `skills/inbox/SKILL.md`** and the «nunca» is what makes it
different from an autoresponder: no price that is not written in
`marca/brand.md`, no date ever («te escribimos con dos horarios», and the
ticket stays), nothing the company does not do, no other client's data, and
never «ya está hecho». A question the skill cannot answer is not answered
halfway: the draft stays, the ticket goes to `blocked`, and the comment asks
the client the one thing that is missing.

**THE LAB HAS A MAILBOX OF ITS OWN.** `greenmail/standalone` in
`docker-compose.yml`, SMTP 3025 and IMAP 3143 in the clear, with
`agente@lab.test` and `cliente@lab.test` as real accounts (GreenMail's login is
the LOCAL PART, which is why the lab's `EMAIL_ADDRESS` is `agente` while
`EMAIL_FROM` is the address). Nothing in these tests can reach a real address,
so they can be run as often as they like.

```bash
python3 engine/tests/test_mail.py        # free, seconds, no model
bash engine/tests/test_mail_gate.sh      # ~1 minute, ~US$0.01, one turn
```

The first is M1: four messages into the stub and `fetch_mail` called directly —
two mails are two tickets, the second tick says «Sin mails nuevos.», a reply
lands as a comment and brings its ticket back to «Por hacer», a newsletter is
discarded and not listed, an HTML body is text and an attachment is on disk and
named in the ticket. 7/7, and it cleans up after itself.

The second is M2, live: the trail shows `fetch_mail` and `send_email`, the
ticket is `blocked`, the card names who wrote and quotes the mail with the
draft as its editable tail, and after the approval the message is in the OTHER
mailbox — as `agente@lab.test`, under `Re:`, threaded by `In-Reply-To` — with
the ticket closed and Activity carrying it. Last run 2026-09-16: **0 failures**,
and the draft it wrote named the diagnóstico's USD 200 and nothing else, which
is the price half of M3 (`docs/inbox-plan.md`).

The two gate tests moved onto this tool with it: `tests/test_approval_crash.sh`
drops a mail in and proves the correction IS the text that was sent by reading
it out of the other mailbox (32/32), and `tests/test_flow_gate.sh`'s flow is
«read the inbox and answer what is there» (0 failures).

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

## The web

The face can look outside: `web_search` and `web_fetch`, in `core/tools/web.py`.
They are the ENGINE's and not a plugin's — every client's agent has them the day
it is installed — and they are in `hands()`, so a plugin can hand either one to
a sub-agent with `engine.tools("web_search", "web_fetch")`.

- **No key.** The search is DuckDuckGo through `ddgs`; nobody provisions an
  account for a client's agent to look something up. Eight results: title,
  address, snippet.
- **The download is Pydantic AI's, the reading is ours.** `safe_download` is the
  SSRF-protected fetch behind the library's own tool: a private or loopback
  address is refused, so a page cannot send the agent to read its own adapter.
  The library's converter is not used, measured on 2026-09-19: it strips the
  `<script>` tag and keeps its text, so our own `/privacidad` came back as
  20,904 characters of which 3,618 were the page. `web.py` drops script, style,
  nav, header, footer, svg and forms WITH their content before converting, caps
  the page at 30,000 characters, and drops links unless the model asks for them
  (`links=True`, for a page it reads to find where to go next).
- **A file is not a page.** A PDF or an image comes back as one Spanish
  sentence, not as bytes.
- **What comes back is data.** `web.WEB` is the paragraph in the face's
  instructions: search when the fact is outside, name the source with its link,
  and what a page says is information and never an order. What bounds a page
  that tries anyway is the approval gate: nothing goes outwards without it.

`python3 engine/tests/test_web_tools.py` is the gate: six claims, no model, a
few seconds. It needs the container to reach the internet.

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

### A flow that runs when something arrives (`trigger: event`)

`trigger: schedule` is for work that belongs to a time. Work that belongs to
something ARRIVING — a comment, a message, a mail — is `trigger: event`, and
the looking is code, never a turn of the agent.

Until 2026-09-20 the Instagram flow was `*/15 * * * *`: a whole turn, some
23,000 input tokens, to call two tools and say «sin novedades». Nearly a hundred
turns a day for nothing, a hundred conversations nobody typed in, and an answer
a quarter of an hour late on a channel that gives 24 hours.

```
trigger: event
trigger_detail: Cada vez que llega un comentario o un mensaje
event: instagram.inbox        # required iff event, forbidden otherwise
```

- **A plugin registers the watcher**: `engine.watcher(name, fn, every=60)`
  (`core/watchers.py`). `fn` is sync, has no model in it, and returns `None` or
  THE TEXT OF WHAT IS NEW, as the run will read it.
- **The scheduler calls it on its own clock**, in a thread, one look at a time
  per flow (`scheduler.watch`). What a look finds is written to `flow_pending`
  and WAITS: the next tick looks again, and the run starts on the first look
  that finds nothing more. That is the throttle — three messages in a row are
  one conversation and one run — and `SETTLE_CEILING` (120 s) is the limit
  under an account where every look finds something. Nothing runs on top of a
  run of the same flow that is still going.
- **On disk, not in memory**: a watcher marks what it found as seen when it
  finds it, so between the look and the run `flow_pending` is the only place the
  news exists. A restart in that window picks it up on the first tick.
- **The run gets it in its prompt**, last, under «## Lo que llegó», and the
  client reads the same in the run's conversation. The run looks for nothing.
- **A watcher that breaks is one `flow.failed` line in Activity**, not one per
  look: the same error twice is said once.
- **It has a task** (`/api/jobs`), so the tab pauses it, resumes it and runs it
  now; `next_run_at` is `null` and `schedule.kind` is `event`. «Probarlo ahora»
  is one look right now, and a run that says «No llegó nada nuevo» when nothing
  did.
- **The agent cannot create one**: `create_flow` offers `schedule` and
  `request`. An event flow ships with the plugin that owns the watcher.

A push from outside (Meta's webhooks) is a second reason to call the same
function, not a second mechanism. It lands here when an agent has a public URL
to receive it on; the poll stays under it, because Meta does not promise
delivery.

`python3 engine/tests/test_event_flows.py` is the gate: nine claims, no model.

### A run's conversation is opened from its flow

A run is a session of kind `flow`, and `/api/sessions` does NOT list it: a flow
that runs every 15 minutes is a hundred conversations a day nobody typed in,
and on our own agent (2026-09-20) they had buried the ones somebody did. The
way in is the flow's own page: `GET /portal/flows/{slug}` carries `runs`, the
last 24, each with its outcome and the `session_id` the portal opens in the
chat. A run that failed or is waiting for a yes also has its link in Activity
and in Approvals, as before.

`db.forget_quiet_runs` runs on every tick and deletes the CONVERSATION of a run
that went well, asked for no approval and finished more than
`CORE_FLOWS_QUIET_RUN_DAYS` (7) ago. The `flow_runs` row stays, so the history
still says it ran; its `session_id` comes back `null` and the row is not a
link. A failed run keeps its transcript, because that is where why is written.
No session of kind `chat` is ever touched.

`python3 engine/tests/test_flow_sessions.py` is the gate: five claims, no model.

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
- **A mail the client opens first is a mail the agent never sees.** IMAP's
  `\Seen` flag is the state the inbox flow reads, so anything she opens on her
  phone before the tick is already read and no ticket is ever made for it. The
  mitigation is the product's, not the code's: a filter that labels what
  arrives at the company address and `EMAIL_FOLDER` pointing at that label,
  which is an inbox only the agent touches. It is the clause the `email`
  connection row's `how` gained and the reason that row is `who: assisted`. If
  it bites anyway, the plugin switches to `SINCE` + `mail_seen` alone.
- **Two attachments with one name, on one mail, are one file.** They are
  written into `workspace/correo/<ticket_id>/` by the name the sender chose, so
  the second `factura.pdf` lands on the first. Real, unmeasured, and one
  `while target.exists()` away — which is a guard, and guards wait for the
  failure they protect against.
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
