const express = require('express');
const router = express.Router();
const db = require('../db-web.cjs');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * GET /api/system/db-export
 * Triggers a database export and returns a .sql file
 */
router.get('/db-export', async (req, res) => {
    try {
        console.log('📦 Starting database export...');

        // 1. Identify all tables
        const tablesRes = await db.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        `);

        if (!tablesRes.ok) {
            throw new Error('Failed to fetch tables: ' + tablesRes.error);
        }

        const tables = tablesRes.rows.map(r => r.table_name);
        let sqlDump = `-- COREPMS Database Export\n-- Generated at: ${new Date().toISOString()}\n\n`;

        // Add schema setup
        sqlDump += `SET statement_timeout = 0;\nSET lock_timeout = 0;\nSET idle_in_transaction_session_timeout = 0;\nSET client_encoding = 'UTF8';\nSET standard_conforming_strings = on;\nSELECT pg_catalog.set_config('search_path', '', false);\nSET check_function_bodies = false;\nSET xmloption = content;\nSET client_min_messages = warning;\nSET row_security = off;\n\n`;

        for (const table of tables) {
            sqlDump += `\n-- Data for table: ${table}\n`;
            
            // Get data
            const dataRes = await db.query(`SELECT * FROM "${table}"`);
            if (dataRes.ok && dataRes.rows.length > 0) {
                const rows = dataRes.rows;
                const columns = Object.keys(rows[0]);
                
                // Chunk inserts to avoid massive strings
                const chunkSize = 100;
                for (let i = 0; i < rows.length; i += chunkSize) {
                    const chunk = rows.slice(i, i + chunkSize);
                    
                    const valuesList = chunk.map(row => {
                        const vals = columns.map(col => {
                            const val = row[col];
                            if (val === null) return 'NULL';
                            if (typeof val === 'number') return val;
                            if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
                            if (val instanceof Date) return `'${val.toISOString()}'`;
                            if (typeof val === 'object') return `'${JSON.stringify(val).replace(/'/g, "''")}'`;
                            return `'${String(val).replace(/'/g, "''")}'`;
                        });
                        return `(${vals.join(', ')})`;
                    });

                    sqlDump += `INSERT INTO "${table}" ("${columns.join('", "')}") VALUES\n${valuesList.join(',\n')};\n`;
                }
            } else if (!dataRes.ok) {
                console.warn(`⚠️ Could not export data for table ${table}:`, dataRes.error);
                sqlDump += `-- Error exporting data for ${table}: ${dataRes.error}\n`;
            }
        }

        // Set headers for download
        const filename = `corepms_dump_${new Date().toISOString().slice(0, 10)}.sql`;
        res.setHeader('Content-Type', 'application/sql');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(sqlDump);

    } catch (error) {
        console.error('❌ Export failed:', error);
        res.status(500).json({ ok: false, error: error.message });
    }
});

module.exports = router;
