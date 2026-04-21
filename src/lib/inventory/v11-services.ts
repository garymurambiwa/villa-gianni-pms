import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';

interface DatabaseConfig {
  connectionString: string;
}

class InventoryServices {
  private pool: Pool;

  constructor(config: DatabaseConfig) {
    this.pool = new Pool({ connectionString: config.connectionString });
  }

  async disconnect(): Promise<void> {
    await this.pool.end();
  }

  // =====================================================
  // GRN SERVICE - Goods Received Notes
  // =====================================================

  async createGRNHeader(data: {
    supplierName: string;
    supplierInvoiceNumber?: string;
    destinationLocationId: string;
    createdBy: string;
    notes?: string;
  }): Promise<{ id: string; grnNumber: string }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Generate GRN number
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');

      // Get next sequence number for today
      const seqResult = await client.query(`
        SELECT COUNT(*) + 1 as next_num
        FROM public.inv_grn_headers
        WHERE grn_number LIKE $1
      `, [`GRN-${year}-${month}${day}%`]);

      const nextNum = String(seqResult.rows[0].next_num).padStart(3, '0');
      const grnNumber = `GRN-${year}-${month}${day}-${nextNum}`;

      const id = uuidv4();

      await client.query(`
        INSERT INTO public.inv_grn_headers
        (id, grn_number, supplier_name, supplier_invoice_number, destination_location_id, created_by, notes)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [id, grnNumber, data.supplierName, data.supplierInvoiceNumber, data.destinationLocationId, data.createdBy, data.notes]);

      await client.query('COMMIT');
      return { id, grnNumber };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async addGRNLine(data: {
    grnHeaderId: string;
    itemId: string;
    qtyReceived: number;
    receivedUomId: string;
    unitCost: number;
    expiryDate?: string;
  }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const lineTotal = data.qtyReceived * data.unitCost;

      // Get next line number
      const lineResult = await client.query(`
        SELECT COALESCE(MAX(line_number), 0) + 1 as next_line
        FROM public.inv_grn_lines
        WHERE grn_header_id = $1
      `, [data.grnHeaderId]);

      const lineNumber = lineResult.rows[0].next_line;

      await client.query(`
        INSERT INTO public.inv_grn_lines
        (id, grn_header_id, item_id, qty_received, received_uom_id, unit_cost, line_total, expiry_date, line_number)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [uuidv4(), data.grnHeaderId, data.itemId, data.qtyReceived, data.receivedUomId, data.unitCost, lineTotal, data.expiryDate, lineNumber]);

      // Update header total
      await client.query(`
        UPDATE public.inv_grn_headers
        SET total_value = (
          SELECT SUM(line_total) FROM public.inv_grn_lines WHERE grn_header_id = $1
        )
        WHERE id = $1
      `, [data.grnHeaderId]);

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async postGRN(grnId: string, postedBy: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Get GRN header and lines
      const headerResult = await client.query(`
        SELECT * FROM public.inv_grn_headers WHERE id = $1
      `, [grnId]);

      if (headerResult.rows.length === 0) {
        throw new Error('GRN not found');
      }

      const header = headerResult.rows[0];
      if (header.status !== 'draft') {
        throw new Error('GRN already posted or cancelled');
      }

      const linesResult = await client.query(`
        SELECT * FROM public.inv_grn_lines WHERE grn_header_id = $1 ORDER BY line_number
      `, [grnId]);

      // Post each line to ledger
      for (const line of linesResult.rows) {
        // Convert to base UOM if needed
        const baseQty = await this.uomEngine.convertToBaseUOM(line.item_id, line.qty_received, line.received_uom_id);

        await client.query(`
          INSERT INTO public.inv_stock_ledger
          (id, item_id, location_id, ledger_type, reference_number, quantity_change, base_uom_id, cost_per_unit, total_cost, posted_by, gl_account_code)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        `, [
          uuidv4(),
          line.item_id,
          header.destination_location_id,
          'GRN',
          header.grn_number,
          baseQty,
          await this.getItemBaseUOM(line.item_id),
          line.unit_cost,
          line.line_total,
          postedBy,
          'INVENTORY_ASSET' // Placeholder GL account
        ]);

        // Update item weighted average cost
        await this.updateWeightedAverageCost(line.item_id, baseQty, line.unit_cost);
      }

      // Update GRN status
      await client.query(`
        UPDATE public.inv_grn_headers
        SET status = 'posted', posted_at = NOW()
        WHERE id = $1
      `, [grnId]);

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // =====================================================
  // TRANSFER SERVICE - Stock Transfers
  // =====================================================

  async createTransfer(data: {
    sourceLocationId: string;
    destinationLocationId: string;
    createdBy: string;
    notes?: string;
  }): Promise<{ id: string; transferNumber: string }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Generate transfer number
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');

      const seqResult = await client.query(`
        SELECT COUNT(*) + 1 as next_num
        FROM public.inv_transfer_headers
        WHERE transfer_number LIKE $1
      `, [`TRANS-${year}${month}${day}%`]);

      const nextNum = String(seqResult.rows[0].next_num).padStart(3, '0');
      const transferNumber = `TRANS-${year}${month}${day}-${nextNum}`;

      const id = uuidv4();

      await client.query(`
        INSERT INTO public.inv_transfer_headers
        (id, transfer_number, source_location_id, destination_location_id, created_by, notes)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [id, transferNumber, data.sourceLocationId, data.destinationLocationId, data.createdBy, data.notes]);

      await client.query('COMMIT');
      return { id, transferNumber };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async addTransferLine(data: {
    transferHeaderId: string;
    itemId: string;
    qtyRequested: number;
    sourceUomId: string;
    breakdownFlag?: boolean;
    destinationUomId?: string;
  }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Check current balance
      const balanceResult = await client.query(`
        SELECT SUM(quantity_change) as balance
        FROM public.inv_stock_ledger
        WHERE item_id = $1 AND location_id = (
          SELECT source_location_id FROM public.inv_transfer_headers WHERE id = $2
        )
      `, [data.itemId, data.transferHeaderId]);

      const currentBalance = parseFloat(balanceResult.rows[0].balance || '0');

      // Get next line number
      const lineResult = await client.query(`
        SELECT COALESCE(MAX(line_number), 0) + 1 as next_line
        FROM public.inv_transfer_lines
        WHERE transfer_header_id = $1
      `, [data.transferHeaderId]);

      const lineNumber = lineResult.rows[0].next_line;

      await client.query(`
        INSERT INTO public.inv_transfer_lines
        (id, transfer_header_id, item_id, qty_requested, source_uom_id, breakdown_flag, destination_uom_id, current_source_balance, line_number)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [uuidv4(), data.transferHeaderId, data.itemId, data.qtyRequested, data.sourceUomId, data.breakdownFlag || false, data.destinationUomId, currentBalance, lineNumber]);

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async approveTransfer(transferId: string, approvedBy: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Get transfer header and lines
      const headerResult = await client.query(`
        SELECT * FROM public.inv_transfer_headers WHERE id = $1
      `, [transferId]);

      if (headerResult.rows.length === 0) {
        throw new Error('Transfer not found');
      }

      const header = headerResult.rows[0];
      if (header.status !== 'draft') {
        throw new Error('Transfer already approved or cancelled');
      }

      const linesResult = await client.query(`
        SELECT * FROM public.inv_transfer_lines WHERE transfer_header_id = $1 ORDER BY line_number
      `, [transferId]);

      // Process each line
      for (const line of linesResult.rows) {
        // Check sufficient balance
        const balanceResult = await client.query(`
          SELECT SUM(quantity_change) as balance
          FROM public.inv_stock_ledger
          WHERE item_id = $1 AND location_id = $2
        `, [line.item_id, header.source_location_id]);

        const currentBalance = parseFloat(balanceResult.rows[0].balance || '0');
        const requestedBaseQty = await this.uomEngine.convertToBaseUOM(line.item_id, line.qty_requested, line.source_uom_id);

        if (currentBalance < requestedBaseQty) {
          throw new Error(`Insufficient balance for item ${line.item_id}. Requested: ${requestedBaseQty}, Available: ${currentBalance}`);
        }

        // Transfer out from source
        await client.query(`
          INSERT INTO public.inv_stock_ledger
          (id, item_id, location_id, ledger_type, reference_number, quantity_change, base_uom_id, posted_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [
          uuidv4(),
          line.item_id,
          header.source_location_id,
          'TRANSFER_OUT',
          header.transfer_number,
          -requestedBaseQty,
          await this.getItemBaseUOM(line.item_id),
          approvedBy
        ]);

        // Transfer in to destination (with breakdown conversion if flagged)
        let destinationQty = requestedBaseQty;
        if (line.breakdown_flag && line.destination_uom_id) {
          destinationQty = await this.uomEngine.convertUOM(line.item_id, requestedBaseQty, await this.getItemBaseUOM(line.item_id), line.destination_uom_id);
        }

        await client.query(`
          INSERT INTO public.inv_stock_ledger
          (id, item_id, location_id, ledger_type, reference_number, quantity_change, base_uom_id, posted_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [
          uuidv4(),
          line.item_id,
          header.destination_location_id,
          'TRANSFER_IN',
          header.transfer_number,
          destinationQty,
          line.breakdown_flag ? line.destination_uom_id : await this.getItemBaseUOM(line.item_id),
          approvedBy
        ]);
      }

      // Update transfer status
      await client.query(`
        UPDATE public.inv_transfer_headers
        SET status = 'approved', approved_by = $1, approved_at = NOW()
        WHERE id = $2
      `, [approvedBy, transferId]);

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // =====================================================
  // UOM ENGINE - Unit of Measure Conversions
  // =====================================================

  private uomEngine = {
    async convertToBaseUOM(itemId: string, quantity: number, fromUomId: string): Promise<number> {
      const client = await this.pool.connect();
      try {
        const itemResult = await client.query(`
          SELECT base_uom_id FROM public.inv_items WHERE id = $1
        `, [itemId]);

        if (itemResult.rows.length === 0) {
          throw new Error('Item not found');
        }

        const baseUomId = itemResult.rows[0].base_uom_id;

        if (fromUomId === baseUomId) {
          return quantity;
        }

        const conversionResult = await client.query(`
          SELECT conversion_factor FROM public.inv_uom_conversions
          WHERE item_id = $1 AND from_uom_id = $2 AND to_uom_id = $3
        `, [itemId, fromUomId, baseUomId]);

        if (conversionResult.rows.length === 0) {
          throw new Error(`No conversion found from ${fromUomId} to ${baseUomId} for item ${itemId}`);
        }

        return quantity * parseFloat(conversionResult.rows[0].conversion_factor);
      } finally {
        client.release();
      }
    },

    async convertUOM(itemId: string, quantity: number, fromUomId: string, toUomId: string): Promise<number> {
      const client = await this.pool.connect();
      try {
        if (fromUomId === toUomId) {
          return quantity;
        }

        const conversionResult = await client.query(`
          SELECT conversion_factor FROM public.inv_uom_conversions
          WHERE item_id = $1 AND from_uom_id = $2 AND to_uom_id = $3
        `, [itemId, fromUomId, toUomId]);

        if (conversionResult.rows.length === 0) {
          throw new Error(`No conversion found from ${fromUomId} to ${toUomId} for item ${itemId}`);
        }

        return quantity * parseFloat(conversionResult.rows[0].conversion_factor);
      } finally {
        client.release();
      }
    }
  };

  // =====================================================
  // VARIANCE CALCULATOR
  // =====================================================

  private varianceCalculator = {
    async calculateItemVariance(theoreticalQty: number, physicalQty: number): Promise<{
      varianceQty: number;
      variancePct: number;
      alertLevel: 'OK' | 'WARNING' | 'CRITICAL';
    }> {
      const varianceQty = theoreticalQty - physicalQty;
      const variancePct = theoreticalQty !== 0 ? (varianceQty / theoreticalQty) * 100 : 0;

      let alertLevel: 'OK' | 'WARNING' | 'CRITICAL' = 'OK';
      if (Math.abs(variancePct) >= 5) {
        alertLevel = 'CRITICAL';
      } else if (Math.abs(variancePct) >= 2) {
        alertLevel = 'WARNING';
      }

      return {
        varianceQty,
        variancePct,
        alertLevel
      };
    }
  };

  // =====================================================
  // UTILITY METHODS
  // =====================================================

  private async getItemBaseUOM(itemId: string): Promise<string> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(`
        SELECT base_uom_id FROM public.inv_items WHERE id = $1
      `, [itemId]);

      if (result.rows.length === 0) {
        throw new Error('Item not found');
      }

      return result.rows[0].base_uom_id;
    } finally {
      client.release();
    }
  }

  private async updateWeightedAverageCost(itemId: string, newQty: number, newCost: number): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Get current weighted average
      const currentResult = await client.query(`
        SELECT weighted_avg_cost FROM public.inv_items WHERE id = $1
      `, [itemId]);

      if (currentResult.rows.length === 0) {
        throw new Error('Item not found');
      }

      const currentCost = parseFloat(currentResult.rows[0].weighted_avg_cost || '0');

      // Get current total quantity in stock
      const qtyResult = await client.query(`
        SELECT SUM(quantity_change) as total_qty FROM public.inv_stock_ledger WHERE item_id = $1
      `, [itemId]);

      const currentTotalQty = parseFloat(qtyResult.rows[0].total_qty || '0');
      const previousQty = Math.max(0, currentTotalQty - newQty);

      // Calculate new weighted average
      let newWeightedAvg = newCost;
      if (previousQty > 0) {
        const previousTotalValue = previousQty * currentCost;
        const newTotalValue = newQty * newCost;
        newWeightedAvg = (previousTotalValue + newTotalValue) / (previousQty + newQty);
      }

      await client.query(`
        UPDATE public.inv_items
        SET weighted_avg_cost = $1, last_cost_price = $2, updated_at = NOW()
        WHERE id = $3
      `, [newWeightedAvg, newCost, itemId]);

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // =====================================================
  // PUBLIC INTERFACE METHODS
  // =====================================================

  get grnService() {
    return {
      createGRNHeader: this.createGRNHeader.bind(this),
      addGRNLine: this.addGRNLine.bind(this),
      postGRN: this.postGRN.bind(this)
    };
  }

  get transferService() {
    return {
      createTransfer: this.createTransfer.bind(this),
      addTransferLine: this.addTransferLine.bind(this),
      approveTransfer: this.approveTransfer.bind(this)
    };
  }

  get uomEngine() {
    return this.uomEngine;
  }

  get varianceCalculator() {
    return this.varianceCalculator;
  }
}

export default InventoryServices;