const express = require('express');
const cors = require('cors');
const path = require('path');

// Load database module
const db = require('./db-web.cjs');

// Load environment variables
try { require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') }) } catch { }

const app = express();
const wsInstance = require('express-ws')(app);
const PORT = process.env.PORT || 3001;

// Minimal middleware
app.use(cors());
app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
  console.log(`📨 ${req.method} ${req.url}`);
  next();
});

// Serve static files from dist directory
app.use(express.static(path.join(__dirname, '..', 'dist')));

// Basic test route
app.get('/api/test', (req, res) => {
  console.log('🧪 Test route called');
  res.json({ ok: true, message: 'Server is working', timestamp: new Date().toISOString() });
});

// 1. Database API Endpoints (Strictly mirrors Electron IPC "db:..." handlers)

// POST /api/db/query
app.post('/api/db/query', async (req, res) => {
    const { sql, params } = req.body;
    if (!sql) return res.status(400).json({ ok: false, error: 'SQL required' });

    // Basic security check (very weak, assumes internal use only)
    const s = sql.toLowerCase().trim();
    if (s.startsWith('drop') || s.startsWith('truncate')) {
        // Allow ONLY if explicitly authorized or dev mode? For now, block dangerous ops via API
        // return res.status(403).json({ ok: false, error: 'Destructive DDL not allowed via API' });
    }

    const result = await db.query(sql, params);
    res.json(result);
});

// POST /api/db/exec
app.post('/api/db/exec', async (req, res) => {
    const { sql } = req.body;
    if (!sql) return res.status(400).json({ ok: false, error: 'SQL required' });
    const result = await db.exec(sql);
    res.json(result);
});

// POST /api/db/transaction
app.post('/api/db/transaction', async (req, res) => {
    const { operations } = req.body;
    if (!Array.isArray(operations)) return res.status(400).json({ ok: false, error: 'Operations array required' });
    const result = await db.transaction(operations);
    res.json(result);
});

// POST /api/db/test (Equiv to db:testConnection)
app.post('/api/db/test', async (req, res) => {
    try {
        const result = await db.query('SELECT version()');
        if (result.ok) {
            res.json({ ok: true, serverVersion: result.rows[0].version });
        } else {
            res.json({ ok: false, error: result.error });
        }
    } catch (e) {
        res.json({ ok: false, error: e.message });
    }
});

// GET /api/setup/init-db?key=123 (Temporary workaround for no-shell environments)
// GET /api/setup/init-db?key=confirm&reset=true
app.get('/api/setup/init-db', async (req, res) => {
    const { key, reset } = req.query;

    if (key !== 'confirm') {
        return res.status(400).send('<h1>Missing confirmation</h1><p>Use <code>?key=confirm</code> to init. Add <code>&reset=true</code> to wipe DB first.</p>');
    }

    try {
        const fs = require('fs');
        const schemaPath = path.join(__dirname, '..', 'db', 'schema.sql');
        if (!fs.existsSync(schemaPath)) return res.status(500).send('Schema file missing');

        const sql = fs.readFileSync(schemaPath, 'utf8');

        // If reset=true, DROP everything first
        if (reset === 'true') {
            await db.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO public;');
        }

        const result = await db.exec(sql);

        if (result.ok) {
            res.send('<h1>✅ Database Initialized Successfully!</h1><p>Tables created. You can now go to the home page.</p>');
        } else {
            res.status(500).send(`<h1>❌ Error</h1><pre>${result.error}</pre>`);
        }
    } catch (e) {
        res.status(500).send(`<h1>❌ Exception</h1><pre>${e.message}</pre>`);
    }
});


// ─── Inventory Reconciliation API Endpoints ─────────────────────────────────────

// GET /api/inventory/periods
app.get('/api/inventory/periods', async (req, res) => {
    try {
        const result = await db.query(
            'SELECT * FROM inventory_periods ORDER BY period_year DESC, period_month DESC'
        );
        res.json(result);
    } catch (e) {
        res.json({ ok: false, error: e.message });
    }
});

// POST /api/inventory/periods
app.post('/api/inventory/periods', async (req, res) => {
    const { period_name, period_year, period_month, start_date, end_date, status, opening_stock_value, created_by } = req.body;
    if (!period_name || !period_year || !period_month || !start_date || !end_date) {
        return res.status(400).json({ ok: false, error: 'Missing required fields' });
    }
    try {
        // Enforce: only one period may be open/reconciling at a time
        const openCheck = await db.query(
            "SELECT id FROM inventory_periods WHERE status IN ('open', 'reconciling') LIMIT 1"
        );
        if (openCheck.rows && openCheck.rows.length > 0) {
            return res.status(409).json({ ok: false, error: 'Another period is already open or reconciling. Close it before creating a new one.' });
        }

        const result = await db.query(
            `INSERT INTO inventory_periods (period_name, period_year, period_month, start_date, end_date, status, opening_stock_value, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [period_name, period_year, period_month, start_date, end_date, status || 'open', opening_stock_value || 0, created_by]
        );
        res.json(result);
    } catch (e) {
        res.json({ ok: false, error: e.message });
    }
});

// PUT /api/inventory/periods/:id
app.put('/api/inventory/periods/:id', async (req, res) => {
    const { id } = req.params;
    const fields = [];
    const values = [];
    const allowedFields = ['period_name', 'status', 'closing_stock_value', 'variance_value', 'cogs_value', 'kitchen_cogs', 'cellar_cogs', 'closed_by', 'closed_reason', 'reopened_at', 'reopened_by', 'is_locked', 'locked_at', 'locked_by'];
    
    for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
            fields.push(`${field} = ?`);
            values.push(req.body[field]);
        }
    }
    
    if (fields.length === 0) {
        return res.status(400).json({ ok: false, error: 'No fields to update' });
    }
    
    values.push(id);
    
    try {
        // If status is being changed to 'open' or 'reconciling', enforce singleton
        const newStatus = req.body.status;
        if (newStatus && ['open', 'reconciling'].includes(newStatus)) {
            const existing = await db.query(
                "SELECT id FROM inventory_periods WHERE status IN ('open', 'reconciling') AND id != ?",
                [id]
            );
            if (existing.rows && existing.rows.length > 0) {
                return res.status(409).json({ ok: false, error: 'Another period is already open or reconciling.' });
            }
        }
        
        const result = await db.query(
            `UPDATE inventory_periods SET ${fields.join(', ')}, updated_at = NOW() WHERE id = ?`,
            values
        );
        res.json(result);
    } catch (e) {
        res.json({ ok: false, error: e.message });
    }
});

// GET /api/inventory/transactions
app.get('/api/inventory/transactions', async (req, res) => {
    const { period_id, limit } = req.query;
    let sql = 'SELECT * FROM inventory_transactions WHERE is_deleted = false';
    const params = [];
    
    if (period_id) {
        sql += ' AND period_id = ?';
        params.push(period_id);
    }
    
    sql += ' ORDER BY transaction_date DESC';
    
    if (limit) {
        sql += ' LIMIT ?';
        params.push(parseInt(limit));
    }
    
    try {
        const result = await db.query(sql, params);
        res.json(result);
    } catch (e) {
        res.json({ ok: false, error: e.message });
    }
});

// POST /api/inventory/transactions
app.post('/api/inventory/transactions', async (req, res) => {
    const { transaction_type, transaction_number, period_id, transaction_date, department, total_quantity, total_value, supplier_name, created_by, is_historical_backfill } = req.body;
    if (!transaction_type || !transaction_number || !transaction_date || !department) {
        return res.status(400).json({ ok: false, error: 'Missing required fields' });
    }
    try {
        // Validate period exists and is not locked/closed (if period_id provided)
        if (period_id) {
            const periodCheck = await db.query('SELECT status, is_locked FROM inventory_periods WHERE id = ?', [period_id]);
            if (!periodCheck.rows || periodCheck.rows.length === 0) {
                return res.status(404).json({ ok: false, error: 'Period not found' });
            }
            const period = periodCheck.rows[0];
            if (period.is_locked) {
                return res.status(403).json({ ok: false, error: 'Period is locked. Cannot add transactions.' });
            }
            if (['closed', 'locked'].includes(period.status)) {
                return res.status(403).json({ ok: false, error: `Period is ${period.status}. Cannot add transactions.` });
            }
        }

        // Insert transaction and optionally bump period received_value (for receipts) atomically
        const ops = [
            {
                sql: `INSERT INTO inventory_transactions (transaction_type, transaction_number, period_id, transaction_date, department, total_quantity, total_value, supplier_name, created_by, is_historical_backfill)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                params: [transaction_type, transaction_number, period_id, transaction_date, department, total_quantity || 0, total_value || 0, supplier_name, created_by, is_historical_backfill || false]
            }
        ];

        if (['purchase', 'grv'].includes(transaction_type) && period_id) {
            ops.push({
                sql: `UPDATE inventory_periods SET received_value = COALESCE(received_value,0) + ? WHERE id = ?`,
                params: [total_value || 0, period_id]
            });
        }

        const result = await db.transaction(ops);
        res.json(result);
    } catch (e) {
        res.json({ ok: false, error: e.message });
    }
});

// POST /api/inventory/batch-reconcile
// Atomically process batch physical count updates, create snapshots, and generate adjustment transactions
app.post('/api/inventory/batch-reconcile', async (req, res) => {
    const { period_id, user_id, items } = req.body;  // items: [{ product_id, physical_qty, cost_price? }]
    if (!period_id || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ ok: false, error: 'Invalid request: period_id and items array required' });
    }

    const client = await db.pool.connect();
    try {
        // Validate period is in reconciling state
        const periodRes = await client.query('SELECT status, is_locked FROM inventory_periods WHERE id = ?', [period_id]);
        if (!periodRes.rows || periodRes.rows.length === 0) {
            return res.status(404).json({ ok: false, error: 'Period not found' });
        }
        const period = periodRes.rows[0];
        if (period.is_locked) {
            return res.status(403).json({ ok: false, error: 'Period is locked. Cannot reconcile.' });
        }
        if (period.status !== 'reconciling') {
            return res.status(403).json({ ok: false, error: `Period must be in 'reconciling' state, current: ${period.status}` });
        }

        await client.query('BEGIN');

        for (const item of items) {
            const { product_id, physical_qty, cost_price } = item;
            const physQty = Number(physical_qty) || 0;

            // Validate product exists
            const prodRes = await client.query('SELECT id, name, department, cost_price FROM products WHERE id = ?', [product_id]);
            if (!prodRes.rows || prodRes.rows.length === 0) {
                throw new Error(`Product ${product_id} not found`);
            }
            const product = prodRes.rows[0];

            // Determine new cost (keep existing if not provided)
            const newCost = cost_price !== undefined && cost_price !== null ? Number(cost_price) : Number(product.cost_price || 0);

            // Record physical count metadata on product (do not alter stock_level yet)
            const updates = ['last_inventory_period_id = ?', 'last_physical_qty = ?', 'last_physical_date = ?'];
            const values = [period_id, physQty, new Date().toISOString().split('T')[0]];
            if (cost_price !== undefined && cost_price !== null) {
                updates.push('cost_price = ?');
                values.push(newCost);
            }
            values.push(product_id);
            await client.query(
                `UPDATE products SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`,
                values
            );
        }
            const product = prodRes.rows[0];
            const bookQty = Number(product.stock_level || 0);
            const currentCost = Number(product.cost_price || 0);
            const newCost = cost_price !== undefined && cost_price !== null ? Number(cost_price) : currentCost;

            // Compute variance and value delta
            const variance = physQty - bookQty;
            const totalValue = variance * newCost;

            // Fetch aggregated transaction sums for this period/product BEFORE we add adjustment
            const aggRes = await client.query(
                `SELECT
                  COALESCE(SUM(CASE WHEN type = 'opening_balance' THEN quantity ELSE 0 END),0) as opening_qty,
                  COALESCE(SUM(CASE WHEN type IN ('purchase','grv') THEN quantity ELSE 0 END),0) as received_qty,
                  COALESCE(SUM(CASE WHEN type = 'usage' THEN quantity ELSE 0 END),0) as usage_qty
                 FROM inventory_transactions
                 WHERE period_id = ? AND product_id = ?`,
                [period_id, product_id]
            );
            const openingQty = Number(aggRes.rows[0].opening_qty);
            const receivedQty = Number(aggRes.rows[0].received_qty);
            const usageQty = Number(aggRes.rows[0].usage_qty);

            // Upsert inventory_snapshot
            await client.query(
                `INSERT INTO inventory_snapshots (period_id, product_id, physical_qty, variance, opening_qty, received_qty, system_usage_qty)
                 VALUES (?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT (period_id, product_id) DO UPDATE SET
                   physical_qty = EXCLUDED.physical_qty,
                   variance = EXCLUDED.variance,
                   opening_qty = EXCLUDED.opening_qty,
                   received_qty = EXCLUDED.received_qty,
                   system_usage_qty = EXCLUDED.system_usage_qty,
                   updated_at = NOW()`,
                [period_id, product_id, physQty, variance, openingQty, receivedQty, usageQty]
            );

            // Create adjustment transaction if variance non-zero
            if (variance !== 0) {
                await client.query(
                    `INSERT INTO inventory_transactions
                     (transaction_type, transaction_number, period_id, transaction_date, department, total_quantity, total_value, created_by)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    ['adjustment', `BATCH-${Date.now()}-${product_id.slice(0,8)}`, period_id, new Date().toISOString().split('T')[0],
                     product.department, variance, totalValue, req.body.user_id || 'system']
                );
            }

            // Update product
            const updates = ['stock_level = ?', 'last_inventory_period_id = ?', 'last_physical_qty = ?', 'last_physical_date = ?'];
            const values = [physQty, period_id, physQty, new Date().toISOString().split('T')[0]];
            if (cost_price !== undefined && cost_price !== null) {
                updates.push('cost_price = ?');
                values.push(newCost);
            }
            values.push(product_id);
            await client.query(
                `UPDATE products SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`,
                values
            );
        }

        await client.query('COMMIT');
        res.json({ ok: true, message: `Batch reconciled ${items.length} items` });
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('Batch reconcile error:', e);
        res.json({ ok: false, error: e.message });
    } finally {
        client.release();
    }
});

// GET /api/inventory/audit
app.get('/api/inventory/audit', async (req, res) => {
    const { period_id, limit } = req.query;
    let sql = 'SELECT * FROM inventory_period_audit';
    const params = [];
    
    if (period_id) {
        sql += ' WHERE period_id = ?';
        params.push(period_id);
    }
    
    sql += ' ORDER BY timestamp DESC';
    
    if (limit) {
        sql += ' LIMIT ?';
        params.push(parseInt(limit));
    }
    
    try {
        const result = await db.query(sql, params);
        res.json(result);
    } catch (e) {
        res.json({ ok: false, error: e.message });
    }
});

// POST /api/inventory/close
// Finalizes a reconciliation period: creates snapshots, adjustment transactions,
// updates product stocks, and locks the period.
app.post('/api/inventory/close', async (req, res) => {
    const { period_id, closed_by, closed_reason, manager_override } = req.body;
    if (!period_id || !closed_by) {
        return res.status(400).json({ ok: false, error: 'Period ID and closed_by required' });
    }

    const client = await db.pool.connect();
    try {
        // Validate period
        const periodRes = await client.query('SELECT * FROM inventory_periods WHERE id = ?', [period_id]);
        if (!periodRes.rows || periodRes.rows.length === 0) {
            return res.status(404).json({ ok: false, error: 'Period not found' });
        }
        const period = periodRes.rows[0];
        if (period.is_locked) {
            return res.status(403).json({ ok: false, error: 'Period already locked' });
        }
        if (period.status !== 'reconciling') {
            return res.status(403).json({ ok: false, error: `Period must be in 'reconciling' state, current: ${period.status}` });
        }

        // Zero-capture detection: if period has no receipt transactions, require override
        const txCountRes = await client.query(
            `SELECT COUNT(*) as cnt FROM inventory_transactions WHERE period_id = ? AND transaction_type IN ('purchase', 'grv')`,
            [period_id]
        );
        const txCount = (txCountRes.rows && txCountRes.rows[0] && Number(txCountRes.rows[0].cnt)) || 0;
        if (txCount === 0 && !manager_override) {
            return res.status(403).json({ ok: false, error: 'ZERO_CAPTURE', message: 'Period has no inventory receipts. Manager override required to close.' });
        }

        await client.query('BEGIN');

        // 1. Get all products that have a physical count for this period (via last_inventory_period_id)
        // Note: batch-reconcile updates last_inventory_period_id; savePhysicalCounts also does.
        const prodRes = await client.query(
            `SELECT id, name, department, stock_level, cost_price, last_physical_qty
             FROM products
             WHERE last_inventory_period_id = ?`,
            [period_id]
        );
        if (!prodRes.rows || prodRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ ok: false, error: 'No physical counts recorded for this period. Perform a stock take before closing.' });
        }
        const products = prodRes.rows;

        let totalClosingValue = 0;
        let totalVarianceValue = 0;
        let kitchenVarianceValue = 0;
        let cellarVarianceValue = 0;

        // 2. Process each product: create snapshot, create adjustment transaction, update stock
        for (const p of products) {
            const physQty = Number(p.last_physical_qty || 0);
            const bookQty = Number(p.stock_level || 0);
            const costPrice = Number(p.cost_price || 0);

            const variance = physQty - bookQty;
            const varianceValue = variance * costPrice;
            const physValue = physQty * costPrice;

            totalClosingValue += physValue;
            totalVarianceValue += varianceValue;
            if ((p.department || '').toLowerCase() === 'kitchen') kitchenVarianceValue += varianceValue;
            else if ((p.department || '').toLowerCase() === 'cellar') cellarVarianceValue += varianceValue;

            // Fetch opening/received/usage aggregates for snapshot
            const agg = await client.query(
                `SELECT
                  COALESCE(SUM(CASE WHEN type = 'opening_balance' THEN quantity ELSE 0 END),0) as opening_qty,
                  COALESCE(SUM(CASE WHEN type IN ('purchase','grv') THEN quantity ELSE 0 END),0) as received_qty,
                  COALESCE(SUM(CASE WHEN type = 'usage' THEN quantity ELSE 0 END),0) as usage_qty
                 FROM inventory_transactions
                 WHERE period_id = ? AND product_id = ?`,
                [period_id, p.id]
            );
            const openingQty = Number(agg.rows[0].opening_qty);
            const receivedQty = Number(agg.rows[0].received_qty);
            const usageQty = Number(agg.rows[0].usage_qty);

            // Upsert snapshot
            await client.query(
                `INSERT INTO inventory_snapshots (period_id, product_id, physical_qty, variance, opening_qty, received_qty, system_usage_qty)
                 VALUES (?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT (period_id, product_id) DO UPDATE SET
                   physical_qty = EXCLUDED.physical_qty,
                   variance = EXCLUDED.variance,
                   opening_qty = EXCLUDED.opening_qty,
                   received_qty = EXCLUDED.received_qty,
                   system_usage_qty = EXCLUDED.system_usage_qty,
                   updated_at = NOW()`,
                [period_id, p.id, physQty, variance, openingQty, receivedQty, usageQty]
            );

            // Create adjustment transaction if variance non-zero
            if (variance !== 0) {
                await client.query(
                    `INSERT INTO inventory_transactions
                     (transaction_type, transaction_number, period_id, transaction_date, department, total_quantity, total_value, created_by)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    ['adjustment', `CLS-${Date.now()}-${p.id.slice(0,8)}`, period_id, new Date().toISOString().split('T')[0],
                     p.department, variance, varianceValue, closed_by]
                );
            }

            // Update product stock to physical count
            await client.query(
                `UPDATE products SET stock_level = ?, updated_at = NOW() WHERE id = ?`,
                [physQty, p.id]
            );
        }

        // 3. Compute COGS and update period
        const openingStock = Number(period.opening_stock_value || 0);
        const receivedValue = Number(period.received_value || 0);
        const cogsValue = openingStock + receivedValue - totalClosingValue;

        await client.query(
            `UPDATE inventory_periods
             SET status = 'closed',
                 closing_stock_value = ?,
                 variance_value = ?,
                 cogs_value = ?,
                 kitchen_cogs = ?,
                 cellar_cogs = ?,
                 closed_at = NOW(),
                 closed_by = ?,
                 closed_reason = ?,
                 is_locked = true,
                 locked_at = NOW()
             WHERE id = ?`,
            [totalClosingValue, totalVarianceValue, cogsValue, kitchenVarianceValue, cellarVarianceValue, closed_by, closed_reason, period_id]
        );

        // 4. If zero-capture override, audit log
        if (txCount === 0 && manager_override) {
            await client.query(
                `INSERT INTO inventory_period_audit (period_id, action, user_id, user_name, change_reason)
                 VALUES (?, 'ZERO_CAPTURE_OVERRIDE', ?, ?, ?)`,
                [period_id, closed_by, closed_by, 'Manager override: closed period with zero receipts']
            );
        }

        await client.query('COMMIT');

        res.json({ ok: true, message: 'Period closed successfully', closing_stock_value: totalClosingValue, variance_value: totalVarianceValue, cogs_value: cogsValue });
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('Close period error:', e);
        res.json({ ok: false, error: e.message });
    } finally {
        client.release();
    }
});

// POST /api/inventory/reopen
app.post('/api/inventory/reopen', async (req, res) => {
    const { period_id, reopened_by } = req.body;
    if (!period_id) {
        return res.status(400).json({ ok: false, error: 'Period ID required' });
    }
    try {
        const periodRes = await db.query('SELECT * FROM inventory_periods WHERE id = ?', [period_id]);
        if (!periodRes.rows || periodRes.rows.length === 0) {
            return res.status(404).json({ ok: false, error: 'Period not found' });
        }
        const period = periodRes.rows[0];
        // Only locked/closed periods can be reopened
        if (!period.is_locked) {
            return res.status(400).json({ ok: false, error: 'Period is not locked and cannot be reopened' });
        }

        const result = await db.query(
            `UPDATE inventory_periods 
             SET status = 'open', 
                 closed_at = NULL, closed_by = NULL, closed_reason = NULL,
                 is_locked = false, locked_at = NULL, locked_by = NULL,
                 reopened_at = NOW(), reopened_by = ?
             WHERE id = ?`,
            [reopened_by, period_id]
        );
        
        // Audit log for reopen
        await db.query(
            `INSERT INTO inventory_period_audit (period_id, action, user_id, user_name, change_reason)
             VALUES (?, 'PERIOD_REOPENED', ?, ?, ?)`,
            [period_id, reopened_by, reopened_by, 'Period reopened for correction']
        );
        
        res.json({ ok: true, message: 'Period reopened successfully', result });
    } catch (e) {
        res.json({ ok: false, error: e.message });
    }
});

// ============================================================================
// REPORTS API ENDPOINTS
// ============================================================================

// GET /api/reports/flash - Flash report for a specific date
app.get('/api/reports/flash', async (req, res) => {
    const { date } = req.query;
    try {
        const result = await db.query(
            `SELECT * FROM night_audit_runs WHERE business_date = $1`,
            [date]
        );
        if (result.rows && result.rows.length > 0) {
            res.json({ 
                ok: true, 
                data: result.rows[0].reports_snapshot,
                business_date: result.rows[0].business_date,
                room_revenue: result.rows[0].room_revenue,
                total_revenue: result.rows[0].total_revenue,
                occupancy_percent: result.rows[0].occupancy_percent,
                adr: result.rows[0].adr,
                revpar: result.rows[0].revpar
            });
        } else {
            res.json({ ok: false, error: 'No data for specified date' });
        }
    } catch (e) {
        res.json({ ok: false, error: e.message });
    }
});

// GET /api/reports/pos-recon - POS reconciliation for a date
app.get('/api/reports/pos-recon', async (req, res) => {
    const { date } = req.query;
    try {
        const result = await db.query(
            `SELECT * FROM pos_shifts WHERE business_date = $1 AND status = 'closed'`,
            [date]
        );
        res.json({ ok: true, rows: result.rows || [] });
    } catch (e) {
        res.json({ ok: false, error: e.message });
    }
});

// GET /api/reports/pl - Monthly P&L
app.get('/api/reports/pl', async (req, res) => {
    const { month } = req.query;
    try {
        const [year, monthNum] = month.split('-');
        const startDate = `${year}-${monthNum}-01`;
        const endDate = new Date(year, parseInt(monthNum), 0).toISOString().slice(0, 10);
        
        const result = await db.query(
            `SELECT 
                SUM(room_revenue) as room_revenue,
                SUM(total_revenue) as total_revenue,
                SUM(occupancy_percent) as occupancy,
                AVG(adr) as adr,
                AVG(revpar) as revpar
            FROM night_audit_runs 
            WHERE business_date >= $1 AND business_date <= $2`,
            [startDate, endDate]
        );
        res.json({ ok: true, data: result.rows[0] });
    } catch (e) {
        res.json({ ok: false, error: e.message });
    }
});

// GET /api/reports/aged-ar - Aged AR report
app.get('/api/reports/aged-ar', async (req, res) => {
    const { date } = req.query;
    try {
        const result = await db.query(
            `SELECT * FROM city_ledger_transactions WHERE transaction_date <= $1`,
            [date]
        );
        res.json({ ok: true, rows: result.rows || [] });
    } catch (e) {
        res.json({ ok: false, error: e.message });
    }
});

// GET /api/reports/inventory-cogs - Monthly inventory COGS
app.get('/api/reports/inventory-cogs', async (req, res) => {
    const { month } = req.query;
    res.json({ ok: true, rows: [] }); // Placeholder - integrate with inventory module
});

// GET /api/reports/night-audit-runs - Get all night audit runs for date range
app.get('/api/reports/night-audit-runs', async (req, res) => {
    const { start_date, end_date } = req.query;
    try {
        const result = await db.query(
            `SELECT * FROM night_audit_runs WHERE business_date >= $1 AND business_date <= $2 ORDER BY business_date DESC`,
            [start_date, end_date]
        );
        res.json({ ok: true, rows: result.rows || [] });
    } catch (e) {
        res.json({ ok: false, error: e.message });
    }
});

// POST /api/reports/load-historical - Load historical night audit data into localStorage
app.post('/api/reports/load-historical', async (req, res) => {
    const { days_back } = req.body;
    try {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - (days_back || 30));
        
        const result = await db.query(
            `SELECT * FROM night_audit_runs WHERE business_date >= $1 ORDER BY business_date DESC`,
            [startDate.toISOString().slice(0, 10)]
        );
        
        const reports = {};
        for (const row of result.rows || []) {
            const date = row.business_date;
            reports[`corepms_nightAudit_reports_${date}`] = row.reports_snapshot;
            reports[`corepms_nightAudit_reports_${date}`] = {
                date,
                roomRevenue: row.room_revenue,
                fbRevenue: row.total_revenue - row.room_revenue,
                totalRevenue: row.total_revenue,
                occupancy: row.occupancy_percent,
                avgDailyRate: row.adr,
                revPAR: row.revpar
            };
        }
        
        res.json({ ok: true, loaded_dates: Object.keys(reports), count: result.rows?.length || 0 });
    } catch (e) {
        res.json({ ok: false, error: e.message });
    }
});

// Price Management routes (with WebSocket real-time sync)
try {
  const pricesRoutes = require('./routes/prices.cjs');
  console.log('💰 Registering price routes at /api/v1/prices');
  app.use('/api/v1/prices', pricesRoutes);
} catch (error) {
  console.error('❌ Failed to load price routes:', error.message);
}

// Temporary: Add the inventory routes
try {
  const inventoryV11Routes = require('./routes/inventory-v11.cjs');
  console.log('📦 Registering inventory routes at /api/v1/inventory');
  app.use('/api/v1/inventory', inventoryV11Routes);
} catch (error) {
  console.error('❌ Failed to load inventory routes:', error.message);
}

// System / Maintenance routes
try {
  const systemRoutes = require('./routes/system.cjs');
  console.log('🛠️ Registering system routes at /api/system');
  app.use('/api/system', systemRoutes);
} catch (error) {
  console.error('❌ Failed to load system routes:', error.message);
}

// Night Audit API + SSE routes
try {
  const { router: nightAuditRoutes } = require('./routes/nightAuditApi.cjs');
  console.log('🌙 Registering night audit routes at /api/night-audit');
  app.use('/api/night-audit', nightAuditRoutes);
} catch (error) {
  console.error('❌ Failed to load night audit routes:', error.message);
}

// Catch-all handler: serve React app for client-side routing
app.use((req, res, next) => {
  // Skip API routes
  if (req.path.startsWith('/api/')) {
    return next();
  }
  res.sendFile(path.join(__dirname, '..', 'dist', 'index.html'));
});

// Start Server
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT} (listening on all interfaces)`);
    console.log(`📊 Database URL: ${process.env.DATABASE_URL ? 'Configured' : 'Missing (Check .env)'}`);
    console.log(`🌐 Server ready at http://localhost:${PORT}`);

    // Bootstrap: ensure system_configs has business_date and schedule entries,
    // then start the nightly scheduler
    const runner = require('./services/nightAuditRunner.cjs');
    const dbMod  = require('./db-web.cjs');

    (async () => {
      // ── Auto-create critical POS/FO tables if absent ────────────────────────
      await dbMod.query(`
        CREATE TABLE IF NOT EXISTS table_status (
          table_id    TEXT PRIMARY KEY,
          status      TEXT NOT NULL DEFAULT 'open',
          last_update TIMESTAMPTZ DEFAULT NOW(),
          cost_center TEXT
        )
      `);
      // Seed 12 default tables if none exist
      const tblCheck = await dbMod.query(`SELECT COUNT(*) as c FROM table_status`);
      if (tblCheck.ok && Number(tblCheck.rows[0]?.c) === 0) {
        const inserts = Array.from({ length: 12 }, (_, i) =>
          `INSERT INTO table_status (table_id, status) VALUES ('t${i+1}', 'open') ON CONFLICT DO NOTHING`
        );
        for (const sql of inserts) await dbMod.query(sql);
        console.log('🪑 Seeded 12 default POS tables');
      }

      await dbMod.query(`
        ALTER TABLE products
          ADD COLUMN IF NOT EXISTS bar_visibility        BOOLEAN DEFAULT true,
          ADD COLUMN IF NOT EXISTS restaurant_visibility BOOLEAN DEFAULT true
      `);

      // Auto-create system_configs rows if absent
      await dbMod.query(`
        INSERT INTO system_configs (key, value, description, updated_at, updated_by)
        VALUES
          ('night_audit_schedule',
           '{"enabled":true,"hour":21,"minute":0,"timezone":"Africa/Harare"}'::jsonb,
           'Auto night audit schedule', NOW(), 'system'),
          ('night_audit_lock',
           '{"locked":false}'::jsonb,
           'Night audit system lock', NOW(), 'system'),
          ('business_date',
           json_build_object('date', to_char(CURRENT_DATE,'YYYY-MM-DD'), 'rolled_at', NOW()::text)::jsonb,
           'Current hotel business date', NOW(), 'system')
        ON CONFLICT (key) DO NOTHING
      `);

      const schedule = await runner.getSystemConfig('night_audit_schedule',
        { enabled: true, hour: 21, minute: 0, timezone: 'Africa/Harare' });
      if (schedule.enabled !== false) {
        runner.startScheduler(schedule.hour, schedule.minute, schedule.timezone);
        console.log(`⏰ Night audit scheduler active — runs at ${String(schedule.hour).padStart(2,'0')}:${String(schedule.minute).padStart(2,'0')} ${schedule.timezone}`);
      }
    })().catch(console.error);
});

server.on('error', (error) => {
    console.error('❌ Server error:', error);
});

server.on('connection', (socket) => {
    console.log('📡 New connection established');
});
