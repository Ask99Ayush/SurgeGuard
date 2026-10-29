<div align="center">

# 🚀 SurgeGuard — Deployment & Operations Guide

### <i>Local Compose Environments, AWS EC2 Cloud Topology & TLS Operations</i>

**Step-by-step operational handbook for orchestrating SurgeGuard on local workstations using Docker Compose and in production on AWS `ap-south-1` (Mumbai).**

[![Docker](https://img.shields.io/badge/Docker-Compose_v2-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)
[![AWS](https://img.shields.io/badge/AWS-ap--south--1-FF9900?style=for-the-badge&logo=amazon-aws&logoColor=white)](https://aws.amazon.com/)
[![Ubuntu](https://img.shields.io/badge/Ubuntu-26.04_LTS-E95420?style=for-the-badge&logo=ubuntu&logoColor=white)](https://ubuntu.com/)
[![Terraform](https://img.shields.io/badge/Terraform-1.10+-844FBA?style=for-the-badge&logo=terraform&logoColor=white)](https://www.terraform.io/)

<br/>

[🛡️ Main README](../README.md) • [☁️ Terraform Guide](../terraform.md) • [📐 Architecture](architecture.md) • [⚙️ Configuration](configuration.md)

</div>

---

<div align="center">

### <i>"From single-laptop local development to hardened AWS production deployment in minutes."</i>

</div>

---

## 📑 Clickable Table of Contents

- [🌟 Deployment Architecture Overview](#deployment-architecture-overview)
- [💻 1. Local Workstation Deployment (Docker Compose)](#1-local-workstation-deployment-docker-compose)
  - [Prerequisites](#prerequisites)
  - [Automated Setup & Secret Generation](#automated-setup-secret-generation)
  - [Starting the Services](#starting-the-services)
  - [Health Probing & Diagnostics](#health-probing-diagnostics)
  - [Stopping & Cleanup](#stopping-cleanup)
- [☁️ 2. AWS Production Deployment (p-south-1 Mumbai)](#2-aws-production-deployment-ap-south-1-mumbai)
  - [Live Infrastructure Identifiers](#live-infrastructure-identifiers)
  - [Manual SSH Access](#manual-ssh-access)
  - [Host Secrets & EC2-Local .env Hygiene](#host-secrets-ec2-local-env-hygiene)
  - [Self-Signed TLS SAN Certificate Generation](#self-signed-tls-san-certificate-generation)
  - [Launching the Production Docker Stack](#launching-the-production-docker-stack)
  - [Terraform Infrastructure Workflow](#terraform-infrastructure-workflow)
- [🌐 3. Domain & Dynamic DNS Resolution (DuckDNS)](#3-domain-dynamic-dns-resolution-duckdns)
- [🔧 4. Backup, Disaster Recovery & Rollback Procedures](#4-backup-disaster-recovery-rollback-procedures)

---

## 🌟 Deployment Architecture Overview

SurgeGuard is architected to run identically across two primary environments:

1. **Local Workstation:** An all-in-one Docker Compose deployment binding to `127.0.0.1` for developer testing, automated k6 benchmarks, and unit verification.
2. **AWS EC2 Production (`ap-south-1`):** A hardened Ubuntu host terminating HTTPS via Nginx with self-signed SAN certificates, resolved through DuckDNS, and managed via Terraform without paid ALB overhead.

---

## 💻 1. Local Workstation Deployment (Docker Compose)

### Prerequisites

* **Git**
* **Docker Desktop** (Engine 26+, Compose v2)
* **GNU Make** and **Bash** (On Windows, use **Git Bash**)
* *Node.js 22 LTS* (Optional, for frontend unit tests)

### Automated Setup & Secret Generation

```bash
# Clone the repository
git clone https://github.com/Ask99Ayush/SurgeGuard.git
cd SurgeGuard

# Initialize .env with fresh 256-bit random secrets
make setup
```

The script copies `.env.example` to `.env`, generates random cryptographic keys for token signing, session encryption, and Redis passwords, and outputs the initial credentials.

### Starting the Services

```bash
make up
```

Docker Compose builds the images and spins up 8 containers, waiting for internal health probes to verify readiness:

* `nginx` (Edge Gateway on `:8080` & `:8081`)
* `api` (FastAPI Queue API on internal `:8000`)
* `worker` (Admission Controller Daemon)
* `redis` (Redis 7.4 with AOF persistence)
* `frontend` (Next.js 15 Console on `:3000`)
* `demo-1` & `demo-2` (Protected Origin Backends)
* `prometheus` & `grafana` (Observability stack on `:9090` & `:3001`)

### Health Probing & Diagnostics

Verify that all reverse-proxy routes, internal APIs, and databases are healthy:

```bash
make health
```

To tail live logs across all containers:

```bash
make logs
```

### Stopping & Cleanup

```bash
# Stop containers (preserves Redis queue data and metrics volumes)
make down

# Clean teardown (wipes containers, networks, and named volumes)
make clean
```

---

## ☁️ 2. AWS Production Deployment (`ap-south-1` Mumbai)

### Live Infrastructure Identifiers

| Parameter | AWS Value / Identifier | Notes |
| :--- | :--- | :--- |
| **AWS Region** | `ap-south-1` (Mumbai) | High availability Indian datacenter. |
| **EC2 Instance** | `i-0d9a4f57ebcff0048` | Ubuntu 26.04 LTS (`m7i-flex.large`). |
| **Public IPv4** | `3.109.184.177` | Static entry point. |
| **Public Domain** | `surgeguard-innotech.duckdns.org` | Dynamic DNS alias pointing to `3.109.184.177`. |
| **Security Group** | `sg-095cd8eb865168e49` | Controls ingress for ports 22, 80, 443, 8088, 3000, 3001, 8081. |
| **SSH Key** | `SurgeGuard.pem` | User: `ubuntu`. Password auth disabled. |

### Manual SSH Access

Connect to the live instance using public-key authentication:

```bash
ssh -i SurgeGuard.pem ubuntu@3.109.184.177
```

### Host Secrets & EC2-Local `.env` Hygiene

Production secrets reside directly on the EC2 host and are **never committed to Git or stored in Terraform state**:

```bash
cd /opt/surgeguard/app

# Restrict default file creation permissions
umask 077
cp .env.example .env
chmod 600 .env

# Populate production configuration
sed -i 's|^APP_ENV=.*|APP_ENV=production|' .env
sed -i 's|^COOKIE_SECURE=.*|COOKIE_SECURE=true|' .env
sed -i 's|^DEMO_LOGIN_ENABLED=.*|DEMO_LOGIN_ENABLED=false|' .env
sed -i 's|^REVIEWER_LOGIN_ENABLED=.*|REVIEWER_LOGIN_ENABLED=false|' .env
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

### Self-Signed TLS SAN Certificate Generation

Generate the 2048-bit RSA self-signed certificate matching all DuckDNS subdomains and IP SANs:

```bash
bash scripts/generate-ssl-certs.sh
```

Verifies that `certs/surgeguard.crt` and `certs/surgeguard.key` are created with `chmod 644` and `chmod 640`.

### Launching the Production Docker Stack

```bash
# Build and start all services in detached mode
docker compose up -d --build

# Verify healthy status
docker compose ps
```

### Terraform Infrastructure Workflow

To modify security group firewall rules or attach new subnets:

```bash
cd infra/terraform
terraform fmt
terraform validate
terraform plan
terraform apply
```

> [!CAUTION]
> **Strictly Avoid `terraform destroy`:** The EC2 host contains persistent queue volumes and configuration. Running destroy will detach infrastructure and risk data loss.

---

## 🌐 3. Domain & Dynamic DNS Resolution (DuckDNS)

The public domain `surgeguard-innotech.duckdns.org` maps directly to `3.109.184.177`.

If the EC2 instance is rebooted and receives a new dynamic IPv4:

```bash
# Trigger immediate DuckDNS update via cURL
curl "https://www.duckdns.org/update?domains=surgeguard-innotech&token=YOUR_DUCKDNS_TOKEN&ip=NEW_IP"
```

Verify DNS propagation:

```bash
dig +short surgeguard-innotech.duckdns.org
```

---

## 🔧 4. Backup, Disaster Recovery & Rollback Procedures

### Redis Queue & State Backups
Redis state is written continuously to an Append-Only File (`appendonly.aof`).

```bash
# Trigger an immediate background AOF rewrite
docker compose exec redis redis-cli -a "$REDIS_PASSWORD" BGREWRITEAOF

# Backup AOF snapshot
docker compose cp redis:/data/appendonlydir/ ./backups/$(date +%F)_aof/
```

### Emergency Rollback
If a configuration update or code deployment causes instability:

```bash
# 1. Rollback code to previous stable Git tag
git checkout tags/v1.0.0

# 2. Rebuild and restart the containers
docker compose up -d --build

# 3. Check health probes
bash scripts/health-check.sh
```

---

<div align="center">

### 🚀 SurgeGuard Deployment

[Back to Main README](../README.md) • [Back to Top ⬆️](#surgeguard-deployment-operations-guide)

</div>
