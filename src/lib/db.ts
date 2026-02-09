// Web-only DB helper connecting to Neon (Serverless)
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

// Convert MySQL-style ? placeholders to PostgreSQL $1, $2, etc.
function convertPlaceholders(sql: string): string {
  let idx = 0;
  return sql.replace(/\?/g, () => `$${++idx}`);
}

// Browser-side Pool Singleton
let browserPool: Pool | null = null;

async function getBrowserPool() {
  if (browserPool) return browserPool;

  // Configure Neon to use direct WebSockets
  // [FIX] Explicitly set WebSocket constructor for browsers that don't auto-detect it
  if (typeof WebSocket !== 'undefined') {
    neonConfig.webSocketConstructor = WebSocket;
  }

  // Ensure we use secure connection (WSS)
  neonConfig.useSecureWebSocket = true;
  neonConfig.pipelineTLS = true;
  neonConfig.pipelineConnect = 'password';

  browserPool = new Pool({ connectionString: BROWSER_DSN });
  return browserPool;
}

export const db = {
  // Mock readiness check for web
  async waitForReady(): Promise<boolean> {
    return true;
  },

  async getConnectionString(): Promise<string> {
    return BROWSER_DSN;
  },

  async getConnectionConfig(): Promise<DbConfig | null> {
    return null; // Not exposed in browser for security
  },

  async isConfigured(): Promise<boolean> {
    return true;
  },

  async setConnectionString(conn: string): Promise<ExecResult> {
    return { ok: false, error: 'Cannot set DB connection from web client.' }
  },

  async saveConnectionConfig(config: DbConfig): Promise<ExecResult> {
    return { ok: false, error: 'Native DB bridge unavailable' };
  },

  async testConnection(config?: DbConfig): Promise<{ ok: boolean; serverVersion?: string; error?: string }> {
    try {
      const pool = await getBrowserPool();
      const res = await pool.query('SELECT version()');
      return { ok: true, serverVersion: res.rows[0].version };
    } catch (e: any) { return { ok: false, error: e.message } }
  },

  async query<Row = any>(sql: string, params: any[] = []): Promise<QueryResult<Row>> {
    const pgSql = convertPlaceholders(sql);
    try {
      const pool = await getBrowserPool();
      const res = await pool.query(pgSql, params);
      return { rows: res.rows, rowCount: res.rowCount || 0 };
    } catch (e: any) {
      console.error(`[DB-Web-Error] ${e.message}`, sql);
      return { error: e.message };
    }
  },

  async exec(sql: string, actorUserId?: string): Promise<ExecResult> {
    try {
      const pool = await getBrowserPool();
      await pool.query(convertPlaceholders(sql));
      return { ok: true };
    } catch (e: any) { return { ok: false, error: e.message } }
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
  },

  async exportSqlDump(options?: { outFile?: string; actorUserId?: string }): Promise<{ ok: boolean; path?: string; error?: string; warning?: string }> {
    return { ok: false, error: 'Export not supported in Browser Mode' }
  }
}

export default db
