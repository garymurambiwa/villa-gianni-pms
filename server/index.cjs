const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const db = require('./db-web.cjs');

// Load environment variables
try { require('dotenv').config({ path: path.join(__dirname, '..', '.env') }) } catch { }

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' })); // Large limit for potential data syncs

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


// 2. Serve Static Assets (Frontend)
// Serve dist folder
const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath));

// Handle Client-Side Routing: Return index.html for all other routes
app.get(/.* /, (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
});

// Start Server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Database URL: ${process.env.DATABASE_URL ? 'Configured' : 'Missing (Check .env)'}`);
});
