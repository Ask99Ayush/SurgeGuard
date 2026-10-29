<div align="center">

# ☁️ SurgeGuard — AWS Cloud Infrastructure & Terraform

### <i>Production Infrastructure as Code, Dynamic DNS, SSH & Self-Signed HTTPS</i>

**Detailed architectural guide for Terraform provisioning, EC2 firewall controls, manual SSH key management, DuckDNS resolution, and TLS termination in AWS `ap-south-1` (Mumbai).**

[![Terraform](https://img.shields.io/badge/Terraform-1.10+-844FBA?style=for-the-badge&logo=terraform&logoColor=white)](https://www.terraform.io/)
[![AWS](https://img.shields.io/badge/AWS-ap--south--1-FF9900?style=for-the-badge&logo=amazon-aws&logoColor=white)](https://aws.amazon.com/)
[![Ubuntu](https://img.shields.io/badge/Ubuntu-26.04_LTS-E95420?style=for-the-badge&logo=ubuntu&logoColor=white)](https://ubuntu.com/)
[![Nginx](https://img.shields.io/badge/Nginx-TLS_1.3-009639?style=for-the-badge&logo=nginx&logoColor=white)](https://nginx.org/)

<br/>

[🛡️ Main README](README.md) • [📐 Architecture](docs/architecture.md) • [🚀 Deployment](docs/deployment.md) • [🔒 Security](docs/security.md)

</div>

---

<div align="center">

### <i>"Zero paid cloud overhead. Zero SSM dependencies. Strict network isolation with self-signed TLS SAN termination."</i>

</div>

---

## 📑 Clickable Table of Contents

- [📐 1. Architecture Overview](#1-architecture-overview)
- [📋 2. Infrastructure Inventory & Resources](#2-infrastructure-inventory-resources)
- [🛡️ 3. Security Group Firewall Rules](#3-security-group-firewall-rules)
  - [Public Ingress Rules](#public-ingress-rules)
  - [Private / Prohibited Services (Zero Ingress)](#private-prohibited-services-zero-ingress)
- [🚫 4. Removal of Systems Manager (SSM) Dependencies](#4-removal-of-systems-manager-ssm-dependencies)
- [🔐 5. EC2-Local `.env` Configuration & Secret Hygiene(#5-ec2-local-env-configuration--secret-hygiene)
  - [Secret Hygiene Rules](#secret-hygiene-rules)
  - [Initializing `.env` on a Fresh Host(#initializing-env-on-a-fresh-host)
- [🌐 6. DuckDNS Domains & SNI Architecture](#6-duckdns-domains-sni-architecture)
- [📜 7. Self-Signed TLS Certificate with SAN](#7-self-signed-tls-certificate-with-san)
  - [Certificate Attributes](#certificate-attributes)
  - [Automated Generation Script](#automated-generation-script)
  - [Manual Certificate Generation](#manual-certificate-generation)
  - [Verifying Certificate Attributes](#certificate-attributes)
- [⚙️ 8. Nginx TLS & Redirection Configuration](#8-nginx-tls-redirection-configuration)
- [🔄 9. DuckDNS Dynamic IP Updates](#9-duckdns-dynamic-ip-updates)
- [🖥️ 10. Browser Trust & Client Verification](#10-browser-trust-client-verification)
- [💻 11. Terraform Deployment & Validation Commands](#11-terraform-deployment-validation-commands)
- [🔧 12. Troubleshooting & Rollback Procedures](#12-troubleshooting-rollback-procedures)

---

## 📐 1. Architecture Overview

SurgeGuard operates directly on an existing high-performance Ubuntu EC2 instance within AWS Asia Pacific (Mumbai), providing robust edge routing, virtual waiting rooms, and container isolation without requiring expensive load balancers or NAT gateways:

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

## 📋 2. Infrastructure Inventory & Resources

| Component | Identifier | Status | Purpose & Description |
| :--- | :--- | :--- | :--- |
| **AWS Region** | `ap-south-1` (Mumbai) | **Active** | Primary AWS deployment datacenter location. |
| **EC2 Instance** | `i-0d9a4f57ebcff0048` | **Running** | Hosts the Docker Compose stack (`m7i-flex.large`). |
| **Public IPv4** | `3.109.184.177` | **Static / Attached** | Primary public entry point for web ingress and SSH. |
| **VPC** | `vpc-05d75fcdd443aa2a9` | **Active** | AWS Default Virtual Private Cloud. |
| **Subnet** | `subnet-02e45f3e18dcaa427` | **Active** | Public Subnet in `ap-south-1a`. |
| **Dynamic Domain** | `surgeguard-innotech.duckdns.org` | **Resolved** | DuckDNS dynamic DNS record pointing to `3.109.184.177`. |
| **Terraform Security Group** | `sg-095cd8eb865168e49` | **Attached** | Manages ingress firewall rules for ports 22, 80, 443, 8088, 3000, 3001, 8081. |
| **SSH Key Pair** | `SurgeGuard` (`SurgeGuard.pem`) | **Private** | Public-key authentication for administrative user `ubuntu`. |

---

## 🛡️ 3. Security Group Firewall Rules

Terraform controls `sg-095cd8eb865168e49`, bound directly to network interface `eni-0e5e4d49cce7bad12`.

### Public Ingress Rules

| Protocol | Port | Source CIDR | Target Service | Security Rationale & Notes |
| :--- | :--- | :--- | :--- | :--- |
| **TCP** | `22` | `0.0.0.0/0` | **SSH Administration** | Public-key authentication strictly required (`SurgeGuard.pem`). Password login is disabled. |
| **TCP** | `80` | `0.0.0.0/0` | **HTTP Web Ingress** | Nginx listens on 8080 and automatically returns a permanent `301 Moved Permanently` to HTTPS. |
| **TCP** | `443` | `0.0.0.0/0` | **HTTPS TLS Gateway** | Nginx TLS termination on port 8443 using 2048-bit self-signed certificate. |
| **TCP** | `8088` | `0.0.0.0/0` | **SurgeGuard Edge** | Direct edge port mapping to HTTPS gateway. |
| **TCP** | `3000` | `0.0.0.0/0` | **Admin Console** | Next.js operator and queue management dashboard (Bcrypt login protected). |
| **TCP** | `3001` | `0.0.0.0/0` | **Grafana Observability** | SRE metrics and Prometheus dashboards (Basic Auth protected). |
| **TCP** | `8081` | `0.0.0.0/0` | **Unprotected Origin** | Baseline fragile demo origin without admission queue (for side-by-side 503 testing). |

### Private / Prohibited Services (Zero Ingress)

| Service | Container Port | Network Boundary | Security Posture |
| :--- | :--- | :--- | :--- |
| **FastAPI Queue API** | `8000` | Docker Internal (`app`, `data`) | **STRICTLY PRIVATE**. Revoked from security group; no port exposure to host. |
| **Redis Queue Store** | `6379` | Docker Internal (`data`) | **STRICTLY PRIVATE**. Password protected; unexposed to host interface. |

> [!CAUTION]
> **SSH Attack Surface Warning:** Opening port `22` to `0.0.0.0/0` allows arbitrary Internet IP addresses to initiate SSH handshakes. While public-key authentication is enforced and password login is disabled, it is strongly recommended in production to restrict SSH ingress to your office or bastion CIDR (e.g. `your-ip/32`) in `terraform.tfvars`.

---

## 🚫 4. Removal of Systems Manager (SSM) Dependencies

To eliminate unnecessary AWS service dependencies, simplify the deployment model, and adhere to zero-trust secret handling:

1. **No SSM Managed Core Policy:** Removed `arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore` from IAM role attachments.
2. **No SSM Parameter Store Reads:** User-data scripts and bootstrap processes do not query SSM Parameter Store.
3. **No Session Manager Assumptions:** Management is strictly manual SSH via private key authentication.
4. **No SSM AMI Lookups:** Terraform uses standard `aws_ami` data sources (`data.aws_ami.amazon_linux`) instead of SSM parameters.
5. **Zero Paid Cloud Overhead:** Application Load Balancer (`enable_alb = false`), Auto Scaling Group (`enable_asg = false`), and NAT Gateways are disabled by default.

---

## 🔐 5. EC2-Local `.env` Configuration & Secret Hygiene

Application secrets and environment variables are maintained in a dedicated `.env` file directly on the EC2 host.

### Secret Hygiene Rules

- **Never committed to Git:** `.env`, `.env.*`, `*.key`, `*.pem`, `*.crt` are ignored in [.gitignore](.gitignore).
- **Never in Terraform State:** Production passwords, cryptographic signing keys, and token secrets are excluded from Terraform `.tfvars`, state files, and outputs.
- **Restrictive File Permissions:** The `.env` file on EC2 is restricted with `chmod 600 .env` so that only the deploying user/root can read it.
- **Docker Build Context:** `.dockerignore` excludes `.env` to prevent secrets from baking into image layers.

### Initializing `.env` on a Fresh Host

```bash
# 1. SSH into the EC2 instance
ssh -i SurgeGuard.pem ubuntu@3.109.184.177

# 2. Navigate to project root
cd /opt/surgeguard/app

# 3. Copy template and restrict permissions immediately
umask 077
cp .env.example .env
chmod 600 .env

# 4. Populate required secrets with cryptographically random keys
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

## 🌐 6. DuckDNS Domains & SNI Architecture

SurgeGuard supports multi-surface routing via Nginx Server Name Indication (SNI) on standard HTTPS (port 443):

| Domain | Surface | Target Upstream | Key Purpose |
| :--- | :--- | :--- | :--- |
| **`surgeguard-innotech.duckdns.org`** | Main Control Center | `sg_frontend` (Port 3000) | Landing page, architectural breakdown, features & showcase |
| **`surgeguard-protected.duckdns.org`** | Protected Gateway Demo | `origin_pool` via `auth_request` | High-stakes University Exam Results portal behind fair FIFO waiting room |
| **`surgeguard-direct.duckdns.org`** | Unprotected Direct Demo | `origin_direct` (Port 8000) | Deliberately fragile baseline origin; returns 503 Overloaded under surge |
| **`surgeguard-admin.duckdns.org`** | Admin Console | `sg_frontend` (Port 3000) | Real-time queue visualizer, token capacity & admission controls |
| **`surgeguard-monitor.duckdns.org`** | Observability Dashboards | `sg_grafana` (Port 3000) | Live Grafana SRE metrics & Prometheus telemetry dashboards |

---

## 📜 7. Self-Signed TLS Certificate with SAN

SurgeGuard terminates HTTPS at the Nginx reverse proxy using a single 2048-bit RSA self-signed certificate with **Subject Alternative Names (SAN)** for all 5 DuckDNS domains, localhost, and the public IP.

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
- **Host Location:** `certs/surgeguard.crt` and `certs/surgeguard.key`
- **Nginx Container Path:** `/etc/nginx/certs/surgeguard.crt` and `surgeguard.key`

### Automated Generation Script

Execute on the EC2 host or locally:

```bash
# On Linux / EC2:
bash scripts/generate-ssl-certs.sh

# On Windows (PowerShell):
powershell -ExecutionPolicy Bypass -File scripts/generate-ssl-certs.ps1
```

### Manual Certificate Generation

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
DNS.2 = surgeguard-protected.duckdns.org
DNS.3 = surgeguard-direct.duckdns.org
DNS.4 = surgeguard-admin.duckdns.org
DNS.5 = surgeguard-monitor.duckdns.org
DNS.6 = localhost
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

### Verifying Certificate Attributes

```bash
# Inspect Subject Alternative Names (SAN)
openssl x509 -in certs/surgeguard.crt -noout -text | grep -A2 "Subject Alternative Name"

# Check Expiration Dates
openssl x509 -in certs/surgeguard.crt -noout -dates
```

---

## ⚙️ 8. Nginx TLS & Redirection Configuration

In [`proxy/nginx/templates/sg-site.conf.template`](proxy/nginx/templates/sg-site.conf.template):

### 1. HTTP to HTTPS Auto-Redirect (Port 8080)
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

### 2. HTTPS TLS Termination (Port 8443)
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

---

## 🔄 9. DuckDNS Dynamic IP Updates

The domain `surgeguard-innotech.duckdns.org` maps directly to EC2 IP `3.109.184.177`.

If the EC2 instance is rebooted and acquires a new IPv4:

```bash
# Update DuckDNS via HTTP API
curl "https://www.duckdns.org/update?domains=surgeguard-innotech&token=YOUR_DUCKDNS_TOKEN&ip=NEW_EC2_IP"
```

Verify DNS resolution:

```powershell
Resolve-DnsName surgeguard-innotech.duckdns.org
```

---

## 🖥️ 10. Browser Trust & Client Verification

Because this is a **self-signed certificate**, web browsers display an initial security warning (`NET::ERR_CERT_AUTHORITY_INVALID`).

### Expected Behavior

* **Browser:** Displays *"Your connection is not private"*. Click **Advanced → Proceed to surgeguard-innotech.duckdns.org (unsafe)** to establish the encrypted HTTPS session.
* **cURL CLI:**
  ```bash
  # Check connection with self-signed certificate
  curl.exe -Iv https://surgeguard-innotech.duckdns.org/

  # Trust explicitly using the certificate file
  curl.exe --cacert certs/surgeguard.crt https://surgeguard-innotech.duckdns.org/
  ```

### Installing CA Trust on Local Machine (Optional)

* **Windows:** Double-click `certs/surgeguard.crt` → *Install Certificate* → *Local Machine* → *Place all certificates in the following store* → *Trusted Root Certification Authorities*.
* **Ubuntu / Debian:**
  ```bash
  sudo cp certs/surgeguard.crt /usr/local/share/ca-certificates/surgeguard.crt
  sudo update-ca-certificates
  ```

---

## 💻 11. Terraform Deployment & Validation Commands

All infrastructure files are located under [`infra/terraform/`](infra/terraform/).

```bash
cd infra/terraform

# 1. Format code according to HashiCorp standards
terraform fmt

# 2. Validate syntax & resource schemas
terraform validate

# 3. Review proposed changes against live state
terraform plan

# 4. Apply changes (attaches SG to EC2, opens 80/443/22)
terraform apply -auto-approve
```

---

## 🔧 12. Troubleshooting & Rollback Procedures

### If Port 80 / 443 Do Not Connect
1. Check Docker container status:
   ```bash
   docker compose ps nginx
   ```
2. Verify host listening ports:
   ```bash
   sudo ss -tulpn | grep -E ':80|:443|:8088'
   ```
3. Inspect Nginx container error logs:
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

---

<div align="center">

### 🛡️ SurgeGuard Cloud Infrastructure

[Back to Main README](README.md) • [Back to Top ⬆️](#surgeguard-aws-cloud-infrastructure-terraform)

</div>
