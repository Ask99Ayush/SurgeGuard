# ==============================================================================
# SurgeGuard — Automated HTTPS & Domain Enabler (PowerShell)
#
# Reads DOMAIN_NAME and EC2_PUBLIC_IP from .env (no hardcoding).
# Discovers AWS VPC, subnets, and EC2 instance dynamically via AWS CLI.
# Checks / imports SSL certificates into AWS ACM and configures Terraform for HTTPS.
# ==============================================================================
param(
  [switch]$Apply = $false
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $ScriptDir
$EnvFile = Join-Path $RootDir ".env"

if (-not (Test-Path $EnvFile)) {
  Write-Error ".env file not found at $EnvFile"
  exit 1
}

Write-Host "[+] Reading configuration from $EnvFile..." -ForegroundColor Cyan

# Parse .env
$envLines = Get-Content $EnvFile
function Get-EnvVal([string]$key, [string]$defaultVal = "") {
  foreach ($line in $envLines) {
    if ($line -match "^$key=(.*)$") {
      return $matches[1].Trim().Trim('"').Trim("'")
    }
  }
  return $defaultVal
}

$DomainName = Get-EnvVal "DOMAIN_NAME" "surgeguard-innotech.duckdns.org"
$Ec2PublicIp = Get-EnvVal "EC2_PUBLIC_IP" "3.109.184.177"
$AwsRegion = Get-EnvVal "AWS_REGION" "ap-south-1"
$CertificateArn = Get-EnvVal "CERTIFICATE_ARN" ""
$InstanceId = Get-EnvVal "EXISTING_INSTANCE_ID" ""
$VpcId = Get-EnvVal "EXISTING_VPC_ID" ""
$SubnetIdsRaw = Get-EnvVal "EXISTING_SUBNET_IDS" ""
$AppPort = Get-EnvVal "APP_PORT" (Get-EnvVal "PROTECTED_PORT" "8088")
$FrontendPort = Get-EnvVal "FRONTEND_PORT" "3000"
$GrafanaPort = Get-EnvVal "GRAFANA_PORT" "3001"
$DirectPort = Get-EnvVal "DIRECT_PORT" "8081"
$SshPort = Get-EnvVal "SSH_PORT" "22"
$EnableDirectIngress = (Get-EnvVal "ENABLE_DIRECT_INGRESS" "true").ToLower()
$EnableSsh = (Get-EnvVal "ENABLE_SSH" "true").ToLower()
$AllowedIngressCidrs = Get-EnvVal "ALLOWED_INGRESS_CIDRS" '["0.0.0.0/0"]'
$InstanceType = Get-EnvVal "INSTANCE_TYPE" "t3.medium"
$AlbDeletionProtection = (Get-EnvVal "ALB_DELETION_PROTECTION" "false").ToLower()

Write-Host "[+] Domain:         $DomainName" -ForegroundColor Green
Write-Host "[+] EC2 Public IP:  $Ec2PublicIp" -ForegroundColor Green
Write-Host "[+] AWS Region:     $AwsRegion" -ForegroundColor Green

# Verify DNS resolution
Write-Host "[+] Verifying DNS resolution for $DomainName..." -ForegroundColor Cyan
try {
  $resolved = [System.Net.Dns]::GetHostAddresses($DomainName) | ForEach-Object { $_.IPAddressToString }
  Write-Host "[OK] $DomainName resolves to: $($resolved -join ', ')" -ForegroundColor Green
} catch {
  Write-Host "[!] Could not resolve $DomainName locally. Proceeding with $Ec2PublicIp" -ForegroundColor Yellow
}

# Discover EC2 instance by IP via AWS CLI if not already in .env
if (-not $InstanceId -or -not $VpcId) {
  Write-Host "[+] Discovering running EC2 instance by IP ($Ec2PublicIp)..." -ForegroundColor Cyan
  try {
    $queryStr = 'Reservations[0].Instances[0].{InstanceId:InstanceId,VpcId:VpcId,SubnetId:SubnetId}'
    $instanceRaw = aws ec2 describe-instances --region $AwsRegion --filters "Name=ip-address,Values=$Ec2PublicIp" "Name=instance-state-name,Values=running" --query $queryStr --output json
    if ($instanceRaw) {
      $instanceJson = $instanceRaw | ConvertFrom-Json
      if ($instanceJson -and $instanceJson.InstanceId) {
        $InstanceId = $instanceJson.InstanceId
        $VpcId = $instanceJson.VpcId
        Write-Host "[OK] Discovered Instance ID: $InstanceId" -ForegroundColor Green
        Write-Host "[OK] Discovered VPC ID:      $VpcId" -ForegroundColor Green
      }
    }
  } catch {
    Write-Host "[!] Could not query instance via AWS CLI: $_" -ForegroundColor Yellow
  }
} else {
  Write-Host "[OK] Using Instance ID from .env: $InstanceId" -ForegroundColor Green
  Write-Host "[OK] Using VPC ID from .env:      $VpcId" -ForegroundColor Green
}

# Discover VPC subnets across AZs if not provided in .env
$subnetIdsArray = @()
if ($SubnetIdsRaw -and $SubnetIdsRaw -ne "[]") {
  try {
    $subnetIdsArray = $SubnetIdsRaw | ConvertFrom-Json
    Write-Host "[OK] Using Subnets from .env:     $($subnetIdsArray -join ', ')" -ForegroundColor Green
  } catch {
    Write-Host "[!] Failed to parse EXISTING_SUBNET_IDS from .env: $_" -ForegroundColor Yellow
  }
}

if ($subnetIdsArray.Count -eq 0 -and $VpcId) {
  Write-Host "[+] Discovering subnets in VPC $VpcId across Availability Zones..." -ForegroundColor Cyan
  try {
    $subnetsRaw = aws ec2 describe-subnets --region $AwsRegion --filters "Name=vpc-id,Values=$VpcId" --query 'Subnets[*].SubnetId' --output json
    if ($subnetsRaw) {
      $subnetsJson = $subnetsRaw | ConvertFrom-Json
      if ($subnetsJson) {
        $subnetIdsArray = $subnetsJson
        Write-Host "[OK] Discovered Subnets:     $($subnetIdsArray -join ', ')" -ForegroundColor Green
      }
    }
  } catch {
    Write-Host "[!] Could not query subnets: $_" -ForegroundColor Yellow
  }
}

# Ensure self-signed TLS certificate with SAN exists
$CertsDir = Join-Path $RootDir "certs"
$CertFile = Join-Path $CertsDir "surgeguard.crt"
$KeyFile = Join-Path $CertsDir "surgeguard.key"

if (-not (Test-Path $CertFile) -or -not (Test-Path $KeyFile)) {
  Write-Host "[+] Generating self-signed TLS certificate with SAN for $DomainName..." -ForegroundColor Cyan
  & (Join-Path $ScriptDir "generate-ssl-certs.ps1") -DomainName $DomainName -PublicIp $Ec2PublicIp
} else {
  Write-Host "[OK] Existing TLS certificate found at $CertFile" -ForegroundColor Green
}

# Update root .env with discovered values
Write-Host "[+] Updating root .env with full configuration..." -ForegroundColor Cyan
$updates = [ordered]@{
  "DOMAIN_NAME"        = $DomainName
  "EC2_PUBLIC_IP"       = $Ec2PublicIp
  "PUBLIC_SITE_URL"     = "https://$DomainName"
  "PUBLIC_GRAFANA_URL"  = "http://${Ec2PublicIp}:${GrafanaPort}"
  "PUBLIC_DIRECT_URL"   = "http://${Ec2PublicIp}:${DirectPort}"
  "COOKIE_SECURE"       = "true"
}
if ($InstanceId) { $updates["EXISTING_INSTANCE_ID"] = $InstanceId }
if ($VpcId) { $updates["EXISTING_VPC_ID"] = $VpcId }
if ($subnetIdsArray.Count -gt 0) {
  $updates["EXISTING_SUBNET_IDS"] = "[" + (($subnetIdsArray | ForEach-Object { "`"$_`"" }) -join ",") + "]"
}
if ($CertificateArn) { $updates["CERTIFICATE_ARN"] = $CertificateArn }

$lines = [System.IO.File]::ReadAllLines($EnvFile)
$outLines = [System.Collections.Generic.List[string]]::new()
$handledKeys = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)

foreach ($l in $lines) {
  $matched = $false
  foreach ($k in $updates.Keys) {
    if ($l -match "^$k=") {
      $outLines.Add("$k=$($updates[$k])")
      $handledKeys.Add($k) | Out-Null
      $matched = $true
      break
    }
  }
  if (-not $matched) {
    $outLines.Add($l)
  }
}

foreach ($k in $updates.Keys) {
  if (-not $handledKeys.Contains($k)) {
    $outLines.Add("$k=$($updates[$k])")
  }
}

[System.IO.File]::WriteAllLines($EnvFile, $outLines)

# Write terraform.tfvars dynamically
$TfVarsFile = Join-Path $RootDir "infra\terraform\terraform.tfvars"
Write-Host "[+] Writing infra/terraform/terraform.tfvars..." -ForegroundColor Cyan

$subnetsHcl = if ($subnetIdsArray.Count -gt 0) {
  "[" + (($subnetIdsArray | ForEach-Object { "`"$_`"" }) -join ", ") + "]"
} else {
  "[]"
}

$tfvarsContent = @"
# SurgeGuard Terraform Configuration
# Generated automatically from .env and live AWS cluster state

aws_region               = "$AwsRegion"
project_name             = "surgeguard"
environment              = "dev"

domain_name              = "$DomainName"
ec2_public_ip            = "$Ec2PublicIp"
existing_instance_id     = "$InstanceId"
existing_vpc_id          = "$VpcId"
existing_subnet_ids      = $subnetsHcl
certificate_arn          = ""

# Cost and Infrastructure Controls (No paid ALB or ASG, direct EC2 self-signed TLS)
enable_alb               = false
enable_asg               = false
enable_vpc               = false

# SurgeGuard Ports matching .env
app_port                 = $AppPort
frontend_port            = $FrontendPort
grafana_port             = $GrafanaPort
direct_port              = $DirectPort
ssh_port                 = $SshPort
enable_direct_ingress    = $EnableDirectIngress
enable_ssh               = $EnableSsh

allowed_ingress_cidrs    = $AllowedIngressCidrs
instance_type            = "$InstanceType"
alb_deletion_protection  = $AlbDeletionProtection
tags                     = { Project = "SurgeGuard", ManagedBy = "terraform" }
"@

Set-Content -Path $TfVarsFile -Value $tfvarsContent
Write-Host "[OK] terraform.tfvars configured." -ForegroundColor Green

# Run Terraform Plan
$TerraformDir = Join-Path $RootDir "infra\terraform"
Push-Location $TerraformDir
try {
  Write-Host "[+] Running terraform plan..." -ForegroundColor Cyan
  terraform plan

  if ($Apply) {
    Write-Host "[+] Applying terraform configuration..." -ForegroundColor Yellow
    terraform apply -auto-approve
  }
} finally {
  Pop-Location
}

Write-Host ""
Write-Host "==============================================================================" -ForegroundColor Green
Write-Host " HTTPS Configuration Ready:" -ForegroundColor Green
Write-Host "   Domain:             https://$DomainName" -ForegroundColor White
Write-Host "   EC2 Host:           $Ec2PublicIp" -ForegroundColor White
Write-Host "   Instance ID:        $InstanceId" -ForegroundColor White
Write-Host "   VPC ID:             $VpcId" -ForegroundColor White
Write-Host "   TLS Termination:    Nginx host container (:443 with 80->443 redirect)" -ForegroundColor White
Write-Host "   Certificate SAN:    $DomainName, $Ec2PublicIp, localhost" -ForegroundColor White
Write-Host "==============================================================================" -ForegroundColor Green
Write-Host "To apply changes and reload Nginx:" -ForegroundColor Cyan
Write-Host "   docker compose up -d --build nginx" -ForegroundColor White

