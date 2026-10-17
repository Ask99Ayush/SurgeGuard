#!/usr/bin/env bash
# Check that .env exists, defines every key from .env.example, and has no unfilled placeholders.
# Never prints values.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${1:-$ROOT/.env}"
EXAMPLE="$ROOT/.env.example"

[ -f "$ENV_FILE" ] || { echo "validate-config: $ENV_FILE missing. Run: make setup" >&2; exit 1; }

missing=()
while IFS= read -r line; do
  [[ "$line" =~ ^([A-Z0-9_]+)= ]] || continue
  key="${BASH_REMATCH[1]}"
  grep -qE "^${key}=" "$ENV_FILE" || missing+=("$key")
done < "$EXAMPLE"

placeholders="$(grep -E '^[A-Z0-9_]+=.*<generated>' "$ENV_FILE" | cut -d= -f1 || true)"

status=0
if [ ${#missing[@]} -gt 0 ]; then
  echo "validate-config: missing keys: ${missing[*]}" >&2
  status=1
fi
if [ -n "$placeholders" ]; then
  echo "validate-config: unfilled placeholders: $(echo "$placeholders" | tr '\n' ' ')" >&2
  status=1
fi
app_env="$(grep -E '^APP_ENV=' "$ENV_FILE" | cut -d= -f2-)"
cookie_secure="$(grep -E '^COOKIE_SECURE=' "$ENV_FILE" | cut -d= -f2-)"
if [ "$app_env" = "production" ] && [ "$cookie_secure" != "true" ]; then
  echo "validate-config: COOKIE_SECURE must be true when APP_ENV=production" >&2
  status=1
fi
for flag in DEMO_LOGIN_ENABLED REVIEWER_LOGIN_ENABLED; do
  enabled="$(grep -E "^${flag}=" "$ENV_FILE" | cut -d= -f2-)"
  if [ "$enabled" = "true" ] && [ "$app_env" != "development" ] && [ "$app_env" != "test" ]; then
    echo "validate-config: ${flag}=true is only allowed in development/test" >&2
    status=1
  fi
done
[ $status -eq 0 ] && echo "validate-config: .env ok"
exit $status
