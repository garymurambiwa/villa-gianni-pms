import { db } from './db';
import { v4 as uuidv4 } from 'uuid';

export interface InventoryPeriod {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  status: 'open' | 'reconciling' | 'closed' | 'future' | 'locked';
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
      // Derive year/month from dates
      const start = new Date(startDate);
      const periodYear = start.getFullYear();
      const periodMonth = start.getMonth() + 1;

      // 1. Check for any non-closed periods using dedicated check via direct query (still uses db)
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

      // 3. Create the period via dedicated endpoint to enforce singleton
      const periodId = uuidv4();
      const response = await fetch('/api/inventory/periods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          period_name: name,
          period_year: periodYear,
          period_month: periodMonth,
          start_date: startDate,
          end_date: endDate,
          status: 'open',
          opening_stock_value: 0, // will be set later after backfill? Keep zero.
          created_by: 'system'
        })
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        return { success: false, error: data.error || 'Failed to create period' };
      }
      const newPeriodId = data.rows[0]?.id || periodId;

      // 4. Initial opening balances from previous period physical counts if exists
      if (prevPeriodId) {
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
                [uuidv4(), newPeriodId, row.product_id, 'opening_balance', row.physical_qty, startDate, true]
              );
            }
          }
        }
      }

      return { success: true, periodId: newPeriodId };
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
    // This updates product's latest physical count for later close reconciliation
    await db.query(
      `UPDATE products SET last_inventory_period_id = ?, last_physical_qty = ?, last_physical_date = ? WHERE id = ?`,
      [periodId, physicalQty, new Date().toISOString().split('T')[0], productId]
    );
  }

  /**
   * Close a period and sync to global stock levels (legacy – retained for InventoryDashboard)
   */
  static async closePeriod(periodId: string, userId: string): Promise<{ success: boolean; error?: string }> {
    try {
      // Fetch period and products
      const periodRes = await db.query('SELECT * FROM inventory_periods WHERE id = $1', [periodId]);
      if (!('rows' in periodRes) || periodRes.rows.length === 0) {
        return { success: false, error: 'Period not found' };
      }
      const period = periodRes.rows[0];
      
      // Calculate closing values using same logic as UI closePeriod (valuation)
      const productsRes = await db.query(
        `SELECT id, name, department, stock_level, cost_price, last_physical_qty 
         FROM products 
         WHERE is_stock_item = true AND department IN ('Kitchen', 'Cellar')`
      );
      if (!('rows' in productsRes)) {
        return { success: false, error: 'Failed to fetch products' };
      }
      const products = productsRes.rows;
      
      let closingValue = 0;
      let kitchenVarVal = 0;
      let cellarVarVal = 0;
      
      for (const p of products) {
        const physQty = Number(p.last_physical_qty || p.stock_level || 0);
        const bookQty = Number(p.stock_level || 0);
        const costPrice = Number(p.cost_price || 0);
        
        closingValue += physQty * costPrice;
        const varianceQty = physQty - bookQty;
        const varianceVal = varianceQty * costPrice;
        
        if ((p.department || '').toLowerCase() === 'kitchen') kitchenVarVal += varianceVal;
        else if ((p.department || '').toLowerCase() === 'cellar') cellarVarVal += varianceVal;
      }
      
      const totalVarianceVal = kitchenVarVal + cellarVarVal;
      const cogsVal = Number(period.opening_stock_value || 0) + Number(period.received_value || 0) - closingValue;
      
      // Call close endpoint with computed values
      // Check for zero-capture (only for non-initial periods)
      const totalTxRes = await db.query(
        `SELECT COALESCE(SUM(total_value),0) as total FROM inventory_transactions WHERE period_id = ? AND transaction_type IN ('purchase', 'grv')`,
        [periodId]
      );
      const totalTx = (totalTxRes.rows && totalTxRes.rows[0] && totalTxRes.rows[0].total) || 0;
      const managerOverride = period.opening_stock_value > 0 && period.received_value === 0 && totalTx === 0;
      
      const body = {
        period_id: periodId,
        closing_stock_value: closingValue,
        variance_value: totalVarianceVal,
        cogs_value: cogsVal,
        kitchen_cogs: kitchenVarVal,
        cellar_cogs: cellarVarVal,
        closed_by: userId,
        closed_reason: 'Closed via service'
      };
      if (managerOverride) {
        body.manager_override = true;
      }
      
      const response = await fetch('/api/inventory/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        if (data.error === 'ZERO_CAPTURE') {
          return { success: false, error: 'Cannot close period with zero receipts. Manager override required.' };
        }
        return { success: false, error: data.error || 'Close failed' };
      }

      // Sync physical counts to product stock_level (bulk update)
      for (const p of products) {
        const newQty = Number(p.last_physical_qty || p.stock_level || 0);
        await db.query('UPDATE products SET stock_level = ? WHERE id = ?', [newQty, p.id]);
      }

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }
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
      // 1. Fetch period and products
      const periodRes = await db.query('SELECT * FROM inventory_periods WHERE id = $1', [periodId]);
      if (!('rows' in periodRes) || periodRes.rows.length === 0) {
        return { success: false, error: 'Period not found' };
      }
      const period = periodRes.rows[0];
      
      // 2. Fetch all stock items with their current book quantities and costs
      const productsRes = await db.query(
        `SELECT id, name, department, stock_level, cost_price 
         FROM products 
         WHERE is_stock_item = true AND department IN ('Kitchen', 'Cellar')`
      );
      if (!('rows' in productsRes)) {
        return { success: false, error: 'Failed to fetch products' };
      }
      const products = productsRes.rows;
      
      // 3. Calculate closing stock value: sum(physical_qty × cost_price)
      // For closePeriod, we don't have separate physical counts; use current stock_level as physical
      // In full UI flow, physical counts are entered first and stored in last_physical_qty
      let closingValue = 0;
      let kitchenVarianceVal = 0;
      let cellarVarianceVal = 0;
      
      for (const p of products) {
        const physQty = Number(p.last_physical_qty || p.stock_level || 0);
        const bookQty = Number(p.stock_level || 0);
        const costPrice = Number(p.cost_price || 0);
        
        closingValue += physQty * costPrice;
        const varianceQty = physQty - bookQty;
        const varianceVal = varianceQty * costPrice;
        
        if ((p.department || '').toLowerCase() === 'kitchen') kitchenVarianceVal += varianceVal;
        else if ((p.department || '').toLowerCase() === 'cellar') cellarVarianceVal += varianceVal;
      }
      
      const totalVarianceVal = kitchenVarianceVal + cellarVarianceVal;
      
      // 4. COGS = opening + received - closing
      const cogsVal = Number(period.opening_stock_value || 0) + Number(period.received_value || 0) - closingValue;
      
      // 5. Update period with computed values and lock it
      await db.query(
        `UPDATE inventory_periods 
         SET status = 'closed', closing_stock_value = ?, variance_value = ?, cogs_value = ?,
             kitchen_cogs = ?, cellar_cogs = ?, closed_at = NOW(), closed_by = ?, closed_reason = ?, 
             is_locked = true, locked_at = NOW()
         WHERE id = ?`,
        [closingValue, totalVarianceVal, cogsVal, kitchenVarianceVal, cellarVarianceVal, userId, 'Closed via service', periodId]
      );
      
      // 6. Sync physical quantities (last_physical_qty) to global product stock_level
      for (const p of products) {
        const newQty = Number(p.last_physical_qty || p.stock_level || 0);
        await db.query('UPDATE products SET stock_level = ?, updated_at = NOW() WHERE id = ?', [newQty, p.id]);
      }

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }
}
