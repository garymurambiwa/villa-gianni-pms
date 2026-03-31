#!/bin/bash
# verify-data-integrity.sh
# Verify data integrity for protected modules (Rooms, Reservations, Front Office)

set -e

DB_NAME="${DB_NAME:-corepms}"
DB_USER="${DB_USER:-root}"
BACKUP_DIR="/var/backups/corepms"

echo "🔍 DATA INTEGRITY VERIFICATION"
echo "================================================"
echo "Database: $DB_NAME"
echo "Timestamp: $(date)"
echo "================================================"
echo ""

# Function to run SQL query and return result
query_db() {
    mysql -u "$DB_USER" -p -N -e "$1" 2>/dev/null
}

# Check if backup timestamp provided for comparison
COMPARE_TIMESTAMP=$1
if [ -n "$COMPARE_TIMESTAMP" ]; then
    echo "📊 Comparison Mode: Comparing with backup from $COMPARE_TIMESTAMP"
    echo ""
    if [ ! -f "$BACKUP_DIR/data_inventory_$COMPARE_TIMESTAMP.json" ]; then
        echo "⚠ Warning: Backup inventory not found, comparison will be limited"
    fi
fi

# ==========================================
# 1. ROOMS MODULE VERIFICATION
# ==========================================
echo "🏨 ROOMS MODULE"
echo "------------------------------------------"

ROOMS_TOTAL=$(query_db "SELECT COUNT(*) FROM $DB_NAME.rooms")
ROOMS_AVAILABLE=$(query_db "SELECT COUNT(*) FROM $DB_NAME.rooms WHERE status = 'available'")
ROOMS_OCCUPIED=$(query_db "SELECT COUNT(*) FROM $DB_NAME.rooms WHERE status = 'occupied'")
ROOMS_MAINTENANCE=$(query_db "SELECT COUNT(*) FROM $DB_NAME.rooms WHERE status = 'maintenance'")

echo "  Total Rooms: $ROOMS_TOTAL"
echo "  Available: $ROOMS_AVAILABLE"
echo "  Occupied: $ROOMS_OCCUPIED"
echo "  Maintenance: $ROOMS_MAINTENANCE"

# Check for orphaned room types
ORPHANED_ROOMS=$(query_db "
    SELECT COUNT(*) FROM $DB_NAME.rooms r 
    LEFT JOIN $DB_NAME.room_types rt ON r.room_type_id = rt.id 
    WHERE rt.id IS NULL
")
if [ "$ORPHANED_ROOMS" -gt 0 ]; then
    echo "  ❌ ISSUE: $ORPHANED_ROOMS rooms have invalid room_type_id"
else
    echo "  ✓ All rooms have valid room types"
fi

# Check for duplicate room numbers
DUPLICATE_ROOMS=$(query_db "
    SELECT COUNT(*) FROM (
        SELECT room_number FROM $DB_NAME.rooms 
        GROUP BY room_number HAVING COUNT(*) > 1
    ) AS dupes
")
if [ "$DUPLICATE_ROOMS" -gt 0 ]; then
    echo "  ❌ ISSUE: $DUPLICATE_ROOMS duplicate room numbers found"
else
    echo "  ✓ No duplicate room numbers"
fi

echo ""

# ==========================================
# 2. RESERVATIONS MODULE VERIFICATION
# ==========================================
echo "📅 RESERVATIONS MODULE"
echo "------------------------------------------"

RESERVATIONS_TOTAL=$(query_db "SELECT COUNT(*) FROM $DB_NAME.reservations")
RESERVATIONS_CONFIRMED=$(query_db "SELECT COUNT(*) FROM $DB_NAME.reservations WHERE status = 'confirmed'")
RESERVATIONS_CHECKED_IN=$(query_db "SELECT COUNT(*) FROM $DB_NAME.reservations WHERE status = 'checked_in'")
RESERVATIONS_CHECKED_OUT=$(query_db "SELECT COUNT(*) FROM $DB_NAME.reservations WHERE status = 'checked_out'")
RESERVATIONS_CANCELLED=$(query_db "SELECT COUNT(*) FROM $DB_NAME.reservations WHERE status = 'cancelled'")

echo "  Total Reservations: $RESERVATIONS_TOTAL"
echo "  Confirmed: $RESERVATIONS_CONFIRMED"
echo "  Checked In: $RESERVATIONS_CHECKED_IN"
echo "  Checked Out: $RESERVATIONS_CHECKED_OUT"
echo "  Cancelled: $RESERVATIONS_CANCELLED"

# Check for reservations with invalid room references
INVALID_ROOM_REFS=$(query_db "
    SELECT COUNT(*) FROM $DB_NAME.reservations res 
    LEFT JOIN $DB_NAME.rooms r ON res.room_id = r.id 
    WHERE r.id IS NULL
")
if [ "$INVALID_ROOM_REFS" -gt 0 ]; then
    echo "  ❌ ISSUE: $INVALID_ROOM_REFS reservations have invalid room_id"
else
    echo "  ✓ All reservations have valid room references"
fi

# Check for date integrity
INVALID_DATES=$(query_db "
    SELECT COUNT(*) FROM $DB_NAME.reservations 
    WHERE check_out_date <= check_in_date
")
if [ "$INVALID_DATES" -gt 0 ]; then
    echo "  ❌ ISSUE: $INVALID_DATES reservations have check_out <= check_in"
else
    echo "  ✓ All reservations have valid date ranges"
fi

# Check oldest reservation
OLDEST_RESERVATION=$(query_db "SELECT DATE(MIN(created_at)) FROM $DB_NAME.reservations")
echo "  Oldest Reservation: $OLDEST_RESERVATION"

echo ""

# ==========================================
# 3. FRONT OFFICE MODULE VERIFICATION
# ==========================================
echo "🏢 FRONT OFFICE MODULE"
echo "------------------------------------------"

FRONT_OFFICE_TOTAL=$(query_db "SELECT COUNT(*) FROM $DB_NAME.front_office_transactions")
CHECKINS=$(query_db "SELECT COUNT(*) FROM $DB_NAME.front_office_transactions WHERE transaction_type = 'check_in'")
CHECKOUTS=$(query_db "SELECT COUNT(*) FROM $DB_NAME.front_office_transactions WHERE transaction_type = 'check_out'")

echo "  Total Transactions: $FRONT_OFFICE_TOTAL"
echo "  Check-ins: $CHECKINS"
echo "  Check-outs: $CHECKOUTS"

# Check for transactions with invalid reservation references
INVALID_RESERVATION_REFS=$(query_db "
    SELECT COUNT(*) FROM $DB_NAME.front_office_transactions fo 
    LEFT JOIN $DB_NAME.reservations res ON fo.reservation_id = res.id 
    WHERE res.id IS NULL AND fo.reservation_id IS NOT NULL
")
if [ "$INVALID_RESERVATION_REFS" -gt 0 ]; then
    echo "  ❌ ISSUE: $INVALID_RESERVATION_REFS transactions have invalid reservation_id"
else
    echo "  ✓ All transactions have valid reservation references"
fi

echo ""

# ==========================================
# 4. CROSS-MODULE INTEGRITY CHECKS
# ==========================================
echo "🔗 CROSS-MODULE INTEGRITY"
echo "------------------------------------------"

# Check for checked-in reservations without occupied rooms
MISMATCHED_STATUS=$(query_db "
    SELECT COUNT(*) FROM $DB_NAME.reservations res
    JOIN $DB_NAME.rooms r ON res.room_id = r.id
    WHERE res.status = 'checked_in' AND r.status != 'occupied'
")
if [ "$MISMATCHED_STATUS" -gt 0 ]; then
    echo "  ⚠ Warning: $MISMATCHED_STATUS checked-in reservations with non-occupied rooms"
else
    echo "  ✓ Reservation and room status are consistent"
fi

# Check for occupied rooms without active reservations
ORPHANED_OCCUPIED=$(query_db "
    SELECT COUNT(*) FROM $DB_NAME.rooms r
    LEFT JOIN $DB_NAME.reservations res ON r.id = res.room_id AND res.status = 'checked_in'
    WHERE r.status = 'occupied' AND res.id IS NULL
")
if [ "$ORPHANED_OCCUPIED" -gt 0 ]; then
    echo "  ⚠ Warning: $ORPHANED_OCCUPIED occupied rooms without active reservations"
else
    echo "  ✓ All occupied rooms have active reservations"
fi

echo ""

# ==========================================
# 5. COMPARISON WITH BASELINE (if provided)
# ==========================================
if [ -n "$COMPARE_TIMESTAMP" ] && [ -f "$BACKUP_DIR/data_inventory_$COMPARE_TIMESTAMP.json" ]; then
    echo "📊 COMPARISON WITH BASELINE ($COMPARE_TIMESTAMP)"
    echo "------------------------------------------"
    
    BASELINE_ROOMS=$(grep -o '"rooms": [0-9]*' "$BACKUP_DIR/data_inventory_$COMPARE_TIMESTAMP.json" | grep -o '[0-9]*')
    BASELINE_RESERVATIONS=$(grep -o '"reservations": [0-9]*' "$BACKUP_DIR/data_inventory_$COMPARE_TIMESTAMP.json" | grep -o '[0-9]*')
    BASELINE_FRONT_OFFICE=$(grep -o '"front_office": [0-9]*' "$BACKUP_DIR/data_inventory_$COMPARE_TIMESTAMP.json" | grep -o '[0-9]*')
    
    echo "  Rooms: $BASELINE_ROOMS → $ROOMS_TOTAL (diff: $((ROOMS_TOTAL - BASELINE_ROOMS)))"
    echo "  Reservations: $BASELINE_RESERVATIONS → $RESERVATIONS_TOTAL (diff: $((RESERVATIONS_TOTAL - BASELINE_RESERVATIONS)))"
    echo "  Front Office: $BASELINE_FRONT_OFFICE → $FRONT_OFFICE_TOTAL (diff: $((FRONT_OFFICE_TOTAL - BASELINE_FRONT_OFFICE)))"
    
    # Alert if critical data decreased
    if [ "$ROOMS_TOTAL" -lt "$BASELINE_ROOMS" ]; then
        echo "  ❌ CRITICAL: Room count DECREASED! Possible data loss!"
    fi
    
    if [ "$RESERVATIONS_TOTAL" -lt "$BASELINE_RESERVATIONS" ]; then
        echo "  ❌ CRITICAL: Reservation count DECREASED! Possible data loss!"
    fi
    
    if [ "$FRONT_OFFICE_TOTAL" -lt "$BASELINE_FRONT_OFFICE" ]; then
        echo "  ⚠ Warning: Front office transaction count decreased"
    fi
    
    echo ""
fi

# ==========================================
# 6. FINAL VERDICT
# ==========================================
echo "================================================"
echo "📋 SUMMARY"
echo "================================================"

ISSUES=0

# Count critical issues
if [ "$ORPHANED_ROOMS" -gt 0 ] || [ "$DUPLICATE_ROOMS" -gt 0 ]; then
    ((ISSUES++))
fi

if [ "$INVALID_ROOM_REFS" -gt 0 ] || [ "$INVALID_DATES" -gt 0 ]; then
    ((ISSUES++))
fi

if [ "$INVALID_RESERVATION_REFS" -gt 0 ]; then
    ((ISSUES++))
fi

if [ "$ISSUES" -eq 0 ]; then
    echo "✅ ALL CHECKS PASSED"
    echo "   Data integrity verified across all protected modules"
    echo "   No critical issues detected"
    exit 0
else
    echo "❌ $ISSUES CRITICAL ISSUE(S) DETECTED"
    echo "   Immediate investigation required"
    echo "   Consider rollback if data loss detected"
    exit 1
fi
