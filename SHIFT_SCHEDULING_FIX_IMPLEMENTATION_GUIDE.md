# Shift Scheduling Fix - Quick Implementation Guide

## 🚨 Critical Issue Summary

The shift scheduling system fails on startup due to **conflicting database table definitions** for `pos_shifts`. Three different schemas exist with incompatible column names.

## ⚡ Quick Fix (30 minutes)

### Step 1: Update `src/lib/pmsAuthDb.ts`

Replace the `startShift()` function (lines 737-749):

```typescript
async startShift(userId: string, stationId: string, openingBalance: number): Promise<{ ok: boolean; id?: string; error?: string }> {
  try {
    const id = makeUuid();
    const businessDate = new Date().toISOString().split('T')[0];
    
    const shiftNumRes = await db.query<{ max_num: number }>(
      `SELECT COALESCE(MAX(shift_number), 0) + 1 as max_num FROM pos_shifts WHERE outlet = ?`,
      [stationId]
    );
    const shiftNumber = ('rows' in shiftNumRes && shiftNumRes.rows?.[0]?.max_num) || 1;
    
    const res = await db.query(
      `INSERT INTO pos_shifts (id, outlet, shift_number, business_date, opened_by, opening_cash, status) 
       VALUES (?, ?, ?, ?, ?, ?, 'open')`,
      [id, stationId, shiftNumber, businessDate, userId, openingBalance]
    );
    if ('error' in res) return { ok: false, error: res.error };
    return { ok: true, id };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Failed to start shift' };
  }
}
```

Replace the `endShift()` function (lines 751-762):

```typescript
async endShift(shiftId: string, closingBalance: number): Promise<{ ok: boolean; error?: string }> {
  try {
    const shiftRes = await db.query<{ opening_cash: number; total_cash: number }>(
      `SELECT opening_cash, total_cash FROM pos_shifts WHERE id = ?`,
      [shiftId]
    );
    
    if ('error' in shiftRes || !shiftRes.rows || shiftRes.rows.length === 0) {
      return { ok: false, error: 'Shift not found' };
    }
    
    const shift = shiftRes.rows[0];
    const expectedCash = Number(shift.opening_cash) + Number(shift.total_cash);
    const cashVariance = closingBalance - expectedCash;
    
    const res = await db.query(
      `UPDATE pos_shifts 
       SET closed_at = NOW(), 
           closing_cash = ?, 
           expected_cash = ?,
           cash_variance = ?,
           status = 'closed' 
       WHERE id = ?`,
      [closingBalance, expectedCash, cashVariance, shiftId]
    );
    if ('error' in res) return { ok: false, error: res.error };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Failed to end shift' };
  }
}
```

Update the `Shift` type (lines 23-34):

```typescript
export type Shift = {
  id: string;
  outlet: string;
  shift_number: number;
  business_date: string;
  opened_at: string;
  closed_at?: string;
  opened_by: string;
  closed_by?: string;
  opening_cash: number;
  closing_cash?: number;
  expected_cash?: number;
  cash_variance?: number;
  total_sales: number;
  total_cash: number;
  total_card: number;
  total_room_charge: number;
  total_city_ledger: number;
  total_voids: number;
  total_discounts: number;
  total_refunds: number;
  transaction_count: number;
  void_count: number;
  refund_count: number;
  status: 'open' | 'closing' | 'closed' | 'reconciled';
  is_reconciled: boolean;
  reconciled_at?: string;
  reconciled_by?: string;
  reconciliation_notes?: string;
  z_reading_number?: string;
  user_name?: string;
}
```

### Step 2: Update `src/lib/databaseInitializer.ts`

Remove or comment out the conflicting `pos_shifts` table creation (lines 61-71):

```typescript
// REMOVE OR COMMENT OUT THIS ENTIRE BLOCK:
// CREATE TABLE IF NOT EXISTS pos_shifts (
//   id VARCHAR(36) PRIMARY KEY,
//   cost_center VARCHAR(50) NOT NULL,
//   opened_by VARCHAR(36) NOT NULL,
//   opened_at TIMESTAMP NOT NULL DEFAULT NOW(),
//   closed_at TIMESTAMP,
//   opening_cash NUMERIC(12,2) NOT NULL DEFAULT 0,
//   closing_cash NUMERIC(12,2),
//   status VARCHAR(20) NOT NULL DEFAULT 'open',
//   inserted_at TIMESTAMP NOT NULL DEFAULT NOW()
// );
```

### Step 3: Update Database Schema

Connect to your PostgreSQL database and run:

```sql
-- Drop existing table (WARNING: deletes all shift data)
DROP TABLE IF EXISTS pos_shifts CASCADE;

-- Create with canonical schema
CREATE TABLE IF NOT EXISTS pos_shifts (
  id text PRIMARY KEY,
  outlet text NOT NULL DEFAULT 'Restaurant',
  shift_number integer NOT NULL DEFAULT 1,
  business_date date NOT NULL,
  opened_at timestamptz NOT NULL DEFAULT NOW(),
  closed_at timestamptz,
  opened_by text NOT NULL,
  closed_by text,
  opening_cash numeric(12,2) NOT NULL DEFAULT 0,
  closing_cash numeric(12,2),
  expected_cash numeric(12,2),
  cash_variance numeric(12,2),
  total_sales numeric(12,2) NOT NULL DEFAULT 0,
  total_cash numeric(12,2) NOT NULL DEFAULT 0,
  total_card numeric(12,2) NOT NULL DEFAULT 0,
  total_room_charge numeric(12,2) NOT NULL DEFAULT 0,
  total_city_ledger numeric(12,2) NOT NULL DEFAULT 0,
  total_voids numeric(12,2) NOT NULL DEFAULT 0,
  total_discounts numeric(12,2) NOT NULL DEFAULT 0,
  total_refunds numeric(12,2) NOT NULL DEFAULT 0,
  transaction_count integer NOT NULL DEFAULT 0,
  void_count integer NOT NULL DEFAULT 0,
  refund_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closing', 'closed', 'reconciled')),
  is_reconciled boolean NOT NULL DEFAULT false,
  reconciled_at timestamptz,
  reconciled_by text,
  reconciliation_notes text,
  z_reading_number text,
  inserted_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS pos_shifts_business_date_idx ON pos_shifts(business_date);
CREATE INDEX IF NOT EXISTS pos_shifts_outlet_idx ON pos_shifts(outlet);
CREATE INDEX IF NOT EXISTS pos_shifts_status_idx ON pos_shifts(status);
CREATE INDEX IF NOT EXISTS pos_shifts_opened_by_idx ON pos_shifts(opened_by);
```

### Step 4: Test

```bash
npm run dev
```

Navigate to POS module and test:
1. ✅ Start a shift
2. ✅ Add transactions
3. ✅ End a shift
4. ✅ Verify Z-reading generation

---

## 🔍 What Was Wrong?

### The Problem
Three different definitions of `pos_shifts` table:

| Location | Column Names | Status |
|----------|--------------|--------|
| `pmsAuthDb.ts` | `user_id`, `station_id`, `start_balance` | ❌ Wrong |
| `databaseInitializer.ts` | `cost_center`, `opened_by`, `opening_cash` | ❌ Wrong |
| `db/schema.sql` | `outlet`, `opened_by`, `opening_cash` | ✅ Correct |

### The Fix
1. Use `db/schema.sql` as single source of truth
2. Update all code to match canonical schema
3. Remove duplicate table definitions

---

## 📋 Checklist

- [ ] Backup database before changes
- [ ] Update `startShift()` function in `pmsAuthDb.ts`
- [ ] Update `endShift()` function in `pmsAuthDb.ts`
- [ ] Update `Shift` type in `pmsAuthDb.ts`
- [ ] Remove conflicting table creation in `databaseInitializer.ts`
- [ ] Drop and recreate `pos_shifts` table in database
- [ ] Test shift start functionality
- [ ] Test shift end functionality
- [ ] Verify Z-reading generation
- [ ] Check application startup logs for errors

---

## 🆘 If Something Goes Wrong

### Restore Database
```bash
psql -h localhost -U postgres -d corepms < your_backup.sql
```

### Revert Code
```bash
git checkout HEAD~1 -- src/lib/pmsAuthDb.ts
git checkout HEAD~1 -- src/lib/databaseInitializer.ts
```

### Check Logs
```bash
# Look for these errors:
# - "column does not exist"
# - "Failed to start shift"
# - "INSERT has more expressions than target columns"
```

---

## 📞 Support

For detailed analysis, see: `SHIFT_SCHEDULING_STARTUP_FAILURE_DIAGNOSTIC_REPORT.md`

**Estimated Time**: 30-60 minutes  
**Difficulty**: Medium  
**Risk Level**: Low (with backup)
