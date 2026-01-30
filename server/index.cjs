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
