@echo off
set /p DbPassword="Enter PostgreSQL Admin Password (default 'postgres'): "
if "%DbPassword%"=="" set DbPassword=postgres

powershell -ExecutionPolicy Bypass -File scripts/setup-db-only.ps1 -DbPassword "%DbPassword%"
pause
