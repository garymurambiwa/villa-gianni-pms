# 🛡️ COREPMS Production Deployment Safety System
**Zero-Error Data Protection Protocol for Live Systems**

---

## 📋 Overview

This system provides enterprise-grade deployment safety for COREPMS, a live production system with critical data in Rooms, Front Office, and Reservations modules. It ensures **zero data loss** through automated backups, instant rollbacks, and comprehensive verification.

### Key Features
- ✅ **Instant Rollback**: Restore entire system in < 2 minutes
- ✅ **Data Integrity Verification**: Automated checks for protected modules
- ✅ **Version Management**: Semantic versioning with automated changelogs
- ✅ **Module Isolation**: Surgical changes without cascade failures
- ✅ **Production-Safe Deployments**: Feature flags + gradual rollouts

---

## 📂 File Structure

```
/home/claude/
├── antigravity_prompt.md           # Complete system architecture guide
├── DEPLOYMENT_CHECKLIST.md         # Step-by-step deployment checklist
├── scripts/
│   ├── backup-full-system.sh       # Full backup (DB + data + Git tag)
│   ├── rollback.sh                 # Emergency rollback script
│   ├── verify-data-integrity.sh    # Data integrity checker
│   └── bump-version.sh             # Version management script
└── README.md                        # This file
```

---

## 🚀 Quick Start

### Before Making ANY Changes

```bash
# 1. Create full backup (MANDATORY FIRST STEP)
./scripts/backup-full-system.sh

# 2. Note the backup timestamp (e.g., 20260319_143022)
# This is displayed at the end of the backup script

# 3. Verify backup was successful
ls -lh /var/backups/corepms/
```

### Making Changes to the System

```bash
# 1. Create feature branch
git checkout -b feature/your-change-name

# 2. Make your changes (only to target module)

# 3. Bump version and update changelog
./scripts/bump-version.sh

# 4. Deploy to staging first (test with production data copy)

# 5. Verify data integrity on staging
./scripts/verify-data-integrity.sh [backup_timestamp]

# 6. If all tests pass, deploy to production
# 7. Monitor for 24-48 hours before marking complete
```

### If Something Goes Wrong

```bash
# Emergency rollback (use backup timestamp from step 1)
./scripts/rollback.sh 20260319_143022

# Verify system restored
./scripts/verify-data-integrity.sh 20260319_143022
```

---

## 📖 Detailed Usage

### 1. Full System Backup

**When to use**: Before EVERY deployment, schema change, or major refactor

```bash
./scripts/backup-full-system.sh
```

**What it does**:
- Creates database dump with timestamp
- Backs up application data directory
- Records current data counts (rooms, reservations, etc.)
- Exports database schema
- Creates Git rollback tag
- Generates rollback info file

**Output**:
```
✅ BACKUP COMPLETE
Backup Location: /var/backups/corepms
Rollback Tag: pre-refactor-20260319_143022
Rollback Command: ./scripts/rollback.sh 20260319_143022
```

**Important**: Save the backup timestamp - you'll need it for rollback!

---

### 2. Emergency Rollback

**When to use**: 
- Data loss detected
- High error rate (> 1%)
- Critical workflow broken
- Performance degraded > 50%
- Database corruption

```bash
./scripts/rollback.sh [backup_timestamp]

# Example:
./scripts/rollback.sh 20260319_143022
```

**What it does**:
1. Stops application
2. Restores code from Git tag
3. Restores dependencies (npm ci)
4. Creates safety backup of current DB
5. Restores database from backup
6. Restores application data
7. Restarts application
8. Verifies data integrity

**Time to complete**: ~2 minutes

**Safety**: Creates a "pre-rollback" backup before restoring, so you can roll forward if needed

---

### 3. Data Integrity Verification

**When to use**: 
- After every deployment
- Before marking deployment successful
- During suspicious behavior
- Weekly maintenance checks

```bash
# Check current state
./scripts/verify-data-integrity.sh

# Compare with baseline
./scripts/verify-data-integrity.sh [backup_timestamp]
```

**What it checks**:
- ✅ Rooms module: Count, orphaned records, duplicates
- ✅ Reservations module: Count, invalid references, date integrity
- ✅ Front Office module: Count, transaction integrity
- ✅ Cross-module relationships
- ✅ Comparison with baseline (if timestamp provided)

**Output**:
```
✅ ALL CHECKS PASSED
   Data integrity verified across all protected modules
   No critical issues detected
```

**Exit codes**:
- `0` = All checks passed
- `1` = Critical issues detected (investigate immediately)

---

### 4. Version Bump

**When to use**: Before every deployment

```bash
./scripts/bump-version.sh
```

**Interactive prompts**:
1. Select bump type (patch/minor/major/custom)
2. Enter changelog entries
3. List database migrations (if any)
4. Confirm changes

**What it does**:
- Creates pre-bump rollback tag
- Updates package.json version
- Adds entry to package.json changelog
- Updates CHANGELOG.md
- Creates Git commit
- Creates version tag (v2.1.0)

**Semantic versioning guide**:
- **Patch** (2.0.5 → 2.0.6): Bug fixes, no new features
- **Minor** (2.0.5 → 2.1.0): New features, backward compatible
- **Major** (2.0.5 → 3.0.0): Breaking changes

---

## 🎯 Common Workflows

### Workflow 1: Simple Bug Fix (Patch)

```bash
# 1. Backup
./scripts/backup-full-system.sh
# Note timestamp: 20260319_143022

# 2. Create branch
git checkout -b hotfix/fix-billing-calculation

# 3. Fix bug (only edit billing module files)
vim src/modules/billing/services/calculator.js

# 4. Test
npm test
npm run test:data-integrity

# 5. Bump version
./scripts/bump-version.sh
# Select: 1) Patch
# Enter: "Fixed decimal rounding in billing calculation"

# 6. Deploy to staging, then production
# 7. Verify
./scripts/verify-data-integrity.sh 20260319_143022
```

---

### Workflow 2: New Feature with Database Changes (Minor)

```bash
# 1. Backup
./scripts/backup-full-system.sh
# Note timestamp: 20260319_150000

# 2. Create branch
git checkout -b feature/add-void-billing

# 3. Create migration
# migrations/20260319_add_void_status.js

# 4. Make changes
# - Add BillDetailModal component
# - Add void API endpoint
# - Update tests

# 5. Test migration on staging
npm run migrate:up
./scripts/verify-data-integrity.sh 20260319_150000

# Test rollback
npm run migrate:down
./scripts/verify-data-integrity.sh 20260319_150000

# 6. Bump version
./scripts/bump-version.sh
# Select: 2) Minor
# Enter: "Added void billing functionality with modal UI"
# Migrations: "20260319_add_void_status.js"

# 7. Deploy with feature flag OFF
export FEATURE_VOID_BILLING=false
pm2 restart corepms

# 8. Monitor for 24 hours
tail -f /var/log/corepms/error.log

# 9. Gradual rollout
export FEATURE_VOID_BILLING=true
export ROLLOUT_PERCENTAGE=10  # Day 2
export ROLLOUT_PERCENTAGE=50  # Day 4
export ROLLOUT_PERCENTAGE=100 # Day 6
```

---

### Workflow 3: Emergency Rollback

```bash
# Situation: Deployment caused errors, need immediate rollback

# 1. Execute rollback (use backup timestamp from before deployment)
./scripts/rollback.sh 20260319_143022

# 2. Verify system restored
./scripts/verify-data-integrity.sh 20260319_143022

# 3. Check application status
pm2 status
curl http://localhost:3000/health

# 4. Monitor logs
tail -f /var/log/corepms/error.log

# 5. Document incident
# - What went wrong
# - When rollback executed
# - Current system state
# - Next steps
```

---

## 🔒 Protected Modules (DO NOT MODIFY)

These modules contain live customer data and must NOT be modified without explicit approval:

- ❌ `src/modules/rooms/*`
- ❌ `src/modules/front-office/*`
- ❌ `src/modules/reservation/*`
- ❌ `store/index.js` (global state)
- ❌ `context/AppContext.jsx` (global context)
- ❌ Authentication/Authorization middleware
- ❌ Database connection configuration

**Exception**: If changes to protected modules are unavoidable, follow the full procedure in `antigravity_prompt.md` with extra scrutiny.

---

## ✅ Success Criteria

Deployment is successful ONLY if **ALL** criteria met:

- [ ] Zero data loss (verified via integrity script)
- [ ] Zero production errors for 48 hours
- [ ] Room count unchanged: ______
- [ ] Reservation count unchanged or increased: ______
- [ ] Front Office count unchanged or increased: ______
- [ ] All regression tests pass
- [ ] Average response time < 500ms
- [ ] Customer support tickets: 0 related to change

**Only after ALL criteria met**: Mark deployment complete and clean up old backups.

---

## 🚨 Emergency Rollback Triggers

Execute immediate rollback if **ANY** occur:

1. **Data Loss**: Any decrease in protected module record counts
2. **High Error Rate**: > 1% error rate in logs
3. **Orphaned Records**: Data integrity check fails
4. **Critical Workflow Broken**: Users cannot complete essential tasks
5. **Database Corruption**: Any DB consistency errors
6. **Performance Degradation**: > 50% slower response times
7. **Customer Reports**: Multiple reports of data loss or errors

**Decision Authority**: Senior System Architect or DevOps Lead

**Action**: 
```bash
./scripts/rollback.sh [last_good_backup_timestamp]
```

---

## 📊 Monitoring Commands

### Check System Health
```bash
# Application status
pm2 status

# Health endpoint
curl http://localhost:3000/health

# Error count (last hour)
grep -i "error" /var/log/corepms/error.log | tail -100 | wc -l
```

### Check Data Integrity
```bash
# Quick check
./scripts/verify-data-integrity.sh

# Compare with baseline
./scripts/verify-data-integrity.sh [backup_timestamp]

# Manual SQL check
mysql -u root -p corepms -e "
    SELECT 
        'rooms' as table_name, COUNT(*) as count FROM rooms
    UNION ALL
    SELECT 'reservations', COUNT(*) FROM reservations
    UNION ALL
    SELECT 'front_office', COUNT(*) FROM front_office_transactions;
"
```

### Check Recent Deployments
```bash
# View deployment history
mysql -u root -p corepms -e "
    SELECT version, deployed_at, status, rollback_tag 
    FROM deployment_history 
    ORDER BY deployed_at DESC 
    LIMIT 10;
"
```

---

## 📞 Emergency Contacts

**Critical Issue Response Protocol**:

1. **Detect Issue**: Error rate spike, data loss, system down
2. **Immediate Action**: Execute rollback script
3. **Notify Team**: 
   - Senior System Architect: [Contact]
   - DevOps Lead: [Contact]
   - Database Admin: [Contact]
4. **Document**: Create incident report with timeline
5. **Root Cause**: Post-mortem after system stabilized

---

## 🔧 Troubleshooting

### Issue: Backup script fails
```bash
# Check disk space
df -h /var/backups

# Check database access
mysql -u root -p -e "SHOW DATABASES;"

# Check Git status
git status
```

### Issue: Rollback script fails
```bash
# Manual rollback steps:
1. pm2 stop corepms
2. git checkout [rollback_tag]
3. npm ci
4. mysql -u root -p corepms < /var/backups/corepms/db_backup_[timestamp].sql
5. pm2 start corepms

# Verify
./scripts/verify-data-integrity.sh
```

### Issue: Data integrity check fails
```bash
# Get detailed SQL report
mysql -u root -p corepms << 'EOF'
-- Check for orphaned rooms
SELECT COUNT(*) as orphaned_rooms FROM rooms r 
LEFT JOIN room_types rt ON r.room_type_id = rt.id 
WHERE rt.id IS NULL;

-- Check for invalid reservations
SELECT COUNT(*) as invalid_reservations FROM reservations res 
LEFT JOIN rooms r ON res.room_id = r.id 
WHERE r.id IS NULL;

-- Check date integrity
SELECT COUNT(*) as invalid_dates FROM reservations 
WHERE check_out_date <= check_in_date;
EOF
```

---

## 📚 Additional Documentation

- **Complete Guide**: `antigravity_prompt.md` - Full system architecture and procedures
- **Deployment Checklist**: `DEPLOYMENT_CHECKLIST.md` - Step-by-step deployment guide
- **AntiGravity Prompt**: Give this to your AI assistant for automated scaffolding

---

## 🎓 Best Practices

1. **Always backup before changes** - No exceptions
2. **Test rollback on staging** - Verify it works before production
3. **Use feature flags** - Deploy dark, enable gradually
4. **Monitor continuously** - First 48 hours are critical
5. **Verify data integrity** - After every deployment
6. **Document everything** - Future you will thank you
7. **Keep backups** - Retain last 7 days minimum
8. **Test in staging first** - With production data snapshot
9. **Have rollback plan ready** - Before deployment starts
10. **Communicate clearly** - Keep team informed

---

## 📝 Version History

- **v1.0.0** (2026-03-19): Initial deployment safety system
  - Full backup/rollback automation
  - Data integrity verification
  - Version management
  - Deployment checklists

---

## 🤝 Contributing

Before modifying these scripts:
1. Test changes on staging environment
2. Document changes in CHANGELOG.md
3. Update this README if user-facing
4. Get approval from system architect

---

## ⚖️ License

Internal use only - COREPMS Production System

---

**Remember**: When in doubt, backup and rollback. Data integrity is non-negotiable.

**Questions?** Consult `antigravity_prompt.md` or contact the system architect.
