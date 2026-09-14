# tuagente.uy's own agent: a post a day — plan

Written 2026-09-14, the day after the engine decision (`docs/PENDING.md`).
First real workload on the engine: **our own agent produces one Instagram
post every morning, and Luis sees it in the portal and downloads the images.**
Nothing is published; the Instagram connection and the gate to publish come
later, when there is something worth gating.

Why this one first: it forces the two things the engine does not have, runs
started by the clock and a tool that calls an outside API, it produces
something to look at every day, it has no outward side effect, and if it
breaks it breaks on us.

What this plan is NOT: a port of the Hermes flow plugin. That plugin was
revalidated on 2026-09-14 and most of it was Hermes tax (`docs/PENDING.md`,
"The engine: Pydantic AI, decided"). What survives is the product concept: a
flow is named client work with a trigger, a status and a body the client
reads. The mechanism is rebuilt in the engine, smaller.

## What it must prove (the gates)

| # | Gate | How it is verified |
|---|---|---|
| G1 | **The clock starts a run, and it cannot start twice.** A flow with `cron: */1 * * * *` runs every minute in its own session; `flow_runs` gets one row per tick; `docker kill` during a run and restart → the overdue tick runs once, the killed run reads `error`, no tick runs twice. Pause stops it, resume restarts it, run-now starts one right away. | `engine/tests/test_flows.sh` against the running container: writes the FLOW.md, watches `/api/jobs` and `/portal/flows/{slug}`, kills, counts rows. |
| G2 | **The Flows tab works on the engine unchanged.** The list, the detail page with "how I work", the banner (ran, how it went, next time), pause / resume / run-now buttons, and no "uncertain" state, because both endpoints come from one reader. | `portal-check.py` 0 failures with `flows` declared; browser walkthrough. |
| G3 | **The agent creates a flow with one tool, and the promises guard reads real flows.** Asked "todos los días a las 9 dejame un posteo", the agent calls `create_flow`, the file appears, `/api/jobs` shows it, and the answer names the next run. Asked for something repetitive and NOT creating it, the persisted answer carries the correction. | One live turn each; `engine/tests/test_promises.py` reads flows instead of `jobs.json`. |
| G4 | **An image is generated through OpenRouter, saved, and seen.** `generate_image("…")` returns the picture to the model, the PNG lands under the workspace, and the model's next message describes what is in it (it looked). | `engine/tests/test_image.py`, one call, ~US$0.02. |
| G5 | **The daily flow runs end to end on our own agent, locally.** At the scheduled minute the agent writes a post in the brand's voice, generates the feed image, checks it, saves the post through `save_post`, and the Posts tab shows it with caption, alt, hashtags and a working download. Nothing is written outside `posteos/`. | Set the cron two minutes ahead, wait, open the tab, download the PNG. Then a second run the next tick produces a different idea. |
| G6 | **Nothing else regressed.** Crash test, compaction, memory, kit unit tests, `check-plugins`. | The existing suites. |

## Decisions (made, not to be re-derived by the implementers)

### Flows live in the engine

- **`flows/<slug>/FLOW.md` is the only source of truth.** No job store. The scheduler derives the jobs from the frontmatter on every tick, so nothing can be created and not scheduled, nothing can be orphaned, and changing the trigger is editing the file. Frontmatter: `name`, `client_summary`, `trigger` (`schedule` | `request`), `trigger_detail`, `cron` (required iff `schedule`), `timezone` (default `TZ`), `status` (`active` | `paused`), `connections`. Body: the steps the client reads, then `## Notas técnicas` which the portal strips and the run prompt keeps. **No `results:` field**: where the output lands is the business of the plugin that produces it.
- **The scheduler is one asyncio task** started with the app: every 30 s, for each active `schedule` flow, compute the next occurrence after the last scheduled run (or the process start) with `croniter`; if it is due and no row exists for `(slug, scheduled_at)`, start a run. Missed ticks while the process was down collapse into one run. Minimum frequency five minutes, enforced by the `Flow` validator, except under `CORE_FLOWS_MIN_MINUTES=1` for the test.
- **A run is a headless session.** Kind `flow`, titled `<name> · <dd/mm HH:MM>`, one user turn built from the body and the notes, the same `run_turn` as a chat turn: same tools, same gate, same hooks, same compaction. A run that hits the approval gate pauses like a chat turn does and its card says which flow asked. **A run may execute twice after a crash**; the row claimed first is what prevents it, and a flow's body is written to be safe per day (the social one checks `posteos/` for today before writing).
- **Runs are rows**: `flow_runs(slug, scheduled_at, session_id, started_at, finished_at, status running|ok|error, error, manual)`, primary key `(slug, scheduled_at)`. Every transition writes an event (`flow.started`, `flow.finished`, `flow.failed`), so Activity shows them and a failed run is visible without any prose asking the agent to say so.
- **One tool to create, one to pause.** `create_flow(spec: NewFlow)` where `NewFlow` is the Pydantic model with the rules the old script enforced (slug shape, cron iff schedule, up to 7 steps of up to 320 characters, connections list, minimum frequency). It returns `missing_connections` and the next run. `set_flow_status(slug, active|paused)`. Editing the body is editing the file, which the agent can do with the workspace tools. The tool descriptions carry the rules about using them; the engine's instructions carry the three behaviours code cannot check: close the contract before creating, create first and tell after, run the first round right away.
- **The portal contract is kept, from one reader**: `GET /portal/flows` and `GET /portal/flows/{slug}` with the shapes `lib/agent.ts` already types (`trigger_job` finally published as `flujo-<slug>`, `results` and `results_total` empty and kept for the shape), `GET /api/jobs?include_disabled=` with the `CronJob` shape (`next_run_at` from croniter, `last_run_at`, `last_status`, `last_error` from the row), `POST /api/jobs/{id}/{pause|resume|run}`. The tab needs no change; its "uncertain" branches simply stop firing.
- **The promises guard** stays as it is and reads `flows.read_all()` instead of the cron file. It moves into the engine (`core/promises.py`), and the `flow` plugin's `core/` surface, `engine/promises` surface, `create_flow.py` and its skill are deleted, not adapted. The seven curated flow bodies stay on disk under the plugin until their capability is rebuilt, and each is revalidated then.
- **`PREFERENCIAS.md` is not rebuilt.** The memory notebook with extraction is the same thing.
- **Triggers now: `schedule` and `request`.** Drive and webhook are the same loop with another due check, built when a capability needs them.

### Images are a plugin on Pydantic AI's capability

- **`kit/plugins/image/`**, core surface only. It registers Pydantic AI's `ImageGeneration(native=False, local=<ours>, dimensions=…)` capability, which gives the model one `generate_image` tool and returns the picture to the model as an image, so it looks at what it made.
- **The generator is ours** because the capability's direct generators dispatch only on `openai`, `google` and `xai`. Ours calls OpenRouter's chat completions with `openai/gpt-5.4-image-2` (checked 2026-09-14: listed, image output, US$0.000015 per token) using the same key as everything else, decodes the returned image, writes it to `workspace/imagenes/<date>-<n>.png`, and returns the `BinaryImage`. One provider, one key.
- Formats: `feed` (1080×1350), `square` (1080×1080), `story` (1080×1920), mapped to the model's supported sizes by the generator; the tool argument is the format name, not pixels.

### The social capability owns its files and its view

- **`kit/plugins/social/`** replaces `social-content`, `post-image` and `brand-kit` for this engine. Those three are Hermes-era; their skills and scripts are read for what they learned (the checklist, the caption formula, the 5-hashtag cap, "deliver what is good even if a piece failed") and rewritten, not mounted. `brand-kit` is not needed: the brand is data the client's workspace carries.
- **Brand data is a file**: `marca/brand.md` in the workspace, written at onboarding. For our own agent it is `social/brand.md` copied over. The skill reads it; the code does not parse it.
- **The format is code.** `save_post(slug, caption, alt, hashtags ≤ 5, format, images)` writes `posteos/<YYYY-MM-DD>-<slug>/post.json`, `caption.md` and `01.png…`, and refuses a second post for the same day unless `replace=True`. Prose never tells the agent where files go.
- **The view is a portal module**, `app/app/posts/`, shown when the manifest flips `posts`. It reads `GET /portal/posts` (newest first: `id, date, format, caption, alt, hashtags, images: [url]`), `GET /portal/posts/{id}` and `GET /portal/posts/{id}/{file}` for the bytes, all served by the plugin's router from its own folder. Cards with the image, the caption with a copy button, alt text, and a download per image. Portal conventions as in `CLAUDE.md`; a route param documented in `docs/portal-routes.md`.
- **The Files tab keeps showing `posteos/`.** A person can navigate it. It is not the default view of anything.
- **No generic "results" system.** A second capability with output brings its own module the same way. Generalize when three look alike.

### Our own agent is a client

- A second engine instance on Luis' Mac (`engine/` compose with another project name and ports 8652/8653), identity «Tu Agente» for «tuagente.uy», `CORE_PLUGINS=approval,memory,image,social`, `marca/brand.md` from `social/brand.md`, and the daily flow created through the chat, not by hand, because that is G3.
- The flow's body, in Spanish for the client, in seven steps: review recent posts to pick a different idea, write the copy in the brand's voice with verifiable claims only, generate the feed image with the kit's colours, look at it against the checklist, save the post, and stop. Technical notes name the tools.

## Layout

```
engine/core/flows.py            Flow model, read_all, write, next_run
engine/core/scheduler.py        the loop, run(), the rows
engine/core/promises.py         the guard, reading flows (moved from the kit)
engine/core/tools/flows.py      create_flow, set_flow_status
engine/server/flows.py          /portal/flows*, /api/jobs*
engine/tests/test_flows.sh      G1
engine/tests/test_image.py      G4

kit/plugins/image/       plugin.json, core/plugin.py, core/generate.py
kit/plugins/social/      plugin.json, core/plugin.py, core/posts.py (save_post + routes),
                                core/instructions.md, skills/post/SKILL.md (voice, checklist, formula)
app/app/posts/                  the module: page.tsx, api.ts, an intro in lib/intros/
```

## Waves

1. **Flows in the engine** (Opus): `flows.py`, `scheduler.py`, the tools, the routes, promises moved, `flow` plugin's engine-side files deleted, `config.MODULES["flows"] = True`. Gates G1, G2, G3, G6.
2. **Image plugin** (Opus): the generator, the capability, the test. Gate G4.
3. **Social plugin and the Posts module** (Opus, two agents, one per side, the contract above between them). The skill prose is written from the three old skills' lessons, in Spanish, short.
4. **Our agent** (me): the second instance, the brand file, the flow created in chat, two mornings watched. Gate G5. Screenshots into the verdict.
5. **Independent validation** (fresh context): rerun every gate from the docs; probe a run that pauses at the gate, a run killed mid-image, and the day the model returns no image.

## Out of scope, on purpose

Publishing to Instagram and the gate for it; the Telegram ping; the VPS deploy of the engine; Drive and webhook triggers; a generic results view; rebuilding the seven curated flows; the kanban board.

## Risks named up front

- **Text inside generated images.** gpt-image-2 may misspell Spanish. The checklist step exists for this; if it fails often, the fallback is the template renderer in `social/` (HTML to PNG), which needs Chrome in the container.
- **A run that pauses at the gate** blocks nothing today (no sensitive tool in this flow) but the card must say which flow asked, or the client cannot tell a morning run from a chat. Wave 1 sets the session kind and title; the approval plugin reads them.
- **Two engine instances on one Mac** share nothing but the kit mount; the compose project name and the state dir must differ, or the second `up` silently reuses the first's database.
- **OpenRouter account balance** is near zero; top up before wave 2.
