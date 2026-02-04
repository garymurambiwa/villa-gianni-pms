// Renderer-side DB helper that bridges to Electron main via window.native.db
// OR connects directly to Neon (Serverless) when running in a browser.
// Provides a unified interface for configuring the connection and running queries.

import { Pool, neonConfig } from '@neondatabase/serverless';

// Default connection for browser users (hardcoded to your Neon instance)
const BROWSER_DSN = 'postgresql://neondb_owner:npg_r1fvxIDGLNA8@ep-empty-smoke-ahhjh27q-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require';

type QueryResult<Row = any> = { rows: Row[]; rowCount: number } | { error: string }
type ExecResult = { ok: true } | { ok: false; error: string }

export interface DbConfig {
  type: 'postgres';
  host: string;
  port: number;
  user: string;
  password?: string;
  database: string;
  ssl?: boolean;
}

const hasNativeDb = () => typeof window !== 'undefined' && (window as any).native && (window as any).native.db

// Convert MySQL-style ? placeholders to PostgreSQL $1, $2, etc.
function convertPlaceholders(sql: string): string {
  let idx = 0;
  return sql.replace(/\?/g, () => `$${++idx}`);
}

// Browser-side Pool Singleton
let browserPool: Pool | null = null;

async function getBrowserPool() {
  if (browserPool) return browserPool;

  // Configure Neon to use direct WebSockets (no HTTP fetch needed)
  neonConfig.fetchConnectionCache = true;

  browserPool = new Pool({ connectionString: BROWSER_DSN });
  return browserPool;
}

export const db = {
  async waitForReady(retries = 5, delay = 1000): Promise<boolean> {
    if (!hasNativeDb()) {
      // In browser mode, we assume "ready" means we can instantiate the pool
      return true;
    }

    // Electron mode
    for (let i = 0; i < retries; i++) {
      try {
        const test = await (window as any).native.db.testConnection()
        if (test && test.ok) return true;
      } catch { }
      await new Promise(res => setTimeout(res, delay));
    }
    return false;
  },

  async getConnectionString(): Promise<string> {
    if (!hasNativeDb()) return BROWSER_DSN;
    const res = await (window as any).native.db.getConnectionString()
    return res?.connectionString || ''
  },

  async getConnectionConfig(): Promise<DbConfig | null> {
    if (!hasNativeDb()) return null; // Not exposed in browser for security
    return await (window as any).native.db.getConnectionConfig();
  },

  async isConfigured(): Promise<boolean> {
    if (!hasNativeDb()) return true;
    try {
      const conn = await this.getConnectionString()
      return !!conn
    } catch { return false }
  },

  async setConnectionString(conn: string): Promise<ExecResult> {
    if (!hasNativeDb()) return { ok: false, error: 'Cannot set DB connection from web client.' }
    const res = await (window as any).native.db.setConnectionString(conn)
    return res && typeof res.ok === 'boolean' ? res : { ok: false, error: 'Unknown error' }
  },

  async saveConnectionConfig(config: DbConfig): Promise<ExecResult> {
    if (!hasNativeDb()) return { ok: false, error: 'Native DB bridge unavailable' };
    return await (window as any).native.db.saveConnectionConfig(config);
  },

  async testConnection(config?: DbConfig): Promise<{ ok: boolean; serverVersion?: string; error?: string }> {
    if (!hasNativeDb()) {
      try {
        const pool = await getBrowserPool();
        const res = await pool.query('SELECT version()');
        return { ok: true, serverVersion: res.rows[0].version };
      } catch (e: any) { return { ok: false, error: e.message } }
    }
    return await (window as any).native.db.testConnection(config)
  },

  async query<Row = any>(sql: string, params: any[] = []): Promise<QueryResult<Row>> {
    const start = performance.now();
    const pgSql = convertPlaceholders(sql);

    // [WEB SUPPORT]: Direct Neon Connection
    if (!hasNativeDb()) {
      try {
        const pool = await getBrowserPool();
        const res = await pool.query(pgSql, params);
        return { rows: res.rows, rowCount: res.rowCount || 0 };
      } catch (e: any) {
        console.error(`[DB-Web-Error] ${e.message}`, sql);
        return { error: e.message };
      }
    }

    // Electron mode
    const ready = await this.waitForReady()
    if (!ready) return { error: 'Database initialization timed out' }

    try {
      const result = await (window as any).native.db.query(pgSql, params);
      const duration = performance.now() - start;
      if (duration > 500) console.warn(`[DB-Slow] ${duration.toFixed(0)}ms: ${sql.substring(0, 100)}...`);
      return result;
    } catch (e: any) {
      console.error(`[DB-Error] ${e.message}`, sql);
      return { error: e.message };
    }
  },

  async exec(sql: string, actorUserId?: string): Promise<ExecResult> {
    if (!hasNativeDb()) {
      try {
        const pool = await getBrowserPool();
        await pool.query(convertPlaceholders(sql));
        return { ok: true };
      } catch (e: any) { return { ok: false, error: e.message } }
    }
    const ready = await this.waitForReady()
    if (!ready) return { ok: false, error: 'Database initialization timed out' }
    return await (window as any).native.db.exec(sql, actorUserId)
  },

  async transaction(operations: (string | { sql: string; params?: any[] })[], actorUserId?: string): Promise<ExecResult> {
    const normalizedOps = operations.map(op => {
      if (typeof op === 'string') return { sql: op, params: [] };
      return { sql: op.sql, params: op.params || [] };
    });

    const pgOps = normalizedOps.map(op => ({
      sql: convertPlaceholders(op.sql),
      params: op.params
    }));

    // [WEB SUPPORT]: Transaction
    if (!hasNativeDb()) {
      const pool = await getBrowserPool();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const op of pgOps) {
          await client.query(op.sql, op.params);
        }
        await client.query('COMMIT');
        return { ok: true };
      } catch (e: any) {
        await client.query('ROLLBACK');
        return { ok: false, error: e.message };
      } finally {
        client.release();
      }
    }

    const ready = await this.waitForReady();
    if (!ready) return { ok: false, error: 'Database initialization timed out' };

    return await (window as any).native.db.transaction(pgOps);
  },

  async exportSqlDump(options?: { outFile?: string; actorUserId?: string }): Promise<{ ok: boolean; path?: string; error?: string; warning?: string }> {
    if (!hasNativeDb()) return { ok: false, error: 'Export not supported in Browser Mode' }
    return await (window as any).native.db.exportSqlDump(options || {})
  }
}

export default db
