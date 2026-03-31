# ANTIGRAVITY SYSTEM REFACTOR PROMPT
**Production System - Live Data Protection Protocol**

---

## 🎯 MISSION CRITICAL REQUIREMENTS

**System State**: LIVE PRODUCTION with active user data
**Protected Modules**: Rooms, Front Office, Reservation (+ all dependent modules)
**Success Criteria**: Zero data loss, zero downtime, instant rollback capability
**Version Change**: Bump from current to next semantic version

---

## 📋 PRE-EXECUTION CHECKLIST

### 1. ENVIRONMENT VALIDATION
```bash
# Verify you're on correct branch
git branch --show-current

# Check for uncommitted changes
git status

# Verify database connection
npm run db:healthcheck || yarn db:healthcheck
```

### 2. DATA INVENTORY AUDIT
Before ANY code changes:
- [ ] Count total records in `rooms` table
- [ ] Count total records in `reservations` table  
- [ ] Count total records in `front_office` transactions
- [ ] Export schema of all tables to `/backups/schema_[timestamp].sql`
- [ ] Document all foreign key relationships

**Command**:
```bash
# Create audit snapshot
npm run audit:snapshot
```

---

## 🛡️ DATA PROTECTION PROTOCOL

### Phase 1: Full System Backup (MANDATORY)
```bash
# 1. Database Backup
mysqldump -u [user] -p [database] > backups/db_backup_$(date +%Y%m%d_%H%M%S).sql

# 2. Application State Backup
cp -r /var/lib/corepms/data /var/lib/corepms/data_backup_$(date +%Y%m%d_%H%M%S)

# 3. Git Tag Current State
git tag -a "pre-refactor-$(date +%Y%m%d_%H%M%S)" -m "Safe rollback point before module refactor"
git push origin --tags
```

### Phase 2: Create Rollback Script
Create `/scripts/rollback.sh`:
```bash
#!/bin/bash
# Emergency Rollback Script
BACKUP_TAG="pre-refactor-YYYYMMDD_HHMMSS"  # Replace with actual tag
DB_BACKUP="backups/db_backup_YYYYMMDD_HHMMSS.sql"  # Replace with actual file

echo "🚨 INITIATING ROLLBACK..."

# 1. Stop application
pm2 stop corepms || npm run stop

# 2. Restore code
git checkout $BACKUP_TAG
npm ci --production

# 3. Restore database
mysql -u [user] -p [database] < $DB_BACKUP

# 4. Restart application
npm run start:production

echo "✅ ROLLBACK COMPLETE - System restored to safe state"
```

---

## 🔧 MODULE REFACTOR SPECIFICATIONS

### Scope Isolation Rules
**MODIFY ONLY**:
- Target module files (BillingList.vue/jsx, BillDetailModal component)
- Module-specific API routes (`/api/billing/*`)
- Module-specific database tables (`bills`, `bill_items`, `bill_payments`)

**DO NOT TOUCH**:
- `src/modules/rooms/*` (contains live reservation data)
- `src/modules/front-office/*` (contains check-in/check-out records)
- `src/modules/reservation/*` (contains booking data)
- Global state management (`store/index.js`, `context/AppContext.jsx`)
- Shared utilities unless absolutely necessary
- Authentication/Authorization middleware
- Database connection pool configuration

---

## 📊 DATABASE CHANGE MANAGEMENT

### Migration Strategy (Zero-Downtime)
Every database change MUST follow this pattern:

```javascript
// migrations/YYYYMMDD_HHMMSS_add_bill_status_enum.js
module.exports = {
  async up(queryInterface, Sequelize) {
    // 1. Create backup of affected table
    await queryInterface.sequelize.query(`
      CREATE TABLE bills_backup_$(date +%Y%m%d) AS SELECT * FROM bills;
    `);
    
    // 2. Add new column with default to preserve existing data
    await queryInterface.addColumn('bills', 'void_status', {
      type: Sequelize.ENUM('ACTIVE', 'VOIDED'),
      defaultValue: 'ACTIVE',  // Existing records stay ACTIVE
      allowNull: false
    });
    
    // 3. Verify data integrity
    const beforeCount = await queryInterface.sequelize.query(
      'SELECT COUNT(*) as count FROM bills_backup_$(date +%Y%m%d)',
      { type: Sequelize.QueryTypes.SELECT }
    );
    const afterCount = await queryInterface.sequelize.query(
      'SELECT COUNT(*) as count FROM bills',
      { type: Sequelize.QueryTypes.SELECT }
    );
    
    if (beforeCount[0].count !== afterCount[0].count) {
      throw new Error('DATA LOSS DETECTED - Rolling back migration');
    }
  },
  
  async down(queryInterface, Sequelize) {
    // Rollback: Remove column and restore from backup if needed
    await queryInterface.removeColumn('bills', 'void_status');
  }
};
```

### Pre-Migration Checklist
- [ ] Migration tested on database copy with production data snapshot
- [ ] Rollback script tested and verified
- [ ] Migration runs in < 5 seconds (for minimal lock time)
- [ ] No breaking changes to existing API responses
- [ ] All existing queries still return correct data

---

## 🔀 GIT WORKFLOW (Surgical Precision)

### Branch Strategy
```bash
# 1. Create feature branch from production
git checkout production
git pull origin production
git checkout -b hotfix/billing-modal-isolation-v[X.Y.Z]

# 2. Make changes in atomic commits
git add src/modules/billing/components/BillDetailModal.vue
git commit -m "feat(billing): Add BillDetailModal component - no data changes"

git add src/modules/billing/api/billController.js
git commit -m "feat(billing): Add void endpoint with audit logging"

git add migrations/20260319_add_void_status.js
git commit -m "migration(billing): Add void_status column with safe defaults"

# 3. Version bump (semantic versioning)
npm version patch -m "chore: bump version to %s - billing modal refactor"
# OR for bigger changes:
# npm version minor -m "chore: bump version to %s - billing modal refactor"

# 4. Push with tags
git push origin hotfix/billing-modal-isolation-v[X.Y.Z]
git push origin --tags
```

### Commit Message Rules
Every commit MUST state:
- `[DATA_SAFE]` if it doesn't touch database
- `[MIGRATION]` if it includes schema changes
- `[ISOLATED]` if it only touches one module

Example:
```
feat(billing): [DATA_SAFE] [ISOLATED] Add modal UI component

- Implements BillDetailModal.vue
- No database changes
- No modifications to Rooms/Reservation/FrontOffice modules
- Tested with 10,000 existing bill records
```

---

## 🧪 TESTING PROTOCOL (Before Merge)

### 1. Data Integrity Tests
```javascript
// tests/integration/data-integrity.test.js
describe('Data Integrity - Rooms Module', () => {
  let preChangeRecordCount;
  
  beforeAll(async () => {
    preChangeRecordCount = await Room.count();
  });
  
  it('should maintain exact room count after refactor', async () => {
    const postChangeRecordCount = await Room.count();
    expect(postChangeRecordCount).toBe(preChangeRecordCount);
  });
  
  it('should maintain all room relationships', async () => {
    const roomsWithReservations = await Room.findAll({
      include: [Reservation]
    });
    // Verify no orphaned records
    roomsWithReservations.forEach(room => {
      expect(room.Reservations).toBeDefined();
    });
  });
});

describe('Data Integrity - Reservations Module', () => {
  it('should preserve all historical reservation data', async () => {
    const oldestReservation = await Reservation.findOne({
      order: [['created_at', 'ASC']]
    });
    expect(oldestReservation).not.toBeNull();
    expect(oldestReservation.room_id).toBeDefined();
  });
});
```

### 2. Regression Test Suite
Run full regression on protected modules:
```bash
npm run test:rooms
npm run test:front-office  
npm run test:reservations

# All must pass with 100% success rate
```

### 3. Load Test (Simulate Production Traffic)
```bash
# Test with production-like data volume
npm run seed:test-data -- --rooms=1000 --reservations=5000
npm run test:load
```

---

## 🚀 DEPLOYMENT STRATEGY (Feature Flag Pattern)

### Step 1: Deploy with Feature Flag OFF
```javascript
// config/features.js
module.exports = {
  BILLING_MODAL_REFACTOR: {
    enabled: process.env.FEATURE_BILLING_MODAL === 'true',
    rolloutPercentage: 0  // Start at 0%
  }
};

// In your component
import { isFeatureEnabled } from '@/config/features';

export default {
  computed: {
    useNewModal() {
      return isFeatureEnabled('BILLING_MODAL_REFACTOR');
    }
  },
  methods: {
    openBillDetails(billId) {
      if (this.useNewModal) {
        // New modal logic
        this.$modal.show('BillDetailModal', { billId });
      } else {
        // Old accordion logic (fallback)
        this.expandAccordion(billId);
      }
    }
  }
};
```

### Step 2: Gradual Rollout
```bash
# Week 1: Deploy to production with flag OFF
git push production hotfix/billing-modal-isolation-v[X.Y.Z]

# Week 1, Day 2: Enable for 10% of users
export FEATURE_BILLING_MODAL=true
export ROLLOUT_PERCENTAGE=10
pm2 restart corepms

# Monitor error logs for 48 hours
tail -f /var/log/corepms/error.log | grep "billing"

# Week 1, Day 4: If zero errors, increase to 50%
export ROLLOUT_PERCENTAGE=50
pm2 restart corepms

# Week 2: If still zero errors, enable for 100%
export ROLLOUT_PERCENTAGE=100
pm2 restart corepms
```

### Step 3: Monitor Live Data
```sql
-- Run every hour during rollout
SELECT 
  COUNT(*) as total_rooms,
  COUNT(DISTINCT room_id) as unique_rooms,
  COUNT(*) FILTER (WHERE status = 'available') as available_rooms
FROM rooms;

SELECT 
  COUNT(*) as total_reservations,
  COUNT(DISTINCT guest_id) as unique_guests,
  MIN(created_at) as oldest_reservation
FROM reservations;

-- Alert if any count changes unexpectedly
```

---

## ⚠️ ERROR DETECTION & AUTO-ROLLBACK

### Automated Health Checks
```javascript
// monitoring/healthcheck.js
const HEALTH_THRESHOLDS = {
  errorRate: 0.01,  // 1% error rate triggers rollback
  responseTime: 2000,  // 2 second response time max
  dataIntegrityChecks: true
};

setInterval(async () => {
  const health = await checkSystemHealth();
  
  if (health.errorRate > HEALTH_THRESHOLDS.errorRate) {
    console.error('🚨 ERROR RATE THRESHOLD EXCEEDED - INITIATING AUTO-ROLLBACK');
    await executeRollback();
    await notifyDevTeam({
      severity: 'CRITICAL',
      message: 'Auto-rollback executed due to high error rate',
      metrics: health
    });
  }
  
  if (!health.dataIntegrity.rooms || 
      !health.dataIntegrity.reservations || 
      !health.dataIntegrity.frontOffice) {
    console.error('🚨 DATA INTEGRITY FAILURE - INITIATING AUTO-ROLLBACK');
    await executeRollback();
  }
}, 60000); // Check every minute

async function checkSystemHealth() {
  const roomCount = await Room.count();
  const reservationCount = await Reservation.count();
  
  return {
    errorRate: calculateErrorRate(),
    responseTime: getAverageResponseTime(),
    dataIntegrity: {
      rooms: roomCount === expectedRoomCount,
      reservations: reservationCount >= expectedMinReservations,
      frontOffice: await verifyFrontOfficeData()
    }
  };
}
```

---

## 📝 VERSION MANAGEMENT

### Update Package.json
```json
{
  "name": "corepms",
  "version": "2.1.0",  // Bump from 2.0.5 (example)
  "changelog": {
    "2.1.0": {
      "date": "2026-03-19",
      "changes": [
        "Refactored billing modal with isolated module architecture",
        "Added void/delete data safety protocols",
        "Implemented feature flag system for gradual rollouts",
        "Zero changes to Rooms/Reservation/FrontOffice data structures"
      ],
      "migrations": [
        "20260319_add_void_status_to_bills.js"
      ],
      "rollback_tag": "pre-refactor-20260319_143022"
    }
  }
}
```

### Update Version in Database
```sql
-- Track deployment history
CREATE TABLE IF NOT EXISTS deployment_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  version VARCHAR(20) NOT NULL,
  deployed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deployed_by VARCHAR(100),
  rollback_tag VARCHAR(100),
  data_snapshot_path VARCHAR(255),
  status ENUM('SUCCESS', 'ROLLED_BACK', 'FAILED') DEFAULT 'SUCCESS'
);

INSERT INTO deployment_history (version, deployed_by, rollback_tag, data_snapshot_path)
VALUES ('2.1.0', 'system', 'pre-refactor-20260319_143022', '/backups/db_backup_20260319_143022.sql');
```

---

## 🎬 EXECUTION SEQUENCE (Step-by-Step)

### Phase 1: Preparation (No Code Changes Yet)
```bash
# 1. Full backup
./scripts/backup-full-system.sh

# 2. Create rollback script
./scripts/create-rollback-point.sh

# 3. Run data audit
npm run audit:snapshot > audit_pre_refactor.json

# 4. Create feature branch
git checkout -b hotfix/billing-modal-isolation-v2.1.0
```

### Phase 2: Development (Isolated Changes)
```bash
# 5. Make changes ONLY to billing module
# - Edit src/modules/billing/* files
# - Add migrations with safe defaults
# - Add tests for data integrity

# 6. Run local tests
npm run test:data-integrity
npm run test:billing
npm run test:rooms  # Verify no impact
npm run test:reservations  # Verify no impact
npm run test:front-office  # Verify no impact
```

### Phase 3: Pre-Deployment Validation
```bash
# 7. Run on staging with production data copy
./scripts/deploy-to-staging.sh

# 8. Run full regression suite
npm run test:regression

# 9. Manual QA on staging
# - Test all billing operations
# - Verify rooms data unchanged
# - Verify reservations data unchanged
# - Test rollback procedure

# 10. Compare data counts before/after
./scripts/compare-data-integrity.sh
```

### Phase 4: Production Deployment
```bash
# 11. Bump version
npm version minor -m "chore: v2.1.0 - billing modal refactor"

# 12. Commit and push
git push origin hotfix/billing-modal-isolation-v2.1.0
git push origin --tags

# 13. Merge to production (with feature flag OFF)
git checkout production
git merge hotfix/billing-modal-isolation-v2.1.0
git push origin production

# 14. Deploy to production
./scripts/deploy-production.sh

# 15. Monitor for 24 hours with flag OFF
tail -f /var/log/corepms/error.log

# 16. Gradual rollout (Day 2+)
export FEATURE_BILLING_MODAL=true
export ROLLOUT_PERCENTAGE=10
pm2 restart corepms
```

### Phase 5: Post-Deployment Verification
```bash
# 17. Run data integrity checks
./scripts/verify-data-integrity.sh

# 18. Compare with pre-deployment audit
diff audit_pre_refactor.json audit_post_refactor.json

# 19. Verify zero errors in logs
grep -i "error" /var/log/corepms/error.log | wc -l  # Should be 0

# 20. Confirm room/reservation counts unchanged
npm run audit:compare
```

---

## 🚨 ROLLBACK PROCEDURE (If Anything Goes Wrong)

### Instant Rollback (< 2 minutes)
```bash
# 1. Execute rollback script
./scripts/rollback.sh

# 2. Verify system restored
npm run test:smoke

# 3. Verify data integrity
npm run audit:verify

# 4. Notify team
./scripts/notify-rollback.sh "Rolled back to pre-refactor-20260319_143022"
```

### What Gets Rolled Back
- ✅ Application code (to previous Git tag)
- ✅ Database schema (migrations reversed)
- ✅ Database data (restored from backup)
- ✅ Environment variables (feature flags disabled)
- ✅ Node modules (npm ci from previous package-lock.json)

### What Stays Protected
- ✅ Rooms module data
- ✅ Reservation records
- ✅ Front office transactions
- ✅ User authentication data
- ✅ All historical data

---

## ✅ SUCCESS CRITERIA

Deployment is considered successful ONLY if ALL conditions met:

- [ ] Zero errors in production logs for 48 hours
- [ ] Room count matches pre-deployment audit exactly
- [ ] Reservation count matches or exceeds pre-deployment audit
- [ ] Front office transaction count matches pre-deployment audit
- [ ] All regression tests pass (100% success rate)
- [ ] Average response time < 500ms
- [ ] Feature flag enabled at 100% with zero rollbacks
- [ ] Customer support tickets related to billing: 0
- [ ] Database backup verified and tested for restoration

**Only after ALL criteria met**: Remove old code and feature flag, mark deployment complete.

---

## 📞 EMERGENCY CONTACTS

If any data loss detected or system instability:

1. **IMMEDIATE**: Execute rollback script
2. **NOTIFY**: Senior System Architect + DevOps Lead
3. **FREEZE**: All further deployments until root cause analysis
4. **AUDIT**: Run full data integrity audit
5. **REPORT**: Document incident with timeline and impact assessment

---

## 🔒 FINAL SAFEGUARDS

**Before executing ANY of the above**:
1. Read this entire document twice
2. Verify you have valid database backups
3. Test rollback procedure on staging
4. Get approval from system architect/tech lead
5. Schedule deployment during low-traffic window
6. Have senior developer on standby during deployment

**Remember**: Data integrity is non-negotiable. When in doubt, rollback immediately.

---

**END OF ANTIGRAVITY PROMPT - Ready for Production Use**
