#!/usr/bin/env bash
# Report the health of every Compose service and probe the public routes.
#   scripts/health-check.sh [--quiet] [--wait SECONDS]
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
QUIET=0
WAIT=0
while [ $# -gt 0 ]; do
  case "$1" in
    --quiet) QUIET=1 ;;
    --wait) WAIT="$2"; shift ;;
  esac
  shift
done

env_value() { grep -E "^$1=" .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d "'\""; }
BIND="$(env_value BIND_ADDRESS)"; BIND="${BIND:-127.0.0.1}"
PROTECTED="$(env_value PROTECTED_PORT)"; PROTECTED="${PROTECTED:-8080}"
DIRECT="$(env_value DIRECT_PORT)"; DIRECT="${DIRECT:-8081}"
FRONTEND="$(env_value FRONTEND_PORT)"; FRONTEND="${FRONTEND:-3000}"
GRAFANA="$(env_value GRAFANA_PORT)"; GRAFANA="${GRAFANA:-3001}"
PROM="$(env_value PROMETHEUS_PORT)"; PROM="${PROM:-9090}"

SERVICES=(redis api worker demo-1 demo-2 nginx frontend prometheus grafana)

unhealthy() {
  local bad=()
  for svc in "${SERVICES[@]}"; do
    local id status
    id="$(docker compose ps -q "$svc" 2>/dev/null)"
    if [ -z "$id" ]; then bad+=("$svc:missing"); continue; fi
    status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id" 2>/dev/null)"
    [ "$status" = "healthy" ] || bad+=("$svc:$status")
  done
  printf '%s\n' "${bad[@]}"
}

deadline=$(( $(date +%s) + WAIT ))
while :; do
  BAD="$(unhealthy)"
  [ -z "$BAD" ] && break
  [ "$(date +%s)" -ge "$deadline" ] && break
  sleep 3
done

if [ -n "$BAD" ]; then
  echo "Unhealthy services:" >&2
  echo "$BAD" | sed 's/^/  /' >&2
  exit 1
fi

probe() { curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$1" 2>/dev/null || echo 000; }

if [ "$QUIET" -eq 0 ]; then
  echo "All services healthy."
  printf '  %-34s %s\n' "protected site  http://localhost:$PROTECTED/" "$(probe "http://$BIND:$PROTECTED/") (302 = sent to waiting room)"
  printf '  %-34s %s\n' "waiting room    http://localhost:$PROTECTED/waiting-room" "$(probe "http://$BIND:$PROTECTED/waiting-room")"
  printf '  %-34s %s\n' "unprotected     http://localhost:$DIRECT/" "$(probe "http://$BIND:$DIRECT/")"
  printf '  %-34s %s\n' "console         http://localhost:$FRONTEND/" "$(probe "http://$BIND:$FRONTEND/")"
  printf '  %-34s %s\n' "grafana         http://localhost:$GRAFANA/" "$(probe "http://$BIND:$GRAFANA/api/health")"
  printf '  %-34s %s\n' "prometheus      http://localhost:$PROM/" "$(probe "http://$BIND:$PROM/-/ready")"
fi
exit 0
