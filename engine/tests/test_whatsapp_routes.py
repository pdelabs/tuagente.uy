#!/usr/bin/env python3
"""The WhatsApp routes, against a running agent. `python3 engine/tests/test_whatsapp_routes.py`.

From outside, over HTTP, against an instance that runs the `whatsapp` plugin —
so the REAL bridge is behind it, unpaired. Free, no model, no phone; the pairing
claim does open a socket to WhatsApp to get a QR code, the same thing WhatsApp
Web does when the page loads, and cancels it.

    INSTANCE=wt8 python3 engine/tests/test_whatsapp_routes.py

  a. THE WEBHOOK IS THE BRIDGE'S — no token or a wrong one is 401; the bridge's
     token (read out of the engine process, where the entrypoint put it) is 200,
     and the same event twice is one message.
  b. THE CHAT — `GET /portal/whatsapp/chats/{jid}` is `{jid, phone, name,
     taken_over_until}`; an unknown one is 404.
  c. IT IS IN THE BANDEJA — `?source=channels` carries the ticket with `name`,
     `taken_over_until` and `last_comment`; `?source=work` does not.
  d. THE TAKEOVER, BY ROUTE — the owner's message puts an epoch in
     `taken_over_until`; `resume` answers `{ok}` and clears it.
  e. THE BRIDGE PASSED THROUGH — status has exactly its five keys; pairing
     answers `{state}`, then `{state, qr_png, expires_at}` with a PNG data URL,
     and cancels; logout is `{ok}`; an avatar with nothing linked is 503.
  f. THE AGENT SAYS IT HAS WHATSAPP, AND THE FLOW WAITS FOR IT — `modules.whatsapp`
     in the manifest, and the curated flow `incomplete` until a number is linked.
"""

import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

INSTANCE = os.environ.get("INSTANCE", "wt8")
ROOT = Path(__file__).resolve().parents[1] / "instances" / INSTANCE
ENV = dict(line.split("=", 1) for line in (ROOT / "instance.env").read_text().splitlines()
           if "=" in line and not line.startswith("#"))
KEY = next(line.split("=", 1)[1] for line in (ROOT / "secrets.env").read_text().splitlines()
           if line.startswith("API_SERVER_KEY="))
BASE = f"http://127.0.0.1:{ENV['PORT_ADAPTER']}"
CONTAINER = f"tuagente-{INSTANCE}"
JID = "59800000009@s.whatsapp.net"


def call(method, path, body=None, headers=None):
    req = urllib.request.Request(BASE + path, method=method,
                                 data=json.dumps(body).encode() if body is not None else None)
    req.add_header("Authorization", f"Bearer {KEY}")
    req.add_header("Content-Type", "application/json")
    for name, value in (headers or {}).items():
        req.add_header(name, value)
    try:
        with urllib.request.urlopen(req, timeout=20) as res:
            raw = res.read()
            return res.status, (json.loads(raw) if raw and "json" in res.headers.get("Content-Type", "") else raw)
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        return exc.code, (json.loads(raw) if raw else None)


def bridge_token() -> str:
    """The token lives in the ENGINE PROCESS's environment — the entrypoint
    generated and exported it — and not in `docker exec`'s."""
    script = ("import glob\nfor p in glob.glob('/proc/[0-9]*'):\n"
              "    try:\n        env = open(p + '/environ', 'rb').read().split(b'\\0')\n"
              "    except OSError:\n        continue\n"
              "    for kv in env:\n        if kv.startswith(b'WHATSAPP_BRIDGE_TOKEN='):\n"
              "            print(kv.split(b'=', 1)[1].decode()); raise SystemExit\n")
    return subprocess.run(["docker", "exec", CONTAINER, "python3", "-c", script],
                          capture_output=True, text=True).stdout.strip()


def event(message_id, text, origin="contact", seq=1):
    return {"seq": 900000 + seq, "event_id": f"msg:{JID}:{message_id}", "type": "message.received",
            "chat_jid": JID, "sender_phone": "+59800000009", "push_name": "Martín",
            "contact_name": "", "message_id": message_id, "timestamp": int(time.time()),
            "kind": "text", "text": text, "origin": origin}


CLEAN = f"""
from core import db
row = db.one("SELECT id FROM tickets WHERE source = 'whatsapp' AND source_ref = ?", ({JID!r},))
if row:
    db.write("DELETE FROM ticket_comments WHERE ticket_id = ?", (row["id"],))
    db.write("DELETE FROM events WHERE json_extract(payload, '$.ticket_id') = ?", (row["id"],))
    db.write("DELETE FROM tickets WHERE id = ?", (row["id"],))
db.write("DELETE FROM whatsapp_messages WHERE chat_jid = ?", ({JID!r},))
db.write("DELETE FROM whatsapp_chats WHERE jid = ?", ({JID!r},))
db.write("DELETE FROM whatsapp_events WHERE event_id LIKE ?", ("%59800000009%",))
db.write("DELETE FROM events WHERE payload LIKE ?", ("%59800000009%",))
"""


def judge(name: str, problems: list[str]) -> list[str]:
    print(f"  {name}: " + ("PASS" if not problems else "FAIL — " + "; ".join(problems)))
    return problems


def main() -> int:
    print(f"instance: {INSTANCE} ({BASE})")
    subprocess.run(["docker", "exec", CONTAINER, "python3", "-c", CLEAN], check=True)
    token = bridge_token()
    failures = []
    try:
        problems = []
        if not token:
            problems.append("no WHATSAPP_BRIDGE_TOKEN in the engine process")
        hook = "/internal/whatsapp/events"
        for label, headers in (("no token", {}), ("a wrong token", {"X-Bridge-Token": "no"})):
            code, _ = call("POST", hook, event("M1", "Hola"), headers)
            if code != 401:
                problems.append(f"{label} answered {code}")
        for _ in range(2):
            code, body = call("POST", hook, event("M1", "Hola, ¿hacen service?"), {"X-Bridge-Token": token})
            if (code, body) != (200, {"ok": True}):
                problems.append(f"the bridge's own post answered {code} {body}")
        failures += judge("a. the webhook is the bridge's", problems)

        problems = []
        code, chat = call("GET", f"/portal/whatsapp/chats/{JID}")
        if code != 200 or chat != {"jid": JID, "phone": "+59800000009", "name": "Martín",
                                   "taken_over_until": None}:
            problems.append(f"the chat is {code} {chat}")
        code, _ = call("GET", "/portal/whatsapp/chats/59800000404@s.whatsapp.net")
        if code != 404:
            problems.append(f"an unknown chat answered {code}")
        failures += judge("b. the chat", problems)

        problems = []
        _, inbox = call("GET", "/portal/tickets?source=channels")
        mine = [t for t in inbox["tickets"] if t.get("source") == "whatsapp" and t.get("source_ref") == JID]
        if len(mine) != 1:
            problems.append(f"{len(mine)} tickets for the chat in the Bandeja")
        else:
            t = mine[0]
            if t.get("name") != "Martín" or "taken_over_until" not in t or "last_comment" not in t:
                problems.append(f"the ticket carries {t}")
            if t["title"] != "Mensaje de Martín por WhatsApp":
                problems.append(f"the title is {t['title']!r}")
        _, work = call("GET", "/portal/tickets?source=work")
        if any(t.get("source") == "whatsapp" for t in work["tickets"]):
            problems.append("a WhatsApp ticket is on the Board")
        failures += judge("c. it is in the Bandeja", problems)

        problems = []
        call("POST", hook, event("O1", "Te llamo ahora", origin="owner_phone", seq=2), {"X-Bridge-Token": token})
        _, chat = call("GET", f"/portal/whatsapp/chats/{JID}")
        until = chat.get("taken_over_until")
        if not isinstance(until, int) or not 110 * 60 < until - time.time() < 121 * 60:
            problems.append(f"taken_over_until is {until!r}")
        code, body = call("POST", f"/portal/whatsapp/chats/{JID}/resume")
        _, chat = call("GET", f"/portal/whatsapp/chats/{JID}")
        if (code, body) != (200, {"ok": True}) or chat["taken_over_until"] is not None:
            problems.append(f"resume answered {code} {body} and left {chat['taken_over_until']}")
        failures += judge("d. the takeover, by route", problems)

        problems = []
        code, status = call("GET", "/portal/whatsapp/status")
        if code != 200 or set(status) != {"state", "phone", "push_name", "since", "last_error"}:
            problems.append(f"status is {code} {status}")
        elif status["state"] != "unpaired" or not isinstance(status["since"], int):
            problems.append(f"status is {status}")
        code, body = call("POST", "/portal/whatsapp/pairing")
        if (code, body) != (200, {"state": "pending"}):
            problems.append(f"pairing started with {code} {body}")
        pairing = {}
        for _ in range(20):
            time.sleep(1)
            _, pairing = call("GET", "/portal/whatsapp/pairing")
            if pairing.get("qr_png"):
                break
        if set(pairing) != {"state", "qr_png", "expires_at"} or not str(pairing.get("qr_png")).startswith(
                "data:image/png;base64,") or not pairing.get("expires_at", 0) > time.time():
            problems.append(f"the pairing reads {str(pairing)[:160]}")
        _, status = call("GET", "/portal/whatsapp/status")
        if status["state"] != "pairing":
            problems.append(f"while pairing the status is {status['state']}")
        code, body = call("DELETE", "/portal/whatsapp/pairing")
        _, pairing = call("GET", "/portal/whatsapp/pairing")
        if (code, body) != (200, {"ok": True}) or pairing.get("state") != "cancelled":
            problems.append(f"cancel answered {code} {body}, the pairing reads {pairing}")
        _, status = call("GET", "/portal/whatsapp/status")
        if status["state"] != "unpaired":
            problems.append(f"after cancelling the status is {status['state']}")
        code, body = call("POST", "/portal/whatsapp/logout")
        if (code, body) != (200, {"ok": True}):
            problems.append(f"logout answered {code} {body}")
        code, body = call("GET", f"/portal/whatsapp/avatar/{JID}")
        if code != 503 or "error" not in (body or {}):
            problems.append(f"an avatar with nothing linked answered {code} {body}")
        failures += judge("e. the bridge passed through", problems)

        problems = []
        _, manifest = call("GET", "/portal/manifest")
        if manifest["modules"].get("whatsapp") is not True:
            problems.append(f"modules: {manifest['modules']}")
        _, flows = call("GET", "/portal/flows")
        flow = next((f for f in flows["flows"] if f.get("slug") == "whatsapp"), None)
        if not flow or flow.get("status") != "incomplete" or "tu WhatsApp" not in json.dumps(
                flow, ensure_ascii=False):
            problems.append(f"the flow is {flow and {k: flow.get(k) for k in ('status', 'missing_connection_labels')}}")
        failures += judge("f. the module and the flow", problems)
    finally:
        subprocess.run(["docker", "exec", CONTAINER, "python3", "-c", CLEAN], check=True)

    print("WHATSAPP ROUTES: " + ("PASS" if not failures else f"FAIL ({len(failures)})"))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
