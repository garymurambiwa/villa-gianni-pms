import { db } from '@/lib/db';

export interface Discrepancy {
  itemId: string;
  itemName: string;
  soldQty: number;
  ledgerQty: number;
  drift: number;
}

export interface ReconciliationReport {
  periodStart: string;
  periodEnd: string;
  discrepancies: Discrepancy[];
  summary: {
    totalItemsChecked: number;
    totalDriftCount: number;
    accuracyRate: number;
  };
}

/**
 * ReconciliationService
 * Audits the POS transaction stream against the inventory ledger to detect data drift.
 */
export class ReconciliationService {
  /**
   * Run a reconciliation for a specific time range
   */
  static async runAudit(startISO: string, endISO: string): Promise<ReconciliationReport> {
    // 1. Fetch itemized sales from closed POS orders
    const salesRes = await db.query(`
      SELECT 
        (item->'menuItem'->>'id') as item_id,
        (item->'menuItem'->>'name') as item_name,
        SUM((item->>'quantity')::numeric) as sold_qty
      FROM pos_orders, jsonb_array_elements(items) as item
      WHERE status = 'closed' 
        AND created_at BETWEEN $1 AND $2
      GROUP BY item_id, item_name
    `, [startISO, endISO]);

    const sales = ('rows' in salesRes) ? salesRes.rows : [];

    // 2. Fetch inventory movements from stock ledger
    const ledgerRes = await db.query(`
      SELECT 
        item_id,
        ABS(SUM(quantity_change)) as ledger_qty
      FROM inv_stock_ledger
      WHERE ledger_type = 'POS_SALE'
        AND created_at BETWEEN $1 AND $2
      GROUP BY item_id
    `, [startISO, endISO]);

    const ledger = ('rows' in ledgerRes) ? ledgerRes.rows : [];
    const ledgerMap = new Map(ledger.map((r: any) => [r.item_id, Number(r.ledger_qty)]));

    // 3. Compare and find discrepancies
    const discrepancies: Discrepancy[] = [];
    let totalItemsChecked = 0;
    let itemsWithDrift = 0;

    for (const sale of sales) {
      const itemId = sale.item_id;
      const soldQty = Number(sale.sold_qty);
      const ledgerQty = ledgerMap.get(itemId) || 0;
      const drift = soldQty - ledgerQty;

      totalItemsChecked++;
      if (Math.abs(drift) > 0.001) {
        itemsWithDrift++;
        discrepancies.push({
          itemId,
          itemName: sale.item_name,
          soldQty,
          ledgerQty,
          drift
        });
      }
    }

    return {
      periodStart: startISO,
      periodEnd: endISO,
      discrepancies,
      summary: {
        totalItemsChecked,
        totalDriftCount: itemsWithDrift,
        accuracyRate: totalItemsChecked > 0 ? ((totalItemsChecked - itemsWithDrift) / totalItemsChecked) * 100 : 100
      }
    };
  }

  /**
   * Helper to fetch recent drift
   */
  static async getRecentDrift(days: number = 7): Promise<ReconciliationReport> {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - days);
    return this.runAudit(start.toISOString(), end.toISOString());
  }
}

export default ReconciliationService;
