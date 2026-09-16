"""The agent's hands: bash and files, confined to /workspace.

Confinement is `resolve()` + `relative_to(root)`: a path that leaves the
workspace raises and the run shows the error. Nothing is silently rewritten
into a "safe" path, because a tool that quietly writes somewhere else is worse
than one that fails.

A PATH THAT IS NOT THERE IS A SENTENCE, NOT A CRASH, and that is measured, not
a precaution. On our own agent (2026-09-15) the face read a `post.json` that a
tool had just deleted; `FileNotFoundError` came out of `read_file`, nothing
caught it, and the client's turn ended in «No pude responder: [Errno 2] No such
file or directory». The model had everything it needed to recover — the folder
was there, the file was not — and never got told. The three file tools now hand
those three errors back as a `ModelRetry` with the path in it, in Spanish,
because that message can also end up quoted to the client. Everything else
still raises: a tool that swallows what it does not understand is how an agent
says it did something it did not do.
"""

import subprocess
from pathlib import Path

from pydantic_ai import ModelRetry, RunContext
from pydantic_ai.toolsets import FunctionToolset

MAX_OUTPUT = 20 * 1024
BASH_TIMEOUT = 60

# What the model reads when the path is wrong. One line, Spanish, and the path
# in it: which path it got wrong is the whole of what it has to know.
MISSING = "no existe `{path}`"
NOT_A_DIRECTORY = "`{path}` no es una carpeta"
IS_A_DIRECTORY = "`{path}` es una carpeta, no un archivo"


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
    # A FOLDER THAT IS NOT THERE IS NOT AN EMPTY FOLDER. `rglob` on a path that
    # does not exist answers nothing at all, so «no files» used to mean both
    # things at once and the model was told the wrong one — the same shape of
    # lie as the Files tab saying «This folder is empty» over eight files
    # (`docs/portal-routes.md`). These two raise so `tell` can say which it is.
    base = under(root, subdir)
    if not base.exists():
        raise FileNotFoundError(base)
    if not base.is_dir():
        raise NotADirectoryError(base)
    files = sorted(p for p in base.rglob("*") if p.is_file())
    if not files:
        return f"{subdir}: no files"
    return "\n".join(f"{p.relative_to(root)}\t{p.stat().st_size}" for p in files)


def tell(path: str, action):
    """Run it, and turn the three file errors into words the model can act on.

    Only these three. A permission error, a full disk or a decoding failure is
    not something the model can fix by picking another path, and turning it
    into a retry would have it trying the same thing again.
    """
    try:
        return action()
    except FileNotFoundError:
        raise ModelRetry(MISSING.format(path=path)) from None
    except NotADirectoryError:
        raise ModelRetry(NOT_A_DIRECTORY.format(path=path)) from None
    except IsADirectoryError:
        raise ModelRetry(IS_A_DIRECTORY.format(path=path)) from None


def toolset() -> FunctionToolset:
    ts = FunctionToolset()

    @ts.tool
    def bash(ctx: RunContext, command: str) -> str:
        """Run a shell command in the workspace. 60 s timeout, output capped."""
        return run_bash(ctx.deps.workspace, command)

    @ts.tool
    def read_file(ctx: RunContext, path: str) -> str:
        """Read a file from the workspace, by its path relative to the workspace."""
        return tell(path, lambda: read(ctx.deps.workspace, path))

    @ts.tool
    def write_file(ctx: RunContext, path: str, content: str) -> str:
        """Write a file into the workspace, by its path relative to the workspace."""
        return tell(path, lambda: write(ctx.deps.workspace, path, content))

    @ts.tool
    def list_files(ctx: RunContext, subdir: str = ".") -> str:
        """List the workspace's files, recursively, with their size in bytes."""
        return tell(subdir, lambda: listing(ctx.deps.workspace, subdir))

    return ts
