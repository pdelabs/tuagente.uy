#!/usr/bin/env bash
# A run that stops at the approval gate did NOT finish.
#
# The regression this test exists for: the scheduler wrote `ok` the moment
# `run_turn` returned, gate or no gate, so the card went green, `/api/jobs`
# said the last run went well and Activity said «Terminé el flujo» while the
# mail sat in Aprobaciones waiting for the client.
#
#     ./tests/test_flow_gate.sh          ~2 minutes, ~US$0.01
#
# Runs against the LIVE container. It writes one flow whose body sends an email
# (the `approval` plugin gates `send_email`), presses run-now and follows the
# row:
#
#   a. the run stops: the row reads `paused` and `/api/jobs.last_status` too
#   b. the client approves and the row closes `ok`, with the file in outbox
#
# The only Spanish is what the agent and the client read.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KEY="$(grep '^API_SERVER_KEY=' "$ROOT/secrets.env" | cut -d= -f2-)"
ENDPOINT="${ENDPOINT:-http://127.0.0.1:8642}"
ADAPTER="${ADAPTER:-http://127.0.0.1:8643}"
CONTAINER="${CONTAINER:-tuagente-core}"
SLUG="prueba-de-la-puerta"
NAME="Prueba de la puerta"
FLOW_DIR="$ROOT/workspace/flows/$SLUG"
JOB="flujo-$SLUG"
FAILURES=0

# Generous: approving waits for a whole model turn.
api() { curl -s --max-time 300 -H "Authorization: Bearer $KEY" "$@"; }
post() { api -X POST -H 'Content-Type: application/json' -d "$2" "$1"; }
ok()  { printf 'PASS  %s\n' "$1"; }
bad() { printf 'FAIL  %s\n' "$1"; FAILURES=$((FAILURES + 1)); }
step() { printf '\n-- %s\n' "$1"; }
assert() { [ "$1" = "$2" ] && ok "$3" || bad "$3 (wanted '$2', got '$1')"; }

# The rows, read straight out of SQLite: `/api/jobs` publishes the last one and
# this test is about the one it claimed.
#
# FROM INSIDE THE CONTAINER, ALWAYS. `state/` is a bind mount, and on Docker
# Desktop the host and the container do not share SQLite's shared-memory index:
# a second connection opened on the host reads a stale snapshot of a WAL
# database, and a host-side WRITE while the engine holds it open corrupts it —
# measured on this lab on 14/09, `integrity_check` answering "Rowid out of
# order" and a whole run of rows that the engine could see and nothing else
# could. One writer, one side.
sql() {
  docker exec "$CONTAINER" python3 -c '
import json, sqlite3, sys
db = sqlite3.connect("/state/core.db")
db.row_factory = sqlite3.Row
print(json.dumps([dict(r) for r in db.execute(sys.argv[1], sys.argv[2:])], default=str))
' "$@"
}
runs() { sql "SELECT * FROM flow_runs WHERE slug = ? ORDER BY scheduled_at" "$SLUG"; }
status() { runs | jq -r '.[-1].status // "none"'; }
session_of() { runs | jq -r '.[-1].session_id // ""'; }
pending_ids() { api "$ADAPTER/portal/approvals" | jq -r '.approvals[].id' | sort; }

wait_status() {  # <status> <seconds>
  local want=$1 limit=$2 waited=0
  while [ "$waited" -lt "$limit" ]; do
    [ "$(status)" = "$want" ] && return 0
    sleep 3; waited=$((waited + 3))
  done
  return 1
}

cleanup() {
  step "cleanup"
  rm -rf "$FLOW_DIR"
  docker exec "$CONTAINER" python3 -c '
import sqlite3, sys
db = sqlite3.connect("/state/core.db")
ids = [r[0] for r in db.execute("SELECT session_id FROM flow_runs WHERE slug = ?", (sys.argv[1],))]
db.execute("DELETE FROM flow_runs WHERE slug = ?", (sys.argv[1],))
# The request this run left in the queue goes out with it: the test asked for
# it, so closing the card is not the job of whoever opens Aprobaciones next.
holes = ",".join("?" * len(ids))
approvals = [r[0] for r in db.execute(
    f"SELECT id FROM approvals WHERE session_id IN ({holes})", ids)] if ids else []
db.executemany("DELETE FROM approval_comments WHERE approval_id = ?", [(a,) for a in approvals])
db.executemany("DELETE FROM approvals WHERE id = ?", [(a,) for a in approvals])
for table in ("messages", "history", "sessions"):
    db.executemany(f"DELETE FROM {table} WHERE "
                   + ("id" if table == "sessions" else "session_id") + " = ?",
                   [(i,) for i in ids])
db.commit()
print(f"took out {len(ids)} run(s), {len(approvals)} request(s) and their conversations")
' "$SLUG"
}
trap cleanup EXIT

step "(a) a flow whose work is a mail, run by hand"
rm -rf "$FLOW_DIR"
mkdir -p "$FLOW_DIR"
# THE CRON IS ONCE A YEAR on purpose: the run is started with the tab's
# run-now button, and the clock must not start a second one while the first
# waits for the client's answer.
cat > "$FLOW_DIR/FLOW.md" <<MD
---
name: $NAME
client_summary: Le aviso por mail a Juan que su pedido está listo para retirar.
trigger: schedule
trigger_detail: Una vez por año
cron: '0 4 1 1 *'
timezone: America/Montevideo
status: active
connections: []
---

1. Mandale un mail a juan@acme.com avisando que el pedido de 20 bisagras está
   listo para retirar, de lunes a viernes de 9 a 18.
2. No hagas nada más.

## Notas técnicas

- Una sola llamada a \`send_email\`. No leas ni listes archivos.
MD
before="$(pending_ids)"
mark="$(mktemp)"
sleep 1
assert "$(api -X POST "$ENDPOINT/api/jobs/$JOB/run" | jq -r '.job.id')" "$JOB" \
  "run-now answered"

step "(b) the run stops at the gate instead of finishing"
wait_status paused 180 || bad "the run did not reach 'paused' in three minutes (it reads '$(status)')"
assert "$(status)" "paused" "the row reads paused"
assert "$(runs | jq -r '.[-1].finished_at // "null"')" "null" "and it has no finish time"
assert "$(api "$ENDPOINT/api/jobs" | jq -r --arg j "$JOB" \
  '.jobs[] | select(.id == $j) | .last_status')" "paused" \
  "the task publishes the last run as paused"
assert "$(api "$ENDPOINT/api/jobs" | jq -r --arg j "$JOB" \
  '.jobs[] | select(.id == $j) | .state')" "scheduled" \
  "and the task's own state is untouched: the client did not pause the flow"
assert "$(api "$ADAPTER/portal/flows" | jq -r --arg s "$SLUG" \
  '.flows[] | select(.slug == $s) | .last_run.status')" "paused" \
  "the tab reads the last run as paused"
api "$ADAPTER/portal/activity" | jq -r '.events[] | select(.kind == "flow.paused") | .label' \
  | grep -q "Pausé el flujo «${NAME}»" \
  && ok "Activity says it paused and not that it finished" \
  || bad "no flow.paused event in Activity"
# By session and not by name: Activity keeps every event of every run this
# lab ever did, and an older run of this same test left a legitimate
# `flow.finished` behind. What has to be empty is THIS run's.
SID="$(session_of)"
assert "$(sql "SELECT kind FROM events WHERE session_id = ? AND kind = ?" "$SID" "flow.finished" \
  | jq 'length')" "0" "nothing says this run finished"

step "(c) the client approves and the run finishes"
new="$(comm -13 <(printf '%s\n' "$before") <(pending_ids))"
ID="$(head -1 <<<"$new")"
[ -n "$ID" ] || { bad "no approval id: nothing else can be checked"; exit 1; }
assert "$(post "$ADAPTER/portal/approvals/$ID/approve" '{}' | jq -r '.ok')" "true" \
  "the approval answered ok"
assert "$(status)" "ok" "the row closed ok"
assert "$(sql "SELECT label FROM events WHERE session_id = ? AND kind = ?" "$SID" "flow.finished" \
  | jq -r '.[0].label // "none"')" "Terminé el flujo «${NAME}»" \
  "and Activity says it finished, now that it did"
assert "$(api "$ENDPOINT/api/jobs" | jq -r --arg j "$JOB" \
  '.jobs[] | select(.id == $j) | .last_status')" "ok" "the task publishes it as ok"
[ "$(runs | jq -r '.[-1].finished_at // "null"')" != "null" ] \
  && ok "and it has a finish time now" || bad "the row has no finish time"
written="$(find "$ROOT/workspace/outbox" -type f -newer "$mark" 2>/dev/null)"
[ -n "$written" ] \
  && ok "the mail landed in outbox: $(basename "$written")" \
  || bad "nothing new landed in outbox"
rm -f "$written" "$mark"

step "(d) result"
printf 'runs: %s\n' "$(runs | jq -c '[.[] | {status, manual}]')"
[ "$FAILURES" -eq 0 ] && printf 'GATE PASS - 0 failures\n' || printf 'GATE FAIL - %s failures\n' "$FAILURES"
exit $((FAILURES > 0))
