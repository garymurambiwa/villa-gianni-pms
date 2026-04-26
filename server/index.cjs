const express = require('express');
const cors = require('cors');
const path = require('path');

// Load database module
const db = require('./db-web.cjs');

// Load environment variables
try { require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') }) } catch { }

const app = express();
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
    const allowedFields = ['period_name', 'status', 'closing_stock_value', 'variance_value', 'cogs_value', 'kitchen_cogs', 'cellar_cogs', 'closed_by', 'closed_reason'];
    
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
        const result = await db.query(
            `INSERT INTO inventory_transactions (transaction_type, transaction_number, period_id, transaction_date, department, total_quantity, total_value, supplier_name, created_by, is_historical_backfill)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [transaction_type, transaction_number, period_id, transaction_date, department, total_quantity || 0, total_value || 0, supplier_name, created_by, is_historical_backfill || false]
        );
        res.json(result);
    } catch (e) {
        res.json({ ok: false, error: e.message });
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
app.post('/api/inventory/close', async (req, res) => {
    const { period_id, closing_stock_value, variance_value, cogs_value, kitchen_cogs, cellar_cogs, closed_by, closed_reason } = req.body;
    if (!period_id) {
        return res.status(400).json({ ok: false, error: 'Period ID required' });
    }
    try {
        const periodRes = await db.query('SELECT * FROM inventory_periods WHERE id = ?', [period_id]);
        if (!periodRes.rows || periodRes.rows.length === 0) {
            return res.status(404).json({ ok: false, error: 'Period not found' });
        }
        
        const result = await db.query(
            `UPDATE inventory_periods 
             SET status = 'closed', closing_stock_value = ?, variance_value = ?, cogs_value = ?, kitchen_cogs = ?, cellar_cogs = ?, closed_at = NOW(), closed_by = ?, closed_reason = ?, is_locked = true, locked_at = NOW()
             WHERE id = ?`,
            [closing_stock_value, variance_value, cogs_value, kitchen_cogs, cellar_cogs, closed_by, closed_reason, period_id]
        );
        res.json(result);
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
});

server.on('error', (error) => {
    console.error('❌ Server error:', error);
});

server.on('connection', (socket) => {
    console.log('📡 New connection established');
});
