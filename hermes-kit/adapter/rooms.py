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


class RoomStore:
    """Append-only transcripts, one file per room."""

    def __init__(self, directory: Path):
        self.directory = directory

    def _path(self, room_id: str) -> Path | None:
        if not ROOM_ID_RE.match(room_id or ""):
            return None
        return self.directory / f"{room_id}.jsonl"

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
            out.append({
                "id": path.stem,
                # The title is the client's first line, which is what they
                # remember the conversation by -- not a summary we invent.
                "title": first_client_line.strip().splitlines()[0][:80] if first_client_line else "",
                "updated_at": turns[-1].get("ts"),
                "turns": len(turns),
            })
        out.sort(key=lambda r: r.get("updated_at") or 0, reverse=True)
        return out

    def delete(self, room_id: str) -> bool:
        path = self._path(room_id)
        if path is None or not path.is_file():
            return False
        path.unlink()
        return True
