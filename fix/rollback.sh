#!/bin/bash
# rollback.sh
# Emergency rollback script for COREPMS production

set -e  # Exit on any error

if [ -z "$1" ]; then
    echo "❌ ERROR: Backup timestamp required"
    echo "Usage: ./rollback.sh YYYYMMDD_HHMMSS"
    echo ""
    echo "Available backups:"
    ls -1 /var/backups/corepms/rollback_info_*.txt 2>/dev/null | sed 's/.*rollback_info_/  - /' | sed 's/.txt$//' || echo "  No backups found"
    exit 1
fi

TIMESTAMP=$1
BACKUP_DIR="/var/backups/corepms"
DB_NAME="${DB_NAME:-corepms}"
DB_USER="${DB_USER:-root}"
APP_DIR="${APP_DIR:-/var/www/corepms}"

# Verify backup exists
if [ ! -f "$BACKUP_DIR/db_backup_$TIMESTAMP.sql" ]; then
    echo "❌ ERROR: Backup not found for timestamp $TIMESTAMP"
    echo "Expected: $BACKUP_DIR/db_backup_$TIMESTAMP.sql"
    exit 1
fi

echo "🚨 INITIATING EMERGENCY ROLLBACK"
echo "================================================"
echo "⚠️  WARNING: This will restore the system to $TIMESTAMP"
echo "⚠️  All changes after this point will be LOST"
echo ""
read -p "Continue? (type 'ROLLBACK' to confirm): " CONFIRM

if [ "$CONFIRM" != "ROLLBACK" ]; then
    echo "❌ Rollback cancelled"
    exit 1
fi

echo ""
echo "🚀 Starting rollback process..."
echo "================================================"

# 1. Stop Application
echo "🛑 Step 1/6: Stopping application..."
if command -v pm2 &> /dev/null; then
    pm2 stop corepms || npm run stop || echo "⚠ Could not stop via pm2/npm"
else
    npm run stop || echo "⚠ Could not stop application"
fi
sleep 5
echo "✓ Application stopped"

# 2. Restore Code from Git Tag
echo "🔄 Step 2/6: Restoring code from Git tag..."
cd "$APP_DIR"
git fetch --all --tags
git checkout "pre-refactor-$TIMESTAMP"
echo "✓ Code restored to pre-refactor-$TIMESTAMP"

# 3. Restore Node Modules
echo "📦 Step 3/6: Restoring dependencies..."
npm ci --production
echo "✓ Dependencies restored"

# 4. Backup Current Database (safety measure)
echo "💾 Step 4/6: Creating safety backup of current database..."
mysqldump -u "$DB_USER" -p "$DB_NAME" > "$BACKUP_DIR/pre_rollback_safety_$TIMESTAMP.sql"
echo "✓ Safety backup created"

# 5. Restore Database
echo "🗄️  Step 5/6: Restoring database..."
mysql -u "$DB_USER" -p "$DB_NAME" < "$BACKUP_DIR/db_backup_$TIMESTAMP.sql"
echo "✓ Database restored"

# 6. Restore Application Data
if [ -d "$BACKUP_DIR/app_data_$TIMESTAMP" ]; then
    echo "📂 Step 6/6: Restoring application data..."
    rm -rf /var/lib/corepms/data
    cp -r "$BACKUP_DIR/app_data_$TIMESTAMP" /var/lib/corepms/data
    echo "✓ Application data restored"
else
    echo "⚠ Step 6/6: No application data backup found, skipping..."
fi

# 7. Verify Data Integrity
echo ""
echo "🔍 Verifying data integrity..."
echo "================================================"

ROOMS_COUNT=$(mysql -u "$DB_USER" -p -N -e "SELECT COUNT(*) FROM $DB_NAME.rooms" 2>/dev/null)
RESERVATIONS_COUNT=$(mysql -u "$DB_USER" -p -N -e "SELECT COUNT(*) FROM $DB_NAME.reservations" 2>/dev/null)
FRONT_OFFICE_COUNT=$(mysql -u "$DB_USER" -p -N -e "SELECT COUNT(*) FROM $DB_NAME.front_office_transactions" 2>/dev/null)

echo "Current data counts:"
echo "  Rooms: $ROOMS_COUNT"
echo "  Reservations: $RESERVATIONS_COUNT"
echo "  Front Office: $FRONT_OFFICE_COUNT"
echo ""

# Compare with original backup
if [ -f "$BACKUP_DIR/data_inventory_$TIMESTAMP.json" ]; then
    echo "Expected data counts (from backup $TIMESTAMP):"
    cat "$BACKUP_DIR/data_inventory_$TIMESTAMP.json" | grep -A 5 '"tables"'
fi

# 8. Restart Application
echo ""
echo "🚀 Restarting application..."
if command -v pm2 &> /dev/null; then
    pm2 restart corepms || npm run start:production
else
    npm run start:production &
fi

sleep 10

# 9. Health Check
echo ""
echo "🏥 Running health check..."
curl -f http://localhost:3000/health || echo "⚠ Health check failed - manual verification needed"

echo ""
echo "================================================"
echo "✅ ROLLBACK COMPLETE"
echo "================================================"
echo "System restored to: $TIMESTAMP"
echo "Git tag: pre-refactor-$TIMESTAMP"
echo ""
echo "⚠️  IMPORTANT NEXT STEPS:"
echo "1. Verify application is running: pm2 status"
echo "2. Check error logs: tail -f /var/log/corepms/error.log"
echo "3. Verify data integrity: ./scripts/verify-data-integrity.sh"
echo "4. Test critical workflows manually"
echo "5. Document rollback reason for team"
echo ""
echo "Safety backup of pre-rollback state saved to:"
echo "$BACKUP_DIR/pre_rollback_safety_$TIMESTAMP.sql"
echo "================================================"

# Log rollback event
mysql -u "$DB_USER" -p "$DB_NAME" -e "
  INSERT INTO deployment_history (version, deployed_by, rollback_tag, status) 
  VALUES ('ROLLBACK', 'system', 'pre-refactor-$TIMESTAMP', 'ROLLED_BACK');
" 2>/dev/null || echo "⚠ Could not log rollback event to database"
