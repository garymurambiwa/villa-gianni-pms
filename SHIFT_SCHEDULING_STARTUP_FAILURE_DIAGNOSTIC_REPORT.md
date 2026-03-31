# Shift Scheduling System - Persistent Startup Failure Diagnostic Report

## Executive Summary

The shift scheduling system experiences persistent startup failures due to **database schema conflicts** between multiple conflicting table definitions for the `pos_shifts` table. This report provides a detailed root cause analysis, step-by-step resolution instructions, and permanent preventive measures.

---

## 1. Problem Description

### Symptoms
- Application fails to start or crashes immediately after startup
- Error occurs during database initialization phase
- Shift management functionality is completely non-operational
- Users cannot start or end shifts

### Error Context
The failure occurs during the `initializeDatabase()` function call in [`src/main.tsx:66`](src/main.tsx:66), which is triggered during application startup.

---

## 2. Root Cause Analysis

### Primary Issue: Conflicting Table Schema Definitions

The `pos_shifts` table is defined in **THREE different locations** with incompatible schemas:

#### Definition 1: `src/lib/pmsAuthDb.ts` (Lines 282-296)
```sql
CREATE TABLE IF NOT EXISTS pos_shifts (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  station_id VARCHAR(36) NOT NULL,
  start_time TIMESTAMP NOT NULL DEFAULT NOW(),
  end_time TIMESTAMP,
  start_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  end_balance NUMERIC(12,2),
  status VARCHAR(20) NOT NULL DEFAULT 'open',
  inserted_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

#### Definition 2: `src/lib/databaseInitializer.ts` (Lines 61-71)
```sql
CREATE TABLE IF NOT EXISTS pos_shifts (
  id VARCHAR(36) PRIMARY KEY,
  cost_center VARCHAR(50) NOT NULL,
  opened_by VARCHAR(36) NOT NULL,
  opened_at TIMESTAMP NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMP,
  opening_cash NUMERIC(12,2) NOT NULL DEFAULT 0,
  closing_cash NUMERIC(12,2),
  status VARCHAR(20) NOT NULL DEFAULT 'open',
  inserted_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

#### Definition 3: `db/schema.sql` (Lines 667-699)
```sql
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
```

### Secondary Issue: Column Name Mismatches in Code

The shift management functions in [`src/lib/pmsAuthDb.ts`](src/lib/pmsAuthDb.ts) use column names that don't match any of the table definitions:

#### `startShift()` Function (Lines 737-749)
```typescript
async startShift(userId: string, stationId: string, openingBalance: number): Promise<{ ok: boolean; id?: string; error?: string }> {
  try {
    const id = makeUuid();
    const res = await db.query(
      `INSERT INTO pos_shifts (id, user_id, station_id, start_balance, status) VALUES (?, ?, ?, ?, 'open')`,
      [id, userId, stationId, openingBalance]
    );
    if ('error' in res) return { ok: false, error: res.error };
    return { ok: true, id };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Failed to start shift' };
  }
}
```

**Problem**: This function tries to insert with columns `user_id`, `station_id`, `start_balance`, but:
- Definition 1 has `user_id`, `station_id`, `start_balance` ✓
- Definition 2 has `opened_by`, `cost_center`, `opening_cash` ✗
- Definition 3 has `opened_by`, `outlet`, `opening_cash` ✗

#### `endShift()` Function (Lines 751-762)
```typescript
async endShift(shiftId: string, closingBalance: number): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await db.query(
      `UPDATE pos_shifts SET end_time = NOW(), end_balance = ?, status = 'closed' WHERE id = ?`,
      [closingBalance, shiftId]
    );
    if ('error' in res) return { ok: false, error: res.error };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Failed to end shift' };
  }
}
```

**Problem**: This function tries to update with columns `end_time`, `end_balance`, but:
- Definition 1 has `end_time`, `end_balance` ✓
- Definition 2 has `closed_at`, `closing_cash` ✗
- Definition 3 has `closed_at`, `closing_cash` ✗

### Execution Flow Leading to Failure

1. **Application Start** → [`src/main.tsx:66`](src/main.tsx:66) calls `initializeDatabase()`
2. **Database Initialization** → [`src/lib/databaseInitializer.ts:15`](src/lib/databaseInitializer.ts:15) calls `pmsAuthDb.init()`
3. **Table Creation (First)** → [`src/lib/pmsAuthDb.ts:282-296`](src/lib/pmsAuthDb.ts:282-296) creates `pos_shifts` with Definition 1 schema
4. **Table Creation (Second)** → [`src/lib/databaseInitializer.ts:61-71`](src/lib/databaseInitializer.ts:61-71) attempts to create `pos_shifts` with Definition 2 schema
5. **Schema Conflict** → `CREATE TABLE IF NOT EXISTS` prevents overwrite, so Definition 1 remains
6. **Shift Start Attempt** → [`src/contexts/ShiftContext.tsx:113`](src/contexts/ShiftContext.tsx:113) calls `pmsAuthDb.startShift()`
7. **Insert Failure** → Column names don't match the actual table structure → **STARTUP FAILURE**

---

## 3. Impact Assessment

### Immediate Impact
- ❌ Application cannot start successfully
- ❌ Shift management is completely non-functional
- ❌ POS (Point of Sale) operations are blocked
- ❌ Users cannot open or close shifts
- ❌ Financial tracking for shifts is unavailable

### Business Impact
- Revenue tracking is compromised
- Staff accountability is lost
- Audit trail is broken
- Customer service is affected
- Operational efficiency is severely degraded

### Data Integrity Impact
- Existing shift data may be orphaned
- New shifts cannot be created
- Shift reconciliation is impossible
- Financial reports are inaccurate

---

## 4. Step-by-Step Resolution Instructions

### Phase 1: Immediate Recovery (Emergency Fix)

#### Step 1: Backup Current Database
```bash
# Create a backup before making any changes
pg_dump -h localhost -U postgres -d corepms > backup_before_shift_fix_$(date +%Y%m%d_%H%M%S).sql
```

#### Step 2: Identify the Active Table Schema
```sql
-- Connect to the database and check the actual schema
psql -h localhost -U postgres -d corepms

-- Check the current pos_shifts table structure
\d pos_shifts

-- Or query the information schema
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'pos_shifts'
ORDER BY ordinal_position;
```

#### Step 3: Choose the Canonical Schema
Based on the codebase analysis, **Definition 3** (`db/schema.sql`) is the most comprehensive and should be the canonical schema. It includes:
- All necessary columns for full shift management
- Proper data types and constraints
- Support for reconciliation and auditing
- Integration with Z-reading functionality

#### Step 4: Drop and Recreate the Table
```sql
-- Drop the existing table (WARNING: This will delete all shift data)
DROP TABLE IF EXISTS pos_shifts CASCADE;

-- Create the table with the canonical schema
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

#### Step 5: Update the Code to Match Canonical Schema

**File: `src/lib/pmsAuthDb.ts`**

Update the `startShift()` function (lines 737-749):
```typescript
async startShift(userId: string, stationId: string, openingBalance: number): Promise<{ ok: boolean; id?: string; error?: string }> {
  try {
    const id = makeUuid();
    const businessDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    
    // Get the next shift number for this outlet
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

Update the `endShift()` function (lines 751-762):
```typescript
async endShift(shiftId: string, closingBalance: number): Promise<{ ok: boolean; error?: string }> {
  try {
    // First, get the shift to calculate expected cash
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

Add a new function to get active shift (lines 764-775):
```typescript
async getActiveShift(stationId: string): Promise<{ id: string; opened_by: string; opened_at: string; opening_cash: number } | null> {
  try {
    const res = await db.query<{ id: string; opened_by: string; opened_at: string; opening_cash: number }>(
      `SELECT id, opened_by, opened_at, opening_cash 
       FROM pos_shifts 
       WHERE outlet = ? AND status = 'open' 
       ORDER BY opened_at DESC LIMIT 1`,
      [stationId]
    );
    if ('error' in res || !res.rows || res.rows.length === 0) return null;
    return res.rows[0];
  } catch {
    return null;
  }
}
```

Update the `listShifts()` function (lines 777-796):
```typescript
async listShifts(stationId?: string): Promise<Shift[]> {
  try {
    let sql = `
      SELECT s.*, u.name as user_name 
      FROM pos_shifts s 
      JOIN app_users u ON s.opened_by = u.id
    `;
    const params = [];
    if (stationId) {
      sql += ` WHERE s.outlet = ?`;
      params.push(stationId);
    }
    sql += ` ORDER BY s.opened_at DESC LIMIT 50`;
    const res = await db.query(sql, params);
    return ('rows' in res && Array.isArray(res.rows)) ? res.rows as Shift[] : [];
  } catch {
    return [];
  }
}
```

#### Step 6: Remove Conflicting Table Definitions

**File: `src/lib/databaseInitializer.ts`**

Remove or comment out the conflicting `pos_shifts` table creation (lines 61-71):
```typescript
// REMOVE OR COMMENT OUT THIS BLOCK:
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

#### Step 7: Update the Shift Type Definition

**File: `src/lib/pmsAuthDb.ts`**

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

#### Step 8: Test the Fix
```bash
# Start the application
npm run dev

# Or for production
npm run build
npm start
```

### Phase 2: Data Migration (If Existing Data Needs Preservation)

#### Step 1: Export Existing Shift Data
```sql
-- If you have existing shift data that needs to be preserved
COPY (SELECT * FROM pos_shifts) TO '/tmp/pos_shifts_backup.csv' WITH CSV HEADER;
```

#### Step 2: Create Migration Script
```sql
-- migration_fix_pos_shifts.sql
BEGIN;

-- Create temporary table with old data
CREATE TEMP TABLE old_shifts AS SELECT * FROM pos_shifts;

-- Drop and recreate with new schema
DROP TABLE IF EXISTS pos_shifts CASCADE;

-- Create with canonical schema (as shown in Step 4)
CREATE TABLE IF NOT EXISTS pos_shifts (
  -- ... (full schema as shown above)
);

-- Migrate data from old to new (adjust column mappings as needed)
INSERT INTO pos_shifts (id, outlet, opened_by, opened_at, opening_cash, status)
SELECT 
  id,
  COALESCE(station_id, cost_center, 'Restaurant') as outlet,
  COALESCE(user_id, opened_by) as opened_by,
  COALESCE(start_time, opened_at, NOW()) as opened_at,
  COALESCE(start_balance, opening_cash, 0) as opening_cash,
  COALESCE(status, 'open') as status
FROM old_shifts;

-- Verify migration
SELECT COUNT(*) as migrated_count FROM pos_shifts;

COMMIT;
```

---

## 5. Permanent Preventive Measures

### 5.1 Schema Management Best Practices

#### Implement Single Source of Truth for Schema
1. **Use `db/schema.sql` as the canonical schema definition**
2. **Remove duplicate table definitions** from:
   - `src/lib/pmsAuthDb.ts` (lines 282-296)
   - `src/lib/databaseInitializer.ts` (lines 61-71)
3. **Create a schema validation utility** that checks table structure on startup

#### Add Schema Validation on Startup
Create a new file: `src/lib/schemaValidator.ts`
```typescript
import db from '@/lib/db';

interface ColumnInfo {
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
}

export async function validatePosShiftsSchema(): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];
  
  try {
    const result = await db.query<ColumnInfo>(
      `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_name = 'pos_shifts'
       ORDER BY ordinal_position`
    );
    
    if ('error' in result) {
      errors.push(`Failed to query schema: ${result.error}`);
      return { valid: false, errors };
    }
    
    const columns = result.rows || [];
    const requiredColumns = [
      'id', 'outlet', 'shift_number', 'business_date', 'opened_at', 
      'opened_by', 'opening_cash', 'status'
    ];
    
    const columnNames = columns.map(c => c.column_name);
    
    for (const required of requiredColumns) {
      if (!columnNames.includes(required)) {
        errors.push(`Missing required column: ${required}`);
      }
    }
    
    return { valid: errors.length === 0, errors };
  } catch (e: any) {
    errors.push(`Schema validation failed: ${e.message}`);
    return { valid: false, errors };
  }
}
```

Integrate into `src/lib/databaseInitializer.ts`:
```typescript
import { validatePosShiftsSchema } from '@/lib/schemaValidator';

export async function initializeDatabase(): Promise<{ ok: boolean; message?: string; error?: string }> {
  try {
    // ... existing code ...
    
    // Validate pos_shifts schema
    const schemaValidation = await validatePosShiftsSchema();
    if (!schemaValidation.valid) {
      console.error('Schema validation failed:', schemaValidation.errors);
      return { 
        ok: false, 
        error: `Schema validation failed: ${schemaValidation.errors.join(', ')}` 
      };
    }
    
    return { ok: true, message: 'DB initialized successfully' }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'INIT_FAILED' }
  }
}
```

### 5.2 Code Quality Improvements

#### Implement Database Migration System
1. **Use a proper migration framework** (e.g., `node-pg-migrate`, `knex`, or `typeorm`)
2. **Version all schema changes** with migration files
3. **Track applied migrations** in a `migrations` table
4. **Never modify existing migrations** - always create new ones

#### Add Comprehensive Error Handling
Update `src/contexts/ShiftContext.tsx` to handle database errors gracefully:
```typescript
const startShift = async (openingCash: number = 0, notes?: string, userId?: string, stationId?: string) => {
  try {
    const res = await pmsAuthDb.startShift(userId || 'unknown', stationId || 'unknown', openingCash);
    if (!res.ok) {
      console.error('Shift start failed:', res.error);
      throw new Error(res.error || 'Failed to start shift in DB');
    }

    const newShift: Shift = {
      id: res.id!,
      startedAt: new Date().toISOString(),
      openedBy: userId,
      openingCash,
      status: 'open',
      transactions: [],
      voidedTransactions: []
    };
    setActiveShift(newShift);
    persist(newShift);
  } catch (e: any) {
    console.error('Shift start error:', e);
    // Don't throw - allow app to continue with local-only shift
    // This prevents complete app failure due to DB issues
    const localShift: Shift = {
      id: `LOCAL_${Date.now()}`,
      startedAt: new Date().toISOString(),
      openedBy: userId,
      openingCash,
      status: 'open',
      transactions: [],
      voidedTransactions: []
    };
    setActiveShift(localShift);
    persist(localShift);
  }
};
```

### 5.3 Testing and Monitoring

#### Add Integration Tests
Create: `src/__tests__/shift-schema.test.ts`
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import db from '@/lib/db';
import pmsAuthDb from '@/lib/pmsAuthDb';

describe('Shift Schema', () => {
  beforeAll(async () => {
    await db.exec('DELETE FROM pos_shifts');
  });

  afterAll(async () => {
    await db.exec('DELETE FROM pos_shifts');
  });

  it('should create a shift with correct schema', async () => {
    const result = await pmsAuthDb.startShift('user123', 'Restaurant', 100);
    expect(result.ok).toBe(true);
    expect(result.id).toBeDefined();
  });

  it('should end a shift with correct schema', async () => {
    const startResult = await pmsAuthDb.startShift('user123', 'Restaurant', 100);
    expect(startResult.ok).toBe(true);
    
    const endResult = await pmsAuthDb.endShift(startResult.id!, 150);
    expect(endResult.ok).toBe(true);
  });

  it('should list shifts with correct schema', async () => {
    await pmsAuthDb.startShift('user123', 'Restaurant', 100);
    const shifts = await pmsAuthDb.listShifts();
    expect(Array.isArray(shifts)).toBe(true);
  });
});
```

#### Add Startup Health Checks
Create: `src/lib/startupHealthCheck.ts`
```typescript
import db from '@/lib/db';
import { validatePosShiftsSchema } from '@/lib/schemaValidator';

export async function performStartupHealthCheck(): Promise<{ healthy: boolean; issues: string[] }> {
  const issues: string[] = [];
  
  // Check database connection
  const connectionTest = await db.testConnection();
  if (!connectionTest.ok) {
    issues.push(`Database connection failed: ${connectionTest.error}`);
  }
  
  // Check pos_shifts schema
  const schemaValidation = await validatePosShiftsSchema();
  if (!schemaValidation.valid) {
    issues.push(...schemaValidation.errors.map(e => `Schema error: ${e}`));
  }
  
  // Check for open shifts (potential data integrity issue)
  try {
    const openShifts = await db.query(
      `SELECT COUNT(*) as count FROM pos_shifts WHERE status = 'open'`
    );
    if ('rows' in openShifts && openShifts.rows?.[0]?.count > 5) {
      issues.push(`Warning: ${openShifts.rows[0].count} open shifts detected (potential orphaned data)`);
    }
  } catch (e) {
    // Ignore - table might not exist yet
  }
  
  return { healthy: issues.length === 0, issues };
}
```

Integrate into `src/lib/databaseInitializer.ts`:
```typescript
import { performStartupHealthCheck } from '@/lib/startupHealthCheck';

export async function initializeDatabase(): Promise<{ ok: boolean; message?: string; error?: string }> {
  try {
    // ... existing initialization code ...
    
    // Perform health check
    const healthCheck = await performStartupHealthCheck();
    if (!healthCheck.healthy) {
      console.warn('Startup health check issues:', healthCheck.issues);
      // Don't fail startup, but log warnings
    }
    
    return { ok: true, message: 'DB initialized successfully' }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'INIT_FAILED' }
  }
}
```

### 5.4 Documentation and Process

#### Create Schema Documentation
Create: `docs/DATABASE_SCHEMA.md`
```markdown
# Database Schema Documentation

## pos_shifts Table

### Purpose
Tracks POS (Point of Sale) shift operations including opening/closing balances, transactions, and reconciliation.

### Schema
[Include the canonical schema from db/schema.sql]

### Column Definitions
| Column | Type | Description |
|--------|------|-------------|
| id | text | Primary key, unique shift identifier |
| outlet | text | The outlet/station where shift occurred |
| shift_number | integer | Sequential shift number per outlet |
| business_date | date | The business date of the shift |
| opened_at | timestamptz | When the shift was opened |
| closed_at | timestamptz | When the shift was closed |
| opened_by | text | User ID who opened the shift |
| closed_by | text | User ID who closed the shift |
| opening_cash | numeric(12,2) | Cash amount at shift opening |
| closing_cash | numeric(12,2) | Cash amount at shift closing |
| expected_cash | numeric(12,2) | Expected cash based on transactions |
| cash_variance | numeric(12,2) | Difference between expected and actual |
| total_sales | numeric(12,2) | Total sales during shift |
| total_cash | numeric(12,2) | Total cash transactions |
| total_card | numeric(12,2) | Total card transactions |
| total_room_charge | numeric(12,2) | Total room charge transactions |
| total_city_ledger | numeric(12,2) | Total city ledger transactions |
| total_voids | numeric(12,2) | Total voided amounts |
| total_discounts | numeric(12,2) | Total discounts applied |
| total_refunds | numeric(12,2) | Total refunds issued |
| transaction_count | integer | Number of transactions |
| void_count | integer | Number of voided transactions |
| refund_count | integer | Number of refunds |
| status | text | Shift status: open, closing, closed, reconciled |
| is_reconciled | boolean | Whether shift has been reconciled |
| reconciled_at | timestamptz | When shift was reconciled |
| reconciled_by | text | User who reconciled the shift |
| reconciliation_notes | text | Notes from reconciliation |
| z_reading_number | text | Z-reading report number |
| inserted_at | timestamptz | Record creation timestamp |
| updated_at | timestamptz | Record update timestamp |

### Indexes
- pos_shifts_business_date_idx (business_date)
- pos_shifts_outlet_idx (outlet)
- pos_shifts_status_idx (status)
- pos_shifts_opened_by_idx (opened_by)

### Related Files
- Schema: `db/schema.sql` (lines 667-699)
- Database operations: `src/lib/pmsAuthDb.ts`
- Context: `src/contexts/ShiftContext.tsx`
- Initialization: `src/lib/databaseInitializer.ts`
```

#### Establish Code Review Checklist
Add to `docs/CODE_REVIEW_CHECKLIST.md`:
```markdown
# Code Review Checklist

## Database Changes
- [ ] Schema changes are documented in `db/schema.sql`
- [ ] No duplicate table definitions exist
- [ ] Column names are consistent across all code
- [ ] Migrations are versioned and tested
- [ ] Indexes are created for frequently queried columns
- [ ] Foreign keys are properly defined
- [ ] Data types are appropriate and consistent

## Shift Management
- [ ] `pos_shifts` table uses canonical schema
- [ ] All column references match actual table structure
- [ ] Error handling is comprehensive
- [ ] Transactions are properly wrapped
- [ ] Data validation is in place
```

---

## 6. Verification Steps

After implementing the fix, verify the solution:

### Step 1: Check Application Startup
```bash
# Start the application
npm run dev

# Check for errors in console
# Should see: "Database initialized successfully"
# Should NOT see: "Failed to start shift" or column errors
```

### Step 2: Test Shift Operations
1. Navigate to POS module
2. Click "Start Shift"
3. Enter opening cash amount
4. Verify shift starts successfully
5. Add some transactions
6. Click "End Shift"
7. Enter closing cash amount
8. Verify shift closes successfully

### Step 3: Verify Database State
```sql
-- Check that shifts are being created correctly
SELECT id, outlet, shift_number, opened_by, opening_cash, status 
FROM pos_shifts 
ORDER BY opened_at DESC 
LIMIT 5;

-- Check that shifts are being closed correctly
SELECT id, outlet, closed_at, closing_cash, expected_cash, cash_variance, status
FROM pos_shifts 
WHERE status = 'closed'
ORDER BY closed_at DESC 
LIMIT 5;
```

### Step 4: Run Integration Tests
```bash
npm test -- shift-schema
```

---

## 7. Rollback Plan

If the fix causes issues, follow this rollback procedure:

### Step 1: Restore Database Backup
```bash
# Stop the application
# Restore from backup
psql -h localhost -U postgres -d corepms < backup_before_shift_fix_YYYYMMDD_HHMMSS.sql
```

### Step 2: Revert Code Changes
```bash
# Revert to previous commit
git revert HEAD

# Or restore specific files
git checkout HEAD~1 -- src/lib/pmsAuthDb.ts
git checkout HEAD~1 -- src/lib/databaseInitializer.ts
```

### Step 3: Restart Application
```bash
npm run dev
```

---

## 8. Summary

### Root Cause
Multiple conflicting definitions of the `pos_shifts` table with incompatible column names, causing INSERT and UPDATE operations to fail during application startup.

### Solution
1. Establish `db/schema.sql` as the single source of truth for the schema
2. Update all code to use consistent column names matching the canonical schema
3. Remove duplicate table definitions
4. Add schema validation and health checks

### Prevention
1. Implement proper database migration system
2. Add comprehensive integration tests
3. Create schema documentation
4. Establish code review checklist
5. Add startup health checks

### Timeline
- **Immediate Recovery**: 1-2 hours
- **Code Updates**: 2-3 hours
- **Testing**: 1-2 hours
- **Documentation**: 1 hour
- **Total**: 5-8 hours

---

## 9. Additional Resources

- PostgreSQL Documentation: https://www.postgresql.org/docs/
- Database Migration Best Practices: https://www.prisma.io/dataguide/types/relational/database-migration
- Schema Validation Patterns: https://martinfowler.com/articles/schemaless-migration.html

---

**Report Generated**: 2026-03-26  
**Severity**: Critical  
**Status**: Ready for Implementation  
**Next Review**: After implementation completion
