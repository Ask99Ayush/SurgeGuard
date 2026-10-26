# ==============================================================================
# SurgeGuard — Local Self-Signed TLS Certificate Generator (PowerShell)
#
# Generates a private key and X.509 certificate with Subject Alternative Names
# (SAN) matching surgeguard-innotech.duckdns.org and the host's public IP.
# ==============================================================================
[CmdletBinding()]
param(
  [string]$DomainName = 'surgeguard-innotech.duckdns.org',
  [string]$PublicIp = '3.109.184.177',
  [int]$DaysValid = 365,
  [string]$CertsDir = ''
)

if (-not $CertsDir) {
  if ($PSScriptRoot) {
    $CertsDir = (Join-Path (Split-Path $PSScriptRoot -Parent) 'certs')
  } else {
    $CertsDir = (Join-Path $PWD 'certs')
  }
}

Write-Host '[+] Generating self-signed TLS certificate for SurgeGuard...' -ForegroundColor Cyan
Write-Host ('    Domain (SAN):    {0}' -f $DomainName)
Write-Host ('    Public IP (SAN): {0}' -f $PublicIp)
Write-Host ('    Target Directory:{0}' -f $CertsDir)
Write-Host ('    Validity:        {0} days' -f $DaysValid)

if (-not (Test-Path $CertsDir)) {
  New-Item -ItemType Directory -Path $CertsDir -Force | Out-Null
}

$CertsDirResolved = (Resolve-Path $CertsDir).Path
$KeyFile = Join-Path $CertsDirResolved 'surgeguard.key'
$CertFile = Join-Path $CertsDirResolved 'surgeguard.crt'

$tempConfig = [System.IO.Path]::GetTempFileName()
$configLines = @(
  '[req]',
  'default_bits       = 2048',
  'default_md         = sha256',
  'distinguished_name = req_distinguished_name',
  'prompt             = no',
  'x509_extensions    = v3_req',
  '',
  '[req_distinguished_name]',
  'C  = IN',
  'ST = Maharashtra',
  'L  = Mumbai',
  'O  = SurgeGuard',
  'OU = Security Operations',
  ('CN = {0}' -f $DomainName),
  '',
  '[v3_req]',
  'basicConstraints     = CA:FALSE',
  'keyUsage             = nonRepudiation, digitalSignature, keyEncipherment',
  'extendedKeyUsage     = serverAuth',
  'subjectAltName       = @alt_names',
  '',
  '[alt_names]',
  ('DNS.1 = {0}' -f $DomainName),
  'DNS.2 = localhost',
  ('IP.1  = {0}' -f $PublicIp),
  'IP.2  = 127.0.0.1'
)

Set-Content -Path $tempConfig -Value $configLines -Encoding ASCII

try {
  $prevErrorAction = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'

  & openssl req -x509 -nodes -days $DaysValid -newkey rsa:2048 -keyout $KeyFile -out $CertFile -config $tempConfig 2>$null

  $ErrorActionPreference = $prevErrorAction

  Write-Host '[✓] TLS Certificate generated successfully!' -ForegroundColor Green
  Write-Host ('    Certificate: {0}' -f $CertFile)
  Write-Host ('    Private Key: {0}' -f $KeyFile)
  Write-Host ''
  Write-Host '[+] Certificate Subject Alternative Names (SAN):' -ForegroundColor Cyan
  & openssl x509 -in $CertFile -noout -text | Select-String -Pattern 'Subject Alternative Name' -Context 0,1
  Write-Host ''
  Write-Host '[+] Certificate Expiry:' -ForegroundColor Cyan
  & openssl x509 -in $CertFile -noout -dates
}
finally {
  if (Test-Path $tempConfig) {
    Remove-Item $tempConfig -Force -ErrorAction SilentlyContinue
  }
}
