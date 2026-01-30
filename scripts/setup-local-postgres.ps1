<#
 .SYNOPSIS
  Installs and configures a local PostgreSQL Server for COREPMS, initializes schema to match Supabase.

 .DESCRIPTION
  - Downloads and installs PostgreSQL for Windows
  - Configures listen_addresses and pg_hba.conf to allow local subnet
  - Creates database and applies supabase/schema.sql and supabase/seed_data.sql
  - Requires Administrator privileges

 .USAGE
  Run PowerShell as Administrator:
    powershell -ExecutionPolicy Bypass -File scripts/setup-local-postgres.ps1 -DbName corepms_db -DbUser postgres -DbPassword "StrongPass123" -Subnet "192.168.1.0/24"

 .PARAMETERS
  -DbName: Database name to create
  -DbUser: Admin user
  -DbPassword: Admin password
  -Port: PostgreSQL port (default 5432)
  -Subnet: CIDR of local network to allow (e.g., 192.168.1.0/24)
#>

param(
  [string]$DbName = "corepms_db",
  [string]$DbUser = "postgres",
  [string]$DbPassword = "postgres",
  [int]$Port = 5432,
  [string]$Subnet = "192.168.1.0/24"
)

function Ensure-Admin() {
  $currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($currentIdentity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error "Please run this script as Administrator."
    exit 1
  }
}

function Install-Postgres {
  Write-Host "Installing PostgreSQL..." -ForegroundColor Cyan
  $pgVersion = "16"
  $downloadUrl = "https://get.enterprisedb.com/postgresql/postgresql-$pgVersion.0-1-windows-x64.exe"
  $installerPath = "$env:TEMP\postgresql-$pgVersion-installer.exe"
  try {
    Invoke-WebRequest -Uri $downloadUrl -OutFile $installerPath -UseBasicParsing
  } catch {
    Write-Warning "Failed to download installer: $_"
  }

  if (Test-Path $installerPath) {
    Write-Host "Running PostgreSQL installer..." -ForegroundColor Cyan
    & $installerPath --mode unattended --unattendedmodeui minimal --superpassword "$DbPassword" --servicename "postgresql-x64-$pgVersion" --serviceaccount "NT AUTHORITY\NetworkService" --serverport $Port | Out-Null
  } else {
    Write-Warning "Installer not found; please install PostgreSQL manually and re-run."
  }
}

function Configure-Postgres {
  Write-Host "Configuring PostgreSQL for remote connections..." -ForegroundColor Cyan
  $pgData = "C:\Program Files\PostgreSQL\$pgVersion\data"
  if (-not (Test-Path $pgData)) {
    # Try common alternative path
    $pgData = "C:\Program Files\PostgreSQL\$pgVersion\data"
  }

  $postgresqlConf = Join-Path $pgData "postgresql.conf"
  $pgHbaConf = Join-Path $pgData "pg_hba.conf"
  if (Test-Path $postgresqlConf) {
    (Get-Content $postgresqlConf) | ForEach-Object {
      $_
    } | Set-Content $postgresqlConf
    Add-Content $postgresqlConf "listen_addresses = '*'"
    Add-Content $postgresqlConf "port = $Port"
  }

  if (Test-Path $pgHbaConf) {
    Add-Content $pgHbaConf "host    all             all             $Subnet            md5"
  }

  Write-Host "Restarting PostgreSQL service..." -ForegroundColor Cyan
  $svcName = "postgresql-x64-$pgVersion"
  Try { Restart-Service -Name $svcName -ErrorAction Stop } Catch { Write-Warning "Failed to restart service: $_" }
}

function Initialize-Database {
  Write-Host "Initializing database and applying schema..." -ForegroundColor Cyan
  $psql = "C:\Program Files\PostgreSQL\$pgVersion\bin\psql.exe"
  if (-not (Test-Path $psql)) { $psql = "psql" }
  $schemaPath = "$(Resolve-Path ./supabase/schema.sql)"
  $seedPath = "$(Resolve-Path ./supabase/seed_data.sql)"
  $env:PGPASSWORD = $DbPassword
  try {
    # Avoid PowerShell escaping issues: pass a simple, unquoted identifier for DB name
    & $psql -h localhost -p $Port -U $DbUser -c "CREATE DATABASE $DbName;" | Out-Null
  } catch {
    Write-Warning "CREATE DATABASE failed (may already exist): $_"
  }

  # Ensure pgcrypto is available for functions like gen_random_uuid()
  try {
    & $psql -h localhost -p $Port -U $DbUser -d $DbName -c "CREATE EXTENSION IF NOT EXISTS pgcrypto;" | Out-Null
  } catch {
    Write-Warning "Failed to create pgcrypto extension: $_"
  }

  # Apply schema and seed if files exist; fail gracefully if incompatible (e.g., Supabase-specific objects)
  if (Test-Path $schemaPath) {
    try {
      & $psql -h localhost -p $Port -U $DbUser -d $DbName -f $schemaPath | Out-Null
    } catch {
      Write-Warning "Applying schema failed: $_"
    }
  }
  if (Test-Path $seedPath) {
    try {
      & $psql -h localhost -p $Port -U $DbUser -d $DbName -f $seedPath | Out-Null
    } catch {
      Write-Warning "Applying seed data failed: $_"
    }
  }
}

Ensure-Admin
try {
  $pgVersion = "16"
  Install-Postgres
  Configure-Postgres
  Initialize-Database
  Write-Host "PostgreSQL setup completed successfully." -ForegroundColor Green
} catch {
  Write-Error "Setup failed: $_"
}
