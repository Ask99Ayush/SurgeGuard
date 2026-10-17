#!/usr/bin/env bash
# Rotate the admission-token signing key in .env without logging anyone out.
#   1. the current kid:secret moves to TOKEN_VERIFY_KEYS (still accepted for verification)
#   2. a new secret and kid become active for newly minted tokens
#   3. older retired keys are dropped (tokens live TOKEN_TTL_SECONDS, so one retired key suffices)
# Restart the API afterwards:  docker compose up -d api worker
# After TOKEN_TTL_SECONDS has passed, run with --drop-retired to stop accepting the old key.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env"
[ -f "$ENV_FILE" ] || { echo "rotate-token-key: .env not found" >&2; exit 1; }

get() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2-; }
set_value() {
  local key="$1" value="$2" tmp
  tmp="$(mktemp)"
  while IFS= read -r line || [ -n "$line" ]; do
    if [[ "$line" == "$key="* ]]; then printf '%s=%s\n' "$key" "$value"; else printf '%s\n' "$line"; fi
  done < "$ENV_FILE" > "$tmp"
  mv "$tmp" "$ENV_FILE"
}

if [ "${1:-}" = "--drop-retired" ]; then
  set_value TOKEN_VERIFY_KEYS ""
  echo "Retired signing keys removed. Restart: docker compose up -d api worker"
  exit 0
fi

old_kid="$(get TOKEN_SIGNING_KID)"
old_secret="$(get TOKEN_SIGNING_SECRET)"
[ -n "$old_kid" ] && [ -n "$old_secret" ] || { echo "rotate-token-key: current key not set" >&2; exit 1; }

num="${old_kid//[!0-9]/}"
new_kid="k$(( ${num:-0} + 1 ))"
if command -v openssl >/dev/null 2>&1; then
  new_secret="$(openssl rand -base64 48 | tr -d '\n=+/' | cut -c1-56)"
else
  new_secret="$(python -c 'import secrets; print(secrets.token_urlsafe(42))')"
fi

set_value TOKEN_VERIFY_KEYS "${old_kid}:${old_secret}"
set_value TOKEN_SIGNING_KID "$new_kid"
set_value TOKEN_SIGNING_SECRET "$new_secret"
echo "Signing key rotated: active kid $old_kid -> $new_kid (old key still accepted for verification)."
echo "Restart: docker compose up -d api worker"
echo "After TOKEN_TTL_SECONDS, run: scripts/rotate-token-key.sh --drop-retired"
