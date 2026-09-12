"""Environment to settings. Everything the POC reads from outside lives here."""

import os
from pathlib import Path

# The model the cost baseline was measured on (notes/cost-and-engine-findings.md).
MODEL = os.environ.get("CORE_MODEL", "openrouter:openai/gpt-5.6-luna")

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

PLUGINS = [p.strip() for p in os.environ.get("CORE_PLUGINS", "deliverable").split(",") if p.strip()]

TIMEZONE = os.environ.get("TZ", "America/Montevideo")
ADAPTER_VERSION = "core-0.1.0"

# What the portal draws. A module declared here has to answer, or portal-check
# fails it: `approvals` is Wave 2's to flip, `usage` is Wave 3's.
MODULES = {
    "chat": True,
    "files": True,
    "activity": True,
    "approvals": False,
    "usage": False,
    "kanban": False,
    "artifacts": False,
    "crons": False,
    "flows": False,
    "connections": False,
    "capabilities": False,
}
