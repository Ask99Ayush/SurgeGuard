#!/usr/bin/env bash
# Safely load infra/terraform/.env into TF_VAR_* and run a terraform command.
#
#   infra/terraform/scripts/terraform-env.sh validate
#   infra/terraform/scripts/terraform-env.sh plan -out=tfplan      (needs AWS credentials; run it yourself)
#
# The file is parsed line by line: no `eval`, no `source`. Only KEY=VALUE lines with an
# upper-case key are accepted; values are passed through verbatim (optionally quoted).
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${TF_ENV_FILE:-$DIR/.env}"
REQUIRED=(AWS_REGION PROJECT_NAME ENVIRONMENT VPC_CIDR PUBLIC_SUBNET_CIDRS PRIVATE_SUBNET_CIDRS
          ALLOWED_INGRESS_CIDRS INSTANCE_TYPE APP_SOURCE_URL APP_VERSION)

[ $# -gt 0 ] || { echo "usage: $0 <terraform args...>" >&2; exit 2; }
[ -f "$ENV_FILE" ] || { echo "terraform-env: $ENV_FILE not found (copy .env.example)" >&2; exit 1; }

declare -A seen=()
lineno=0
while IFS= read -r line || [ -n "$line" ]; do
  lineno=$((lineno + 1))
  line="${line%$'\r'}"
  [[ -z "${line//[[:space:]]/}" || "$line" =~ ^[[:space:]]*# ]] && continue
  if [[ ! "$line" =~ ^([A-Z][A-Z0-9_]*)=(.*)$ ]]; then
    echo "terraform-env: line $lineno is not KEY=VALUE; refusing to continue" >&2
    exit 1
  fi
  key="${BASH_REMATCH[1]}"
  value="${BASH_REMATCH[2]}"
  if [[ "$value" =~ ^\"(.*)\"$ || "$value" =~ ^\'(.*)\'$ ]]; then value="${BASH_REMATCH[1]}"; fi
  [ -z "$value" ] && continue  # empty = use the variable's default
  if [[ "$value" == *'<'*'>'* ]]; then
    echo "terraform-env: $key still contains a <placeholder>" >&2
    exit 1
  fi
  export "TF_VAR_${key,,}=$value"
  seen[$key]=1
done < "$ENV_FILE"

missing=()
for key in "${REQUIRED[@]}"; do [ -n "${seen[$key]:-}" ] || missing+=("$key"); done
if [ ${#missing[@]} -gt 0 ]; then
  echo "terraform-env: missing required keys: ${missing[*]}" >&2
  exit 1
fi

cd "$DIR"
exec terraform "$@"
