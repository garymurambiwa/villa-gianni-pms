// Web-only DB helper connecting via backend API
// All DB access goes through Express endpoints to avoid exposing credentials
import { networkStatus } from './networkStatus';
import { offlineCache } from './offlineCache';
import { fetchApi } from './apiService';

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
       const data = await fetchApi('/api/db/test', { method: 'POST' });
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
       const data = await fetchApi('/api/db/query', {
         method: 'POST',
         body: JSON.stringify({ sql, params })
       });

       // Guard: if server returns HTML instead of JSON (404/503 page), return a clean error
       // instead of letting JSON.parse throw "Unexpected token 'T', 'The page c...'"
       if (!data || typeof data !== 'object') {
         console.warn('[DB-API] Non-JSON response from /api/db/query');
         return { error: 'API unavailable (Non-JSON response)' } as any;
       }

       if (data.error) {
         return { error: data.error || 'Database query failed', rows: [], rowCount: 0 } as any;
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
       console.warn('[DB-API-Error]', e.message?.substring(0, 100));
       return { error: e.message || 'Network error', rows: [], rowCount: 0 } as any;
     }
   },

   async exec(sql: string): Promise<ExecResult> {
     try {
       const data = await fetchApi('/api/db/exec', {
         method: 'POST',
         body: JSON.stringify({ sql })
       });
       return data as ExecResult;
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
       const data = await fetchApi('/api/db/transaction', {
         method: 'POST',
         body: JSON.stringify({ operations: normalized })
       });
       return data as ExecResult;
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
