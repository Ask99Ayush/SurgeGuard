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
ROOT_DIR="$(cd "$DIR/../.." && pwd)"

if [ -n "${TF_ENV_FILE:-}" ] && [ -f "$TF_ENV_FILE" ]; then
  ENV_FILE="$TF_ENV_FILE"
elif [ -f "$ROOT_DIR/.env" ]; then
  ENV_FILE="$ROOT_DIR/.env"
elif [ -f "$DIR/.env" ]; then
  ENV_FILE="$DIR/.env"
else
  echo "terraform-env: no .env found in $ROOT_DIR" >&2
  exit 1
fi

[ $# -gt 0 ] || { echo "usage: $0 <terraform args...>" >&2; exit 2; }

# Parse .env and export variables to Terraform
lineno=0
while IFS= read -r line || [ -n "$line" ]; do
  lineno=$((lineno + 1))
  line="${line%$'\r'}"
  [[ -z "${line//[[:space:]]/}" || "$line" =~ ^[[:space:]]*# ]] && continue
  if [[ ! "$line" =~ ^([A-Za-z0-9_]+)=(.*)$ ]]; then
    continue
  fi
  key="${BASH_REMATCH[1]}"
  value="${BASH_REMATCH[2]}"
  if [[ "$value" =~ ^\"(.*)\"$ || "$value" =~ ^\'(.*)\'$ ]]; then value="${BASH_REMATCH[1]}"; fi
  [ -z "$value" ] && continue
  if [[ "$value" == *'<'*'>'* ]]; then continue; fi

  # Map standard SurgeGuard .env keys to Terraform variables
  case "$key" in
    DOMAIN_NAME) export TF_VAR_domain_name="$value" ;;
    EC2_PUBLIC_IP) export TF_VAR_ec2_public_ip="$value" ;;
    CERTIFICATE_ARN) export TF_VAR_certificate_arn="$value" ;;
    PROTECTED_PORT) export TF_VAR_app_port="$value" ;;
    FRONTEND_PORT) export TF_VAR_frontend_port="$value" ;;
    GRAFANA_PORT) export TF_VAR_grafana_port="$value" ;;
    DIRECT_PORT) export TF_VAR_direct_port="$value" ;;
    APP_ENV) export TF_VAR_environment="$value" ;;
    *) export "TF_VAR_${key,,}=$value" ;;
  esac
done < "$ENV_FILE"

# Sensible defaults for Terraform if not explicitly set
export TF_VAR_aws_region="${TF_VAR_aws_region:-ap-south-1}"
export TF_VAR_project_name="${TF_VAR_project_name:-surgeguard}"
export TF_VAR_environment="${TF_VAR_environment:-dev}"

cd "$DIR"
exec terraform "$@"
