#!/usr/bin/env python3
"""The guard: an MCP server that wraps another one and enforces policy.

WHY IT EXISTS
-------------
A third-party MCP server exposes tools that act on the client's world --send a
WhatsApp, move money-- with ITS OWN credentials. The approval gate covers
one-off actions; what was missing was PERMANENT policy: "this agent can read
WhatsApp but not write to it."

We chose ONE guard instead of forking each server. Fifteen forks are fifteen
repos to track upstream, with fifteen chances that a merge brings back the
permission we stripped -- and policy would end up scattered across fifteen
places, so nobody could answer "what can this agent do" without reading
fifteen repos.

HOW IT SITS
-----------
    hermes -> guard (this) -> real server -> the world

Hermes knows about exactly ONE MCP server: this one. The third-party server is
unreachable by the agent: it lives on the compose's internal network, with no
published port, and only the guard can reach it. Even if the model wanted to
skip it, there is no route.

TWO INVARIANTS, AND NEITHER IS A PROMISE
-----------------------------------------
1. Policy is READ from /opt/policy, which is mounted :ro in the agent's own
   container. The agent cannot edit it even if it reasons that it should --and
   it does reason that way: when it was missing the mail connection, it did
   not ask, it just worked around it.
2. What is forbidden is NEVER ADVERTISED. `tools/list` returns only what is
   allowed, so the model does not spend context on schemas it cannot use
   (measured: the schemas weigh 60 KB, almost double the whole system prompt)
   and is not tempted by what is off the table.

If a `tools/call` for something blocked still arrives anyway --say, from a
cached list-- it gets a STRUCTURED refusal: which connection, which action,
and where to change it. The agent has to be able to say "I can't send
WhatsApp messages because you have that turned off," not a bare "error."
"""
import json
import os
import subprocess
import sys
import threading

POLICY = os.environ.get("GUARD_POLICY", "/opt/policy/policy.json")
CONNECTION = os.environ.get("GUARD_CONNECTION", "")
COMMAND = os.environ.get("GUARD_COMMAND", "")


def log(msg):
    """To stderr: stdout is the protocol channel and stays clean."""
    print(f"[guard:{CONNECTION}] {msg}", file=sys.stderr, flush=True)


def policy():
    """What this connection can do. When in doubt, the most restrictive.

    An unreadable file does NOT open the door: if we do not know what is
    allowed, nothing is allowed. It is the only safe reading of a failure.
    """
    try:
        with open(POLICY, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError) as e:
        log(f"policy unreadable ({e}): everything closed")
        return {"read": False, "act": False, "tools": {}}
    c = (data.get(CONNECTION) or {}) if isinstance(data, dict) else {}
    return {
        "read": bool(c.get("read", True)),
        "act": bool(c.get("act", False)),
        "tools": c.get("tools") or {},
    }


def classes():
    """What each tool does, per the kit's own curation."""
    path = os.environ.get("GUARD_TOOLS", f"/opt/policy/tools/{CONNECTION}.json")
    try:
        with open(path, encoding="utf-8") as f:
            return {k: v.get("kind", "act")
                    for k, v in (json.load(f).get("tools") or {}).items()}
    except (OSError, ValueError):
        # No classification means no guessing: everything counts as acting.
        log(f"no classification at {path}: everything treated as 'act'")
        return {}


def allowed(name, pol, kinds):
    """True if this tool may pass through."""
    # An explicit per-tool permission wins over the kind.
    if name in pol["tools"]:
        return bool(pol["tools"][name])
    kind = kinds.get(name, "act")   # unknown = act = closed by default
    return pol["read"] if kind == "read" else pol["act"]


def rejection(name, kind):
    """The 'no' the agent can turn into a useful sentence."""
    action = "leer" if kind == "read" else "escribir o mandar"
    return {
        "content": [{
            "type": "text",
            "text": (
                f"BLOQUEADO POR EL CLIENTE. No puedo usar `{name}`: tu cliente "
                f"tiene apagado el permiso de {action} en la conexion "
                f"'{CONNECTION}'.\n\n"
                f"No lo puedas cambiar vos ni por archivo ni por terminal — lo "
                f"cambia el cliente desde el portal. Deciselo y ofrecele el "
                f"control escribiendo `permissions:{CONNECTION}` en tu respuesta, "
                f"que el chat lo convierte en los interruptores."
            ),
        }],
        "isError": True,
    }


class Downstream:
    """The real server, spoken to over stdio with line-delimited JSON-RPC."""

    def __init__(self, command):
        self.proc = subprocess.Popen(
            command, shell=True, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=sys.stderr, text=True, bufsize=1)
        self.lock = threading.Lock()

    def request(self, message):
        """Send and WAIT for a reply. Only for messages that carry an id."""
        with self.lock:
            self.proc.stdin.write(json.dumps(message) + "\n")
            self.proc.stdin.flush()
            line = self.proc.stdout.readline()
        if not line:
            raise RuntimeError("the downstream server died")
        return json.loads(line)

    def notify(self, message):
        """Send and do NOT wait for anything.

        MCP notifications (no `id`) are NEVER answered. Sending them through
        `request` leaves the readline hanging forever and kills the whole
        connection at the handshake: every real client sends
        `notifications/initialized` right after `initialize`.
        """
        with self.lock:
            self.proc.stdin.write(json.dumps(message) + "\n")
            self.proc.stdin.flush()


def main():
    if not COMMAND:
        log("missing GUARD_COMMAND (how to start the real server)")
        return 2
    downstream = Downstream(COMMAND)
    kinds = classes()
    log(f"up · policy={POLICY} · {len(kinds)} tools classified")

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except ValueError:
            continue

        method = msg.get("method")
        pol = policy()   # re-read on every message: a change made in the
                          # portal takes effect on the next round-trip, with
                          # no restart needed.

        # NOTIFICATIONS (no id): passed through, nothing awaited. This goes
        # FIRST, ahead of every other branch, because waiting for a reply to
        # something that carries none hangs the whole connection. This is what
        # was blocking the guard from ever registering: `hermes mcp add` died
        # with "Failed to connect" and the cause was three lines further down,
        # in the final `request` call.
        if msg.get("id") is None:
            try:
                downstream.notify(msg)
            except (OSError, ValueError) as e:
                log(f"could not forward notification {method}: {e}")
            continue

        # tools/list: only what is allowed is returned.
        if method == "tools/list":
            response = downstream.request(msg)
            all_tools = ((response.get("result") or {}).get("tools") or [])
            allowed_tools = [t for t in all_tools if allowed(t.get("name", ""), pol, kinds)]
            if len(allowed_tools) != len(all_tools):
                log(f"tools/list: {len(allowed_tools)}/{len(all_tools)} allowed")
            response.setdefault("result", {})["tools"] = allowed_tools
            print(json.dumps(response), flush=True)
            continue

        # tools/call: cut off HERE if it is not allowed.
        if method == "tools/call":
            name = (msg.get("params") or {}).get("name", "")
            if not allowed(name, pol, kinds):
                log(f"BLOCKED {name}")
                print(json.dumps({
                    "jsonrpc": "2.0", "id": msg.get("id"),
                    "result": rejection(name, kinds.get(name, "act")),
                }), flush=True)
                continue

        # Everything else (initialize, ping, resources...) passes through as-is.
        try:
            print(json.dumps(downstream.request(msg)), flush=True)
        except (RuntimeError, ValueError) as e:
            log(f"error talking to the downstream server: {e}")
            if msg.get("id") is not None:
                print(json.dumps({
                    "jsonrpc": "2.0", "id": msg["id"],
                    "error": {"code": -32603, "message": str(e)},
                }), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
