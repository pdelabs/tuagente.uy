# hermes-kit — context for working on the kit

This directory of the monorepo is **the product installed on each
tuagente.uy client's agent**: the portal adapter, the skills, the roles,
the SOUL blocks, and the conformance check. Read `README.md` for usage. The
rest of the monorepo (the landing and the portal) has its context in the
root `CLAUDE.md`. House rule that applies here too: **code and internal
documentation in English, always**; the only thing in Spanish is text the
client reads, or the agent reads on the client's behalf.

Until 22/8/2026 this was a separate repo (`github.com/luisgurmendez/
hermes-kit`, now archived); the internal paths didn't change.

There was a third one, `agente-pdelabs` — La Mano, client 0 and the test
fixture for almost everything measured in `notes/` —, **retired on
12/8/2026**: the backup is at `~/Desktop/Luis/Projects/_respaldo-lamano/`.
To test against a real agent you have to unpack it or create one with
`new-agent.sh`. Live agents are in `fleet.md`.

**The kit is the source of truth.** If you fix the adapter or a skill while
debugging inside an agent, that change has to be brought back here:
`install.sh --diff` detects it, but only if you run it.

## Non-negotiable principles

**The model supplies the words; the code supplies the format.** Every
convention that depended on the agent remembering has failed. The three
skills exist because of this: the script decides the path, the name, the CSS
and the structure; the model contributes the content.

**Generic by default.** Nothing specific to one client goes into the kit.
What's specific lives in that agent's SOUL, which is composed from the
templates.

**Never write SQL to the kanban** — locks, claims, and the dispatcher get
corrupted. Writes go through a subprocess call to the `hermes kanban ...`
CLI, from the sidecar.

## Verified traps (they're in the code, don't undo them)

- **Sticky blocking:** a ticket returns on its own to `ready` unless its
  last event is a typed `blocked`. Creating one with `--initial-status
  blocked` doesn't leave that event → the approval request auto-unblocks
  itself and the task carries on as if it were authorized. Always
  `block --kind=needs_input`.
- **CLI:** `--flag=value` options and `--` before positionals; otherwise
  argparse breaks on values that start with `-`.
- **Mandatory frontmatter** on every `SKILL.md` (`name` + `description` that
  says what it does **and when to use it**). Without it, it gets indexed
  with an empty description and the agent never uses it. Hermes reindexes
  on its own, but it takes a few minutes. `tools/agent-check.py` checks for
  this, and for good reason: this rule was written here and a production
  agent still had, with no frontmatter, **the skill that sends mail to a
  lead**. A rule nobody checks isn't a rule.
- **Files to the browser: always `text/plain`.** An artifact's HTML travels
  inside the JSON and the portal draws it in a sandboxed iframe.
- **Confinement:** every client path is resolved with `resolve()` +
  `relative_to`, and for artifacts the parent is also compared — without
  that, a `.` deleted the entire folder.

## The engine's own skills ship turned off, and the list is generated

The engine ships 70 skills and copies them onto the volume on every boot.
Four are left on — the document-reading ones: `xlsx`, `pdf`, `docx`,
`ocr-and-documents` —, and a specific client can have one more if it's
**declared with its reason** in their config (`# kit:exception <skill> —
<why>`, which the check requires and reports). The rest get turned off with
`skills.disabled`, which `tools/skills-knob.py` **generates** from the image
or from the agent's manifest — never by listing `data/skills/`, which also
holds the kit's own and whatever the agent wrote for that client. The kit's
own no longer live there: they go in `<agent>/kit-skills/`, mounted `:ro`
and declared in `skills.external_dirs`. The why behind each knob, and the
runbook for applying it to an agent that already exists: `notes/knobs-applied.md`.

## Capabilities: requested, not installed

When the agent lacks the means to do something (generate an image, search
the web), it doesn't quietly improvise or install anything: it says so, and
offers the capability with `capability:<id>` — the portal draws it as a card
with the text from `capabilities/catalog.json`, which is **closed** (what
already ships in the engine's image plus what we write; no hub) and which
gets installed in `policy/capabilities/`, not in `data/`: it's text the
client reads, and inside the agent's volume the agent could otherwise
rewrite it. The request log (`requests.jsonl`) lives right next to it and is
written by **the adapter**, which mounts that folder rw while the agent has
it `:ro`. The trigger doesn't depend on the model remembering: the shadow
skills (`no-images`, `no-web-search`) show up in its index **only when the
tool is missing** and withdraw on their own once it's there, via
`metadata.hermes.fallback_for_tools`. And the gate — installing software,
signing as someone it isn't (`--author`, `--created-by`, `HERMES_PROFILE=`),
unblocking itself — is closed by a hook in `policy/hooks/`, not by prose.
It blocks the **family**, not the command, and the message redirects to
`capability`, saying there's no variant that gets through: that's what
stops the agent from continuing to try. Details: `notes/knobs-applied.md`.

## What the agent says it left running gets checked against disk

The worst bug in the product isn't the agent failing: it's **saying it did
something it didn't do**. It happened on 13/8/2026 with a client who asked
for a weekly check; the agent replied *"Queda definido: viernes a las
9:30"* and never called `create_flow.py` once. In Flujos it still said
*"Todavía no hay nada corriendo solo."* If she hadn't checked, she'd never
have known.

That's why there's a plugin, `plugins/flow/engine/promises/`, that runs on
`transform_llm_output` — the only point that sees the final response
**before** it's saved and sent (`hermes:agent/turn_finalizer.py:485-505`) —
and checks what the response claims against `flows/*/FLOW.md` +
`cron/jobs.json`. If it says something got set up and there's no live flow
backing it, it appends a correction to the message that **states the fact**
(what's running and what isn't), never an accusation: detecting the phrase
is approximate; the state of the disk isn't.

Five formal notes that apply to any guard that comes after this one:

- **A shell hook wasn't enough.** `agent/shell_hooks.py` can only return
  `block`, `continue`, or `context`; none of them touch the response's text.
  And `pre_verify`, which would be the place to make it retry, only fires
  **if the turn edited files** (`agent/conversation_loop.py:6808-6815`): the
  turn with the bug wrote nothing.
- **It lives in `policy/`, mounted `:ro` over `/opt/data/plugins`**, which is
  where the engine looks for them (`hermes_cli/plugins.py:1369`) and which
  belongs to the agent. That is where it lands ON THE AGENT; in the kit it is
  the `engine` surface of the `flow` plugin (`plugins/flow/engine/promises/`),
  because the guard checks whether a flow the agent announced exists. The two
  are not in tension: the engine has its own plugin system and reads only
  HERMES_HOME/plugins, so the source moved and the destination did not.
- **It's turned on with `plugins.enabled`**: user plugins are opt-in, so
  without that list the engine discovers it and doesn't load it.
- **A teammate reaches it through a link, and the link is half of it.** The
  engine only ever looks in `HERMES_HOME/plugins`, and a hired role's home is
  `data/profiles/<role>/`, so `tools/hire-role.sh` leaves
  `plugins -> ../../plugins` there and projects `plugins.enabled` into the
  role's config. Both, or nothing: with the link and no key the engine
  discovers the plugin and loads it turned off, which reads as healthy from
  every angle except the one that matters. And it is not only the teammate's
  guard at stake — the engine's plugin manager is a process singleton, the
  gateway serves every profile in one process, so the first turn after a boot
  decides the plugin set for EVERYBODY. Measured 24/8: with the first
  discovery under a role's home, the client's own turns had no guard at all.
- **The folder it inspects is the turn's**, resolved per call with
  `get_hermes_home()` and never from the process environment. Read once at
  import, a teammate's claim gets checked against the client's `flows/` — the
  guard contradicting somebody who is telling the truth, which teaches the
  client to ignore it.

`agent-check.py` fails if any of these is missing, and it also makes the bug's
exact phrase run through it, plus the same hook under two different homes:
"the file is there" isn't "it works", and neither is "it fires".

## Kanban tools get enabled with TWO keys

There's no plugin: Hermes already ships them. But it needs `toolsets:
[kanban]` **and** `platform_toolsets` with `kanban` on every platform. With
only one, the agent sees none of them and improvises with Python over its
own board. The full recipe, the reproduction, and why it wasn't guessable
are in `notes/native-kanban.md`. `tools/agent-check.py` checks for it.

## The engine version stays pinned

The compose points at a specific tag (today `v2026.7.30`), never at
`latest`: with `latest`, a push from Nous changes every client's engine
overnight and we find out from a failing ticket. As of 5/8/2026, agents
were running `v2026.7.30` while `latest` was already two versions ahead.

To upgrade: change the tag, `docker compose pull && up -d`, run
`agent-check.py` and `portal-check.py`, and only then call it good. If
something breaks, roll back to the previous tag.

## The SOUL block has a version too

The generic blocks are wrapped between `<!-- kit:base vN -->` and
`<!-- /kit:base -->`, with the version `soul/VERSION` says. That's how you
know which rules an agent is running without reading its whole prompt,
`install-soul.sh` doesn't overwrite what's already there, and
`05-precedence.md` can say what wins when the document contradicts itself.
Who has which version: `fleet.md`. The details: `soul/README.md`.

Corollary: **a change in `soul/` doesn't reach any agent on its own.** You
have to bump `soul/VERSION` and reinstall; `agent-check.py` flags who's
fallen behind.

## Verify before delivering

Two checks, in this order. The first is offline and runs **before**
powering on:

```bash
python3 tools/agent-check.py <path>/data
```

It looks at the installed kit, every skill's frontmatter, the live index,
onboarding's three classic oversights (`api_server` turned off,
`model.default` empty, the kanban plugin not enabled), and five things about
the SOUL: no unfilled placeholder gaps, no HTML comment with the words that
make the engine discard the whole file, the `kit:base` block present and
balanced, which version it's running against the kit's, and that there's an
identity. It also flags if the kit's `soul/VERSION` isn't shaped like a
version.

And the knobs: that the engine doesn't stick its own footer onto the
response (`display.file_mutation_verifier`), that the browser stays out
**via the `platform_toolsets` list** — pulling it out with `disabled_toolsets`
takes `web_search` down with it, which is in `browser`'s catalog —, that
**no engine skill** is left on outside the four document ones or whatever
was declared for that client (compares against the `.bundled_manifest` the
engine writes, so a bump that brings new skills fails instead of passing),
that `platform_hints.api_server.replace` is set, and that the kit's skills
are mounted outside `data/` and with **no old copy shadowing them**.

Over a loose SOUL — or a block you haven't installed yet — the two text
checks run on their own:

```bash
python3 tools/agent-check.py --review <file>.md
```

The second runs against an agent that's already powered on:

```bash
python3 tools/portal-check.py --key <API_SERVER_KEY> \
  --adapter http://<host>:8643 --endpoint http://<host>:8642 --origin <portal>
```

0 failures. Warnings are acceptable (e.g. "approvals module not declared"
when nothing is waiting for approval: that's correct).
