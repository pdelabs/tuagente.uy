# The anatomy of what a placa costs

What gets paid when the agent generates an image, where it gets billed, and
what a finished placa really costs.

**Provenance.** Measured on Mr.Wobble's tree (`157.180.73.42`,
`/opt/agentes/tuagente/`), which ran the DEPLOYED kit; the containers are down
since 24/8 but the disk is untouched and readable (`fleet.md:129-160`). Every
file:line below has been re-cited against the repo, which is the source of
truth; where the deployed copy and the repo differ materially, both are named
and the difference is called out. The composite per-placa number this note
lands is the one `notes/team-pivot-status.md` pending item 1 says had never
been measured.

---

## The verdict, first

**US$0.10 per placa does not survive. The real number is US$0.357, 3.6x more
expensive.**

And the finding that mattered more than the number: **image spend did not
appear in either of our two ledgers.** Not in `costs.jsonl`, not in the
engine's `session_model_usage` table. 55 real generations over nine days left
exactly zero cost rows.

**That blind spot is FIXED as of `e4edeb1`** (24/8): the image route goes
through litellm now, like everything else, and a placa lands in `costs.jsonl`
as a row of its own. It took three switches, not one — section 11, item 1. The
first ledgered placa charged **US$0.224898**, which is the US$0.2266 this whole
note is built on, to within 1%. The number below did not move.

The blindness never reached the client either: the Usage tab stopped being
computed from those ledgers on 8/19 and now reads what OpenRouter charged the
agent's own key, images included
(`hermes-kit/adapter/portal_adapter.py:2535-2551`, `docs/PENDING.md:857-863`,
`docs/portal-routes.md:45-51`). See "What re-citing changed" at the bottom —
the note originally concluded the client was being shown 8% of the spend, and
the repo refutes that.

The US$0.10 did not come from nowhere either: it is, almost to the cent, **the
price of Seedream** — the cheap provider we ruled out because the plugin
cannot call it. We were quoting the route that does not run. Seedream was
measured live on 24/8 and it came out **cheaper than we thought and just as
unreachable**: US$0.035 a generation, 6.4x under what we run, and no
configuration of ours can call it (section 9). What *is* reachable today,
without touching the engine, is `google/gemini-3-pro-image` — 1.64x cheaper and
5.8x faster, one config key. That one is a decision for Luis, not a finding.

---

## 1. How an image is actually routed

There were **two distinct billing routes**, and that is the root of
everything below. There is one now — since `e4edeb1` (24/8), on any agent with
observability on — and the fix is described where it belongs, at the end of
this section.

**Chat goes through litellm.** On the deployed copy, `data/config.yaml:1-5`:

```yaml
model:
  base_url: http://litellm:4000
  provider: custom
  api_key: ${OPENROUTER_API_KEY}
  default: openai/gpt-5.6-luna
```

**In the repo that block reads differently and it matters.**
`hermes-kit/compose/config.base.yaml:1-4` ships `provider: openrouter` with no
`base_url` — straight to the provider, no proxy. The deployed shape is what
`tools/observability.sh:126-137` writes into an agent's `config.yaml` when
observability is turned on, and `:148-155` is what reverses it. So "chat goes
through litellm" is true of Mr.Wobble, not of a stock agent.

`litellm.yaml:10-13` forwards the `*` wildcard to `openrouter/*`, and the
callback at `litellm.yaml:41` (`litellm-cost.cost_logger`) writes every call to
the JSONL at `litellm-cost.py:34`. That callback takes `usage.cost` exactly as
OpenRouter returns it (`litellm-cost.py:81`), so **it is the real charge, not
an estimate** — its own docstring says so (`litellm-cost.py:14-17`).

*(Deployed/repo naming: the VPS copy is the pre-migration Spanish one —
`litellm-costo.py`, callback `litellm-costo.registro_de_costo`, ledger
`costos.jsonl`. Same file, renamed by `tools/migrate-agent-to-english.sh`. Line
numbers below are the repo's.)*

**The image does NOT go through litellm** — as of the tree this was measured
on, and of every agent up to 24/8. On the deployed copy,
`data/config.yaml:330-331`:

```yaml
image_gen:
  provider: openrouter
```

`provider: openrouter` is a **direct** route to the provider. It does not go
through `base_url: http://litellm:4000`, so it does not fire the callback, so
it writes no row. The engine's own behaviour here is documented in the repo, in
the one place that had to learn it the hard way — `tools/observability.sh:121-125`:

> WATCH THE PROVIDER, which is what took time to find: with
> `provider: openrouter` Hermes IGNORES base_url and goes straight through
> — the proxy stays up and never sees a single call.

**STILL TRUE OF THE ENGINE, NO LONGER TRUE OF OUR AGENTS — `e4edeb1`, 24/8.**
The engine does still ignore `base_url` for `provider: openrouter`; that is
`resolve_runtime_provider(requested='openrouter')` taking a path that never
reads the model block (`runtime_provider.py:1192-1207`). What changed is that we
stopped trying to route it from the config: `observability.sh on` now writes
`OPENROUTER_BASE_URL` into every home's `.env` — the one seam the plugin does
read — and the image fires the callback like any other call. So there are two
billing routes on a stock agent and **one** on an agent with observability on.
Section 11, item 1, for why the config could not do it.

**That `image_gen` block is not in `config.base.yaml` at all.** It is installed
by the capability: `hermes-kit/capabilities/catalog.json:239` carries
`"config": { "image_gen": { "provider": "openrouter" } }` under
`social-package`. A base agent has no image route; an agent that hired the
social package has exactly this one.

The model comes from `OPENROUTER_IMAGE_MODEL`, with the engine plugin's default
`openai/gpt-5.4-image-2` when it is unset. That variable **is not defined**
anywhere: not in `secrets.env` — whose template is four keys and no more,
`API_SERVER_KEY`, `OPENROUTER_API_KEY`, `TELEGRAM_BOT_TOKEN`,
`TELEGRAM_ALLOWED_USERS` (`hermes-kit/new-agent.sh:119-140`) — and not in the
compose. Its only mention in the whole repo is
`plugins/post-image/skills/post-image/scripts/generate.py:63`, and that is the
standalone Images-API script the agent is told never to run, not the engine
plugin. So the default runs. *(The env var is not the only way in:
`image_gen.openrouter.model` in `config.yaml` sets it too, and that is the key
the reachable lever in section 9 turns.)* And the tool's result, stored in
`state.db`'s `messages` table, says it outright:

```json
{"success": true, "image": "/opt/data/cache/images/openrouter_gen_20260816_131742_52cad48a.png",
 "model": "openai/gpt-5.4-image-2", ..., "aspect_ratio": "portrait",
 "modality": "text", "provider": "openrouter"}
```

**That payload carries no cost field.** The engine never finds out the price of
the image it just paid for. The repo already knew this and states it as the
cause of a 9x undercount: `portal_adapter.py:2539-2541` — `image_generate`
"hits the provider DIRECTLY -- it does not go through the proxy -- and it also
discards the `usage` the provider returns", and `docs/PENDING.md:894-897`
confirms it by inspection ("there isn't a single mention of `usage` or `cost`
in its code"). **The undercount is closed from the other side**: the payload is
still costless, but the proxy now reads the charge on the way past (section 11,
items 1 and 5).

---

## 2. The two gates: the handoff's hypothesis, refuted

The handoff assumed `check_image_generation_requirements` and
`check_bfl_requirements` were two image providers billing separately, and from
that deduced that the price of the pixel was independent of the role knobs.

**They are not two image providers. One of the two is not even image.**

`hermes-kit/capabilities/catalog.json:243`, in the `=== images ===` block of
`social-package`'s `internal_note`:

> VERIFIED on 2026-08-12 on an agent created from scratch: with
> `image_gen: {provider: openrouter}` in config.yaml, image_generate APPEARS in
> the tools (**check_image_generation_requirements turns True because the
> plugins/image_gen/openrouter plugin exists in the image and its
> is_available() only requires OPENROUTER_API_KEY**, which every one of our
> agents has). [...] **Do NOT use bfl: it's video and requires a paid Nous
> account.**

*(Citation drift: the deployed copy still had five separate rows —
`catalogo.json:44` for this text and `:120` for the Seedream text. In the repo
those five rows collapsed into one `social-package` entry on 2026-08-19 and
both texts now live in the same `internal_note` at `catalog.json:243`, each
component's note kept verbatim.)*

So:

- `check_image_generation_requirements` asks for **the same
  `OPENROUTER_API_KEY` that pays for chat**. There is no second billing
  relationship. Same invoice, same quota, same card. That is the model by
  design, not an accident: `notes/auxiliary-models.md:9-22` fixes one
  OpenRouter key per client, and its table at `:31-36` lists image generation
  under that same `OPENROUTER_API_KEY`.
- `check_bfl_requirements` is **video**, and it is dead for want of a paid
  account. `notes/capabilities-v2-draft.md:67` says the same about `video`.

And it is measured in production. `data/logs/agent.log:230` (plus 7 more, one
per boot):

```
WARNING tools.registry: check_fn check_bfl_requirements returned False; dependent tools will be unavailable this turn
```

`check_image_generation_requirements` **never** appears in the failure list —
the eleven gates that did fail are `_browser_cdp_check`,
`_browser_dialog_check`, `check_bfl_requirements`,
`check_close_terminal_requirements`, `check_computer_use_requirements`,
`check_focus_pane_requirements`, `_check_kanban_orchestrator_mode`,
`check_open_preview_requirements`, `check_react_requirements`,
`check_read_terminal_requirements` and `check_web_api_key`. The image gate
always passes; the bfl gate always fails. And `bfl` is still listed in all
three `platform_toolsets` rows (`compose/config.base.yaml:106`, `:119`,
`:132`) — which this note first read as "paying for its schema in the prompt
without delivering a single tool". **That reading is wrong, and it was measured
on 24/8: the same failing gate strips the tools BEFORE the schema is built, so
the line costs zero bytes.** Section 10.

**Handoff conclusion 1: right in the result, wrong in the mechanism.** The
price of the pixel really does not vary with the role's model or effort — but
not because a separate provider bills on its own; because **the image model is
a global config key** (`image_gen.provider` + `OPENROUTER_IMAGE_MODEL`),
outside the reach of the role knobs, charged to the same key.

### The loose end, closed: `profile_config.py`

The note could not open `hermes-kit/tools/profile_config.py`. It is readable
now, and the conclusion stands. **The file contains zero image-related keys** —
`grep -niE "image|pixel|img|visio|render"` over all 252 lines returns nothing.

It is worth being precise about why, because the mechanism is the opposite of
what "not mentioned" usually means. `profile_config.py:52-53` states the design:
"A DENYLIST, NOT AN ALLOWLIST, and that is the decision this file rests on."
`NOT_PROJECTED` (`:69-84`) holds exactly three top-level keys — `api_server`,
`platforms`, `gateway` — and everything else in the agent's `config.yaml` is
copied verbatim into each hired role's profile (`:202-209`). So on an agent
that hired the social package, `image_gen` **does** travel into every role's
profile config — as an identical copy of one global value, never derived from
the role. No role can hold a different image model, a different image provider,
or a different image price. The pixel is role-knob-independent, and it is
independent because the knob does not exist, not because it fails to travel.

---

## 3. The LOOK step DOES run on the role's model

`plugins/post-image/skills/post-image/SKILL.md` mandates three steps and warns
that none is optional (`:12`): build the brief, generate with `image_generate`
(`:47-55`), and **look at the image before showing it** (`:86-102`),
regenerating up to twice if something is wrong (`:98`). The plugin declares
both toolsets for exactly that reason: `plugins/post-image/plugin.json:26-33`
requires `image_gen` and `vision`, and its `_comment` at `:11-21` names which
step each one is.

That "look" is a call to the model, and the engine resolves it to the role's
**main model**. `agent.log:7121-7123`:

```
INFO agent.auxiliary_client: Vision auto-detect: using main provider custom (openai/gpt-5.6-luna)
```

On the local agent the same line reads `using main provider openrouter
(openai/gpt-5.6-luna)` — the difference is only `provider: custom` vs
`provider: openrouter`, i.e. whether litellm is in the middle. That local
reading is the one recorded in `notes/team-pivot-status.md:530-537`, which
draws the same conclusion from the other direction: "Vision resolves to the
MAIN chat model on the MAIN key — not a separate vision provider."

Because `provider=custom` points at litellm, **the LOOK step DOES land in
`costs.jsonl`** — unlike the pixel. And the engine separates it as its own
task: `state.db`'s `session_model_usage` has a `task='vision'` row per session,
distinct from `''` (main) and `'approval'`.

**Handoff conclusion 2: right in essence.** The composite cost per placa does
vary with the role knobs, through the LOOK and through the turns that decide.
What does not vary is the pixel, which turns out to be 92% of the total.

---

## 4. Breaking down `costs.jsonl`

666 rows, from 2026-08-16 02:17 to 2026-08-24 06:29 (Mac local time), totalling
**US$1.33837**. One single model in the whole file: `openai/gpt-5.6-luna`.
Source: 665 `upstream` (OpenRouter's real charge) and 1 `litellm`.

**There is not one row from an image model. Not flux, not bfl, not
`gpt-5.4-image-2`.** The schema (`litellm-cost.py:92-99`) holds only
`ts, model, input_tokens, output_tokens, cost_usd, source`: it attributes
neither provider nor task. *(True of this file, and of every agent's file up to
24/8. Since `e4edeb1` the pixels are rows like any other call — section 11,
item 1. The schema still does not carry the task.)*

### Per day

| day | calls | US$ | input tok | output tok |
|---|---:|---:|---:|---:|
| 2026-08-16 | 109 | 0.12211 | 5,203,896 | 64,947 |
| 2026-08-17 | 34 | 0.04724 | 1,649,967 | 19,594 |
| 2026-08-18 | 56 | 0.14333 | 3,595,057 | 35,502 |
| 2026-08-19 | 64 | 0.13169 | 3,234,578 | 33,039 |
| 2026-08-20 | 29 | 0.06028 | 1,039,938 | 18,354 |
| 2026-08-21 | 85 | 0.19139 | 4,334,174 | 49,081 |
| 2026-08-22 | 95 | 0.22281 | 5,260,143 | 56,744 |
| 2026-08-23 | 61 | 0.12003 | 3,180,345 | 27,464 |
| 2026-08-24 | 133 | 0.29949 | 6,829,614 | 82,328 |
| **total** | **666** | **1.33837** | 34,327,712 | 387,053 |

### The US$1.51 day is real, and it is not in this file

The handoff said 2026-08-16 recorded US$1.51 in one day, ≈15 placas at
US$0.10, and asked whether that was a burst or a packaged number.

**Neither, and the premise is half true.** No such day exists in `costs.jsonl`:
08-16 recorded **US$0.12211** there, and the most expensive of the nine days is
08-24 with **US$0.29949**. But the US$1.51 was never a `costs.jsonl` figure. It
is `docs/PENDING.md:880-885`, measured on 8/16 against Mr.Wobble by asking
OpenRouter what it had charged the key:

| | |
|---|---|
| litellm recorded (141 calls) | US$ 0.1675 |
| OpenRouter charged that day | US$ 1.5152 |
| **unrecorded** | **US$ 1.3477 — 9x** |

That is the same gap this note is about, seen from the other side: "The whole
difference is **image generation**" (`docs/PENDING.md:887`). So the day exists,
it is the key's `usage_daily`, and **`costs.jsonl` could not show it by
construction** — a sentence with an expiry date on it, 24/8, when the image
route went through the proxy. What was wrong in the handoff is the arithmetic
on top of it —
"≈15 placas at US$0.10" — because the placas were never priced at US$0.10 and
never entered that file.

There is also a near-coincidence worth naming so nobody trips on it twice:
US$1.3477 unrecorded on 8/16 sits within a cent of US$1.33837, this ledger's
cumulative total over the following nine days. Two unrelated numbers that look
like each other.

**Handoff conclusion 3: the question was badly posed.** `costs.jsonl` does not
distinguish provider because it never sees more than one.

### Separating task by task

`costs.jsonl` does not carry the task, but it can be reconstructed. Each row was
crossed against the `first_seen..last_seen` window of `session_model_usage` and
then classified within each session by token signature, using the
`api_call_count` the engine already keeps per task. The 08-24 session closes
**exactly**: 63 rows in the ledger = 43 main + 12 approval + 8 vision, and the
three groups separate on their own:

| kind | input | output | US$ each |
|---|---:|---:|---:|
| deciding turns (main) | 22,000–112,000 | 51–2,210 | ~0.0028 |
| LOOK (vision) | 1,216–1,340 | 799–1,525 | ~0.0017 |
| approval | 299–678 | 7–126 | ~0.0001 |

The 8 vision rows are exactly the 8 images of that run. Applied to the 16
sessions, the reconstruction covers **US$1.33108 of US$1.33837 (99.5%)**; the
rest is overlap between the windows of concurrent sessions.

| task | calls | US$ | share |
|---|---:|---:|---:|
| main (deciding turns) | 404 | 1.03804 | 78.0% |
| vision (the LOOK) | 87 | 0.16528 | 12.4% |
| approval | 188 | 0.12776 | 9.6% |
| title_generation | 1 | 0.00002 | ~0% |
| **image (the pixels)** | **55** | **0.00000** | **unrecorded** |

Chat model price, from OpenRouter's cached metadata
(`data/cache/openrouter_model_metadata.json`): `openai/gpt-5.6-luna` at
US$0.10/M prompt, US$0.60/M completion, US$0.01/M cache read, US$0.125/M cache
write. Cache is nearly all the saving: the runs hit 96-97%. Same effect
`team-pivot-status.md:480-484` measures from the other end — first turn of a
room US$0.0065, every turn after it US$0.0022, with `cache_read_tokens` around
44k against single-digit `input_tokens`.

---

## 5. How many placas, and how many attempts

- **55 generations** (`agent.log`, `tool image_generate completed`), split
  12/5/6/3/3/5/8/5/8 from 08-16 to 08-24.
- **87 vision calls** — more than generations, because vision also reads images
  the client uploads.
- **38 finished placas**: files unique by md5 under `data/workspace/`
  (66 files, 38 distinct hashes — the rest are copies from `interno/` to
  `entregables/`). No brand image contaminates the count.

**1.447 attempts per finished placa.** 17 of 55 were discarded: exactly what
step 4 of the skill orders when the text comes out broken (`SKILL.md:98`) — a
31% discard rate that is the skill working, not failing.

The 8 images surviving in the cache are 720×1280 and 1024×1024, which confirms
the measurement at `SKILL.md:57-61` (`portrait` → 720×1280, and the raw `"9:16"`
falls back to a useless 1280×720). The same pair of numbers is recorded
independently in `catalog.json:243` under `=== post-image ===`.

---

## 6. The price of the pixel

This is the one component that could **not** be measured against a real charge,
because by design it is recorded nowhere. The number comes from our own catalog
note, `hermes-kit/capabilities/catalog.json:243`:

> SEEDREAM IS LEFT OUT: **$0.045 vs $0.2266 for gpt-5.4-image-2 (measured, 5x
> cheaper)** and it respects the aspect ratio, but the plugin sends modalities
> image+text over /chat/completions and Seedream only returns image (404). It
> would qualify if the engine supported POST /api/v1/images.

**US$0.2266 per generation**, measured at the time by whoever wrote the note.
The repo carries it a second time, in the script that would use the other route
— `plugins/post-image/skills/post-image/scripts/generate.py:11-12` and the
measured table at `:23-25`:

```
Measured 14/8/2026 on the same brief:
    seedream-5-0-pro  $0.045  117 s  9:16 correcto
    gpt-5.4-image-2   $0.227  103 s  cuadrada
```

Corroborated against the cached price table: `openai/gpt-5.4-image-2` charges
US$0.00003 per `image_output` token and US$0.000008 per prompt token. With a
~400-token brief (US$0.0032), US$0.2266 implies ≈7,450 image tokens —
consistent with **high** quality in portrait (the 1024×1536 high tier is 6,240
tokens, plus the reference images' tokens). Measured latencies back it: 82 to
130 seconds per generation (`agent.log:7091-7092`, `:7131-7132`), against the
103 s the repo's own table records.

One third check, from `docs/PENDING.md:880-885` and imperfect: US$1.3477 went
unrecorded on 8/16, and 12 generations happened that day. If the OpenRouter
reading covered the whole day the implied price is US$0.112; if it was taken
about halfway through, ≈US$0.225 — which lands on US$0.2266 to within a cent.
It does not settle the number, but it is the only independent in-repo check
there is, and it brackets it.

That was the biggest uncertainty in this note and it dominated the total.
**It is settled.** With the image route through the proxy (`e4edeb1`), one
placa asked for through the portal chat wrote the row that had never existed:

```
openai/gpt-5.4-image-2   in=1656  out=7086   US$ 0.224898   source=upstream
```

US$0.224898 against US$0.2266 — **0.8% apart**, taken from the provider's own
`usage.cost` rather than from a price table. The carry-over was right.
Everything computed below off US$0.2266 stands: at the measured figure the
placa comes to US$0.354 instead of US$0.357, which is the same number.

*(And the inconsistency between two repo files is resolved, in the catalog's
favour. `catalog.json:243` says Seedream answers **404** over
`/chat/completions`; `generate.py:15-17` says **500**. Measured 24/8, the
chat-completions refusal is a **404** — "No endpoints found that support the
requested output modalities: image, text". The 500 is real too, but it belongs
to a different call: litellm's own `/v1/images/generations` against OpenRouter.
Section 9.)*

---

## 7. What a finished placa really costs

$$
\text{placa} = \underbrace{1.447 \times P_{img}}_{\text{pixels}} + \underbrace{L \times P_{look}}_{\text{LOOK}} + \underbrace{C_{main} + C_{approval}}_{\text{deciding turns}}
$$

Over the 10 sessions that produced placas (55 attempts → 38 finished):

| component | US$/placa | share | varies with the role knobs? |
|---|---:|---:|---|
| **pixels** (1.447 × $0.2266) | **0.32797** | **92.0%** | **No** — global config key, not the role's |
| deciding turns (main) | 0.02278 | 6.4% | **Yes** — model, effort, prompt size |
| LOOK step (vision) | 0.00353 | 1.0% | **Yes** — resolves to the role's main model |
| approval step | 0.00229 | 0.6% | **Yes** — the role's model |
| **TOTAL** | **0.35657** | 100% | |
| *(chat subtotal)* | *0.02859* | *8.0%* | |

*(Priced at the charge actually measured on 24/8 — US$0.224898 instead of the
catalog's US$0.2266 — the pixel is US$0.32543 and the total US$0.35402. Left as
computed above: 0.7% apart, and no share moves. On
`google/gemini-3-pro-image`, the model that is one config key away, the same
placa is US$0.227; on Seedream, which we cannot call, US$0.079. Section 9.)*

And there is a fourth channel, indirect: **the retry rate (1.447) depends on
the LOOK's judgement**, which runs on the role's model. A cheaper role that
lets broken text through does not save — it multiplies the component worth 92%.

### Sensitivity to the knobs

With the per-turn numbers from today's measurement wave — conversational
US$0.0036; cold ~US$0.0065; tool-heavy US$0.0247 as an upper bound, measured on
a broken skills index; room router US$0.000071
(`notes/team-pivot-status.md:456-478`) — moving a role from the cheap end to
the expensive one changes the chat subtotal by a few cents, while the pixel
stays nailed at US$0.328. **Optimising the role's model to make placas cheaper
is optimising the 8%.**

This is the number `team-pivot-status.md` pending item 1 was missing. Its own
figures are consistent with these: its `approval` task came to US$0.00066 over
5 calls (US$0.00013 each, against ~US$0.0001 here), and it records zero vision
calls in its 10 turns because that agent has no image key at all
(`team-pivot-status.md:523-527`) — which is why the LOOK had to be measured
here and not there.

---

## 8. Where the US$0.10 came from (and what replaces it)

The catalog, facing the client, never promises a number: it says *"Por imagen
generada, dentro de tu cuota de modelos; el resto sin costo."*
(`catalog.json:233`). That is right and should not be touched.

*(Citation drift: the deployed copy had two such strings, at `catalogo.json:113`
and `catalogo.json:34`. In the repo there is exactly one — the second belonged
to the standalone `images` row, which no longer exists as a row; the surviving
string also gained "; el resto sin costo.")*

The US$0.10 circulates internally. And it has an exact explanation: **it is the
cost per placa if Seedream worked.**

```
Seedream:          1.447 × $0.045 + $0.0286 = $0.0937   ← the US$0.10 we quote
gpt-5.4-image-2:   1.447 × $0.2266 + $0.0286 = $0.3566  ← what actually runs
```

US$0.0937 rounds to US$0.10. The published figure is real, but it belongs to
**the provider we ruled out because the plugin cannot call it**
(`catalog.json:243`: it sends `modalities: image+text` over
`/chat/completions` and Seedream only returns `image` → 404).

Re-measured on 24/8, Seedream is cheaper than that arithmetic assumed:
`seedream-5-0-lite` charges **US$0.035**, which would put the same placa at
**US$0.079**. The lever grew and the door stayed shut — section 9.

### What to quote

- **US$0.36 per finished placa** as the internal number, with the breakdown
  above.
- **US$0.22 per generation** when talking about the pixel alone — US$0.224898,
  a charge and not an estimate since 24/8 (section 6).
- Never US$0.10 without saying "if we migrated to Seedream".
- And all three move together if the image model ever changes (section 9): on
  `google/gemini-3-pro-image` the placa is US$0.227 and the generation
  US$0.137.

And facing the client, keep the catalog's current wording: it is a model quota,
not a tariff of ours.

---

## 9. Seedream, measured: 6.4x cheaper, and out of reach

Measured live on 2026-08-24 on the local demo agent, on a fresh `local-demo`
OpenRouter key, with the image route already through the proxy. Three
generations, same prompt (*un mate sobre una mesa de madera, foto simple*),
same key, cost read from the provider's own `usage.cost`:

| model | surface | US$/image | latency | out | size |
|---|---|---:|---:|---:|---|
| `openai/gpt-5.4-image-2` — today's default | `/chat/completions` | **0.224898** | 117.6s | 7,086 tok | 1024x1024 PNG |
| `google/gemini-3-pro-image` — the plugin's own fallback | `/chat/completions` | **0.137072** | 20.2s | 1,341 tok | 1024x1024 PNG |
| `bytedance-seed/seedream-5-0-lite` | `/api/v1/images/generations` ONLY | **0.035** | ~60s | 16,384 img tok | 2048x2048 JPEG |

The first two arrived through the agent, through litellm, and are rows in
`costs.jsonl`. The third had to be called by hand with curl, straight at
OpenRouter, because nothing in the engine can reach that endpoint — which is
the finding.

Two things this settles: **US$0.2266 was right** (section 6), and **US$0.045
for Seedream was right too**, and is now US$0.035 for `seedream-5-0-lite` at
2048x2048 — **6.4x cheaper than what we run**. The lever is real and bigger
than this note claimed. It is just not reachable from here.

### It is not litellm, and no litellm configuration fixes it

The proxy forwards the engine's request faithfully and OpenRouter refuses it.
`plugins/image_gen/openrouter` posts to `{base_url}/chat/completions` with a
hardcoded `"modalities": ["image", "text"]`; through litellm, verbatim:

```
POST http://litellm:4000/chat/completions
{"model":"bytedance-seed/seedream-5-0-lite","modalities":["image","text"], ...}

-> litellm.NotFoundError: OpenrouterException - {"error":{"message":
   "No endpoints found that support the requested output modalities:
    image, text","code":404}}
```

Identical for `bytedance-seed/seedream-4.5`. The refusal is **upstream**. That
the proxy forwards the body unchanged is itself measured: against an echo
server standing in for OpenRouter, litellm passed `modalities` and
`image_config` through untouched and even *added* `usage: {include: true}`.
`drop_params: true` does not eat them. There is nothing litellm is getting in
the way of, and therefore nothing a litellm transform could get out of the way.

**The root cause is the model catalog, not the wire format.** OpenRouter keeps
two catalogs that do not overlap — `GET /api/v1/images/models` (43 models) and
`GET /api/v1/models` — and the first lists each model's architecture:

```
bytedance-seed/seedream-5-0-lite   output_modalities: ["image"]
bytedance-seed/seedream-4.5        output_modalities: ["image"]
openai/gpt-5.4-image-2             output_modalities: ["image", "text"]
google/gemini-3-pro-image          output_modalities: ["image", "text"]
```

The models that work on `/chat/completions` are exactly the ones that can emit
text alongside the image. Seedream cannot, so asking a chat-completions
endpoint for `image, text` leaves it with no endpoint to route to. And the
plugin's `modalities` list is not a preference it could relax — it is what
makes the chat-completions surface return an image at all.

The response is a different object too:

```
chat completions : choices[0].message.images[].image_url.url  -> data: URI
images API       : data[0].b64_json                           -> raw base64
```

A proxy-level rewrite would have to invent the first from the second on every
call, in both directions, for a body the engine parses with `_extract_images()`
— a format adapter for one vendor, living inside the observability layer.

And the obvious escape hatch does not work either: litellm's own
`POST /v1/images/generations` against OpenRouter answers **500**, while the
same call straight at OpenRouter returns an image. That is a second, separate
thing to solve — and it is the 500 `generate.py:15-17` half-remembers, filed
against the wrong endpoint.

### What the engine would have to grow

`plugins/image_gen/openrouter/__init__.py` needs a **second call path**, chosen
per model:

- **Route on the model's declared output modalities.** `text` in
  `output_modalities` → today's `/chat/completions` call; otherwise the images
  API. The catalog that answers this is `GET {base_url}/images/models`, which
  the plugin does not read today — its `list_models()` is a hardcoded two-entry
  list.
- **A different request body.** `POST {base_url}/images/generations` with
  `{model, prompt, aspect_ratio, resolution, input_references}`. Not `size`:
  `seedream-5-0-lite` refuses it — *"requires at least 3,686,400 output pixels;
  size 1024x1024 is 1,048,576"* — and it takes an 18-value aspect-ratio enum
  (`9:16` among them), so the `portrait`/`landscape`/`square` contract maps
  cleanly and the ratio is actually respected.
- **A different response read.** `data[0].b64_json` instead of
  `choices[0].message.images[].image_url.url`.

**One thing would come for free.** The images API returns

```json
"usage": {"prompt_tokens": 12, "completion_tokens": 16384, "cost": 0.035,
          "cost_details": {"upstream_inference_cost": 0.035},
          "completion_tokens_details": {"image_tokens": 16384}}
```

`cost`, in the exact field `compose/litellm-cost.py` already reads. If that path
ever exists and goes through the proxy, the ledger works with no change to
anything of ours — and it carries `image_tokens`, which the chat-completions
response does not break out. **One thing would not:** if the engine grows the
path but calls OpenRouter directly, we are back to a route the proxy never
sees, the exact hole `e4edeb1` closed. The upstream ask is "add the images API
path", not "add the images API path however you like".

### The lever that IS reachable today — and it is a decision, not a finding

`google/gemini-3-pro-image` is already the plugin's own `_FALLBACK_MODEL`. It
speaks the chat-completions surface, so it needs no engine change at all — just
the model override in the agent's `config.yaml`, which `tools/profile_config.py`
already projects into every hired role (section 2):

```yaml
image_gen:
  provider: openrouter
  openrouter:
    model: google/gemini-3-pro-image
```

Measured on the live agent through the portal chat: **US$0.137072 against
US$0.224898, 20.2s against 117.6s**, same 1024x1024, quality fine for a placa.
At 1.447 attempts that is US$0.227 a placa instead of US$0.354. The latency may
be the bigger half — 117s a generation at 1.447 attempts is nearly three
minutes of a client waiting on one image.

**PRODUCT DECISION, AND IT IS LUIS'S.** It changes how every client's placa
looks, and image quality is not something this note gets to rule on. Nothing is
running on it: the demo agent was deliberately reverted to the engine default
once the measurement was taken.

Cheaper siblings on the same surface (`google/gemini-3.1-flash-image`,
`google/gemini-2.5-flash-image`) were **not** measured, and their listed token
rates do not predict the charge — gemini-3-pro's 1,341 output tokens at its
listed US$0.000012/token would be US$0.016, and it charged US$0.137. There is a
per-image component the price table does not show. Each one has to be measured,
not derived.

---

## 10. The `bfl` line costs nothing, and taking it out would not take it out

Measured 2026-08-24 against the engine's own resolver, image
`nousresearch/hermes-agent:v2026.7.30`. **No change was made.** The item that
used to sit in "what needs fixing" — take `bfl` out of the three
`platform_toolsets` rows, it is a free win — is false in both halves, and
either half is enough on its own.

**It ships zero schemas already.** `check_bfl_requirements` needs a Nous account
that is logged in AND has paid service access, and it fails on every boot of
every agent we run: section 2 is right about that, and the log says it seven
times. What follows from it is the opposite of what was assumed. A failing
`check_fn` strips the tool **before the schema is built**, so the six
`bfl_flux3_*` tools never reach the prompt. The engine says so itself, in the
comment right above the list that keeps `bfl` on
(`hermes_cli/tools_config.py:2153-2157`, inside the image):

> the six `bfl_flux3_*` tools carry `check_fn=check_bfl_requirements` (logged
> in AND paid), so an enabled toolset still ships zero schemas to a user
> without paid portal access

The gate is not a network call either — with no Nous auth state on disk it
returns `logged_in=False` locally and never leaves the process, so it is not
costing latency.

**And removing it from the list does not remove it.**
`_RECENTLY_SHIPPED_TOOLSETS = frozenset({"bfl"})` (`tools_config.py:2158`) puts
`bfl` **back** into a platform's resolved toolsets when it is absent from a
saved list — the engine's back-fill for toolsets that shipped after a user
froze their picker. Only `known_builtin_toolsets` (what `hermes tools` records
when you untick it) or `agent.disabled_toolsets` actually take it out.

Four variants, each in its own interpreter (config is process-cached), through
`tools_config._get_platform_tools` → `model_tools.get_tool_definitions` — the
same path `agent/agent_init.py:1390` runs:

| `platform_toolsets.api_server` | `bfl` in resolved toolsets | tools | schema bytes | `bfl_*` shipped |
|---|---|---:|---:|---:|
| with `bfl` (today) | yes | 25 | 51,545 | 0 |
| **without `bfl`** (the proposed change) | **yes** — back-filled | 25 | **51,545** | 0 |
| with `agent.disabled_toolsets: [bfl]` | no | 25 | 51,545 | 0 |
| with `known_builtin_toolsets` declining it | no | 25 | 51,545 | 0 |

**Byte-identical across all four.** The change is a no-op twice over: it does
not remove the toolset, and the toolset was not costing anything to remove.

There is a second reason nothing was touched. That block is **generated**
(`config.base.yaml:100-103`; `python3 tools/skills-knob.py --toolsets --image
<tag>` reproduces today's list exactly) and `agent-check.py:1815-1823` fails any
agent whose three rows differ from the kit's. Its contract is "what the engine
resolves for this platform". Hand-removing a name the engine puts back would
make the file disagree with the engine at the one place it exists to agree, and
would churn every agent's config and every distribution for a measured zero.

**The entire cost of leaving it: one `WARNING` line per turn in `agent.log`.**
That is log noise, not spend, and the alternative buys silence with a config
that lies.

**When this stops being true.** The engine's own comment says
`_RECENTLY_SHIPPED_TOOLSETS` "MUST ship in the same release as the toolset it
names, and be emptied in the next one". Once a tag lands with that set empty,
removing `bfl` from the list starts working — and will still ship zero schemas,
because the gate is what was doing the work all along. **Re-measure on the next
engine bump**, not before.

---

## 11. What needs fixing

1. ~~**The ledgers are blind to 92% of the spend.**~~ **FIXED 2026-08-24,
   `e4edeb1`.** What was blind, kept because the shape of it is the lesson:
   `image_gen: provider: openrouter` bypassed litellm, so neither `costs.jsonl`
   nor `session_model_usage` recorded a cent of the pixels. It was the same hole
   `litellm-cost.py:3-11` documents for chat (`provider: custom` →
   `billing_mode="unknown"` → the tab at $0), except that one got plugged with
   the callback and this one stayed open. And on the VPS,
   `session_model_usage.estimated_cost_usd` was **0.0** with
   `cost_status='unknown'` and `cost_source='none'` on every main row — the
   engine's own accounting was dead there, and only `costs.jsonl` held real
   money. On the local agent, which at the time went straight to
   `provider: openrouter`, it matched what was billed to the last decimal
   (`team-pivot-status.md:448-453`).

   **Why it was not one line.** `observability.sh on` flipped `data/config.yaml`
   and called it done; that is one route of three. The client's chat was
   covered. Every teammate's chat was not — a hired role's home is
   `data/profiles/<role>/` and the engine merges nothing from the parent. And
   image generation was not, because `image_generate` asks
   `resolve_runtime_provider(requested='openrouter')` for its endpoint, a path
   that ignores the model block whenever the requested provider is not
   custom/auto (`runtime_provider.py:1192-1207`): the chat went through the
   proxy and the pixels went around it.

   **`OPENROUTER_BASE_URL` in each home's `.env` is the only seam.**
   `providers.openrouter.base_url` does nothing — `openrouter` is a canonical
   provider name, so the named-custom lookup returns None before it reads the
   block (`:657-672`). And it has to be a `.env` file rather than the
   container's environment: with `gateway.multiplex_profiles` on, credential
   reads go through a per-profile secret scope built from `<home>/.env`, and a
   miss returns the default instead of falling through to `os.environ`
   (`agent/secret_scope.py:123-190`). `secrets.env` reaches the process; the
   turn never sees it.

   **Proven live**, one placa through the portal chat on marketing's turn,
   `image_generate` → litellm → OpenRouter, and the row that had never existed:
   `openai/gpt-5.4-image-2 in=1656 out=7086 US$0.224898 source=upstream`.
   Reconciled against the provider — OpenRouter charged US$0.2699 over the run,
   the ledger accounts for US$0.2588, and the US$0.011 difference is exactly the
   two turns taken before the proxy was up. The same commit killed a false zero:
   litellm computes `response_cost` off a cost map with no entry for our `*`
   wildcard, so it returns 0.0, which passed an `is None` check and landed in
   the ledger as a call that cost nothing — one row in 28 on that run.

   **What was never true:** that the client sees a wrong number. The Usage tab
   was rewired on 8/19 to read `GET /api/v1/key` — what OpenRouter actually
   charged that agent's key, "the agent, the images, the room's routing,
   whatever comes next" (`portal_adapter.py:2545-2548`,
   `docs/PENDING.md:857-863`, `docs/portal-routes.md:45-51`). `HIDDEN_MODULES`
   is empty again (`app/app/layout.tsx:51`). The screen always told the truth;
   what was blind was our per-task attribution — the thing this note needed and
   had to reconstruct by hand, and the thing that now comes straight out of
   `costs.jsonl`.

2. **Seedream is worth 6.4x on the pixel, and it is not reachable from here.**
   Measured 24/8: US$0.035 against US$0.224898 — a bigger lever than the 5x this
   note carried, and blocked by more than "the plugin does not support
   `POST /api/v1/images`". It needs an engine-level images-API path, because the
   two surfaces are two APIs and not two dialects: different request bodies,
   different response bodies, different model catalogs (section 9). Not ours to
   write, not fixable in litellm, and worth asking for with the proxy attached.

3. **DECISION NEEDED (Luis): which model draws the placa.**
   `google/gemini-3-pro-image` is reachable today with one config key and no
   engine change — 1.64x cheaper and 5.8x faster than the default, measured
   (section 9). It changes how every client's placa looks, so it is a product
   call and not a cost call. Nothing is running on it: the demo agent was
   reverted to the engine default after the measurement.

4. ~~**`bfl` is still in `platform_toolsets`.**~~ **MEASURED 24/8, AND IT IS NOT
   A FIX.** It already ships zero schemas — its gate fails before the schema is
   built — and removing it from the list does not remove it, because the engine
   back-fills it from `_RECENTLY_SHIPPED_TOOLSETS`. Four variants, byte-identical
   prompts: section 10. Cost of leaving it: one WARNING line per turn.
   **Re-measure when an engine tag ships with that back-fill set empty.**

5. **The generation tool still returns no cost to the agent.**
   `image_generate`'s payload carries `model`, `prompt`, `aspect_ratio`,
   `provider` — and no `usage`. That no longer blocks the ledger (the proxy
   reads the charge on the way past, item 1), but the agent itself cannot know
   what a placa cost it, so nothing in a SOUL or a skill can budget against it.
   If the engine ever grows the images-API path, that one returns `usage.cost`
   in the exact field `litellm-cost.py` already reads (section 9).

6. **DECISION NEEDED (Luis): social-package is DOA on a team agent.** The
   package's whole value is the pixel, and the pixel needs
   `check_image_generation_requirements` to pass **inside the role's process**.
   Under `gateway.multiplex_profiles` that gate only sees
   `data/profiles/<role>/.env`. Measured 24/8: with `OPENROUTER_API_KEY` already
   in the container's environment through `secrets.env`, the gate answered False
   on every turn, and answered True the moment the same key was written into the
   profile's `.env` — nothing else changed (`agent-check.py:2641-2650`).
   *(This also corrects `team-pivot-status.md:523-527`, which read the same
   `check_image_generation_requirements returned False` as "no image key exists
   on this agent". The key existed, in `secrets.env`, in the container's
   environment. The role's turn could not see it.)* So selling social-package
   to a client who has a team means **writing an OpenRouter key into `data/`**,
   which is the one thing the compose files say we do not do
   (`docker-compose.example.yml:116-123`, `:142-147`).

   **The residual exposure was measured, and it is smaller than that guarantee
   sounds.** The escalation chain the guarantee was written against is the
   `env_file` one: `data/.env` used to be the `env_file` of both services, so a
   `PYTHONPATH=` line in it ran the agent's own code inside the adapter, and
   from there reached `policy/` and the `cont-init` that s6 runs as root. That
   path is gone — `env_file` points at `./secrets.env`
   (`docker-compose.example.yml:122-123`) and no service mounts `data/.env` or
   `data/profiles/<role>/.env` as one, so the engine's secret scope reads them
   and nobody else does. What an agent that rewrites its own profile `.env` gets
   is its own OpenRouter key, which it already spends on every turn, and the
   ability to break its own image generation. Not root, not the adapter, not
   another client.

   Two operational consequences that come with a yes: `hire-role.sh:339-344`
   writes that file only on first hire (`--update` leaves it alone), so a key
   placed there survives updates but is not part of the distribution and has to
   be put in per role and per agent; and `agent-check.py:2660-2667` now names
   any credential-shaped variable it finds in `data/.env` in its output, which
   is the operator-visible price of the decision.

---

## What re-citing changed

Everything measured survived. Two conclusions drawn on top of the measurements
did not, both because the repo had already moved past them:

- **"The Usage tab shows the client US$0.029 of the US$0.357 they spent."
  FALSE.** True until 8/19/2026, fixed since: the tab reads OpenRouter's key
  endpoint, images included (`portal_adapter.py:2535-2551`,
  `docs/PENDING.md:857-863`). The ledger blindness was real; its client-facing
  consequence never was. Corrected in the verdict and in item 1 above.
- **"The US$1.51 day does not exist."** It exists — it is
  `docs/PENDING.md:880-885`, OpenRouter's `usage_daily` for 8/16, and it is the
  9x gap this note explains. It is simply not a `costs.jsonl` figure, and no
  reading of `costs.jsonl` could ever have found it. The handoff's error was
  the "≈15 placas at US$0.10" arithmetic on top of it. Corrected in section 4.

### What the 24/8 measurement wave changed

Three of this note's conclusions were re-measured live, against a real key,
after everything above was written:

- **"No ledger backs the pixel." NO LONGER TRUE, and the pixel was right.** The
  image route went through litellm on 24/8 (`e4edeb1`) and the first ledgered
  placa charged US$0.224898 against the US$0.2266 carried here — 0.8% apart.
  Sections 6 and 11 item 1.
- **"Seedream is worth 5x and is blocked by one missing endpoint." HALF
  RIGHT.** It is worth 6.4x, at US$0.035, and it is blocked by two APIs that do
  not share a request body, a response body, or a model catalog — not by
  anything litellm can be configured to do. Section 9.
- **"`bfl` pays for its schema in every prompt." FALSE.** It ships zero schema
  bytes, and taking it out of `platform_toolsets` would not take it out of the
  resolved toolsets. Measured four ways, byte-identical. Section 10.

Three citations did not survive as file:line and are mapped in place above:
the deployed `data/config.yaml:1-5` (the repo ships `provider: openrouter`,
`config.base.yaml:1-4`), the deployed `data/config.yaml:326-331` (no `image_gen`
key exists in `config.base.yaml`; it is installed from `catalog.json:239`), and
`catalogo.json:34` (that catalog row no longer exists).

---

## How to reproduce

Mr.Wobble's containers are down since 24/8, but the tree is intact and
readable — `compose down` ran **without `-v`** and all four volumes were kept
(`fleet.md:129`, runbook at `:131-160`).

```bash
ssh tuagente
# the chat ledger (chat only: there is no image here)
wc -l /opt/agentes/tuagente/data/costos.jsonl
# the tasks the engine separates
sqlite3 /opt/agentes/tuagente/data/state.db 'select task,api_call_count from session_model_usage'
# real generations
grep -c "tool image_generate completed" /opt/agentes/tuagente/data/logs/agent.log   # 55
# finished placas (unique by content)
find /opt/agentes/tuagente/data/workspace -name '*.png' -exec md5sum {} \; | awk '{print $1}' | sort -u | wc -l   # 38
# what the LOOK resolves to
grep "Vision auto-detect" /opt/agentes/tuagente/data/logs/agent.log | tail -1
```

(The ledger is `costos.jsonl` there, not `costs.jsonl`: that agent predates
`tools/migrate-agent-to-english.sh`.)

The per-task reconstruction scripts stayed in the session's scratchpad
(`classify.py`, `split.py`, `rows.py`).

And for the 24/8 measurements, on a live agent with the proxy up:

```bash
# the 404, through the proxy, with the engine's exact body
docker exec <agent>-hermes curl -s -X POST http://litellm:4000/chat/completions \
  -H 'Content-Type: application/json' -H 'Authorization: Bearer x' \
  -d '{"model":"bytedance-seed/seedream-5-0-lite","modalities":["image","text"],
       "messages":[{"role":"user","content":[{"type":"text","text":"a wooden table"}]}],
       "image_config":{"aspect_ratio":"1:1"}}'

# the catalog that explains it (43 models, disjoint from /api/v1/models)
curl -s -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  https://openrouter.ai/api/v1/images/models

# Seedream working, on the surface the engine cannot reach
curl -s -X POST https://openrouter.ai/api/v1/images/generations \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" -H 'Content-Type: application/json' \
  -d '{"model":"bytedance-seed/seedream-5-0-lite","prompt":"...",
       "aspect_ratio":"1:1","resolution":"2K"}'

# the placa's row, which before 24/8 did not exist
grep image /opt/agentes/<agent>/data/costs.jsonl
```

The `bfl` measurement is four runs of one script, each in a fresh interpreter
because the config is process-cached, calling
`tools_config._get_platform_tools` → `model_tools.get_tool_definitions` inside
the engine's image and summing `len(json.dumps(schema))`.
