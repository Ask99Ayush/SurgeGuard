# Deployment

## Local (implemented, tested)

```bash
make setup     # .env with generated secrets (prints admin + Grafana passwords once)
make up        # build, start, wait for health
make health    # status + route probes
make down      # stop (keeps volumes); make clean also deletes volumes
```

## AWS (written and validated offline; never applied from this repository)

`infra/terraform` creates: a VPC with public/private subnets in ≥2 AZs, optional single NAT gateway,
an ALB (HTTP, or HTTPS + HTTP→HTTPS redirect when `certificate_arn` is set), security groups that only
let the ALB reach the host's protected port, and an Auto Scaling group (default 1 host) from a launch
template with IMDSv2, encrypted gp3 root volume, an instance role limited to reading one Parameter
Store path, and Session Manager access instead of SSH. The AMI comes from a public SSM parameter
(Amazon Linux 2023), not a hardcoded id. The boot script installs Docker, clones `app_source_url` at
`app_version`, builds `.env` from Parameter Store and runs `docker compose up`.

What this does **not** do (planned): ElastiCache/shared Redis for more than one host, DNS records,
WAF, CloudWatch alarms, image registry/CD pipeline. The unprotected `DIRECT_PORT` is not reachable
(security groups allow only the protected port), but set `BIND_ADDRESS=127.0.0.1` anyway.

Validated here with: `terraform fmt -check -recursive`, `terraform init -backend=false`, `terraform validate`
(`make terraform-validate`). No plan or apply has been run and no AWS credentials were used.

### Connecting AWS later: exact steps

1. Authenticate with temporary credentials (SSO or an assumed role): `aws sso login --profile <p>`; `export AWS_PROFILE=<p>`.
2. Create the state bucket (versioned, SSE-KMS, restricted policy). Copy `infra/terraform/backend.tf.example` to `backend.tf` and fill it in.
3. `cp infra/terraform/.env.example infra/terraform/.env` and fill in region, CIDRs, instance type, `APP_SOURCE_URL`, `APP_VERSION`, optional `CERTIFICATE_ARN`.
4. Create the runtime config in Parameter Store, one **SecureString** per `.env` key under `/<name>/env/` (default `<project>-<environment>`), e.g. generate a production `.env` with `APP_ENV=production COOKIE_SECURE=true` and load it:
   ```bash
   while IFS='=' read -r k v; do [[ "$k" =~ ^[A-Z] ]] && aws ssm put-parameter --type SecureString --overwrite \
     --name "/surgeguard-dev/env/$k" --value "${v//\'/}"; done < .env.production
   ```
   Do not set `DIRECT_PORT` exposure or `BIND_ADDRESS=0.0.0.0` for the direct path.
5. `cd infra/terraform && scripts/terraform-env.sh init` (now with the real backend).
6. `scripts/terraform-env.sh plan -out=tfplan`, review, then `scripts/terraform-env.sh apply tfplan`.
7. Point your domain at the `load_balancer_dns_name` output. Health: the ALB checks `/waiting-room`.
8. Tear down: `scripts/terraform-env.sh destroy` (disable `ALB_DELETION_PROTECTION` first).

Cost note: the ALB, NAT gateway and EC2 instance bill per hour. Any cloud test results go in
`docs/testing.md` with measured cost; until then they are `TBD`.
