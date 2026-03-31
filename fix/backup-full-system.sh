#!/bin/bash
# backup-full-system.sh
# Full system backup script for COREPMS production

set -e  # Exit on any error

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/var/backups/corepms"
DB_NAME="${DB_NAME:-corepms}"
DB_USER="${DB_USER:-root}"

echo "🔒 Starting Full System Backup - $TIMESTAMP"
echo "================================================"

# Create backup directory
mkdir -p "$BACKUP_DIR"

# 1. Database Backup
echo "📊 Step 1/5: Backing up database..."
mysqldump -u "$DB_USER" -p "$DB_NAME" > "$BACKUP_DIR/db_backup_$TIMESTAMP.sql"
echo "✓ Database backed up to: $BACKUP_DIR/db_backup_$TIMESTAMP.sql"

# 2. Application Data Backup
echo "💾 Step 2/5: Backing up application data..."
if [ -d "/var/lib/corepms/data" ]; then
    cp -r /var/lib/corepms/data "$BACKUP_DIR/app_data_$TIMESTAMP"
    echo "✓ Application data backed up to: $BACKUP_DIR/app_data_$TIMESTAMP"
else
    echo "⚠ No application data directory found, skipping..."
fi

# 3. Export Critical Data Counts
echo "🔢 Step 3/5: Recording data inventory..."
cat > "$BACKUP_DIR/data_inventory_$TIMESTAMP.json" << EOF
{
  "timestamp": "$TIMESTAMP",
  "database": "$DB_NAME",
  "tables": {
    "rooms": $(mysql -u "$DB_USER" -p -N -e "SELECT COUNT(*) FROM $DB_NAME.rooms" 2>/dev/null || echo "0"),
    "reservations": $(mysql -u "$DB_USER" -p -N -e "SELECT COUNT(*) FROM $DB_NAME.reservations" 2>/dev/null || echo "0"),
    "front_office": $(mysql -u "$DB_USER" -p -N -e "SELECT COUNT(*) FROM $DB_NAME.front_office_transactions" 2>/dev/null || echo "0"),
    "bills": $(mysql -u "$DB_USER" -p -N -e "SELECT COUNT(*) FROM $DB_NAME.bills" 2>/dev/null || echo "0")
  }
}
EOF
echo "✓ Data inventory saved to: $BACKUP_DIR/data_inventory_$TIMESTAMP.json"

# 4. Export Database Schema
echo "📋 Step 4/5: Exporting database schema..."
mysqldump -u "$DB_USER" -p --no-data "$DB_NAME" > "$BACKUP_DIR/schema_$TIMESTAMP.sql"
echo "✓ Schema exported to: $BACKUP_DIR/schema_$TIMESTAMP.sql"

# 5. Git Tag Current State
echo "🏷️  Step 5/5: Creating Git rollback tag..."
git tag -a "pre-refactor-$TIMESTAMP" -m "Safe rollback point before refactor - $TIMESTAMP"
git push origin "pre-refactor-$TIMESTAMP" 2>/dev/null || echo "⚠ Git tag created locally (push manually if needed)"
echo "✓ Git tag created: pre-refactor-$TIMESTAMP"

# Create rollback info file
cat > "$BACKUP_DIR/rollback_info_$TIMESTAMP.txt" << EOF
ROLLBACK INFORMATION
====================
Backup Timestamp: $TIMESTAMP
Git Tag: pre-refactor-$TIMESTAMP
Database Backup: $BACKUP_DIR/db_backup_$TIMESTAMP.sql
App Data Backup: $BACKUP_DIR/app_data_$TIMESTAMP
Data Inventory: $BACKUP_DIR/data_inventory_$TIMESTAMP.json

ROLLBACK COMMAND:
./scripts/rollback.sh $TIMESTAMP

DATA VERIFICATION:
./scripts/verify-data-integrity.sh $TIMESTAMP
EOF

echo ""
echo "================================================"
echo "✅ BACKUP COMPLETE"
echo "================================================"
echo "Backup Location: $BACKUP_DIR"
echo "Rollback Tag: pre-refactor-$TIMESTAMP"
echo "Rollback Command: ./scripts/rollback.sh $TIMESTAMP"
echo ""
echo "⚠️  IMPORTANT: Test rollback procedure before proceeding!"
echo "================================================"
