<#
.SYNOPSIS
  Deploy Villa Gianni and/or Baradzanwa to the Hetzner VPS from your PC over SSH.

.DESCRIPTION
  Pulls origin/main, installs production dependencies, builds, and RESTARTS the
  pm2 process so the change actually goes live. This fixes the gap in the original
  PARTNER_DEPLOYMENT_GUIDE, whose commands only ran `git pull && npm run build`
  and never `npm ci` or `pm2 restart` — so new dependencies were skipped and every
  backend (server/index.cjs, API route) change never took effect on the running app.

.PARAMETER Target
  villa | baradzanwa | both   (default: both)

.PARAMETER KeyPath
  Path to your private key (default: $HOME\.ssh\partner_hetzner_key)

.EXAMPLE
  .\deploy-from-pc.ps1                      # deploy both apps
  .\deploy-from-pc.ps1 -Target baradzanwa   # deploy just Baradzanwa
#>
param(
  [ValidateSet('villa', 'baradzanwa', 'both')] [string] $Target = 'both',
  [string] $KeyPath = "$HOME\.ssh\partner_hetzner_key"
)

$ErrorActionPreference = 'Stop'
$Server = 'root@178.104.176.191'

if (-not (Test-Path $KeyPath)) {
  Write-Host "Private key not found at: $KeyPath" -ForegroundColor Red
  Write-Host "Get 'partner_hetzner_key' from the admin, save it there, then lock its permissions:" -ForegroundColor Yellow
  Write-Host "  icacls `"$KeyPath`" /inheritance:r /grant:r `"$($env:USERNAME):R`"" -ForegroundColor Yellow
  exit 1
}

function Deploy-App {
  param([string] $Dir, [string] $Pm2Name, [string] $Label)
  Write-Host "`n=== Deploying $Label ===" -ForegroundColor Cyan
  # pull -> install prod deps -> build -> restart pm2 (so the change goes live)
  $remote = "cd $Dir && git pull origin main && npm ci --omit=dev && npm run build && pm2 restart $Pm2Name --update-env && echo DEPLOY_OK"
  ssh -i $KeyPath -o StrictHostKeyChecking=no $Server $remote
  if ($LASTEXITCODE -ne 0) { Write-Host "$Label deploy FAILED (exit $LASTEXITCODE)" -ForegroundColor Red; exit 1 }
  Write-Host "$Label deployed." -ForegroundColor Green
}

# 1. Connection test
Write-Host "Testing SSH connection to $Server ..." -ForegroundColor Cyan
ssh -i $KeyPath -o StrictHostKeyChecking=no $Server "echo Connection OK"
if ($LASTEXITCODE -ne 0) {
  Write-Host "SSH connection failed. Confirm the admin added the matching PUBLIC key to the server's authorized_keys." -ForegroundColor Red
  exit 1
}

# 2. Deploy
if ($Target -eq 'villa' -or $Target -eq 'both')      { Deploy-App '/var/www/villa-gianni' 'villa-gianni-api' 'Villa Gianni' }
if ($Target -eq 'baradzanwa' -or $Target -eq 'both') { Deploy-App '/var/www/baradzanwa'   'baradzanwa-api'   'Baradzanwa' }

Write-Host "`nAll done." -ForegroundColor Green
