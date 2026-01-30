/**
 * COREPMS Database Lifecycle Manager
 * 
 * Manages bundled PostgreSQL portable installation:
 * - Initializes database cluster on first run
 * - Starts/stops PostgreSQL server
 * - Seeds schema on fresh install
 * - Provides connection credentials to the app
 * 
 * @module electron/db-lifecycle.cjs
 */

const path = require('path');
const fs = require('fs');
const { spawn, exec } = require('child_process');
const net = require('net');

// Configuration
const DB_PORT = 54320; // Use non-standard port to avoid conflicts
const DB_NAME = 'corepms_db';
const DB_USER = 'postgres';
const DB_PASSWORD = 'corepms_local'; // Local-only password

let pgProcess = null;
let isShuttingDown = false;
let logStream = null;
let logStreamClosed = false;

/**
 * Get paths based on whether we're in development or production
 */
function getPaths(app) {
  const isPackaged = app.isPackaged;
  const userDataPath = app.getPath('userData');

  // PostgreSQL binaries location
  let postgresRoot;
  if (!isPackaged) {
    postgresRoot = path.join(__dirname, '..', 'resources', 'postgres');
  } else {
    postgresRoot = path.join(process.resourcesPath, 'postgres');
  }

  // Schema file location
  let schemaPath;
  if (!isPackaged) {
    schemaPath = path.join(__dirname, '..', 'db', 'schema.sql');
  } else {
    schemaPath = path.join(process.resourcesPath, 'schema.sql');
  }

  // Data directory in user's AppData
  const dataDir = path.join(userDataPath, 'pg_data');
  const logsDir = path.join(userDataPath, 'logs');

  return {
    postgresRoot,
    binDir: path.join(postgresRoot, 'bin'),
    dataDir,
    logsDir,
    schemaPath,
    initdb: path.join(postgresRoot, 'bin', 'initdb.exe'),
    pgCtl: path.join(postgresRoot, 'bin', 'pg_ctl.exe'),
    psql: path.join(postgresRoot, 'bin', 'psql.exe'),
    postgres: path.join(postgresRoot, 'bin', 'postgres.exe'),
  };
}

/**
 * Initialize the log file
 */
function initLogger(logsDir) {
  try {
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    const logPath = path.join(logsDir, 'db-lifecycle.log');
    logStream = fs.createWriteStream(logPath, { flags: 'a' });
    logStreamClosed = false; // Reset the closed flag when creating a new stream
    log('========================================');
    log('Database Lifecycle Manager Started');
    log(`Timestamp: ${new Date().toISOString()}`);
  } catch (e) {
    console.error('Failed to init logger:', e);
  }
}

/**
 * Log message to file and console
 */
function log(message, isError = false) {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] ${message}`;

  if (isError) {
    console.error('[DB-Lifecycle]', message);
  } else {
    console.log('[DB-Lifecycle]', message);
  }

  // Only write to log stream if it exists and hasn't been closed
  if (logStream && !logStreamClosed) {
    try {
      logStream.write(logLine + '\n');
    } catch (e) {
      // Stream may have been closed, ignore write errors during shutdown
      console.warn('[DB-Lifecycle] Could not write to log stream:', e.message);
    }
  }
}

/**
 * Check if a port is available
 */
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    server.listen(port, '127.0.0.1');
  });
}

/**
 * Wait for PostgreSQL to be ready
 */
function waitForPostgres(paths, timeoutMs = 600000) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();

    const check = () => {
      if (Date.now() - startTime > timeoutMs) {
        reject(new Error('Timeout waiting for PostgreSQL to start'));
        return;
      }

      // Try to connect using pg_isready
      const pgIsReady = spawn(
        path.join(paths.binDir, 'pg_isready.exe'),
        ['-h', '127.0.0.1', '-p', String(DB_PORT)],
        { windowsHide: true }
      );

      pgIsReady.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          setTimeout(check, 500);
        }
      });

      pgIsReady.on('error', () => {
        setTimeout(check, 500);
      });
    };

    check();
  });
}

/**
 * Initialize PostgreSQL data directory if it doesn't exist
 */
async function initializeDatabase(paths) {
  log('Checking if database initialization is needed...');

  // Check if data directory exists and has pg_version file
  const pgVersionFile = path.join(paths.dataDir, 'PG_VERSION');
  if (fs.existsSync(pgVersionFile)) {
    log('Database cluster already exists, skipping initialization');
    return false; // Not a fresh install
  }

  log('Initializing new database cluster...');

  // Create data directory
  if (!fs.existsSync(paths.dataDir)) {
    fs.mkdirSync(paths.dataDir, { recursive: true });
  }

  // Set environment for initdb
  const env = {
    ...process.env,
    PGDATA: paths.dataDir,
  };

  return new Promise((resolve, reject) => {
    const initdb = spawn(
      paths.initdb,
      [
        '-D', paths.dataDir,
        '-U', DB_USER,
        '-E', 'UTF8',
        '--locale=C',
        '-A', 'trust' // Use trust for local connections
      ],
      {
        env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      }
    );

    let stdout = '';
    let stderr = '';

    initdb.stdout.on('data', (data) => {
      stdout += data.toString();
      log(`initdb: ${data.toString().trim()}`);
    });

    initdb.stderr.on('data', (data) => {
      stderr += data.toString();
      log(`initdb stderr: ${data.toString().trim()}`, true);
    });

    initdb.on('close', (code) => {
      if (code === 0) {
        log('Database cluster initialized successfully');

        // Configuration updates are now handled by updatePostgresConfig() 
        // which runs immediately after this in the initialize() function.
        // This ensures configs are applied to both fresh and existing installations.

        resolve(true); // Fresh install
      } else {
        reject(new Error(`initdb failed with code ${code}: ${stderr}`));
      }
    });

    initdb.on('error', (err) => {
      reject(new Error(`Failed to spawn initdb: ${err.message}`));
    });
  });
}

/**
 * Start PostgreSQL server
 */
async function startPostgres(paths) {
  log('Starting PostgreSQL server...');

  // STALE PID CLEANUP: Check if postmaster.pid exists, kill associated PID and delete the file
  const lockFile = path.join(paths.dataDir, 'postmaster.pid');
  if (fs.existsSync(lockFile)) {
    try {
      log('Stale PID file found. Attempting to kill associated process and clean up...');
      const pidContent = fs.readFileSync(lockFile, 'utf8');
      const lines = pidContent.split('\n');
      if (lines.length > 0) {
        const pid = parseInt(lines[0]);
        if (!isNaN(pid)) {
          try {
            process.kill(pid, 0); // Check if process exists
            log(`Process ${pid} is running, attempting to kill...`);
            process.kill(pid, 'SIGTERM');
            await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for graceful shutdown
            try {
              process.kill(pid, 0); // Check again if process is still running
              process.kill(pid, 'SIGKILL'); // Force kill if still running
              log(`Force killed process ${pid}`);
            } catch (e) {
              log(`Process ${pid} already terminated`);
            }
          } catch (e) {
            log(`Process ${pid} not found or already terminated`);
          }
        }
      }
      fs.unlinkSync(lockFile);
      log('Cleaned up stale PID file');
    } catch (e) {
      log(`Warning: Failed to cleanup stale PID file: ${e.message}`, true);
    }
  }

  // Check if port is available
  const portAvailable = await isPortAvailable(DB_PORT);

  if (!portAvailable) {
    log(`Port ${DB_PORT} is already in use. Checking if it's our PostgreSQL...`);
    try {
      await waitForPostgres(paths, 5000);
      log('PostgreSQL is already running on our port');
      return true;
    } catch {
      throw new Error(`Port ${DB_PORT} is in use by another application`);
    }
  }

  // Set environment
  const env = {
    ...process.env,
    PGDATA: paths.dataDir,
    PGPORT: String(DB_PORT),
  };

  return new Promise((resolve, reject) => {
    // Start postgres directly (not pg_ctl) for better process management
    pgProcess = spawn(
      paths.postgres,
      [
        '-D', paths.dataDir,
        '-p', String(DB_PORT),
        '-h', '0.0.0.0'
      ],
      {
        env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false
      }
    );

    pgProcess.stdout.on('data', (data) => {
      log(`postgres: ${data.toString().trim()}`);
    });

    pgProcess.stderr.on('data', (data) => {
      const msg = data.toString().trim();
      // PostgreSQL logs to stderr by default
      if (msg.includes('database system is ready')) {
        log('PostgreSQL is ready to accept connections');
      } else if (msg.includes('LOG:') || msg.includes('HINT:')) {
        log(`postgres: ${msg}`);
      } else if (msg) {
        log(`postgres: ${msg}`);
      }
    });

    pgProcess.on('close', (code) => {
      if (!isShuttingDown) {
        log(`PostgreSQL process exited unexpectedly with code ${code}`, true);
        pgProcess = null;

        // AUTOMATED CRASH RECOVERY: If the postgres.exe process exits unexpectedly during startup, attempt repair
        try {
          log('Attempting automated crash recovery...');
          const resetWalExe = path.join(paths.binDir, 'pg_resetwal.exe');
          if (fs.existsSync(resetWalExe)) {
            log('Running pg_resetwal.exe -f to repair database...');
            const resetProc = spawn(resetWalExe, ['-f', paths.dataDir], { windowsHide: true });
            resetProc.on('close', (resetCode) => {
              if (resetCode === 0) {
                log('Automatic crash recovery completed successfully');
              } else {
                log(`Crash recovery failed with code ${resetCode}`, true);
              }
            });
          } else {
            log('pg_resetwal.exe not found, cannot perform automated recovery', true);
          }
        } catch (e) {
          log(`Recovery attempt failed: ${e.message}`, true);
        }

        try {
          const flag = path.join(paths.dataDir, 'unexpected_exit.flag');
          const last = path.join(paths.dataDir, 'last_exit.json');
          const payload = JSON.stringify({ code: typeof code === 'number' ? code : -1, ts: Date.now() });
          fs.writeFileSync(last, payload, 'utf8');
          if (typeof code === 'number' && code !== 0) fs.writeFileSync(flag, '1');
        } catch { }
      }
    });

    pgProcess.on('error', (err) => {
      reject(new Error(`Failed to start PostgreSQL: ${err.message}`));
    });

    // Wait for PostgreSQL to be ready
    waitForPostgres(paths, 90000)
      .then(() => {
        log('PostgreSQL started successfully');
        resolve(true);
      })
      .catch(reject);
  });
}

/**
 * Create the application database if it doesn't exist
 */
async function createDatabase(paths) {
  log(`Checking if database '${DB_NAME}' exists...`);

  return new Promise((resolve, reject) => {
    // First, check if database exists
    const checkDb = spawn(
      paths.psql,
      [
        '-h', '127.0.0.1',
        '-p', String(DB_PORT),
        '-U', DB_USER,
        '-d', 'postgres',
        '-tAc', `SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'`
      ],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
    );

    let output = '';
    checkDb.stdout.on('data', (data) => { output += data.toString(); });

    checkDb.on('close', (code) => {
      if (output.trim() === '1') {
        log(`Database '${DB_NAME}' already exists`);
        resolve(false); // Database already exists
        return;
      }

      // Create the database
      log(`Creating database '${DB_NAME}'...`);
      const createDb = spawn(
        paths.psql,
        [
          '-h', '127.0.0.1',
          '-p', String(DB_PORT),
          '-U', DB_USER,
          '-d', 'postgres',
          '-c', `CREATE DATABASE ${DB_NAME} ENCODING 'UTF8'`
        ],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
      );

      let createErr = '';
      createDb.stderr.on('data', (data) => { createErr += data.toString(); });

      createDb.on('close', (createCode) => {
        if (createCode === 0) {
          log(`Database '${DB_NAME}' created successfully`);
          resolve(true); // Database was created
        } else {
          reject(new Error(`Failed to create database: ${createErr}`));
        }
      });
    });

    checkDb.on('error', (err) => {
      reject(new Error(`Failed to check database: ${err.message}`));
    });
  });
}

/**
 * Seed the database with schema.sql
 */
async function seedDatabase(paths) {
  log('Seeding database with schema...');

  if (!fs.existsSync(paths.schemaPath)) {
    log(`Warning: schema.sql not found at ${paths.schemaPath}`, true);
    return false;
  }

  return new Promise((resolve, reject) => {
    const psql = spawn(
      paths.psql,
      [
        '-h', '127.0.0.1',
        '-p', String(DB_PORT),
        '-U', DB_USER,
        '-d', DB_NAME,
        '-f', paths.schemaPath,
        '-v', 'ON_ERROR_STOP=1'
      ],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
    );

    let stdout = '';
    let stderr = '';

    psql.stdout.on('data', (data) => { stdout += data.toString(); });
    psql.stderr.on('data', (data) => { stderr += data.toString(); });

    psql.on('close', (code) => {
      if (code === 0) {
        log('Database schema applied successfully');
        resolve(true);
      } else {
        // Some errors are expected (e.g., "already exists")
        if (stderr.includes('already exists')) {
          log('Schema already applied (some objects already exist)');
          resolve(true);
        } else {
          log(`Schema application warning: ${stderr}`, true);
          // Don't reject - let the app continue
          resolve(true);
        }
      }
    });

    psql.on('error', (err) => {
      reject(new Error(`Failed to seed database: ${err.message}`));
    });
  });
}

/**
 * Stop PostgreSQL server
 */
async function stopPostgres(paths) {
  isShuttingDown = true;
  log('Stopping PostgreSQL server...');

  return new Promise((resolve) => {
    const attemptForceKill = () => {
      const timeout = setTimeout(() => {
        log('PostgreSQL did not stop gracefully, forcing termination');
        try {
          if (pgProcess && !pgProcess.killed) {
            pgProcess.kill('SIGKILL');
          }
        } catch (e) {
          log(`Error killing process: ${e.message}`, true);
        }
        resolve();
      }, 10000);
      if (pgProcess) {
        pgProcess.on('close', () => {
          clearTimeout(timeout);
          log('PostgreSQL stopped');
          pgProcess = null;
          resolve();
        });
        try {
          pgProcess.kill('SIGTERM');
        } catch (e) {
          log(`Error sending SIGTERM: ${e.message}`, true);
          clearTimeout(timeout);
          resolve();
        }
      } else {
        clearTimeout(timeout);
        resolve();
      }
    };

    try {
      const ctl = path.join(paths.binDir, 'pg_ctl.exe');
      if (fs.existsSync(ctl)) {
        log('Attempting graceful shutdown via pg_ctl stop -m fast ...');
        const stop = spawn(ctl, ['stop', '-D', paths.dataDir, '-m', 'fast'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        let err = '';
        stop.stderr.on('data', d => { err += String(d || '') });
        stop.on('close', (code) => {
          if (code === 0) {
            log('pg_ctl reported PostgreSQL stopped');
            pgProcess = null;
            resolve();
          } else {
            log(`pg_ctl stop failed (${code}): ${err}`, true);
            attemptForceKill();
          }
        });
        stop.on('error', () => attemptForceKill());
      } else {
        attemptForceKill();
      }
    } catch {
      attemptForceKill();
    }
  });
}

/**
 * Get database connection configuration
 */
function getConnectionConfig() {
  return {
    host: '127.0.0.1',
    port: DB_PORT,
    database: DB_NAME,
    user: DB_USER,
    password: DB_PASSWORD,
  };
}

/**
 * Get database connection string
 */
function getConnectionString() {
  return `postgresql://${DB_USER}:${DB_PASSWORD}@127.0.0.1:${DB_PORT}/${DB_NAME}`;
}

/**
 * Add firewall rule for PostgreSQL port
 */
function addFirewallRule() {
  return new Promise((resolve, reject) => {
    const ruleName = `PostgreSQL (COREPMS)`;
    const command = `netsh advfirewall firewall add rule name="${ruleName}" dir=in action=allow protocol=TCP localport=${DB_PORT}`;

    exec(command, (error, stdout, stderr) => {
      if (error) {
        log(`Firewall rule error: ${stderr}`, true);
        // Don't reject, just log the error
        resolve();
      } else {
        log(`Firewall rule added/updated for port ${DB_PORT}`);
        resolve();
      }
    });
  });
}

/**
 * Update PostgreSQL configuration files
 * Ensures settings are applied to both new and existing installations
 */
function updatePostgresConfig(paths) {
  log('Updating PostgreSQL configuration...');
  try {
    const confPath = path.join(paths.dataDir, 'postgresql.conf');
    if (!fs.existsSync(confPath)) {
      log('Warning: postgresql.conf not found, skipping config update', true);
      return;
    }

    // ENFORCE CRITICAL SAFETY CONFIG: Overwrite postgresql.conf every time the app starts
    let conf = `# CorePMS Configuration (Auto-generated)
# DO NOT MODIFY - This file is overwritten on every startup

# Connection Settings
port = ${DB_PORT}
listen_addresses = '*'
max_connections = 100

# Data Safety Settings (CRITICAL - These enforce durability)
synchronous_commit = on  # CRITICAL: Force WAL flush on every transaction
fsync = on              # CRITICAL: Ensure kernel writes are flushed to disk
full_page_writes = on   # Protect against partial page writes
wal_sync_method = fsync

# Performance Tuning (Balanced for durability and performance)
shared_buffers = 128MB
work_mem = 4MB
maintenance_work_mem = 64MB
effective_cache_size = 512MB
checkpoint_completion_target = 0.9
wal_buffers = 16MB
max_wal_size = 1GB
min_wal_size = 80MB

# Logging
log_destination = 'stderr'
logging_collector = off
log_min_messages = warning
log_line_prefix = '%t [%p]: [%l-1] user=%u,db=%d,app=%a,client=%h '

# Authentication
password_encryption = md5
`;

    // Dynamic Memory Tuning
    try {
      const os = require('os');
      const totalMem = os.totalmem();
      const isUltraLowMem = totalMem < 3 * 1024 * 1024 * 1024; // < 3GB
      const isLowMem = totalMem < 8 * 1024 * 1024 * 1024; // < 8GB

      if (isUltraLowMem) {
        log(`Detected Ultra-Low RAM System (${Math.round(totalMem / 1024 / 1024)} MB). Applying aggressive optimization.`);
        conf = conf.replace('shared_buffers = 128MB', 'shared_buffers = 32MB');
        conf = conf.replace('work_mem = 4MB', 'work_mem = 2MB');
        conf = conf.replace('maintenance_work_mem = 64MB', 'maintenance_work_mem = 16MB');
        conf = conf.replace('effective_cache_size = 512MB', 'effective_cache_size = 128MB');
        conf = conf.replace('max_connections = 100', 'max_connections = 20');
        conf = conf.replace('wal_buffers = 16MB', 'wal_buffers = 4MB');
      } else if (isLowMem) {
        log(`Detected Low RAM System (${Math.round(totalMem / 1024 / 1024)} MB). Applying optimized config.`);
        conf = conf.replace('shared_buffers = 128MB', 'shared_buffers = 64MB');
        conf = conf.replace('maintenance_work_mem = 64MB', 'maintenance_work_mem = 32MB');
        conf = conf.replace('effective_cache_size = 512MB', 'effective_cache_size = 256MB');
        conf = conf.replace('max_connections = 100', 'max_connections = 60');
      }
    } catch (e) {
      log(`Memory tuning failed: ${e.message}`, true);
    }

    fs.writeFileSync(confPath, conf);
    log('postgresql.conf forcefully overwritten with critical safety settings');

    // Update pg_hba.conf for network authentication
    const hbaPath = path.join(paths.dataDir, 'pg_hba.conf');
    const hba = `
# TYPE  DATABASE        USER            ADDRESS                 METHOD
local   all             all                                     trust
host    all             all             0.0.0.0/0               trust
host    all             all             ::1/128                 trust
`;
    fs.writeFileSync(hbaPath, hba);
    log('pg_hba.conf updated with 0.0.0.0/0 trust');

  } catch (e) {
    log(`Warning: Could not update database configuration: ${e.message}`, true);
  }
}

function runPgResetWal(paths) {
  return new Promise((resolve, reject) => {
    try {
      const exe = path.join(paths.binDir, 'pg_resetwal.exe');
      if (!fs.existsSync(exe)) {
        reject(new Error('pg_resetwal.exe not found'));
        return;
      }
      const p = spawn(exe, ['-f', paths.dataDir], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let err = '';
      p.stderr.on('data', d => { err += String(d || '') });
      p.on('close', code => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(err || `pg_resetwal failed (${code})`));
        }
      });
      p.on('error', e => reject(e));
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Main initialization function
 * Called from main.cjs on app startup
 */
async function initialize(app) {
  const paths = getPaths(app);

  // Initialize logger
  initLogger(paths.logsDir);

  log('=== Database Initialization Starting ===');
  log(`PostgreSQL binaries: ${paths.postgresRoot}`);
  log(`Data directory: ${paths.dataDir}`);
  log(`Port: ${DB_PORT}`);

  // Check if PostgreSQL binaries exist
  if (!fs.existsSync(paths.postgres)) {
    throw new Error(`PostgreSQL binaries not found at ${paths.postgresRoot}`);
  }

  try {
    const flag = path.join(paths.dataDir, 'unexpected_exit.flag');
    if (fs.existsSync(flag)) {
      try {
        await runPgResetWal(paths);
        fs.unlinkSync(flag);
      } catch (e) {
        log(`pg_resetwal failed: ${e.message}`, true);
      }
    }
    // Add firewall rule
    await addFirewallRule();

    // Step 1: Initialize database cluster if needed
    const isFreshInstall = await initializeDatabase(paths);

    // Step 1.5: Ensure configuration is up-to-date (for both new and existing DBs)
    updatePostgresConfig(paths);

    // Step 2: Start PostgreSQL
    try {
      await startPostgres(paths);
    } catch (startError) {
      log(`PostgreSQL start failed: ${startError.message}. Attempting automated recovery...`, true);

      // RECOVERY: Run pg_resetwal -f to fix potential log corruption
      try {
        log('Running pg_resetwal -f as last-resort recovery...');
        await runPgResetWal(paths);
        log('pg_resetwal completed. Retrying startup...');

        // Retry start
        await startPostgres(paths);
        log('PostgreSQL started successfully after recovery.');
      } catch (recoveryError) {
        log(`Recovery failed: ${recoveryError.message}`, true);
        throw startError; // Throw original error if recovery fails
      }
    }

    // Step 3: Create database if needed
    const dbCreated = await createDatabase(paths);

    // Step 4: Seed schema if fresh install or database was just created
    if (isFreshInstall || dbCreated) {
      await seedDatabase(paths);
    }

    log('=== Database Initialization Complete ===');
    log(`Connection: ${getConnectionString()}`);

    return {
      success: true,
      connectionString: getConnectionString(),
      config: getConnectionConfig(),
      isFreshInstall,
    };

  } catch (error) {
    log(`Database initialization failed: ${error.message}`, true);
    throw error;
  }
}

/**
 * Shutdown function
 * Called from main.cjs on app quit
 */
async function shutdown(app) {
  const paths = getPaths(app);
  log('=== Database Shutdown Starting ===');

  try {
    await stopPostgres(paths);
    log('=== Database Shutdown Complete ===');
    try {
      const last = path.join(paths.dataDir, 'last_exit.json');
      fs.writeFileSync(last, JSON.stringify({ code: 0, ts: Date.now() }), 'utf8');
      const flag = path.join(paths.dataDir, 'unexpected_exit.flag');
      if (fs.existsSync(flag)) fs.unlinkSync(flag);
    } catch { }

    // Mark log stream as closed BEFORE ending it to prevent write-after-end errors
    if (logStream) {
      logStreamClosed = true;
      try {
        logStream.end();
      } catch (e) {
        console.warn('[DB-Lifecycle] Error closing log stream:', e.message);
      }
      logStream = null;
    }
  } catch (error) {
    log(`Shutdown error: ${error.message}`, true);
    // Still try to close the log stream even on error
    if (logStream) {
      logStreamClosed = true;
      try {
        logStream.end();
      } catch (e) {
        // Ignore
      }
      logStream = null;
    }
  }
}

/**
 * Check if PostgreSQL is running
 */
function isRunning() {
  return pgProcess !== null && !pgProcess.killed;
}

// Export functions
module.exports = {
  initialize,
  shutdown,
  getConnectionConfig,
  getConnectionString,
  isRunning,
  DB_PORT,
  DB_NAME,
  DB_USER,
};
