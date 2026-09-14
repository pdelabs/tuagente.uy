"""The agent's hands: bash and files, confined to /workspace.

Confinement is `resolve()` + `relative_to(root)`: a path that leaves the
workspace raises and the run shows the error. Nothing is silently rewritten
into a "safe" path, because a tool that quietly writes somewhere else is worse
than one that fails.
"""

import subprocess
from pathlib import Path

from pydantic_ai import RunContext
from pydantic_ai.toolsets import FunctionToolset

MAX_OUTPUT = 20 * 1024
BASH_TIMEOUT = 60


def under(root: Path, relative: str) -> Path:
    """The absolute path of `relative` inside `root`, or ValueError."""
    target = (root / relative).resolve()
    target.relative_to(root.resolve())
    return target


def cap(text: str) -> str:
    if len(text) <= MAX_OUTPUT:
        return text
    return text[:MAX_OUTPUT] + f"\n[... cut: {len(text) - MAX_OUTPUT} more characters]"


def run_bash(root: Path, command: str) -> str:
    done = subprocess.run(
        command, shell=True, cwd=root, capture_output=True, text=True, timeout=BASH_TIMEOUT
    )
    parts = []
    if done.stdout:
        parts.append(done.stdout)
    if done.stderr:
        parts.append(f"[stderr]\n{done.stderr}")
    if done.returncode != 0:
        parts.append(f"[exit {done.returncode}]")
    return cap("\n".join(parts) or "[no output]")


def read(root: Path, path: str) -> str:
    return cap(under(root, path).read_text())


def write(root: Path, path: str, content: str) -> str:
    target = under(root, path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content)
    return f"written: {target.relative_to(root)} ({len(content)} characters)"


def listing(root: Path, subdir: str = ".") -> str:
    base = under(root, subdir)
    files = sorted(p for p in base.rglob("*") if p.is_file())
    if not files:
        return f"{subdir}: no files"
    return "\n".join(f"{p.relative_to(root)}\t{p.stat().st_size}" for p in files)


def toolset() -> FunctionToolset:
    ts = FunctionToolset()

    @ts.tool
    def bash(ctx: RunContext, command: str) -> str:
        """Run a shell command in the workspace. 60 s timeout, output capped."""
        return run_bash(ctx.deps.workspace, command)

    @ts.tool
    def read_file(ctx: RunContext, path: str) -> str:
        """Read a file from the workspace, by its path relative to the workspace."""
        return read(ctx.deps.workspace, path)

    @ts.tool
    def write_file(ctx: RunContext, path: str, content: str) -> str:
        """Write a file into the workspace, by its path relative to the workspace."""
        return write(ctx.deps.workspace, path, content)

    @ts.tool
    def list_files(ctx: RunContext, subdir: str = ".") -> str:
        """List the workspace's files, recursively, with their size in bytes."""
        return listing(ctx.deps.workspace, subdir)

    return ts
