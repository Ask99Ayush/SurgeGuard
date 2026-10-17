#!/usr/bin/env bash
# Generate a git-ignored .env from .env.example with fresh, cryptographically secure secrets.
#
#   scripts/setup.sh            create .env if it does not exist
#   scripts/setup.sh --force    regenerate .env (overwrites the existing one after a backup)
#   scripts/setup.sh --reset-admin-password   only rotate the admin password hash
#
# Secrets are never echoed except the generated admin and Grafana passwords, which are printed
# once to this terminal so you can log in. They are not written anywhere else in plain text.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXAMPLE="$ROOT/.env.example"
TARGET="$ROOT/.env"
BCRYPT_IMAGE="python:3.12.8-slim"

die() { echo "setup: $*" >&2; exit 1; }

PY=""
for candidate in python3 python; do
  if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c 'import secrets' >/dev/null 2>&1; then
    PY="$candidate"; break
  fi
done

random_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 48 | tr -d '\n=+/' | cut -c1-56
  elif [ -n "$PY" ]; then
    "$PY" -c 'import secrets; print(secrets.token_urlsafe(42))'
  else
    die "need openssl or python to generate secrets"
  fi
}

bcrypt_hash() {
  # Reads the password on stdin so it never appears in a process list.
  local password="$1"
  if [ -n "$PY" ] && "$PY" -c 'import bcrypt' >/dev/null 2>&1; then
    printf '%s' "$password" | "$PY" "$ROOT/scripts/hash-password.py"
  elif command -v docker >/dev/null 2>&1; then
    printf '%s' "$password" | MSYS_NO_PATHCONV=1 docker run --rm -i -v "$ROOT/scripts:/scripts:ro" "$BCRYPT_IMAGE" \
      sh -c 'pip install -q --disable-pip-version-check --root-user-action=ignore bcrypt==4.2.1 >/dev/null 2>&1 && python /scripts/hash-password.py'
  else
    die "need python with the bcrypt package, or docker, to hash the admin password"
  fi
}

set_value() {
  # set_value KEY VALUE  -> replaces the KEY= line in $TARGET (value written single-quoted when it has '$').
  local key="$1" value="$2" tmp
  tmp="$(mktemp)"
  local line
  if [[ "$value" == *'$'* ]]; then line="${key}='${value}'"; else line="${key}=${value}"; fi
  while IFS= read -r current || [ -n "$current" ]; do
    if [[ "$current" == "${key}="* ]]; then printf '%s\n' "$line"; else printf '%s\n' "$current"; fi
  done < "$TARGET" > "$tmp"
  mv "$tmp" "$TARGET"
}

[ -f "$EXAMPLE" ] || die ".env.example not found"

MODE="${1:-}"
if [ "$MODE" = "--reset-admin-password" ]; then
  [ -f "$TARGET" ] || die ".env does not exist; run scripts/setup.sh first"
  ADMIN_PASSWORD="$(random_secret | cut -c1-20)"
  set_value ADMIN_PASSWORD_HASH "$(bcrypt_hash "$ADMIN_PASSWORD")"
  echo "Admin password rotated. New password (shown once): $ADMIN_PASSWORD"
  echo "Restart the frontend: docker compose up -d frontend"
  exit 0
fi

if [ -f "$TARGET" ] && [ "$MODE" != "--force" ]; then
  echo ".env already exists; leaving it untouched (use --force to regenerate)."
  exit 0
fi
if [ -f "$TARGET" ]; then
  cp "$TARGET" "$TARGET.bak.$(date +%s)"
  echo "Backed up existing .env"
fi

cp "$EXAMPLE" "$TARGET"
chmod 600 "$TARGET" 2>/dev/null || true

for key in REDIS_PASSWORD TOKEN_SIGNING_SECRET VISITOR_COOKIE_SECRET INTERNAL_AUTH_SECRET ORIGIN_SHARED_SECRET \
           ADMIN_API_KEY SESSION_SECRET; do
  set_value "$key" "$(random_secret)"
done

ADMIN_PASSWORD="$(random_secret | cut -c1-20)"
GRAFANA_PASSWORD="$(random_secret | cut -c1-20)"
REVIEWER_PASSWORD="$(random_secret | cut -c1-20)"
set_value ADMIN_PASSWORD_HASH "$(bcrypt_hash "$ADMIN_PASSWORD")"
set_value GRAFANA_ADMIN_PASSWORD "$GRAFANA_PASSWORD"
set_value REVIEWER_PASSWORD "$REVIEWER_PASSWORD"

if grep -qE '^[A-Z0-9_]+=.*<generated>' "$TARGET"; then
  die "some <generated> placeholders were not filled; check .env.example"
fi

cat <<EOF
Created .env with freshly generated secrets (git-ignored).

  Admin console   user: admin   password: $ADMIN_PASSWORD
  Grafana         user: admin   password: $GRAFANA_PASSWORD
  Reviewer login  user: reviewer password: $REVIEWER_PASSWORD   (full permissions, dev only; also in .env)
  Demo login      user: demo     password: surgeguard-demo     (one-click on /login; role from DEMO_ROLE, dev only)

These passwords are shown once. Store them in your password manager.
Rotate the admin password later with: scripts/setup.sh --reset-admin-password
EOF
