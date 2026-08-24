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

And the finding that matters more than the number: **image spend does not
appear in either of our two ledgers.** Not in `costs.jsonl`, not in the
engine's `session_model_usage` table. 55 real generations over nine days left
exactly zero cost rows.

That blindness is real and structural, but it no longer reaches the client:
the Usage tab stopped being computed from those ledgers on 8/19 and now reads
what OpenRouter charged the agent's own key, images included
(`hermes-kit/adapter/portal_adapter.py:2535-2551`, `docs/PENDING.md:857-863`,
`docs/portal-routes.md:45-51`). See "What re-citing changed" at the bottom —
the note originally concluded the client was being shown 8% of the spend, and
the repo refutes that.

The US$0.10 did not come from nowhere either: it is, almost to the cent, **the
price of Seedream** — the cheap provider we ruled out because the plugin
cannot call it. We were quoting the route that does not run.

---

## 1. How an image is actually routed

There are **two distinct billing routes**, and that is the root of everything.

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

**The image does NOT go through litellm.** On the deployed copy,
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
plugin. So the default runs. And the tool's result, stored in `state.db`'s
`messages` table, says it outright:

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
in its code").

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
`:132`), paying for its schema in the prompt without delivering a single tool.

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
neither provider nor task.

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
it is the key's `usage_daily`, and **`costs.jsonl` cannot show it by
construction**. What was wrong in the handoff is the arithmetic on top of it —
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

Still, say it plainly: **this is the biggest uncertainty in this note and it
dominates the total.** It cannot be re-verified without calling the provider,
and no ledger backs it.

*(One inconsistency between two repo files, noted and not resolved here:
`catalog.json:243` says Seedream answers **404** over `/chat/completions`;
`generate.py:15-17` says **500**. The conclusion — that route is closed — is
the same either way.)*

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

### What to quote

- **US$0.36 per finished placa** as the internal number, with the breakdown
  above.
- **US$0.23 per generation** when talking about the pixel alone.
- Never US$0.10 without saying "if we migrated to Seedream".

And facing the client, keep the catalog's current wording: it is a model quota,
not a tariff of ours.

---

## 9. What needs fixing

1. **The ledgers are blind to 92% of the spend.** `image_gen: provider:
   openrouter` bypasses litellm, so neither `costs.jsonl` nor
   `session_model_usage` records a cent of it. It is the same hole
   `litellm-cost.py:3-11` documents for chat (`provider: custom` →
   `billing_mode="unknown"` → the tab at $0), except that one got plugged with
   the callback and this one stayed open. And note: on the VPS,
   `session_model_usage.estimated_cost_usd` is **0.0** with
   `cost_status='unknown'` and `cost_source='none'` on every main row — the
   engine's own accounting is dead there, and only `costs.jsonl` holds real
   money. On the local agent, which goes straight to `provider: openrouter`,
   it matches what was billed to the last decimal
   (`team-pivot-status.md:448-453`).

   **What this does NOT mean any more:** that the client sees a wrong number.
   The Usage tab was rewired on 8/19 to read `GET /api/v1/key` — what OpenRouter
   actually charged that agent's key, "the agent, the images, the room's
   routing, whatever comes next" (`portal_adapter.py:2545-2548`,
   `docs/PENDING.md:857-863`, `docs/portal-routes.md:45-51`). `HIDDEN_MODULES`
   is empty again (`app/app/layout.tsx:51`). The screen tells the truth; what
   stays blind is our per-task attribution, which is what this note needed and
   had to reconstruct by hand.

2. **Seedream is worth 5x.** Migrating would take a placa from US$0.357 to
   US$0.094. Blocked by exactly one thing: the plugin does not support
   `POST /api/v1/images`. It is by far the biggest cost lever we have, and the
   client-side script for that route is already written and measured
   (`plugins/post-image/skills/post-image/scripts/generate.py`).

3. **`bfl` is still in `platform_toolsets`** (`compose/config.base.yaml:106`,
   `:119`, `:132`) and its gate fails on every boot. It is video, not image,
   and there is no paid account. We pay for its schema in the prompt of every
   request in exchange for nothing. It is NOT a hand edit: that block is
   generated (`config.base.yaml:100-103`) and `agent-check.py:1688-1716` fails
   any agent whose list differs from the kit's. The removal goes in
   `tools/skills-knob.py`'s `TOOLSETS_OUT` (`:120-122`), next to `browser`, and
   then the block gets regenerated — one line, and it holds across engine-tag
   bumps instead of coming back.

4. **Generation returns no cost.** `image_generate`'s payload carries `model`,
   `prompt`, `aspect_ratio`, `provider` — and no `usage`. While that holds, any
   per-placa number we quote is a price-table estimate, not a measurement.

---

## What re-citing changed

Everything measured survived. Two conclusions drawn on top of the measurements
did not, both because the repo had already moved past them:

- **"The Usage tab shows the client US$0.029 of the US$0.357 they spent."
  FALSE.** True until 8/19/2026, fixed since: the tab reads OpenRouter's key
  endpoint, images included (`portal_adapter.py:2535-2551`,
  `docs/PENDING.md:857-863`). The ledger blindness is real; its client-facing
  consequence is not. Corrected in the verdict and in item 1 above.
- **"The US$1.51 day does not exist."** It exists — it is
  `docs/PENDING.md:880-885`, OpenRouter's `usage_daily` for 8/16, and it is the
  9x gap this note explains. It is simply not a `costs.jsonl` figure, and no
  reading of `costs.jsonl` could ever have found it. The handoff's error was
  the "≈15 placas at US$0.10" arithmetic on top of it. Corrected in section 4.

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
