"""The room: one conversation the whole team shares.

WHY THE ADAPTER OWNS THIS AND NOT THE ENGINE. A room's turns are answered by
different profiles, and each profile persists into its own store -- so a
conversation would end up scattered with no way to reassemble it. We tried
pinning every turn to one `session_id`: the engine ignores it and mints its own
(`api-<hash>`) per turn. Measured 2026-08-17 on the lab, where two turns of one
room landed as two unrelated sessions in two different profiles.

So the transcript lives here. That is also the honest place for it: the room is
the CLIENT'S, not any one role's.

WHERE IT IS WRITTEN. Under `policy/`, which the agent's container mounts :ro
and the adapter's mounts rw. Same property, and the same precedent, as
`capabilities/requests.jsonl`: a record about the client that the agent must
not be able to rewrite. An agent that could edit its client's conversation
could edit what it was asked to do.

APPEND-ONLY, one JSONL per room. No rewrite path on purpose -- an edited history
is a history nobody can trust, and the client already has "new conversation".

RENAMING IS NOT AN EDIT. The name of a conversation is not something that was
said in it, so it lives in a sidecar file next to the transcript and the .jsonl
is never reopened for writing. Deleting IS the client throwing away their own
conversation, which they are entitled to do -- that is the one file this module
removes, name included.
"""

from __future__ import annotations

import json
import re
import time
from pathlib import Path

# Same alphabet the portal generates and nothing else: the id is joined onto a
# path, so it is checked before it ever touches disk.
ROOM_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")

# A room the client can actually scroll. Past this we are storing a log, not a
# conversation, and every turn would ship it all upstream.
MAX_TURNS = 400

# What fits on a sidebar row. The same bound for the name the client typed and
# for the first line we fall back to, so a renamed room and a fresh one are cut
# the same way.
MAX_TITLE_LEN = 80


def _one_line(text: str) -> str:
    """A title: the first line, trimmed, cut to the row."""
    return (text or "").strip().split("\n", 1)[0].strip()[:MAX_TITLE_LEN]


class RoomStore:
    """Append-only transcripts, one file per room."""

    def __init__(self, directory: Path):
        self.directory = directory

    def _path(self, room_id: str) -> Path | None:
        if not ROOM_ID_RE.match(room_id or ""):
            return None
        return self.directory / f"{room_id}.jsonl"

    def _title_path(self, room_id: str) -> Path:
        """Where the name the client gave the room is kept.

        BESIDE THE TRANSCRIPT AND NOT INSIDE IT. Writing the name as one more
        line would put something nobody said into the history, and reopening
        the .jsonl to change a title is the rewrite path this module does not
        have. `rooms()` only globs `*.jsonl`, so a `.title` is never a room."""
        return self.directory / f"{room_id}.title"

    def append(self, room_id: str, role: str, content: str, by: str | None = None) -> bool:
        """Add one turn. `by` is the teammate who answered, absent for the
        agent the client named and for the client's own messages."""
        path = self._path(room_id)
        if path is None or not (content or "").strip():
            return False
        self.directory.mkdir(parents=True, exist_ok=True)
        line = {"ts": time.time(), "role": role, "content": content}
        if by:
            line["by"] = by
        with open(path, "a", encoding="utf-8") as handle:
            handle.write(json.dumps(line, ensure_ascii=False) + "\n")
        return True

    def read(self, room_id: str) -> list[dict]:
        path = self._path(room_id)
        if path is None or not path.is_file():
            return []
        turns = []
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                turns.append(json.loads(line))
            except ValueError:
                # One corrupt line costs that line, never the conversation.
                continue
        return turns[-MAX_TURNS:]

    def rooms(self) -> list[dict]:
        """Every room, newest first, with what the sidebar needs to draw it."""
        if not self.directory.is_dir():
            return []
        out = []
        for path in self.directory.glob("*.jsonl"):
            turns = self.read(path.stem)
            if not turns:
                continue
            first_client_line = next(
                (t["content"] for t in turns if t.get("role") == "user"), "")
            named = self._title_path(path.stem)
            out.append({
                "id": path.stem,
                # The title is the name the client gave it, and failing that
                # their first line -- which is what they remember the
                # conversation by, not a summary we invent.
                "title": (named.read_text(encoding="utf-8") if named.is_file()
                          else _one_line(first_client_line)),
                "updated_at": turns[-1].get("ts"),
                "turns": len(turns),
            })
        out.sort(key=lambda r: r.get("updated_at") or 0, reverse=True)
        return out

    def rename(self, room_id: str, title: str) -> bool:
        """Name the room. False = there is no such room."""
        path = self._path(room_id)
        if path is None or not path.is_file():
            return False
        self._title_path(room_id).write_text(_one_line(title), encoding="utf-8")
        return True

    def delete(self, room_id: str) -> bool:
        path = self._path(room_id)
        if path is None or not path.is_file():
            return False
        path.unlink()
        # The name is a separate file: left behind it would end up titling
        # whatever room is minted with this id next.
        self._title_path(room_id).unlink(missing_ok=True)
        return True
