/**
 * COREPMS v11 - Inventory Module Services
 * Core business logic for GRN, transfers, UOM conversions, and variance calculations
 * Location: src/lib/inventory/
 */

import { Pool, QueryResult } from 'pg';

// Initialize pool from DATABASE_URL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
});

export interface GRNHeader {
  id: string;
  grn_number: string;
  supplier_name: string;
  grn_date: string;
  destination_location_id: string;
  total_value: number;
  status: 'draft' | 'posted' | 'voided' | 'reversed';
  created_by: string;
}

export interface GRNLine {
  id: string;
  grn_header_id: string;
  item_id: string;
  qty_received: number;
  received_uom_id: string;
  unit_cost: number;
  line_total: number;
  expiry_date?: string;
  line_number: number;
}

export interface TransferHeader {
  id: string;
  transfer_number: string;
  source_location_id: string;
  destination_location_id: string;
  transfer_date: string;
  status: 'draft' | 'pending_approval' | 'approved' | 'rejected' | 'voided';
  created_by: string;
}

/**
 * GRN Service - Goods Received Notes
 */
export const GRNService = {
  /**
   * Create new GRN header
   */
  async createGRNHeader(
    supplerName: string,
    destinationLocationId: string,
    createdBy: string,
    grn_date?: string
  ): Promise<GRNHeader> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Generate GRN number
      const grnNumRes = await client.query(
        `SELECT 'GRN-' || TO_CHAR(CURRENT_DATE, 'YYYY') || '-' || 
         LPAD((COUNT(*) + 1)::text, 4, '0') as grn_number
         FROM public.inv_grn_headers 
         WHERE grn_number LIKE TO_CHAR(CURRENT_DATE, 'YYYY') || '-%'`
      );

      const grn_number = grnNumRes.rows[0]?.grn_number || `GRN-${new Date().getFullYear()}-0001`;

      const result = await client.query(
        `INSERT INTO public.inv_grn_headers 
        (id, grn_number, supplier_name, grn_date, destination_location_id, created_by, status)
        VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, 'draft')
        RETURNING *`,
        [grn_number, supplerName, grn_date || new Date().toISOString().split('T')[0], destinationLocationId, createdBy]
      );

      await client.query('COMMIT');
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  /**
   * Add line item to GRN
   */
  async addGRNLine(
    grnHeaderId: string,
    itemId: string,
    qtyReceived: number,
    receivedUomId: string,
    unitCost: number,
    lineNumber: number
  ): Promise<GRNLine> {
    const lineTotal = qtyReceived * unitCost;

    const result = await pool.query(
      `INSERT INTO public.inv_grn_lines 
      (id, grn_header_id, item_id, qty_received, received_uom_id, unit_cost, line_total, line_number)
      VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7)
      RETURNING *`,
      [grnHeaderId, itemId, qtyReceived, receivedUomId, unitCost, lineTotal, lineNumber]
    );

    // Update GRN total
    await pool.query(
      `UPDATE public.inv_grn_headers 
      SET total_value = (SELECT COALESCE(SUM(line_total), 0) FROM public.inv_grn_lines WHERE grn_header_id = $1),
          updated_at = NOW()
      WHERE id = $1`,
      [grnHeaderId]
    );

    return result.rows[0];
  },

  /**
   * Post GRN to ledger (creates stock ledger entries and GL posting)
   */
  async postGRN(grnHeaderId: string, postedBy: string): Promise<{ success: boolean; message: string }> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Get GRN details
      const grnRes = await client.query(`SELECT * FROM public.inv_grn_headers WHERE id = $1`, [grnHeaderId]);
      if (!grnRes.rows.length) throw new Error('GRN not found');

      const grn = grnRes.rows[0];
      const lines = (await client.query(`SELECT * FROM public.inv_grn_lines WHERE grn_header_id = $1`, [grnHeaderId]))
        .rows;

      // Create stock ledger entries for each line
      for (const line of lines) {
        // Get item base UOM
        const itemRes = await client.query(`SELECT base_uom_id FROM public.inv_items WHERE id = $1`, [line.item_id]);
        const baseUomId = itemRes.rows[0]?.base_uom_id;

        // Convert qty to base units
        const conversionRes = await client.query(
          `SELECT conversion_factor FROM public.inv_uom_conversions 
          WHERE item_id = $1 AND from_uom_id = $2 AND to_uom_id = $3`,
          [line.item_id, line.received_uom_id, baseUomId]
        );

        const baseQty = conversionRes.rows[0]?.conversion_factor * line.qty_received || line.qty_received;

        // Create ledger entry
        await client.query(
          `INSERT INTO public.inv_stock_ledger 
          (id, item_id, location_id, ledger_type, reference_number, quantity_change, base_uom_id, cost_per_unit, total_cost, posted_by, gl_account_code)
          VALUES (gen_random_uuid()::text, $1, $2, 'GRN', $3, $4, $5, $6, $7, $8, 'INVENTORY_ASSET')`,
          [line.item_id, grn.destination_location_id, grn.grn_number, baseQty, baseUomId, line.unit_cost, line.line_total, postedBy]
        );
      }

      // Update GRN status
      await client.query(
        `UPDATE public.inv_grn_headers 
        SET status = 'posted', posted_by = $1, posted_at = NOW()
        WHERE id = $2`,
        [postedBy, grnHeaderId]
      );

      await client.query('COMMIT');
      return { success: true, message: `GRN ${grn.grn_number} posted successfully` };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },
};

/**
 * Stock Transfer Service
 */
export const TransferService = {
  /**
   * Create stock transfer header
   */
  async createTransfer(
    sourceLocationId: string,
    destinationLocationId: string,
    createdBy: string,
    referenceText?: string
  ): Promise<TransferHeader> {
    const transferNumRes = await pool.query(
      `SELECT 'TRANS-' || TO_CHAR(CURRENT_DATE, 'YYYY') || '-' || 
       LPAD((COUNT(*) + 1)::text, 4, '0') as trans_number
       FROM public.inv_transfer_headers 
       WHERE transfer_number LIKE TO_CHAR(CURRENT_DATE, 'YYYY') || '-%'`
    );

    const transfer_number =
      transferNumRes.rows[0]?.trans_number || `TRANS-${new Date().getFullYear()}-0001`;

    const result = await pool.query(
      `INSERT INTO public.inv_transfer_headers 
      (id, transfer_number, source_location_id, destination_location_id, created_by, reference_text, status)
      VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, 'draft')
      RETURNING *`,
      [transfer_number, sourceLocationId, destinationLocationId, createdBy, referenceText]
    );

    return result.rows[0];
  },

  /**
   * Approve and execute transfer
   */
  async approveTransfer(transferId: string, approvedBy: string): Promise<{ success: boolean; message: string }> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Get transfer details
      const transferRes = await client.query(
        `SELECT * FROM public.inv_transfer_headers WHERE id = $1`,
        [transferId]
      );
      if (!transferRes.rows.length) throw new Error('Transfer not found');

      const transfer = transferRes.rows[0];
      const lines = (
        await client.query(`SELECT * FROM public.inv_transfer_lines WHERE transfer_header_id = $1`, [transferId])
      ).rows;

      // Process each line
      for (const line of lines) {
        // Check source balance
        const balanceRes = await pool.query(
          `SELECT COALESCE(SUM(quantity_change), 0) as balance 
          FROM public.inv_stock_ledger 
          WHERE item_id = $1 AND location_id = $2`,
          [line.item_id, transfer.source_location_id]
        );

        const balance = Number(balanceRes.rows[0]?.balance || 0);

        if (Math.abs(balance) < line.qty_requested) {
          throw new Error(`Insufficient stock for item ${line.item_id}`);
        }

        // Create transfer out entry
        await client.query(
          `INSERT INTO public.inv_stock_ledger 
          (id, item_id, location_id, ledger_type, reference_number, quantity_change, base_uom_id, posted_by)
          VALUES (gen_random_uuid()::text, $1, $2, 'TRANSFER_OUT', $3, $4, $5, $6)`,
          [line.item_id, transfer.source_location_id, transfer.transfer_number, -line.qty_requested, line.source_uom_id, approvedBy]
        );

        // Create transfer in entry (with breakdown conversion if applicable)
        const destQty = line.breakdown_flag && line.destination_uom_id ? line.qty_requested * 2 : line.qty_requested;

        await client.query(
          `INSERT INTO public.inv_stock_ledger 
          (id, item_id, location_id, ledger_type, reference_number, quantity_change, base_uom_id, posted_by)
          VALUES (gen_random_uuid()::text, $1, $2, 'TRANSFER_IN', $3, $4, $5, $6)`,
          [
            line.item_id,
            transfer.destination_location_id,
            transfer.transfer_number,
            destQty,
            line.destination_uom_id || line.source_uom_id,
            approvedBy,
          ]
        );
      }

      // Update transfer status
      await client.query(
        `UPDATE public.inv_transfer_headers 
        SET status = 'approved', approved_by = $1, approved_at = NOW()
        WHERE id = $2`,
        [approvedBy, transferId]
      );

      await client.query('COMMIT');
      return { success: true, message: `Transfer ${transfer.transfer_number} approved and executed` };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },
};

/**
 * UOM Conversion Engine
 */
export const UOMEngine = {
  /**
   * Get conversion factor between two UOMs for an item
   */
  async getConversionFactor(itemId: string, fromUomId: string, toUomId: string): Promise<number> {
    const result = await pool.query(
      `SELECT conversion_factor FROM public.inv_uom_conversions 
      WHERE item_id = $1 AND from_uom_id = $2 AND to_uom_id = $3`,
      [itemId, fromUomId, toUomId]
    );

    if (!result.rows.length) {
      throw new Error(`No conversion defined for item ${itemId} from ${fromUomId} to ${toUomId}`);
    }

    return result.rows[0].conversion_factor;
  },

  /**
   * Convert quantity between UOMs
   */
  async convertQuantity(itemId: string, qty: number, fromUomId: string, toUomId: string): Promise<number> {
    if (fromUomId === toUomId) return qty;

    const factor = await this.getConversionFactor(itemId, fromUomId, toUomId);
    return qty * factor;
  },
};

/**
 * Variance Calculator Service
 */
export const VarianceCalculator = {
  /**
   * Calculate variance for an item at a location
   */
  async calculateItemVariance(
    itemId: string,
    locationId: string,
    periodStart: string,
    periodEnd: string
  ): Promise<{
    theoretical_qty: number;
    physical_qty: number;
    variance_qty: number;
    variance_pct: number;
  }> {
    // Get theor etical depletion from POS sales
    const posRes = await pool.query(
      `SELECT COALESCE(SUM(quantity_change), 0) as qty 
      FROM public.inv_stock_ledger 
      WHERE item_id = $1 AND location_id = $2 AND ledger_type = 'SALE_DEPLETION' 
      AND posted_at >= $3 AND posted_at <= $4`,
      [itemId, locationId, periodStart, periodEnd]
    );

    const theoreticalQty = Math.abs(Number(posRes.rows[0]?.qty || 0));

    // Get physical count from manual adjustments
    const physicalRes = await pool.query(
      `SELECT COALESCE(SUM(quantity_change), 0) as qty 
      FROM public.inv_stock_ledger 
      WHERE item_id = $1 AND location_id = $2 AND ledger_type = 'PHYSICAL_COUNT' 
      AND posted_at >= $3 AND posted_at <= $4`,
      [itemId, locationId, periodStart, periodEnd]
    );

    const physicalQty = Number(physicalRes.rows[0]?.qty || 0);
    const varianceQty = theoreticalQty - physicalQty;
    const variancePct = theoreticalQty > 0 ? (varianceQty / theoreticalQty) * 100 : 0;

    return {
      theoretical_qty: theoreticalQty,
      physical_qty: physicalQty,
      variance_qty: varianceQty,
      variance_pct: variancePct,
    };
  },

  /**
   * Get variance alert level
   */
  getAlertLevel(variancePct: number): 'OK' | 'WARNING' | 'CRITICAL' {
    if (Math.abs(variancePct) < 2) return 'OK';
    if (Math.abs(variancePct) < 5) return 'WARNING';
    return 'CRITICAL';
  },
};

export default {
  GRNService,
  TransferService,
  UOMEngine,
  VarianceCalculator,
};
