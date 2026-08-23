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
SQL_WRITE = re.compile(r"\.execute\(.*\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER)\b", re.IGNORECASE)


def main():
    failures = []
    if not WORKSPACE_MODULE.is_file():
        failures.append("adapter/workspace.py is missing")
    if not KANBAN_MODULE.is_file():
        failures.append("adapter/kanban.py is missing")
    if not FLOWS_MODULE.is_file():
        failures.append("adapter/flows.py is missing")

    for line_number, line in enumerate(ADAPTER.read_text(encoding="utf-8").splitlines(), 1):
        if SQL_WRITE.search(line):
            failures.append(f"portal_adapter.py:{line_number}: SQL mutation text is forbidden")

    if failures:
        print("Adapter boundary check failed:", file=sys.stderr)
        print("\n".join(f"  {failure}" for failure in failures), file=sys.stderr)
        return 1
    print("Adapter boundaries are intact.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
