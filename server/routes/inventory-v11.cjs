/**
 * COREPMS v11 Inventory Module - Express API Routes
 * Location: server/routes/inventory-v11.cjs
 * 
 * All routes follow the v11 spec with proper error handling and transaction support
 */

const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const { randomUUID } = require('crypto');

// Load environment
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const router = express.Router();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ============================================================================
// GRN (Goods Received Note) Endpoints
// ============================================================================

/**
 * POST /api/v1/inventory/grn
 * Create new GRN header and optional line items
 */
router.post('/grn', async (req, res) => {
  const { supplier_name, destination_location_id, created_by, lines } = req.body;

  if (!supplier_name || !destination_location_id || !created_by) {
    return res.status(400).json({ ok: false, error: 'Missing required fields' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get next GRN number
    const grnCountRes = await client.query(
      `SELECT COALESCE(MAX(CAST(SUBSTRING(grn_number FROM 10) AS INTEGER)), 0) + 1 as next_num
       FROM public.inv_grn_headers 
       WHERE grn_number ~ ('^GRN-' || TO_CHAR(CURRENT_DATE, 'YYYY') || '-\\d+$')`
    );
    const nextNum = grnCountRes.rows[0].next_num;
    const grnNumber = 'GRN-' + new Date().getFullYear() + '-' + String(nextNum).padStart(4, '0');

    // Create GRN header
    const grnRes = await client.query(
      `INSERT INTO public.inv_grn_headers 
      (id, grn_number, supplier_name, destination_location_id, created_by, status, inserted_at)
      VALUES ($1, $2, $3, $4, $5, 'draft', $6)
      RETURNING *`,
      [randomUUID(), grnNumber, supplier_name, destination_location_id, created_by, new Date()]
    );

    const grn = grnRes.rows[0];

    // Add line items if provided
    if (Array.isArray(lines) && lines.length > 0) {
      let totalValue = 0;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineTotal = line.qty_received * line.unit_cost;
        totalValue += lineTotal;

        // Ensure item exists, create if necessary
        let itemId = line.item_id;
        const itemCheckRes = await client.query(
          `SELECT id FROM public.inv_items WHERE id = $1 LIMIT 1`,
          [itemId]
        );
        
        if (itemCheckRes.rows.length === 0) {
          // Create item if it doesn't exist - use provided name as ID for consistency
          const newItemId = itemId || `item-${Date.now()}-${i}`;
          await client.query(
            `INSERT INTO public.inv_items (id, name, category, base_uom_id, inserted_at)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (id) DO NOTHING`,
            [newItemId, itemId || 'Item', 'Food', 'uom_case', new Date()]
          );
          itemId = newItemId;
        }

        await client.query(
          `INSERT INTO public.inv_grn_lines 
          (id, grn_header_id, item_id, qty_received, received_uom_id, unit_cost, line_total, line_number, inserted_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [randomUUID(), grn.id, itemId, line.qty_received, line.received_uom_id, line.unit_cost, lineTotal, i + 1, new Date()]
        );
      }

      // Update GRN total
      await client.query(`UPDATE public.inv_grn_headers SET total_value = $1 WHERE id = $2`, [totalValue, grn.id]);
    }

    // Fetch updated GRN with final total
    const finalGrnRes = await client.query(`SELECT * FROM public.inv_grn_headers WHERE id = $1`, [grn.id]);
    const finalGrn = finalGrnRes.rows[0];

    await client.query('COMMIT');
    return res.json({ ok: true, data: finalGrn });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ ok: false, error: error.message });
  } finally {
    client.release();
  }
});

/**
 * GET /api/v1/inventory/grn
 * List GRNs (paginated, filterable)
 */
router.get('/grn', async (req, res) => {
  const { status, location_id, limit = 50, offset = 0 } = req.query;
  let sql = 'SELECT * FROM public.inv_grn_headers WHERE 1=1';
  const params = [];

  if (status) {
    sql += ` AND status = $${params.length + 1}`;
    params.push(status);
  }

  if (location_id) {
    sql += ` AND destination_location_id = $${params.length + 1}`;
    params.push(location_id);
  }

  sql += ` ORDER BY inserted_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limit, offset);

  try {
    const result = await pool.query(sql, params);
    res.json({ ok: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * POST /api/v1/inventory/grn/:id/post
 * Post GRN to ledger and trigger GL entry
 */
router.post('/grn/:id/post', async (req, res) => {
  const { id } = req.params;
  const { posted_by } = req.body;

  if (!posted_by) {
    return res.status(400).json({ ok: false, error: 'posted_by required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get GRN
    const grnRes = await client.query(`SELECT * FROM public.inv_grn_headers WHERE id = $1`, [id]);
    if (!grnRes.rows.length) throw new Error('GRN not found');

    const grn = grnRes.rows[0];

    // Get lines
    const linesRes = await client.query(`SELECT * FROM public.inv_grn_lines WHERE grn_header_id = $1`, [id]);

    // FIX: Create ledger entries + correct WAC calculation
    for (const line of linesRes.rows) {
      const itemRes = await client.query(
        `SELECT base_uom_id, weighted_avg_cost, COALESCE(SUM(sl.quantity_change),0) as current_qty
         FROM public.inv_items i
         LEFT JOIN public.inv_stock_ledger sl ON sl.item_id = i.id AND sl.location_id = $2
         WHERE i.id = $1
         GROUP BY i.base_uom_id, i.weighted_avg_cost`,
        [line.item_id, grn.destination_location_id]
      );
      const baseUomId    = itemRes.rows[0]?.base_uom_id || line.received_uom_id;
      const existingQty  = Number(itemRes.rows[0]?.current_qty || 0);
      const existingWac  = Number(itemRes.rows[0]?.weighted_avg_cost || 0);
      const newQty       = Number(line.qty_received);
      const newUnitCost  = Number(line.unit_cost);

      // ── Weighted Average Cost formula (industry standard) ──────────────────
      // WAC = (existing_qty * existing_wac + received_qty * unit_cost) / (existing_qty + received_qty)
      const newWac = (existingQty + newQty) > 0
        ? ((existingQty * existingWac) + (newQty * newUnitCost)) / (existingQty + newQty)
        : newUnitCost;

      // Create GRN stock ledger entry
      await client.query(
        `INSERT INTO public.inv_stock_ledger
         (id, item_id, location_id, ledger_type, reference_number, quantity_change, base_uom_id, cost_per_unit, total_cost, posted_by, gl_account_code, inserted_at)
         VALUES ($1,$2,$3,'GRN',$4,$5,$6,$7,$8,$9,'INVENTORY_ASSET',NOW())`,
        [randomUUID(), line.item_id, grn.destination_location_id, grn.grn_number,
         newQty, baseUomId, newUnitCost, line.line_total, posted_by]
      );

      // ── Update inv_items: last_cost_price + correctly calculated weighted_avg_cost ──
      await client.query(
        `UPDATE public.inv_items SET
           last_cost_price    = $1,
           weighted_avg_cost  = $2,
           average_cost       = $2,
           updated_at         = NOW()
         WHERE id = $3`,
        [newUnitCost, parseFloat(newWac.toFixed(4)), line.item_id]
      );

      // ── Sync updated cost to products table ───────────────────────────────
      await client.query(
        `UPDATE public.products SET cost_price = $1, updated_at = NOW() WHERE id = $2`,
        [newUnitCost, line.item_id]
      );
    }

    // FIX: Use correct variable names (was postedBy/grnHeaderId — undefined!)
    await client.query(
      `UPDATE public.inv_grn_headers SET status = 'posted', posted_by = $1, posted_at = NOW() WHERE id = $2`,
      [posted_by, id]
    );

    // ── Integrate with Inventory Reconciliation period (FIX: use $N placeholders) ──
    const grnDate = new Date(grn.inserted_at || grn.created_at || Date.now()).toISOString().split('T')[0];
    const periodRes = await client.query(
      `SELECT id FROM inventory_periods
       WHERE status IN ('open', 'reconciling')
         AND $1 BETWEEN start_date AND end_date
       LIMIT 1`,
      [grnDate]
    );
    const periodId = periodRes.rows?.[0]?.id || null;

    // Insert inventory_transactions for reconciliation period
    for (const line of linesRes.rows) {
      const txNum       = `GRN-${grn.grn_number}-L${line.line_number}`;
      const totalValue  = Number(line.qty_received) * Number(line.unit_cost);
      await client.query(
        `INSERT INTO inventory_transactions
         (transaction_type, transaction_number, period_id, transaction_date, department,
          total_quantity, total_value, supplier_name, created_by, is_historical_backfill)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,false)
         ON CONFLICT (transaction_number) DO NOTHING`,
        ['grv', txNum, periodId, grnDate, 'Kitchen',
         line.qty_received, totalValue, grn.supplier_name, posted_by]
      );
    }

    // FIX: use $N placeholders for period update
    if (periodId) {
      const totalGrnValue = linesRes.rows.reduce((s, l) => s + Number(l.qty_received) * Number(l.unit_cost), 0);
      await client.query(
        `UPDATE inventory_periods SET received_value = COALESCE(received_value,0) + $1 WHERE id = $2`,
        [totalGrnValue, periodId]
      );
    }

    await client.query('COMMIT');
    res.json({ ok: true, message: `GRN ${grn.grn_number} posted successfully` });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ ok: false, error: error.message });
  } finally {
    client.release();
  }
});

// ============================================================================
// STOCK TRANSFER Endpoints
// ============================================================================

/**
 * POST /api/v1/inventory/transfer
 * Create stock transfer
 */
router.post('/transfer', async (req, res) => {
  // FIX: Accept both reference_note (frontend) and reference_text (legacy)
  const { source_location_id, destination_location_id, created_by, lines } = req.body;
  const reference_text = req.body.reference_text || req.body.reference_note || null;

  if (!source_location_id || !destination_location_id || !created_by) {
    return res.status(400).json({ ok: false, error: 'Missing required fields: source_location_id, destination_location_id, created_by' });
  }
  if (source_location_id === destination_location_id) {
    return res.status(400).json({ ok: false, error: 'Source and destination locations must be different' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get next transfer number
    const transCountRes = await client.query(
      `SELECT COALESCE(MAX(CAST(SUBSTRING(transfer_number FROM 12) AS INTEGER)), 0) + 1 as next_num
       FROM public.inv_transfer_headers 
       WHERE transfer_number ~ ('^TRANS-' || TO_CHAR(CURRENT_DATE, 'YYYY') || '-\\d+$')`
    );
    const nextNum = transCountRes.rows[0].next_num;
    const transferNumber = 'TRANS-' + new Date().getFullYear() + '-' + String(nextNum).padStart(4, '0');

    // Create transfer header
    const transRes = await client.query(
      `INSERT INTO public.inv_transfer_headers 
      (id, transfer_number, source_location_id, destination_location_id, created_by, reference_text, status, inserted_at)
      VALUES ($1, $2, $3, $4, $5, $6, 'draft', $7)
      RETURNING *`,
      [randomUUID(), transferNumber, source_location_id, destination_location_id, created_by, reference_text, new Date()]
    );

    const transfer = transRes.rows[0];

    // Add line items
    if (Array.isArray(lines) && lines.length > 0) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Get current source balance
        const balRes = await client.query(
          `SELECT COALESCE(SUM(quantity_change), 0) as balance 
          FROM public.inv_stock_ledger 
          WHERE item_id = $1 AND location_id = $2`,
          [line.item_id, source_location_id]
        );

        const currentBalance = Number(balRes.rows[0]?.balance || 0);

        await client.query(
          `INSERT INTO public.inv_transfer_lines 
          (id, transfer_header_id, item_id, qty_requested, source_uom_id, breakdown_flag, destination_uom_id, current_source_balance, line_number, inserted_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [randomUUID(), transfer.id, line.item_id, line.qty_requested, line.source_uom_id, line.breakdown_flag || false, line.destination_uom_id, currentBalance, i + 1, new Date()]
        );
      }
    }

    await client.query('COMMIT');
    res.json({ ok: true, data: transfer });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ ok: false, error: error.message });
  } finally {
    client.release();
  }
});

/**
 * POST /api/v1/inventory/transfer/:id/approve
 * Approve and execute transfer
 */
router.post('/transfer/:id/approve', async (req, res) => {
  const { id } = req.params;
  const { approved_by } = req.body;

  if (!approved_by) {
    return res.status(400).json({ ok: false, error: 'approved_by required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get transfer
    const transRes = await client.query(`SELECT * FROM public.inv_transfer_headers WHERE id = $1`, [id]);
    if (!transRes.rows.length) throw new Error('Transfer not found');

    const transfer = transRes.rows[0];

    // Get lines
    const linesRes = await client.query(`SELECT * FROM public.inv_transfer_lines WHERE transfer_header_id = $1`, [id]);

    // Process each line
    for (const line of linesRes.rows) {
      // Check source balance
      const balRes = await client.query(
        `SELECT COALESCE(SUM(quantity_change), 0) as balance 
        FROM public.inv_stock_ledger 
        WHERE item_id = $1 AND location_id = $2`,
        [line.item_id, transfer.source_location_id]
      );

      const balance = Number(balRes.rows[0]?.balance || 0);

      // FIX: Hard enforce — block transfer if insufficient balance (not just warn)
      if (balance < Number(line.qty_requested)) {
        throw new Error(
          `Insufficient stock for item ${line.item_id}: available ${balance.toFixed(3)}, requested ${Number(line.qty_requested).toFixed(3)}`
        );
      }

      // Create TRANSFER_OUT entry
      await client.query(
        `INSERT INTO public.inv_stock_ledger
         (id, item_id, location_id, ledger_type, reference_number, quantity_change, base_uom_id, posted_by, inserted_at)
         VALUES ($1,$2,$3,'TRANSFER_OUT',$4,$5,$6,$7,NOW())`,
        [randomUUID(), line.item_id, transfer.source_location_id, transfer.transfer_number,
         -Number(line.qty_requested), line.source_uom_id, approved_by]
      );

      // FIX: breakdown_flag uses actual UOM conversion table, not hardcoded *30
      let destQty   = Number(line.qty_requested);
      const destUomId = line.destination_uom_id || line.source_uom_id;
      if (line.breakdown_flag && line.destination_uom_id && line.destination_uom_id !== line.source_uom_id) {
        const convRes = await client.query(
          `SELECT conversion_factor FROM public.inv_uom_conversions
           WHERE item_id=$1 AND from_uom_id=$2 AND to_uom_id=$3`,
          [line.item_id, line.source_uom_id, line.destination_uom_id]
        );
        if (convRes.rows.length) {
          destQty = destQty * Number(convRes.rows[0].conversion_factor);
        }
      }

      await client.query(
        `INSERT INTO public.inv_stock_ledger
         (id, item_id, location_id, ledger_type, reference_number, quantity_change, base_uom_id, posted_by, inserted_at)
         VALUES ($1,$2,$3,'TRANSFER_IN',$4,$5,$6,$7,NOW())`,
        [randomUUID(), line.item_id, transfer.destination_location_id, transfer.transfer_number,
         destQty, destUomId, approved_by]
      );
    }

    // Update transfer status
    await client.query(
      `UPDATE public.inv_transfer_headers SET status = 'approved', approved_by = $1, approved_at = $2 WHERE id = $3`,
      [approved_by, new Date(), id]
    );

    // ── Sync POS product visibility based on destination outlet ────────────
    const destLoc = await client.query(
      `SELECT name, location_type FROM public.inv_locations WHERE id = $1`, [transfer.destination_location_id]
    );
    if (destLoc.rows.length) {
      const { name: locName, location_type } = destLoc.rows[0];
      if (location_type === 'Outlet') {
        const isBar        = /bar/i.test(locName);
        const isRestaurant = /restaurant|kitchen|room.service/i.test(locName);
        const itemIds = linesRes.rows.map(l => l.item_id);
        for (const itemId of itemIds) {
          await client.query(`
            UPDATE public.products SET
              bar_visibility        = CASE WHEN $2 THEN true ELSE bar_visibility END,
              restaurant_visibility = CASE WHEN $3 THEN true ELSE restaurant_visibility END,
              active                = true,
              updated_at            = NOW()
            WHERE id = $1
          `, [itemId, isBar, isRestaurant]);
        }
      }
    }

    await client.query('COMMIT');
    res.json({ ok: true, message: `Transfer ${transfer.transfer_number} approved` });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ ok: false, error: error.message });
  } finally {
    client.release();
  }
});

// ============================================================================
// INVENTORY BALANCE & LEDGER Endpoints
// ============================================================================

/**
 * GET /api/v1/inventory/balance/:location_id
 * Get current balances per location
 */
router.get('/balance/:location_id', async (req, res) => {
  const { location_id } = req.params;

  try {
    const result = await pool.query(
      `SELECT 
        item_id, 
        COALESCE(SUM(quantity_change), 0) as current_balance
      FROM public.inv_stock_ledger 
      WHERE location_id = $1
      GROUP BY item_id
      ORDER BY item_id`,
      [location_id]
    );

    res.json({ ok: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * GET /api/v1/inventory/ledger
 * Query stock ledger entries
 */
router.get('/ledger', async (req, res) => {
  const { item_id, location_id, type, limit = 100, offset = 0 } = req.query;
  let sql = 'SELECT * FROM public.inv_stock_ledger WHERE 1=1';
  const params = [];

  if (item_id) {
    sql += ` AND item_id = $${params.length + 1}`;
    params.push(item_id);
  }
  if (location_id) {
    sql += ` AND location_id = $${params.length + 1}`;
    params.push(location_id);
  }
  if (type) {
    sql += ` AND ledger_type = $${params.length + 1}`;
    params.push(type);
  }

  sql += ` ORDER BY posted_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limit, offset);

  try {
    const result = await pool.query(sql, params);
    res.json({ ok: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ============================================================================
// RECIPE Endpoints
// ============================================================================

/**
 * GET /api/v1/inventory/recipe/:menu_item_id
 * Fetch recipe with costing
 */
router.get('/recipe/:menu_item_id', async (req, res) => {
  const { menu_item_id } = req.params;

  try {
    const recipeRes = await pool.query(
      `SELECT * FROM public.inv_recipes WHERE menu_item_id = $1 AND is_current = true`,
      [menu_item_id]
    );

    if (!recipeRes.rows.length) {
      return res.json({ ok: true, data: null });
    }

    const recipe = recipeRes.rows[0];

    // Get ingredient lines
    const linesRes = await pool.query(
      `SELECT rl.*, ii.name, ii.weighted_avg_cost FROM public.inv_recipe_lines rl
       JOIN public.inv_items ii ON rl.item_id = ii.id
       WHERE rl.recipe_id = $1
       ORDER BY rl.line_number`,
      [recipe.id]
    );

    res.json({ ok: true, data: { recipe, lines: linesRes.rows } });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * POST /api/v1/inventory/recipe
 * Create or update recipe version
 */
router.post('/recipe', async (req, res) => {
  const { menu_item_id, lines, created_by } = req.body;

  if (!menu_item_id || !created_by) {
    return res.status(400).json({ ok: false, error: 'menu_item_id and created_by required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Mark previous recipe as not current
    await client.query(`UPDATE public.inv_recipes SET is_current = false WHERE menu_item_id = $1`, [menu_item_id]);

    // Create new recipe
    const recipeRes = await client.query(
      `INSERT INTO public.inv_recipes (id, menu_item_id, is_current, created_by, inserted_at)
      VALUES ($1, $2, true, $3, $4)
      RETURNING *`,
      [randomUUID(), menu_item_id, created_by, new Date()]
    );

    const recipe = recipeRes.rows[0];

    // Add lines
    if (Array.isArray(lines)) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        await client.query(
          `INSERT INTO public.inv_recipe_lines 
          (id, recipe_id, item_id, qty_required, prep_uom_id, wastage_pct, line_number, inserted_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [randomUUID(), recipe.id, line.item_id, line.qty_required, line.prep_uom_id, line.wastage_pct || 0, i + 1, new Date()]
        );
      }
    }

    await client.query('COMMIT');
    res.json({ ok: true, data: recipe });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ ok: false, error: error.message });
  } finally {
    client.release();
  }
});

// ============================================================================
// VARIANCE REPORT Endpoints
// ============================================================================

/**
 * POST /api/v1/inventory/variance/generate
 * Generate variance report
 */
router.post('/variance/generate', async (req, res) => {
  const { location_id, period_start, period_end, generated_by } = req.body;

  if (!location_id || !period_start || !period_end || !generated_by) {
    return res.status(400).json({ ok: false, error: 'Missing required fields' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get next variance report number
    const varCountRes = await client.query(
      `SELECT COALESCE(MAX(CAST(SUBSTRING(report_number FROM 10) AS INTEGER)), 0) + 1 as next_num
       FROM public.inv_variance_reports
       WHERE report_number ~ ('^VAR-' || TO_CHAR(CURRENT_DATE, 'YYYY') || '-\\d+$')`
    );
    const nextNum = varCountRes.rows[0].next_num;
    const reportNumber = 'VAR-' + new Date().getFullYear() + '-' + String(nextNum).padStart(4, '0');

    // Create report header
    const reportRes = await client.query(
      `INSERT INTO public.inv_variance_reports 
      (id, report_number, location_id, period_start, period_end, generated_by, inserted_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *`,
      [randomUUID(), reportNumber, location_id, period_start, period_end, generated_by, new Date()]
    );

    const report = reportRes.rows[0];

    // Get all items and calculate variance
    const itemsRes = await client.query(`SELECT DISTINCT item_id FROM public.inv_stock_ledger WHERE location_id = $1`, [
      location_id,
    ]);

    let okCount = 0,
      warningCount = 0,
      criticalCount = 0,
      totalVarianceValue = 0;

    for (const { item_id } of itemsRes.rows) {
      // Calculate variance...
      const posRes = await client.query(
        `SELECT COALESCE(SUM(quantity_change), 0) as qty FROM public.inv_stock_ledger 
        WHERE item_id = $1 AND location_id = $2 AND ledger_type = 'SALE_DEPLETION' 
        AND posted_at >= $3 AND posted_at <= $4`,
        [item_id, location_id, period_start, period_end]
      );

      const theoreticalQty = Math.abs(Number(posRes.rows[0]?.qty || 0));
      const physicalQty = 0; // Placeholder
      const varianceQty = theoreticalQty - physicalQty;
      const variancePct = theoreticalQty > 0 ? (varianceQty / theoreticalQty) * 100 : 0;
      const alertLevel = variancePct < 2 ? 'OK' : variancePct < 5 ? 'WARNING' : 'CRITICAL';

      // Count alerts
      if (alertLevel === 'OK') okCount++;
      else if (alertLevel === 'WARNING') warningCount++;
      else criticalCount++;

      totalVarianceValue += Math.abs(varianceQty);

      // Insert line
      await client.query(
        `INSERT INTO public.inv_variance_lines 
        (id, variance_report_id, item_id, pos_theoretical_qty, physical_count_qty, variance_qty, variance_pct, variance_value, alert_level, base_uom_id, inserted_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [randomUUID(), report.id, item_id, theoreticalQty, physicalQty, varianceQty, variancePct, Math.abs(varianceQty), alertLevel, 'uom_unit', new Date()]
      );
    }

    // Update report summary
    await client.query(
      `UPDATE public.inv_variance_reports 
      SET ok_count = $1, warning_count = $2, critical_count = $3, 
          variance_count = $4, total_variance_value = $5
      WHERE id = $6`,
      [okCount, warningCount, criticalCount, itemsRes.rows.length, totalVarianceValue, report.id]
    );

    await client.query('COMMIT');
    res.json({ ok: true, data: report });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ ok: false, error: error.message });
  } finally {
    client.release();
  }
});

/**
 * GET /api/v1/inventory/variance/:report_id
 * Fetch variance report detail
 */
router.get('/variance/:report_id', async (req, res) => {
  const { report_id } = req.params;

  try {
    const reportRes = await pool.query(`SELECT * FROM public.inv_variance_reports WHERE id = $1`, [report_id]);

    if (!reportRes.rows.length) {
      return res.status(404).json({ ok: false, error: 'Report not found' });
    }

    const report = reportRes.rows[0];

    // Get lines
    const linesRes = await pool.query(
      `SELECT vl.*, ii.name FROM public.inv_variance_lines vl
       JOIN public.inv_items ii ON vl.item_id = ii.id
       WHERE vl.variance_report_id = $1
       ORDER BY vl.alert_level DESC`,
      [report_id]
    );

    // Calculate total variance value
    const totalVarianceValue = linesRes.rows.reduce((sum, line) => sum + parseFloat(line.variance_value || 0), 0);

    res.json({
      ok: true,
      data: {
        ...report,
        total_variance_value: totalVarianceValue,
        lines: linesRes.rows
      }
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * GET /api/v1/inventory/items
 * Get inventory items with optional filtering and search
 */
router.get('/items', async (req, res) => {
  console.log('📦 Inventory items API called');
  try {
    const { category, search, limit = 50 } = req.query;

    let query = `
      SELECT
        i.id, i.name, i.category, i.sub_category,
        COALESCE(i.sku, '') AS sku,
        COALESCE(i.barcode, '') AS barcode,
        i.base_uom_id,
        u.code AS base_uom_code,
        u.name AS base_uom_name,
        COALESCE(i.weighted_avg_cost, 0) AS weighted_avg_cost,
        COALESCE(i.last_cost_price, 0)   AS last_cost_price,
        COALESCE(i.average_cost, 0)      AS average_cost,
        i.default_wastage_pct,
        i.reorder_level, i.par_level,
        i.expiry_tracking,
        i.default_location_id,
        i.supplier_id,
        i.media_url, i.notes,
        i.is_active, i.inserted_at, i.updated_at
      FROM public.inv_items i
      LEFT JOIN public.inv_uom_definitions u ON i.base_uom_id = u.id
      WHERE i.is_active = true
    `;

    const params = [];
    const conditions = [];

    if (category && category !== 'all') {
      conditions.push(`i.category = $${params.length + 1}`);
      params.push(category);
    }

    if (search) {
      conditions.push(`i.name ILIKE $${params.length + 1}`);
      params.push(`%${search}%`);
    }

    if (conditions.length > 0) {
      query += ' AND ' + conditions.join(' AND ');
    }

    query += ` ORDER BY i.name LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await pool.query(query, params);

    res.json({
      ok: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Items fetch error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to fetch items',
      message: error.message
    });
  }
});


// ============================================================================
// ITEM MASTER — create / update / delete
// ============================================================================

/** POST /api/v1/inventory/items  — create or upsert an item */
router.post('/items', async (req, res) => {
  const {
    id, name, category, sub_category, base_uom_id, sku, barcode,
    last_cost_price, selling_price, expiry_tracking, default_location_id, supplier_id,
    media_url, notes, par_level, reorder_level, default_wastage_pct
  } = req.body;
  if (!name) return res.status(400).json({ ok: false, error: 'name is required' });

  try {
    const itemId = id || randomUUID();
    // Auto-generate SKU if not provided
    const skuVal = sku || null;

    const r = await pool.query(`
      INSERT INTO public.inv_items
        (id, name, category, sub_category, base_uom_id, sku, barcode,
         last_cost_price, weighted_avg_cost, average_cost,
         expiry_tracking, default_location_id, supplier_id,
         media_url, notes, par_level, reorder_level, default_wastage_pct,
         is_active, inserted_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$8,$9,$10,$11,$12,$13,$14,$15,$16,true,NOW(),NOW())
      ON CONFLICT (id) DO UPDATE SET
        name               = EXCLUDED.name,
        category           = EXCLUDED.category,
        sub_category       = EXCLUDED.sub_category,
        base_uom_id        = EXCLUDED.base_uom_id,
        sku                = COALESCE(EXCLUDED.sku, public.inv_items.sku),
        barcode            = EXCLUDED.barcode,
        last_cost_price    = EXCLUDED.last_cost_price,
        expiry_tracking    = EXCLUDED.expiry_tracking,
        default_location_id= EXCLUDED.default_location_id,
        supplier_id        = EXCLUDED.supplier_id,
        media_url          = EXCLUDED.media_url,
        notes              = EXCLUDED.notes,
        par_level          = EXCLUDED.par_level,
        reorder_level      = EXCLUDED.reorder_level,
        default_wastage_pct= EXCLUDED.default_wastage_pct,
        updated_at         = NOW()
      RETURNING *
    `, [itemId, name, category||'Food', sub_category||null, base_uom_id||'uom_unit',
        skuVal, barcode||null, Number(last_cost_price||0),
        !!expiry_tracking, default_location_id||null, supplier_id||null,
        media_url||null, notes||null, Number(par_level||0), Number(reorder_level||0),
        Number(default_wastage_pct||0)]);

    const item = r.rows[0];

    // ── Sync to products table so item appears in POS ─────────────────────
    // category drives department; sub_category maps to products.category
    const isBeverage = String(category || '').toLowerCase().includes('beverage')
                    || String(category || '').toLowerCase().includes('bar')
                    || String(category || '').toLowerCase().includes('cellar');
    const dept       = isBeverage ? 'Bar' : 'Restaurant';
    const uomRes     = await pool.query(`SELECT code FROM public.inv_uom_definitions WHERE id=$1`, [base_uom_id||'uom_unit']);
    const uomCode    = uomRes.rows[0]?.code || 'units';

    await pool.query(`
      INSERT INTO public.products
        (id, name, category, department, price, cost_price, stock_level, unit,
         active, visibility, bar_visibility, restaurant_visibility,
         category_id, notes, picture_data, inserted_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,0,$7,true,'{}',false,false,$8,$9,$10,NOW(),NOW())
      ON CONFLICT (id) DO UPDATE SET
        name                 = EXCLUDED.name,
        department           = EXCLUDED.department,
        category             = EXCLUDED.category,
        price                = CASE WHEN EXCLUDED.price > 0 THEN EXCLUDED.price ELSE products.price END,
        cost_price           = EXCLUDED.cost_price,
        unit                 = EXCLUDED.unit,
        notes                = EXCLUDED.notes,
        picture_data         = EXCLUDED.picture_data,
        updated_at           = NOW()
    `, [item.id, name, sub_category || (isBeverage ? 'bar' : 'restaurant'), dept,
        Number(selling_price || 0), Number(last_cost_price || 0), uomCode,
        sub_category || null, notes || null, media_url || null]);

    res.json({ ok: true, data: item });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/** PUT /api/v1/inventory/items/:id — full update (FIX: was broken router.handle pattern) */
router.put('/items/:id', async (req, res) => {
  // Merge ID into body and forward to POST upsert handler properly
  req.body = { ...req.body, id: req.params.id };
  // Re-invoke POST handler logic inline (router.handle is unreliable)
  const {
    id, name, category, sub_category, base_uom_id, sku, barcode,
    last_cost_price, selling_price, expiry_tracking, default_location_id, supplier_id,
    media_url, notes, par_level, reorder_level, default_wastage_pct
  } = req.body;
  if (!name) return res.status(400).json({ ok: false, error: 'name is required' });
  try {
    const r = await pool.query(`
      UPDATE public.inv_items SET
        name               = $2,
        category           = $3,
        sub_category       = $4,
        base_uom_id        = $5,
        sku                = COALESCE($6, sku),
        barcode            = $7,
        last_cost_price    = $8,
        expiry_tracking    = $9,
        default_location_id= $10,
        supplier_id        = $11,
        media_url          = $12,
        notes              = $13,
        par_level          = $14,
        reorder_level      = $15,
        default_wastage_pct= $16,
        updated_at         = NOW()
      WHERE id = $1
      RETURNING *
    `, [id, name, category||'Food', sub_category||null, base_uom_id||'uom_unit',
        sku||null, barcode||null, Number(last_cost_price||0),
        !!expiry_tracking, default_location_id||null, supplier_id||null,
        media_url||null, notes||null, Number(par_level||0), Number(reorder_level||0),
        Number(default_wastage_pct||0)]);

    if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Item not found' });
    const item = r.rows[0];

    // Sync selling price and cost to products table
    const isBeverage = String(category||'').toLowerCase().includes('beverage') ||
                       String(category||'').toLowerCase().includes('bar');
    const dept = isBeverage ? 'Bar' : 'Restaurant';
    const uomRes = await pool.query(`SELECT code FROM public.inv_uom_definitions WHERE id=$1`, [base_uom_id||'uom_unit']);
    const uomCode = uomRes.rows[0]?.code || 'units';
    await pool.query(`
      UPDATE public.products SET
        name           = $2,
        department     = $3,
        category       = $4,
        price          = CASE WHEN $5 > 0 THEN $5 ELSE price END,
        cost_price     = $6,
        unit           = $7,
        notes          = $8,
        picture_data   = $9,
        updated_at     = NOW()
      WHERE id = $1
    `, [item.id, name, dept, sub_category||(isBeverage?'bar':'restaurant'),
        Number(selling_price||0), Number(last_cost_price||0), uomCode, notes||null, media_url||null]);

    res.json({ ok: true, data: item });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

/** DELETE /api/v1/inventory/items/:id — soft-delete (FIX: also deactivates in products table) */
router.delete('/items/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Soft-delete in inv_items
    const r = await client.query(
      `UPDATE public.inv_items SET is_active=false, updated_at=NOW() WHERE id=$1 RETURNING id, name`,
      [req.params.id]
    );
    if (!r.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ ok: false, error: 'Item not found' }); }
    // FIX: Also deactivate in products so item disappears from POS menu
    await client.query(`UPDATE public.products SET active=false, updated_at=NOW() WHERE id=$1`, [req.params.id]);
    await client.query('COMMIT');
    res.json({ ok: true, message: `${r.rows[0].name} deactivated from inventory and POS` });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ ok: false, error: err.message });
  } finally { client.release(); }
});

// ============================================================================
// LOCATIONS — Full CRUD
// ============================================================================
router.get('/locations', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, name, location_type, parent_location_id, description, is_active
       FROM public.inv_locations WHERE is_active=true ORDER BY location_type, name`
    );
    res.json({ ok: true, data: r.rows });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

/** POST /api/v1/inventory/locations — create new location */
router.post('/locations', async (req, res) => {
  const { name, location_type, parent_location_id, description } = req.body;
  if (!name || !location_type) return res.status(400).json({ ok: false, error: 'name and location_type required' });
  if (!['Storage','Outlet'].includes(location_type)) return res.status(400).json({ ok: false, error: 'location_type must be Storage or Outlet' });
  try {
    // Generate a clean ID from name
    const id = 'loc_' + name.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g,'_').slice(0,30) + '_' + Date.now().toString(36);
    const r = await pool.query(
      `INSERT INTO public.inv_locations (id, name, location_type, parent_location_id, description, is_active, inserted_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,true,NOW(),NOW()) RETURNING *`,
      [id, name, location_type, parent_location_id||null, description||null]
    );
    res.json({ ok: true, data: r.rows[0] });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

/** PUT /api/v1/inventory/locations/:id — update location name/description */
router.put('/locations/:id', async (req, res) => {
  const { name, description, parent_location_id } = req.body;
  if (!name) return res.status(400).json({ ok: false, error: 'name required' });
  try {
    const r = await pool.query(
      `UPDATE public.inv_locations SET name=$2, description=$3, parent_location_id=$4, updated_at=NOW() WHERE id=$1 AND is_active=true RETURNING *`,
      [req.params.id, name, description||null, parent_location_id||null]
    );
    if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Location not found' });
    res.json({ ok: true, data: r.rows[0] });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

/** DELETE /api/v1/inventory/locations/:id — soft-delete with balance guard */
router.delete('/locations/:id', async (req, res) => {
  try {
    // Guard: block deletion if location has active stock
    const balCheck = await pool.query(
      `SELECT COALESCE(SUM(quantity_change),0) as total_balance FROM public.inv_stock_ledger WHERE location_id=$1`,
      [req.params.id]
    );
    const totalBalance = Number(balCheck.rows[0]?.total_balance || 0);
    if (totalBalance > 0) {
      return res.status(409).json({
        ok: false,
        error: `Cannot delete location with active stock (balance: ${totalBalance.toFixed(3)}). Transfer all stock out first.`
      });
    }
    // Guard: block if there are open GRNs or transfers referencing this location
    const openGrn = await pool.query(
      `SELECT COUNT(*) as cnt FROM public.inv_grn_headers WHERE destination_location_id=$1 AND status='draft'`,
      [req.params.id]
    );
    if (Number(openGrn.rows[0]?.cnt) > 0) {
      return res.status(409).json({ ok: false, error: 'Cannot delete location with open (draft) GRNs' });
    }
    await pool.query(`UPDATE public.inv_locations SET is_active=false, updated_at=NOW() WHERE id=$1`, [req.params.id]);
    res.json({ ok: true, message: 'Location deactivated' });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ============================================================================
// UOM DEFINITIONS — Full CRUD
// ============================================================================
router.get('/uom', async (req, res) => {
  try {
    const r = await pool.query(`SELECT id, code, name, category, description FROM public.inv_uom_definitions ORDER BY category, name`);
    res.json({ ok: true, data: r.rows });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

/** POST /api/v1/inventory/uom — create new UOM */
router.post('/uom', async (req, res) => {
  const { code, name, category, description } = req.body;
  if (!code || !name) return res.status(400).json({ ok: false, error: 'code and name required' });
  if (!['Count','Volume','Weight'].includes(category||'Count')) {
    return res.status(400).json({ ok: false, error: 'category must be Count, Volume or Weight' });
  }
  try {
    const id = 'uom_' + code.toLowerCase().replace(/[^a-z0-9]/g,'_');
    const r = await pool.query(
      `INSERT INTO public.inv_uom_definitions (id, code, name, category, description, inserted_at)
       VALUES ($1,$2,$3,$4,$5,NOW())
       ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, category=EXCLUDED.category, description=EXCLUDED.description
       RETURNING *`,
      [id, code.toUpperCase(), name, category||'Count', description||null]
    );
    res.json({ ok: true, data: r.rows[0] });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

/** PUT /api/v1/inventory/uom/:id — update UOM name/description (code is immutable) */
router.put('/uom/:id', async (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ ok: false, error: 'name required' });
  try {
    const r = await pool.query(
      `UPDATE public.inv_uom_definitions SET name=$2, description=$3 WHERE id=$1 RETURNING *`,
      [req.params.id, name, description||null]
    );
    if (!r.rows.length) return res.status(404).json({ ok: false, error: 'UOM not found' });
    res.json({ ok: true, data: r.rows[0] });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

/** DELETE /api/v1/inventory/uom/:id — block if items or conversions use this UOM */
router.delete('/uom/:id', async (req, res) => {
  try {
    // Guard: UOM in use by items
    const inUse = await pool.query(
      `SELECT COUNT(*) as cnt FROM public.inv_items WHERE base_uom_id=$1 AND is_active=true`,
      [req.params.id]
    );
    if (Number(inUse.rows[0]?.cnt) > 0) {
      return res.status(409).json({ ok: false, error: `UOM is assigned to ${inUse.rows[0].cnt} active items. Reassign items first.` });
    }
    // Guard: UOM in use by conversions
    const convInUse = await pool.query(
      `SELECT COUNT(*) as cnt FROM public.inv_uom_conversions WHERE from_uom_id=$1 OR to_uom_id=$1`,
      [req.params.id]
    );
    if (Number(convInUse.rows[0]?.cnt) > 0) {
      return res.status(409).json({ ok: false, error: `UOM is used in ${convInUse.rows[0].cnt} conversion rules. Remove conversions first.` });
    }
    await pool.query(`DELETE FROM public.inv_uom_definitions WHERE id=$1`, [req.params.id]);
    res.json({ ok: true, message: 'UOM deleted' });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ============================================================================
// PHYSICAL COUNT (for variance reports)
// ============================================================================

/** POST /api/v1/inventory/physical-count — open a new physical count session */
router.post('/physical-count', async (req, res) => {
  const { location_id, count_date, counted_by } = req.body;
  if (!location_id) return res.status(400).json({ ok: false, error: 'location_id required' });
  try {
    const r = await pool.query(
      `INSERT INTO public.inv_physical_counts (id, location_id, count_date, status, counted_by, inserted_at, updated_at)
       VALUES ($1,$2,$3,'draft',$4,NOW(),NOW()) RETURNING *`,
      [randomUUID(), location_id, count_date || new Date().toISOString().slice(0,10), counted_by||'system']
    );
    res.json({ ok: true, data: r.rows[0] });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

/** GET /api/v1/inventory/physical-count — list counts */
router.get('/physical-count', async (req, res) => {
  const { location_id, status } = req.query;
  try {
    let sql = `SELECT pc.*, l.name AS location_name FROM public.inv_physical_counts pc
               LEFT JOIN public.inv_locations l ON l.id = pc.location_id WHERE 1=1`;
    const params = [];
    if (location_id) { sql += ` AND pc.location_id=$${++params.length}`; params.push(location_id); }
    if (status)      { sql += ` AND pc.status=$${++params.length}`;      params.push(status); }
    sql += ' ORDER BY pc.inserted_at DESC LIMIT 50';
    const r = await pool.query(sql, params);
    res.json({ ok: true, data: r.rows });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

/** POST /api/v1/inventory/physical-count/:id/lines — save count lines */
router.post('/physical-count/:id/lines', async (req, res) => {
  const { id } = req.params;
  const { lines } = req.body; // [{item_id, physical_qty, uom_id, notes}]
  if (!Array.isArray(lines)) return res.status(400).json({ ok: false, error: 'lines[] required' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM public.inv_physical_count_lines WHERE count_id=$1`, [id]);
    for (const l of lines) {
      await client.query(
        `INSERT INTO public.inv_physical_count_lines (id, count_id, item_id, physical_qty, uom_id, notes, inserted_at)
         VALUES ($1,$2,$3,$4,$5,$6,NOW())`,
        [randomUUID(), id, l.item_id, Number(l.physical_qty||0), l.uom_id||null, l.notes||null]
      );
    }
    await client.query(`UPDATE public.inv_physical_counts SET status='submitted', updated_at=NOW() WHERE id=$1`, [id]);
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ ok: false, error: err.message });
  } finally { client.release(); }
});

// ============================================================================
// VARIANCE REPORT — generate from physical count vs ledger theoretical
// ============================================================================
router.post('/variance/generate', async (req, res) => {
  const { location_id, period_start, period_end, generated_by, physical_count_id } = req.body;
  if (!location_id || !period_start || !period_end)
    return res.status(400).json({ ok: false, error: 'location_id, period_start, period_end required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Theoretical qty = opening stock + GRNs - transfers out + transfers in - POS depletions
    const theoreticalRes = await client.query(`
      SELECT
        item_id,
        SUM(CASE WHEN ledger_type IN ('GRN','TRANSFER_IN','ADJUSTMENT_IN') THEN quantity_change
                 WHEN ledger_type IN ('TRANSFER_OUT','SALE_DEPLETION','WASTE','ADJUSTMENT_OUT') THEN -quantity_change
                 ELSE 0 END) AS theoretical_qty,
        AVG(cost_per_unit) AS avg_cost
      FROM public.inv_stock_ledger
      WHERE location_id = $1
        AND inserted_at BETWEEN $2 AND $3::date + interval '1 day'
      GROUP BY item_id
    `, [location_id, period_start, period_end]);

    // Physical counts (if count session provided)
    const physicalMap = {};
    if (physical_count_id) {
      const physRes = await client.query(
        `SELECT item_id, physical_qty FROM public.inv_physical_count_lines WHERE count_id=$1`, [physical_count_id]
      );
      for (const row of physRes.rows) physicalMap[row.item_id] = Number(row.physical_qty);
    }

    // Report number
    const numRes = await client.query(
      `SELECT COALESCE(MAX(CAST(SUBSTRING(report_number FROM 5) AS INTEGER)),0)+1 AS n FROM public.inv_variance_reports`
    );
    const reportNum = 'VAR-' + String(numRes.rows[0].n).padStart(4,'0');

    let okCount=0, warnCount=0, critCount=0;
    const lines = [];

    for (const row of theoreticalRes.rows) {
      const theoretical = Number(row.theoretical_qty || 0);
      const physical    = physicalMap[row.item_id] ?? theoretical; // if no count, assume matches
      const variance    = physical - theoretical;
      const variancePct = theoretical !== 0 ? Math.abs(variance / theoretical * 100) : 0;
      const cost        = Number(row.avg_cost || 0);
      const varianceVal = Math.abs(variance) * cost;

      let alert = 'ok';
      if (variancePct >= 5)      { alert = 'critical'; critCount++; }
      else if (variancePct >= 2) { alert = 'warning';  warnCount++; }
      else                       { okCount++; }

      lines.push({ item_id: row.item_id, theoretical, physical, variance, variancePct, varianceVal, alert, cost });
    }

    const reportId = randomUUID();
    await client.query(`
      INSERT INTO public.inv_variance_reports
        (id, report_number, location_id, period_start, period_end, generated_by,
         ok_count, warning_count, critical_count, inserted_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())`,
      [reportId, reportNum, location_id, period_start, period_end, generated_by||'system',
       okCount, warnCount, critCount]
    );

    for (const l of lines) {
      await client.query(`
        INSERT INTO public.inv_variance_lines
          (id, variance_report_id, item_id, theoretical_qty, physical_qty,
           variance_qty, variance_percentage, alert_level, item_cost, variance_value, inserted_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())`,
        [randomUUID(), reportId, l.item_id, l.theoretical, l.physical,
         l.variance, l.variancePct, l.alert, l.cost, l.varianceVal]
      );
    }

    await client.query('COMMIT');
    res.json({ ok: true, data: { id: reportId, report_number: reportNum, ok_count: okCount, warning_count: warnCount, critical_count: critCount, lines } });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ ok: false, error: err.message });
  } finally { client.release(); }
});

// ============================================================================
// STOCK BALANCE with location name (enhanced)
// ============================================================================
router.get('/stock-summary', async (req, res) => {
  const { location_id } = req.query;
  try {
    let sql = `
      SELECT
        sl.item_id,
        i.name, i.category, i.sku,
        COALESCE(i.weighted_avg_cost,0) AS unit_cost,
        SUM(CASE WHEN sl.ledger_type IN ('GRN','TRANSFER_IN','ADJUSTMENT_IN') THEN sl.quantity_change
                 ELSE -sl.quantity_change END) AS qty_on_hand,
        u.code AS uom,
        l.name AS location_name
      FROM public.inv_stock_ledger sl
      JOIN public.inv_items i ON i.id = sl.item_id
      JOIN public.inv_locations l ON l.id = sl.location_id
      LEFT JOIN public.inv_uom_definitions u ON u.id = i.base_uom_id
      WHERE i.is_active = true`;
    const params = [];
    if (location_id) { sql += ` AND sl.location_id=$1`; params.push(location_id); }
    sql += ` GROUP BY sl.item_id,i.name,i.category,i.sku,i.weighted_avg_cost,u.code,l.name
             HAVING SUM(CASE WHEN sl.ledger_type IN ('GRN','TRANSFER_IN','ADJUSTMENT_IN') THEN sl.quantity_change ELSE -sl.quantity_change END) > 0
             ORDER BY l.name, i.category, i.name`;
    const r = await pool.query(sql, params);
    res.json({ ok: true, data: r.rows });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

module.exports = router;
