#!/usr/bin/env python3
"""Enforce adapter boundaries that have previously caused production failures."""

from pathlib import Path
import re
import sys


ROOT = Path(__file__).resolve().parents[1]
ADAPTER = ROOT / "adapter" / "portal_adapter.py"
WORKSPACE_MODULE = ROOT / "adapter" / "workspace.py"
KANBAN_MODULE = ROOT / "adapter" / "kanban.py"
FLOWS_MODULE = ROOT / "adapter" / "flows.py"
# THE SQL DOES NOT HAVE TO BE ON THE SAME LINE AS `.execute(`, and in this file
# it usually is not: five of the seven call sites in portal_adapter.py open the
# call and put the query on the NEXT line. The old pattern required both on one
# physical line, so an INSERT written in the file's own dominant style matched
# nothing and the check passed. It was true, and it was not looking.
#
# Anchored on the opening quote so it still crosses newlines without turning
# into "any file mentioning DELETE fails": a docstring or a comment saying
# `DELETE` is not `.execute("DELETE`. `executemany`/`executescript` are here
# because `\.execute\(` never matched them either.
#
# This is the braces. The belt is `PRAGMA query_only = ON`
# (adapter/portal_adapter.py:110), which is what actually makes a write fail,
# and a query assembled into a variable first is still invisible to any text
# check -- which is why the belt is the one that has to hold.
SQL_WRITE = re.compile(
    r"\.execute(?:many|script)?\(\s*[fbruFBRU]*(?:\"\"\"|\'\'\'|\"|\')\s*"
    r"\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER)\b",
    re.IGNORECASE | re.DOTALL)


def main():
    failures = []
    if not WORKSPACE_MODULE.is_file():
        failures.append("adapter/workspace.py is missing")
    if not KANBAN_MODULE.is_file():
        failures.append("adapter/kanban.py is missing")
    if not FLOWS_MODULE.is_file():
        failures.append("adapter/flows.py is missing")

    if not ADAPTER.is_file():
        # The other three get this guard; without it a missing adapter comes out
        # as a FileNotFoundError traceback instead of a line in the list.
        failures.append("adapter/portal_adapter.py is missing")
    else:
        source = ADAPTER.read_text(encoding="utf-8")
        for match in SQL_WRITE.finditer(source):
            line_number = source.count("\n", 0, match.start()) + 1
            failures.append(f"portal_adapter.py:{line_number}: SQL mutation text is forbidden")

    if failures:
        print("Adapter boundary check failed:", file=sys.stderr)
        print("\n".join(f"  {failure}" for failure in failures), file=sys.stderr)
        return 1
    print("Adapter boundaries are intact.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
