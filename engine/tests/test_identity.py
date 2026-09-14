#!/usr/bin/env python3
"""`engine.identity` — what a delegate inherits from the SOUL, and what it does
not. Run it from anywhere: `python3 engine/tests/test_identity.py`.

Free and instant: no model, no turn. It reads `engine/agent/SOUL.md` on the host
and asks the RUNNING container for `core.agent.identity()`, so what is asserted
is the string the creator is actually built with and not a second copy of the
rule written here.

WHAT THE SPLIT IS (`core/agent.py`): the SOUL's opening paragraphs, up to its
first `## ` heading, plus the `core:base` block minus its last line. Who the
client is travels; the face's scope, its writing rules, its hours and its
manners in the chat do not — a delegate has no chat, and a trace on 14/09 had
the creator reading «Lo que te pidan por el chat» as the last thing before it
worked.
"""

import subprocess
import sys
from pathlib import Path

CORE = Path(__file__).resolve().parent.parent
SOUL = CORE / "agent" / "SOUL.md"
CONTAINER = "tuagente-core"

BASE = "<!-- core:base v2 -->"
CHAT_MANNERS = "En el chat, respuestas cortas."

# The headings of the client's half of a SOUL. Everything under one of them is
# the FACE's job description, and none of it may reach a delegate.
FACE_ONLY = ("## Tu alcance", "## Cómo escribís", "## Horarios")


def identity() -> str:
    """What the engine hands a plugin, asked of the engine itself."""
    return subprocess.run(
        ["docker", "exec", CONTAINER, "python3", "-c",
         "from core import agent; print(agent.identity(), end='')"],
        check=True, capture_output=True, text=True,
    ).stdout


def judge(name: str, problems: list[str]) -> list[str]:
    print(f"  {name}: " + ("PASS" if not problems else "FAIL — " + "; ".join(problems)))
    return problems


def main() -> int:
    soul = SOUL.read_text().strip()
    head, base = soul.split(BASE)
    opening = head.split("\n## ")[0].strip()
    shared = base.strip().removesuffix(CHAT_MANNERS).strip()

    text = identity()
    print(f"soul    : {SOUL}")
    print(f"identity: {len(text)} chars of {len(soul)}\n")
    print("\n".join(f"  | {line}" for line in text.splitlines()))
    print()

    failures: list[str] = []
    failures += judge(
        "a. it opens with the company's own paragraphs",
        [] if text.startswith(opening) else ["identity does not start with the SOUL's opening"],
    )
    failures += judge(
        "b. and carries the shared block",
        [] if shared and shared in text else ["the core:base block is not in identity"],
    )
    failures += judge(
        "c. without the face's manners in the chat",
        [f"identity carries {CHAT_MANNERS!r}"] if CHAT_MANNERS in text else [],
    )
    failures += judge(
        "d. and without the face's job description",
        [f"identity carries {h!r}" for h in FACE_ONLY if h in soul and h in text],
    )
    # Each of those sections has a body, and the heading leaving is not the
    # body leaving: the first line under «## Tu alcance» is the real claim.
    body = []
    for heading in FACE_ONLY:
        if heading not in soul:
            continue
        lines = [l for l in soul.split(heading, 1)[1].splitlines() if l.strip()]
        if lines and lines[0].strip() in text:
            body.append(f"the body of {heading!r} is in identity")
    failures += judge("e. nor what is under it", body)

    print("IDENTITY: PASS" if not failures else "IDENTITY: FAIL")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
