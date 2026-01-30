COREPMS Application Backup Manifest
===================================

Backup Date: 2026-01-19 15:45:33
Application Version: 0.3.0
Backup Type: Full Application State

Contents:
---------

1. Database Backup (db_backup/)
   - Complete PostgreSQL data directory
   - All tables, schemas, and user data
   - Size: ~52MB

2. Configuration Files (config/)
   - .env - Main environment configuration
   - .env.development - Development environment settings
   - .env.example - Example configuration template
   - .env.production - Production environment settings
   - package.json - Application dependencies and metadata

3. Backup Verification
   - Database files: 1477 files copied successfully
   - Configuration files: 5 files copied successfully
   - No errors reported during backup process

Restoration Instructions:
------------------------
1. Stop any running COREPMS instances
2. Restore database from db_backup/ to %APPDATA%\Electron\pg_data\
3. Restore configuration files as needed
4. Start COREPMS application

Notes:
------
- This backup includes all user data and application state
- Database contains all POS transactions, reservations, guest records
- Configuration preserves all custom settings and preferences