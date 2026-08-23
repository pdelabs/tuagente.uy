#!/usr/bin/env bash
# One-shot migration: converts a DEPLOYED agent's on-disk layout from the old
# Spanish names this kit used before the translation pass to the new English
# ones install.sh expects today (see RENAME-MAP.md D6 in the tuagente.uy repo,
# and hermes-kit/fleet.md for which live agents still need this).
#
#   ./migrate-agent-to-english.sh --local ~/…/agente-acme
#   ./migrate-agent-to-english.sh --local ~/…/agente-acme --dry-run
#   ./migrate-agent-to-english.sh tuagente                    # ssh: alias named like the agent
#   ./migrate-agent-to-english.sh root@1.2.3.4 east           # ssh: host + slug
#   ./migrate-agent-to-english.sh east --dry-run              # ssh, read-only preview
#
# Same `--local <path>` vs `<ssh-host> [slug]` split as reset-agent.sh and
# install-soul.sh: local mode takes an agent ROOT directory on this machine
# (the parent of its `data/`); ssh mode takes an ssh alias or `user@ip`, with
# the slug (`/opt/agentes/<slug>`) as a second argument when it doesn't match
# the ssh host's name.
#
# WHAT IT RENAMES (agent ROOT, i.e. the parent of data/):
#   secretos.env, politica/ (and everything inside: policy.json, capabilities/,
#   roles/, salas/, avisos/, hooks/, plugins/, guardia.py, parche-pairing.py,
#   cont-init-parches.sh, tools/, mcp/), .kit-instalado(.nuevo),
#   skills-reemplazadas/, respaldos/(-soul/-config/), docker-compose.yml
#   (paths + ${CLIENTE} + the optional observability/litellm overlay), .env
#   and Caddyfile on a remote agent, and inside data/: portal_identidad.json,
#   connections/{catalogo,requeridas}.json, google_oauth_portal.json,
#   flujos/<slug>/FLUJO.md, costos.jsonl, SOUL.md's portal:identity marker,
#   config.yaml's hook path / plugin name / kit:exception marker, deliverable
#   frontmatter under workspace/entregables/, and data/profiles/<role>/.
#   JSON/JSONL keys and known enum VALUES are translated along with the
#   paths; free-text values (labels, prose) are left exactly as they were.
#   The full key-by-key map lives in the embedded Python below and mirrors
#   RENAME-MAP.md D3/D4/D6/D7 — read that file before changing either.
#
# WHAT STAYS: client-visible workspace folder names (entregables/, etc.),
# flow slugs, SOUL/FLOW.md prose, catalog label/purpose/how VALUES, and any
# file this script doesn't recognize (reported, not guessed at).
#
# WHAT IT DOES NOT DO: it never stops or restarts the containers, and it
# never calls the Hermes CLI (`hermes profile …`). If the agent has hired
# roles, their `data/profiles/<id>/` directories and `role.json` get renamed
# on disk, but Hermes' own profile registry still knows them by the old id —
# that gets reported as a manual step, not guessed at.
#
# --dry-run prints every action this run WOULD take and touches nothing —
# not even a backup gets written. Idempotent: a second real run finds every
# old path already gone and reports "skipped-not-present" for all of it.
#
# Every JSON/JSONL/text file this script rewrites is copied first into
# backups/migrate-to-english-<timestamp>/ (agent root), before being touched.
# Pure renames (a file or directory moving with no content change) aren't
# separately backed up — nothing about them is destroyed, only relocated.
#
# In ssh mode, the agent's root is rsynced down to a local temp directory,
# migrated there with the exact same engine as --local, then rsynced back up
# (plus the removal, over ssh, of exactly the old-named paths this run
# actually retired — never a wildcard delete). --dry-run in ssh mode only
# downloads a read-only copy to preview against; nothing is uploaded.
#
# At the end it prints the commands the operator still has to run by hand:
# a fresh `docker compose up -d` (a `restart` is NOT enough once a mount's
# source path changed — e.g. ./politica -> ./policy), a SOUL v13 reinstall,
# and both agent-check.py and portal-check.py.
set -euo pipefail

MODE=ssh
DRY_RUN=0
POS=()
while (( $# )); do
  case "$1" in
    --local)    MODE=local; DIR="${2:-}"; shift $(( $# > 1 ? 2 : 1 )) ;;
    --dry-run)  DRY_RUN=1; shift ;;
    -h|--help)  sed -n '2,60p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*)         echo "unknown option: $1" >&2; exit 2 ;;
    *)          POS+=("$1"); shift ;;
  esac
done

if [[ "$MODE" == local ]]; then
  [[ -n "${DIR:-}" ]] || { echo 'usage: ./migrate-agent-to-english.sh --local <agent-root> [--dry-run]' >&2; exit 2; }
  DIR="$(cd "$DIR" 2>/dev/null && pwd)" || { echo "that directory doesn't exist" >&2; exit 1; }
  [[ -d "$DIR/data" ]] || { echo "$DIR/data doesn't exist — is '$DIR' really an agent root?" >&2; exit 1; }
else
  HOST="${POS[0]:-}"
  [[ -n "$HOST" ]] || {
    echo 'usage: ./migrate-agent-to-english.sh <ssh-host> [slug] [--dry-run]' >&2
    echo '       ./migrate-agent-to-english.sh --local <agent-root> [--dry-run]' >&2
    exit 2
  }
  SLUG="${POS[1]:-$HOST}"
  DIR="/opt/agentes/$SLUG"
  ssh -o ConnectTimeout=10 "$HOST" "[ -d '$DIR/data' ]" || {
    echo "$DIR/data doesn't exist on $HOST" >&2
    echo "if the agent's directory isn't named '$SLUG', pass it as the second" >&2
    echo "argument:  ./migrate-agent-to-english.sh $HOST <slug>" >&2
    exit 1
  }
fi

# The engine: pure stdlib Python, operates on a single local directory, knows
# nothing about ssh. --local calls it directly; ssh mode calls it against a
# staged local copy (below). One implementation, exactly like reset-agent.sh's
# `run()` keeps one recipe for both transports instead of two that drift.
run_engine() {   # $1 = local path to migrate, $2 = 1|0 dry-run
  local target="$1" dry="$2"
  local extra=()
  [[ "$dry" == 1 ]] && extra+=(--dry-run)
  python3 - "$target" "${extra[@]}" <<'PYEOF'
"""Renames a deployed agent's on-disk layout from the kit's old Spanish names
to the current English ones. Stdlib only (no PyYAML: config.yaml gets
line-based edits for the few specific keys the kit ever put there, never a
full parse/rewrite). See RENAME-MAP.md D3, D4, D6, D7 for the vocabulary this
mirrors, and hermes-kit/tools/test_migrate_agent_to_english.py for the tests.
"""
import json
import os
import re
import shutil
import sys
import time
from pathlib import Path

DRY_RUN = "--dry-run" in sys.argv[1:]
_positional = [a for a in sys.argv[1:] if a != "--dry-run"]
if not _positional:
    print("usage: migrate-agent-to-english.sh --local <agent-root> [--dry-run]", file=sys.stderr)
    sys.exit(2)
ROOT = Path(_positional[0]).resolve()
if not ROOT.is_dir():
    print(f"{ROOT} is not a directory", file=sys.stderr)
    sys.exit(2)

TS = time.strftime("%Y%m%d-%H%M%S")
BACKUP_DIR = ROOT / "backups" / f"migrate-to-english-{TS}"

# ── vocabulary maps (RENAME-MAP.md D3, D4, D6, D7) ──────────────────────────

LOOK_AXIS_MAP = {
    "tono": "tone", "antena": "antenna", "accesorio": "accessory",
    "pupila": "pupil", "boca": "mouth", "piel": "skin", "traje": "suit",
    "cejas": "brows", "sombrero": "hat",
}
ROLE_ID_MAP = {
    "asistente": "assistant", "contabilidad": "accounting",
    "soporte": "support", "ventas": "sales",
    # marketing's id never changed
}
CONNECTION_ID_MAP = {
    "correo": "email", "modelos-auxiliares": "auxiliary-models",
}
CAPABILITY_ID_MAP = {
    "calculo-y-planillas": "calc-and-spreadsheets",
    "busqueda-web": "web-search",
    "transcripcion": "transcription",
    "presupuestos": "quotes",
    "facturas-a-datos": "invoices-to-data",
    "seguimiento-de-cobranzas": "collections-followup",
    "paquete-social": "social-package",
    "resumen-de-reuniones": "meeting-summaries",
    "base-de-conocimiento": "knowledge-base",
    "monitoreo-web": "web-monitoring",
    "licitaciones-uy": "uy-tenders",
    "catalogo-de-productos": "product-catalog",
    "memoria-de-clientes": "customer-memory",
    "analisis-de-datos": "data-analysis",
    "control-de-stock": "stock-control",
    "documentos-desde-modelos": "documents-from-templates",
    "reportes-con-marca": "branded-reports",
    "edicion-de-imagenes": "image-editing",
    "investigacion-de-empresas": "company-research",
    "contenido-linkedin": "linkedin-content",
    "conciliacion-bancaria": "bank-reconciliation",
    "calculos-laborales-uy": "uy-payroll-calcs",
    "turnos-y-agenda": "appointments-and-scheduling",
    # a connection id that used to be filed (wrongly) as a capability, D7
    "modelos-auxiliares": "auxiliary-models",
}
SKILL_ID_MAP = {
    "aprobacion": "approval", "capacidad": "capability",
    "entrada-drive": "drive-inbox", "entregable": "deliverable",
    "facturas-a-datos": "invoices-to-data", "flujo": "flow",
    "sin-busqueda-web": "no-web-search", "sin-imagenes": "no-images",
    "transcribir": "transcribe",
    # artifact, brand-kit, post-image, social-content: unchanged
}
TRIGGER_TYPE_MAP = {"horario": "schedule", "pedido": "request"}
FLOW_STATUS_MAP = {"activo": "active", "incompleto": "incomplete", "pausado": "paused"}
EVENT_MAP = {"pedido": "requested", "atendido": "hired", "cancelado": "cancelled"}
NOTIFY_CHANNEL_MAP = {"correo": "email", "ninguno": "none"}
NO_CONNECTION_TOKENS = {"ninguna", "ninguno", "none", "n/a", "-", "—"}

FLOW_KEY_MAP = {
    "nombre": "name", "para_cliente": "client_summary",
    "gatillo_tipo": "trigger_type", "gatillo_detalle": "trigger_detail",
    "gatillo_cron": "trigger_cron", "gatillo_carpetas": "trigger_folders",
    "gatillo_job": "trigger_job", "conexiones": "connections",
    "resultados": "results", "estado": "status",
}
DELIVERABLE_KEY_MAP = {"titulo": "title", "tipo": "kind", "fecha": "date"}

# ── reporting ────────────────────────────────────────────────────────────────

results = []          # (status, message) ; status in done/skipped/manual
removed_paths = []    # old relpaths gone after this run (ssh mode's cleanup list)


def relpath(p: Path) -> str:
    try:
        return str(p.relative_to(ROOT))
    except ValueError:
        return str(p)


def log(status, msg):
    results.append((status, msg))


def note_removed(p: Path):
    removed_paths.append(relpath(p))


# ── generic helpers ──────────────────────────────────────────────────────────

any_backed_up = False


def backup(path: Path):
    """Copies a file or directory into this run's backup area before it gets
    rewritten. Pure renames don't call this: nothing about them is destroyed,
    only relocated, so the old path itself is the safety net until the next
    run's cleanup."""
    global any_backed_up
    if DRY_RUN:
        return
    any_backed_up = True
    dest = BACKUP_DIR / relpath(path)
    dest.parent.mkdir(parents=True, exist_ok=True)
    if path.is_dir():
        shutil.copytree(path, dest, dirs_exist_ok=True)
    else:
        shutil.copy2(path, dest)


def move(old: Path, new: Path, label):
    """Pure rename (file or directory), no content change. Merge-safe: if the
    destination already exists (a partially completed earlier run, or two old
    paths landing on the same new one), moves children in rather than
    clobbering, and never overwrites a same-named file already there."""
    if not old.exists():
        log("skipped", f"{label}: {relpath(old)} not present")
        return False
    if DRY_RUN:
        log("done", f"[dry-run] would move {relpath(old)} -> {relpath(new)}")
        return True
    new.parent.mkdir(parents=True, exist_ok=True)
    if old.is_dir() and new.exists():
        for child in list(old.iterdir()):
            target = new / child.name
            if target.exists():
                log("manual", f"{label}: {relpath(target)} already exists -- left "
                               f"{relpath(child)} in place, resolve by hand")
                continue
            shutil.move(str(child), str(target))
        try:
            old.rmdir()
            note_removed(old)
        except OSError:
            log("manual", f"{label}: {relpath(old)} left non-empty after merging into "
                           f"{relpath(new)} -- check by hand")
            return True
    elif new.exists():
        log("manual", f"{label}: both {relpath(old)} and {relpath(new)} exist -- resolve by hand")
        return False
    else:
        shutil.move(str(old), str(new))
        note_removed(old)
    log("done", f"moved {relpath(old)} -> {relpath(new)}")
    return True


def move_and_rewrite_json(old: Path, new: Path, transform, label):
    if not old.exists():
        log("skipped", f"{label}: {relpath(old)} not present")
        return
    if DRY_RUN:
        log("done", f"[dry-run] would move+rewrite {relpath(old)} -> {relpath(new)}")
        return
    if new.exists() and new.resolve() != old.resolve():
        log("manual", f"{label}: both {relpath(old)} and {relpath(new)} exist -- resolve by hand")
        return
    backup(old)
    try:
        data = json.loads(old.read_text(encoding="utf-8"))
    except ValueError as exc:
        log("manual", f"{label}: {relpath(old)} is not valid JSON ({exc}) -- left untouched")
        return
    new_data = transform(data) if transform else data
    new.parent.mkdir(parents=True, exist_ok=True)
    new.write_text(json.dumps(new_data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if new.resolve() != old.resolve():
        old.unlink()
        note_removed(old)
    log("done", f"moved+rewrote {relpath(old)} -> {relpath(new)}")


def move_and_rewrite_jsonl(old: Path, new: Path, line_transform, label):
    if not old.exists():
        log("skipped", f"{label}: {relpath(old)} not present")
        return
    if DRY_RUN:
        log("done", f"[dry-run] would move+rewrite {relpath(old)} -> {relpath(new)}")
        return
    if new.exists() and new.resolve() != old.resolve():
        log("manual", f"{label}: both {relpath(old)} and {relpath(new)} exist -- resolve by hand")
        return
    backup(old)
    out_lines = []
    bad = 0
    for line in old.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except ValueError:
            bad += 1
            out_lines.append(line)          # keep the line as-is; never drop data
            continue
        out_lines.append(json.dumps(line_transform(row), ensure_ascii=False))
    new.parent.mkdir(parents=True, exist_ok=True)
    text = "\n".join(out_lines)
    new.write_text(text + ("\n" if text else ""), encoding="utf-8")
    if new.resolve() != old.resolve():
        old.unlink()
        note_removed(old)
    msg = f"moved+rewrote {relpath(old)} -> {relpath(new)}"
    if bad:
        msg += f" ({bad} line(s) not valid JSON, kept as-is)"
    log("done", msg)


def rewrite_text(path: Path, transforms, label):
    """transforms: list of (name, fn: str -> str), applied in order. Only
    backs up and writes if the result actually differs -- which is what makes
    re-running this a no-op on an already-migrated file."""
    if not path.exists():
        log("skipped", f"{label}: {relpath(path)} not present")
        return
    original = path.read_text(encoding="utf-8")
    text = original
    for _name, fn in transforms:
        text = fn(text)
    if text == original:
        log("skipped", f"{label}: nothing to change in {relpath(path)}")
        return
    if DRY_RUN:
        log("done", f"[dry-run] would rewrite {relpath(path)}")
        return
    backup(path)
    path.write_text(text, encoding="utf-8")
    log("done", f"rewrote {relpath(path)}")


def remap_look(look):
    if not isinstance(look, dict):
        return look
    return {LOOK_AXIS_MAP.get(k, k): v for k, v in look.items()}


def remap_id_list(value, id_map, no_op_tokens):
    """A comma-separated id list (flow `connections:`/`skills:`), each id
    mapped through id_map -- except tokens that mean "no connection", which
    travel through unchanged."""
    if not value:
        return value
    parts = [p.strip() for p in value.split(",")]
    out = []
    for p in parts:
        if not p:
            continue
        out.append(p if p.lower() in no_op_tokens else id_map.get(p, p))
    return ", ".join(out)


def _sub(pattern, repl):
    def fn(text, _p=pattern, _r=repl):
        return text.replace(_p, _r)
    return fn


# ── A. agent root: secrets.env + politica/ -> policy/ ───────────────────────

move(ROOT / "secretos.env", ROOT / "secrets.env", "secrets file")

# politica/ -> policy/, item by item. The parent folder is cleaned up at the
# very end of this section, once everything named below has moved out of it
# -- never renamed wholesale up front, so a partially-completed earlier run
# (some items already at their new home, some not) resumes cleanly instead of
# erroring on a directory that no longer exists where expected.
OLD_POLICY = ROOT / "politica"
NEW_POLICY = ROOT / "policy"


def _policy_json_transform(data):
    if not isinstance(data, dict):
        return data
    out = {}
    for conn_id, perms in data.items():
        new_id = CONNECTION_ID_MAP.get(conn_id, conn_id)
        if isinstance(perms, dict):
            perms = {
                ("read" if k == "leer" else "act" if k == "actuar" else k): v
                for k, v in perms.items()
            }
        out[new_id] = perms
    return out


move_and_rewrite_json(
    OLD_POLICY / "politica.json", NEW_POLICY / "policy.json",
    _policy_json_transform, "policy.json")

# install.sh rewrites this file on the next install; just relocate it.
move(OLD_POLICY / "capacidades" / "catalogo.json",
     NEW_POLICY / "capabilities" / "catalog.json", "capabilities catalog")


def _capabilities_requests_transform(row):
    out = {}
    for k, v in row.items():
        new_k = {"fecha": "date", "agente": "agent", "origen": "source",
                  "texto": "text"}.get(k, k)
        if new_k == "source":
            v = {"cliente": "client", "mencion": "mention"}.get(v, v)
        elif new_k == "id" and isinstance(v, str):
            v = CAPABILITY_ID_MAP.get(v, v)
        out[new_k] = v
    return out


move_and_rewrite_jsonl(
    OLD_POLICY / "capacidades" / "pedidos.jsonl",
    NEW_POLICY / "capabilities" / "requests.jsonl",
    _capabilities_requests_transform, "capabilities requests log")

# ours and closed, the client never writes it; just relocate it.
move(OLD_POLICY / "roles" / "catalogo.json",
     NEW_POLICY / "roles" / "catalog.json", "roles roster")


def _role_identities_transform(data):
    if not isinstance(data, dict):
        return data
    out = {}
    for role_id, entry in data.items():
        new_role_id = ROLE_ID_MAP.get(role_id, role_id)
        if isinstance(entry, dict):
            entry = {
                {"nombre": "name", "pinta": "look", "bautizado_en": "named_at"}.get(k, k): v
                for k, v in entry.items()
            }
            if "look" in entry:
                entry["look"] = remap_look(entry["look"])
        out[new_role_id] = entry
    return out


move_and_rewrite_json(
    OLD_POLICY / "roles" / "identidades.json",
    NEW_POLICY / "roles" / "identities.json",
    _role_identities_transform, "role identities")


def _role_requests_transform(row):
    out = {}
    for k, v in row.items():
        new_k = {
            "evento": "event", "rol": "role", "nombre": "name", "pinta": "look",
            "pedido_en": "requested_at", "atendido_en": "hired_at",
            "cancelado_en": "cancelled_at", "agente": "agent",
            "capacidades": "capabilities",
        }.get(k, k)
        if new_k == "event":
            v = EVENT_MAP.get(v, v)
        elif new_k == "role":
            v = ROLE_ID_MAP.get(v, v)
        elif new_k == "look":
            v = remap_look(v)
        elif new_k == "capabilities" and isinstance(v, list):
            v = [CAPABILITY_ID_MAP.get(i, i) if isinstance(i, str) else i for i in v]
        out[new_k] = v
    return out


move_and_rewrite_jsonl(
    OLD_POLICY / "roles" / "pedidos.jsonl",
    NEW_POLICY / "roles" / "requests.jsonl",
    _role_requests_transform, "role requests log")

move(OLD_POLICY / "salas", NEW_POLICY / "rooms", "chat rooms")


def _notice_transform(data):
    if not isinstance(data, dict):
        return data
    key_map = {"hasta": "until", "veda": "restriction"}
    return {key_map.get(k, k): v for k, v in data.items()}


move_and_rewrite_json(
    OLD_POLICY / "avisos" / "en-curso.json",
    NEW_POLICY / "notices" / "in-progress.json",
    _notice_transform, "in-progress notice")

# Renamed FIRST, at their OLD location, and the containing directory moved
# whole right after. That order is what keeps --dry-run's plan correct (a
# dry run never performs the parent move, so a step checking for the file at
# its NEW parent would wrongly report "not present"), and it also means an
# extra hook or plugin this script doesn't know the name of still travels
# with its directory instead of being abandoned in politica/.
move(OLD_POLICY / "hooks" / "puerta.py", OLD_POLICY / "hooks" / "gate.py", "policy gate hook (rename)")
move(OLD_POLICY / "hooks", NEW_POLICY / "hooks", "policy hooks directory")
move(OLD_POLICY / "plugins" / "promesas" / "promesas.py",
     OLD_POLICY / "plugins" / "promesas" / "promises.py", "promises plugin module (rename)")
move(OLD_POLICY / "plugins" / "promesas", OLD_POLICY / "plugins" / "promises", "promises plugin (rename)")
move(OLD_POLICY / "plugins", NEW_POLICY / "plugins", "policy plugins directory")
move(OLD_POLICY / "guardia.py", NEW_POLICY / "guard.py", "MCP guard")
move(OLD_POLICY / "parche-pairing.py", NEW_POLICY / "pairing-patch.py", "pairing patch")
move(OLD_POLICY / "cont-init-parches.sh", NEW_POLICY / "cont-init-patches.sh", "cont-init script")
# tools/ and mcp/ keep their names -- install.sh refreshes the kit-owned
# files inside on the next install; this only moves the parent.
move(OLD_POLICY / "tools", NEW_POLICY / "tools", "connection permission schemas")
move(OLD_POLICY / "mcp", NEW_POLICY / "mcp", "connection MCP servers")

# Whatever's left of politica/ once every named sub-path above has moved out.
# Checked by top-level sub-path name, not by "is anything still physically
# there": in --dry-run nothing actually moved, so a physical check would
# (wrongly) call every known, already-planned file an unknown leftover.
HANDLED_POLICY_SUBPATHS = {
    "politica.json", "capacidades", "roles", "salas", "avisos",
    "hooks", "plugins", "guardia.py", "parche-pairing.py",
    "cont-init-parches.sh", "tools", "mcp",
}
if OLD_POLICY.exists():
    unknown = [
        p for p in OLD_POLICY.rglob("*")
        if p.is_file() and p.relative_to(OLD_POLICY).parts[0] not in HANDLED_POLICY_SUBPATHS
    ]
    if unknown:
        log("manual", f"{relpath(OLD_POLICY)} has {len(unknown)} file(s) this script doesn't "
                       "know about -- move them into policy/ by hand: "
                       + ", ".join(relpath(p) for p in unknown[:10]))
    elif DRY_RUN:
        log("done", f"[dry-run] would remove the now-empty {relpath(OLD_POLICY)}")
    else:
        shutil.rmtree(OLD_POLICY, ignore_errors=True)
        note_removed(OLD_POLICY)
        log("done", f"removed empty leftover directory {relpath(OLD_POLICY)}")
else:
    log("skipped", f"policy migration: {relpath(OLD_POLICY)} not present")

move(ROOT / ".kit-instalado", ROOT / ".kit-installed", "kit manifest")
move(ROOT / ".kit-instalado.nuevo", ROOT / ".kit-installed.new", "kit manifest (staged)")
move(ROOT / "skills-reemplazadas", ROOT / "shadowed-skills", "shadowed skills")
move(ROOT / "respaldos", ROOT / "backups", "backups directory")
# D6 also names these two. Not expected on a solo agent -- both live in the
# KIT repo today (install-soul.sh, skills-knob.py), never per-agent -- but a
# hand-copied one is possible, so it's covered the same way, guarded.
move(ROOT / "respaldos-soul", ROOT / "soul-backups", "SOUL backups directory")
move(ROOT / "respaldos-config", ROOT / "config-backups", "config backups directory")

# ── B. docker-compose.yml (agent root) ──────────────────────────────────────

rewrite_text(ROOT / "docker-compose.yml", [
    ("./politica -> ./policy", _sub("./politica", "./policy")),
    ("cont-init script name", _sub("cont-init-parches.sh", "cont-init-patches.sh")),
    ("03-parches -> 03-patches", _sub("03-parches", "03-patches")),
    ("secretos.env -> secrets.env", _sub("./secretos.env", "./secrets.env")),
    ("${CLIENTE} -> ${CLIENT}", _sub("${CLIENTE}", "${CLIENT}")),
    ("PORTAL_POLITICA_DIR key", _sub("PORTAL_POLITICA_DIR", "PORTAL_POLICY_DIR")),
    ("litellm-costo.py -> litellm-cost.py", _sub("litellm-costo.py", "litellm-cost.py")),
    ("MODELO_DEL_AGENTE -> AGENT_MODEL", _sub("MODELO_DEL_AGENTE", "AGENT_MODEL")),
    ("MODELO= -> MODEL=", _sub("MODELO=", "MODEL=")),
    ("${MODELO: -> ${MODEL:", _sub("${MODELO:", "${MODEL:")),
    ("desconocido -> unknown", _sub(":-desconocido}", ":-unknown}")),
], "docker-compose.yml")

# Optional observability overlay files -- only touched if this agent has
# them (most don't; see compose/docker-compose.observability.yml's own notes
# on why it's opt-in).
move(ROOT / "docker-compose.observabilidad.yml", ROOT / "docker-compose.observability.yml",
     "observability compose overlay")
move(ROOT / "litellm-costo.py", ROOT / "litellm-cost.py", "litellm cost callback")
rewrite_text(ROOT / "litellm.yaml", [
    ("callback name", _sub("litellm-costo.registro_de_costo", "litellm-cost.cost_logger")),
], "litellm.yaml")
rewrite_text(ROOT / "docker-compose.observability.yml", [
    ("litellm-costo.py -> litellm-cost.py", _sub("litellm-costo.py", "litellm-cost.py")),
    ("MODELO_DEL_AGENTE -> AGENT_MODEL", _sub("MODELO_DEL_AGENTE", "AGENT_MODEL")),
    ("MODELO= -> MODEL=", _sub("MODELO=", "MODEL=")),
    ("desconocido -> unknown", _sub(":-desconocido}", ":-unknown}")),
], "docker-compose.observability.yml")

# ── C. .env (remote agents only) ────────────────────────────────────────────

ENV_KEY_MAP = {
    "CLIENTE": "CLIENT", "DOMINIO_API": "API_DOMAIN", "DOMINIO_PORTAL": "PORTAL_DOMAIN",
    "PUERTO_GATEWAY": "GATEWAY_PORT", "PUERTO_ADAPTER": "ADAPTER_PORT",
    "MODELO_DEL_AGENTE": "AGENT_MODEL", "PORTAL_POLITICA_DIR": "PORTAL_POLICY_DIR",
}
ENV_LINE_RE = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*)=(.*)$")


def _rewrite_env_keys(text):
    out = []
    for line in text.splitlines():
        m = ENV_LINE_RE.match(line)
        if not m:
            out.append(line)
            continue
        key, value = m.groups()
        new_key = ENV_KEY_MAP.get(key, key)
        if key == "PORTAL_POLITICA_DIR":
            value = value.replace("/opt/politica", "/opt/policy")
        out.append(f"{new_key}={value}")
    return "\n".join(out) + ("\n" if text.endswith("\n") else "")


rewrite_text(ROOT / ".env", [("env keys", _rewrite_env_keys)], ".env")

# ── D. Caddyfile (remote agents only) ───────────────────────────────────────

rewrite_text(ROOT / "Caddyfile", [
    ("{$DOMINIO_API} -> {$API_DOMAIN}", _sub("{$DOMINIO_API}", "{$API_DOMAIN}")),
    ("{$DOMINIO_PORTAL} -> {$PORTAL_DOMAIN}", _sub("{$DOMINIO_PORTAL}", "{$PORTAL_DOMAIN}")),
    ("acceso-api.log -> access-api.log", _sub("acceso-api.log", "access-api.log")),
    ("acceso-portal.log -> access-portal.log", _sub("acceso-portal.log", "access-portal.log")),
], "Caddyfile")

# ── E. data/ ─────────────────────────────────────────────────────────────────

DATA = ROOT / "data"


def _identity_transform(data):
    if not isinstance(data, dict):
        return data
    out = {}
    for k, v in data.items():
        if k == "nombre":
            out["name"] = v
        elif k == "empresa":
            out["company"] = v
        elif k == "contacto":
            if isinstance(v, dict):
                channel = v.get("canal")
                out["contact"] = {
                    "channel": NOTIFY_CHANNEL_MAP.get(channel, channel),
                    "value": v.get("valor"),
                }
            else:
                out["contact"] = v
        elif k == "look":
            out["look"] = remap_look(v)
        else:
            out[k] = v
    return out


move_and_rewrite_json(DATA / "portal_identidad.json", DATA / "portal_identity.json",
                       _identity_transform, "portal identity")

# install.sh's copy wins on the next install; just relocate it.
move(DATA / "connections" / "catalogo.json", DATA / "connections" / "catalog.json",
     "connections catalog")


def _required_transform(data):
    if isinstance(data, list):
        return [CONNECTION_ID_MAP.get(i, i) if isinstance(i, str) else i for i in data]
    return data


move_and_rewrite_json(DATA / "connections" / "requeridas.json",
                       DATA / "connections" / "required.json",
                       _required_transform, "required connections")

move(DATA / "google_oauth_portal.json", DATA / "google_oauth_pending.json", "pending Google OAuth")


def _costs_transform(row):
    key_map = {"modelo": "model", "entrada": "input_tokens", "salida": "output_tokens",
               "costo_usd": "cost_usd", "origen": "source"}
    return {key_map.get(k, k): v for k, v in row.items()}


move_and_rewrite_jsonl(DATA / "costos.jsonl", DATA / "costs.jsonl", _costs_transform, "cost log")

# -- flows: data/flujos/<slug>/FLUJO.md -> data/flows/<slug>/FLOW.md. Slugs
#    are client-visible (shown at /app/flows/<slug>) and stay exactly as-is;
#    only the frontmatter keys/enum values change, the body never does.

FRONT_LINE_RE = re.compile(r"^([a-z_]+):\s*(.*)$")


def _split_quoted(raw):
    raw = raw.rstrip("\r")
    if len(raw) >= 2 and raw[0] == raw[-1] and raw[0] in "\"'":
        return raw[0], raw[1:-1]
    return "", raw


def _join_quoted(quote, value):
    return f"{quote}{value}{quote}" if quote else value


def _transform_flow_frontmatter_line(key, value):
    new_key = FLOW_KEY_MAP.get(key, key)
    if new_key == "trigger_type":
        value = TRIGGER_TYPE_MAP.get(value, value)
    elif new_key == "status":
        value = FLOW_STATUS_MAP.get(value, value)
    elif new_key == "connections":
        value = remap_id_list(value, CONNECTION_ID_MAP, NO_CONNECTION_TOKENS)
    elif key == "skills":                    # the key was already English
        value = remap_id_list(value, SKILL_ID_MAP, set())
    return new_key, value


def _rewrite_flow_frontmatter(text):
    lines = text.split("\n")
    if not lines or lines[0].strip() != "---":
        return text
    end = None
    for idx in range(1, len(lines)):
        if lines[idx].strip() == "---":
            end = idx
            break
    if end is None:
        return text
    for idx in range(1, end):
        m = FRONT_LINE_RE.match(lines[idx])
        if not m:
            continue
        key, raw_value = m.groups()
        quote, value = _split_quoted(raw_value)
        new_key, new_value = _transform_flow_frontmatter_line(key, value)
        lines[idx] = f"{new_key}: {_join_quoted(quote, new_value)}"
    return "\n".join(lines)


OLD_FLOWS = DATA / "flujos"
NEW_FLOWS = DATA / "flows"
if OLD_FLOWS.is_dir():
    for slug_dir in sorted(p for p in OLD_FLOWS.iterdir() if p.is_dir()):
        old_def = slug_dir / "FLUJO.md"
        if not old_def.is_file():
            log("manual", f"data/flujos/{slug_dir.name} has no FLUJO.md -- left as-is, check by hand")
            continue
        new_def = NEW_FLOWS / slug_dir.name / "FLOW.md"
        label = f"flow {slug_dir.name}"
        if DRY_RUN:
            log("done", f"[dry-run] would move+rewrite data/flujos/{slug_dir.name}/FLUJO.md -> "
                         f"data/flows/{slug_dir.name}/FLOW.md")
            continue
        backup(old_def)
        text = old_def.read_text(encoding="utf-8")
        new_text = _rewrite_flow_frontmatter(text)
        new_def.parent.mkdir(parents=True, exist_ok=True)
        new_def.write_text(new_text, encoding="utf-8")
        old_def.unlink()
        # any other file the flow's own folder carried (rare) travels too --
        # never lost, even though this script doesn't know its name.
        for sibling in list(slug_dir.iterdir()):
            target = new_def.parent / sibling.name
            if not target.exists():
                shutil.move(str(sibling), str(target))
        try:
            slug_dir.rmdir()
        except OSError:
            pass
        log("done", f"moved+rewrote {label}: FLUJO.md -> flows/{slug_dir.name}/FLOW.md")
    if not DRY_RUN:
        try:
            OLD_FLOWS.rmdir()
            note_removed(OLD_FLOWS)
        except OSError:
            log("manual", f"{relpath(OLD_FLOWS)} is not empty after migrating its flows -- check by hand")
else:
    log("skipped", f"flows: {relpath(OLD_FLOWS)} not present")

# -- SOUL.md: only the portal:identity marker changes, nothing else --
rewrite_text(DATA / "SOUL.md", [
    ("identity marker (open)", _sub("<!-- portal:identidad -->", "<!-- portal:identity -->")),
    ("identity marker (close)", _sub("<!-- /portal:identidad -->", "<!-- /portal:identity -->")),
], "SOUL.md")

# -- config.yaml: line-based edits only, no YAML parser (see the module note) --

_PROMISES_ITEM_RE = re.compile(r"^(\s*-\s*)promesas(\s*)$", re.MULTILINE)
_PROMISES_INLINE_RE = re.compile(r"\[\s*promesas\s*\]")


def _rewrite_promises_plugin(text):
    text = _PROMISES_ITEM_RE.sub(r"\1promises\2", text)
    text = _PROMISES_INLINE_RE.sub("[promises]", text)
    return text


rewrite_text(DATA / "config.yaml", [
    ("hook command path", _sub("/opt/politica/hooks/puerta.py", "/opt/policy/hooks/gate.py")),
    ("promises plugin name", _rewrite_promises_plugin),
    ("kit:excepcion marker", _sub("kit:excepcion", "kit:exception")),
    ("any remaining /opt/politica", _sub("/opt/politica", "/opt/policy")),
], "config.yaml")

# -- deliverables: data/workspace/entregables/**/*.md frontmatter. The folder
#    name ("entregables") and every file name stay put -- client-visible, and
#    the portal's files tab and portal-check.py both read them at that path.

_DELIVERABLE_FRONT_RE = re.compile(r"^([a-z_]+):\s*(.*)$")


def _rewrite_deliverable_frontmatter(text):
    lines = text.split("\n")
    if not lines or lines[0].strip() != "---":
        return text
    end = None
    for idx in range(1, len(lines)):
        if lines[idx].strip() == "---":
            end = idx
            break
    if end is None:
        return text
    for idx in range(1, end):
        m = _DELIVERABLE_FRONT_RE.match(lines[idx])
        if not m:
            continue
        key, value = m.groups()
        lines[idx] = f"{DELIVERABLE_KEY_MAP.get(key, key)}: {value}"
    return "\n".join(lines)


deliverables_root = DATA / "workspace" / "entregables"
if deliverables_root.is_dir():
    for md in sorted(deliverables_root.rglob("*.md")):
        rewrite_text(md, [
            ("deliverable frontmatter", _rewrite_deliverable_frontmatter),
        ], f"deliverable {relpath(md)}")
else:
    log("skipped", f"deliverables: {relpath(deliverables_root)} not present")

# -- profiles: data/profiles/<old-role-id>/ -> <new-role-id>/, + role.json.
#    This only renames what's on disk; it never touches the Hermes engine's
#    own profile registry (see hire-role.sh: `hermes profile install/update`),
#    which this script does not call -- that's a manual step, printed below,
#    not guessed at.

PROFILES_DIR = DATA / "profiles"
migrated_profiles = []
if PROFILES_DIR.is_dir():
    for old_id, new_id in ROLE_ID_MAP.items():
        old_profile = PROFILES_DIR / old_id
        if not old_profile.exists():
            log("skipped", f"profile {old_id}: {relpath(old_profile)} not present")
            continue
        new_profile = PROFILES_DIR / new_id
        if move(old_profile, new_profile, f"profile directory ({old_id} -> {new_id})"):
            migrated_profiles.append((old_id, new_id))
            role_json = new_profile / "role.json"

            def _role_json_transform(data, _new_id=new_id):
                if not isinstance(data, dict):
                    return data
                if "id" in data:
                    data["id"] = _new_id
                identity = data.get("identity")
                if isinstance(identity, dict) and "look" in identity:
                    identity["look"] = remap_look(identity["look"])
                return data

            if role_json.exists() and not DRY_RUN:
                backup(role_json)
                try:
                    payload = json.loads(role_json.read_text(encoding="utf-8"))
                except ValueError as exc:
                    log("manual", f"{relpath(role_json)} is not valid JSON ({exc}) -- left untouched")
                else:
                    role_json.write_text(
                        json.dumps(_role_json_transform(payload), ensure_ascii=False, indent=2) + "\n",
                        encoding="utf-8")
                    log("done", f"rewrote id/look in {relpath(role_json)}")
            elif role_json.exists():
                log("done", f"[dry-run] would rewrite id/look in {relpath(role_json)}")
else:
    log("skipped", f"profiles: {relpath(PROFILES_DIR)} not present")

if migrated_profiles:
    names = ", ".join(f"{o}->{n}" for o, n in migrated_profiles)
    log("manual",
        "hired-role profiles were renamed on disk (" + names + "), but the Hermes engine's "
        "own profile registry (`hermes profile list`) still knows them by their OLD id -- this "
        "script does not call the Hermes CLI. Reconcile it by hand once the containers are back "
        "up, e.g. `hermes profile update <new-id> -y` inside the hermes container for each "
        "renamed role (see hire-role.sh), and confirm with `hermes profile list`.")

for old_id in ROLE_ID_MAP:
    for cfg_name in ("data/config.yaml", "docker-compose.yml"):
        cfg_path = ROOT / cfg_name
        if not cfg_path.exists():
            continue
        text = cfg_path.read_text(encoding="utf-8")
        if re.search(rf"\b{re.escape(old_id)}\b", text):
            log("manual", f"{cfg_name} still mentions '{old_id}' -- check by hand whether that's "
                           f"a profile reference that needs updating to '{ROLE_ID_MAP[old_id]}'")

# ── F. reported, never touched: leftover kit skills in the old name ────────
# clean-obsolete.sh (run by install.sh) is what retires these; this script
# only reports them so nothing silently keeps shadowing the kit's copy.

OLD_SKILL_DIRS = set(SKILL_ID_MAP.keys())
SKIP_DIR_NAMES = {".archive", ".git", ".github", ".hub", "node_modules", "__pycache__", ".venv"}
skills_root = DATA / "skills"
if skills_root.is_dir():
    for dirpath, dirnames, _filenames in os.walk(skills_root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIR_NAMES]
        for d in list(dirnames):
            if d in OLD_SKILL_DIRS:
                found = Path(dirpath) / d
                log("manual", f"leftover kit skill in the old name at {relpath(found)} -- "
                               "not deleted, install.sh/clean-obsolete.sh handles it after a fresh install")

# ── bookkeeping (ssh mode's cleanup list) + summary table ───────────────────

if not DRY_RUN and removed_paths:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    (BACKUP_DIR / "removed-paths.txt").write_text(
        "\n".join(sorted(set(removed_paths))) + "\n", encoding="utf-8")

LABELS = {"done": "done", "skipped": "skipped-not-present", "manual": "manual-steps"}
ORDER = {"done": 0, "manual": 1, "skipped": 2}
print()
print("=" * 70)
print("WHAT WOULD HAPPEN (--dry-run, nothing was touched)" if DRY_RUN else "MIGRATION SUMMARY")
print("=" * 70)
counts = {"done": 0, "skipped": 0, "manual": 0}
for status, _msg in results:
    counts[status] += 1
for status in sorted(counts, key=lambda s: ORDER[s]):
    print(f"\n-- {LABELS[status]} ({counts[status]}) --")
    for s, msg in results:
        if s == status:
            print(f"  {msg}")
print()
print("-" * 70)
print(f"{'done':22}{counts['done']}")
print(f"{'skipped-not-present':22}{counts['skipped']}")
print(f"{'manual-steps':22}{counts['manual']}")
print("-" * 70)
if not DRY_RUN and counts["done"] == 0:
    print("Nothing to migrate: this agent already has the new layout.")
if not DRY_RUN and any_backed_up:
    print(f"\nBackups of every rewritten file: {relpath(BACKUP_DIR)}")
if counts["manual"]:
    print(f"\n{counts['manual']} item(s) need a human -- see manual-steps above.")
PYEOF
}

if [[ "$MODE" == local ]]; then
  run_engine "$DIR" "$DRY_RUN"
else
  STAGING="$(mktemp -d)"
  trap 'rm -rf "$STAGING"' EXIT

  if (( DRY_RUN )); then
    echo "→ dry run: downloading a read-only copy from $HOST:$DIR to preview against"
    echo "  (nothing on $HOST gets touched)"
    rsync -a "$HOST:$DIR/" "$STAGING/"
    run_engine "$STAGING" 1
    exit 0
  fi

  echo "→ staging a local copy of $HOST:$DIR (migrated offline, then synced back)"
  rsync -a "$HOST:$DIR/" "$STAGING/"
  run_engine "$STAGING" 0
  echo
  echo "→ uploading the migrated layout to $HOST"
  rsync -a "$STAGING/" "$HOST:$DIR/"
  REMOVED_LIST="$(ls "$STAGING"/backups/migrate-to-english-*/removed-paths.txt 2>/dev/null | head -1 || true)"
  if [[ -n "$REMOVED_LIST" ]]; then
    echo "→ removing the old-named paths on $HOST that this run retired"
    while IFS= read -r rel; do
      [[ -n "$rel" ]] || continue
      ssh "$HOST" "rm -rf -- '$DIR/$rel'"
      echo "   removed $rel"
    done < "$REMOVED_LIST"
  fi
fi

if (( DRY_RUN )); then
  exit 0
fi

cat <<DONE

Migration done. This script never touches the containers -- run these next,
in order:

  1. A fresh start, not a restart (mounts changed -- e.g. ./politica is now
     ./policy, ./secretos.env is now ./secrets.env -- and 'restart' keeps the
     OLD bind mounts):
       docker compose up -d
DONE
if [[ "$MODE" == local ]]; then
  cat <<DONE
  2. Reinstall SOUL v13 (the inline chip syntax changed -- capability:<id>
     etc. -- and this agent is still on an older block). install-soul.sh is
     ssh-only, so for a local agent root do its --replace recipe by hand:
       python3 tools/install-soul.sh --block > /tmp/v13-block.md
       python3 tools/replace-block.py $DIR/data/SOUL.md /tmp/v13-block.md > /tmp/soul-new.md
       mv /tmp/soul-new.md $DIR/data/SOUL.md
     (add --rescue to replace-block.py if it reports hand-written text inside
     the old block; see install-soul.sh's own --replace path for the same
     recipe over ssh)
  3. python3 tools/agent-check.py $DIR/data
  4. python3 tools/portal-check.py --key <API_SERVER_KEY> \\
       --endpoint http://127.0.0.1:<gateway-port> --adapter http://127.0.0.1:<adapter-port>
     0 failures or it doesn't ship.
DONE
else
  cat <<DONE
  2. Reinstall SOUL v13 (the inline chip syntax changed -- capability:<id>
     etc. -- and this agent is still on an older block):
       ./tools/install-soul.sh --replace $HOST${SLUG:+ $SLUG}
  3. rsync -a $HOST:$DIR/data/ /tmp/${SLUG:-agent}-data/ && python3 tools/agent-check.py /tmp/${SLUG:-agent}-data
  4. python3 tools/portal-check.py --key <API_SERVER_KEY> \\
       --endpoint https://<api-domain> --adapter https://<portal-domain>
     0 failures or it doesn't ship.
DONE
fi
