"""Which kit plugins are enabled, and what each one adds to this engine.

The kit is mounted read-only at /opt/kit/plugins. Nothing self-installs and
nothing is discovered by walking the tree: the list is `CORE_PLUGINS`, and the
order in it is the order everything happens in.

A plugin that has something to add to THIS engine declares `surfaces.core` in
its `plugin.json` — a directory holding `plugin.py` and, if the mechanism needs
words, an `instructions.md`. `load()` imports that file and calls
`register(engine)`, and the object it hands over has eleven verbs that ADD
something and no more:

    engine.toolset(ts)          a toolset the agent gets
    engine.before_persist(fn)   `(session_id, text) -> text`, before the answer
                                is persisted and before the client is told the
                                message closed
    engine.capability(cap)      an `AbstractCapability` for the Agent
    engine.router(router)       an APIRouter the app includes after its own
    engine.module(name, value)  what the portal draws; `value` may be a
                                callable, asked at read time
    engine.instructions(text)   prose into the system prompt, in plugin order
    engine.deferred(fn)         what to do with a run that ended at a gated
                                tool (`core/session.py`'s DEFERRED_HANDLER)
    engine.subagent(sub, label) a delegate the face can hand work to, and the
                                Spanish name the client reads it under
    engine.watcher(name, fn)    what fires an `event` flow (`core/watchers.py`)
    engine.ticker(name, fn)     code on the clock with no flow and no model
    engine.notifier(name, send) a way to reach the owner (`core/notify.py`)

plus five that hand a plugin what it needs to BUILD one, and three attributes
that make its `Agent(...)` fit this engine:

    engine.tools(*names)        some of the engine's own tools, by name
    engine.identity             what EVERY agent of this client shares: the
                                SOUL's opening and the `core:base` block. A
                                string, so it renders first
    engine.today                the date line, a callable, so it renders last
    engine.provide(name, obj)   an object for the plugins loaded after this one
    engine.use(name)            one of those, by name. With a `default` it is
                                an OPTIONAL dependency: the plugin that
                                provides it may not be installed
    engine.model / .model_settings / .Deps

WHY A SUB-AGENT IS NOT JUST ANOTHER TOOLSET. The face is the only entry point —
the chat and every flow run go through it — and what it delegates runs in its
own context, with its own tools and its own prose (`docs/subagents-plan.md`).
A delegate is a real Pydantic AI `Agent` the PLUGIN builds; the engine owns one
`SubAgents` capability over all of them and refuses, at registration, the three
shapes that would fail far from here.

WHY `provide`/`use` AND NOT AN IMPORT. Plugin modules share one `sys.modules`
namespace and load in `CORE_PLUGINS` order, so one plugin importing another's
module by name is how two plugins ended up as one (`social/core/posts.py`).
What a plugin offers is offered by NAME, to whoever loads after it, and
`requires.plugins` in the manifest is what says who must come first.

WHY THE MECHANICS ARE NOT IN THIS DIRECTORY ANY MORE. A rule lives in exactly
one place, decided by what can enforce it: in code when code can check it, in a
tool's description when it is about using that tool, in the SOUL only when it
is about who the agent is. Prose about a mechanism ships WITH the mechanism, so
it is in the prompt only where that mechanism is installed — which is what a
plugin is. The approval gate, the deliverable folders and the promises guard
are three plugins of the kit, not three modules of the engine.

A CONNECTION IS ANSWERED FOR BY NAME. A plugin that uses one provides
`connection.<id>`, a callable that says whether it is set up right now, and
that is what makes a flow that names it `incomplete` or not (`connected()`
below). No new verb: it is `provide`, read by the engine instead of by a plugin.
What a flow PRODUCED is answered the same way, `flow.results.<what>`, by every
plugin that writes something a flow can leave behind (`flow_results()`).

CURATED FLOWS ARE `surfaces.flows`, and the loader copies them into
`workspace/flows/` itself (`install_flows` below): no plugin writes its own
FLOW.md into the client's workspace.

SKILLS ARE STILL `surfaces.skills`, unless the plugin's module defines
`SKILLS`: a list that overrides the manifest for this engine, and `[]` means it
brings none here. It is a Hermes seam and two plugins still need it, each for a
reason outside this engine:

- `approval`, whose SKILL.md is Hermes-kanban prose. The Hermes agents in
  `kit/fleet.md` still run the approval plugin as a system plugin and read that
  file; indexing it here would tell the face to block a board it does not have.
  It goes when those agents are rebuilt on this engine.
- `social`, whose `post` SKILL.md is the CREATOR's instructions, read whole
  into the sub-agent (`social/core/creator.py`); on the face's index it would
  offer tools the face does not have. It stays a `surfaces.skills` because the
  `social-package` row detects and verifies the capability by that skill's name
  (`kit/capabilities/catalog.json`, `kit/tools/`).

A plugin with no skills declares none in its manifest and needs no override
(`kanban`).
"""

import hashlib
import importlib.util
import json
import sys
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from pydantic_ai.toolsets import (
    AbstractToolset,
    ApprovalRequiredToolset,
    CombinedToolset,
    WrapperToolset,
)
from pydantic_ai_harness.subagents import SubAgent, SubAgents

from . import config, delegation, flows, watchers

ENTRY = "plugin.py"
PROSE = "instructions.md"

# «Nobody passed a default», so `engine.use(name)` can keep raising while
# `engine.use(name, default=None)` answers `None`. `None` itself is a perfectly
# good default for an optional dependency, so it cannot be the sentinel.
_ABSENT = object()


def gated(toolset: AbstractToolset) -> bool:
    """Whether anything in this toolset's tree stops a run at the approval gate.

    `AbstractToolset.apply()` cannot answer it, which is the whole reason this
    walk is written by hand: a `WrapperToolset` hands the visitor the leaf it
    wraps and never itself (`pydantic_ai/toolsets/wrapper.py`), and the wrapper
    IS the gate. So the tree is walked here, over the two public shapes a
    toolset composes with.

    THE ALTERNATIVE WAS ASKING THE APPROVAL PLUGIN for the names it gates,
    through `engine.use("gated_tools")`. This is the better one: it is the
    framework's own type, so it is true of any gated toolset — including one
    another plugin gates tomorrow — instead of being true only while `approval`
    is the one plugin that gates anything.
    """
    if isinstance(toolset, ApprovalRequiredToolset):
        return True
    if isinstance(toolset, WrapperToolset):
        return gated(toolset.wrapped)
    if isinstance(toolset, CombinedToolset):
        return any(gated(inner) for inner in toolset.toolsets)
    return False


@dataclass
class Plugin:
    id: str
    root: Path
    manifest: dict
    module: Any = None

    @property
    def skills(self) -> list[str]:
        declared = self.manifest["surfaces"].get("skills") or []
        return list(getattr(self.module, "SKILLS", declared))

    @property
    def skill_dirs(self) -> list[Path]:
        return [self.root / "skills" / name for name in self.skills]


@dataclass
class Engine:
    """What a plugin's `register(engine)` can add. This is the whole API.

    Four of the eight write straight into the seams the engine already had, so
    a plugin's toolset, hook or capability is live the moment it registers. The
    other four have no home in the engine — the routers the app includes, the
    modules the manifest declares, the prose that goes into the prompt and the
    delegates the face can hand work to — so they are collected here and read
    back by whoever owns them.
    """

    routers: list = field(default_factory=list)
    modules: dict[str, bool | Callable[[], bool]] = field(default_factory=dict)
    prose: list[str] = field(default_factory=list)
    delegates: list[SubAgent] = field(default_factory=list)
    shared: dict[str, Any] = field(default_factory=dict)

    def toolset(self, ts) -> None:
        from . import agent

        agent.EXTRA_TOOLSETS.append(ts)

    def before_persist(self, fn: Callable[[str, str], str]) -> None:
        from . import session

        session.BEFORE_PERSIST.append(fn)

    def capability(self, cap) -> None:
        from . import agent

        agent.CAPABILITIES.append(cap)

    def deferred(self, fn) -> None:
        """The ONE callable that answers a run stopped at a gated tool.

        One and not a list: a paused run has a single outcome — a row somewhere
        and the message the client reads — and two plugins claiming it would be
        two pauses for one stop. The last one to register wins, loudly, because
        `CORE_PLUGINS` is the only thing that decides who is here.
        """
        from . import session

        session.DEFERRED_HANDLER = fn

    def router(self, api_router) -> None:
        self.routers.append(api_router)

    def module(self, name: str, value: bool | Callable[[], bool]) -> None:
        self.modules[name] = value

    def instructions(self, text: str) -> None:
        self.prose.append(text.strip())

    def subagent(self, delegate: SubAgent, label: str) -> None:
        """A delegate the face can hand work to, and the name the client reads.

        `label` is Spanish and the delegate's name is an id, and they are two
        different words on purpose: `delegation.py` writes «Le pedí al creador
        de posteos: …» into Activity, and the id is never on a screen.

        THREE CHECKS, AND EACH ONE IS A SHAPE THAT WOULD FAIL FAR FROM HERE:

        - `deps_type is Deps`, because `SubAgents` forwards the parent's deps
          untouched. A delegate typed against anything else type-checks against
          nothing and breaks inside a tool, mid-delegation.
        - no fixed `output_type`, because what comes back to the face is
          `str(result.output)` and a delegate that answers a model of its own
          would hand it a repr.
        - no gated toolset, which is the rule of `docs/subagents-plan.md`: a
          sub-agent never talks to the client, and the gate is a conversation
          with her. Measured, on this harness: the gate does not propagate out
          of `delegate_task` as a pause — the CHILD run raises, because its own
          run has no `DeferredToolRequests` among its output types, and that
          `UserError` bypasses `contain_errors` and kills the whole turn. The
          client reads «No pude responder». Sensitive tools stay on the face.
        """
        agent = delegate.agent
        name = delegate.resolved_name
        if name is None:
            raise ValueError(
                "a delegate with no name: give its Agent a `name`, or set "
                "`SubAgent(name=…)` — it is how the face refers to it"
            )
        if agent.deps_type is not self.Deps:
            raise ValueError(
                f"the delegate {name!r} is typed on {agent.deps_type!r} and the engine "
                f"forwards the face's own deps: build it with `deps_type=engine.Deps`"
            )
        if agent.output_type is not str:
            raise ValueError(
                f"the delegate {name!r} has a fixed output type ({agent.output_type!r}), "
                f"and what comes back to the face is `str(output)`: leave it as text"
            )
        for toolset in agent.toolsets:
            if gated(toolset):
                raise ValueError(
                    f"the delegate {name!r} carries a gated toolset: a sub-agent never "
                    f"talks to the client, so nothing it can call may stop the run to "
                    f"ask her. Leave the sensitive tool on the face"
                )
        delegation.LABELS[name] = label
        self.delegates.append(delegate)

    def tools(self, *names: str) -> AbstractToolset:
        """Some of the engine's own tools, by name, as one toolset.

        So a sub-agent picks from the SAME definitions the face has — one
        `read_file`, with one docstring — instead of a second copy that drifts.
        A name the engine does not offer raises here, at startup, and not on
        the first delegation of the first morning.
        """
        from . import agent

        return agent.tools(*names)

    @property
    def identity(self) -> str:
        """What every agent of this client shares: the SOUL's opening and the
        `core:base` block, minus the line about the chat (`core/agent.py`).

        Not the plugins' prose, not the skills index, and not the face's scope:
        those are the face's mechanisms and the face's job, and a delegate that
        reads about a tool it does not have is a delegate that will try to use
        it.

        A PLAIN STRING, fixed at load. That is what puts it FIRST in a
        delegate's prompt: Pydantic AI renders every literal instruction before
        every callable one, so as a callable it landed LAST — after the skill,
        after the memory guidance — which is the bug this shape fixes.
        """
        from . import agent

        return agent.IDENTITY

    @property
    def today(self) -> Callable[[], str]:
        """The date line, as a CALLABLE a delegate puts last in its list.

        Separate from `identity` precisely because it is the one line that
        changes by itself: a callable sorts after the literals, so the stable
        prefix above it is what the provider's cache keeps.
        """
        from . import agent

        return agent.today

    def watcher(self, name: str, fn: Callable[[], str | None], every: int = 60) -> None:
        """What fires an `event` flow. `fn` looks for what is new WITH NO MODEL
        and returns it as text, or `None`; a flow that names it
        (`event: <name>`) runs when it returns something, with that text in its
        prompt. `core/watchers.py` is the why."""
        watchers.register(name, fn, every)

    def ticker(self, name: str, fn: Callable[[], None], every: int = 60) -> None:
        """Code the clock calls every `every` seconds, with no flow and no
        model behind it. `core/watchers.py` says when that is the right tool."""
        watchers.register_ticker(name, fn, every)

    def notifier(self, name: str, send: Callable[[str, str, str, str | None], None]) -> None:
        """A way to reach the owner (`core/notify.py`): `send(to, subject,
        text, link)`, raising when it did not send."""
        from . import notify

        notify.register(name, send)

    def provide(self, name: str, obj: Any) -> None:
        """Offer an object to the plugins that load after this one."""
        self.shared[name] = obj

    def use(self, name: str, default: Any = _ABSENT) -> Any:
        """One of those, by name. A `KeyError` here is one of two things: the
        plugin that provides it is not in `CORE_PLUGINS`, or it is and it loads
        AFTER this one — `requires.plugins` in the manifest is what orders
        them.

        WITH A `default`, THE DEPENDENCY IS OPTIONAL and the missing case is a
        real state of the product, not a misconfiguration: a client buys
        `social-package` without `instagram-comments`, so the creator asks for
        the performance toolset the `instagram` plugin provides and works
        without it when nobody bought it. That is the ONLY thing this argument
        is for. A plugin the manifest declares in `requires.plugins` is not
        optional, and asking for one of its objects with a default would turn a
        broken `CORE_PLUGINS` into a silently poorer agent — which is why the
        bare call still raises.
        """
        if default is _ABSENT:
            return self.shared[name]
        return self.shared.get(name, default)

    @property
    def model(self):
        """The engine's model with its retry (`agent.model()`), for a plugin's
        own `Agent(...)`: a sub-agent dies on the same malformed body the face
        would, so it gets the same cover."""
        from . import agent

        return agent.model()

    @property
    def model_settings(self) -> dict:
        return config.MODEL_SETTINGS

    @property
    def Deps(self) -> type:
        """The deps every agent of this engine is typed on. A class, so it is
        spelled like one."""
        from . import agent

        return agent.Deps


_engine = Engine()
_loaded: list[Plugin] = []


# ── the curated flows a plugin ships ────────────────────────────────────────
#
# `surfaces.flows` names folders of the plugin (`flows/<slug>/`), each with a
# FLOW.md, and on this engine a flow is a file in `workspace/flows/`
# (`core/flows.py`). There is no install step between the kit and the
# container — the kit is a read-only bind mount and the workspace is the
# client's — so the loader copies each one in when the plugin loads, before the
# scheduler's first tick, and NEVER over a file that already exists: from the
# moment it is there it is hers to pause and the agent's to edit, and a paused
# flow is `status: paused`, which is still a file.
#
# TWO KINDS OF HISTORY, both keyed on the sha256 of the EXACT bytes we shipped,
# because the installed file has two owners and a hash is the only honest way
# to tell whether the other one touched it. A plugin's `core/plugin.py` may
# declare either, as a module constant:
#
#   SUPERSEDED = {slug: digest}       a flow it no longer ships at all. An
#                                     untouched copy is deleted; an edited one
#                                     stays, and the log says both now run
#   UPGRADED = {slug: {digest, ...}}  earlier versions of a flow it still
#                                     ships. An untouched copy is replaced by
#                                     today's; an edited one stays as it is
#
# `print(..., flush=True)`: a line block-buffered behind a container's pipe is
# a line nobody reads until the next hundred arrive.


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def retire_flows(plugin: Plugin) -> None:
    for slug, shipped in getattr(plugin.module, "SUPERSEDED", {}).items():
        installed = flows.file_of(slug)
        if not installed.is_file():
            continue
        if digest(installed) != shipped:
            print(f"{plugin.id}: workspace/flows/{slug}/ was edited, so it stays — the "
                  f"plugin no longer ships it, and it runs until somebody removes it",
                  flush=True)
            continue
        installed.unlink()
        if not any(installed.parent.iterdir()):
            installed.parent.rmdir()
        print(f"{plugin.id}: retired workspace/flows/{slug}/, which it no longer ships",
              flush=True)


def install_flows(plugin: Plugin) -> None:
    upgraded = getattr(plugin.module, "UPGRADED", {})
    for folder in plugin.manifest["surfaces"].get("flows") or []:
        source = plugin.root / folder / flows.FLOW_FILE
        target = flows.file_of(source.parent.name)
        if not target.exists():
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(source.read_bytes())
            continue
        current = source.read_bytes()
        had = target.read_bytes()
        if had == current or target.parent.name not in upgraded:
            continue
        if digest(target) not in upgraded[target.parent.name]:
            print(f"{plugin.id}: workspace/flows/{target.parent.name}/ was edited, so it "
                  f"stays as it is — the version we ship now is a different one", flush=True)
            continue
        target.write_bytes(current)
        print(f"{plugin.id}: brought workspace/flows/{target.parent.name}/ up to the "
              f"version we ship", flush=True)


def import_surface(plugin_id: str, directory: Path):
    """`plugin.py`, with the folder it is in importable.

    The plugin's own directory goes on `sys.path` and STAYS there: its modules
    import each other by plain name (`import store`), including from inside a
    function called turns later. The engine's own `core` and `server` packages
    are already importable — a plugin of this engine is written against them,
    which is the difference between this surface and `engine/`, written against
    Hermes.
    """
    sys.path.insert(0, str(directory))
    spec = importlib.util.spec_from_file_location(f"kit_plugin_{plugin_id}", directory / ENTRY)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def load() -> list:
    """Every enabled plugin, in `CORE_PLUGINS` order. Returns their routers.

    A plugin's `instructions.md` goes into the prompt before anything its
    `register()` adds, so the file is the plugin's voice and the code's is the
    exception. Its `surfaces.flows` land in the workspace right after, and all
    of this happens before `server/app.py` starts the scheduler, so the first
    tick already sees a curated flow.

    THE DELEGATES ARE COLLECTED AND MOUNTED ONCE, AT THE END. One `SubAgents`
    capability means one `delegate_task` tool and one listing in the prompt,
    whichever plugins brought the delegates; two capabilities would be two
    tools with the same name. It is added only if a plugin registered one —
    an engine with no delegate has no delegate tool, no listing and nothing
    listening for delegation events.
    """
    for plugin_id in config.PLUGINS:
        root = config.KIT_PLUGINS / plugin_id
        plugin = Plugin(plugin_id, root, json.loads((root / "plugin.json").read_text()))
        surface = plugin.manifest["surfaces"].get("core")
        if surface:
            directory = root / surface
            plugin.module = import_surface(plugin_id, directory)
            prose = directory / PROSE
            if prose.is_file():
                _engine.instructions(prose.read_text())
            plugin.module.register(_engine)
        retire_flows(plugin)
        install_flows(plugin)
        _loaded.append(plugin)
    if _engine.delegates:
        _engine.capability(
            SubAgents(
                agents=_engine.delegates,
                # The child's tokens land in the parent's usage, so
                # `core/turn_usage.py` prices a delegated turn whole and needs
                # to know nothing about any of this.
                forward_usage=True,
                # A delegate that crashes comes back to the face as a retry it
                # can read and answer from. One creator breaking is not the
                # client's turn dying.
                contain_errors=True,
                tool_name=delegation.TOOL,
                # Markdown agent definitions are not this engine's mechanism: a
                # delegate is built by the plugin that owns it. Left at its
                # default this would also scan the container's cwd and home for
                # `.agents/` folders at startup.
                agent_folders=None,
            )
        )
        _engine.capability(delegation.Delegation())
    return _engine.routers


def enabled() -> list[Plugin]:
    return _loaded


def prose() -> list[str]:
    """The plugins' instructions, in the order they were loaded."""
    return _engine.prose


def connected(connection_id: str) -> bool:
    """Whether the connection a flow names is set up on this agent.

    A CONNECTION IS A PLUGIN'S, AND SO IS THE ANSWER. The plugin that uses a
    connection is the only one that knows what «set up» means for it — four
    variables for the mailbox, a token and an account id for Instagram — so it
    provides the check by name, `engine.provide("connection.<id>", fn)`, and
    `fn()` answers from what is there NOW: a secret added and a restart later,
    the flow is complete again.

    AN ID NO PLUGIN ANSWERS FOR IS NOT CONNECTED. That is the honest reading:
    nothing on this agent can use it, so a flow that needs it cannot do its
    work today, and the client has to be told.
    """
    check = _engine.shared.get(f"connection.{connection_id}")
    return bool(check and check())


def missing(connections: list[str]) -> list[str]:
    """Of what a flow declares, what is not set up, in the order declared."""
    return [c for c in connections if not connected(c)]


RESULTS = "flow.results."


def flow_results(slug: str) -> list[dict]:
    """What a flow produced, newest first: `{path, mtime}` and maybe `label`.

    WHAT A FLOW LEAVES BEHIND IS THE BUSINESS OF THE PLUGIN THAT MAKES IT — a
    deliverable in `entregables/<slug>/`, a post whose `flow` is this slug — so
    each one provides a reader by name, `engine.provide("flow.results.<what>",
    fn)`, and `fn(slug)` answers with the workspace paths it knows came out of
    that flow. Every provider is asked, the same way the board asks every
    `tickets.detail.*` it finds. The engine keeps no list of its own: a result
    is a file on disk, and a file deleted is a result gone.
    """
    found = [
        item
        for name, reader in _engine.shared.items()
        if name.startswith(RESULTS)
        for item in reader(slug)
    ]
    found.sort(key=lambda item: item["mtime"], reverse=True)
    return found


def modules() -> dict[str, bool]:
    """What the portal's manifest declares: the engine's own, plus what the
    plugins flipped. A callable is asked here and not at registration, so a
    module can be on only while whatever it draws is."""
    out = dict(config.MODULES)
    for name, value in _engine.modules.items():
        out[name] = bool(value() if callable(value) else value)
    return out
