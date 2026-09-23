"""The kit's skills, the same way Hermes discloses them: an index in the
instructions (name + description, from the SKILL.md frontmatter) and a
`skill_view` tool that returns the body when the agent decides to use one.
"""

from dataclasses import dataclass
from functools import cache

import frontmatter
from pydantic_ai import RunContext
from pydantic_ai.toolsets import FunctionToolset

from .. import plugins


@dataclass(frozen=True)
class Skill:
    """One SKILL.md. Two audiences, two pairs of fields: `name` and
    `description` are the MODEL's — the id it calls and when to use it —, and
    `title` and `client_summary` are the OWNER's, what Habilidades shows. Both
    pairs are required frontmatter: a skill with no owner line is a skill whose
    model-facing instructions end up on her screen."""

    name: str
    description: str
    title: str
    client_summary: str
    body: str


@cache
def index() -> dict[str, Skill]:
    found: dict[str, Skill] = {}
    for plugin in plugins.enabled():
        for skill_dir in plugin.skill_dirs:
            post = frontmatter.load(skill_dir / "SKILL.md")
            skill = Skill(post["name"], post["description"], post["title"],
                          post["client_summary"], post.content)
            found[skill.name] = skill
    return found


def index_text() -> str:
    """The block that goes into the instructions. Spanish: the agent reads it."""
    listed = index().values()
    if not listed:
        return ""
    lines = [
        "## Skills disponibles",
        "",
        "Cada una es un procedimiento del kit. Leela con `skill_view(nombre)`"
        " ANTES de usarla: el índice dice para qué sirve, no cómo se usa.",
        "",
    ]
    lines += [f"- **{s.name}**: {s.description}" for s in listed]
    return "\n".join(lines)


def toolset() -> FunctionToolset:
    ts = FunctionToolset()

    @ts.tool
    def skill_view(ctx: RunContext, name: str) -> str:
        """Read a skill's instructions by its name, as listed in the index."""
        return index()[name].body

    return ts
