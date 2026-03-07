/**
 * api/db.cjs  —  Vercel Serverless Function
 *
 * This module wraps the Express app as a Vercel serverless handler.
 * Vercel routes POST /api/db/query, /api/db/exec, etc. here via vercel.json rewrites.
 */

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const db = require('../server/db-web.cjs');

const app = express();

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));

// ─── Database API Endpoints ───────────────────────────────────────────────────

// POST /api/db/query
app.post('/api/db/query', async (req, res) => {
    const { sql, params } = req.body;
    if (!sql) return res.status(400).json({ ok: false, error: 'SQL required' });
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

// POST /api/db/test
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

// GET /api/setup/init-db?key=confirm  (emergency schema init from browser)
app.get('/api/setup/init-db', async (req, res) => {
    const { key, reset } = req.query;
    if (key !== 'confirm') {
        return res.status(400).send('<h1>Missing confirmation</h1><p>Use <code>?key=confirm</code> to init.</p>');
    }
    try {
        const fs = require('fs');
        const schemaPath = path.join(__dirname, '..', 'db', 'schema.sql');
        if (!fs.existsSync(schemaPath)) return res.status(500).send('Schema file missing');
        const sql = fs.readFileSync(schemaPath, 'utf8');
        if (reset === 'true') {
            await db.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO public;');
        }
        const result = await db.exec(sql);
        if (result.ok) {
            res.send('<h1>✅ Database Initialized Successfully!</h1>');
        } else {
            res.status(500).send(`<h1>❌ Error</h1><pre>${result.error}</pre>`);
        }
    } catch (e) {
        res.status(500).send(`<h1>❌ Exception</h1><pre>${e.message}</pre>`);
    }
});

// ─── Serverless Export (required by Vercel) ───────────────────────────────────
module.exports = app;
