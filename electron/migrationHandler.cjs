// Electron Main Process Database Migration Handler
// Integrates with the renderer's migration service and handles file system operations

const fs = require('fs').promises;
const path = require('path');

class ElectronMigrationHandler {
  constructor(app) {
    this.app = app;
    this.migrationsPath = this.getMigrationsPath();
  }

  getMigrationsPath() {
    if (this.app.isPackaged) {
      return path.join(process.resourcesPath, 'db', 'migration');
    }
    return path.join(__dirname, '..', 'db', 'migration');
  }

  async getMigrationFiles() {
    try {
      const files = await fs.readdir(this.migrationsPath);
      // Filter for migration files with V#__ pattern
      const migrationFiles = files
        .filter(file => /^V\d+__.+\.sql$/.test(file))
        .sort(); // Natural sort should work for V1, V2, V3, etc.
      
      console.log(`[Electron-Migration] Found ${migrationFiles.length} migration files`);
      return migrationFiles;
    } catch (error) {
      console.error('[Electron-Migration] Failed to read migration directory:', error);
      return [];
    }
  }

  async readMigrationFile(filename) {
    try {
      const filePath = path.join(this.migrationsPath, filename);
      const content = await fs.readFile(filePath, 'utf8');
      return content;
    } catch (error) {
      console.error(`[Electron-Migration] Failed to read migration file ${filename}:`, error);
      throw error;
    }
  }

  calculateChecksum(content) {
    // Simple checksum algorithm
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }

  async ensureMigrationTable(client) {
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version VARCHAR(50) PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          filename VARCHAR(255) NOT NULL,
          checksum VARCHAR(64) NOT NULL,
          applied_at TIMESTAMP NOT NULL DEFAULT NOW(),
          execution_time_ms INTEGER DEFAULT 0
        )
      `);
      
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_schema_migrations_applied_at 
        ON schema_migrations(applied_at)
      `);
      
      console.log('[Electron-Migration] Migration tracking table ensured');
      return true;
    } catch (error) {
      console.error('[Electron-Migration] Failed to create migration table:', error);
      return false;
    }
  }

  async getAppliedMigrations(client) {
    try {
      const result = await client.query(
        'SELECT version, filename, checksum, applied_at FROM schema_migrations ORDER BY version'
      );
      
      const applied = {};
      if (result.rows) {
        result.rows.forEach(row => {
          applied[row.version] = {
            version: row.version,
            filename: row.filename,
            checksum: row.checksum,
            appliedAt: new Date(row.applied_at)
          };
        });
      }
      
      return applied;
    } catch (error) {
      console.error('[Electron-Migration] Failed to get applied migrations:', error);
      return {};
    }
  }

  async applyMigration(client, migration) {
    const startTime = Date.now();
    
    try {
      console.log(`[Electron-Migration] Applying ${migration.version}: ${migration.name}`);
      
      // Split SQL into statements and execute each
      const statements = migration.content
        .split(';')
        .map(stmt => stmt.trim())
        .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));
      
      // Execute in transaction
      await client.query('BEGIN');
      
      for (const statement of statements) {
        if (statement.trim()) {
          await client.query(statement);
        }
      }
      
      const executionTimeMs = Date.now() - startTime;
      
      // Record successful migration
      await client.query(
        `INSERT INTO schema_migrations (version, name, filename, checksum, execution_time_ms) 
         VALUES ($1, $2, $3, $4, $5)`,
        [migration.version, migration.name, migration.filename, migration.checksum, executionTimeMs]
      );
      
      await client.query('COMMIT');
      
      console.log(`[Electron-Migration] Successfully applied ${migration.version} in ${executionTimeMs}ms`);
      return { success: true, executionTimeMs };
      
    } catch (error) {
      const executionTimeMs = Date.now() - startTime;
      console.error(`[Electron-Migration] Failed to apply ${migration.version}:`, error);
      
      // Rollback transaction
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('[Electron-Migration] Rollback failed:', rollbackError);
      }
      
      return { 
        success: false, 
        executionTimeMs,
        error: error.message || 'Migration failed'
      };
    }
  }

  async runMigrations(connectionString) {
    const startTime = Date.now();
    const pg = require('pg');
    const client = new pg.Client(connectionString);
    
    const result = {
      success: true,
      appliedMigrations: [],
      failedMigrations: [],
      totalTimeMs: 0,
      message: ''
    };

    try {
      console.log('[Electron-Migration] Starting database migration process...');
      
      await client.connect();
      
      // Ensure migration tracking table exists
      const tableCreated = await this.ensureMigrationTable(client);
      if (!tableCreated) {
        throw new Error('Failed to create migration tracking table');
      }
      
      // Get migration files and applied migrations
      const migrationFiles = await this.getMigrationFiles();
      const appliedMigrations = await this.getAppliedMigrations(client);
      
      console.log(`[Electron-Migration] Found ${migrationFiles.length} migrations, ${Object.keys(appliedMigrations).length} already applied`);
      
      // Process each migration file
      for (const filename of migrationFiles) {
        try {
          // Parse version and name from filename (V1__name.sql format)
          const match = filename.match(/^V(\d+(?:_\w+)*)__(.+)\.sql$/);
          if (!match) {
            console.warn(`[Electron-Migration] Skipping invalid migration filename: ${filename}`);
            continue;
          }
          
          const [, version, name] = match;
          const fullVersion = `V${version}`;
          
          // Skip if already applied
          if (appliedMigrations[fullVersion]) {
            console.log(`[Electron-Migration] Skipping already applied migration: ${fullVersion}`);
            continue;
          }
          
          // Read and process migration
          const content = await this.readMigrationFile(filename);
          const checksum = this.calculateChecksum(content);
          
          const migration = {
            version: fullVersion,
            name: name.replace(/_/g, ' '),
            filename,
            content,
            checksum
          };
          
          const migrationResult = await this.applyMigration(client, migration);
          
          if (migrationResult.success) {
            result.appliedMigrations.push(fullVersion);
          } else {
            result.failedMigrations.push({
              version: fullVersion,
              error: migrationResult.error
            });
            result.success = false;
            console.error(`[Electron-Migration] Stopping due to migration failure: ${fullVersion}`);
            break;
          }
          
        } catch (error) {
          result.failedMigrations.push({
            version: 'unknown',
            error: error.message || 'Failed to process migration file'
          });
          result.success = false;
          console.error('[Electron-Migration] Critical error processing migrations:', error);
          break;
        }
      }
      
      result.totalTimeMs = Date.now() - startTime;
      
      if (result.success) {
        console.log(`[Electron-Migration] Migration process completed successfully in ${result.totalTimeMs}ms`);
        result.message = `Successfully applied ${result.appliedMigrations.length} migrations`;
      } else {
        console.error(`[Electron-Migration] Migration process failed after ${result.totalTimeMs}ms`);
        result.message = `Failed to apply ${result.failedMigrations.length} migrations`;
      }
      
      return result;
      
    } catch (error) {
      result.success = false;
      result.totalTimeMs = Date.now() - startTime;
      result.message = error.message || 'Migration process failed';
      console.error('[Electron-Migration] Migration process failed:', error);
      return result;
      
    } finally {
      try {
        await client.end();
      } catch (error) {
        console.error('[Electron-Migration] Failed to close database connection:', error);
      }
    }
  }

  async getMigrationStatus(connectionString) {
    const pg = require('pg');
    const client = new pg.Client(connectionString);
    
    try {
      await client.connect();
      
      const tableExistsResult = await client.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = 'schema_migrations'
        )
      `);
      
      const tableExists = tableExistsResult.rows[0].exists;
      
      if (!tableExists) {
        return {
          isUpToDate: false,
          totalMigrations: 0,
          appliedMigrations: 0,
          pendingMigrations: 0,
          lastApplied: null
        };
      }
      
      const migrationFiles = await this.getMigrationFiles();
      const appliedResult = await client.query('SELECT COUNT(*) as count FROM schema_migrations');
      const appliedCount = parseInt(appliedResult.rows[0].count);
      
      const lastAppliedResult = await client.query(
        'SELECT MAX(applied_at) as last_applied FROM schema_migrations'
      );
      const lastApplied = lastAppliedResult.rows[0].last_applied 
        ? new Date(lastAppliedResult.rows[0].last_applied) 
        : null;
      
      return {
        isUpToDate: appliedCount === migrationFiles.length,
        totalMigrations: migrationFiles.length,
        appliedMigrations: appliedCount,
        pendingMigrations: migrationFiles.length - appliedCount,
        lastApplied
      };
      
    } catch (error) {
      console.error('[Electron-Migration] Failed to get migration status:', error);
      return {
        isUpToDate: false,
        totalMigrations: 0,
        appliedMigrations: 0,
        pendingMigrations: 0,
        lastApplied: null
      };
    } finally {
      try {
        await client.end();
      } catch (error) {
        console.error('[Electron-Migration] Failed to close database connection:', error);
      }
    }
  }
}

module.exports = ElectronMigrationHandler;