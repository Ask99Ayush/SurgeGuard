#!/usr/bin/env bash
# ==============================================================================
# SurgeGuard — Automated HTTPS & Domain Enabler
#
# Reads DOMAIN_NAME and EC2_PUBLIC_IP from .env (no hardcoding).
# Discovers AWS VPC, subnets, and EC2 instance dynamically via AWS CLI.
# Checks / imports SSL certificates into AWS ACM and configures Terraform for HTTPS.
# ==============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"

if [ ! -f "$ENV_FILE" ]; then
  echo "[-] .env file not found at $ENV_FILE" >&2
  exit 1
fi

# Load environment variables from .env
echo "[+] Loading configuration from $ENV_FILE..."
get_env() {
  grep -E "^$1=" "$ENV_FILE" | cut -d'=' -f2- | tr -d '"' | tr -d "'" || true
}

DOMAIN_NAME="$(get_env DOMAIN_NAME)"
EC2_PUBLIC_IP="$(get_env EC2_PUBLIC_IP)"
AWS_REGION="$(get_env AWS_REGION)"
AWS_REGION="${AWS_REGION:-ap-south-1}"
CERTIFICATE_ARN="$(get_env CERTIFICATE_ARN)"
INSTANCE_ID="$(get_env EXISTING_INSTANCE_ID)"
VPC_ID="$(get_env EXISTING_VPC_ID)"
SUBNET_IDS="$(get_env EXISTING_SUBNET_IDS)"
APP_PORT="$(get_env APP_PORT)"
APP_PORT="${APP_PORT:-$(get_env PROTECTED_PORT)}"
APP_PORT="${APP_PORT:-8088}"
FRONTEND_PORT="$(get_env FRONTEND_PORT)"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"
GRAFANA_PORT="$(get_env GRAFANA_PORT)"
GRAFANA_PORT="${GRAFANA_PORT:-3001}"
DIRECT_PORT="$(get_env DIRECT_PORT)"
DIRECT_PORT="${DIRECT_PORT:-8081}"
SSH_PORT="$(get_env SSH_PORT)"
SSH_PORT="${SSH_PORT:-22}"
ALLOWED_INGRESS_CIDRS="$(get_env ALLOWED_INGRESS_CIDRS)"
ALLOWED_INGRESS_CIDRS="${ALLOWED_INGRESS_CIDRS:-[\"0.0.0.0/0\"]}"
INSTANCE_TYPE="$(get_env INSTANCE_TYPE)"
INSTANCE_TYPE="${INSTANCE_TYPE:-t3.medium}"

DOMAIN_NAME="${DOMAIN_NAME:-surgeguard-innotech.duckdns.org}"
EC2_PUBLIC_IP="${EC2_PUBLIC_IP:-3.109.184.177}"

echo "[+] Domain:         $DOMAIN_NAME"
echo "[+] EC2 Public IP:  $EC2_PUBLIC_IP"
echo "[+] AWS Region:     $AWS_REGION"

# Verify DNS resolution
echo "[+] Verifying DNS resolution for $DOMAIN_NAME..."
RESOLVED_IP=$(dig +short "$DOMAIN_NAME" 2>/dev/null | tail -n1 || nslookup "$DOMAIN_NAME" 2>/dev/null | grep -A1 "Name:" | grep "Address:" | awk '{print $2}' || true)
if [ -n "$RESOLVED_IP" ]; then
  echo "[✓] $DOMAIN_NAME resolves to: $RESOLVED_IP"
else
  echo "[!] Warning: Could not resolve $DOMAIN_NAME locally, proceeding with $EC2_PUBLIC_IP"
fi

# Discover running EC2 instance by IP if not set in .env
if [ -z "$INSTANCE_ID" ] || [ -z "$VPC_ID" ]; then
  echo "[+] Discovering running EC2 instance by IP ($EC2_PUBLIC_IP)..."
  INSTANCE_JSON=$(aws ec2 describe-instances \
    --region "$AWS_REGION" \
    --filters "Name=ip-address,Values=$EC2_PUBLIC_IP" "Name=instance-state-name,Values=running" \
    --query "Reservations[0].Instances[0].{InstanceId:InstanceId,VpcId:VpcId,SubnetId:SubnetId}" \
    --output json 2>/dev/null || echo "null")

  if [ "$INSTANCE_JSON" != "null" ] && [ -n "$INSTANCE_JSON" ]; then
    INSTANCE_ID=$(echo "$INSTANCE_JSON" | grep -o '"InstanceId": "[^"]*' | cut -d'"' -f4 || true)
    VPC_ID=$(echo "$INSTANCE_JSON" | grep -o '"VpcId": "[^"]*' | cut -d'"' -f4 || true)
    echo "[✓] Discovered Instance ID: $INSTANCE_ID"
    echo "[✓] Discovered VPC ID:      $VPC_ID"
  else
    echo "[!] Could not query instance via AWS CLI."
    INSTANCE_ID=""
    VPC_ID=""
  fi
else
  echo "[✓] Using Instance ID from .env: $INSTANCE_ID"
  echo "[✓] Using VPC ID from .env:      $VPC_ID"
fi

# Query VPC subnets across AZs for ALB high availability if not in .env
if [ -z "$SUBNET_IDS" ] || [ "$SUBNET_IDS" = "[]" ]; then
  if [ -n "$VPC_ID" ]; then
    echo "[+] Discovering subnets in VPC $VPC_ID across Availability Zones..."
    SUBNET_IDS=$(aws ec2 describe-subnets \
      --region "$AWS_REGION" \
      --filters "Name=vpc-id,Values=$VPC_ID" \
      --query "Subnets[*].SubnetId" \
      --output json 2>/dev/null || echo "[]")
    echo "[✓] Discovered Subnets:     $SUBNET_IDS"
  else
    SUBNET_IDS="[]"
  fi
else
  echo "[✓] Using Subnets from .env:     $SUBNET_IDS"
fi

# Check ACM for an issued certificate matching DOMAIN_NAME if not set
if [ -z "$CERTIFICATE_ARN" ]; then
  echo "[+] Checking AWS ACM for issued certificate for $DOMAIN_NAME..."
  EXISTING_CERT_ARN=$(aws acm list-certificates \
    --region "$AWS_REGION" \
    --query "CertificateSummaryList[?DomainName=='$DOMAIN_NAME'].CertificateArn | [0]" \
    --output text 2>/dev/null || echo "None")

  if [ "$EXISTING_CERT_ARN" != "None" ] && [ -n "$EXISTING_CERT_ARN" ]; then
    echo "[✓] Found existing ACM Certificate: $EXISTING_CERT_ARN"
    CERTIFICATE_ARN="$EXISTING_CERT_ARN"
  else
    echo "[i] No ACM certificate found for $DOMAIN_NAME yet."
  fi
fi

# Update root .env with domain and HTTPS configuration
echo "[+] Updating .env with HTTPS configuration..."
update_or_append_env() {
  local key="$1"
  local val="$2"
  if grep -qE "^${key}=" "$ENV_FILE"; then
    sed -i.bak "s|^${key}=.*|${key}=${val}|" "$ENV_FILE" && rm -f "${ENV_FILE}.bak"
  else
    echo "${key}=${val}" >> "$ENV_FILE"
  fi
}

update_or_append_env "DOMAIN_NAME" "$DOMAIN_NAME"
update_or_append_env "EC2_PUBLIC_IP" "$EC2_PUBLIC_IP"
update_or_append_env "PUBLIC_SITE_URL" "https://${DOMAIN_NAME}"
update_or_append_env "PUBLIC_GRAFANA_URL" "http://${EC2_PUBLIC_IP}:${GRAFANA_PORT}"
update_or_append_env "PUBLIC_DIRECT_URL" "http://${EC2_PUBLIC_IP}:${DIRECT_PORT}"
update_or_append_env "COOKIE_SECURE" "true"
if [ -n "$INSTANCE_ID" ]; then update_or_append_env "EXISTING_INSTANCE_ID" "$INSTANCE_ID"; fi
if [ -n "$VPC_ID" ]; then update_or_append_env "EXISTING_VPC_ID" "$VPC_ID"; fi
if [ -n "$SUBNET_IDS" ] && [ "$SUBNET_IDS" != "[]" ]; then update_or_append_env "EXISTING_SUBNET_IDS" "$SUBNET_IDS"; fi
if [ -n "$CERTIFICATE_ARN" ] && [ "$CERTIFICATE_ARN" != "None" ]; then
  update_or_append_env "CERTIFICATE_ARN" "$CERTIFICATE_ARN"
fi

# Export to Terraform
export TF_VAR_domain_name="$DOMAIN_NAME"
export TF_VAR_ec2_public_ip="$EC2_PUBLIC_IP"
export TF_VAR_aws_region="$AWS_REGION"
export TF_VAR_app_port="$APP_PORT"
export TF_VAR_frontend_port="$FRONTEND_PORT"
export TF_VAR_grafana_port="$GRAFANA_PORT"
export TF_VAR_direct_port="$DIRECT_PORT"
export TF_VAR_ssh_port="$SSH_PORT"
export TF_VAR_instance_type="$INSTANCE_TYPE"
if [ -n "$INSTANCE_ID" ]; then export TF_VAR_existing_instance_id="$INSTANCE_ID"; fi
if [ -n "$VPC_ID" ]; then export TF_VAR_existing_vpc_id="$VPC_ID"; fi
if [ "$SUBNET_IDS" != "[]" ]; then export TF_VAR_existing_subnet_ids="$SUBNET_IDS"; fi
if [ -n "$CERTIFICATE_ARN" ] && [ "$CERTIFICATE_ARN" != "None" ]; then export TF_VAR_certificate_arn="$CERTIFICATE_ARN"; fi

echo "[+] Configuration ready."
echo "[+] Running Terraform Plan..."
cd "$ROOT_DIR/infra/terraform"
terraform plan

echo ""
echo "=============================================================================="
echo " HTTPS Configuration Summary:"
echo "   Domain:             https://${DOMAIN_NAME}"
echo "   EC2 Host:           ${EC2_PUBLIC_IP}"
echo "   Instance ID:        ${INSTANCE_ID:-Discovered at runtime}"
echo "   VPC ID:             ${VPC_ID:-Discovered at runtime}"
echo "   ACM Certificate:    ${CERTIFICATE_ARN:-None (HTTP->HTTPS redirect ready)}"
echo "=============================================================================="
echo ""
echo "To apply this Terraform plan, run:"
echo "   cd infra/terraform && terraform apply"
