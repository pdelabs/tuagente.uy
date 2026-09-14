# Sub-agents: one face, several hands — plan

Written 2026-09-14, after the first day of `docs/own-agent-plan.md`. Luis'
decision: **the main agent is the only entry point**, for the chat and for
every flow run, and it delegates specialized work to sub-agents that plugins
define. A flow run stays a turn of the main agent; «armame un posteo de
ejemplo» in the chat and the 9:00 run take the same path through the same
delegation. The mechanism is `pydantic_ai_harness.SubAgents`
(https://pydantic.dev/docs/ai/harness/subagents/): one `delegate_task`
tool on the main agent, isolated sub-agent runs, deps and usage forwarded,
per-delegate limits, delegation events.

## What it must prove (the gates)

| # | Gate | How it is verified |
|---|---|---|
| S1 | **The main agent delegates instead of doing the work.** Asked in the chat for a post, the main agent calls `delegate_task("instagram-creator", …)`, the creator generates the image, saves the post, and the main agent answers in two lines naming Posteos. The main agent has no `generate_image` and no `save_post`. | `engine/tests/test_delegation.py`: one chat turn, tool trail shows `delegate_task`, `posteos/` has the post, `/portal/posts` lists it. ~US$0.03. |
| S2 | **The daily flow runs through the delegation.** Run-now on a flow whose body asks for the day's post: the flow's session shows the delegation, the post exists (or the creator says today's is already there), the row is `ok`. | Same test, second half, on the lab agent with a test flow; then once on our own agent's real flow. |
| S3 | **The delegation is visible and priced.** Activity shows «Le pedí al creador de posteos: …» and «El creador de posteos terminó en N s»; the turn's usage event includes the creator's tokens (the number is larger than a turn without delegation and matches OpenRouter's meter in aggregate). | Events table after S1; the usage event's payload. |
| S4 | **A creator failure does not kill the turn.** With the image provider refusing (a prompt the safety system rejects, passed through the task), the creator reports it, the main agent tells the client in Spanish, the turn ends normally. A creator timeout (set low for the test) comes back as a message too. | Two live turns, `contain_errors=True`, `timeout_seconds` overridden by env for the test. |
| S5 | **Nothing else regressed.** Crash test, flows gate, flow gate, image, promises, memory, kit unit tests, `check-plugins`, portal-check, `tsc`, `build`. | The existing suites, with `test_post.py` and `test_image.py` adapted to the new path. |

## Decisions

- **Engine verbs**, in `engine/core/plugins.py`:
  - `engine.subagent(SubAgent)`: adds a delegate. The engine owns ONE `SubAgents(agents=[…], forward_usage=True, contain_errors=True, tool_name="delegate_task")` capability on the main agent, built after all plugins registered, only if at least one delegate exists.
  - `engine.tools(*names)`: the engine's own tools by name (`read_file`, `write_file`, `list_files`, `bash`, `skill_view`), as a filtered toolset, so a sub-agent picks from the same definitions. Unknown name raises at registration.
  - `engine.identity()`: the instructions a sub-agent shares with the face: the SOUL (identity and the client's context) and the date line. No plugin fragments, no skills index.
  - `engine.provide(name, obj)` / `engine.use(name)`: a plugin offers an object to plugins loaded after it (`CORE_PLUGINS` order; `requires.plugins` in the manifest says who must come first). The image plugin provides its `ImageGeneration` capability; the memory plugin provides a factory `memory(scope)` returning a harness `Memory` capability on `<workspace>/memoria/<scope>/`.
  - `engine.model`, `engine.model_settings`, `engine.Deps`: what the plugin's `Agent(...)` needs to fit.
- **A sub-agent is a real Pydantic AI `Agent` built by the plugin**, wrapped in a `SubAgent(name, description, timeout_seconds, max_calls, usage_limits)`. The engine checks at registration: `deps_type is Deps`, no fixed `output_type`. It runs through `SubAgents`, never through `run_turn` and never on its own loop.
- **A sub-agent has no gated tools and never talks to the client.** Sensitive tools stay on the main agent behind the gate. The sub-agent's output returns to the main agent as text, and the main agent answers. `check-plugins` and the registration verb enforce the first half (a delegate whose toolset carries `approval_required` is refused); the second is structural.
- **Delegating is the only path to a sub-agent's tools.** The image plugin stops registering `ImageGeneration` on the main agent and provides it instead; the social plugin registers no toolset on the main agent. What the main agent keeps: workspace, skills, flows, memory, the approval plugin's gated tools, and `delegate_task`.
- **The creator** (`kit/plugins/social/core/creator.py`): `Agent(engine.model, deps_type=engine.Deps, instructions=[engine.identity, creator prose, the post skill's body], toolsets=[engine.tools("read_file", "list_files"), posts toolset], capabilities=[engine.use("image"), engine.use("memory")("instagram-creator")], model_settings=engine.model_settings)`. `SubAgent(name="instagram-creator", description="Arma un posteo de Instagram listo para revisar: lee la marca y los posteos anteriores, escribe el pie, genera la imagen, la mira, y lo guarda en Posteos. Pasale la idea o el tema, o «el de hoy».", timeout_seconds=600, max_calls=2)`. The `post` skill leaves the main agent's index (`SKILLS = []` in the social plugin) and is read in full by the creator at build time. `core/instructions.md` on the main agent keeps one line: «Nunca publicás: lo que el creador deja en Posteos lo publica tu cliente.»
- **Events**: a small engine capability with `@on_event(DelegationStartEvent)` / `@on_event(DelegationEndEvent)` writes `delegation.started` («Le pedí al creador de posteos: <task, cut at 120>») and `delegation.finished` («El creador de posteos terminó en N s» / «…no pudo: <outcome>») to the events table with the session id, and the SSE layer forwards them as tool progress so the Chat trail shows them. The Spanish name of a delegate comes from a `label` the plugin passes with the `SubAgent` (kept beside it in the engine's registry), never from the id.
- **Usage**: `forward_usage=True`, so the creator's tokens are in the main run's usage and `turn_usage` needs no change. The event's payload gains `delegations: N`.
- **Flows**: unchanged. A flow's body says «Pedile al creador de posteos el posteo de hoy» in its steps; the main agent delegates. The tuagente flow's body already reads naturally that way; edit the file only if a test shows the model doing the work itself, which it cannot: it has no tools for it.
- **Markdown agent definitions** (`agent_folders`) are NOT used in this wave. Python agents only; the folder loader stays off (`agent_folders=None`).

## Layout

```
engine/core/plugins.py           the verbs above; the SubAgents capability built at the end of load()
engine/core/delegation.py        the events capability (start/end → events table + SSE)
engine/core/agent.py             uses plugins' SubAgents capability; identity() extracted
kit/plugins/image/core/plugin.py provide("image", …); nothing on the main agent
kit/plugins/memory/core/plugin.py provide("memory", factory); main keeps its own scope "main"
kit/plugins/social/core/creator.py  the Agent + SubAgent; creator.md prose
kit/plugins/social/core/plugin.py   subagent(...), instructions.md, SKILLS = []
engine/tests/test_delegation.py  S1, S2 (lab), S3, S4
engine/tests/test_post.py        asserts delegate_task in the trail instead of save_post
engine/tests/test_image.py       tests generate.generate_image directly inside the container (no model), plus the "model looked" half moves into test_delegation
```

## Waves

1. Engine verbs, the events capability, image and memory providing instead of registering on the main agent (Opus).
2. The creator in the social plugin, the tests, `engine/README.md` "Sub-agents" section (same agent, same wave, sequential: it needs 1).
3. Our own agent rebuilt, one run-now of its flow through the delegation, browser check (me).

## Where reality differed (waves 1 and 2, 14/09)

- **`core/instructions.md` is two lines and not one.** With only «Nunca
  publicás…», the face answered a delegated post with a bulleted list of file
  names and did not mention Posteos — which S1 asks for. The second line says
  what to tell the client when the creator comes back.
- **The memory injection had to move before any of this worked.** The harness
  appends the notebook to the last model request, so on a one-tool-call turn
  the model answered the notebook instead of the client («Recibido. El horario
  de los sábados es de 9:00 a 13:00»). `kit/plugins/memory/core/injection.py`
  moves it to the front.
- **The image plugin's `instructions.md` is gone**: it told the face to look at
  what it drew, and the face no longer draws.
- **The gate inside a delegation does not pause, it kills the turn** — the
  child run raises `UserError` because its own output types have no
  `DeferredToolRequests`, and that bypasses `contain_errors`. The registration
  check is the whole answer; nothing was changed on the probe's account.

## Risks named up front

- **The gate inside a delegation.** The harness says approval signals propagate through `delegate_task`. Not relied on; refused at registration. One probe in the report says what actually happens, for the record.
- **The creator doing less than the skill asked** because it no longer sees the chat. The task string is all it gets; the description tells the main agent what to put in it. Watch the first runs.
- **Module namespace**: plugin modules share one `sys.modules`. `creator.py` is a new name; nothing else may reuse it.
- **Cost**: one delegation adds the creator's full run plus one main-agent turn; the number to watch in S3.
