# Deployment

## Local (implemented, tested)

```bash
make setup     # .env with generated secrets (prints admin + Grafana passwords once)
make up        # build, start, wait for health
make health    # status + route probes
make down      # stop (keeps volumes); make clean also deletes volumes
```

---

## AWS Deployment (Live: `ap-south-1` Mumbai)

SurgeGuard is deployed directly on an existing EC2 instance in AWS Mumbai without costly ALB, NAT Gateway, or SSM dependencies.

### Key Deployment Identifiers
- **EC2 Instance:** `i-0d9a4f57ebcff0048` (`m7i-flex.large`, Ubuntu 26.04 LTS)
- **Public IPv4:** `3.109.184.177`
- **Domain:** `surgeguard-innotech.duckdns.org` (resolves to `3.109.184.177`)
- **VPC / Subnet:** `vpc-05d75fcdd443aa2a9` / `subnet-02e45f3e18dcaa427`
- **Terraform Security Group:** `sg-095cd8eb865168e49`
- **Manual SSH Key:** `SurgeGuard.pem` (User: `ubuntu`)

---

## 1. Secrets & EC2-Local `.env` Handling

All production secrets reside in a single EC2-local `.env` file on the instance:
- **Restrictive Permissions:** `chmod 600 .env` ensures only the owner can read secrets.
- **Git Exclusions:** `.env` and `certs/` are ignored in `.gitignore`.
- **Zero Terraform Leaks:** No secrets are passed to Terraform or stored in state.
- **SSM Removal:** Systems Manager and Parameter Store dependencies are completely removed.

### Initializing `.env` on a Fresh Host:
```bash
ssh -i SurgeGuard.pem ubuntu@3.109.184.177
cd /opt/surgeguard/app
umask 077
cp .env.example .env
chmod 600 .env
# Set APP_ENV=production, COOKIE_SECURE=true, and generate 32-byte hex secrets
```

---

## 2. Manual SSH Access

- Security Group opens TCP `22` to `0.0.0.0/0`.
- SSH public-key authentication is strictly required (`SurgeGuard.pem`).
- SSH password authentication and root login are disabled.
- **Security Recommendation:** For production, restrict source CIDR to your specific IP:
  ```hcl
  # In infra/terraform/terraform.tfvars
  allowed_ingress_cidrs = ["YOUR_IP/32"]
  ```

---

## 3. Self-Signed HTTPS & Nginx Reverse Proxy

Nginx terminates TLS using a host-generated self-signed certificate with **Subject Alternative Names (SAN)**:
- **Domain SAN:** `surgeguard-innotech.duckdns.org`
- **IP SAN:** `3.109.184.177`, `127.0.0.1`
- **Port 80:** Permanent 301 redirect to `https://$host$request_uri`
- **Port 443:** HTTPS TLS termination (maps to Nginx container `8443`)
- **Port 8088:** Protected gateway (direct HTTPS)
- **Private Services:** FastAPI API (`8000`) and Redis (`6379`) have NO ingress firewall rules and remain strictly private to Docker networks.

### Certificate Generation on EC2:
```bash
bash scripts/generate-ssl-certs.sh
```

### Starting the Stack:
```bash
docker compose up -d --build nginx
```

---

## 4. Terraform Workflow

Infrastructure changes are managed via Terraform without creating paid ALBs or replacing the running instance:

```bash
cd infra/terraform
terraform fmt
terraform validate
terraform plan
terraform apply
```

> [!CAUTION]
> **Never run `terraform destroy`:** The instance holds live queue data and volumes.
