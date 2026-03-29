// Web-only DB helper connecting to Neon (Serverless)
import { Pool, neonConfig } from '@neondatabase/serverless';
import { offlineCache } from './offlineCache';
import { networkStatus } from './networkStatus';
import { offlineSync } from './offlineSync';

// Default connection for browser users (Neon with WebSocket support)
// Use only the environment variable; no fallback to avoid cross-environment data leakage
const BROWSER_DSN = import.meta.env.VITE_DATABASE_URL as string;

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

// Extract table name from SQL statement
function extractTableName(sql: string): string {
  const match = sql.match(/(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+[`']?([\w]+)[`']?/i);
  return match ? match[1] : 'unknown';
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
    return !!BROWSER_DSN;
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
    const isLocal = BROWSER_DSN?.includes('localhost');
    if (isLocal) {
      try {
        const res = await fetch('/api/db/query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sql, params })
        });
        const data = await res.json();
        return data as QueryResult<Row>;
      } catch (e: any) {
        console.error(`[DB-Bridge-Error] ${e.message}`, sql);
        return { error: e.message };
      }
    }

    // Check if this is a write operation (INSERT, UPDATE, DELETE)
    const isWriteOperation = /^\s*(INSERT|UPDATE|DELETE)/i.test(sql);

    // If offline and this is a write operation, queue it
    if (isWriteOperation && networkStatus.isOffline()) {
      console.log('[DB-Web] Offline detected, queuing write operation:', sql);

      try {
        await offlineCache.queueOperation({
          type: sql.trim().split(/\s+/)[0].toUpperCase() as 'INSERT' | 'UPDATE' | 'DELETE',
          table: extractTableName(sql),
          sql,
          params,
          metadata: { queuedAt: Date.now() }
        });

        // Return optimistic response
        return { rows: [], rowCount: 0 };
      } catch (e: any) {
        console.error('[DB-Web] Failed to queue operation:', e);
        return { error: e.message };
      }
    }

    const pgSql = convertPlaceholders(sql);
    try {
      const pool = await getBrowserPool();
      const res = await Promise.race([
        pool.query(pgSql, params),
        new Promise((_, reject) => setTimeout(() => reject(new Error('DB connection timeout. Please check your network or VITE_DATABASE_URL.')), 15000))
      ]) as any;
      return { rows: res.rows, rowCount: res.rowCount || 0 };
    } catch (e: any) {
      console.error(`[DB-Web-Error] ${e.message}`, sql);

      // If this is a write operation and we get a timeout, queue it
      if (isWriteOperation && e.message.includes('timeout')) {
        console.log('[DB-Web] Timeout detected, queuing write operation:', sql);

        try {
          await offlineCache.queueOperation({
            type: sql.trim().split(/\s+/)[0].toUpperCase() as 'INSERT' | 'UPDATE' | 'DELETE',
            table: extractTableName(sql),
            sql,
            params,
            metadata: { queuedAt: Date.now(), error: e.message }
          });

          // Return optimistic response
          return { rows: [], rowCount: 0 };
        } catch (queueError: any) {
          console.error('[DB-Web] Failed to queue operation:', queueError);
          return { error: e.message };
        }
      }

      return { error: e.message };
    }
  },



  async exec(sql: string, actorUserId?: string): Promise<ExecResult> {
    const isLocal = BROWSER_DSN?.includes('localhost');
    if (isLocal) {
      try {
        const res = await fetch('/api/db/exec', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sql })
        });
        return await res.json() as ExecResult;
      } catch (e: any) { return { ok: false, error: e.message } }
    }

    try {
      const pool = await getBrowserPool();
      await Promise.race([
        pool.query(convertPlaceholders(sql)),
        new Promise((_, reject) => setTimeout(() => reject(new Error('DB connection timeout')), 15000))
      ]);
      return { ok: true };
    } catch (e: any) { return { ok: false, error: e.message } }
  },

  async transaction(operations: (string | { sql: string; params?: any[] })[], actorUserId?: string): Promise<ExecResult> {
    const isLocal = BROWSER_DSN?.includes('localhost');
    if (isLocal) {
      try {
        const res = await fetch('/api/db/transaction', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ operations })
        });
        return await res.json() as ExecResult;
      } catch (e: any) { return { ok: false, error: e.message } }
    }

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
