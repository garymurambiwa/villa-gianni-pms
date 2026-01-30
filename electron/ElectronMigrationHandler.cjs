const MigrationService = require('./MigrationService.cjs');
const { Client } = require('pg');

/**
 * Electron Migration Handler
 * Integrates the migration service with Electron's IPC system
 */
class ElectronMigrationHandler {
  constructor(app) {
    this.app = app;
    this.migrationService = new MigrationService(app);
    this.logger = {
      info: (msg) => console.log(`[Electron-Migration] ${msg}`),
      warn: (msg) => console.warn(`[Electron-Migration] ${msg}`),
      error: (msg) => console.error(`[Electron-Migration] ${msg}`)
    };
  }

  /**
   * Get database connection string from Electron's configuration
   */
  getConnectionString() {
    // This will be injected by the main process
    // For now, we'll expect it to be passed in
    return null;
  }

  /**
   * Run migrations with proper error handling
   */
  async runMigrations(connectionString) {
    try {
      this.logger.info('Initiating migration process...');
      
      const result = await this.migrationService.runMigrations(connectionString);
      
      this.logger.info('Migration process completed successfully');
      return {
        success: true,
        message: result.message,
        applied: result.applied,
        pending: result.pending,
        totalTime: result.totalTime
      };
      
    } catch (error) {
      this.logger.error(`Migration process failed: ${error.message}`);
      
      return {
        success: false,
        message: `Migration failed: ${error.message}`,
        error: error.message,
        applied: [],
        pending: 0
      };
    }
  }

  /**
   * Get current migration status
   */
  async getMigrationStatus(connectionString) {
    try {
      this.logger.info('Checking migration status...');
      
      const status = await this.migrationService.getMigrationStatus(connectionString);
      
      return {
        success: true,
        status: {
          total: status.total,
          applied: status.applied,
          pending: status.pending,
          isUpToDate: status.isUpToDate,
          migrations: status.migrations
        }
      };
      
    } catch (error) {
      this.logger.error(`Failed to get migration status: ${error.message}`);
      
      return {
        success: false,
        message: `Failed to get migration status: ${error.message}`,
        status: null
      };
    }
  }

  /**
   * Run automatic migrations on startup
   */
  async autoMigrateOnStartup(connectionString) {
    try {
      this.logger.info('Running automatic migrations on startup...');
      
      // First check status
      const status = await this.migrationService.getMigrationStatus(connectionString);
      
      if (status.pending === 0) {
        this.logger.info('Database is already up to date');
        return {
          success: true,
          message: 'Database schema is up to date',
          migrationsApplied: 0
        };
      }
      
      this.logger.info(`Found ${status.pending} pending migrations, applying...`);
      
      // Run migrations
      const result = await this.migrationService.runMigrations(connectionString);
      
      return {
        success: true,
        message: `Applied ${result.applied.length} migrations successfully`,
        migrationsApplied: result.applied.length,
        applied: result.applied
      };
      
    } catch (error) {
      this.logger.error(`Automatic migration on startup failed: ${error.message}`);
      
      // Don't throw - let the application continue
      return {
        success: false,
        message: `Automatic migration failed: ${error.message}`,
        error: error.message,
        migrationsApplied: 0
      };
    }
  }

  /**
   * Validate migration integrity
   */
  async validateMigrations(connectionString) {
    try {
      this.logger.info('Validating migration integrity...');
      
      const { Client } = require('pg');
      const client = new Client(connectionString);
      await client.connect();
      
      try {
        const allMigrations = this.migrationService.getMigrationFiles();
        await this.migrationService.validateMigrations(client, allMigrations);
        
        return {
          success: true,
          message: 'All migrations validated successfully'
        };
      } finally {
        await client.end();
      }
      
    } catch (error) {
      this.logger.error(`Migration validation failed: ${error.message}`);
      
      return {
        success: false,
        message: `Migration validation failed: ${error.message}`,
        error: error.message
      };
    }
  }

  /**
   * Get detailed migration report
   */
  async getMigrationReport(connectionString) {
    try {
      const status = await this.migrationService.getMigrationStatus(connectionString);
      
      const report = {
        timestamp: new Date().toISOString(),
        databaseStatus: {
          totalMigrations: status.total,
          appliedMigrations: status.applied,
          pendingMigrations: status.pending,
          isUpToDate: status.isUpToDate
        },
        migrations: status.migrations.map(m => ({
          version: m.version,
          description: m.description,
          status: m.status,
          installedOn: m.installedOn
        }))
      };
      
      return {
        success: true,
        report: report
      };
      
    } catch (error) {
      return {
        success: false,
        message: `Failed to generate migration report: ${error.message}`,
        error: error.message
      };
    }
  }
}

module.exports = ElectronMigrationHandler;