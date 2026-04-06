import { db } from './db';
import { v4 as uuidv4 } from 'uuid';

export interface InventoryPeriod {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  status: 'open' | 'reconciling' | 'closed';
  closed_at?: string;
  closed_by?: string;
}

export interface ReconciliationRow {
  product_id: string;
  product_name: string;
  unit: string;
  opening_qty: number;
  received_qty: number;
  system_usage_qty: number;
  expected_qty: number;
  physical_qty: number | null;
  variance: number;
}

export class InventoryService {
  /**
   * Start a new inventory period.
   * Ensures no overlapping periods and that the previous period is CLOSED.
   */
  static async startPeriod(name: string, startDate: string, endDate: string): Promise<{ success: boolean; error?: string; periodId?: string }> {
    try {
      // 1. Check for any non-closed periods
      const openRes = await db.query('SELECT id, name FROM inventory_periods WHERE status IN ($1, $2)', ['open', 'reconciling']);
      if ('rows' in openRes && openRes.rows.length > 0) {
        return { success: false, error: `Period "${openRes.rows[0].name}" is still open. Close it before starting a new one.` };
      }

      // 2. Fetch closing stock from previous period to use as opening balance
      const prevRes = await db.query('SELECT id FROM inventory_periods WHERE status = $1 ORDER BY end_date DESC LIMIT 1', ['closed']);
      let prevPeriodId: string | null = null;
      if ('rows' in prevRes && prevRes.rows.length > 0) {
        prevPeriodId = prevRes.rows[0].id;
      }

      // 3. Create the period
      const periodId = uuidv4();
      await db.query(
        'INSERT INTO inventory_periods (id, name, start_date, end_date, status) VALUES ($1, $2, $3, $4, $5)',
        [periodId, name, startDate, endDate, 'open']
      );

      // 4. Initial opening balances from previous physical counts
      if (prevPeriodId) {
        // Query snapshot for previous period physical stock
        const snapshots = await db.query(
          'SELECT product_id, physical_qty FROM inventory_snapshots WHERE period_id = $1',
          [prevPeriodId]
        );
        if ('rows' in snapshots && Array.isArray(snapshots.rows)) {
          for (const row of snapshots.rows) {
            if (row.physical_qty > 0) {
              await db.query(
                `INSERT INTO inventory_transactions 
                (id, period_id, product_id, type, quantity, transaction_date, is_audit_backfill) 
                VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [uuidv4(), periodId, row.product_id, 'opening_balance', row.physical_qty, startDate, true]
              );
            }
          }
        }
      }

      return { success: true, periodId };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Get reconciliation worksheet data for a period
   */
  static async getReconciliationWorksheet(periodId: string): Promise<ReconciliationRow[]> {
    const sql = `
      WITH product_base AS (
        SELECT id, name, unit FROM products WHERE is_stock_item = true
      ),
      transactions AS (
        SELECT 
          product_id,
          SUM(CASE WHEN type = 'opening_balance' THEN quantity ELSE 0 END) as opening,
          SUM(CASE WHEN type = 'purchase' THEN quantity ELSE 0 END) as received,
          SUM(CASE WHEN type = 'usage' THEN quantity ELSE 0 END) as usage,
          SUM(CASE WHEN type = 'adjustment' THEN quantity ELSE 0 END) as adjustment
        FROM inventory_transactions
        WHERE period_id = $1
        GROUP BY product_id
      ),
      current_snapshot AS (
        SELECT product_id, physical_qty, variance FROM inventory_snapshots WHERE period_id = $1
      )
      SELECT 
        p.id as product_id,
        p.name as product_name,
        p.unit,
        COALESCE(t.opening, 0) as opening_qty,
        COALESCE(t.received, 0) as received_qty,
        COALESCE(t.usage, 0) as system_usage_qty,
        COALESCE(t.adjustment, 0) as adjustment_qty,
        (COALESCE(t.opening, 0) + COALESCE(t.received, 0) + COALESCE(t.adjustment, 0) - COALESCE(t.usage, 0)) as expected_qty,
        s.physical_qty,
        s.variance
      FROM product_base p
      LEFT JOIN transactions t ON p.id = t.product_id
      LEFT JOIN current_snapshot s ON p.id = s.product_id
      ORDER BY p.name ASC
    `;
    
    const res = await db.query(sql, [periodId]);
    return ('rows' in res ? res.rows : []) as ReconciliationRow[];
  }

  /**
   * Save a physical count for a product in a period
   */
  static async updatePhysicalCount(periodId: string, productId: string, physicalQty: number): Promise<void> {
    // 1. Calculate expected and variance
    const metaRes = await db.query(
      `SELECT 
        (SUM(CASE WHEN type = 'opening_balance' THEN quantity ELSE 0 END) + 
         SUM(CASE WHEN type = 'purchase' THEN quantity ELSE 0 END) + 
         SUM(CASE WHEN type = 'adjustment' THEN quantity ELSE 0 END) - 
         SUM(CASE WHEN type = 'usage' THEN quantity ELSE 0 END)) as expected
      FROM inventory_transactions 
      WHERE period_id = $1 AND product_id = $2`,
      [periodId, productId]
    );
    const expected = metaRes.rows?.[0]?.expected || 0;
    const variance = physicalQty - Number(expected);

    // 2. Upsert snapshot
    await db.query(
      `INSERT INTO inventory_snapshots (period_id, product_id, physical_qty, variance, opening_qty, received_qty, system_usage_qty)
       SELECT $1, $2, $3, $4, 
              SUM(CASE WHEN type = 'opening_balance' THEN quantity ELSE 0 END),
              SUM(CASE WHEN type = 'purchase' THEN quantity ELSE 0 END),
              SUM(CASE WHEN type = 'usage' THEN quantity ELSE 0 END)
       FROM inventory_transactions 
       WHERE period_id = $1 AND product_id = $2
       ON CONFLICT (period_id, product_id) DO UPDATE SET
         physical_qty = EXCLUDED.physical_qty,
         variance = EXCLUDED.variance,
         updated_at = NOW()`,
      [periodId, productId, physicalQty, variance]
    );
  }

  /**
   * Close a period and sync to global stock levels
   */
  static async closePeriod(periodId: string, userId: string): Promise<{ success: boolean; error?: string }> {
    try {
      // 1. Mark period as closed
      await db.query(
        'UPDATE inventory_periods SET status = $1, closed_at = NOW(), closed_by = $2 WHERE id = $3',
        ['closed', userId, periodId]
      );

      // 2. Sync physical counts to global product stock level
      const snapshots = await db.query('SELECT product_id, physical_qty FROM inventory_snapshots WHERE period_id = $1', [periodId]);
      if ('rows' in snapshots && Array.isArray(snapshots.rows)) {
        for (const row of snapshots.rows) {
          if (row.physical_qty !== null) {
            await db.query('UPDATE products SET stock_level = $1, updated_at = NOW() WHERE id = $2', [row.physical_qty, row.product_id]);
          }
        }
      }

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }
}
