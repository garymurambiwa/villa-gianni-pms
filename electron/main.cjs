const path = require('path')
const fs = require('fs')
const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog, shell } = require('electron')

// Production detection helper
const { execFile, exec } = require('child_process')
const net = require('net')
try { require('dotenv').config({ path: path.join(__dirname, '..', '.env') }) } catch { }
const updater = require('./updater.cjs')

// Database lifecycle manager for bundled PostgreSQL
const dbLifecycle = require('./db-lifecycle.cjs')
const ElectronMigrationHandler = require('./ElectronMigrationHandler.cjs');
let bundledDbConfig = null; // Will hold connection config from bundled DB
let migrationHandler = null;

// PostgreSQL driver only
let pg
try { pg = require('pg') } catch { pg = null }

let pgPool = null

async function getPgPool(config) {
  if (pgPool) return pgPool;
  if (!pg) throw new Error('Postgres driver missing - please run npm install pg');
  const base = typeof config === 'string' ? { connectionString: config } : (config || {});

  // Auto-enable SSL for remote connections (Supabase/Neon/etc)
  const isRemote = base.connectionString && !base.connectionString.includes('@localhost') && !base.connectionString.includes('@127.0.0.1');
  if (isRemote) {
    base.ssl = { rejectUnauthorized: false };
  }

  pgPool = new pg.Pool({
    ...base,
    connectionTimeoutMillis: 90000,
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

let mainWindow = null
let tray = null
let softBlockCleanupInterval = null

// Resource cleanup function
async function cleanupResources() {
  console.log('[Electron] Cleaning up resources...');

  // Clear the soft block cleanup interval
  if (softBlockCleanupInterval) {
    clearInterval(softBlockCleanupInterval);
    softBlockCleanupInterval = null;
    console.log('[Electron] Soft block cleanup interval cleared');
  }

  // Close database pool connections
  if (pgPool) {
    try {
      console.log('[Electron] Closing database pool...');
      await pgPool.end();
      pgPool = null;
      console.log('[Electron] Database pool closed');
    } catch (e) {
      console.error('[Electron] Error closing database pool:', e.message);
    }
  }

  // Shutdown bundled PostgreSQL gracefully
  try {
    console.log('[Electron] Shutting down bundled PostgreSQL...');
    await dbLifecycle.shutdown(app);
    console.log('[Electron] PostgreSQL shutdown complete');
  } catch (e) {
    console.error('[Electron] DB shutdown error:', e.message);
  }

  console.log('[Electron] Resource cleanup complete');
}

// Hardware acceleration management
try {
  if (String(process.env.COREPMS_DISABLE_HW_ACCEL || '') === '1') {
    app.disableHardwareAcceleration()
    app.commandLine.appendSwitch('ignore-gpu-blacklist')
  }
} catch { }

// Memory Optimization Flags
try {
  const os = require('os');
  const totalMem = os.totalmem();

  // Ultra-Low RAM (< 3GB): Aggressive limits + Software Rendering
  if (totalMem < 3 * 1024 * 1024 * 1024) {
    if (!app.isReady()) app.disableHardwareAcceleration(); // Must be called before ready
    app.commandLine.appendSwitch('renderer-process-limit', '1');
    app.commandLine.appendSwitch('js-flags', '--max-old-space-size=256');
    app.commandLine.appendSwitch('disable-site-isolation-trials'); // Saves memory
  }
  // Low RAM (< 8GB): Moderate limits
  else if (totalMem < 8 * 1024 * 1024 * 1024) {
    app.commandLine.appendSwitch('renderer-process-limit', '2');
    app.commandLine.appendSwitch('js-flags', '--max-old-space-size=512');
  }
} catch { }
// Ensure the data directory exists for configuration persistence
const dataRoot = path.join(app.getPath('userData'), 'data')
if (!fs.existsSync(dataRoot)) fs.mkdirSync(dataRoot, { recursive: true })
const configPath = path.join(dataRoot, 'db_config.json')
try {
  if (!fs.existsSync(configPath)) {
    const initial = { connectionString: '', config: null }
    fs.writeFileSync(configPath, JSON.stringify(initial, null, 2), 'utf8')
  }
} catch (e) {
  console.error('Failed to initialize db_config.json', e && e.message ? e.message : e)
}

// Helper to get full stored config
function getStoredData() {
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (e) {
    console.error("Config read failed", e);
  }
  return {};
}

// Helper to get connection string from bundled DB, local storage, or environment
function getStoredConnectionString() {
  // Priority 1: User-configured connection (allows overriding local DB)
  const data = getStoredData();
  if (data.connectionString) return data.connectionString;

  // Priority 2: Bundled PostgreSQL (if initialized)
  if (bundledDbConfig && bundledDbConfig.connectionString) {
    return bundledDbConfig.connectionString;
  }

  // Priority 3: Environment variable if configured
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  return '';
}

// 2. Database IPC Handlers
ipcMain.handle('db:getConnectionString', async () => {
  return { connectionString: getStoredConnectionString() };
});

ipcMain.handle('db:getConnectionConfig', async () => {
  // Return bundled DB config if available
  if (bundledDbConfig && bundledDbConfig.config) {
    return bundledDbConfig.config;
  }
  const data = getStoredData();
  return data.config || null;
});

ipcMain.handle('db:setConnectionString', async (_event, conn) => {
  try {
    const data = getStoredData();
    data.connectionString = conn;
    fs.writeFileSync(configPath, JSON.stringify(data, null, 2), 'utf8');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('db:saveConnectionConfig', async (_event, config) => {
  try {
    const data = getStoredData();
    data.config = config;

    // Auto-generate PostgreSQL connection string
    if (config && config.type === 'postgres') {
      const auth = config.user ? `${config.user}:${config.password || ''}@` : '';
      data.connectionString = `postgres://${auth}${config.host}:${config.port}/${config.database}`;
    }

    fs.writeFileSync(configPath, JSON.stringify(data, null, 2), 'utf8');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('db:testConnection', async (_event, config) => {
  // PostgreSQL only
  if (!pg) return { ok: false, error: 'Postgres driver not loaded - please run npm install pg' };

  const connConfig = config || getStoredConnectionString();
  const client = new pg.Client(connConfig);
  try {
    await client.connect();
    const res = await client.query('SELECT version()');
    await client.end();
    return { ok: true, serverVersion: res.rows[0].version };
  } catch (e) {
    await client.end().catch(() => { });
    return { ok: false, error: `Postgres Connection Failed: ${e.message}` };
  }
});

ipcMain.handle('db:transaction', async (_event, { operations }) => {
  const connString = getStoredConnectionString();
  if (!connString) return { ok: false, error: 'DB connection missing' };

  let client = null;
  try {
    const pool = await getPgPool(connString);
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

      // Notify live update if needed
      try {
        const tables = new Set();
        for (const op of operations) {
          const s = String(op.sql || '').toLowerCase();
          if (s.includes('reservations')) tables.add('reservations');
          if (s.includes('rooms')) tables.add('rooms');
        }
        if (tables.size > 0 && mainWindow && mainWindow.webContents) {
          mainWindow.webContents.send('db:live-update', { tables: Array.from(tables), ts: Date.now() });
        }
      } catch { }

      return { ok: true, results };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    if (client) client.release();
  }
});

ipcMain.handle('db:query', async (_event, { sql, params }) => {
  const connString = getStoredConnectionString();
  const safeParams = params || [];
  try { console.log('[Main] SQL EXEC:', String(sql || ''), Array.isArray(safeParams) ? JSON.stringify(safeParams) : '[]') } catch { }
  if (!connString) return { ok: false, error: 'DB connection missing', rows: [], rowCount: 0 }

  // PostgreSQL only
  try {
    const pool = await getPgPool(connString);
    const res = await withRetry(() => pool.query(sql, safeParams));
    const rows = Array.isArray(res && res.rows) ? res.rows : [];
    const rowCount = typeof res && typeof res.rowCount === 'number' ? res.rowCount : (rows.length || 0);
    try {
      const s = String(sql || '').toLowerCase();
      const tables = [];
      if (s.includes('reservations')) tables.push('reservations');
      if (s.includes('rooms')) tables.push('rooms');
      if (tables.length > 0 && mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('db:live-update', { tables, ts: Date.now() });
      }
    } catch { }
    return { ok: true, rows, rowCount };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e), rows: [], rowCount: 0 }
  }
});

ipcMain.handle('db:exec', async (_event, { sql }) => {
  const connString = getStoredConnectionString();
  // PostgreSQL only
  try {
    const pool = await getPgPool(connString);
    await withRetry(() => pool.query(sql));
    try {
      const s = String(sql || '').toLowerCase();
      const tables = [];
      if (s.includes('reservations')) tables.push('reservations');
      if (s.includes('rooms')) tables.push('rooms');
      if (tables.length > 0 && mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('db:live-update', { tables, ts: Date.now() });
      }
    } catch { }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// Auth Handlers (Sync to app_users and profiles)
ipcMain.handle('auth:register', async (_event, { username, email, password, name, phone, role }) => {
  const connString = getStoredConnectionString();
  if (!connString) return { ok: false, error: 'Database not connected' };

  if (!pg) return { ok: false, error: 'PG driver missing' };

  const client = new pg.Client(connString);
  try {
    await client.connect();
    await client.query('BEGIN');

    // 1. Create App User
    // Use gen_random_uuid() from pgcrypto -> cast to varchar
    const userRes = await client.query(
      `INSERT INTO public.app_users (
         id, username, email, name, role, password_hash, created_at, updated_at, is_verified
       ) VALUES (
         gen_random_uuid()::varchar, $1, $2, $3, $4, crypt($5, gen_salt('bf')), NOW(), NOW(), true
       ) RETURNING id, username, email, name, role`,
      [username, email || null, name || username, role || 'staff', password]
    );

    const newUser = userRes.rows[0];

    // 2. Create Public Profile
    await client.query(
      `INSERT INTO public.profiles (id, email, full_name, role, is_active)
       VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (id) DO NOTHING`,
      [newUser.id, newUser.email, newUser.name, newUser.role]
    );

    await client.query('COMMIT');
    return { ok: true, user: newUser };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => { });
    console.error('Registration failed:', e);
    return { ok: false, error: e.message };
  } finally {
    await client.end().catch(() => { });
  }
});

ipcMain.handle('auth:listUsers', async () => {
  const connString = getStoredConnectionString();
  if (!connString) return { ok: false, error: 'Database not connected' };
  if (!pg) return { ok: false, error: 'PG driver missing' };

  const pool = await getPgPool(connString);
  try {
    const res = await pool.query(`
       SELECT id, username, email, name, role, active, permissions, last_login, last_activity, created_at, updated_at
       FROM public.app_users 
       ORDER BY username ASC
     `);
    return { ok: true, users: res.rows };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('auth:heartbeat', async (_event, { userId }) => {
  const connString = getStoredConnectionString();
  if (!connString || !pg) return { ok: false, error: 'Database unavailable' };
  const pool = await getPgPool(connString);
  try {
    await pool.query('UPDATE public.app_users SET last_activity = NOW() WHERE id = $1', [userId]);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('auth:login', async (_event, { username, password }) => {
  const connString = getStoredConnectionString();
  if (!connString || !pg) return { ok: false, error: 'Database unavailable' };

  const pool = await getPgPool(connString);
  try {
    const res = await pool.query(
      `SELECT id, username, email, name, role, active, permissions, created_at
       FROM public.app_users 
       WHERE (username = $1 OR email = $1) 
       AND password_hash = crypt($2, password_hash)
       AND active = true`,
      [username, password]
    );
    if (res.rows.length === 0) return { ok: false, error: 'Invalid credentials' };

    // Update last login
    await pool.query('UPDATE public.app_users SET last_login = NOW() WHERE id = $1', [res.rows[0].id]);

    return { ok: true, user: res.rows[0] };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('auth:updateUser', async (_event, { id, patch }) => {
  const connString = getStoredConnectionString();
  if (!connString || !pg) return { ok: false, error: 'Database unavailable' };

  const client = new pg.Client(connString);
  try {
    await client.connect();
    await client.query('BEGIN');

    if (patch.role || patch.active !== undefined || patch.password) {
      let q = 'UPDATE public.app_users SET updated_at = NOW()';
      const args = [id];
      let idx = 2;
      if (patch.role) { q += `, role = $${idx++}`; args.push(patch.role); }
      if (patch.active !== undefined) { q += `, active = $${idx++}`; args.push(patch.active); }
      if (patch.password) { q += `, password_hash = crypt($${idx++}, gen_salt('bf'))`; args.push(patch.password); }
      q += ' WHERE id = $1';
      await client.query(q, args);
    }

    if (patch.name || patch.role || patch.active !== undefined) {
      let q = 'UPDATE public.profiles SET ';
      const args = [id];
      let idx = 2;
      const updates = [];
      if (patch.name) { updates.push(`full_name = $${idx++}`); args.push(patch.name); }
      if (patch.role) { updates.push(`role = $${idx++}`); args.push(patch.role); }
      if (patch.active !== undefined) { updates.push(`is_active = $${idx++}`); args.push(patch.active); }

      if (updates.length > 0) {
        q += updates.join(', ') + ' WHERE id = $1';
        await client.query(q, args);
      }
    }

    await client.query('COMMIT');
    return { ok: true };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => { });
    return { ok: false, error: e.message };
  } finally {
    client.end().catch(() => { });
  }
});

ipcMain.handle('auth:deleteUser', async (_event, { id }) => {
  const connString = getStoredConnectionString();
  const pool = await getPgPool(connString);
  try {
    await pool.query('DELETE FROM public.app_users WHERE id = $1', [id]);
    await pool.query('DELETE FROM public.profiles WHERE id = $1', [id]);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// IPC handler to get bundled database status
ipcMain.handle('db:getBundledStatus', async () => {
  return {
    isUsingBundled: bundledDbConfig !== null,
    isRunning: dbLifecycle.isRunning(),
    config: bundledDbConfig ? bundledDbConfig.config : null,
    connectionString: bundledDbConfig ? bundledDbConfig.connectionString : null,
  };
});

ipcMain.handle('db:isConfigured', async () => {
  const conn = getStoredConnectionString();
  const data = getStoredData();
  return {
    configured: !!conn,
    firstRunCompleted: !!data.firstRunCompleted,
    connectionString: conn
  };
});

// IPC handler for when UI is ready to load main window
ipcMain.on('ui-ready-for-main-window', () => {
  loadMainWindow();
});

// IPC handler for retrying database initialization
ipcMain.on('retry-db-initialization', async () => {
  try {
    console.log('[Electron] Retrying database initialization...');
    if (mainWindow) {
      mainWindow.webContents.send('db-status', { message: 'Retrying database initialization...' });
    }

    bundledDbConfig = await dbLifecycle.initialize(app);
    console.log('[Electron] Bundled PostgreSQL re-initialized successfully');
    console.log('[Electron] Connection:', bundledDbConfig.connectionString);

    // Send success status
    if (mainWindow) {
      mainWindow.webContents.send('db-status', { message: 'Database ready, loading application...' });
    }

    // Bootstrap schemas (will use bundled DB if available)
    bootstrapSchemas().catch((e) => {
      console.warn('[Electron] Schema bootstrap warning:', e.message);
    });

    // Load the main application
    loadMainWindow();

  } catch (e) {
    console.error('[Electron] Retry DB init failed:', e.message);

    // Send error to UI
    if (mainWindow) {
      mainWindow.webContents.send('db-error', { message: e.message });
    }
  }
});

ipcMain.handle('db:completeFirstRun', async () => {
  try {
    const data = getStoredData();
    data.firstRunCompleted = true;
    fs.writeFileSync(configPath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch { return false; }
});

// Migration IPC Handlers
ipcMain.handle('migration:run', async () => {
  try {
    if (!migrationHandler) {
      return { success: false, message: 'Migration handler not initialized' };
    }

    const connString = getStoredConnectionString();
    if (!connString) {
      return { success: false, message: 'No database connection configured' };
    }

    console.log('[Electron-Migration] Running database migrations...');
    const result = await migrationHandler.runMigrations(connString);

    // Send migration progress to renderer
    if (mainWindow) {
      mainWindow.webContents.send('migration-progress', result);
    }

    return result;
  } catch (error) {
    console.error('[Electron-Migration] Migration failed:', error);
    return {
      success: false,
      message: error.message || 'Migration process failed',
      error: error.message
    };
  }
});

ipcMain.handle('migration:getStatus', async () => {
  try {
    if (!migrationHandler) {
      return {
        success: false,
        message: 'Migration handler not initialized',
        status: null
      };
    }

    const connString = getStoredConnectionString();
    if (!connString) {
      return {
        success: false,
        message: 'No database connection configured',
        status: null
      };
    }

    const status = await migrationHandler.getMigrationStatus(connString);
    return { success: true, status };
  } catch (error) {
    console.error('[Electron-Migration] Failed to get status:', error);
    return {
      success: false,
      message: error.message || 'Failed to get migration status',
      status: null
    };
  }
});

function getSchemaPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'schema.sql');
  }
  return path.join(__dirname, '..', 'db', 'schema.sql');
}

// 2.1. Bootstrap core schemas for Postgres
async function bootstrapSchemas() {
  const connString = getStoredConnectionString();
  if (!connString) {
    console.log('[Electron] No database connection configured yet. Schema bootstrap skipped.');
    return;
  }
  if (!pg) {
    console.error('[Electron] PostgreSQL driver not loaded');
    return;
  }

  const client = new pg.Client(connString);
  try {
    console.log('[Electron] Attempting to connect to PostgreSQL at:', connString.split('@')[1] || 'unknown');
    await client.connect();

    // Create pgcrypto extension for UUID generation (if not in schema.sql, but it is)
    await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');

    // Read and execute schema.sql
    const schemaPath = getSchemaPath();
    if (fs.existsSync(schemaPath)) {
      console.log('[Electron] Reading schema from:', schemaPath);
      const schemaSql = fs.readFileSync(schemaPath, 'utf8');
      await client.query(schemaSql);
      console.log('[Electron] schema.sql executed successfully');
    } else {
      console.warn('[Electron] schema.sql not found at:', schemaPath);
      // Fallback to hardcoded critical tables if needed, or rely on existing tables
    }

    // Run automatic database migrations
    try {
      if (migrationHandler) {
        console.log('[Electron-Migration] Running automatic migrations...');
        const migrationResult = await migrationHandler.autoMigrateOnStartup(connString);

        if (migrationResult.success) {
          console.log(`[Electron-Migration] ${migrationResult.message}`);
          if (migrationResult.migrationsApplied > 0) {
            console.log(`[Electron-Migration] Applied ${migrationResult.migrationsApplied} migrations`);
          }
        } else {
          console.warn(`[Electron-Migration] Migration warning: ${migrationResult.message}`);
        }
      } else {
        console.warn('[Electron-Migration] Migration handler not initialized');
      }
    } catch (migrationError) {
      console.error('[Electron-Migration] Automatic migration failed:', migrationError.message);
      // Continue with application startup even if migrations fail
    }

    // Legacy schema adjustments (fallback for older versions)
    try { await client.query(`ALTER TABLE reservations ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP`) } catch { }
    try { await client.query(`ALTER TABLE reservations ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) DEFAULT 'pending'`) } catch { }
    // Ensure room floor column
    try { await client.query(`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS floor INTEGER DEFAULT 1`) } catch { }
    try {
      await client.query(`CREATE TABLE IF NOT EXISTS public.pos_sessions (
      id VARCHAR(255) PRIMARY KEY,
      opened_at timestamptz NOT NULL DEFAULT NOW(),
      closed_at timestamptz,
      opened_by text,
      status text NOT NULL DEFAULT 'open',
      inserted_at timestamptz NOT NULL DEFAULT NOW()
    )`)
    } catch { }
    try { await client.query(`ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS qty integer NOT NULL DEFAULT 1`) } catch { }
    try { await client.query(`ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS price numeric(12,2) NOT NULL DEFAULT 0`) } catch { }
    try { await client.query(`ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS inserted_at timestamptz NOT NULL DEFAULT NOW()`) } catch { }
    try { await client.query(`ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS menu_item_id VARCHAR(255)`) } catch { }
    try { await client.query(`ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS last_activity TIMESTAMPTZ`) } catch { }

    await client.end();
    console.log('[Electron] Database schema bootstrap complete');
  } catch (e) {
    try { await client.end(); } catch { }
    console.warn('[Electron] Schema bootstrap skipped - database not available yet:', e.message);
    console.warn('[Electron] User can configure database connection through the app UI');
  }
}

// 3. Application Window Management
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: "CORE PMS",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs')
    }
  })

  // Load the loading screen immediately
  const loadingScreenPath = app.isPackaged
    ? path.join(process.resourcesPath, 'dist', 'loading.html')
    : path.join(__dirname, '..', 'public', 'loading.html');

  mainWindow.loadFile(loadingScreenPath);

  mainWindow.on('closed', () => {
    // Clean up any window-specific resources here
    mainWindow = null
  })

  // Handle window close event to prevent JavaScript errors
  mainWindow.on('close', (event) => {
    // Prevent default close behavior to allow for proper cleanup
    event.preventDefault();

    // Perform cleanup before closing
    mainWindow.webContents.send('app-will-close', {});

    // Give renderer time to handle cleanup, then close
    setTimeout(() => {
      if (mainWindow) {
        mainWindow.destroy();
        mainWindow = null;
      }
    }, 100);
  })
}

function getStartUrl() {
  const devUrl = process.env.ELECTRON_START_URL
  if (devUrl) {
    return devUrl.endsWith('/') ? devUrl + '#/login' : devUrl + '/#/login'
  }
  return 'file://' + path.join(__dirname, '..', 'dist', 'index.html') + '#/login'
}

// Function to load the main application after database is ready
function loadMainWindow() {
  if (mainWindow) {
    const devUrl = process.env.ELECTRON_START_URL
    if (devUrl) {
      mainWindow.loadURL(devUrl.endsWith('/') ? devUrl + '#/login' : devUrl + '/#/login')
    } else {
      mainWindow.loadURL('file://' + path.join(__dirname, '..', 'dist', 'index.html') + '#/login')
    }
  }
}

// 4. Lifecycle Hooks
app.whenReady().then(async () => {
  // Create window first (non-blocking)
  createWindow();

  // Send initial status
  if (mainWindow) {
    mainWindow.webContents.send('db-status', { message: 'Initializing bundled PostgreSQL...' });
  }

  // Initialize bundled PostgreSQL asynchronously
  try {
    console.log('[Electron] Initializing bundled PostgreSQL...');

    // Set up timeout mechanism
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error('Database initialization timed out. This computer might be very slow or missing dependencies.'));
      }, 3600000); // 1 hour timeout (effectively infinite)
    });

    const initPromise = (async () => {
      bundledDbConfig = await dbLifecycle.initialize(app);
      console.log('[Electron] Bundled PostgreSQL initialized successfully');
      console.log('[Electron] Connection:', bundledDbConfig.connectionString);

      // Initialize migration handler
      migrationHandler = new ElectronMigrationHandler(app);

      // Send success status
      if (mainWindow) {
        mainWindow.webContents.send('db-status', { message: 'Database ready, loading application...' });
      }

      return bundledDbConfig;
    })();

    // Race the initialization against the timeout
    bundledDbConfig = await Promise.race([initPromise, timeoutPromise]);

    // Bootstrap schemas (will use bundled DB if available)
    bootstrapSchemas().catch((e) => {
      console.warn('[Electron] Schema bootstrap warning:', e.message);
    });

    // Cleanup task for Soft Blocks
    softBlockCleanupInterval = setInterval(async () => {
      try {
        const connString = getStoredConnectionString();
        if (!connString || !pg) return;
        const pool = await getPgPool(connString);
        // Release "Soft Blocks": status='blocked', expires_at < NOW(), payment_status != 'paid'
        await pool.query(`UPDATE reservations SET status = 'cancelled' WHERE status = 'blocked' AND expires_at < NOW() AND payment_status != 'paid'`);
      } catch (e) {
        console.error('[Electron] Soft block cleanup failed:', e.message);
      }
    }, 5 * 60 * 1000); // 5 minutes

    // Load the main application
    loadMainWindow();

  } catch (e) {
    console.error('[Electron] Bundled DB init failed:', e.message);

    // Send error to UI
    if (mainWindow) {
      mainWindow.webContents.send('db-error', { message: e.message });
    }

    console.log('[Electron] App will continue - user can configure external database');
    // Continue without bundled DB - user can configure external database
    bundledDbConfig = null;
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', async () => {
  // Clean up resources before shutdown
  await cleanupResources();

  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Handle app quit for cleanup
app.on('before-quit', async (event) => {
  event.preventDefault();
  await cleanupResources();
  app.quit();
})

ipcMain.handle('window:getFullscreen', async () => {
  return mainWindow ? mainWindow.isFullScreen() : false;
});

// File system utility handlers for renderer use
ipcMain.handle('native:readFile', async (_event, filePath) => {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    return null;
  }
});

ipcMain.handle('native:saveFile', async (_event, { filePath, content }) => {
  try {
    fs.writeFileSync(filePath, content, 'utf8');
    return true;
  } catch (e) {
    return false;
  }
});

function getUpdateLoggerPath() {
  const logDir = path.join(app.getPath('userData'), 'logs')
  try { if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true }) } catch { }
  return path.join(logDir, 'update.log')
}

function sendUpdateStatus(stage, payload) {
  const logger = getUpdateLoggerPath()
  const msg = typeof payload === 'string' ? payload : JSON.stringify(payload || {})
  updater.logTo(logger, `${stage}: ${msg}`)
  try { if (mainWindow && mainWindow.webContents) mainWindow.webContents.send('update:status', { stage, ...((typeof payload === 'object' && payload) || { message: String(payload || '') }) }) } catch { }
}

function resolveManifestUrl(cfg) {
  const envUrl = process.env.COREPMS_UPDATE_MANIFEST_URL || ''
  const cfgUrl = cfg && cfg.manifestUrl ? String(cfg.manifestUrl) : ''
  const url = cfgUrl || envUrl
  return url
}

ipcMain.handle('update:check', async (_event, cfg) => {
  const logger = getUpdateLoggerPath()
  try {
    if (process.platform !== 'win32') return { ok: false, error: 'Unsupported platform' }
    const manifestUrl = resolveManifestUrl(cfg)
    if (!updater.isHttpsUrl(manifestUrl)) return { ok: false, error: 'Invalid manifest URL (HTTPS required)' }
    sendUpdateStatus('checking', { url: manifestUrl })
    const manifest = await updater.fetchJson(manifestUrl)
    const currentVersion = app.getVersion ? app.getVersion() : require('../package.json').version
    const latestVersion = String(manifest.version || '')
    const hasUpdate = updater.isVersionNewer(currentVersion, latestVersion)
    return { ok: true, currentVersion, latestVersion, hasUpdate, manifest }
  } catch (e) {
    updater.logTo(logger, `Check failed: ${e.message}`)
    return { ok: false, error: e.message }
  }
})

ipcMain.handle('update:start', async (_event, cfg) => {
  const logger = getUpdateLoggerPath()
  try {
    if (process.platform !== 'win32') { sendUpdateStatus('error', 'Unsupported platform'); return { ok: false, error: 'Unsupported platform' } }
    const manifestUrl = resolveManifestUrl(cfg)
    if (!updater.isHttpsUrl(manifestUrl)) { sendUpdateStatus('error', 'Invalid manifest URL'); return { ok: false, error: 'Invalid manifest URL' } }
    const manifest = await updater.fetchJson(manifestUrl)
    const currentVersion = app.getVersion ? app.getVersion() : require('../package.json').version
    const latestVersion = String(manifest.version || '')
    if (!updater.isVersionNewer(currentVersion, latestVersion)) { sendUpdateStatus('up-to-date', { currentVersion }); return { ok: true, message: 'No update required' } }
    const downloadUrl = String(manifest.windows && manifest.windows.nsisInstallerUrl || manifest.url || '')
    const sha256 = String(manifest.sha256 || manifest.windows && manifest.windows.sha256 || '')
    if (!updater.isHttpsUrl(downloadUrl)) { sendUpdateStatus('error', 'Invalid download URL'); return { ok: false, error: 'Invalid download URL' } }
    const outDir = path.join(app.getPath('temp'), 'corepms_updates')
    try { if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true }) } catch { }
    const outFile = path.join(outDir, `COREPMS-Setup-${latestVersion}.exe`)
    sendUpdateStatus('downloading', { url: downloadUrl })
    await updater.downloadWithProgress(downloadUrl, outFile, (p) => sendUpdateStatus('progress', p))
    sendUpdateStatus('downloaded', { path: outFile })
    const ok = await updater.verifyChecksum(outFile, sha256)
    if (!ok) { sendUpdateStatus('error', 'Checksum verification failed'); try { fs.unlinkSync(outFile) } catch { } return { ok: false, error: 'Checksum verification failed' } }
    sendUpdateStatus('verifying', { sha256 })
    const exePath = process.execPath
    const backupDir = path.join(app.getPath('userData'), 'backup')
    try { if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true }) } catch { }
    const backupExe = path.join(backupDir, path.basename(exePath))
    try { fs.copyFileSync(exePath, backupExe) } catch { }
    sendUpdateStatus('installing', { installer: outFile })
    await updater.runNsisInstaller(outFile, logger)
    sendUpdateStatus('installed', { version: latestVersion })
    setTimeout(() => {
      try { app.quit() } catch { }
      try { app.relaunch() } catch { }
    }, 500)
    return { ok: true, latestVersion }
  } catch (e) {
    sendUpdateStatus('error', e.message)
    return { ok: false, error: e.message }
  }
})
