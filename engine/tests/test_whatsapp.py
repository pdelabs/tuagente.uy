#!/usr/bin/env python3
"""WhatsApp, without WhatsApp. `python3 engine/tests/test_whatsapp.py`.

The `whatsapp` plugin's code called DIRECTLY INSIDE THE CONTAINER, with the
bridge replaced by a stub HTTP server on loopback that writes down every call.
Free, a few seconds, no model, no phone. The container has to run the plugin
(`CORE_CONTAINER`, default `tuagente-wt8`).

  a. INGEST IS CODE, AND ONCE — a message from the bridge makes the chat (named
     from the owner's address book), keeps the message and OPENS the Bandeja
     ticket; the same event again is nothing; the person's next message is a
     comment signed with their phone.
  b. THE RUN READS THE PERSON, NOT THE LINE — the watcher hands back the whole
     chat with the new ones marked and their ids, the ticket named; the look
     after it is `None`.
  c. THE ANSWER GOES OUT AT ONCE, AND ONCE — typing first, then the documented
     send, the read receipt for what it answered, the message kept as ours,
     Activity carrying the words, the ticket closed with them. A second answer
     with nothing new from the person sends nothing.
  d. THE OWNER TAKES OVER — her own message closes the ticket as hers, starts
     the two hours with ONE Activity line, marks what the person wrote as dealt
     with; a message during the takeover wakes nobody, the watcher skips the
     chat, and `send_whatsapp` refuses it. When the clock runs out the next look
     brings the message; `resume` ends it early, with its own line.
  e. A MESSAGE DELETED FOR EVERYONE IS NOT WORK, and an edit changes the text.
  f. THE CONNECTION IS THE BRIDGE'S STATE — unpaired is not connected, linked is,
     and a bridge that does not answer is not.
  g. A PUSH WAKES THE FLOW IN SECONDS, AND A BURST IS ONE RUN — `scheduler.poke`
     with the real watcher and a recording `run`: one run a settle after the
     LAST message of three, carrying all three.

IT CLEANS UP AFTER ITSELF: its chats, messages, tickets and events.
"""

import json
import os
import subprocess
import sys

CONTAINER = os.environ.get("CORE_CONTAINER", "tuagente-wt8")

INSIDE = r"""
import asyncio, json, os, sys, threading, time, types
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, "/opt/kit/plugins/kanban/core")
sys.path.insert(0, "/opt/kit/plugins/whatsapp/core")

TOKEN = "token-de-prueba"
os.environ["WHATSAPP_BRIDGE_TOKEN"] = TOKEN
os.environ["WHATSAPP_BRIDGE_URL"] = "http://127.0.0.1:8699"

import board_store as board
import wa_store
import wa_tools
from core import db, flows, plugins, scheduler, watchers

JID = "59800000001@s.whatsapp.net"
JID2 = "59800000002@s.whatsapp.net"
SESSION = "prueba-whatsapp"
STATE = {"state": "connected"}
calls = []


class Stub(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def answer(self, body, code=200):
        raw = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        calls.append({"method": "GET", "path": self.path, "token": self.headers.get("X-Bridge-Token")})
        self.answer({"state": STATE["state"], "phone": "+59899000000", "push_name": "x",
                     "since": 1, "last_error": ""})

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(length) or b"{}")
        calls.append({"method": "POST", "path": self.path, "body": body,
                      "token": self.headers.get("X-Bridge-Token")})
        if self.path == "/messages":
            self.answer({"message_id": f"3EB0SENT{len(calls)}", "timestamp": int(time.time())})
        else:
            self.answer({"ok": True})


server = ThreadingHTTPServer(("127.0.0.1", 8699), Stub)
threading.Thread(target=server.serve_forever, daemon=True).start()

wa_tools.TYPING_SECONDS = 0
# What `plugin.register` does for the board, which this process never ran.
board.EXTRA[wa_tools.SOURCE] = wa_tools.ticket_extra
send = wa_tools.toolset().tools["send_whatsapp"].function
ctx = types.SimpleNamespace(deps=types.SimpleNamespace(session_id=SESSION))
seq = [1000]


def message(jid, message_id, text, origin="contact", kind="text"):
    seq[0] += 1
    return {"seq": seq[0], "event_id": f"msg:{jid}:{message_id}", "type": "message.received",
            "chat_jid": jid, "sender_phone": "+" + jid.split("@")[0], "push_name": "Lu",
            "contact_name": "Lucía del almacén" if origin == "contact" else "",
            "message_id": message_id, "timestamp": int(time.time()), "kind": kind,
            "text": text, "origin": origin}


def ticket(jid):
    row = board.by_source("whatsapp", jid)
    return dict(row) if row else None


def clean():
    for jid in (JID, JID2):
        found = board.by_source("whatsapp", jid)
        if found:
            db.write("DELETE FROM ticket_comments WHERE ticket_id = ?", (found["id"],))
            db.write("DELETE FROM events WHERE json_extract(payload, '$.ticket_id') = ?", (found["id"],))
            db.write("DELETE FROM tickets WHERE id = ?", (found["id"],))
        db.write("DELETE FROM whatsapp_messages WHERE chat_jid = ?", (jid,))
        db.write("DELETE FROM whatsapp_chats WHERE jid = ?", (jid,))
        db.write("DELETE FROM events WHERE payload LIKE ?", (f"%{jid}%",))
    db.write("DELETE FROM whatsapp_events WHERE event_id LIKE ?", ("%5980000000%",))
    db.write("DELETE FROM events WHERE session_id = ?", (SESSION,))
    db.write("DELETE FROM flow_pending WHERE slug = 'whatsapp'")


out = {}
clean()
try:
    # (a) ingest, dedupe, the ticket.
    first = message(JID, "AAA1", "Hola")
    out["poke_first"] = wa_tools.ingest(first)
    out["poke_again"] = wa_tools.ingest(dict(first))
    out["poke_second"] = wa_tools.ingest(message(JID, "AAA2", "¿Tienen cámaras 26?"))
    out["chat"] = dict(wa_store.chat(JID))
    out["ticket_a"] = ticket(JID)
    out["comments_a"] = board.comments(out["ticket_a"]["id"])
    out["messages_a"] = [dict(r) for r in db.query(
        "SELECT message_id, origin, handled FROM whatsapp_messages WHERE chat_jid = ?", (JID,))]

    # (b) the watcher.
    out["listing"] = wa_tools.watch()
    out["listing_again"] = wa_tools.watch()

    # (c) the answer.
    calls.clear()
    out["sent"] = send(ctx, JID, "Hola, sí: tenemos cámaras 26. ¿Para qué bici es?")
    out["calls_c"] = list(calls)
    out["ticket_c"] = ticket(JID)
    out["comments_c"] = board.comments(out["ticket_c"]["id"])
    out["events_c"] = [dict(r) for r in db.query(
        "SELECT kind, label FROM events WHERE session_id = ? AND kind = 'whatsapp.sent'", (SESSION,))]
    calls.clear()
    out["second"] = send(ctx, JID, "Otra respuesta")
    out["calls_second"] = list(calls)
    out["extra"] = wa_tools.ticket_extra(JID)
    out["listed"] = [t for t in board.listing(board.CHANNELS) if t["source_ref"] == JID]

    # (d) the owner takes over.
    wa_tools.ingest(message(JID, "AAA3", "¿Y el precio?"))
    out["poke_owner"] = wa_tools.ingest(message(JID, "OWN1", "Te paso precio por acá, Lu", origin="owner_phone"))
    out["chat_d"] = dict(wa_store.chat(JID))
    out["ticket_d"] = ticket(JID)
    out["comments_d"] = board.comments(out["ticket_d"]["id"])[-1]
    out["open_after_owner"] = wa_store.open_chats()
    out["poke_during"] = wa_tools.ingest(message(JID, "AAA4", "Dale, gracias"))
    wa_tools.ingest(message(JID, "OWN2", "De nada", origin="owner_phone"))
    wa_tools.ingest(message(JID, "AAA5", "Una cosa más"))
    out["taken_events"] = [r["label"] for r in db.query(
        "SELECT label FROM events WHERE kind = 'whatsapp.taken_over' AND payload LIKE ?", (f"%{JID}%",))]
    out["watch_during"] = wa_tools.watch()
    calls.clear()
    out["send_during"] = send(ctx, JID, "Hola")
    out["calls_during"] = list(calls)
    out["extra_during"] = wa_tools.ticket_extra(JID)
    db.write("UPDATE whatsapp_chats SET taken_over_until = ? WHERE jid = ?", (time.time() - 1, JID))
    out["watch_after"] = wa_tools.watch()
    wa_store.take_over(JID, time.time() + 3600)
    out["resume_waiting"] = wa_tools.resume(JID)
    out["chat_resumed"] = dict(wa_store.chat(JID))
    out["resumed_events"] = [r["label"] for r in db.query(
        "SELECT label FROM events WHERE kind = 'whatsapp.resumed' AND payload LIKE ?", (f"%{JID}%",))]

    # (e) revoke and edit.
    wa_tools.ingest(message(JID2, "BBB1", "Mensaje equivocado"))
    wa_tools.ingest({"seq": 5001, "event_id": "revoke:59800000002:BBB1", "type": "message.revoked",
                     "chat_jid": JID2, "message_id": "BBB1"})
    out["revoked_open"] = JID2 in wa_store.open_chats()
    wa_tools.ingest(message(JID2, "BBB2", "Hola, ¿abren el sábado?"))
    wa_tools.ingest({"seq": 5002, "event_id": "edit:59800000002:BBB2:1", "type": "message.edited",
                     "chat_jid": JID2, "message_id": "BBB2", "text": "Hola, ¿abren el domingo?"})
    out["edited"] = wa_store.message(JID2, "BBB2")["text"]
    wa_tools.watch()

    # (f) the connection.
    STATE["state"] = "unpaired"
    out["connected_unpaired"] = wa_tools.connected()
    STATE["state"] = "disconnected"
    out["connected_linked"] = wa_tools.connected()
    os.environ["WHATSAPP_BRIDGE_URL"] = "http://127.0.0.1:1"
    out["connected_down"] = wa_tools.connected()
    os.environ["WHATSAPP_BRIDGE_URL"] = "http://127.0.0.1:8699"
    out["tokens"] = sorted({c["token"] for c in calls})

    # (g) the push wakes the flow, a burst is one run.
    watchers.WATCHERS[wa_tools.WATCHER] = watchers.Watcher(wa_tools.watch, 30)
    plugins._engine.shared["connection.whatsapp"] = lambda: True
    runs = []
    async def fake_run(flow, scheduled_at, manual=False, arrived=None):
        runs.append({"slug": flow.slug, "arrived": arrived, "at": time.time()})
    scheduler.run = fake_run
    scheduler.POKE_SETTLE = 1.5

    async def burst():
        started = time.time()
        for i, text in enumerate(("hola", "una consulta", "¿hacen envíos?")):
            if wa_tools.ingest(message(JID2, f"BUR{i}", text)):
                scheduler.poke(wa_tools.WATCHER)
            await asyncio.sleep(0.5)
        await asyncio.sleep(scheduler.POKE_SETTLE + 2)
        return started

    out["flow_status"] = flows.read("whatsapp").status
    started = asyncio.run(burst())
    out["runs"] = [{"slug": r["slug"], "arrived": r["arrived"], "after": round(r["at"] - started, 1)}
                   for r in runs]
    print(json.dumps(out, ensure_ascii=False, default=str))
finally:
    clean()
    server.shutdown()
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
        print("WHATSAPP: FAIL")
        return 1
    r = json.loads(done.stdout.strip().splitlines()[-1])
    jid = "59800000001@s.whatsapp.net"
    failures = []

    problems = []
    if not r["poke_first"] or r["poke_again"] or not r["poke_second"]:
        problems.append(f"pokes were {r['poke_first']}, {r['poke_again']}, {r['poke_second']}")
    if r["chat"]["name"] != "Lucía del almacén" or r["chat"]["phone"] != "+59800000001":
        problems.append(f"the chat is {r['chat']}")
    t = r["ticket_a"] or {}
    if t.get("title") != "Mensaje de Lucía del almacén por WhatsApp" or "Hola" not in t.get("body", ""):
        problems.append(f"the ticket is {t}")
    if [(c["author"], c["body"]) for c in r["comments_a"]] != [("+59800000001", "¿Tienen cámaras 26?")]:
        problems.append(f"the comments are {r['comments_a']}")
    if len(r["messages_a"]) != 2:
        problems.append(f"messages kept: {r['messages_a']}")
    failures += judge("a. ingest is code, and once", problems)

    problems = []
    listing = r["listing"] or ""
    for wanted in (f"`{jid}`", "Lucía del almacén", "(+59800000001)", "«Hola» (nuevo · id `AAA1`)",
                   "«¿Tienen cámaras 26?» (nuevo · id `AAA2`)", f"tarea {t.get('id')}", "(Por hacer)"):
        if wanted not in listing:
            problems.append(f"the listing lacks {wanted!r}")
    if r["listing_again"] is not None:
        problems.append("the second look found something again")
    failures += judge("b. the run reads the person", problems)

    problems = []
    paths = [(c["method"], c["path"]) for c in r["calls_c"]]
    if paths != [("POST", f"/chats/{jid}/typing"), ("POST", "/messages"),
                 ("POST", f"/chats/{jid}/read")]:
        problems.append(f"the calls were {paths}")
    else:
        if r["calls_c"][1]["body"] != {"to": jid, "text": "Hola, sí: tenemos cámaras 26. ¿Para qué bici es?"}:
            problems.append(f"the send body was {r['calls_c'][1]['body']}")
        if r["calls_c"][2]["body"] != {"message_ids": ["AAA2", "AAA1"]}:
            problems.append(f"the read body was {r['calls_c'][2]['body']}")
    if "Ya le llegó" not in r["sent"]:
        problems.append(f"the tool said {r['sent']!r}")
    if r["ticket_c"]["status"] != "done" or r["comments_c"][-1]["author"] != "agente":
        problems.append(f"the ticket is {r['ticket_c']['status']} with {r['comments_c'][-1]}")
    if not r["events_c"] or "«Hola, sí: tenemos cámaras 26" not in r["events_c"][0]["label"]:
        problems.append(f"Activity has {r['events_c']}")
    if r["calls_second"] or "ya le contestaste" not in r["second"]:
        problems.append(f"the second answer: {r['second']!r}, calls {r['calls_second']}")
    if r["extra"] != {"name": "Lucía del almacén", "phone": "+59800000001", "taken_over_until": None}:
        problems.append(f"the ticket's extra is {r['extra']}")
    listed = r["listed"][0] if r["listed"] else {}
    if listed.get("name") != "Lucía del almacén" or (listed.get("last_comment") or {}).get("author") != "agente":
        problems.append(f"the Bandeja listing carries {listed}")
    failures += judge("c. the answer goes out at once, and once", problems)

    problems = []
    if r["poke_owner"] or r["poke_during"]:
        problems.append("a message during the takeover poked the flow")
    left = r["chat_d"]["taken_over_until"] - __import__("time").time()
    if not 110 * 60 < left < 121 * 60:
        problems.append(f"the takeover ends in {left / 60:.0f} min")
    if r["ticket_d"]["status"] != "done" or r["comments_d"]["author"] != "cliente":
        problems.append(f"the owner's message left the ticket {r['ticket_d']['status']}, {r['comments_d']}")
    if jid in r["open_after_owner"]:
        problems.append("what the owner answered is still open")
    if len(r["taken_events"]) != 1 or "Estás atendiendo vos a Lucía del almacén" not in r["taken_events"][0]:
        problems.append(f"takeover lines: {r['taken_events']}")
    if r["watch_during"] is not None:
        problems.append("the watcher handed over a chat the owner has")
    if r["calls_during"] or "lo está atendiendo tu cliente" not in r["send_during"]:
        problems.append(f"send during takeover: {r['send_during']!r}, calls {r['calls_during']}")
    if not r["extra_during"].get("taken_over_until"):
        problems.append("the ticket does not carry the takeover")
    if "Una cosa más» (nuevo" not in (r["watch_after"] or ""):
        problems.append(f"after the clock the look brought {r['watch_after']!r}")
    if r["chat_resumed"]["taken_over_until"] is not None or len(r["resumed_events"]) != 1:
        problems.append(f"resume left {r['chat_resumed']['taken_over_until']}, {r['resumed_events']}")
    failures += judge("d. the owner takes over", problems)

    problems = []
    if r["revoked_open"]:
        problems.append("a deleted message is still open work")
    if r["edited"] != "Hola, ¿abren el domingo?":
        problems.append(f"the edit left {r['edited']!r}")
    failures += judge("e. revoked and edited", problems)

    problems = []
    if (r["connected_unpaired"], r["connected_linked"], r["connected_down"]) != (False, True, False):
        problems.append(f"connected: {r['connected_unpaired']}, {r['connected_linked']}, {r['connected_down']}")
    if r["tokens"] != ["token-de-prueba"]:
        problems.append(f"the bridge saw tokens {r['tokens']}")
    failures += judge("f. the connection is the bridge's state", problems)

    problems = []
    runs = r["runs"]
    if r["flow_status"] != "active":
        problems.append(f"the curated flow is {r['flow_status']}")
    if len(runs) != 1:
        problems.append(f"{len(runs)} runs: {runs}")
    else:
        arrived = runs[0]["arrived"] or ""
        for text in ("«hola» (nuevo", "«una consulta» (nuevo", "«¿hacen envíos?» (nuevo"):
            if text not in arrived:
                problems.append(f"the run did not carry {text!r}")
        if not 1.0 < runs[0]["after"] < 6:
            problems.append(f"the run started {runs[0]['after']} s after the first message")
        print(f"  (the run started {runs[0]['after']} s after the first of three messages)")
    failures += judge("g. a push wakes the flow in seconds, a burst is one run", problems)

    print("WHATSAPP: " + ("PASS" if not failures else f"FAIL ({len(failures)})"))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
