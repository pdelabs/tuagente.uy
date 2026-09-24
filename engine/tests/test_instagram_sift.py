#!/usr/bin/env python3
"""Our own messages are ours, by id OR by @. `python3 engine/tests/test_instagram_sift.py`.

Inside the container, no model, no Graph. WHY: the account has two ids, and a
message the owner typed in the Instagram app carries the one `IG_USER_ID` is
not. Read as the other person's, it overwrote who the thread is with, and on
our own agent (2026-09-24) two replies meant for @anitamaral were addressed to
@tuagente.uy.

  a. A MESSAGE WITH OUR @ AND ANOTHER ID IS OURS — and does not become the
     thread's other side.
  b. THE OTHER SIDE STAYS THE PERSON — her id and @ are what a reply goes to.
  c. A THREAD SAVED WITH OUR OWN @ IS NOT ANSWERED — `send_message` refuses.

WHERE IT POINTS. `CORE_CONTAINER`; default the lab's `tuagente-core`.
"""

import json
import os
import subprocess
import sys

CONTAINER = os.environ.get("CORE_CONTAINER", "tuagente-core")

INSIDE = r"""
import json, sys
sys.path.insert(0, "/opt/kit/plugins/kanban/core")
sys.path.insert(0, "/opt/kit/plugins/instagram/core")
import ig_store, ig_tools
from core import db

CONV = "conv_test_sift"
out = {}
try:
    found = [  # newest first, as the Graph returns them
        {"id": "m3", "from": {"id": "999_scoped", "username": "nuestra.cuenta"}, "message": "te respondo desde la app", "created_time": "2026-09-24T12:02:00+0000"},
        {"id": "m2", "from": {"id": "555", "username": "ana"}, "message": "hola", "created_time": "2026-09-24T12:01:00+0000"},
    ]
    new = ig_tools.sift(CONV, found, "111_login", "nuestra.cuenta")
    out["ours"] = {m["id"]: m["ours"] for m in new}
    row = ig_store.conversation(CONV)
    out["participant"] = [row["participant_id"], row["participant_username"]]
    db.write("UPDATE instagram_conversations SET participant_username = ?, participant_id = ? WHERE conversation_id = ?",
             ("nuestra.cuenta", "999_scoped", CONV))
    real_username = ig_store.username
    ig_store.username = lambda: "nuestra.cuenta"
    try:
        tool = ig_tools.toolset().tools["send_message"]
        class Ctx: deps = type("D", (), {"session_id": None})()
        out["refused"] = tool.function(Ctx(), CONV, "hola")
    finally:
        ig_store.username = real_username
finally:
    db.write("DELETE FROM instagram_messages WHERE conversation_id = ?", (CONV,))
    db.write("DELETE FROM instagram_conversations WHERE conversation_id = ?", (CONV,))
print(json.dumps(out, ensure_ascii=False))
"""


def main() -> int:
    done = subprocess.run(["docker", "exec", CONTAINER, "python3", "-c", INSIDE],
                          capture_output=True, text=True)
    if done.returncode != 0:
        print(done.stdout + done.stderr)
        return 1
    r = json.loads(done.stdout.strip().splitlines()[-1])
    failures = 0
    for name, ok, why in (
        ("a. a message with our @ and another id is ours", r["ours"] == {"m2": False, "m3": True}, r["ours"]),
        ("b. the other side stays the person", r["participant"] == ["555", "ana"], r["participant"]),
        ("c. a thread saved with our own @ is not answered", "propia cuenta" in r["refused"], r["refused"]),
    ):
        print(("  ok    " if ok else "  FAIL  ") + name + ("" if ok else f" — {why}"))
        failures += not ok
    print("INSTAGRAM SIFT: " + ("PASS" if not failures else "FAIL"))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
