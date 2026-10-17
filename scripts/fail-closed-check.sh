#!/usr/bin/env bash
# Fail-closed verification against the running stack. Temporarily stops Redis, then the API,
# and checks that an ADMITTED visitor is refused (503 fail-closed page), never sent to the origin.
# Restores each service afterwards.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
PORT="$(grep -E '^PROTECTED_PORT=' .env | cut -d= -f2-)"; PORT="${PORT:-8080}"
BASE="http://127.0.0.1:$PORT"
JAR="$(mktemp)"
trap 'rm -f "$JAR"; docker compose start redis api >/dev/null 2>&1 || true' EXIT

pass=0; fail=0
check() { # check <description> <expected> <actual>
  if [ "$2" = "$3" ]; then echo "  PASS  $1 ($3)"; pass=$((pass + 1)); else echo "  FAIL  $1 (expected $2, got $3)"; fail=$((fail + 1)); fi
}
code() { curl -s -o /dev/null -w '%{http_code}' -b "$JAR" -c "$JAR" --max-time 10 "$@" || echo 000; }

echo "Getting admitted..."
curl -s -b "$JAR" -c "$JAR" -X POST "$BASE/api/v1/queue/join" >/dev/null
for _ in $(seq 1 60); do
  state="$(curl -s -b "$JAR" -c "$JAR" "$BASE/api/v1/queue/status" | sed -E 's/.*"state":"([a-z]+)".*/\1/')"
  [ "$state" = "admitted" ] && break
  sleep 1
done
check "admitted visitor reaches origin" 200 "$(code "$BASE/")"

echo "Stopping Redis..."
docker compose stop redis >/dev/null
check "admitted visitor with Redis down is refused (fail closed)" 503 "$(code "$BASE/")"
body="$(curl -s -b "$JAR" --max-time 10 "$BASE/")"
case "$body" in *"temporarily unavailable"*) check "friendly fail-closed page shown" yes yes ;; *) check "friendly fail-closed page shown" yes no ;; esac
check "visitor with an invalid token is still sent to the waiting room" 302 "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$BASE/" -H 'Cookie: sg_admission=x')"
check "queue API with Redis down returns 503" 503 "$(code -X POST "$BASE/api/v1/queue/join")"
docker compose start redis >/dev/null
sleep 3

echo "Stopping the API..."
docker compose stop api >/dev/null
check "admitted visitor with API down is refused (fail closed)" 503 "$(code "$BASE/")"
docker compose start api >/dev/null
bash scripts/health-check.sh --quiet --wait 60 || true
check "admitted visitor reaches origin again after recovery" 200 "$(code "$BASE/")"

echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
