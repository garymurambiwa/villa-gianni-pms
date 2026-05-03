// Web-only DB helper connecting via backend API
// All DB access goes through Express endpoints to avoid exposing credentials
import { networkStatus } from './networkStatus';
import { offlineCache } from './offlineCache';

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

// Extract table name from SQL statement
function extractTableName(sql: string): string {
  const match = sql.match(/(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+[`'"]?([\w]+)[`'"]?/i);
  return match ? match[1] : 'unknown';
}

export const db = {
  async waitForReady(): Promise<boolean> {
    // Always ready; backend presumed up.
    return true;
  },

  async getConnectionString(): Promise<string> {
    // Not exposed to client
    return 'server-side-only';
  },

  async getConnectionConfig(): Promise<DbConfig | null> {
    return null;
  },

  async isConfigured(): Promise<boolean> {
    // Assume configured if env var exists (even though not used locally)
    return !!(import.meta.env.VITE_DATABASE_URL);
  },

  async setConnectionString(_conn: string): Promise<ExecResult> {
    return { ok: false, error: 'Cannot set DB connection from web client.' };
  },

  async saveConnectionConfig(_config: DbConfig): Promise<ExecResult> {
    return { ok: false, error: 'Native DB bridge unavailable' };
  },

  async testConnection(): Promise<{ ok: boolean; serverVersion?: string; error?: string }> {
    try {
      const res = await fetch('/api/db/test', { method: 'POST' });
      const data = await res.json();
      if (data.ok) return { ok: true, serverVersion: data.serverVersion };
      return { ok: false, error: data.error || 'Test failed' };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  },

  async query<Row = any>(sql: string, params: any[] = []): Promise<QueryResult<Row>> {
    const isWrite = /^\s*(INSERT|UPDATE|DELETE)/i.test(sql);

    // Offline queue for writes
    if (isWrite && networkStatus.isOffline()) {
      await offlineCache.queueOperation({
        type: (sql.match(/^\s*(\w+)/) || [''])[1].toUpperCase() as 'INSERT' | 'UPDATE' | 'DELETE',
        table: extractTableName(sql),
        sql,
        params,
        metadata: { queuedAt: Date.now() }
      });
      // Optimistic UI: empty result
      return { rows: [], rowCount: 0 };
    }

    try {
      const res = await fetch('/api/db/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql, params })
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || 'Database query failed');
      }
      return data as QueryResult<Row>;
    } catch (e: any) {
      // If network error and write, try to queue for later
      if (isWrite && networkStatus.isOffline()) {
        await offlineCache.queueOperation({
          type: (sql.match(/^\s*(\w+)/) || [''])[1].toUpperCase() as 'INSERT' | 'UPDATE' | 'DELETE',
          table: extractTableName(sql),
          sql,
          params,
          metadata: { queuedAt: Date.now(), error: e.message }
        });
        return { rows: [], rowCount: 0 };
      }
      console.error('[DB-API-Error]', e.message, sql);
      throw e;
    }
  },

  async exec(sql: string): Promise<ExecResult> {
    try {
      const res = await fetch('/api/db/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql })
      });
      const data = await res.json() as ExecResult;
      return data;
    } catch (e: any) {
      console.error('[DB-API-Error]', e.message, sql);
      return { ok: false, error: e.message };
    }
  },

  async transaction(operations: (string | { sql: string; params?: any[] })[]): Promise<ExecResult> {
    const normalized = operations.map(op => ({
      sql: typeof op === 'string' ? op : op.sql,
      params: typeof op === 'string' ? [] : (op.params || [])
    }));
    try {
      const res = await fetch('/api/db/transaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operations: normalized })
      });
      const data = await res.json() as ExecResult;
      return data;
    } catch (e: any) {
      console.error('[DB-API-Transaction-Error]', e.message);
      return { ok: false, error: e.message };
    }
  },

  async exportSqlDump(_options?: { outFile?: string; actorUserId?: string }): Promise<{ ok: boolean; path?: string; error?: string; warning?: string }> {
    return { ok: false, error: 'Export not supported in Browser Mode' };
  }
};

export default db;
