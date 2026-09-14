# tuagente.uy's own agent: a post a day — verdict

Built on 2026-09-14 against `docs/own-agent-plan.md`, in five waves on Opus
with an independent validation pass and a fix pass, all the same day. Our own
agent runs as `engine/instances/tuagente/` and its daily flow is armed for
tomorrow at 9:00. Spend on the lab key for the whole day, tests and probes
included, about US$0.35.

## The six gates

| # | Gate | Result |
|---|---|---|
| G1 | The clock starts a run, and it cannot start twice | **Pass.** `engine/tests/test_flows.sh`: one row per tick, `docker kill` mid-run → the killed run reads `error`, the overdue tick runs once, pause / resume / run-now behave. Reproduced by the validator. |
| G2 | The Flows tab works on the engine unchanged | **Pass.** `portal-check` 15 ok · 0 failures with `flows` and `posts` declared; the list, the detail, the banner and the three buttons work in the browser; the "uncertain" state never draws because both endpoints come from one reader. |
| G3 | The agent creates a flow with one tool; the promises guard reads real flows | **Pass, in two turns.** Asked for a repetitive job the agent first closes the contract (where it ends, with what, when it is done), then calls `create_flow`, the file appears, `/api/jobs` lists it, the answer names the next run and it works the first round right away. `test_promises.py` green reading `flows/`. |
| G4 | An image through OpenRouter, saved, and seen | **Pass.** `test_image.py`: one call to `openai/gpt-5.4-image-2` through OpenRouter's image endpoint, PNG under `imagenes/`, the model describes what is in it. US$0.003 per turn. |
| G5 | The daily flow end to end on our own agent | **Pass.** The flow was created by asking in the chat. First round in the chat turn: caption, alt, five hashtags, a 3:4 image looked at and once regenerated, saved through `save_post`, visible in Posteos with a working download. Run-now from the Flows tab: a headless run that found today's post, did not duplicate it, and said so. Row `ok`, US$0.004. The 9:00 tick is tomorrow's. |
| G6 | Nothing else regressed | **Pass.** Crash test six times in a row after the SOUL fix, compaction, memory, 185 kit unit tests, `check-plugins`, `tsc`, `build`. |

## What the validator found, and what was done

A fresh context reran every gate from the docs and probed what the tests do
not cover. Everything reproduced. The probes found one regression and five
gaps, all fixed the same evening (`4ce2d1e` through `e790659`):

1. **A flow run that paused at the approval gate was recorded `ok`.** The
   card went green and Activity said «Terminé el flujo» while the mail sat in
   Aprobaciones: the lie the portal was built to kill on Hermes, back from the
   engine side. Now a run stops in `paused`, the card says «Esperando tu
   aprobación» in amber, and the row becomes `ok` or `error` only when the
   client's answer lets the resumed run finish. `test_flow_gate.sh` holds it.
2. **The approval card did not say which flow asked.** The plan named the
   risk; the plugin never read the session. It now does: the title is
   «Flujo «…»: Mail a …» and the body opens with «Lo pidió el flujo «…».»
3. **After approving, the agent said «todavía no fue enviado»** for a mail
   it had sent, because the tool's return read like "saved for approval". The
   tool now says what it did. The approvals page also pointed at a board this
   engine does not have; it names the Tablero only when the manifest has it.
4. **The flow's technical notes reached the client through Chat** as the raw
   run prompt. The model still gets the full prompt; what is displayed is a
   short line plus the steps the client already reads on the flow's page.
5. **A prompt the image provider refuses** ended in five minutes of silence
   and «No pude responder: ReadTimeout», and the caption already written was
   lost. The request field that made refusals hang is gone, the call has a
   timeout, and a refusal reaches the model as one Spanish line so it can
   deliver the caption without the image. The tool has two retries, since the
   skill tells the agent to try once more.
6. **The lab agent's SOUL contradicted the gate** («nada que salga hacia
   afuera de esta máquina: mails…»), so the crash test passed one run in
   three. Prose competing with code, exactly what the SOUL rule forbids. The
   bullet is mechanism-free now and the operator's name is out of every
   client-facing line, on the demo and on our own agent.

**Confirmed fine:** a run killed mid-image reads `error` with a Spanish
reason, leaves nothing half-written, and the next run works; the validator
called that error card the best screen in the product. Two instances on one
Mac share nothing: separate compose projects, containers, networks, state,
and each key is 401 against the other's adapter.

## What was learned that the plan did not know

- **Missed ticks are the last overdue occurrence, not the first.** Counting
  from the first would walk a weekend one tick at a time. And a flow written
  at 14:00 on an engine up since 08:00 must not fire "this morning's" 9:00:
  the base is the newer of the process start and the file's mtime.
- **Plugin module names share one namespace.** `import routes` from a second
  plugin returned the approval plugin's module, silently, and the app came up
  with no `/portal/posts`. A plugin's modules carry the plugin's name.
- **OpenRouter has an image endpoint** that carries the aspect ratio and
  normalizes the answer; the plan assumed chat completions. `feed` is 3:4,
  because the model rejects 4:5; Instagram crops six percent top and bottom
  and the skill says to leave air there.
- **Pydantic AI's `ImageGeneration` wraps a plain callable as the tool**, so
  `generate_image(prompt, format)` is our signature and its `dimensions`
  setting is dead beside a custom generator.
- **Writing the engine's SQLite from the host while the container holds it
  open corrupts it** ("Rowid out of order"): Docker Desktop does not share
  the shm across a bind mount. Every test write goes through `docker exec`.
- **`/portal/files` serves everything as text**, which is why a plugin that
  produces binaries serves them on its own route.
- A flow's run is a per-run memory extraction call on work the client did not
  say; it has written nothing so far and is the memory plugin's call.

## Open, and whose

- **The mascot** (Luis). The generated image draws a 3D robot on palette,
  different every day, and invents its own wordmark. `social/brand.md` was
  written for the template renderer and mandates the SVG agentito, which a
  generative model cannot be handed. The choice is generative art with a
  looser brand rule, or the HTML renderer in `social/` inside the container.
- **The agent's name** (Luis). «Tu Agente» for now.
- **Both agents' traces land in one Phoenix** with content on. Fine for the
  lab; a client's instance leaves the endpoint empty.
- **The Flows card's "Trabajando ahora"** reads a `latest_execution` object
  the engine does not publish, so a run in flight shows the previous outcome.
  The row has every field it needs.
- **Telegram**, so a morning post announces itself; **publishing** through an
  Instagram connection behind the gate; the **VPS deploy** of an instance.

## Addendum, the same evening: the face delegates

After the verdict, Luis decided the main agent is the only entry point and
delegates specialized work to sub-agents the plugins define
(`docs/subagents-plan.md`). Built and gated the same evening on the harness's
`SubAgents`: the engine verbs (`subagent`, `tools`, `identity`, `provide` /
`use`), the delegation events in Activity and the Chat trail, the image and
memory plugins providing their capabilities instead of registering them on the
face, and the Instagram creator as a sub-agent of the social plugin with the
`post` skill moved to it. The face no longer has `generate_image` or
`save_post`; delegating is the only path.

Gates S1–S5 pass (`engine/tests/test_delegation.py`, 16 claims). A chat turn
that delegates costs about US$0.008 against US$0.002 for one that does not.
Our own agent's flow, run once through the delegation: «Le pedí al creador de
posteos…», «El creador de posteos terminó en 13 s», and the face's answer says
today's post already existed and is in Posteos.

Two things learned: the memory notebook was injected at the END of the request,
so on a delegated turn the model answered the notebook instead of the tool's
return; it goes first now. And the harness's claim that an approval inside a
delegation propagates is not what happens: the child run raises and the
parent turn dies, which is why the engine refuses a gated toolset on a
delegate at registration.

One unexplained failure: the first run-now after a rebuild died with a bare
`KeyError: 'instagram-creator'` and the rerun passed. The scheduler now logs a
broken run's stack, and the delegate's Activity label falls back to its name
so a missing label can never be what kills the work.
