<#
 .SYNOPSIS
  Initializes COREPMS database on an existing PostgreSQL installation.

 .DESCRIPTION
  - Creates corepms_db database
  - Creates pgcrypto extension
  - Applies supabase/schema.sql and supabase/seed_data.sql
  - Does NOT install or configure PostgreSQL server (assumes it is running)

 .USAGE
  powershell -ExecutionPolicy Bypass -File scripts/setup-db-only.ps1 -DbPassword "MyPassword"
#>

param(
  [string]$DbName = "corepms_db",
  [string]$DbUser = "postgres",
  [string]$DbPassword = "postgres",
  [int]$Port = 5432
)

function Find-Psql {
    # Try finding psql in PATH first
    if (Get-Command "psql" -ErrorAction SilentlyContinue) {
        return "psql"
    }

    # Try common installation paths
    $ProgramFiles = "C:\Program Files\PostgreSQL"
    if (Test-Path $ProgramFiles) {
        $versions = Get-ChildItem $ProgramFiles | Where-Object { $_.PSIsContainer }
        foreach ($v in $versions) {
            $path = Join-Path $v.FullName "bin\psql.exe"
            if (Test-Path $path) {
                return $path
            }
        }
    }
    
    return ""
}

$psql = Find-Psql
if (-not $psql) {
    Write-Error "Could not find psql.exe. Please ensure PostgreSQL is installed and psql is in your PATH or standard installation directory."
    exit 1
}

Write-Host "Using psql from: $psql" -ForegroundColor Cyan
Write-Host "Initializing database $DbName..." -ForegroundColor Cyan

$env:PGPASSWORD = $DbPassword
$schemaPath = "$(Resolve-Path ./supabase/schema.sql)"
$seedPath = "$(Resolve-Path ./supabase/seed_data.sql)"

try {
    # Create DB
    & $psql -h localhost -p $Port -U $DbUser -c "CREATE DATABASE $DbName;" | Out-Null
} catch {
    Write-Warning "CREATE DATABASE failed (may already exist or bad password): $_"
}

try {
    # Create Extension
    & $psql -h localhost -p $Port -U $DbUser -d $DbName -c "CREATE EXTENSION IF NOT EXISTS pgcrypto;" | Out-Null
} catch {
    Write-Warning "Failed to create pgcrypto extension: $_"
}

if (Test-Path $schemaPath) {
    Write-Host "Applying schema..." -ForegroundColor Cyan
    try {
        & $psql -h localhost -p $Port -U $DbUser -d $DbName -f $schemaPath | Out-Null
    } catch {
        Write-Warning "Applying schema failed: $_"
    }
}

if (Test-Path $seedPath) {
    Write-Host "Applying seed data..." -ForegroundColor Cyan
    try {
        & $psql -h localhost -p $Port -U $DbUser -d $DbName -f $seedPath | Out-Null
    } catch {
        Write-Warning "Applying seed data failed: $_"
    }
}

Write-Host "Database initialization completed." -ForegroundColor Green
