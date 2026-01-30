const pg = require('pg');

let pgPool = null;

async function getPgPool(config) {
    if (pgPool) return pgPool;
    // Use environment variable or config object
    const connectionString = process.env.DATABASE_URL || config;

    if (!connectionString) {
        throw new Error('DATABASE_URL environment variable is not set');
    }

    // Create pool
    const poolConfig = {
        connectionString: connectionString,
        connectionTimeoutMillis: 90000,
        // SSL required for most cloud Postgres providers (except local)
        ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: false }
    };

    pgPool = new pg.Pool(poolConfig);

    // Setup error listener
    pgPool.on('error', (err, client) => {
        console.error('Unexpected error on idle client', err);
        // Don't exit, just log
    });

    return pgPool;
}

// Retry helper
async function withRetry(fn, retries = 3, delay = 1000) {
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (e) {
            if (i === retries - 1) throw e;
            const isNetworkError = e.code === 'PROTOCOL_CONNECTION_LOST' || e.code === 'ECONNRESET' || e.code === 'ETIMEDOUT';
            if (!isNetworkError && !e.message.includes('deadlock')) throw e;
            await new Promise(res => setTimeout(res, delay));
        }
    }
}

module.exports = {
    async query(sql, params) {
        try {
            const pool = await getPgPool();
            const res = await withRetry(() => pool.query(sql, params));
            return { ok: true, rows: res.rows || [], rowCount: res.rowCount || 0 };
        } catch (e) {
            console.error('DB Query Error:', e.message);
            return { ok: false, error: e.message, rows: [], rowCount: 0 };
        }
    },

    async exec(sql) {
        try {
            const pool = await getPgPool();
            await withRetry(() => pool.query(sql));
            return { ok: true };
        } catch (e) {
            console.error('DB Exec Error:', e.message);
            return { ok: false, error: e.message };
        }
    },

    async transaction(operations) {
        let client = null;
        try {
            const pool = await getPgPool();
            client = await pool.connect();

            try {
                await client.query('BEGIN');

                const results = [];
                for (const op of operations) {
                    // op is { sql: string, params?: any[] }
                    const res = await client.query(op.sql, op.params || []);
                    results.push({ rows: res.rows, rowCount: res.rowCount });
                }

                await client.query('COMMIT');
                return { ok: true, results };
            } catch (e) {
                await client.query('ROLLBACK');
                throw e;
            }
        } catch (e) {
            console.error('DB Transaction Error:', e.message);
            return { ok: false, error: e.message };
        } finally {
            if (client) client.release();
        }
    }
};
