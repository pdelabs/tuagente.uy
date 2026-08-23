#!/usr/bin/env python3
"""Create (or update the trigger of) a client's flow.

THE SCRIPT OWNS THE FORMAT: the agent passes name, trigger and pieces; the
script writes the FLOW.md with the frontmatter the portal knows how to read,
creates the cron job if the trigger needs one, and leaves the job_id linked.
That way every flow of every client has the same shape and the portal never
finds a broken one.

Fixed decisions:
- The cron job is created with --deliver local: the agent that talks to the
  client is the ONE RUNNING THE FLOW BODY (deliver=origin from a cron delivers
  to nothing -- verified trap).
- Minimum frequency 5 minutes: an over-eager agent cannot schedule itself
  infinite wake-ups.
- The cron's prompt is always the same: "trabaja el flujo <slug>" -- the logic
  lives in the FLOW.md, which the client can see and the agent can edit.

Usage:
    python3 create_flow.py --slug entrevistas-tv --name "Entrevistas → zócalos" \
        --client-summary "Cada entrevista termina en..." \
        --trigger drive --detail "Mira tu Drive cada 15 minutos" \
        --cron "*/15 * * * *" --folders id1,id2 \
        --connections google-workspace,auxiliary-models \
        --skills drive-inbox,transcribe,frases-zocalo,deliverable <<'MD'
    # Cómo trabajo este flujo
    1. ...
    MD
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

FLOWS = Path("/opt/data/flows")
DATA = Path("/opt/data")
CATALOG = DATA / "connections" / "catalog.json"

# THE BINARY IS RESOLVED, NEVER INVOKED BY BARE NAME. The agent's `terminal`
# tool runs with a sanitized PATH --/usr/local/bin:/usr/bin:/bin:/usr/local/games:
# /usr/games-- that does NOT have /opt/hermes/bin, so `["hermes", ...]` used to
# die with "[Errno 2] No such file or directory: 'hermes'" and NO flow ever got
# created. Verified in the 12/8 conduct run and in production: the agent's
# flows/ directory did not exist, the feature had never worked.
HERMES_CANDIDATES = (
    "/opt/hermes/bin/hermes",
    "/opt/hermes/.venv/bin/hermes",
)
SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,48}$")
TRIGGERS = ("drive", "schedule", "request")
MIN_MINUTES = 5
# Caps on the VISIBLE body (what the portal shows the client).
MAX_STEPS = 7
MAX_STEP_LENGTH = 320


def fail(msg):
    print(json.dumps({"ok": False, "error": msg}, ensure_ascii=False))
    return 2


def hermes_binary():
    """The path to Hermes' CLI, or None if it truly is not there.

    Every candidate is tried first, the PATH only at the end: the first one
    existing but not being executable (permissions, an odd mount) cannot leave
    us without a CLI when another one is right there.
    """
    for path in HERMES_CANDIDATES:
        if os.access(path, os.X_OK):
            return path
    return shutil.which("hermes")


def cron(binary, *args, timeout=30):
    """Run `hermes cron ...` and return (stdout, stderr)."""
    try:
        r = subprocess.run([binary, "cron", *args],
                           capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as e:
        return "", str(e)
    return (r.stdout or ""), (r.stderr or "")


def missing_connections(ids):
    """Of the connections the flow declares, which ones are NOT actually set up.

    Same three rules the adapter uses in `_falta_de` (portal_adapter.py,
    another unit's file; not yet renamed there as of this writing) -- an
    environment variable, a file under data/, a plugin named in the config --
    over the SAME catalog (data/connections/catalog.json), which is the
    source of truth. Both processes see the same thing: compose hands them the
    same `env_file` and the same volume.

    HEADS UP: `adapter/portal_adapter.py::_falta_de` has the twin copy. Touch
    one rule, touch both -- the day they drift apart, the portal will say the
    inbox connection is missing while the flow gets scheduled as if everything
    were set up.

    Returns [] on purpose when the catalog is missing or unreadable: without a
    catalog we know nothing, and blocking flow creation over that would be
    worse than letting it through (the portal still shows what is missing).
    """
    ids = [i for i in ids if i]
    if not ids:
        return []
    try:
        catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    try:
        config = (DATA / "config.yaml").read_text(encoding="utf-8")
    except OSError:
        config = ""
    missing = []
    for c in catalog.get("connections", []):
        if c.get("id") not in ids:
            continue
        rule = c.get("detects", {}) or {}
        gaps = [v for v in rule.get("env", []) if not os.environ.get(v, "").strip()]
        gaps += [a for a in rule.get("files", [])
                 if not (DATA / a).is_file()]
        gaps += [p for p in rule.get("plugin", []) if p not in config]
        if gaps:
            missing.append(c.get("id"))
    return missing


def _too_frequent(cron_expr):
    """True if the cron runs more often than every MIN_MINUTES."""
    m = re.match(r"^\*/(\d+) \* \* \* \*$", cron_expr.strip())
    if m:
        return int(m.group(1)) < MIN_MINUTES
    return cron_expr.strip().startswith("* ")  # every minute


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--slug", required=True)
    ap.add_argument("--name", required=True)
    ap.add_argument("--client-summary", required=True, dest="client_summary",
                    help="que hace el flujo, dicho AL CLIENTE (sin jerga)")
    ap.add_argument("--trigger", required=True, choices=TRIGGERS)
    ap.add_argument("--detail", required=True,
                    help='el gatillo en criollo: "Mira tu Drive cada 15 minutos"')
    ap.add_argument("--cron", default="", help="obligatorio si trigger != request")
    ap.add_argument("--folders", default="", help="ids de Drive (trigger drive)")
    # REQUIRED, on purpose. Skipping it used to be free, and the agent skipped
    # it even when the work touched email: instead of declaring the connection
    # was missing, it quietly narrowed the scope ("I'll only prepare drafts")
    # and the flow came out GREEN in the portal. The client never found out
    # that connecting email would have completed the work. Now it has to be
    # answered, even if the answer is "none".
    ap.add_argument("--connections", required=True,
                    help='ids del catalogo separados por coma, o "ninguna"')
    ap.add_argument("--skills", default="")
    args = ap.parse_args()

    if not SLUG_RE.match(args.slug):
        return fail("slug invalido: minusculas, numeros y guiones")
    if args.trigger != "request" and not args.cron:
        return fail(f"gatillo {args.trigger} necesita --cron")
    if args.cron and _too_frequent(args.cron):
        return fail(f"frecuencia minima: cada {MIN_MINUTES} minutos")

    body = sys.stdin.read().strip()

    # The body is READ BY THE CLIENT in the portal ("Cómo lo trabaja tu
    # agente"). Without a cap it turns into an internal document: the first
    # Instagram flow had 13 steps of six-line paragraphs and nobody was going
    # to read that. What overflows is not thrown away: it goes to
    # "## Notas técnicas", which the portal trims off.
    visible = body.split("## Notas")[0]
    steps = [l for l in visible.splitlines() if re.match(r"^\s*\d+[.)]\s", l)]
    if len(steps) > MAX_STEPS:
        return fail(f"el cuerpo visible tiene {len(steps)} pasos y el maximo es "
                     f"{MAX_STEPS}: agrupa o move el detalle a '## Notas tecnicas'")
    too_long = [i + 1 for i, l in enumerate(steps) if len(l) > MAX_STEP_LENGTH]
    if too_long:
        return fail(f"los pasos {too_long} pasan de {MAX_STEP_LENGTH} caracteres: "
                     "el cliente los tiene que poder leer de un vistazo; el "
                     "detalle va a '## Notas tecnicas'")
    if not body:
        return fail("falta el cuerpo (las instrucciones de como trabajas el flujo)")

    flow_dir = FLOWS / args.slug
    if (flow_dir / "FLOW.md").exists():
        return fail(f"el flujo {args.slug} ya existe: editalo en vez de recrearlo")

    job_id = ""
    if args.cron:
        binary = hermes_binary()
        if not binary:
            return fail(
                "no encontré el CLI de Hermes (busqué en " + ", ".join(HERMES_CANDIDATES)
                + " y en el PATH). Sin eso no puedo programar nada: NO cuentes que el "
                "flujo quedó andando"
            )
        # SILENCE ONLY COUNTS FOR "THERE WAS NOTHING TO DO". This prompt used
        # to say only "if the trigger finds nothing new, end in silence", and a
        # run that COULD NOT work -- the weekly price flow with email
        # unconnected -- fell into that same phrase: it ran, could not read the
        # inbox, and stayed quiet. To the client that is indistinguishable from
        # "no price changes this week": it is the worst possible failure, the
        # one that looks like success. (Conduct QA on 12/8.)
        prompt = (
            f"Trabaja el flujo {args.slug}: abri /opt/data/flows/{args.slug}/FLOW.md "
            "y segui sus instrucciones tal cual. "
            "Si lo trabajaste y no habia nada nuevo que hacer, termina en silencio. "
            "PERO si NO PUDISTE trabajarlo —falta una conexion, una credencial "
            "vencio, no tenes una herramienta—, NO termines en silencio: crea un "
            "ticket en el tablero que diga que no pudiste, que falta y que se "
            "pierde mientras tanto, y pedi lo que falte con la skill capability. "
            "El cliente lee el silencio como 'no hubo novedades', asi que una "
            "corrida que no pudo hacer su trabajo SIEMPRE deja rastro visible."
        )
        # The `flujo-<slug>` cron job-name prefix STAYS in Spanish on purpose:
        # it is a compatibility key the portal matches by string prefix
        # (app/app/lib/events.ts) against cron jobs already created on
        # deployed agents, and renaming it here would orphan every flow
        # created before this rename. Comment mirrored on the portal side.
        output, error = cron(binary, "create", args.cron, prompt,
                             f"--name=flujo-{args.slug}", "--deliver=local")
        m = re.search(r"Created job:\s*([0-9a-f]+)", output)
        if not m:
            return fail(f"el cron no se creo: {(error or output).strip()[:200]}")
        job_id = m.group(1)

        # AND NOW WE VERIFY IT STUCK. The create command printing an id is not
        # enough: what we tell the client is "this is going to run on its
        # own", and that gets asserted only after seeing it in the list, not
        # before. Compared by ID, NOT by name: if a `flujo-<slug>` already
        # existed from before and the new one did not persist, the name would
        # be the same and we would call a job created that is not the one we
        # just asked for.
        list_output, list_error = cron(binary, "list")
        if job_id not in list_output:
            return fail(
                f"el cron dijo que creó {job_id} pero ese id no aparece en "
                f"`hermes cron list` ({(list_error or list_output).strip()[:120]}) — "
                "no lo des por creado"
            )

    front = [
        "---",
        f"name: {args.name}",
        f'client_summary: "{args.client_summary}"',
        f"trigger_type: {args.trigger}",
        f"trigger_detail: {args.detail}",
    ]
    if args.cron:
        front.append(f'trigger_cron: "{args.cron}"')
    if args.folders:
        front.append(f"trigger_folders: {args.folders}")
    if job_id:
        front.append(f"trigger_job: {job_id}")
    if args.connections and args.connections.strip().lower() not in ("ninguna", "-"):
        front.append(f"connections: {args.connections}")
    if args.skills:
        front.append(f"skills: {args.skills}")
    front.append(f"results: entregables/{args.slug}")
    front.append("status: active")
    front.append("---")

    flow_dir.mkdir(parents=True, exist_ok=True)
    (flow_dir / "FLOW.md").write_text("\n".join(front) + f"\n\n{body}\n", "utf-8")
    (Path("/opt/data/workspace/entregables") / args.slug).mkdir(parents=True, exist_ok=True)

    # The last thing the script does is check whether the flow can do its work
    # TODAY. If a connection is missing, whoever creates the flow has to find
    # out RIGHT HERE -- not next Monday -- and tell the client in plain words.
    # Before, this came out with a reassuring "the portal asks for it on its
    # own": the portal does show it in amber, but the agent would tell the
    # client "done, every Monday at 9", and the client was left with that.
    missing = missing_connections(
        [c.strip() for c in args.connections.split(",")]
        if args.connections.strip().lower() not in ("ninguna", "-") else []
    )
    result = {
        "ok": True,
        "flow": str(flow_dir / "FLOW.md"),
        "cron_job": job_id or None,
        "missing_connections": missing,
    }
    if missing:
        result["tell_the_client"] = (
            "El flujo quedó armado, pero HOY no puede hacer su trabajo: falta "
            + ", ".join(missing)
            + ". Decíselo al cliente en la misma respuesta en que le contás que "
            "lo creaste —qué se pierde mientras tanto y cómo se conecta—, y pedí "
            "la conexión con la skill capability. No le digas que quedó andando."
        )
        result["note"] = (
            "El gatillo queda programado igual, a propósito: el día que se "
            "conecte, arranca solo sin que nadie se acuerde de reactivarlo. Y si "
            "corre sin la conexión, el prompt del gatillo le ordena dejar un "
            "ticket visible en vez de terminar en silencio."
        )
    else:
        result["note"] = "El cliente ya lo ve en su pestaña Flujos."
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
