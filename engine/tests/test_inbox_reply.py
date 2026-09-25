#!/usr/bin/env python3
"""The owner's answer from the Bandeja, at the route. `python3 engine/tests/test_inbox_reply.py`.

`POST /portal/tickets/{id}/reply` (`kit/plugins/kanban/core/board_routes.py`)
called through a `TestClient` INSIDE THE CONTAINER, with the channel's sender
replaced by a recording one filed under `inbox.reply.<source>` — the channel's
own send is `test_whatsapp.py` (h) and `test_instagram_messages.py` (f). No
model, no network, a second.

  a. IT GOES TO THE TICKET'S CHANNEL — the sender filed for the ticket's
     `source` gets its `source_ref` and the text, trimmed; `{ok: true}`.
  b. A REFUSAL IS A 409 WITH HER SENTENCE — `board.Refused` from the channel
     comes back as the words she reads under the box.
  c. WHAT NO CHANNEL SENDS IS A 400 — a mail ticket (its answer waits for her
     yes) and an empty text; a ticket that does not exist is a 404.

IT CLEANS UP AFTER ITSELF: its two tickets are gone by the end.
"""

import json
import os
import subprocess
import sys

CONTAINER = os.environ.get("CORE_CONTAINER", "tuagente-core")

INSIDE = r"""
import json, sys
sys.path.insert(0, "/opt/kit/plugins/kanban/core")
from fastapi import FastAPI
from fastapi.testclient import TestClient
import board_routes
import board_store as board
from core import db

sent = []

def fake(ref, text):
    if text == "no sale":
        raise board.Refused("Pasaron más de 24 horas. No salió nada.")
    sent.append([ref, text])

board_routes.SHARED = {board.REPLY + "whatsapp": fake}
app = FastAPI()
app.include_router(board_routes.router)
client = TestClient(app)

wa, _ = board.create(title="Mensaje de Prueba", body="hola", source="whatsapp",
                     source_ref="59899999999@s.whatsapp.net")
mail, _ = board.create(title="Consulta", body="hola", source="mail", source_ref="<prueba@x>")
out = {}
try:
    def post(tid, text):
        r = client.post(f"/portal/tickets/{tid}/reply", json={"text": text})
        return [r.status_code, r.json()]
    out["ok"] = post(wa, "  Te llamo mañana  ")
    out["sent"] = sent
    out["refused"] = post(wa, "no sale")
    out["mail"] = post(mail, "Hola")
    out["empty"] = post(wa, "   ")
    out["missing"] = post("t_000000000000", "Hola")
    print(json.dumps(out, ensure_ascii=False))
finally:
    for tid in (wa, mail):
        db.write("DELETE FROM ticket_comments WHERE ticket_id = ?", (tid,))
        db.write("DELETE FROM events WHERE json_extract(payload, '$.ticket_id') = ?", (tid,))
        db.write("DELETE FROM tickets WHERE id = ?", (tid,))
"""


def judge(name: str, problems: list[str]) -> list[str]:
    print(f"  {name}: " + ("PASS" if not problems else "FAIL — " + "; ".join(problems)))
    return problems


def main() -> int:
    print(f"container: {CONTAINER}")
    done = subprocess.run(["docker", "exec", CONTAINER, "python3", "-c", INSIDE],
                          capture_output=True, text=True)
    if done.returncode != 0:
        print(done.stderr.strip()[-3000:])
        print("INBOX REPLY: FAIL")
        return 1
    r = json.loads(done.stdout.strip().splitlines()[-1])
    failures = []

    problems = []
    if r["ok"] != [200, {"ok": True}]:
        problems.append(f"the answer was {r['ok']}")
    if r["sent"] != [["59899999999@s.whatsapp.net", "Te llamo mañana"]]:
        problems.append(f"the channel got {r['sent']}")
    failures += judge("a. it goes to the ticket's channel", problems)

    problems = []
    if r["refused"][0] != 409 or "Pasaron más de 24 horas" not in json.dumps(r["refused"][1], ensure_ascii=False):
        problems.append(f"a refusal came back as {r['refused']}")
    failures += judge("b. a refusal is a 409 with her sentence", problems)

    problems = []
    for key, status in (("mail", 400), ("empty", 400), ("missing", 404)):
        if r[key][0] != status:
            problems.append(f"{key} came back {r[key]}")
    failures += judge("c. what no channel sends is refused", problems)

    print("INBOX REPLY: " + ("PASS" if not failures else f"FAIL ({len(failures)})"))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
