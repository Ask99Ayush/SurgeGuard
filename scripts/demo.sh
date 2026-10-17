#!/usr/bin/env bash
# The 5-minute SurgeGuard demo:
#   1. k6 surge against the UNPROTECTED endpoint (nginx :8081 -> demo origins directly)
#   2. the identical k6 profile against the PROTECTED endpoint (nginx :8080 -> SurgeGuard)
#   3. protected traffic while demo-2 is stopped and restarted (failover + recovery timing)
#   4. a fairness run (order of admission vs order of joining)
#   5. a side-by-side summary of the measured numbers
#
# Usage: scripts/demo.sh [all|unprotected|protected|failure|fairness|summary]
# Tunables (environment): VUS, RAMP, HOLD, FAIL_AT, RECOVER_AT, FAILURE_VUS, FAIRNESS_VISITORS
# NOTE: resets SurgeGuard queue state in the local Redis before each protected run.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
export MSYS_NO_PATHCONV=1
export K6_UID="$(id -u 2>/dev/null || echo 12345)" K6_GID="$(id -g 2>/dev/null || echo 12345)"

DC=(docker compose)
VUS="${VUS:-300}"
RAMP="${RAMP:-15s}"
HOLD="${HOLD:-60s}"
FAIL_AT="${FAIL_AT:-25}"
RECOVER_AT="${RECOVER_AT:-55}"
FAILURE_VUS="${FAILURE_VUS:-150}"
FAILURE_DURATION="${FAILURE_DURATION:-85}"
FAIRNESS_VISITORS="${FAIRNESS_VISITORS:-120}"
PREFIX="$(grep -E '^REDIS_KEY_PREFIX=' .env | cut -d= -f2- || true)"
PREFIX="${PREFIX:-sg}"
RESULTS="loadtest/results"

step() { printf '\n\033[1;31m▌\033[0m \033[1m%s\033[0m\n' "$*"; }

k6() {
  "${DC[@]}" --profile loadtest run --rm -T k6 "$@"
}

redis_cli() {
  "${DC[@]}" exec -T redis sh -c 'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli "$@"' redis-cli "$@"
}

reset_queue() {
  # Removes queue/visitor state only (not the event log, metrics or configuration).
  "${DC[@]}" exec -T redis sh -c '
    export REDISCLI_AUTH="$REDIS_PASSWORD"
    for pattern in "$1:v:*" "$1:queue" "$1:hb" "$1:admitted" "$1:idx:*" "$1:admit_log" "$1:bucket" "$1:rl:*" "$1:revoked:*"; do
      redis-cli --scan --pattern "$pattern" | while read -r key; do redis-cli DEL "$key" >/dev/null; done
    done' reset "$PREFIX"
}

backend_healthy() {
  # Prints true/false/unknown for a backend as seen by the admission worker's active checks.
  local raw
  raw="$(redis_cli HGET "$PREFIX:backends" "$1" 2>/dev/null || true)"
  case "$raw" in
    *'"healthy": true'*) echo true ;;
    *'"healthy": false'*) echo false ;;
    *) echo unknown ;;
  esac
}

now_ms() { date +%s%3N 2>/dev/null || python -c 'import time;print(int(time.time()*1000))'; }

wait_for() {
  # wait_for <backend> <true|false> <timeout_s>; prints elapsed seconds
  local start end
  start="$(now_ms)"
  for _ in $(seq 1 $(( $3 * 4 ))); do
    if [ "$(backend_healthy "$1")" = "$2" ]; then
      end="$(now_ms)"
      awk -v a="$start" -v b="$end" 'BEGIN { printf "%.1f", (b - a) / 1000 }'
      return 0
    fi
    sleep 0.25
  done
  echo "null"
}

run_unprotected() {
  step "1/4  Surge against the UNPROTECTED endpoint ($VUS VUs, ramp $RAMP, hold $HOLD)"
  k6 run --quiet -e TARGET=http://nginx:8081 -e LABEL=unprotected -e VUS="$VUS" -e RAMP="$RAMP" -e HOLD="$HOLD" surge.js
}

run_protected() {
  step "2/4  Identical surge against the PROTECTED endpoint (SurgeGuard)"
  reset_queue
  k6 run --quiet -e TARGET=http://nginx:8080 -e LABEL=protected -e VUS="$VUS" -e RAMP="$RAMP" -e HOLD="$HOLD" surge.js
}

run_failure() {
  step "3/4  Backend failure: demo-2 stopped at ${FAIL_AT}s, restarted at ${RECOVER_AT}s"
  reset_queue
  "${DC[@]}" start demo-2 >/dev/null 2>&1 || true
  k6 run --quiet -e TARGET=http://nginx:8080 -e VUS="$FAILURE_VUS" -e DURATION="$FAILURE_DURATION" \
    -e FAIL_AT="$FAIL_AT" -e RECOVER_AT="$RECOVER_AT" backend-failure.js &
  local k6_pid=$!
  sleep "$FAIL_AT"
  echo "  stopping demo-2"
  "${DC[@]}" kill -s SIGKILL demo-2 >/dev/null
  local down
  down="$(wait_for demo-2 false 30)"
  echo "  worker marked demo-2 down after ${down}s"
  sleep $(( RECOVER_AT - FAIL_AT ))
  echo "  starting demo-2"
  "${DC[@]}" start demo-2 >/dev/null
  local up
  up="$(wait_for demo-2 true 60)"
  echo "  worker marked demo-2 healthy after ${up}s"
  printf '{"detect_down_s": %s, "recover_s": %s, "method": "poll admission-worker health state in Redis every 0.25s"}\n' \
    "$down" "$up" > "$RESULTS/recovery.json"
  wait "$k6_pid"
}

run_fairness() {
  step "4/4  Fairness: $FAIRNESS_VISITORS visitors join in sequence"
  reset_queue
  k6 run --quiet -e TARGET=http://nginx:8080 -e VISITORS="$FAIRNESS_VISITORS" -e JOIN_SPACING_MS=30 queue-fairness.js \
    2> "$RESULTS/fairness.log" || true
  grep -c FAIRNESS "$RESULTS/fairness.log" | xargs -I{} echo "  {} admissions recorded"
}

summary() {
  step "Summary"
  k6 run --quiet compare.js 2>/dev/null
}

mkdir -p "$RESULTS"
"$ROOT/scripts/health-check.sh" --quiet || { echo "Stack is not healthy. Run: make up" >&2; exit 1; }

case "${1:-all}" in
  all)
    rm -f "$RESULTS"/*.json "$RESULTS"/fairness.log
    run_unprotected; run_protected; run_failure; run_fairness; summary ;;
  unprotected) run_unprotected ;;
  protected) run_protected ;;
  failure) run_failure ;;
  fairness) run_fairness ;;
  summary) summary ;;
  *) echo "usage: $0 [all|unprotected|protected|failure|fairness|summary]" >&2; exit 2 ;;
esac
