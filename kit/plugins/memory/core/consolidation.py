"""Every notebook, tidied once a night: merged, corrected, back under budget.

WHY IT EXISTS. The notebook was append-only with a substring dedupe, and on our
own agent (2026-09-24) that made it a pile nobody pruned: three copies of one
fact in three wordings, two lines contradicting each other, a post's topic
(«no posteos los domingos») filed as a rule, everything in the third person
from before the notebook spoke to the owner — and the creator's notebook a
39-line log of «posteo guardado…», which is what `posteos/` already is, cut
off at the injection budget so its newest lines were the ones nobody read.

WHAT IT DOES. Once a day, on the first tick after `HOUR` in the agent's own
timezone, every notebook an agent reads (`NOTEBOOKS`, filled by the plugin's
`notebook()`) that changed since its last tidy goes to the notebook's model
(`CORE_MEMORY_MODEL`, no tools) with its lines NUMBERED, and comes back as a
list of lines to keep, each one saying which old lines it stands for.

THE MODEL PICKS THE WORDS, THE CODE DOES THE REST — the same house rule as the
extraction. The model answers `sources` + `kind` + `text` and nothing else:
  - the DATE of a kept line is its newest source's, so «on a contradiction the
    newest wins» is also the date the line carries, and no date is invented;
  - the ORIGIN (`· chat`) is its newest source's, when it had one;
  - a source is used once at most and every number exists, so the notebook
    can shrink and merge but never grow a line out of nothing;
  - an empty answer, or one that renders over the notebook's budget, is
    REFUSED: the notebook stays as it was and the refusal is one log line.
What it merged is `len(sources) - 1` per line and what it dropped is every
number no line claimed, which is what the owner reads in Activity.

BEFORE A WRITE, THE OLD NOTEBOOK IS COPIED to `memoria/.history/<scope>/`.
The store's journal (`.memory-store.sqlite3`) is what makes a write atomic, not
a history — it keeps an operation's NEW content, never the one it replaced. The
copy sits OUTSIDE the scope's folder on purpose: the harness lists a scope's
files into the prompt and `search_memory` searches them, and yesterday's
notebook is not something the agent should find. A dot folder, so Archivos
skips it with every other dotfile.

ONCE A DAY AND ONCE AFTER A RESTART. The day is marked in `memory_marks`
BEFORE the run, the business watcher's rule: a model that fails is one log
line and a try tomorrow, never a retry every tick on the client's key. Each
notebook's digest after its tidy is marked too, so a notebook nobody wrote in
since is not sent again.
"""

import hashlib
import re
import time
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Literal
from zoneinfo import ZoneInfo

from pydantic import BaseModel
from pydantic_ai import Agent
from pydantic_ai_harness.memory import MemoryStore

from core import config, db, turn_usage

TICKER = "memory.tidy"
EVERY = 300

# The first tick at or after this hour, local time: the owner is asleep and no
# flow of the morning has run yet.
HOUR = 3

# The same per-file boundary the extraction reads with.
MAX_NOTEBOOK = 65_536

# A tidied notebook of 40 lines is ~2,500 tokens of output at most.
MODEL_SETTINGS = {"max_tokens": 4096}

SCHEMA = "CREATE TABLE IF NOT EXISTS memory_marks (key TEXT PRIMARY KEY, value TEXT NOT NULL, at REAL NOT NULL)"
db.write(SCHEMA)

# What an agent reads its notebook with, by scope: the characters the injection
# has room for, and the rule the notebook is kept under, which is also what
# the tidy is told the notebook is for. `plugin.notebook()` fills it.
NOTEBOOKS: dict[str, tuple[int, str]] = {}

# `- 24/09/2026 · preferencia · chat: Preferís…`; a line from before the origin
# existed has no `· chat`, and one the model wrote on its own may have no date.
LINE = re.compile(r"^-\s*(\d{2}/\d{2}/\d{4})\s*·\s*(.*)$")
ORIGINS = ("chat",)

INSTRUCTIONS = (
    "Ordenás el cuaderno de un agente. Te llega numerado, línea por línea, con"
    " la regla con la que se lleva ese cuaderno. Devolvés las líneas que se"
    " quedan, cada una con los números de las líneas viejas que reemplaza.\n"
    "- Lo mismo dicho dos o más veces es UNA línea, con todos sus números.\n"
    "- Si dos líneas se contradicen, vale la más nueva (la fecha va adelante):"
    " escribí lo que dice la más nueva y poné los números de las dos.\n"
    "- Sacá, sin ponerlas en ningún lado: los procedimientos (cómo se hace una"
    " tarea), el contenido de un trabajo (el tema o el texto de un posteo, lo"
    " que dijo una pieza) y los registros de lo que se hizo («posteo guardado…»,"
    " «se reemplazó la lámina…»). Una corrección puntual a una pieza se queda"
    " solo si deja algo que sirve para las próximas, y entonces escribila como"
    " eso que sirve.\n"
    "- Cada línea es UNA oración corta en español, que se entienda sola, escrita"
    " hablándole a «vos» como dice la regla del cuaderno: nunca «El cliente…»"
    " ni «El agente…».\n"
    "- No inventes nada que no esté en las líneas. No escribas la fecha: la pone"
    " el sistema.\n"
    "- `kind` es «hecho», «preferencia» o «corrección».\n"
    "- El cuaderno ordenado tiene que entrar en los caracteres que te digo. Si"
    " no entra, dejá lo más nuevo y lo que más sirve para trabajar."
)


class Kept(BaseModel):
    """One line of the tidied notebook, before the code dates it."""

    sources: list[int]
    kind: Literal["hecho", "preferencia", "corrección"]
    text: str


@dataclass(frozen=True)
class Source:
    number: int
    text: str
    day: date | None
    origin: str | None


@dataclass(frozen=True)
class Tidied:
    scope: str
    merged: int
    removed: int
    backup: str


class Refused(Exception):
    """The model's answer broke a rule the code checks; the notebook stays."""


_tidier: Agent | None = None


def tidier() -> Agent:
    global _tidier
    if _tidier is None:
        _tidier = Agent(
            config.MEMORY_MODEL,
            instructions=INSTRUCTIONS,
            output_type=list[Kept],
            model_settings=MODEL_SETTINGS,
        )
    return _tidier


def register(scope: str, budget: int, rule: str) -> None:
    NOTEBOOKS[scope] = (budget, rule)


def sources(content: str) -> list[Source]:
    """Every non-blank line of the notebook, numbered from 1."""
    found = []
    for raw in (l.strip() for l in content.splitlines()):
        if not raw:
            continue
        matched = LINE.match(raw)
        day = datetime.strptime(matched.group(1), "%d/%m/%Y").date() if matched else None
        head = matched.group(2).split(":", 1)[0] if matched else ""
        origin = next((o for o in ORIGINS if head.endswith(f"· {o}")), None)
        found.append(Source(len(found) + 1, raw, day, origin))
    return found


def ask(lines: list[Source], budget: int, rule: str) -> str:
    numbered = "\n".join(f"{s.number}. {s.text}" for s in lines)
    return (
        f"REGLA DEL CUADERNO:\n{rule}\n\n"
        f"CUADERNO ({budget} caracteres como máximo, ordenado):\n{numbered}"
    )


def render(kept: Kept, by_number: dict[int, Source], today: date) -> str:
    newest = max((by_number[n] for n in kept.sources), key=lambda s: (s.day or date.min, s.number))
    stamp = (newest.day or today).strftime("%d/%m/%Y")
    origin = f" · {newest.origin}" if newest.origin else ""
    return f"- {stamp} · {kept.kind}{origin}: {' '.join(kept.text.split())}"


def check(answer: list[Kept], lines: list[Source], budget: int, today: date) -> tuple[str, int, int]:
    """The tidied notebook, and how many lines it merged and dropped. Or `Refused`."""
    if not answer:
        raise Refused("the answer is empty")
    by_number = {s.number: s for s in lines}
    used: list[int] = [n for kept in answer for n in kept.sources]
    if any(not kept.sources or not kept.text.strip() for kept in answer):
        raise Refused("a line with no source or no text")
    if set(used) - set(by_number):
        raise Refused(f"sources that do not exist: {sorted(set(used) - set(by_number))}")
    if len(used) != len(set(used)):
        raise Refused("a source used twice")
    content = "\n".join(render(kept, by_number, today) for kept in answer) + "\n"
    if len(content) > budget:
        raise Refused(f"{len(content)} characters, over the budget of {budget}")
    merged = sum(len(kept.sources) - 1 for kept in answer)
    return content, merged, len(lines) - len(used)


def digest(content: str) -> str:
    return hashlib.sha256(content.encode()).hexdigest()


def marked(key: str) -> str | None:
    row = db.one("SELECT value FROM memory_marks WHERE key = ?", (key,))
    return row["value"] if row else None


def mark(key: str, value: str) -> None:
    db.write(
        "INSERT INTO memory_marks (key, value, at) VALUES (?, ?, ?)"
        " ON CONFLICT(key) DO UPDATE SET value = excluded.value, at = excluded.at",
        (key, value, time.time()),
    )


def label(merged: int, removed: int) -> str:
    """What the owner reads in Activity. No internals: no scope, no model."""
    if not merged and not removed:
        return "Ordené mi memoria: la dejé más clara, sin quitar nada"
    joined = "1 línea unida" if merged == 1 else f"{merged} líneas unidas"
    dropped = "1 quitada" if removed == 1 else f"{removed} quitadas"
    return f"Ordené mi memoria: {joined}, {dropped}"


@dataclass
class Tidy:
    store: MemoryStore
    # The store's root: the backups go under it, next to the scopes.
    root: Path

    async def notebook(self, scope: str, now: datetime) -> Tidied | None:
        """One notebook, tidied and written, or `None` when there was nothing."""
        budget, rule = NOTEBOOKS[scope]
        path = f"{scope}/MEMORY.md"
        current = await self.store.read(path, max_chars=MAX_NOTEBOOK)
        if current is None or not current.content.strip():
            return None
        if marked(f"digest:{scope}") == digest(current.content):
            return None
        lines = sources(current.content)
        result = await tidier().run(ask(lines, budget, rule))
        turn_usage.spend(None, "ordenar la memoria", turn_usage.cost(result))
        content, merged, removed = check(result.output, lines, budget, now.date())

        history = self.root / ".history" / scope
        history.mkdir(parents=True, exist_ok=True)
        backup = history / f"MEMORY-{now.strftime('%Y-%m-%d-%H%M')}.md"
        backup.write_text(current.content)
        await self.store.write(path, content, expected_version=current.version)
        mark(f"digest:{scope}", digest(content))
        return Tidied(scope, merged, removed, f"{self.root.name}/{backup.relative_to(self.root)}")

    async def run(self, now: datetime | None = None) -> list[Tidied]:
        """Every notebook, now. The ticker's body, and the manual trigger."""
        now = now or datetime.now(ZoneInfo(config.TIMEZONE))
        done = []
        for scope in sorted(NOTEBOOKS):
            try:
                tidied = await self.notebook(scope, now)
            except Refused as refused:
                print(f"memory: the tidy of {scope} was refused ({refused}); it stays as it was",
                      flush=True)
                continue
            if tidied:
                done.append(tidied)
        if done:
            db.append_event(
                "memoria",
                label(sum(t.merged for t in done), sum(t.removed for t in done)),
                "completed",
                None,
                {"tidied": [t.__dict__ for t in done]},
            )
        return done

    async def look(self) -> None:
        """The ticker: the first call at or after `HOUR` on a day that has not run."""
        now = datetime.now(ZoneInfo(config.TIMEZONE))
        today = now.date().isoformat()
        if now.hour < HOUR or marked("day") == today:
            return
        mark("day", today)
        await self.run(now)
