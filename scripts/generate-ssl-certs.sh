#!/usr/bin/env bash
# ==============================================================================
# SurgeGuard — EC2 Host Self-Signed TLS Certificate Generator
#
# Generates a private key and X.509 certificate with Subject Alternative Names
# (SAN) matching surgeguard-innotech.duckdns.org and the host's public IP.
#
# Security:
# - Generates 2048-bit RSA private key on the host.
# - Stores certificate and key in a root-owned directory with restrictive permissions.
# - Ownership: root:101 (UID 101 is the nginx-unprivileged container process).
# - Permissions: directory 750, private key 640 (root read/write, nginx group read),
#   certificate 644 (publicly readable).
# - Never prints or commits the private key.
# ==============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CERTS_DIR="${CERTS_DIR:-$ROOT_DIR/certs}"
DOMAIN_NAME="${DOMAIN_NAME:-surgeguard-innotech.duckdns.org}"
PUBLIC_IP="${PUBLIC_IP:-3.109.184.177}"
DAYS_VALID="${DAYS_VALID:-365}"

echo "[+] Generating self-signed TLS certificate for SurgeGuard..."
echo "    Domain (SAN):   $DOMAIN_NAME"
echo "    Public IP (SAN):$PUBLIC_IP"
echo "    Target Directory:$CERTS_DIR"
echo "    Validity:       $DAYS_VALID days"

mkdir -p "$CERTS_DIR"

CONFIG_FILE="$(mktemp /tmp/surgeguard-openssl-XXXXXX.cnf)"
trap 'rm -f "$CONFIG_FILE"' EXIT

cat > "$CONFIG_FILE" <<EOF
[req]
default_bits       = 2048
default_md         = sha256
distinguished_name = req_distinguished_name
prompt             = no
x509_extensions    = v3_req

[req_distinguished_name]
C  = IN
ST = Maharashtra
L  = Mumbai
O  = SurgeGuard
OU = Security Operations
CN = ${DOMAIN_NAME}

[v3_req]
basicConstraints     = CA:FALSE
keyUsage             = nonRepudiation, digitalSignature, keyEncipherment
extendedKeyUsage     = serverAuth
subjectAltName       = @alt_names

[alt_names]
DNS.1 = ${DOMAIN_NAME}
DNS.2 = localhost
IP.1  = ${PUBLIC_IP}
IP.2  = 127.0.0.1
EOF

KEY_FILE="$CERTS_DIR/surgeguard.key"
CERT_FILE="$CERTS_DIR/surgeguard.crt"

# Generate Private Key and Certificate without printing private key
umask 077
openssl req -x509 -nodes -days "$DAYS_VALID" \
  -newkey rsa:2048 \
  -keyout "$KEY_FILE" \
  -out "$CERT_FILE" \
  -config "$CONFIG_FILE" 2>/dev/null

# Apply restrictive permissions
chmod 750 "$CERTS_DIR"
chmod 644 "$CERT_FILE"
chmod 640 "$KEY_FILE"

# Apply root ownership with nginx-unprivileged group read (101) if root
if [ "$(id -u)" -eq 0 ]; then
  chown root:101 "$KEY_FILE" "$CERT_FILE" "$CERTS_DIR" 2>/dev/null || true
fi

echo "[✓] TLS Certificate generated successfully!"
echo "    Certificate: $CERT_FILE"
echo "    Private Key: $KEY_FILE"
echo ""
echo "[+] Certificate Subject Alternative Names (SAN):"
openssl x509 -in "$CERT_FILE" -noout -text | grep -A1 "Subject Alternative Name" || true
echo ""
echo "[+] Certificate Expiry:"
openssl x509 -in "$CERT_FILE" -noout -dates
