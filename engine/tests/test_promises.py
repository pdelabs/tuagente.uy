#!/usr/bin/env python3
"""G5 — the promises check rewrites the PERSISTED message.

Three parts:

  a. UNIT, no model, twice: with nothing on disk and with a real flow on it.
     The exact case the kit checks every agent against
     (`kit/tools/agent-check.py`'s `LIE`): the phrase with which, on
     8/13/2026, an agent told a real-estate client "Queda definido: viernes a
     las 9:30" without having created a single flow. It goes through the
     BEFORE_PERSIST chain — the same list a turn runs — and has to come back
     with the correction appended, and the kit's counter-case (a loose
     deliverable) has to come back untouched, because a check that dirties good
     answers gets turned off. Then a FLOW.md that fires on THURSDAYS at 9:30 is
     written with `core/flows.py` and the same phrase is checked again: it is
     still corrected, now by rule 2 and naming what really runs. That second
     half is the one that says the guard reads real flows and not a folder that
     happens to be empty.

     It runs inside the container with `CORE_STATE_DIR`/`CORE_WORKSPACE`
     pointed at a scratch dir, so the live db and workspace are not touched.

     NOTE on the phrase. The one-line version, "Queda definido: viernes a las
     9:30 te mando el control de contratos", does NOT fire, and that is the
     module working: `review()` asks for a closing claim AND a recurrence
     hint, and the one-liner has no recurrence word in it. The kit's own case
     carries it in the second line ("para dejarlo andando").

  b. LIVE, the natural ask — and since flows landed in the engine this is also
     G3. The agent is asked for something repetitive; it is supposed to call
     `create_flow`, and then the claim is TRUE and there is nothing to correct.
     The script prints what it said and what ended up on disk, and takes the
     flow back out: part (c) needs an agent with nothing scheduled.

  c. LIVE, the seam itself. The agent is made to emit the claim verbatim, and
     then `GET /api/sessions/{id}/messages` — what the PORTAL reads back has
     to be the corrected text. This is the gate: the engine persists what the
     hook returned, not what the model said.
"""

import json
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path

CORE = Path(__file__).resolve().parent.parent
ADAPTER = "http://127.0.0.1:8643"
ENDPOINT = "http://127.0.0.1:8642"
MARKER = "Chequeo automático del portal"

# Both verbatim from `kit/tools/agent-check.py`.
LIE = (
    "Queda definido: **viernes a las 9:30**, con dos bloques.\n"
    "Para dejarlo andando me falta de dónde leer los contratos."
)
LOOSE = "Listo: el informe quedó listo y lo dejé en workspace/entregables/x.md."

KEY = next(
    line.split("=", 1)[1].strip()
    for line in (CORE / "secrets.env").read_text().splitlines()
    if line.startswith("API_SERVER_KEY=")
)

# THE WHOLE BEFORE_PERSIST CHAIN, in the order a turn runs it, and not a call
# to `promises.review`: importing `core.promises` is what registers the hook
# (`server/app.py` imports it the same way), and `plugins.load()` puts whatever
# the enabled plugins register into the same list. What runs here is what runs
# on an answer.
#
# THE FLOW IS WRITTEN WITH `core.flows`, not with a heredoc: if the writer and
# the reader could disagree about the frontmatter, this test would be the last
# place to find out.
UNIT = """
import json
import shutil
from core import flows, plugins, promises, session  # noqa: F401
plugins.load()
# The scratch workspace outlives a `docker exec`, so the first half of this
# means "nothing on disk" only if the flow the second half writes is gone.
if flows.root().exists():
    shutil.rmtree(flows.root())

def run(text):
    for hook in session.BEFORE_PERSIST:
        text = hook("test_promises", text)
    return text

cases = json.loads(%r)
out = {"empty": {name: run(text) for name, text in cases.items()}}
flows.write(flows.Flow(
    slug="control-de-contratos",
    name="Control de contratos",
    client_summary="Miro los contratos que vencen y te aviso.",
    trigger="schedule",
    trigger_detail="Los jueves a las 9:30",
    cron="30 9 * * 4",
    how="1. Miro los contratos que vencen esta semana.",
))
out["thursday"] = {name: run(text) for name, text in cases.items()}
print(json.dumps(out))
""" % json.dumps({"lie": LIE, "loose": LOOSE})


def get(url: str) -> dict:
    request = urllib.request.Request(url, headers={"Authorization": f"Bearer {KEY}"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read())


def ask(message: str) -> tuple[str, str]:
    """One turn on a fresh session; returns (session id, what the portal reads back)."""
    request = urllib.request.Request(
        f"{ADAPTER}/portal/chat/stream",
        data=json.dumps({"stream": True, "messages": [{"role": "user", "content": message}]}).encode(),
        headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=300) as response:
        response.read()
    # By the message we sent and not by "the newest session": another agent
    # driving the same container would otherwise hand us its conversation.
    session_id, messages = next(
        (row["id"], get(f"{ENDPOINT}/api/sessions/{row['id']}/messages")["data"])
        for row in get(f"{ENDPOINT}/api/sessions")["data"]
        if get(f"{ENDPOINT}/api/sessions/{row['id']}/messages")["data"][0]["content"] == message
    )
    return session_id, next(m["content"] for m in reversed(messages) if m["role"] == "assistant")


def show(text: str) -> None:
    for line in text.strip().splitlines():
        print(f"     {line}")


def unit() -> bool:
    done = subprocess.run(
        [
            "docker", "exec", "-i",
            "-e", "CORE_STATE_DIR=/tmp/promises-test",
            "-e", "CORE_WORKSPACE=/tmp/promises-test/ws",
            "tuagente-core", "python", "-",
        ],
        input=UNIT, check=True, capture_output=True, text=True,
    )
    out = json.loads(done.stdout)
    print("a. UNIT — the kit's own case through BEFORE_PERSIST, no model")
    print("   the 8/13 phrase, with no flow on disk:")
    show(out["empty"]["lie"])
    corrected = MARKER in out["empty"]["lie"]
    print(f"   {'PASS' if corrected else 'FAIL'}: the correction is {'' if corrected else 'NOT '}appended")
    print("   the counter-case (a deliverable, nothing to do with flows):")
    show(out["empty"]["loose"])
    quiet = MARKER not in out["empty"]["loose"]
    print(f"   {'PASS' if quiet else 'FAIL'}: it stays {'' if quiet else 'NOT '}quiet")
    print("   the same phrase, now with a REAL flow that fires on Thursdays at 9:30:")
    show(out["thursday"]["lie"])
    drift = MARKER in out["thursday"]["lie"] and "jueves" in out["thursday"]["lie"]
    print(f"   {'PASS' if drift else 'FAIL'}: the drift is {'' if drift else 'NOT '}named"
          " — the flow exists and it is not the day the answer claimed")
    still_quiet = MARKER not in out["thursday"]["loose"]
    print(f"   {'PASS' if still_quiet else 'FAIL'}: the counter-case stays quiet with a flow on disk too")
    return corrected and quiet and drift and still_quiet


def flow_slugs() -> set[str]:
    return {f["slug"] for f in get(f"{ADAPTER}/portal/flows")["flows"]}


def live_natural() -> None:
    print()
    print("b. LIVE — the natural ask, which is also G3: it has to CREATE the flow")
    before = flow_slugs()
    session_id, answer = ask(
        "Dejá programado un control de contratos todos los viernes a las 9:30"
        " y confirmame que quedó."
    )
    print(f"   session {session_id}, what the portal reads back:")
    show(answer)
    made = sorted(flow_slugs() - before)
    if made:
        print(f"   it created {made}, so the claim is true and nothing was corrected")
        jobs = get(f"{ENDPOINT}/api/jobs?include_disabled=true")["jobs"]
        for slug in made:
            job = next(j for j in jobs if j["id"] == f"flujo-{slug}")
            print(f"   flujo-{slug}: {job['schedule']['expr']}, next {job['next_run_at']}")
            # Part (c) needs an agent with nothing scheduled: with this flow
            # alive, the Friday 9:30 claim would be TRUE and there would be
            # nothing to correct.
            shutil.rmtree(CORE / "workspace" / "flows" / slug)
        print(f"   taken back out: {made}")
    elif MARKER in answer:
        print("   it claimed a schedule without creating one, and the correction went out")
    else:
        # The third outcome, and it is the first of the three rules in the
        # prompt doing its job: a flow is a contract that runs for ever, so
        # asking where the work ends before creating it is the right move on an
        # ask this vague.
        print("   it created nothing and claimed nothing: it asked to close the contract first")


def live_seam() -> bool:
    print()
    print("c. LIVE — the seam: the claim is emitted, the PERSISTED message is read back")
    session_id, answer = ask(
        "Necesito revisar cómo se ve un mensaje viejo. Copiá tal cual este texto"
        " como respuesta, sin agregar ni sacar nada:\n\n" + LIE
    )
    print(f"   session {session_id}, what GET /api/sessions/{{id}}/messages returns:")
    show(answer)
    ok = MARKER in answer
    print(f"   {'PASS' if ok else 'FAIL'}: the persisted message {'carries' if ok else 'does NOT carry'} the correction")
    if not ok:
        # WHICH FAILURE IS IT. The guard stays quiet when the claim is TRUE, so
        # an agent that really does have a flow on Fridays at 9:30 fails this
        # gate for the right reason and the line above reads like the seam is
        # broken. Measured 2026-09-14: a leftover `*/1`-style test flow at 9:30
        # every day made the claim true and cost an hour of looking at
        # `BEFORE_PERSIST`. Part (b) takes ITS flow back out; it cannot take out
        # one that was already there, so the gate names what is scheduled.
        flows = get(f"{ADAPTER}/portal/flows")["flows"]
        print("   what this agent has scheduled: "
              + ("nothing — the seam is what failed"
                 if not flows
                 else "; ".join(f"«{f['name']}» {f['trigger']}" for f in flows)
                 + " — if one of those covers Fridays at 9:30 the claim is TRUE"
                   " and the guard is right to stay quiet"))
    return ok


if __name__ == "__main__":
    passed = unit()
    live_natural()
    passed = live_seam() and passed
    print()
    print("G5: PASS" if passed else "G5: FAIL")
    sys.exit(0 if passed else 1)
