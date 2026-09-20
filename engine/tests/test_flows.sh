#!/usr/bin/env bash
# G1 — the clock starts a run, and it cannot start twice.
#
# Runs against the LIVE container and kills it halfway on purpose: a schedule
# that only lives in memory is not a schedule, it is a coincidence. It writes
# one flow with `*/1 * * * *`, brings the container up with
# CORE_FLOWS_MIN_MINUTES=1 (the compose passthrough, the way the compaction
# gate lowers its threshold), and watches the rows.
#
#     ./tests/test_flows.sh          ~9 minutes, ~US$0.005
#
# What it proves, in order:
#   a. one row per tick, one session per row, and the rows land on the minute
#   b. `docker kill` mid-run: the killed run reads `error` after the restart
#   c. the ticks missed while it was down collapse into ONE catch-up run
#   d. pause stops the clock, resume starts it again
#   e. run-now starts a run immediately, and it is marked manual
#
# Every step prints PASS or FAIL; the exit code is 1 if any of them failed. It
# takes the flow and its rows out on the way out and puts the container back on
# the default floor. The only Spanish is what the agent and the client read.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KEY="$(grep '^API_SERVER_KEY=' "$ROOT/secrets.env" | cut -d= -f2-)"
ENDPOINT="${ENDPOINT:-http://127.0.0.1:8642}"
ADAPTER="${ADAPTER:-http://127.0.0.1:8643}"
DB="$ROOT/state/core.db"
SLUG="prueba-del-reloj"
FLOW_DIR="$ROOT/workspace/flows/$SLUG"
OUT_DIR="$ROOT/workspace/flows-test"
JOB="flujo-$SLUG"
FAILURES=0

api() { curl -s --max-time 60 -H "Authorization: Bearer $KEY" "$@"; }
ok()  { printf 'PASS  %s\n' "$1"; }
bad() { printf 'FAIL  %s\n' "$1"; FAILURES=$((FAILURES + 1)); }
step() { printf '\n-- %s\n' "$1"; }
assert() { [ "$1" = "$2" ] && ok "$3" || bad "$3 (wanted '$2', got '$1')"; }

# The rows, read straight out of SQLite: `/api/jobs` publishes the LAST run and
# this test is about how many there are. Read-only, so it can be asked while the
# container is writing — and while it is dead.
sql() {
  python3 -c '
import json, sqlite3, sys
db = sqlite3.connect("file:" + sys.argv[1] + "?mode=ro", uri=True)
db.row_factory = sqlite3.Row
print(json.dumps([dict(r) for r in db.execute(sys.argv[2], sys.argv[3:])], default=str))
' "$DB" "$@"
}
runs() { sql "SELECT * FROM flow_runs WHERE slug = ? ORDER BY scheduled_at" "$SLUG"; }
n_runs() { runs | jq 'length'; }
# Rows for occurrences after a given one: what a catch-up adds.
after() { runs | jq --argjson t "$1" '[.[] | select(.scheduled_at > $t)]'; }

up() {  # bring the container up with the test's floor and wait for it
  (cd "$ROOT" && CORE_FLOWS_MIN_MINUTES="${1:-1}" docker compose up -d >/dev/null 2>&1)
  for _ in $(seq 1 60); do
    api "$ADAPTER/portal/manifest" | grep -q '"adapter_version"' && return 0
    sleep 1
  done
  bad "the container did not come back up"
}

wait_rows() {  # <count> <seconds> — rows claimed
  local want=$1 limit=$2 waited=0
  while [ "$waited" -lt "$limit" ]; do
    [ "$(n_runs)" -ge "$want" ] && return 0
    sleep 3; waited=$((waited + 3))
  done
  return 1
}

n_done() { runs | jq '[.[] | select(.status != "running")] | length'; }
wait_done() {  # <count> <seconds> — rows that have an outcome
  local want=$1 limit=$2 waited=0
  while [ "$waited" -lt "$limit" ]; do
    [ "$(n_done)" -ge "$want" ] && return 0
    sleep 3; waited=$((waited + 3))
  done
  return 1
}

cleanup() {
  step "cleanup"
  # The FLOW.md goes FIRST: `*/1` is illegal under the default floor, and a
  # flow the model cannot validate is one the tab cannot draw.
  rm -rf "$FLOW_DIR" "$OUT_DIR"
  # THE WRITE HAPPENS INSIDE THE CONTAINER. A write from the host while the
  # engine holds the database open corrupted it once ("Rowid out of order"):
  # Docker Desktop does not share SQLite's shm across the bind mount. The
  # read-only reads above stay on the host because they must also work while
  # the container is dead.
  docker exec tuagente-core python3 -c '
import sqlite3, sys
db = sqlite3.connect(sys.argv[1])
ids = [r[0] for r in db.execute("SELECT session_id FROM flow_runs WHERE slug = ?", (sys.argv[2],))]
db.execute("DELETE FROM flow_runs WHERE slug = ?", (sys.argv[2],))
for table in ("messages", "history", "sessions"):
    db.executemany(f"DELETE FROM {table} WHERE "
                   + ("id" if table == "sessions" else "session_id") + " = ?",
                   [(i,) for i in ids])
db.commit()
print(f"took out {len(ids)} run(s) and their conversations")
' /state/core.db "$SLUG"
  up 5
  printf 'the container is back on the default floor\n'
}
trap cleanup EXIT

step "(a) a flow that runs every minute"
rm -rf "$FLOW_DIR" "$OUT_DIR"
mkdir -p "$FLOW_DIR"
cat > "$FLOW_DIR/FLOW.md" <<'MD'
---
name: Prueba del reloj
client_summary: Cada minuto escribo la hora en un archivo, para probar el reloj.
trigger: schedule
trigger_detail: Cada un minuto
cron: '*/1 * * * *'
timezone: America/Montevideo
status: active
connections: []
---

1. Escribí la hora actual en `flows-test/prueba-del-reloj.txt`, pisando lo que haya.
2. No hagas nada más.

## Notas técnicas

- Una sola llamada a `write_file`, con la hora y nada más. No leas ni listes archivos.
MD
up 1
assert "$(api "$ADAPTER/portal/flows" | jq -r --arg s "$SLUG" '.flows[] | select(.slug == $s) | .trigger_type')" \
  "schedule" "the tab lists it as running on the clock"
assert "$(api "$ENDPOINT/api/jobs?include_disabled=true" | jq -r --arg j "$JOB" '.jobs[] | select(.id == $j) | .state')" \
  "scheduled" "it has a scheduled task"
[ "$(api "$ENDPOINT/api/jobs" | jq -r --arg j "$JOB" '.jobs[] | select(.id == $j) | .next_run_at')" != "null" ] \
  && ok "the task says when it runs next" || bad "no next_run_at"

step "(b) one row per tick, one session per row"
wait_done 2 210 || bad "two runs did not finish in three and a half minutes"
first="$(runs | jq '.[0].scheduled_at')"
second="$(runs | jq '.[1].scheduled_at')"
assert "$(python3 -c "print(int($second - $first))")" "60" "the two runs are exactly a minute apart"
assert "$(python3 -c "print(int($first) % 60)")" "0" "the first one landed on the minute"
assert "$(runs | jq '[.[] | select(.status == "ok")] | length')" "2" "both runs finished ok"
assert "$(sql "SELECT id FROM sessions WHERE id IN (SELECT session_id FROM flow_runs WHERE slug = ?)" "$SLUG" | jq 'length')" \
  "2" "each run opened its own conversation"
assert "$(sql "SELECT DISTINCT kind FROM sessions WHERE id IN (SELECT session_id FROM flow_runs WHERE slug = ?)" "$SLUG" | jq -r '.[0].kind')" \
  "flow" "the conversations are of kind flow"
sql "SELECT title FROM sessions WHERE id IN (SELECT session_id FROM flow_runs WHERE slug = ?)" "$SLUG" \
  | jq -r '.[].title' | grep -q '^Prueba del reloj · ' \
  && ok "the conversation is titled with the flow and the time" \
  || bad "no conversation titled after the flow"
api "$ENDPOINT/api/sessions" | jq -r '.data[].title' | grep -q '^Prueba del reloj · ' \
  && bad "a run's conversation is in the chat's list" \
  || ok "a run's conversation is not in the chat's list"
assert "$(api "$ADAPTER/portal/flows/$SLUG" | jq '[.runs[] | select(.session_id != null)] | length')" \
  "2" "the flow's own page is the way into each run's conversation"
[ -f "$OUT_DIR/$SLUG.txt" ] && ok "the flow did its work: $(cat "$OUT_DIR/$SLUG.txt" | head -1)" \
  || bad "nothing landed in flows-test/"
assert "$(api "$ENDPOINT/api/jobs" | jq -r --arg j "$JOB" '.jobs[] | select(.id == $j) | .last_status')" \
  "ok" "the task publishes the last run as ok"

step "(c) docker kill in the middle of a run"
killed=""
for _ in $(seq 1 40); do
  killed="$(runs | jq '[.[] | select(.status == "running")] | .[0].scheduled_at // empty')"
  [ -n "$killed" ] && break
  sleep 2
done
[ -n "$killed" ] || bad "no run was in flight to kill"
docker kill tuagente-core >/dev/null 2>&1 || bad "the container would not die"
before_catchup="$(n_runs)"
# MORE THAN TWO MINUTES, and the number is the assertion below. With a
# minute-by-minute flow, 75 s of downtime misses one turn of the clock or two
# depending on where in the minute it died, and one missed turn cannot tell
# "collapses" from "walks forward one at a time". 135 s misses at least two
# whatever the phase.
sleep 135
up 1
assert "$(runs | jq -r --argjson t "$killed" '.[] | select(.scheduled_at == $t) | .status')" \
  "error" "the killed run reads error after the restart"
runs | jq -r --argjson t "$killed" '.[] | select(.scheduled_at == $t) | .error' | grep -q 'se apagó' \
  && ok "and says the agent was shut down while working" \
  || bad "the error does not say what happened: $(runs | jq -r --argjson t "$killed" '.[] | select(.scheduled_at == $t) | .error')"

step "(d) the ticks it missed collapse into one run"
for _ in $(seq 1 30); do
  [ "$(after "$killed" | jq 'length')" -ge 1 ] && break
  sleep 2
done
catchup="$(after "$killed" | jq '[.[].scheduled_at] | min')"
[ "$catchup" = "null" ] && bad "nothing ran after the restart"
[ "$(python3 -c "print(int($catchup) > int($killed) + 60)")" = "True" ] \
  && ok "the catch-up is the LAST minute it missed, not the first ($(python3 -c "print(int(($catchup - $killed) / 60))") minutes away)" \
  || bad "the catch-up is the first missed minute ($killed -> $catchup): it is walking, not collapsing"
# Race-free: a row that starts later has a bigger scheduled_at, so this counts
# what covered the outage and nothing after it.
assert "$(runs | jq --argjson c "$catchup" '[.[] | select(.scheduled_at <= $c)] | length')" \
  "$((before_catchup + 1))" "one single run covers every minute it was away"

step "(e) pause stops the clock"
assert "$(api -X POST "$ENDPOINT/api/jobs/$JOB/pause" | jq -r '.job.enabled')" "false" \
  "the task comes back disabled"
assert "$(api "$ADAPTER/portal/flows/$SLUG" | jq -r '.status')" "paused" "the flow reads paused"
paused_at="$(n_runs)"
sleep 70
assert "$(n_runs)" "$paused_at" "no run happened while it was paused"

step "(f) resume starts it again"
assert "$(api -X POST "$ENDPOINT/api/jobs/$JOB/resume" | jq -r '.job.state')" "scheduled" \
  "the task comes back scheduled"
wait_rows "$((paused_at + 1))" 90 && ok "it ran again after being resumed" \
  || bad "nothing ran in 90 s after resuming"

step "(g) run now"
was="$(n_runs)"
started="$(date +%s%N)"
api -X POST "$ENDPOINT/api/jobs/$JOB/run" >/dev/null
answered="$(date +%s%N)"
[ "$(( (answered - started) / 1000000 ))" -lt 3000 ] \
  && ok "it answers at once, without waiting for the turn" \
  || bad "the request waited for the run ($(( (answered - started) / 1000000 )) ms)"
wait_rows "$((was + 1))" 30 && ok "a run started right away" || bad "no run started in 30 s"
assert "$(runs | jq '[.[] | select(.manual == 1)] | length')" "1" "and it is marked as asked for by hand"

step "(h) result"
printf 'runs: %s\n' "$(runs | jq -c '[.[] | {scheduled_at, status, manual}]')"
[ "$FAILURES" -eq 0 ] && printf 'G1 PASS - 0 failures\n' || printf 'G1 FAIL - %s failures\n' "$FAILURES"
exit $((FAILURES > 0))
