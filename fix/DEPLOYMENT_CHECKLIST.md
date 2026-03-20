# 🚀 PRODUCTION DEPLOYMENT CHECKLIST
**COREPMS - Live System with Protected Data**

---

## ⚠️ PRE-DEPLOYMENT (MANDATORY)

### 1. Environment Validation
- [ ] Verify current Git branch: `git branch --show-current`
- [ ] Check for uncommitted changes: `git status` (should be clean)
- [ ] Verify database connection: Test connection to production DB
- [ ] Confirm backup storage has sufficient space (min 10GB)
- [ ] Verify you have database credentials and root access

### 2. Full System Backup
```bash
./scripts/backup-full-system.sh
```
- [ ] Database backup created successfully
- [ ] Application data backup completed
- [ ] Data inventory recorded (rooms, reservations, front_office counts)
- [ ] Git rollback tag created: `pre-refactor-YYYYMMDD_HHMMSS`
- [ ] Rollback script tested on staging

**Record backup timestamp**: ___________________

### 3. Data Baseline Documentation
Document current state:
- [ ] Rooms count: _______
- [ ] Reservations count: _______
- [ ] Front Office transactions count: _______
- [ ] Bills count: _______
- [ ] Active users count: _______

### 4. Rollback Verification
- [ ] Test rollback script on staging environment
- [ ] Verify database restoration works
- [ ] Confirm rollback completes in < 5 minutes
- [ ] Rollback script location documented: `/home/claude/scripts/rollback.sh`

---

## 🔧 DEVELOPMENT PHASE

### 5. Code Changes
- [ ] All changes isolated to target module only
- [ ] NO modifications to: `rooms/*`, `front-office/*`, `reservation/*`
- [ ] NO changes to global state management
- [ ] NO changes to authentication/authorization
- [ ] Code reviewed by senior developer
- [ ] All console.log / debug statements removed

### 6. Database Migrations
If schema changes required:
- [ ] Migration scripts include `up()` and `down()` functions
- [ ] Default values set to preserve existing data
- [ ] No column deletions without data backup
- [ ] Migration tested on production data snapshot
- [ ] Rollback migration verified
- [ ] Migration completes in < 5 seconds

### 7. Version Bump
```bash
./scripts/bump-version.sh
```
- [ ] Version bumped (patch/minor/major)
- [ ] CHANGELOG.md updated
- [ ] Rollback tag created
- [ ] Git commit created
- [ ] Version tags pushed to repository

**New version number**: ___________________

---

## 🧪 TESTING PHASE

### 8. Unit & Integration Tests
- [ ] All existing tests pass: `npm test`
- [ ] New tests added for changed functionality
- [ ] Test coverage maintained or improved
- [ ] No test skips or ignores without justification

### 9. Data Integrity Tests
```bash
npm run test:data-integrity
```
- [ ] Rooms module tests pass (100%)
- [ ] Reservations module tests pass (100%)
- [ ] Front Office module tests pass (100%)
- [ ] Cross-module relationship tests pass
- [ ] No orphaned records detected

### 10. Module Isolation Verification
- [ ] Run tests for Rooms module: `npm run test:rooms` ✅
- [ ] Run tests for Reservations: `npm run test:reservations` ✅
- [ ] Run tests for Front Office: `npm run test:front-office` ✅
- [ ] Verify NO test failures in protected modules

### 11. Regression Testing
- [ ] Full regression suite executed
- [ ] All critical user workflows tested manually
- [ ] Edge cases validated
- [ ] Performance benchmarks meet requirements

---

## 🏗️ STAGING DEPLOYMENT

### 12. Staging Environment
- [ ] Deploy to staging with production data snapshot
- [ ] Run data integrity verification: `./scripts/verify-data-integrity.sh`
- [ ] Feature flag set to OFF initially
- [ ] Test rollback procedure on staging
- [ ] Staging passes all smoke tests

### 13. Staging Validation
- [ ] Manual QA on staging completed
- [ ] All critical workflows functional
- [ ] No errors in staging logs for 24 hours
- [ ] Performance acceptable under load
- [ ] Security scan passed

### 14. Data Count Comparison
Run before and after deployment on staging:
```bash
./scripts/verify-data-integrity.sh [backup_timestamp]
```
- [ ] Room counts match exactly
- [ ] Reservation counts match or increased
- [ ] Front Office counts match or increased
- [ ] No data loss detected

---

## 🚀 PRODUCTION DEPLOYMENT

### 15. Pre-Deployment Final Checks
- [ ] All previous checklist items completed
- [ ] Backup verified and restoration tested
- [ ] Rollback script ready and tested
- [ ] Team notified of deployment window
- [ ] On-call engineer identified and available

### 16. Deployment Window
Scheduled time: ___________________
Duration estimate: ___________________

- [ ] Low-traffic period selected
- [ ] Customer support notified
- [ ] Status page updated (if applicable)

### 17. Deployment Execution
```bash
# 1. Merge to production branch
git checkout production
git merge feature/branch-name
git push origin production

# 2. Deploy application
./scripts/deploy-production.sh

# 3. Run migrations (if any)
npm run migrate:production

# 4. Restart application
pm2 restart corepms
```

- [ ] Code deployed successfully
- [ ] Migrations executed without errors
- [ ] Application restarted
- [ ] Health check endpoint responding: `curl http://localhost:3000/health`

### 18. Immediate Post-Deployment
- [ ] Application started successfully
- [ ] No errors in logs: `tail -f /var/log/corepms/error.log`
- [ ] Health check passing
- [ ] Critical endpoints responding

---

## 🔍 POST-DEPLOYMENT MONITORING

### 19. Data Integrity Verification (Critical)
```bash
./scripts/verify-data-integrity.sh [backup_timestamp]
```
- [ ] Rooms count matches pre-deployment: _______
- [ ] Reservations count matches or increased: _______
- [ ] Front Office count matches or increased: _______
- [ ] No orphaned records detected
- [ ] All foreign key relationships intact

### 20. Feature Flag Rollout (if applicable)
**Day 1**: Deploy with flag OFF
- [ ] Code live but inactive
- [ ] Monitor for 24 hours
- [ ] Zero errors detected

**Day 2**: Enable for 10% users
- [ ] Set ROLLOUT_PERCENTAGE=10
- [ ] Monitor for 48 hours
- [ ] Check error rates
- [ ] Verify data integrity

**Day 4**: Enable for 50% users
- [ ] Set ROLLOUT_PERCENTAGE=50
- [ ] Monitor for 48 hours
- [ ] Compare metrics vs baseline

**Day 6**: Enable for 100% users
- [ ] Set ROLLOUT_PERCENTAGE=100
- [ ] Monitor continuously
- [ ] Mark rollout complete

### 21. Error Monitoring (First 24 Hours)
Monitor error logs every hour:
```bash
grep -i "error" /var/log/corepms/error.log | wc -l
```
- [ ] Hour 1: Error count: _______
- [ ] Hour 2: Error count: _______
- [ ] Hour 4: Error count: _______
- [ ] Hour 8: Error count: _______
- [ ] Hour 24: Error count: _______

**Alert Threshold**: More than 10 errors/hour = Investigate immediately

### 22. Performance Monitoring
- [ ] Average response time < 500ms
- [ ] Database query performance acceptable
- [ ] Memory usage stable
- [ ] CPU usage within normal range
- [ ] No connection pool exhaustion

### 23. User Feedback
- [ ] Customer support tickets: _____ (should be 0 related to change)
- [ ] User complaints: _____ (should be 0)
- [ ] Positive feedback documented

---

## ✅ DEPLOYMENT COMPLETION

### 24. Success Criteria Verification
**ALL must be TRUE to mark deployment successful:**

- [ ] Zero data loss detected (verified via data integrity script)
- [ ] Zero production errors for 48 hours
- [ ] All protected modules unchanged (Rooms, Reservations, Front Office)
- [ ] Performance metrics within acceptable range
- [ ] Feature flag at 100% (if applicable)
- [ ] Customer support tickets: 0 related to deployment
- [ ] Manual testing of critical workflows: PASS
- [ ] Database record counts match or exceed baseline

### 25. Final Documentation
- [ ] Update deployment log with actual timings
- [ ] Document any issues encountered and resolutions
- [ ] Update runbook with lessons learned
- [ ] Archive deployment artifacts
- [ ] Update deployment_history table status to 'SUCCESS'

```sql
UPDATE deployment_history 
SET status = 'SUCCESS', deployed_at = NOW() 
WHERE version = '[NEW_VERSION]';
```

### 26. Cleanup (After 7 Days)
Only after verified success:
- [ ] Remove old backup files (keep last 3)
- [ ] Archive old Git tags
- [ ] Remove feature flag code (if 100% enabled)
- [ ] Update documentation

---

## 🚨 ROLLBACK PROCEDURE

**If ANY of the following occur, ROLLBACK IMMEDIATELY:**

- ❌ Data count decreased for Rooms, Reservations, or Front Office
- ❌ Error rate > 1% in production logs
- ❌ Any orphaned records detected
- ❌ Critical workflow broken
- ❌ Database corruption detected
- ❌ Performance degradation > 50%
- ❌ Customer-reported data loss

### Emergency Rollback Steps
```bash
# 1. Execute rollback script
./scripts/rollback.sh [backup_timestamp]

# 2. Verify system restored
./scripts/verify-data-integrity.sh

# 3. Confirm application running
pm2 status

# 4. Check logs for errors
tail -f /var/log/corepms/error.log

# 5. Notify team
echo "ROLLBACK EXECUTED - System restored to [backup_timestamp]" | mail -s "URGENT: Production Rollback" team@example.com
```

**Rollback Decision Authority**: Senior System Architect OR DevOps Lead

---

## 📞 EMERGENCY CONTACTS

**Primary**: Senior System Architect - [Phone/Email]
**Secondary**: DevOps Lead - [Phone/Email]
**Database Admin**: [Phone/Email]
**On-Call Engineer**: [Phone/Email]

---

## ✍️ DEPLOYMENT SIGN-OFF

**Deployment Prepared By**: ___________________
**Signature**: ___________________
**Date**: ___________________

**Deployment Approved By**: ___________________
**Signature**: ___________________
**Date**: ___________________

**Deployment Executed By**: ___________________
**Signature**: ___________________
**Date**: ___________________
**Time**: ___________________

**Verification Completed By**: ___________________
**Signature**: ___________________
**Date**: ___________________

---

**Notes / Issues Encountered**:

_____________________________________________________________

_____________________________________________________________

_____________________________________________________________

_____________________________________________________________

---

**Status**: [ ] In Progress  [ ] Success  [ ] Rolled Back  [ ] Failed

**Final Outcome**: _____________________________________________________________

---

*This checklist must be completed in full for every production deployment affecting live data modules.*
