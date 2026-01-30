const fs = require('fs');
const path = require('path');

/**
 * Database Migration Service
 * Handles automatic database schema migrations for the Electron application
 */
class MigrationService {
  constructor(app) {
    this.app = app;
    this.migrationDir = this.getMigrationDirectory();
    this.migrationTable = '_migrations';
    this.logger = {
      info: (msg) => console.log(`[Migration] ${msg}`),
      warn: (msg) => console.warn(`[Migration] ${msg}`),
      error: (msg) => console.error(`[Migration] ${msg}`)
    };
  }

  /**
   * Get the migration directory path
   */
  getMigrationDirectory() {
    if (this.app.isPackaged) {
      return path.join(process.resourcesPath, 'db', 'migration');
    }
    return path.join(__dirname, '..', 'db', 'migration');
  }

  /**
   * Parse migration filename to extract version and description
   */
  parseMigrationFilename(filename) {
    const match = filename.match(/^V(\d+)__(.+)\.sql$/);
    if (!match) return null;

    return {
      version: parseInt(match[1], 10),
      description: match[2].replace(/_/g, ' '),
      filename: filename
    };
  }

  /**
   * Get all migration files sorted by version
   */
  getMigrationFiles() {
    try {
      if (!fs.existsSync(this.migrationDir)) {
        this.logger.warn(`Migration directory not found: ${this.migrationDir}`);
        return [];
      }

      const files = fs.readdirSync(this.migrationDir)
        .filter(file => file.endsWith('.sql') && file.startsWith('V'))
        .map(file => this.parseMigrationFilename(file))
        .filter(Boolean)
        .sort((a, b) => a.version - b.version);

      this.logger.info(`Found ${files.length} migration files`);
      return files;
    } catch (error) {
      this.logger.error(`Failed to read migration directory: ${error.message}`);
      return [];
    }
  }

  /**
   * Create migration tracking table if it doesn't exist
   */
  async createMigrationTable(client) {
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS ${this.migrationTable} (
        id SERIAL PRIMARY KEY,
        version INTEGER NOT NULL UNIQUE,
        description TEXT NOT NULL,
        filename TEXT NOT NULL,
        installed_on TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        success BOOLEAN NOT NULL DEFAULT TRUE,
        checksum TEXT,
        execution_time INTEGER
      )
    `;

    await client.query(createTableSQL);
    this.logger.info('Migration tracking table ensured');
  }

  /**
   * Get already applied migrations
   */
  async getAppliedMigrations(client) {
    try {
      const result = await client.query(
        `SELECT version, description, filename, installed_on, checksum 
         FROM ${this.migrationTable} 
         WHERE success = TRUE 
         ORDER BY version ASC`
      );
      return result.rows;
    } catch (error) {
      this.logger.warn(`Failed to get applied migrations: ${error.message}`);
      return [];
    }
  }

  /**
   * Calculate checksum for migration content
   */
  calculateChecksum(content) {
    // Simple checksum - in production you might want to use crypto
    return content.split('').reduce((a, b) => {
      a = ((a << 5) - a) + b.charCodeAt(0);
      return a & a;
    }, 0).toString();
  }

  /**
   * Apply a single migration
   */
  async applyMigration(client, migration) {
    const migrationPath = path.join(this.migrationDir, migration.filename);

    if (!fs.existsSync(migrationPath)) {
      throw new Error(`Migration file not found: ${migrationPath}`);
    }

    const sqlContent = fs.readFileSync(migrationPath, 'utf8');
    const checksum = this.calculateChecksum(sqlContent);

    this.logger.info(`Applying migration V${migration.version}__${migration.description}`);

    const startTime = Date.now();

    try {
      // Start transaction
      await client.query('BEGIN');

      // Execute migration
      await client.query(sqlContent);

      // Record successful migration
      await client.query(
        `INSERT INTO ${this.migrationTable} 
         (version, description, filename, checksum, execution_time) 
         VALUES ($1, $2, $3, $4, $5)`,
        [
          migration.version,
          migration.description,
          migration.filename,
          checksum,
          Date.now() - startTime
        ]
      );

      // Commit transaction
      await client.query('COMMIT');

      this.logger.info(`Successfully applied migration V${migration.version} (${Date.now() - startTime}ms)`);
      return { success: true, executionTime: Date.now() - startTime };

    } catch (error) {
      // Rollback on error
      await client.query('ROLLBACK');

      // Record failed migration
      try {
        await client.query(
          `INSERT INTO ${this.migrationTable} 
           (version, description, filename, success, checksum, execution_time) 
           VALUES ($1, $2, $3, FALSE, $4, $5)`,
          [
            migration.version,
            migration.description,
            migration.filename,
            checksum,
            Date.now() - startTime
          ]
        );
      } catch (recordError) {
        this.logger.error(`Failed to record migration failure: ${recordError.message}`);
      }

      this.logger.error(`Failed to apply migration V${migration.version}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Validate migration checksums
   */
  async validateMigrations(client, migrations) {
    const applied = await this.getAppliedMigrations(client);

    for (const appliedMigration of applied) {
      const current = migrations.find(m => m.version === appliedMigration.version);
      if (current) {
        const migrationPath = path.join(this.migrationDir, current.filename);
        if (fs.existsSync(migrationPath)) {
          const content = fs.readFileSync(migrationPath, 'utf8');
          const currentChecksum = this.calculateChecksum(content);

          if (currentChecksum !== appliedMigration.checksum) {
            throw new Error(
              `Checksum mismatch for migration V${current.version}. ` +
              `Expected: ${appliedMigration.checksum}, Got: ${currentChecksum}`
            );
          }
        }
      }
    }

    return true;
  }

  /**
   * Get pending migrations
   */
  async getPendingMigrations(client) {
    const allMigrations = this.getMigrationFiles();
    const appliedMigrations = await this.getAppliedMigrations(client);

    const appliedVersions = new Set(appliedMigrations.map(m => m.version));
    const pending = allMigrations.filter(m => !appliedVersions.has(m.version));

    this.logger.info(`Found ${pending.length} pending migrations`);
    return pending;
  }

  /**
   * Run all pending migrations
   */
  async runMigrations(connectionString, pgClient) {
    const { Client } = require('pg');
    let client = pgClient;

    // Create new client if not provided
    const shouldCloseClient = !client;
    if (!client) {
      client = new Client(connectionString);
      await client.connect();
    }

    try {
      // Ensure migration table exists
      await this.createMigrationTable(client);

      // Validate existing migrations
      const allMigrations = this.getMigrationFiles();
      await this.validateMigrations(client, allMigrations);

      // Get pending migrations
      const pendingMigrations = await this.getPendingMigrations(client);

      if (pendingMigrations.length === 0) {
        this.logger.info('Database schema is up to date');
        return {
          success: true,
          message: 'Database schema is up to date',
          applied: [],
          pending: 0
        };
      }

      this.logger.info(`Applying ${pendingMigrations.length} pending migrations...`);

      const applied = [];
      let totalTime = 0;

      // Apply each pending migration
      for (const migration of pendingMigrations) {
        try {
          const result = await this.applyMigration(client, migration);
          applied.push({
            version: migration.version,
            description: migration.description,
            executionTime: result.executionTime
          });
          totalTime += result.executionTime;
        } catch (error) {
          throw new Error(
            `Migration V${migration.version} (${migration.description}) failed: ${error.message}`
          );
        }
      }

      this.logger.info(`All migrations applied successfully in ${totalTime}ms`);

      return {
        success: true,
        message: `Successfully applied ${applied.length} migrations`,
        applied: applied,
        totalTime: totalTime,
        pending: 0
      };

    } catch (error) {
      this.logger.error(`Migration process failed: ${error.message}`);
      throw error;
    } finally {
      // Close client if we created it
      if (shouldCloseClient && client) {
        await client.end().catch(() => { });
      }
    }
  }

  /**
   * Get migration status
   */
  async getMigrationStatus(connectionString, pgClient) {
    const { Client } = require('pg');
    let client = pgClient;

    const shouldCloseClient = !client;
    if (!client) {
      client = new Client(connectionString);
      await client.connect();
    }

    try {
      // Ensure migration table exists
      await this.createMigrationTable(client);

      const allMigrations = this.getMigrationFiles();
      const appliedMigrations = await this.getAppliedMigrations(client);
      const pendingMigrations = await this.getPendingMigrations(client);

      const appliedMap = new Map(appliedMigrations.map(m => [m.version, m]));

      const migrationDetails = allMigrations.map(migration => ({
        version: migration.version,
        description: migration.description,
        filename: migration.filename,
        status: appliedMap.has(migration.version) ? 'applied' : 'pending',
        installedOn: appliedMap.get(migration.version)?.installed_on || null
      }));

      return {
        total: allMigrations.length,
        applied: appliedMigrations.length,
        pending: pendingMigrations.length,
        migrations: migrationDetails,
        isUpToDate: pendingMigrations.length === 0
      };

    } finally {
      if (shouldCloseClient && client) {
        await client.end().catch(() => { });
      }
    }
  }

  /**
   * Run migrations automatically on startup
   */
  async autoMigrate(connectionString) {
    try {
      this.logger.info('Starting automatic database migration...');

      const result = await this.runMigrations(connectionString);

      if (result.applied.length > 0) {
        this.logger.info(`${result.applied.length} migrations were applied automatically`);
      }

      return result;
    } catch (error) {
      this.logger.error(`Automatic migration failed: ${error.message}`);
      throw error;
    }
  }
}

module.exports = MigrationService;