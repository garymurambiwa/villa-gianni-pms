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

    // Create ledger entries
    for (const line of linesRes.rows) {
      // Get base UOM
      const itemRes = await client.query(`SELECT base_uom_id FROM public.inv_items WHERE id = $1`, [line.item_id]);
      const baseUomId = itemRes.rows[0]?.base_uom_id || line.received_uom_id;

      // Create ledger entry
      await client.query(
        `INSERT INTO public.inv_stock_ledger 
        (id, item_id, location_id, ledger_type, reference_number, quantity_change, base_uom_id, cost_per_unit, total_cost, posted_by, gl_account_code, inserted_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [randomUUID(), line.item_id, grn.destination_location_id, 'GRN', grn.grn_number, line.qty_received, baseUomId, line.unit_cost, line.line_total, posted_by, 'INVENTORY_ASSET', new Date()]
      );
    }

    // Update GRN status
      await client.query(
        `UPDATE public.inv_grn_headers SET status = $1, posted_by = $2, posted_at = $3 WHERE id = $4`,
        ['posted', posted_by, new Date(), id]
      );

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
  const { source_location_id, destination_location_id, created_by, reference_text, lines } = req.body;

  if (!source_location_id || !destination_location_id || !created_by) {
    return res.status(400).json({ ok: false, error: 'Missing required fields' });
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

      if (Math.abs(balance) < line.qty_requested) {
        throw new Error(`Insufficient stock for item ${line.item_id}`);
      }

      // Create TRANSFER_OUT entry
      await client.query(
        `INSERT INTO public.inv_stock_ledger 
        (id, item_id, location_id, ledger_type, reference_number, quantity_change, base_uom_id, posted_by, inserted_at)
        VALUES ($1, $2, $3, 'TRANSFER_OUT', $4, $5, $6, $7, $8)`,
        [randomUUID(), line.item_id, transfer.source_location_id, transfer.transfer_number, -line.qty_requested, line.source_uom_id, approved_by, new Date()]
      );

      // Create TRANSFER_IN entry (with breakdown conversion if needed)
      const destUomId = line.destination_uom_id || line.source_uom_id;
      const destQty = line.breakdown_flag ? line.qty_requested * 30 : line.qty_requested; // Breakdown: 1 bottle = 30 tots

      await client.query(
        `INSERT INTO public.inv_stock_ledger 
        (id, item_id, location_id, ledger_type, reference_number, quantity_change, base_uom_id, posted_by, inserted_at)
        VALUES ($1, $2, $3, 'TRANSFER_IN', $4, $5, $6, $7, $8)`,
        [randomUUID(), line.item_id, transfer.destination_location_id, transfer.transfer_number, destQty, destUomId, approved_by, new Date()]
      );
    }

    // Update transfer status
    await client.query(
      `UPDATE public.inv_transfer_headers SET status = 'approved', approved_by = $1, approved_at = $2 WHERE id = $3`,
      [approved_by, new Date(), id]
    );

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
        i.id,
        i.name,
        i.category,
        '' as sku,
        '' as barcode,
        u.code as base_uom_symbol,
        i.weighted_avg_cost
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

module.exports = router;
