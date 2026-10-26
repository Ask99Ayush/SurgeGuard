# SurgeGuard — Infrastructure as Code, Domain, SSH & Self-Signed HTTPS

This document details the Terraform architecture, EC2 security groups, manual SSH administration, DuckDNS dynamic DNS resolution, self-signed TLS certificates, and Nginx reverse proxy configuration for **SurgeGuard** running in AWS `ap-south-1` (Mumbai).

---

## 1. Architecture Overview

```
                      +-------------------------------------------------------------+
                      |         Internet / Client Browser (HTTPS / SSH)              |
                      +-------------------------------------------------------------+
                                       |                               |
                   Port 22 (SSH)       |                               | Ports 80, 443, 8088, 3000, 3001
            (Key: SurgeGuard.pem)     |                               |
                                       v                               v
                      +-------------------------------------------------------------+
                      |       EC2 Instance: i-0d9a4f57ebcff0048 (m7i-flex.large)     |
                      |       Public IP:    3.109.184.177                            |
                      |       Domain:       surgeguard-innotech.duckdns.org          |
                      |       OS:           Ubuntu 26.04 LTS                         |
                      |                                                             |
                      |  Security Groups:                                           |
                      |   - sg-095cd8eb865168e49 (surgeguard-dev-app - Terraform)   |
                      |   - sg-03048ded2a039015a (launch-wizard-12 - Preserved)     |
                      +-------------------------------------------------------------+
                                                       |
                                  +--------------------+--------------------+
                                  |                                         |
                                  v                                         v
               +--------------------------------------+   +------------------------------------+
               | Port 80 (HTTP) -> Redirect           |   | Port 443 (HTTPS) -> TLS Terminate  |
               | Nginx Container (:8080)              |   | Nginx Container (:8443)            |
               | 301 Moved -> https://$host$uri       |   | Self-signed TLS Cert (SAN matches) |
               +--------------------------------------+   +------------------------------------+
                                                                    |
                                        +---------------------------+---------------------------+
                                        | (Auth Check /_sg_auth)                                | (Static Assets /_next)
                                        v                                                       v
                         +-----------------------------+                         +-----------------------------+
                         |  FastAPI Admission API      |                         |  Next.js Web Console / UI   |
                         |  Port 8000 (Docker Internal)|                         |  Port 3000 (edge network)   |
                         +-----------------------------+                         +-----------------------------+
                                        |                                                       |
                                        v                                                       v
                         +-----------------------------+                         +-----------------------------+
                         |  Redis 7.4.2 (Token State)  |                         |  Prometheus & Grafana       |
                         |  Port 6379 (Strictly Private|                         |  Ports 9090 & 3001          |
                         +-----------------------------+                         +-----------------------------+
```

---

## 2. Infrastructure Inventory & Resources

| Component | Identifier | Status | Purpose |
| :--- | :--- | :--- | :--- |
| **AWS Region** | `ap-south-1` (Mumbai) | Active | Deployment location |
| **EC2 Instance** | `i-0d9a4f57ebcff0048` | Running | Hosts Docker Compose stack (`m7i-flex.large`) |
| **Public IP** | `3.109.184.177` | Static / Allocated | Primary IPv4 ingress |
| **VPC** | `vpc-05d75fcdd443aa2a9` | Active | AWS Default VPC |
| **Subnet** | `subnet-02e45f3e18dcaa427` | Active | Public Subnet in `ap-south-1a` |
| **Domain** | `surgeguard-innotech.duckdns.org` | Resolved | DuckDNS record pointing to `3.109.184.177` |
| **Terraform Security Group** | `sg-095cd8eb865168e49` | Attached | Manages ingress for 22, 80, 443, 8088, 3000, 3001, 8081 |
| **SSH Key Pair** | `SurgeGuard` (`SurgeGuard.pem`) | Private | Public-key authentication for user `ubuntu` |

---

## 3. Security Group Firewall Rules

Terraform manages `sg-095cd8eb865168e49` attached directly to network interface `eni-0e5e4d49cce7bad12`.

### Ingress Rules

| Protocol | Port | Source CIDR | Service | Notes |
| :--- | :--- | :--- | :--- | :--- |
| **TCP** | `22` | `0.0.0.0/0` | SSH Administration | Public-key authentication required. Password auth disabled. |
| **TCP** | `80` | `0.0.0.0/0` | HTTP Web Ingress | Nginx listens on 8080; permanently redirects (301) to HTTPS. |
| **TCP** | `443` | `0.0.0.0/0` | HTTPS TLS Entry Point | Nginx TLS termination on port 8443 with self-signed certificate. |
| **TCP** | `8088` | `0.0.0.0/0` | SurgeGuard Protected Edge | Direct HTTPS access to SurgeGuard edge proxy. |
| **TCP** | `3000` | `0.0.0.0/0` | Admin Web Console | Next.js operator and queue management dashboard. |
| **TCP** | `3001` | `0.0.0.0/0` | Grafana Observability | SRE metrics dashboards (Prometheus backend). |
| **TCP** | `8081` | `0.0.0.0/0` | Unprotected Demo Origin | Direct comparison origin without admission token validation. |

### Private / Prohibited Services (Zero Ingress)

| Service | Port | Network Boundary | Security Posture |
| :--- | :--- | :--- | :--- |
| **FastAPI Queue API** | `8000` | Docker Internal (`app`, `data`) | **STRICTLY PRIVATE**. Revoked from security group; no port exposure. |
| **Redis Queue Store** | `6379` | Docker Internal (`data`) | **STRICTLY PRIVATE**. Unexposed to host; no security group ingress. |

> [!CAUTION]
> **SSH Attack Surface Warning:** Opening port `22` to `0.0.0.0/0` allows arbitrary Internet IP addresses to initiate SSH handshakes. While public-key authentication is enforced and password login is disabled, it is strongly recommended in production to restrict SSH ingress to your office or bastion CIDR (e.g. `your-ip/32`).

---

## 4. Removal of Systems Manager (SSM) Dependencies

To eliminate unnecessary AWS service dependencies, simplify the deployment model, and adhere to zero-trust secret handling:

1. **No SSM Managed Core Policy:** Removed `arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore` from IAM role attachments.
2. **No SSM Parameter Store Reads:** User-data scripts and bootstrap processes do not query SSM Parameter Store.
3. **No Session Manager Assumptions:** Management is strictly manual SSH via private key authentication.
4. **No SSM AMI Lookups:** Terraform uses standard `aws_ami` data sources (`data.aws_ami.amazon_linux`) instead of SSM parameters.
5. **No Paid Infrastructure:** Application Load Balancer (`enable_alb = false`), Auto Scaling Group (`enable_asg = false`), and NAT Gateways are disabled by default.

---

## 5. EC2-Local `.env` Configuration & Secret Hygiene

Application secrets and environment variables are maintained in a dedicated `.env` file directly on the EC2 host.

### Secret Management Rules
- **Never committed to Git:** `.env`, `.env.*`, `*.key`, `*.pem`, `*.crt` are ignored in [.gitignore](file:///x:/Django/Django_Project/SurgeGuard/.gitignore).
- **Never in Terraform State:** Production passwords, cryptographic signing keys, and token secrets are excluded from Terraform `.tfvars`, state files, and outputs.
- **Restrictive File Permissions:** The `.env` file on EC2 is restricted with `chmod 600 .env` so that only the deploying user/root can read it.
- **Docker Build Context:** `.dockerignore` excludes `.env` to prevent secrets from baking into image layers.

### Creating `.env` for a Fresh Instance

```bash
# 1. SSH into the instance
ssh -i SurgeGuard.pem ubuntu@3.109.184.177

# 2. Navigate to project root
cd /opt/surgeguard/app

# 3. Copy template and restrict permissions immediately
umask 077
cp .env.example .env
chmod 600 .env

# 4. Populate required secrets (use openssl rand -hex 32)
sed -i 's|^APP_ENV=.*|APP_ENV=production|' .env
sed -i 's|^COOKIE_SECURE=.*|COOKIE_SECURE=true|' .env
sed -i "s|^REDIS_PASSWORD=.*|REDIS_PASSWORD=$(openssl rand -hex 24)|" .env
sed -i "s|^TOKEN_SIGNING_SECRET=.*|TOKEN_SIGNING_SECRET=$(openssl rand -hex 32)|" .env
sed -i "s|^VISITOR_COOKIE_SECRET=.*|VISITOR_COOKIE_SECRET=$(openssl rand -hex 32)|" .env
sed -i "s|^INTERNAL_AUTH_SECRET=.*|INTERNAL_AUTH_SECRET=$(openssl rand -hex 32)|" .env
sed -i "s|^ADMIN_API_KEY=.*|ADMIN_API_KEY=$(openssl rand -hex 32)|" .env
sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=$(openssl rand -hex 32)|" .env
sed -i "s|^ORIGIN_SHARED_SECRET=.*|ORIGIN_SHARED_SECRET=$(openssl rand -hex 32)|" .env
sed -i 's|^DOMAIN_NAME=.*|DOMAIN_NAME=surgeguard-innotech.duckdns.org|' .env
sed -i 's|^EC2_PUBLIC_IP=.*|EC2_PUBLIC_IP=3.109.184.177|' .env
sed -i 's|^PUBLIC_SITE_URL=.*|PUBLIC_SITE_URL=https://surgeguard-innotech.duckdns.org|' .env
```

---

### 5 DuckDNS Domains Architecture

SurgeGuard serves 5 distinct entry points via Nginx Server Name Indication (SNI) on standard HTTPS (port 443), eliminating the need for non-standard ports:

| Domain | Surface | Target Upstream | Key Purpose |
| :--- | :--- | :--- | :--- |
| **`surgeguard-innotech.duckdns.org`** | Main Control Center | `sg_frontend` (Port 3000) | Landing page, architectural breakdown, features & showcase |
| **`surgeguard-protected.duckdns.org`** | Protected Gateway Demo | `origin_pool` via `auth_request` | High-stakes University Exam Results portal behind fair FIFO waiting room |
| **`surgeguard-direct.duckdns.org`** | Unprotected Direct Demo | `origin_direct` (Port 8000) | Deliberately fragile baseline origin; returns 503 Overloaded under surge |
| **`surgeguard-admin.duckdns.org`** | Admin Console | `sg_frontend` (Port 3000) | Real-time queue visualizer, token capacity & admission controls |
| **`surgeguard-monitor.duckdns.org`** | Observability Dashboards | `sg_grafana` (Port 3000) | Live Grafana SRE metrics & Prometheus telemetry dashboards |

---

## 6. Self-Signed TLS Certificate with SAN

SurgeGuard terminates HTTPS at the Nginx reverse proxy using a single 2048-bit RSA self-signed certificate that includes **Subject Alternative Names (SAN)** for all 5 DuckDNS domains, localhost, and the public IP.

### Certificate Attributes
- **Common Name (CN):** `surgeguard-innotech.duckdns.org`
- **SAN DNS 1:** `surgeguard-innotech.duckdns.org`
- **SAN DNS 2:** `surgeguard-protected.duckdns.org`
- **SAN DNS 3:** `surgeguard-direct.duckdns.org`
- **SAN DNS 4:** `surgeguard-admin.duckdns.org`
- **SAN DNS 5:** `surgeguard-monitor.duckdns.org`
- **SAN DNS 6:** `localhost`
- **SAN IP 1:** `3.109.184.177`
- **SAN IP 2:** `127.0.0.1`
- **Signature Algorithm:** `SHA256WithRSA`
- **Validity:** 365 days
- **Host Location:** `/root/SurgeGuard/certs/surgeguard.crt` and `surgeguard.key`
- **Nginx Container Path:** `/etc/nginx/certs/surgeguard.crt` and `surgeguard.key`

### Generation Script

Execute on the EC2 host:

```bash
bash scripts/generate-ssl-certs.sh
```

Or manually:

```bash
mkdir -p certs
cat > /tmp/san.cnf <<EOF
[req]
default_bits       = 2048
distinguished_name = req_distinguished_name
prompt             = no
x509_extensions    = v3_req

[req_distinguished_name]
CN = surgeguard-innotech.duckdns.org

[v3_req]
basicConstraints = CA:FALSE
keyUsage         = nonRepudiation, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName   = @alt_names

[alt_names]
DNS.1 = surgeguard-innotech.duckdns.org
DNS.2 = localhost
IP.1  = 3.109.184.177
IP.2  = 127.0.0.1
EOF

openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout certs/surgeguard.key \
  -out certs/surgeguard.crt \
  -config /tmp/san.cnf

chmod 750 certs
chmod 644 certs/surgeguard.crt
chmod 640 certs/surgeguard.key
rm /tmp/san.cnf
```

### Inspecting Certificate SAN & Expiry

```bash
# Check Subject Alternative Names
openssl x509 -in certs/surgeguard.crt -noout -text | grep -A1 "Subject Alternative Name"

# Check Expiration Date
openssl x509 -in certs/surgeguard.crt -noout -dates
```

---

## 7. Nginx TLS & Redirection Configuration

In [proxy/nginx/templates/sg-site.conf.template](file:///x:/Django/Django_Project/SurgeGuard/proxy/nginx/templates/sg-site.conf.template):

1. **Port 8080 (Mapped from host :80):**
   ```nginx
   server {
       listen 8080;
       server_name _;

       location = /healthz {
           default_type text/plain;
           return 200 "ok\n";
       }

       location / {
           return 301 https://$host$request_uri;
       }
   }
   ```
2. **Port 8443 (Mapped from host :443 and :8088):**
   ```nginx
   server {
       listen 8443 ssl;
       server_name _;

       ssl_certificate /etc/nginx/certs/surgeguard.crt;
       ssl_certificate_key /etc/nginx/certs/surgeguard.key;
       ssl_protocols TLSv1.2 TLSv1.3;
       ssl_prefer_server_ciphers on;
       ssl_ciphers HIGH:!aNULL:!MD5;
       ssl_session_cache shared:SSL:10m;
       ssl_session_timeout 1d;

       # Auto-redirect plain HTTP sent to HTTPS port
       error_page 497 =301 https://$http_host$request_uri;

       # Proxy to origin pool with admission token validation
       ...
   }
   ```

3. **Docker Compose Port Binding:**
   ```yaml
   nginx:
     volumes:
       - ./certs:/etc/nginx/certs:ro
     ports:
       - "${BIND_ADDRESS}:80:8080"
       - "${BIND_ADDRESS}:443:8443"
       - "${BIND_ADDRESS}:${PROTECTED_PORT}:8443"
       - "${BIND_ADDRESS}:${DIRECT_PORT}:8081"
   ```

---

## 8. DuckDNS IP Updates

The domain `surgeguard-innotech.duckdns.org` maps directly to EC2 IP `3.109.184.177`.

### Updating DuckDNS Records
If the EC2 instance is rebooted without an Elastic IP and acquires a new IPv4:

```bash
# Update DuckDNS via HTTP API
curl "https://www.duckdns.org/update?domains=surgeguard-innotech&token=YOUR_DUCKDNS_TOKEN&ip=NEW_EC2_IP"
```

### Verifying DNS Resolution

```powershell
Resolve-DnsName surgeguard-innotech.duckdns.org
```

---

## 9. Browser Trust & Client Verification

Because this is a **self-signed certificate**, browsers and automated HTTP clients will display a security warning (e.g. `NET::ERR_CERT_AUTHORITY_INVALID` in Google Chrome).

### Expected Behavior
- **Browser:** Displays *"Your connection is not private"*. Clicking *Advanced -> Proceed to surgeguard-innotech.duckdns.org (unsafe)* will establish the encrypted HTTPS session.
- **cURL / CLI:**
  ```bash
  # Test with self-signed certificate inspection
  curl.exe -Iv https://surgeguard-innotech.duckdns.org/

  # Trusting explicitly using the host certificate
  curl.exe --cacert certs/surgeguard.crt https://surgeguard-innotech.duckdns.org/
  ```

### Safe Trust Installation (Optional)
To trust the certificate without warnings:
- **Windows:** Double click `surgeguard.crt` -> *Install Certificate* -> *Place all certificates in the following store* -> *Trusted Root Certification Authorities*.
- **Ubuntu / Debian:**
  ```bash
  sudo cp certs/surgeguard.crt /usr/local/share/ca-certificates/surgeguard.crt
  sudo update-ca-certificates
  ```

---

## 10. Terraform Deployment & Validation Commands

All infrastructure files are located under [infra/terraform/](file:///x:/Django/Django_Project/SurgeGuard/infra/terraform/).

```bash
cd infra/terraform

# 1. Format code
terraform fmt

# 2. Validate syntax & resource schemas
terraform validate

# 3. Review proposed changes
terraform plan

# 4. Apply changes (attaches SG to EC2, opens 80/443/22)
terraform apply -auto-approve
```

---

## 11. Troubleshooting & Rollback

### If Port 80 / 443 Do Not Connect
1. Verify Docker container status:
   ```bash
   docker compose ps nginx
   ```
2. Verify host listening ports:
   ```bash
   sudo ss -tulpn | grep -E ':80|:443|:8088'
   ```
3. Check Nginx container error logs:
   ```bash
   docker compose logs --tail=50 nginx
   ```

### Rolling Back Changes
1. If the new security group causes issues, the original security group `sg-03048ded2a039015a` is still attached to the instance and was preserved.
2. In `infra/terraform`:
   ```bash
   # Revert terraform changes without touching EC2
   terraform apply -var="enable_ssh=true"
   ```
3. `terraform destroy` is **strictly prohibited** to protect production state.
