"""Which kit plugins are enabled, and what each one adds to this engine.

The kit is mounted read-only at /opt/kit/plugins. Nothing self-installs and
nothing is discovered by walking the tree: the list is `CORE_PLUGINS`, and the
order in it is the order everything happens in.

A plugin that has something to add to THIS engine declares `surfaces.core` in
its `plugin.json` — a directory holding `plugin.py` and, if the mechanism needs
words, an `instructions.md`. `load()` imports that file and calls
`register(engine)`, and the object it hands over has seven verbs and no more:

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

WHY THE MECHANICS ARE NOT IN THIS DIRECTORY ANY MORE. A rule lives in exactly
one place, decided by what can enforce it: in code when code can check it, in a
tool's description when it is about using that tool, in the SOUL only when it
is about who the agent is. Prose about a mechanism ships WITH the mechanism, so
it is in the prompt only where that mechanism is installed — which is what a
plugin is. The approval gate, the deliverable folders and the promises guard
are three plugins of the kit, not three modules of the engine.

SKILLS ARE STILL `surfaces.skills`, unless the plugin's module defines
`SKILLS`: a list that overrides the manifest for this engine, and `[]` means it
brings none here. The approval plugin's SKILL.md is Hermes-kanban prose and the
flow plugin's drives a runner this engine does not have.
"""

import importlib.util
import json
import sys
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from . import config

ENTRY = "plugin.py"
PROSE = "instructions.md"


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

    Four of the seven write straight into the seams the engine already had, so
    a plugin's toolset, hook or capability is live the moment it registers. The
    other three have no home in the engine — the routers the app includes, the
    modules the manifest declares and the prose that goes into the prompt — so
    they are collected here and read back by whoever owns them.
    """

    routers: list = field(default_factory=list)
    modules: dict[str, bool | Callable[[], bool]] = field(default_factory=dict)
    prose: list[str] = field(default_factory=list)

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


_engine = Engine()
_loaded: list[Plugin] = []


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
    exception.
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
        _loaded.append(plugin)
    return _engine.routers


def enabled() -> list[Plugin]:
    return _loaded


def prose() -> list[str]:
    """The plugins' instructions, in the order they were loaded."""
    return _engine.prose


def modules() -> dict[str, bool]:
    """What the portal's manifest declares: the engine's own, plus what the
    plugins flipped. A callable is asked here and not at registration, so a
    module can be on only while whatever it draws is."""
    out = dict(config.MODULES)
    for name, value in _engine.modules.items():
        out[name] = bool(value() if callable(value) else value)
    return out
