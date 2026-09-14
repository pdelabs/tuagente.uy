"""Environment to settings. Everything the engine reads from outside lives here."""

import os
from pathlib import Path

# The model the cost baseline was measured on (notes/cost-and-engine-findings.md).
MODEL = os.environ.get("CORE_MODEL", "openrouter:openai/gpt-5.6-luna")

# Without a cap the request goes out asking for the model's whole output budget
# (65536 tokens on this one) and OpenRouter's affordability check answers 402
# "can only afford N tokens" — the key is charged against what the request COULD
# spend, not what it does. 8192 is above anything a turn of this agent writes.
MODEL_SETTINGS = {"max_tokens": 8192}

# The client's key. Missing it is fatal on purpose: an engine with no auth is
# not an engine we would ever hand to a client.
API_KEY = os.environ["API_SERVER_KEY"]

# To a browser `localhost:8090` and `127.0.0.1:8090` are different origins, so
# both spellings ship by default: portal-check tests the twin.
CORS_ORIGINS = [
    o.strip()
    for o in os.environ.get(
        "CORE_CORS_ORIGINS", "http://localhost:8090,http://127.0.0.1:8090"
    ).split(",")
    if o.strip()
]

STATE_DIR = Path(os.environ.get("CORE_STATE_DIR", "/state"))
DB_PATH = STATE_DIR / "core.db"
WORKSPACE = Path(os.environ.get("CORE_WORKSPACE", "/workspace"))
AGENT_DIR = Path(os.environ.get("CORE_AGENT_DIR", "/agent"))
KIT_PLUGINS = Path(os.environ.get("CORE_KIT_PLUGINS", "/opt/kit/plugins"))

# WHICH KIT PLUGINS THIS AGENT RUNS, in order. Each one may bring skills and a
# `core/` surface: toolsets, routers, hooks, modules and the prose that belongs
# to the mechanism it installs (`core/plugins.py`).
PLUGINS = [
    p.strip()
    for p in os.environ.get("CORE_PLUGINS", "approval,deliverable,memory,image").split(",")
    if p.strip()
]

# The floor under how often a flow may wake the agent up (core/flows.py). Five
# minutes is the kit's number: an over-eager agent cannot schedule itself
# infinite wake-ups. `engine/tests/test_flows.sh` drops it to 1 so the clock
# can be watched in a test instead of in an afternoon.
FLOWS_MIN_MINUTES = int(os.environ.get("CORE_FLOWS_MIN_MINUTES", "5"))

TIMEZONE = os.environ.get("TZ", "America/Montevideo")
ADAPTER_VERSION = "core-0.1.0"

# Traces (core/tracing.py). Empty means off. Phoenix's OTLP/HTTP endpoint is
# `http://<phoenix>:6006/v1/traces`. Content (prompts, completions, tool
# arguments) travels only when INCLUDE_CONTENT is on: on for the lab, off for
# a client.
OTEL_ENDPOINT = os.environ.get("CORE_OTEL_ENDPOINT", "").strip()
OTEL_SERVICE = os.environ.get("CORE_OTEL_SERVICE", "tuagente-core")
OTEL_INCLUDE_CONTENT = os.environ.get("CORE_OTEL_INCLUDE_CONTENT", "0") == "1"

# When to summarize the history away (core/compaction.py). Either one trips it.
# The fraction is of the MODEL's context window, and the baseline model's is
# 1_050_000 tokens, so 0.6 of it is 630_000 — unreachable in a client's
# conversation. The token count is what actually bounds the history here; the
# fraction is what would bound it on a small-window model.
COMPACT_AT = float(os.environ.get("CORE_COMPACT_AT", "0.6"))
COMPACT_AT_TOKENS = int(os.environ.get("CORE_COMPACT_AT_TOKENS", "60000"))

# What the portal draws BEFORE any plugin is loaded: the four tabs the engine
# itself answers. Everything else is off until a plugin flips it with
# `engine.module(...)` — `approvals` is the `approval` plugin's — and what the
# manifest publishes is `plugins.modules()`, the two put together. A module
# declared and not answering is a portal-check failure.
MODULES = {
    "chat": True,
    "files": True,
    "activity": True,
    "approvals": False,
    "usage": True,
    "kanban": False,
    "artifacts": False,
    "crons": False,
    # Flows are the engine's own (core/flows.py, core/scheduler.py,
    # server/flows.py), not a plugin's: what runs on its own is the engine's
    # clock. `crons` stays off — the portal's Crons tab is a view of Hermes'
    # job store, and there is no job store here.
    "flows": True,
    "connections": False,
    "capabilities": False,
}
