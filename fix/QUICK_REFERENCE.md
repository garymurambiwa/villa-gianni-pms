# 🚀 COREPMS Deployment - Quick Reference Card

## Before ANY Changes
```bash
./scripts/backup-full-system.sh
# SAVE THE TIMESTAMP!
```

## Emergency Rollback
```bash
./scripts/rollback.sh [timestamp]
```

## Check Data Integrity
```bash
./scripts/verify-data-integrity.sh [timestamp]
```

## Bump Version
```bash
./scripts/bump-version.sh
```

## Protected Modules (DO NOT TOUCH)
- ❌ rooms/*
- ❌ front-office/*
- ❌ reservation/*

## Success Criteria Checklist
- [ ] Zero data loss
- [ ] Zero errors for 48 hours
- [ ] All protected module counts unchanged
- [ ] All tests pass

## Emergency Contacts
Architect: _______________
DevOps: _______________
DBA: _______________

---
**Rule #1**: Backup before every change
**Rule #2**: When in doubt, rollback immediately
**Rule #3**: Data integrity is non-negotiable
