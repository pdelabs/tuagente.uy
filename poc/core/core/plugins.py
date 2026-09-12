"""Which kit plugins are enabled, and where their skills live.

The kit is mounted read-only at /opt/kit/plugins. A plugin declares the skills
it brings in `plugin.json` under `surfaces.skills`; nothing self-installs and
nothing is discovered by walking the tree: the list comes from `CORE_PLUGINS`.
"""

import json
from dataclasses import dataclass
from pathlib import Path

from . import config


@dataclass(frozen=True)
class Plugin:
    id: str
    root: Path
    manifest: dict

    @property
    def skill_dirs(self) -> list[Path]:
        return [self.root / "skills" / name for name in self.manifest["surfaces"].get("skills", [])]


def enabled() -> list[Plugin]:
    out = []
    for plugin_id in config.PLUGINS:
        root = config.KIT_PLUGINS / plugin_id
        out.append(Plugin(plugin_id, root, json.loads((root / "plugin.json").read_text())))
    return out
