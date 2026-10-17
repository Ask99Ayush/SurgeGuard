#!/usr/bin/env bash
# Verify the RedisUnavailable alert against the running stack:
#   1. Redis up      -> alert not pending/firing
#   2. Redis stopped -> alert firing (rule has `for: 30s`, so this takes ~40-60 s)
#   3. Redis started -> alert resolves
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
PORT="$(grep -E '^PROMETHEUS_PORT=' .env | cut -d= -f2-)"; PORT="${PORT:-9090}"
PROM="http://127.0.0.1:$PORT"
ALERT="${ALERT:-RedisUnavailable}"
trap 'docker compose start redis >/dev/null 2>&1 || true' EXIT

state() {
  # Prints firing / pending / inactive for $ALERT.
  curl -s "$PROM/api/v1/alerts" | tr '{' '\n' | grep -A3 "\"alertname\":\"$ALERT\"" | grep -o '"state":"[a-z]*"' \
    | head -1 | cut -d'"' -f4 | grep . || echo inactive
}

wait_for() { # wait_for <state> <timeout_s>
  for _ in $(seq 1 $(( $2 / 3 ))); do
    [ "$(state)" = "$1" ] && return 0
    sleep 3
  done
  return 1
}

pass=0; fail=0
check() { if "$@"; then echo "  PASS  $DESC"; pass=$((pass + 1)); else echo "  FAIL  $DESC (state: $(state))"; fail=$((fail + 1)); fi; }

echo "Redis up: waiting 40 s (longer than the rule's for: 30s)..."
sleep 40
DESC="$ALERT is not firing while Redis is up"; check [ "$(state)" = "inactive" ]

echo "Stopping Redis..."
docker compose stop redis >/dev/null
DESC="$ALERT fires while Redis is down"; check wait_for firing 120

echo "Starting Redis..."
docker compose start redis >/dev/null
DESC="$ALERT resolves after Redis is back"; check wait_for inactive 90

echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
