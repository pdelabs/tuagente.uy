#!/usr/bin/env python3
"""A brief cut in half never reaches the delegate. `python3 engine/tests/test_delegation_guard.py`.

`core/delegation.py`'s `before_tool_execute`, called DIRECTLY INSIDE THE
CONTAINER: no model, a second.

WHY. On our own agent (2026-09-21) the client wrote the new text of a slide
between double quotes. The face copied her words into the brief, the model did
not escape the first `"`, and in a tool call's JSON that quote ends the string:
the creator received «El cliente pidió: «Saca el» and nothing else, twice, and
the face's third and whole brief hit the two-delegation cap.

  a. A BRIEF THAT OPENS « AND NEVER CLOSES IT GOES BACK TO THE FACE — as a
     `ModelRetry` that names the delegate in Spanish, quotes where it stopped
     and says how to send it. Raised before the delegate runs, which is what
     keeps it from spending one of the delegations.
  b. A WHOLE BRIEF GOES THROUGH UNTOUCHED — quotes closed, or no quotes.
  c. NO OTHER TOOL IS LOOKED AT — an open « in `write_file` is nobody's
     business here.
  d. THE FACE IS TOLD THE RULE — the capability's instructions say to quote
     the client between « » and never with double quotes, and the capability
     is on the face when a plugin registered a delegate.
  e. ACTIVITY READS A LINE FOR THE OWNER, NOT THE BRIEF — QA read «Le pedí al
     creador de posteos: El cliente pidió que…» (2026-09-23). `delegate_task`
     asks for `for_the_owner`, required and only there; it is taken off the
     args before the harness validates them, a call without it goes back to
     the face, and the start event's label is «Le pedí al <label> que <line>»
     (a «Que» and a closing period the model added do not double up) with
     the brief whole in the payload.

WHERE IT POINTS. `CORE_CONTAINER` moves it onto a second instance; the default
is the main compose's `tuagente-core`.
"""

import json
import os
import subprocess
import sys

CONTAINER = os.environ.get("CORE_CONTAINER", "tuagente-core")

INSIDE = r"""
import asyncio, json, types
from pydantic_ai.tools import ToolDefinition
from pydantic_ai_harness.subagents import DelegationStartEvent

from core import agent, delegation, plugins

plugins.load()
guard = delegation.Delegation()
ctx = types.SimpleNamespace(deps=types.SimpleNamespace(session_id="prueba"))
DELEGATE = ToolDefinition(name=delegation.TOOL)
OTHER = ToolDefinition(name="write_file")
name = next(iter(delegation.LABELS), "instagram-creator")


def check(tool, args):
    try:
        return {"ok": asyncio.run(guard.before_tool_execute(ctx, call=None, tool_def=tool, args=args))}
    except Exception as exc:
        return {"raised": type(exc).__name__, "said": str(exc)}


def validate(args):
    call = types.SimpleNamespace(tool_call_id="llamada-1")
    try:
        return {"ok": asyncio.run(guard.before_tool_validate(ctx, call=call, tool_def=DELEGATE, args=args))}
    except Exception as exc:
        return {"raised": type(exc).__name__, "said": str(exc)}


prepared = asyncio.run(guard.prepare_tools(ctx, [
    ToolDefinition(name=delegation.TOOL, parameters_json_schema={
        "type": "object", "properties": {"agent_name": {"type": "string"}, "task": {"type": "string"}},
        "required": ["agent_name", "task"]}),
    OTHER,
]))
brief = "El cliente pidió que solo se reemplace el texto de la lámina 3 por «Reservá por WhatsApp.»"
validated = validate(json.dumps({"agent_name": name, "task": brief,
                                 "for_the_owner": "Que arregle la lámina 3 de «Nuevo horario»."}))
missing = validate({"agent_name": name, "task": brief})
rows = []
delegation.db = types.SimpleNamespace(append_event=lambda *a: rows.append(a))
event = DelegationStartEvent(agent_name=name, task=brief, truncated=False, model=None, inherits_tools=False)
event.tool_call_id = "llamada-1"
asyncio.run(guard._started(types.SimpleNamespace(run_id="r", deps=ctx.deps), event))

cut = "Arreglá únicamente la slide 5. El cliente pidió: «Saca el "
print(json.dumps({
    "schemas": [t.parameters_json_schema for t in prepared],
    "validated": validated,
    "missing": missing,
    "brief": brief,
    "row": rows[0],
    "label": delegation.LABELS.get(name),
    "cut": check(DELEGATE, {"agent_name": name, "task": cut}),
    "whole": check(DELEGATE, {"agent_name": name, "task": "El cliente pidió: «Sacá “también”.»"}),
    "plain": check(DELEGATE, {"agent_name": name, "task": "Arreglá la slide 5 del posteo x."}),
    "other": check(OTHER, {"path": "a.md", "content": "«abierto"}),
    "instructions": guard.get_instructions(),
    "on_face": any(isinstance(c, delegation.Delegation) for c in agent.CAPABILITIES),
}, ensure_ascii=False, default=str))
"""


def judge(name: str, problems: list[str]) -> list[str]:
    """One line per claim, so a failure is read where it happened."""
    print(f"  {name}: " + ("PASS" if not problems else "FAIL — " + "; ".join(problems)))
    return problems


def main() -> int:
    print(f"container: {CONTAINER}")
    done = subprocess.run(
        ["docker", "exec", CONTAINER, "python3", "-c", INSIDE],
        capture_output=True, text=True,
    )
    if done.returncode != 0:
        print(done.stderr.strip()[-1500:])
        print("DELEGATION GUARD: FAIL")
        return 1
    r = json.loads(done.stdout.strip().splitlines()[-1])
    failures = []

    problems = []
    cut = r["cut"]
    if cut.get("raised") != "ModelRetry":
        problems.append(f"a cut brief gave {cut}")
    else:
        if r["label"] and r["label"] not in cut["said"]:
            problems.append(f"the delegate is not named in Spanish: {cut['said']!r}")
        if "Saca el" not in cut["said"]:
            problems.append("it does not say where the brief stopped")
    failures += judge("a. a brief cut mid-quote goes back to the face", problems)

    problems = [f"a {k} brief gave {r[k]}" for k in ("whole", "plain") if "ok" not in r[k]]
    failures += judge("b. a whole brief goes through untouched", problems)

    problems = [] if "ok" in r["other"] else [f"write_file gave {r['other']}"]
    failures += judge("c. no other tool is looked at", problems)

    problems = []
    if "« »" not in (r["instructions"] or "") or "comillas dobles" not in (r["instructions"] or ""):
        problems.append(f"the instructions say {r['instructions']!r}")
    if not r["on_face"]:
        problems.append("the capability is not on the face")
    failures += judge("d. the face is told the rule", problems)

    problems = []
    delegate_schema, other_schema = r["schemas"]
    if "for_the_owner" not in delegate_schema["properties"] or "for_the_owner" not in delegate_schema["required"]:
        problems.append(f"delegate_task does not ask for it: {delegate_schema}")
    if "for_the_owner" in (other_schema or {}).get("properties", {}):
        problems.append("another tool asks for it")
    if set((r["validated"].get("ok") or {}).keys()) != {"agent_name", "task"}:
        problems.append(f"the args the harness validates are {r['validated']}")
    if r["missing"].get("raised") != "ModelRetry" or "for_the_owner" not in r["missing"].get("said", ""):
        problems.append(f"a call without it gave {r['missing']}")
    _, line, _, _, payload = r["row"]
    want = f"Le pedí al {r['label']} que arregle la lámina 3 de «Nuevo horario»"
    if line != want:
        problems.append(f"Activity reads {line!r}, not {want!r}")
    if payload.get("task") != r["brief"] or not payload.get("for_the_owner"):
        problems.append(f"the payload is {payload}")
    failures += judge("e. Activity reads a line for the owner, not the brief", problems)

    print("DELEGATION GUARD: " + ("PASS" if not failures else "FAIL"))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
