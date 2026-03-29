import { db } from '@/lib/db'
import bcrypt from 'bcryptjs'
const makeUuid = (): string => {
  try {
    const g = (globalThis as any);
    const u = g?.crypto?.randomUUID?.();
    if (u) return u;
  } catch { }
  return `${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export type DbUser = {
  id: string;
  username: string;
  name: string;
  role: string;
  active: boolean;
  password_change_required: boolean;
  created_at: string;
  email?: string;
  permissions?: string[];
}
export type Shift = {
  id: string;
  user_id: string;
  station_id: string;
  start_time: string;
  end_time?: string;
  start_balance: number;
  end_balance?: number;
  status: 'open' | 'closed';
  user_name?: string;
  station_name?: string;
}

export type AccessLog = {
  id: number;
  ts: string;
  user_username: string | null;
  event: string;
  detail: any | null;
}

const STRONG_PASSWORD = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^\da-zA-Z]).{8,}$/

export const pmsAuthDb = {
  async init(): Promise<void> {
    const createUsers = `
      CREATE TABLE IF NOT EXISTS app_users (
        id VARCHAR(255) PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE,
        name VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        active BOOLEAN NOT NULL DEFAULT true,
        password_change_required BOOLEAN NOT NULL DEFAULT true,
        is_verified BOOLEAN NOT NULL DEFAULT false,
        is_mock_account BOOLEAN NOT NULL DEFAULT false,
        failed_attempts INTEGER NOT NULL DEFAULT 0,
        lockout_until TIMESTAMP,
        password_changed_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        last_login TIMESTAMP,
        permissions TEXT[],
        two_factor_enabled BOOLEAN NOT NULL DEFAULT false,
        two_factor_secret TEXT,
        pos_pin VARCHAR(6),
        is_deleted BOOLEAN NOT NULL DEFAULT false
      );
      CREATE INDEX IF NOT EXISTS idx_app_users_username ON app_users(username);
      CREATE INDEX IF NOT EXISTS idx_app_users_email ON app_users(email);
      CREATE INDEX IF NOT EXISTS idx_app_users_id ON app_users(id);
    `;
    const createLogs = `
      CREATE TABLE IF NOT EXISTS access_logs (
        id BIGSERIAL PRIMARY KEY,
        ts TIMESTAMP NOT NULL DEFAULT NOW(),
        user_username VARCHAR(255),
        event VARCHAR(255) NOT NULL,
        detail JSONB
      );`;
    const createVerifications = `
      CREATE TABLE IF NOT EXISTS email_verifications (
        token VARCHAR(255) PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        used_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_email_verifications_user ON email_verifications(user_id);
      CREATE INDEX IF NOT EXISTS idx_email_verifications_expires ON email_verifications(expires_at);
    `;
    const createLoginAttempts = `
      CREATE TABLE IF NOT EXISTS login_attempts (
        id BIGSERIAL PRIMARY KEY,
        ts TIMESTAMP NOT NULL DEFAULT NOW(),
        user_username VARCHAR(255),
        ip VARCHAR(50),
        user_agent TEXT,
        ok BOOLEAN NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_login_attempts_user ON login_attempts(user_username);
      CREATE INDEX IF NOT EXISTS idx_login_attempts_ts ON login_attempts(ts);
    `;
    const createAppSettings = `
      CREATE TABLE IF NOT EXISTS app_settings (
        key VARCHAR(255) PRIMARY KEY,
        value TEXT,
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `;
    await db.exec(createUsers);
    try { await db.exec(`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN NOT NULL DEFAULT false`); } catch { }
    try { await db.exec(`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS two_factor_secret TEXT`); } catch { }
    try { await db.exec(`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS permissions TEXT[]`); } catch { }
    try { await db.exec(`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS last_activity TIMESTAMP`); } catch { }
    try { await db.exec(`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS last_login TIMESTAMP`); } catch { }
    try { await db.exec(`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS pos_pin VARCHAR(6)`); } catch { }
    try { await db.exec(`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false`); } catch { }
    try { await db.exec(`ALTER TABLE products ADD COLUMN IF NOT EXISTS visibility_stations TEXT[]`); } catch { }
    await db.exec(createLogs);
    // [REPAIR] Ensure all existing users have is_deleted set (safe for new/existing)
    try { await db.exec(`UPDATE app_users SET is_deleted = false WHERE is_deleted IS NULL`); } catch { }
    // [REPAIR] Ensure empty emails are NULL to avoid unique constraint conflicts
    try { await db.exec(`UPDATE app_users SET email = NULL WHERE email IS NOT NULL AND (email = '' OR email ~ '^\\s*$')`); } catch { }
    await db.exec(createVerifications);
    await db.exec(createLoginAttempts);
    const createAdmins = `
      CREATE TABLE IF NOT EXISTS admins (
        user_id VARCHAR(36) PRIMARY KEY,
        inserted_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `;
    const createProfiles = `
      CREATE TABLE IF NOT EXISTS profiles (
        id VARCHAR(36) PRIMARY KEY,
        email TEXT,
        full_name TEXT,
        role TEXT,
        property_id TEXT,
        is_active BOOLEAN DEFAULT true,
        inserted_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `;
    const createPrinterConfigs = `
      CREATE TABLE IF NOT EXISTS printer_configs (
        id VARCHAR(36) PRIMARY KEY,
        property_id TEXT NOT NULL,
        data JSONB NOT NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS printer_configs_property_id_idx ON printer_configs(property_id);
    `;
    const createRooms = `
      CREATE TABLE IF NOT EXISTS rooms (
        id VARCHAR(36) PRIMARY KEY,
        number VARCHAR(50) UNIQUE NOT NULL,
        type VARCHAR(50) NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'vacant',
        rate NUMERIC(12,2) NOT NULL DEFAULT 0,
        inserted_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `;
    const createGuests = `
      CREATE TABLE IF NOT EXISTS guests (
        id VARCHAR(36) PRIMARY KEY,
        full_name TEXT NOT NULL,
        email TEXT,
        phone TEXT,
        inserted_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `;
    const createReservations = `
      CREATE TABLE IF NOT EXISTS reservations (
        id VARCHAR(36) PRIMARY KEY,
        guest_id VARCHAR(36) NOT NULL,
        room_id VARCHAR(36),
        status VARCHAR(50) NOT NULL DEFAULT 'confirmed',
        check_in_date DATE NOT NULL,
        check_out_date DATE NOT NULL,
        source TEXT,
        id_document_enc TEXT,
        id_document_type TEXT,
        nationality_code TEXT,
        nationality_name TEXT,
        booking_source TEXT,
        partner_code TEXT,
        utm_source TEXT,
        utm_medium TEXT,
        utm_campaign TEXT,
        utm_term TEXT,
        utm_content TEXT,
        terms_accepted BOOLEAN,
        confirmed_at TIMESTAMP,
        signature_encrypted TEXT,
        payment_info_source TEXT,
        payment_verified BOOLEAN,
        package_code VARCHAR(50) DEFAULT 'RO',
        tax_inclusive BOOLEAN DEFAULT false,
        expires_at TIMESTAMP,
        payment_status VARCHAR(20) DEFAULT 'pending',
        inserted_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `;
    const createMenuItems = `
      CREATE TABLE IF NOT EXISTS menu_items (
        id VARCHAR(36) PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        price NUMERIC(12,2) NOT NULL,
        active BOOLEAN NOT NULL DEFAULT true,
        inserted_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `;
    const createOrders = `
      CREATE TABLE IF NOT EXISTS orders (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36),
        table_no TEXT,
        status VARCHAR(50) NOT NULL DEFAULT 'open',
        total NUMERIC(12,2) NOT NULL DEFAULT 0,
        inserted_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `;
    const createOrderItems = `
      CREATE TABLE IF NOT EXISTS order_items (
        id VARCHAR(36) PRIMARY KEY,
        order_id VARCHAR(36) NOT NULL,
        menu_item_id VARCHAR(36) NOT NULL,
        qty INTEGER NOT NULL DEFAULT 1,
        price NUMERIC(12,2) NOT NULL,
        inserted_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `;
    const createInventoryItems = `
      CREATE TABLE IF NOT EXISTS inventory_items (
        id VARCHAR(36) PRIMARY KEY,
        name TEXT NOT NULL,
        quantity NUMERIC NOT NULL DEFAULT 0,
        unit TEXT NOT NULL DEFAULT 'units',
        reorder_level INTEGER NOT NULL DEFAULT 10,
        cost NUMERIC(12,2) NOT NULL DEFAULT 0,
        inserted_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `;
    const createInventoryMovements = `
      CREATE TABLE IF NOT EXISTS inventory_movements (
        id VARCHAR(36) PRIMARY KEY,
        item_id VARCHAR(36) NOT NULL,
        delta NUMERIC NOT NULL,
        reason TEXT,
        user_id VARCHAR(36),
        inserted_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `;
    const createSuppliers = `
      CREATE TABLE IF NOT EXISTS suppliers (
        id VARCHAR(36) PRIMARY KEY,
        name TEXT NOT NULL,
        contact TEXT,
        inserted_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `;
    const createTaxes = `
      CREATE TABLE IF NOT EXISTS taxes (
        id VARCHAR(36) PRIMARY KEY,
        name TEXT NOT NULL,
        percentage NUMERIC(12,2) NOT NULL,
        is_inclusive BOOLEAN NOT NULL DEFAULT false,
        applies_to VARCHAR(50) NOT NULL CHECK (applies_to IN ('all','accommodation','pos','services')),
        active BOOLEAN NOT NULL DEFAULT true,
        inserted_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS taxes_active_idx ON taxes(active);
      CREATE INDEX IF NOT EXISTS taxes_applies_idx ON taxes(applies_to);
    `;
    const createCostCentres = `
      CREATE TABLE IF NOT EXISTS cost_centres (
        id VARCHAR(36) PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        description TEXT,
        active BOOLEAN DEFAULT true,
        inserted_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `;
    const createShifts = `
      CREATE TABLE IF NOT EXISTS pos_shifts (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        station_id VARCHAR(36) NOT NULL,
        start_time TIMESTAMP NOT NULL DEFAULT NOW(),
        end_time TIMESTAMP,
        start_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
        end_balance NUMERIC(12,2),
        status VARCHAR(20) NOT NULL DEFAULT 'open',
        inserted_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_pos_shifts_user ON pos_shifts(user_id);
      CREATE INDEX IF NOT EXISTS idx_pos_shifts_status ON pos_shifts(status);
    `;
    await db.exec(createAdmins);
    await db.exec(createProfiles);
    await db.exec(createPrinterConfigs);
    await db.exec(createRooms);
    await db.exec(createGuests);
    await db.exec(createReservations);
    await db.exec(createCostCentres);
    await db.exec(createShifts);
    try { await db.exec(`ALTER TABLE pos_shifts ADD COLUMN IF NOT EXISTS user_id VARCHAR(36)`); } catch { }
    try { await db.exec(`ALTER TABLE pos_shifts ADD COLUMN IF NOT EXISTS station_id VARCHAR(36)`); } catch { }
    try { await db.exec(`ALTER TABLE pos_shifts ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'open'`); } catch { }
    try { await db.exec(`ALTER TABLE pos_shifts ADD COLUMN IF NOT EXISTS start_balance NUMERIC(12,2) NOT NULL DEFAULT 0`); } catch { }
    try { await db.exec(`CREATE INDEX IF NOT EXISTS reservations_inserted_at_idx ON reservations(inserted_at)`) } catch { }
    try { await db.exec(`CREATE INDEX IF NOT EXISTS reservations_guest_idx ON reservations(guest_id)`) } catch { }
    try { await db.exec(`CREATE INDEX IF NOT EXISTS reservations_room_idx ON reservations(room_id)`) } catch { }
    try { await db.exec(`CREATE INDEX IF NOT EXISTS reservations_status_idx ON reservations(status)`) } catch { }
    try { await db.exec(`ALTER TABLE reservations ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP`) } catch { }
    try { await db.exec(`ALTER TABLE reservations ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) DEFAULT 'pending'`) } catch { }
    await db.exec(createMenuItems);
    await db.exec(createOrders);
    try { await db.exec(`CREATE INDEX IF NOT EXISTS orders_status_idx ON orders(status)`) } catch { }
    try { await db.exec(`CREATE INDEX IF NOT EXISTS orders_inserted_at_idx ON orders(inserted_at)`) } catch { }
    try { await db.exec(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS shift_id VARCHAR(36)`) } catch { }
    try { await db.exec(`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS is_pos_enabled BOOLEAN DEFAULT true`) } catch { }
    try { await db.exec(`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS pos_role VARCHAR(50)`) } catch { }
    await db.exec(createOrderItems);
    await db.exec(createInventoryItems);
    await db.exec(createInventoryMovements);
    await db.exec(createSuppliers);
    await db.exec(createTaxes);
    await db.exec(createAppSettings);
  },

  async recordAccessAttempt(user_username: string, event: string, detail?: Record<string, any>) {
    const sql = `INSERT INTO access_logs (user_username, event, detail) VALUES (?, ?, ?)`;
    await db.query(sql, [user_username, event, detail ? JSON.stringify(detail) : null]);
  },

  async getAppSetting(key: string): Promise<string | null> {
    try {
      const res = await db.query<{ value: string }>(`SELECT value FROM app_settings WHERE key = ?`, [key]);
      if ('error' in res || !res.rows || res.rows.length === 0) return null;
      return res.rows[0].value;
    } catch {
      return null;
    }
  },

  async setAppSetting(key: string, value: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const sql = `INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`;
      const res = await db.query(sql, [key, value]);
      if ('error' in res) return { ok: false, error: res.error };
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'Failed to set setting' };
    }
  },


  async getAllAppSettings(): Promise<Record<string, string>> {
    try {
      const res = await db.query<{ key: string; value: string }>(`SELECT key, value FROM app_settings`);
      if ('error' in res || !res.rows) return {};
      return res.rows.reduce((acc, row) => ({ ...acc, [row.key]: row.value }), {} as Record<string, string>);
    } catch {
      return {};
    }
  },

  async listAccessLogs(filters?: { limit?: number; username?: string; event?: string; from?: string; to?: string }): Promise<AccessLog[]> {
    const clauses: string[] = [];
    const params: any[] = [];
    if (filters?.username) { clauses.push(`user_username = ?`); params.push(filters.username); }
    if (filters?.event) { clauses.push(`event = ?`); params.push(filters.event); }
    if (filters?.from) { clauses.push(`ts >= ?`); params.push(filters.from); }
    if (filters?.to) { clauses.push(`ts <= ?`); params.push(filters.to); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const limit = Math.max(1, Math.min(filters?.limit || 50, 500));
    const sql = `SELECT id, ts, user_username, event, detail FROM access_logs ${where} ORDER BY ts DESC, id DESC LIMIT ${limit}`;
    const res = await db.query<AccessLog>(sql, params);
    if ('error' in res) return [];
    return res.rows || [];
  },

  async ensureSuperUser(): Promise<void> {
    const exists = await db.query<DbUser>(`SELECT * FROM app_users WHERE username = ?`, ['Super User']);
    if ('error' in exists) return;
    if (exists.rows && exists.rows.length > 0) return;
    const id = `su_${Date.now()}`;
    const passwordHash = await bcrypt.hash('Super@123', 12);
    const sql = `INSERT INTO app_users (id, username, name, role, password_hash, active, password_change_required) VALUES (?, ?, ?, ?, ?, true, true)`;
    await db.query(sql, [id, 'Super User', 'Super User', 'admin', passwordHash]);
    await this.recordAccessAttempt('Super User', 'super_user_created', { id });
  },

  async grantPrivilegesForSuperUser(newPassword: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const exists = await db.query<DbUser & { password_hash: string }>(`SELECT id, username, role FROM app_users WHERE username = ?`, ['Super User']);
      if ('error' in exists) return { ok: false, error: exists.error };
      if (!exists.rows || exists.rows.length === 0) {
        // If missing, create then proceed
        const id = `su_${Date.now()}`;
        const passwordHash = await bcrypt.hash(newPassword, 12);
        const sql = `INSERT INTO app_users (id, username, name, role, password_hash, active, password_change_required) VALUES (?, ?, ?, ?, ?, true, false)`;
        const ins = await db.query(sql, [id, 'Super User', 'Super User', 'admin', passwordHash]);
        if ('error' in ins) return { ok: false, error: ins.error };
        await this.recordAccessAttempt('Super User', 'super_user_created', { id });
      } else {
        // Promote to admin and set password
        const hash = await bcrypt.hash(newPassword, 12);
        const up = await db.query(`UPDATE app_users SET role = 'admin', password_hash = ?, password_change_required = false WHERE username = 'Super User'`, [hash]);
        if ('error' in up) return { ok: false, error: up.error };
      }
      // Audit: permissions granted
      await this.recordAccessAttempt('Super User', 'permissions_granted', {
        privileges: [
          'full_database_administration',
          'connection_string_modification',
          'system_configuration_access',
          'security_settings_management',
        ]
      });
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'Failed to grant privileges' };
    }
  },

  async ensureAdminWithPolicies(): Promise<{ ok: boolean; created?: boolean; updated?: boolean }> {
    const configured = await db.isConfigured();
    if (!configured) return { ok: false };
    await this.init();
    const row = await db.query<DbUser & { password_hash: string }>(`SELECT id, username, role, active FROM app_users WHERE lower(username::text) = lower('admin'::text)`);
    if (!('error' in row) && row.rows && row.rows.length > 0) {
      const id = row.rows[0].id;
      const hash = await bcrypt.hash('admin123', 12);
      await db.query(`UPDATE app_users SET role = 'admin', active = true, updated_at = NOW(), failed_attempts = 0, lockout_until = NULL, password_hash = ?, password_change_required = false WHERE id = ?`, [hash, id]);
      await db.query(`DELETE FROM login_attempts WHERE user_username = 'admin'`);
      await db.query(`UPDATE app_users SET two_factor_enabled = true WHERE id = ?`, [id]);
      await this.recordAccessAttempt('admin', 'permissions_granted', {
        privileges: [
          'full_system_configuration_access',
          'user_management_capabilities',
          'security_settings_modification',
          'administrative_dashboard_features'
        ]
      });
      return { ok: true, updated: true };
    } else {
      const id = `usr_${makeUuid()}`;
      const hash = await bcrypt.hash('admin123', 12);
      await db.query(`INSERT INTO app_users (id, username, name, role, password_hash, active, password_change_required, password_changed_at, is_verified, created_at, updated_at) VALUES (?, ?, ?, 'admin', ?, true, true, NOW(), false, NOW(), NOW())`, [id, 'admin', 'System Administrator', hash]);
      await db.query(`UPDATE app_users SET two_factor_enabled = true WHERE id = ?`, [id]);
      await this.recordAccessAttempt('admin', 'super_user_created', { id });
      await this.recordAccessAttempt('admin', 'permissions_granted', {
        privileges: [
          'full_system_configuration_access',
          'user_management_capabilities',
          'security_settings_modification',
          'administrative_dashboard_features'
        ]
      });
      return { ok: true, created: true };
    }
  },

  async cleanupTestData(preserveUsername: string): Promise<{ ok: boolean; error?: string; deletedCounts?: Record<string, number> }> {
    try {
      const configured = await db.isConfigured();
      if (!configured) return { ok: false, error: 'Database not configured' };
      await this.init();
      const stats: Record<string, number> = {};

      const del = async (sql: string, params: any[] = [], key: string) => {
        const res = await db.query<{ affected_rows: number }>(sql, params);
        if ('error' in res) throw new Error(res.error);
        stats[key] = (stats[key] || 0) + (res.rowCount ?? 0);
      };

      // Purge app data except the preserved admin user
      await del(`DELETE FROM reservations`, [], 'reservations');
      await del(`DELETE FROM guests`, [], 'guests');
      await del(`DELETE FROM login_attempts`, [], 'login_attempts');
      await del(`DELETE FROM email_verifications`, [], 'email_verifications');
      await del(`DELETE FROM access_logs WHERE user_username IS NULL OR user_username <> ?`, [preserveUsername], 'access_logs');
      await del(`DELETE FROM app_users WHERE lower(username::text) <> lower(?::text)`, [preserveUsername], 'app_users');

      // Ensure preserved admin user exists and is active
      const adminRow = await db.query<DbUser & { password_hash: string }>(`SELECT id, username, role, active FROM app_users WHERE lower(username::text) = lower(?::text)`, [preserveUsername]);
      if ('error' in adminRow) throw new Error(adminRow.error);
      if (!adminRow.rows || adminRow.rows.length === 0) {
        const id = `usr_${makeUuid()}`;
        const hash = await bcrypt.hash('admin123', 12);
        // Insert using minimal guaranteed columns for compatibility
        const ins = await db.query(`INSERT INTO app_users (id, username, name, role, password_hash, active, password_change_required) VALUES (?, ?, ?, 'admin', ?, true, false)`, [id, preserveUsername, 'Super User Admin', hash]);
        if ('error' in ins) throw new Error(ins.error);
      } else {
        // Update without touching columns that may not exist on older schema
        await db.query(`UPDATE app_users SET role = 'admin', active = true WHERE lower(username::text) = lower(?::text)`, [preserveUsername]);
      }

      await this.recordAccessAttempt(preserveUsername, 'cleanup_executed', { deletedCounts: stats });
      return { ok: true, deletedCounts: stats };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'Cleanup failed' };
    }
  },

  async getUser(id: string): Promise<DbUser | null> {
    const res = await db.query<DbUser>(`SELECT id, username, name, role, active, password_change_required, created_at FROM app_users WHERE id = ?`, [id]);
    if ('error' in res || !res.rows || res.rows.length === 0) return null;
    return res.rows[0];
  },

  async verifyLogin(username: string, password: string): Promise<{ ok: boolean; user?: DbUser; mustChange?: boolean; error?: string }> {
    const res = await db.query<DbUser & { password_hash: string; failed_attempts: number; lockout_until: string | null; password_changed_at: string | null }>(`SELECT id, username, name, role, active, password_change_required, created_at, password_hash, failed_attempts, lockout_until, password_changed_at, permissions FROM app_users WHERE LOWER(username::text) = LOWER(?::text)`, [username]);
    if ('error' in res) {
      return { ok: false, error: res.error as string };
    }
    if (!res.rows || res.rows.length === 0) {
      await this.recordAccessAttempt(username, 'login_attempt', { ok: false, reason: 'user_not_found' });
      return { ok: false, error: 'user_not_found' };
    }
    const row = res.rows[0] as any;
    // Rate limiting: count last 15 minutes attempts (PostgreSQL interval syntax)
    const rate = await db.query<{ c: number }>(`SELECT COUNT(*) AS c FROM login_attempts WHERE user_username = $1 AND ts >= NOW() - INTERVAL '15 minutes'`, [username]);
    const recentAttempts = ('error' in rate) ? 0 : (rate.rows?.[0]?.c ?? 0);
    if (recentAttempts >= 5) {
      await this.recordAccessAttempt(username, 'login_attempt', { ok: false, reason: 'rate_limited' });
      return { ok: false, error: 'rate limit exceeded' };
    }
    // Lockout check
    if (row.lockout_until && new Date(row.lockout_until).getTime() > Date.now()) {
      await this.recordAccessAttempt(username, 'login_attempt', { ok: false, reason: 'locked_out_until', until: row.lockout_until });
      return { ok: false, error: 'account locked' };
    }
    const ok = await bcrypt.compare(password, row.password_hash);
    await db.query(`INSERT INTO login_attempts (user_username, ip, user_agent, ok) VALUES (?, ?, ?, ?)`, [username, 'electron', navigator.userAgent || 'electron', ok]);
    await this.recordAccessAttempt(username, 'login_attempt', { ok });
    if (!ok) {
      const nextFailed = (Number(row.failed_attempts || 0) + 1);
      let lockUntil: string | null = null;
      if (nextFailed >= 10) {
        lockUntil = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // ISO string is fine for MySQL DATETIME usually, or use JS Date
      }
      await db.query(`UPDATE app_users SET failed_attempts = ?, lockout_until = ?, updated_at = NOW() WHERE LOWER(username::text) = LOWER(?::text)`, [nextFailed, lockUntil ? new Date(lockUntil) : null, username]);
      return { ok: false, error: 'Invalid username or password' };
    }
    // Success: reset counters
    await db.query(`UPDATE app_users SET failed_attempts = 0, lockout_until = NULL, last_login = NOW(), updated_at = NOW() WHERE LOWER(username::text) = LOWER(?::text)`, [username]);
    // Unified preview policy: do not force password change in Electron preview
    const mustChange = false;
    const user: DbUser = {
      id: row.id,
      username: row.username,
      name: row.name,
      role: row.role,
      active: !!row.active,
      password_change_required: !!row.password_change_required,
      created_at: row.created_at,
      permissions: row.permissions || [],
    };
    await db.query(`UPDATE app_users SET password_change_required = false WHERE LOWER(username::text) = LOWER(?::text)`, [username]);
    return { ok: true, user, mustChange };
  },

  validateStrongPassword(pw: string): boolean {
    return STRONG_PASSWORD.test(pw);
  },

  async updatePasswordForUser(username: string, newPassword: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.validateStrongPassword(newPassword)) {
      return { ok: false, error: 'Password not strong enough' };
    }
    const hash = await bcrypt.hash(newPassword, 12);
    // Update without referencing optional columns for schema compatibility
    const sql = `UPDATE app_users SET password_hash = ?, password_change_required = false, password_changed_at = NOW(), failed_attempts = 0, lockout_until = NULL, updated_at = NOW() WHERE LOWER(username::text) = LOWER(?::text)`;
    const res = await db.query(sql, [hash, username]);
    if ('error' in res) return { ok: false, error: res.error };
    await this.recordAccessAttempt(username, 'password_changed');
    return { ok: true };
  },

  async updatePasswordForUserUnsafe(username: string, newPassword: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const hash = await bcrypt.hash(newPassword, 12);
      const sql = `UPDATE app_users SET password_hash = ?, password_change_required = false WHERE lower(username::text) = lower(?::text)`;
      const res = await db.query(sql, [hash, username]);
      if ('error' in res) return { ok: false, error: res.error };
      await this.recordAccessAttempt(username, 'password_changed_unsafe');
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'Failed to set password' };
    }
  },

  async registerUser(payload: { username: string; email: string; password: string; name: string; role: string; permissions?: string[] }): Promise<{ ok: boolean; error?: string; errorType?: string; suggestions?: string[]; verifyToken?: string }> {
    const { username, password, name, role, permissions } = payload || ({} as any);
    const email = (payload.email && payload.email.trim()) || null;

    if (!username || !password || !name) return { ok: false, error: 'Missing fields' };
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'Invalid email' };
    if (!this.validateStrongPassword(password)) return { ok: false, error: 'Weak password' };

    // Check for duplicate username and email separately to provide specific feedback
    const usernameCheck = await db.query<{ id: string }>(`SELECT id FROM app_users WHERE LOWER(username::text) = LOWER(?::text)`, [username]);
    const emailCheck = email ? await db.query<{ id: string }>(`SELECT id FROM app_users WHERE LOWER(email::text) = LOWER(?::text)`, [email]) : { rows: [] };

    const usernameExists = !('error' in usernameCheck) && usernameCheck.rows && usernameCheck.rows.length > 0;
    const emailExists = !('error' in emailCheck) && emailCheck.rows && emailCheck.rows.length > 0;

    if (usernameExists || emailExists) {
      let errorType = 'duplicate';
      let errorMessage = 'Username or email already exists';

      if (usernameExists && emailExists) {
        errorType = 'both_duplicate';
        errorMessage = 'Both username and email are already registered';
      } else if (usernameExists) {
        errorType = 'username_duplicate';
        errorMessage = 'Username is already taken';
      } else {
        errorType = 'email_duplicate';
        errorMessage = 'Email is already registered';
      }

      // Generate alternative username suggestions
      const suggestions = await this.generateUsernameSuggestions(username);

      return { ok: false, error: errorMessage, errorType, suggestions };
    }

    const id = `usr_${makeUuid()}`;
    const hash = await bcrypt.hash(password, 12);
    const ins = await db.query(
      `INSERT INTO app_users (id, username, email, name, role, password_hash, active, password_change_required, is_verified, created_at, updated_at, permissions, is_deleted) 
       VALUES (?, ?, ?, ?, ?, ?, true, true, false, NOW(), NOW(), ?, false)`,
      [id, username, email, name, role, hash, permissions || []]
    );
    if ('error' in ins) return { ok: false, error: ins.error };

    const token = makeUuid();
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await db.query(`INSERT INTO email_verifications (token, user_id, expires_at) VALUES (?, ?, ?)`, [token, id, expires]);
    return { ok: true, verifyToken: token };
  },

  async generateUsernameSuggestions(baseUsername: string): Promise<string[]> {
    const suggestions: string[] = [];
    const cleanBase = baseUsername.toLowerCase().replace(/[^a-z0-9]/g, '');

    // Try adding numbers
    for (let i = 1; i <= 5; i++) {
      const candidate = `${cleanBase}${i}`;
      const exists = await db.query<{ id: string }>(`SELECT id FROM app_users WHERE LOWER(username::text) = LOWER(?::text)`, [candidate]);
      if ('error' in exists || !exists.rows || exists.rows.length === 0) {
        suggestions.push(candidate);
        if (suggestions.length >= 3) break;
      }
    }

    // Try adding year
    if (suggestions.length < 3) {
      const year = new Date().getFullYear();
      const candidate = `${cleanBase}${year}`;
      const exists = await db.query<{ id: string }>(`SELECT id FROM app_users WHERE LOWER(username::text) = LOWER(?::text)`, [candidate]);
      if ('error' in exists || !exists.rows || exists.rows.length === 0) {
        suggestions.push(candidate);
      }
    }

    // Try adding random suffix
    if (suggestions.length < 3) {
      const randomSuffix = Math.random().toString(36).substring(2, 5);
      const candidate = `${cleanBase}_${randomSuffix}`;
      const exists = await db.query<{ id: string }>(`SELECT id FROM app_users WHERE LOWER(username::text) = LOWER(?::text)`, [candidate]);
      if ('error' in exists || !exists.rows || exists.rows.length === 0) {
        suggestions.push(candidate);
      }
    }

    return suggestions.slice(0, 3);
  },

  async resendVerification(usernameOrEmail: string): Promise<{ ok: boolean; error?: string; verifyToken?: string }> {
    const res = await db.query<{ id: string; is_verified: number }>(`SELECT id, is_verified FROM app_users WHERE LOWER(username::text) = LOWER(?::text) OR LOWER(email::text) = LOWER(?::text)`, [usernameOrEmail, usernameOrEmail]);
    if ('error' in res || !res.rows || res.rows.length === 0) return { ok: false, error: 'User not found' };
    if (res.rows[0].is_verified) return { ok: false, error: 'Already verified' };
    const token = makeUuid();
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await db.query(`INSERT INTO email_verifications (token, user_id, expires_at) VALUES (?, ?, ?)`, [token, res.rows[0].id, expires]);
    await this.recordAccessAttempt(usernameOrEmail, 'verification_resent');
    return { ok: true, verifyToken: token };
  },

  async verifyEmail(token: string): Promise<{ ok: boolean; error?: string }> {
    const row = await db.query<{ user_id: string; expires_at: string; used_at: string | null }>(`SELECT user_id, expires_at, used_at FROM email_verifications WHERE token = ?`, [token]);
    if ('error' in row || !row.rows || row.rows.length === 0) return { ok: false, error: 'Invalid token' };
    const rec = row.rows[0];
    if (rec.used_at) return { ok: false, error: 'Token used' };
    if (new Date(rec.expires_at).getTime() < Date.now()) return { ok: false, error: 'Token expired' };
    await db.query(`UPDATE app_users SET is_verified = true, updated_at = NOW() WHERE id = ?`, [rec.user_id]);
    await db.query(`UPDATE email_verifications SET used_at = NOW() WHERE token = ?`, [token]);
    return { ok: true };
  },

  async listUsers(): Promise<DbUser[]> {
    console.log('[pmsAuthDb] listUsers called');
    const res = await db.query<DbUser>(`SELECT id, username, name, email, role, active, created_at, last_login, last_activity, permissions FROM app_users WHERE is_deleted = false ORDER BY username ASC`);
    console.log('[pmsAuthDb] listUsers result:', res);
    if ('error' in res) {
      console.error('[pmsAuthDb] listUsers error:', res.error);
      return [];
    }
    return res.rows || [];
  },

  async deleteUser(id: string): Promise<{ ok: boolean; error?: string }> {
    try {
      // Fetch user info first to get username/email for renaming
      const userRes = await db.query<{ username: string; email: string }>(`SELECT username, email FROM app_users WHERE id = ?`, [id]);
      if ('error' in userRes || !userRes.rows || userRes.rows.length === 0) return { ok: false, error: 'User not found' };

      const { username, email } = userRes.rows[0];
      const timestamp = Date.now();
      const deletedUsername = `${username}_del_${timestamp}`;
      const deletedEmail = email ? `${email}_del_${timestamp}` : null;

      // Soft delete: set is_deleted=true, active=false, and rename credentials to free up unique slots
      const res = await db.query(
        `UPDATE app_users SET is_deleted = true, active = false, username = ?, email = ?, updated_at = NOW() WHERE id = ?`,
        [deletedUsername, deletedEmail, id]
      );

      if ('error' in res) return { ok: false, error: res.error };

      // Clean up auxiliary tables if they purely represent the user's active profile
      await db.query(`DELETE FROM email_verifications WHERE user_id = ?`, [id]);
      // Note: We keep profiles, admins, access_logs for audit persistence.
      // If 'admins' is used for permission check, the is_deleted check in list/auth handles it.

      await this.recordAccessAttempt(id, 'user_soft_deleted', { id, originalUsername: username });
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'Failed to soft delete user' };
    }
  },

  async updateUser(id: string, patch: Partial<DbUser>): Promise<{ ok: boolean; error?: string }> {
    try {
      const sets: string[] = [];
      const params: any[] = [];
      if (patch.name !== undefined) { sets.push(`name = ?`); params.push(patch.name); }
      if (patch.role !== undefined) { sets.push(`role = ?`); params.push(patch.role); }
      if (patch.active !== undefined) { sets.push(`active = ?`); params.push(patch.active); }
      if (patch.username !== undefined) { sets.push(`username = ?`); params.push(patch.username); }
      if ((patch as any).permissions !== undefined) { sets.push(`permissions = ?`); params.push((patch as any).permissions); }

      if (sets.length === 0) return { ok: true };

      params.push(id);
      const sql = `UPDATE app_users SET ${sets.join(', ')}, updated_at = NOW() WHERE id = ?`;
      const res = await db.query(sql, params);
      if ('error' in res) return { ok: false, error: res.error };
      await this.recordAccessAttempt(id, 'user_updated', { fields: sets.map(s => s.split(' ')[0]) });
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'Failed to update user' };
    }
  },

  async verifyPosPin(pin: string): Promise<{ ok: boolean; user?: DbUser; error?: string }> {
    try {
      const res = await db.query<DbUser>(
        `SELECT id, username, name, role, active, permissions FROM app_users WHERE pos_pin = ? AND active = true`,
        [pin]
      );
      if ('error' in res) return { ok: false, error: res.error };
      if (!res.rows || res.rows.length === 0) {
        return { ok: false, error: 'Invalid PIN' };
      }
      return { ok: true, user: res.rows[0] };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'Verification failed' };
    }
  },

  async listCostCentres(): Promise<Array<{ id: string; name: string; description?: string; active: boolean }>> {
    try {
      const res = await db.query<{ id: string; name: string; description?: string; active: boolean }>(`SELECT id, name, description, active FROM cost_centres ORDER BY name ASC`);
      if ('error' in res || !res.rows) return [];
      return res.rows;
    } catch {
      return [];
    }
  },

  async addCostCentre(name: string, description?: string): Promise<{ ok: boolean; error?: string; id?: string }> {
    try {
      const id = makeUuid();
      const res = await db.query(
        `INSERT INTO cost_centres (id, name, description) VALUES (?, ?, ?)`,
        [id, name, description || null]
      );
      if ('error' in res) return { ok: false, error: res.error };
      return { ok: true, id };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'Failed to add cost centre' };
    }
  },

  async deleteCostCentre(id: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await db.query(`UPDATE cost_centres SET active = false WHERE id = ?`, [id]);
      if ('error' in res) return { ok: false, error: res.error };
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'Failed to delete cost centre' };
    }
  },

  // Shift Management
  async startShift(userId: string, stationId: string, openingBalance: number): Promise<{ ok: boolean; id?: string; error?: string }> {
    try {
      const id = makeUuid();
      const res = await db.query(
        `INSERT INTO pos_shifts (id, user_id, station_id, start_balance, status) VALUES (?, ?, ?, ?, 'open')`,
        [id, userId, stationId, openingBalance]
      );
      if ('error' in res) return { ok: false, error: res.error };
      return { ok: true, id };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'Failed to start shift' };
    }
  },

  async endShift(shiftId: string, closingBalance: number): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await db.query(
        `UPDATE pos_shifts SET end_time = NOW(), end_balance = ?, status = 'closed' WHERE id = ?`,
        [closingBalance, shiftId]
      );
      if ('error' in res) return { ok: false, error: res.error };
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'Failed to end shift' };
    }
  },

  async getActiveShift(stationId: string): Promise<{ id: string; user_id: string; start_time: string; start_balance: number } | null> {
    try {
      const res = await db.query<{ id: string; user_id: string; start_time: string; start_balance: number }>(
        `SELECT id, user_id, start_time, start_balance FROM pos_shifts WHERE station_id = ? AND status = 'open' ORDER BY start_time DESC LIMIT 1`,
        [stationId]
      );
      if ('error' in res || !res.rows || res.rows.length === 0) return null;
      return res.rows[0];
    } catch {
      return null;
    }
  },

  async listShifts(stationId?: string): Promise<Shift[]> {
    try {
      let sql = `
        SELECT s.*, u.name as user_name, c.name as station_name 
        FROM pos_shifts s 
        JOIN app_users u ON s.user_id = u.id
        LEFT JOIN cost_centres c ON s.station_id = c.id
      `;
      const params = [];
      if (stationId) {
        sql += ` WHERE s.station_id = ?`;
        params.push(stationId);
      }
      sql += ` ORDER BY s.start_time DESC LIMIT 50`;
      const res = await db.query(sql, params);
      return ('rows' in res && Array.isArray(res.rows)) ? res.rows as Shift[] : [];
    } catch {
      return [];
    }
  },

  async updateUserPin(userId: string, pin: string): Promise<{ ok: boolean; error?: string }> {
    try {
      if (!/^\d{6}$/.test(pin)) return { ok: false, error: 'PIN must be exactly 6 digits' };
      const res = await db.query(`UPDATE app_users SET pos_pin = ? WHERE id = ?`, [pin, userId]);
      if ('error' in res) return { ok: false, error: res.error };
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'Failed to update PIN' };
    }
  }
}

export default pmsAuthDb
