// Renderer-side DB helper that bridges to Electron main via window.native.db
// Provides a unified interface for configuring the connection and running queries.
// PostgreSQL only - LAN operation mode

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
const K_DEV_CONN = 'corepms_db_conn'

// Convert MySQL-style ? placeholders to PostgreSQL $1, $2, etc.
function convertPlaceholders(sql: string): string {
  let idx = 0;
  return sql.replace(/\?/g, () => `$${++idx}`);
}

let isDbReady = false;
let lastReadyCheck = 0;
const READY_CACHE_TTL = 5000; // Cache ready state for 5 seconds

export const db = {
  async waitForReady(retries = 1000000, delay = 1000): Promise<boolean> {
    // 1. Check in-memory cache first
    if (isDbReady && (Date.now() - lastReadyCheck < READY_CACHE_TTL)) {
      return true;
    }

    for (let i = 0; i < retries; i++) {
      // [WEB MIGRATION] Support Web/HTTP mode if native bridge is missing
      if (!hasNativeDb()) {
        try {
          // Test connectivity to backend API
          const res = await fetch('/api/db/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
          });
          if (res.ok) {
            const json = await res.json();
            if (json.ok) {
              isDbReady = true;
              lastReadyCheck = Date.now();
              if (i > 0) console.log(`[DB-Web] Ready after ${i} retries.`);
              return true;
            }
          }
        } catch (e) {
          // Ignore network errors during wait loop
        }
        await new Promise(res => setTimeout(res, delay))
        continue;
      }

      try {
        // 2. Simple check if bridge exists, avoid heavy IPC if possible
        const configured = await (window as any).native.db.isConfigured();
        if (!configured || !configured.configured) {
          // If strictly not configured, fail fast (unless dev mode logic overrides)
        }

        const test = await (window as any).native.db.testConnection()
        if (test && test.ok) {
          isDbReady = true;
          lastReadyCheck = Date.now();
          if (i > 0) console.log(`[DB] Ready after ${i} retries.`);
          return true
        }

        console.warn(`[DB] Connection test failed (attempt ${i + 1}/${retries}):`, test?.error);
        await new Promise(res => setTimeout(res, delay))
      } catch (e) {
        console.warn(`[DB] WaitForReady check failed (attempt ${i + 1}/${retries}):`, e);
        await new Promise(res => setTimeout(res, delay))
      }
    }
    console.error('[DB] Initialization timed out after', retries * delay, 'ms');
    return false
  },
  async getConnectionString(): Promise<string> {
    if (!hasNativeDb()) {
      // [WEB] Web mode assumes the server determines the connection, or we fetch config from API if needed.
      // For security, we might not want to expose the full string to the client.
      // We will return a placeholder or fetch from an endpoint if necessary.
      return 'postgres://web-mode-hidden';
    }
    const res = await (window as any).native.db.getConnectionString()
    return res?.connectionString || ''
  },
  async getConnectionConfig(): Promise<DbConfig | null> {
    if (!hasNativeDb()) return null;
    return await (window as any).native.db.getConnectionConfig();
  },
  async isConfigured(): Promise<boolean> {
    if (!hasNativeDb()) return true; // Web mode is always "configured" by the server env
    try {
      const conn = await this.getConnectionString()
      return !!conn
    } catch { return false }
  },
  async setConnectionString(conn: string): Promise<ExecResult> {
    if (!hasNativeDb()) {
      // Web mode doesn't allow setting connection string from client for security
      return { ok: false, error: 'Cannot set DB connection from web client. Configure server env.' }
    }
    const res = await (window as any).native.db.setConnectionString(conn)
    return res && typeof res.ok === 'boolean' ? res : { ok: false, error: 'Unknown error' }
  },
  async saveConnectionConfig(config: DbConfig): Promise<ExecResult> {
    if (!hasNativeDb()) return { ok: false, error: 'Native DB bridge unavailable' };
    return await (window as any).native.db.saveConnectionConfig(config);
  },
  async testConnection(config?: DbConfig): Promise<{ ok: boolean; serverVersion?: string; error?: string }> {
    if (!hasNativeDb()) {
      // Web mode test
      try {
        const res = await fetch('/api/db/test', { method: 'POST' });
        const json = await res.json();
        return json;
      } catch (e: any) { return { ok: false, error: e.message } }
    }
    return await (window as any).native.db.testConnection(config)
  },
  async query<Row = any>(sql: string, params: any[] = []): Promise<QueryResult<Row>> {
    const start = performance.now();

    // [WEB MIGRATION] Fetch fallback
    if (!hasNativeDb()) {
      const pgSql = convertPlaceholders(sql);
      try {
        const res = await fetch('/api/db/query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sql: pgSql, params })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
        const json = await res.json();
        return json;
      } catch (e: any) {
        console.error(`[DB-Web-Error] ${e.message} in query: ${sql}`);
        return { error: e.message };
      }
    }

    // Optimistic check to avoid waterfall
    const ready = await this.waitForReady()
    if (!ready) return { error: 'Database initialization timed out' }

    // Convert ? placeholders to PostgreSQL $1, $2, etc.
    const pgSql = convertPlaceholders(sql);

    try {
      const result = await (window as any).native.db.query(pgSql, params);
      const duration = performance.now() - start;
      if (duration > 500) { // Log slow queries (>500ms)
        console.warn(`[DB-Slow] ${duration.toFixed(0)}ms: ${sql.substring(0, 100)}...`);
      }
      return result;
    } catch (e: any) {
      console.error(`[DB-Error] ${e.message} in query: ${sql}`);
      return { error: e.message };
    }
  },
  async exec(sql: string, actorUserId?: string): Promise<ExecResult> {
    if (!hasNativeDb()) {
      try {
        const res = await fetch('/api/db/exec', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sql })
        });
        const json = await res.json();
        return json;
      } catch (e: any) { return { ok: false, error: e.message } }
    }
    const ready = await this.waitForReady()
    if (!ready) return { ok: false, error: 'Database initialization timed out' }
    return await (window as any).native.db.exec(sql, actorUserId)
  },
  async transaction(operations: (string | { sql: string; params?: any[] })[], actorUserId?: string): Promise<ExecResult> {

    // Normalize input
    const normalizedOps = operations.map(op => {
      if (typeof op === 'string') return { sql: op, params: [] };
      return { sql: op.sql, params: op.params || [] };
    });

    // Convert placeholders
    const pgOps = normalizedOps.map(op => ({
      sql: convertPlaceholders(op.sql),
      params: op.params
    }));

    if (!hasNativeDb()) {
      try {
        const res = await fetch('/api/db/transaction', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ operations: pgOps })
        });
        const json = await res.json();
        return json;
      } catch (e: any) { return { ok: false, error: e.message } }
    }

    const ready = await this.waitForReady();
    if (!ready) return { ok: false, error: 'Database initialization timed out' };

    return await (window as any).native.db.transaction(pgOps);
  },
  async exportSqlDump(options?: { outFile?: string; actorUserId?: string }): Promise<{ ok: boolean; path?: string; error?: string; warning?: string }> {
    if (!hasNativeDb()) return { ok: false, error: 'Export not supported in DB Web Mode' }
    return await (window as any).native.db.exportSqlDump(options || {})
  }
}

export default db
