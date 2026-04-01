/**
 * Real-Time Data Synchronization Service
 * 
 * Provides centralized real-time data synchronization for all modules
 * with configurable polling intervals to ensure data consistency
 * across all workstation computers within 5-10 second timeframe.
 */

import { db } from './db';

export interface SyncConfig {
  /** Polling interval in milliseconds */
  interval: number;
  /** Enable/disable specific sync modules */
  enabledModules: {
    rooms: boolean;
    reservations: boolean;
    posOrders: boolean;
    inventory: boolean;
    folioCharges: boolean;
    guests: boolean;
    cityLedger: boolean;
    vendors: boolean;
    vendorExpenses: boolean;
    vendorPayments: boolean;
    folios: boolean;
  };
  /** Maximum number of retries for failed syncs */
  maxRetries: number;
  /** Timeout for individual sync operations */
  timeoutMs: number;
}

export interface SyncStats {
  lastSync: Date | null;
  successCount: number;
  errorCount: number;
  lastError: string | null;
  isActive: boolean;
}

export class RealTimeSyncService {
  private static instance: RealTimeSyncService;
  private intervalId: NodeJS.Timeout | null = null;
  private config: SyncConfig;
  private stats: Map<string, SyncStats> = new Map();
  
  private constructor(config?: Partial<SyncConfig>) {
    this.config = {
      interval: 8000, // Default to 8 seconds to meet 5-10 second requirement
      enabledModules: {
        rooms: true,
        reservations: true,
        posOrders: true,
        inventory: true,
        folioCharges: true,
        guests: true,
        cityLedger: true,
        vendors: true,
        vendorExpenses: true,
        vendorPayments: true,
        folios: true,
      },
      maxRetries: 3,
      timeoutMs: 5000,
      ...config
    };

    // Initialize stats for each module
    Object.keys(this.config.enabledModules).forEach(module => {
      this.stats.set(module, {
        lastSync: null,
        successCount: 0,
        errorCount: 0,
        lastError: null,
        isActive: false
      });
    });
  }

  public static getInstance(config?: Partial<SyncConfig>): RealTimeSyncService {
    if (!RealTimeSyncService.instance) {
      RealTimeSyncService.instance = new RealTimeSyncService(config);
    }
    return RealTimeSyncService.instance;
  }

  /**
   * Start the real-time synchronization service
   */
  public start(): void {
    if (this.intervalId) {
      console.warn('[RealTimeSync] Service already running, stopping previous instance');
      this.stop();
    }

    console.log(`[RealTimeSync] Starting service with ${this.config.interval}ms interval`);
    
    // Perform initial sync
    this.performSync();
    
    // Start periodic sync
    this.intervalId = setInterval(() => {
      this.performSync();
    }, this.config.interval);

    // Update stats to show active state
    Object.keys(this.config.enabledModules).forEach(module => {
      const stats = this.stats.get(module);
      if (stats) {
        stats.isActive = true;
        this.stats.set(module, stats);
      }
    });
  }

  /**
   * Stop the real-time synchronization service
   */
  public stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      
      // Update stats to show inactive state
      Object.keys(this.config.enabledModules).forEach(module => {
        const stats = this.stats.get(module);
        if (stats) {
          stats.isActive = false;
          this.stats.set(module, stats);
        }
      });
      
      console.log('[RealTimeSync] Service stopped');
    }
  }

  /**
   * Manually trigger a sync operation
   */
  public async manualSync(): Promise<void> {
    await this.performSync();
  }

  /**
   * Get synchronization statistics for all modules
   */
  public getStats(): Map<string, SyncStats> {
    return new Map(this.stats);
  }

  /**
   * Get synchronization statistics for a specific module
   */
  public getModuleStats(module: string): SyncStats | undefined {
    return this.stats.get(module);
  }

  /**
   * Update configuration dynamically
   */
  public updateConfig(newConfig: Partial<SyncConfig>): void {
    this.config = { ...this.config, ...newConfig };
    console.log('[RealTimeSync] Configuration updated:', this.config);
  }

  /**
   * Perform a single synchronization cycle
   */
  private async performSync(): Promise<void> {
    console.log('[RealTimeSync] Starting sync cycle...');
    
    const promises: Promise<void>[] = [];

    // Sync each enabled module
    for (const [moduleName, isEnabled] of Object.entries(this.config.enabledModules)) {
      if (isEnabled) {
        promises.push(this.syncModule(moduleName));
      }
    }

    try {
      await Promise.all(promises);
      console.log('[RealTimeSync] Sync cycle completed successfully');
    } catch (error) {
      console.error('[RealTimeSync] Error during sync cycle:', error);
    }
  }

  /**
   * Synchronize a specific module
   */
  private async syncModule(moduleName: string): Promise<void> {
    const startTime = Date.now();
    const stats = this.stats.get(moduleName) || {
      lastSync: null,
      successCount: 0,
      errorCount: 0,
      lastError: null,
      isActive: true
    };

    try {
      // Wait for database to be ready
      const isReady = await db.waitForReady();
      if (!isReady) {
        throw new Error('Database not ready for sync');
      }

      // Perform module-specific sync
      switch (moduleName) {
        case 'rooms':
          await this.syncRooms();
          break;
        case 'reservations':
          await this.syncReservations();
          break;
        case 'posOrders':
          await this.syncPosOrders();
          break;
        case 'inventory':
          await this.syncInventory();
          break;
        case 'folioCharges':
          await this.syncFolioCharges();
          break;
        case 'guests':
          await this.syncGuests();
          break;
        case 'cityLedger':
          await this.syncCityLedger();
          break;
        case 'vendors':
          await this.syncVendors();
          break;
        case 'vendorExpenses':
          await this.syncVendorExpenses();
          break;
        case 'vendorPayments':
          await this.syncVendorPayments();
          break;
        case 'folios':
          await this.syncFolios();
          break;
        default:
          console.warn(`[RealTimeSync] Unknown module: ${moduleName}`);
          return;
      }

      // Update stats on success
      stats.lastSync = new Date();
      stats.successCount++;
      stats.lastError = null;
      this.stats.set(moduleName, stats);
      
      console.log(`[RealTimeSync] ${moduleName} sync completed in ${Date.now() - startTime}ms`);
    } catch (error: Error | unknown) {
      // Update stats on error
      stats.errorCount++;
      stats.lastError = error instanceof Error ? error.message : String(error);
      this.stats.set(moduleName, stats);
      
      console.error(`[RealTimeSync] ${moduleName} sync failed:`, error);
    }
  }

  /**
   * Sync rooms data
   */
  private async syncRooms(): Promise<void> {
    const result = await db.query('SELECT * FROM rooms ORDER BY number');
    if ('error' in result) {
      throw new Error(`Rooms sync failed: ${(result as any).error}`);
    }
    
    // Store in localStorage for immediate availability
    try {
      localStorage.setItem('corepms_rooms_sync', JSON.stringify({
        data: result.rows || [],
        timestamp: new Date().toISOString()
      }));
    } catch (e) {
      console.warn('Could not cache rooms data to localStorage:', e);
    }
  }

  /**
   * Sync reservations data
   */
  private async syncReservations(): Promise<void> {
    const result = await db.query(`
      SELECT r.*, g.full_name as guest_name, g.email as guest_email, g.phone as guest_phone,
             rm.number as room_number
      FROM reservations r
      LEFT JOIN guests g ON r.guest_id = g.id
      LEFT JOIN rooms rm ON r.room_id = rm.id
      ORDER BY r.check_in_date
    `);
    if ('error' in result) {
      throw new Error(`Reservations sync failed: ${(result as any).error}`);
    }
    
    // Store in localStorage for immediate availability
    try {
      localStorage.setItem('corepms_reservations_sync', JSON.stringify({
        data: result.rows || [],
        timestamp: new Date().toISOString()
      }));
    } catch (e) {
      console.warn('Could not cache reservations data to localStorage:', e);
    }
  }

  /**
   * Sync POS orders data
   */
  private async syncPosOrders(): Promise<void> {
    const result = await db.query('SELECT * FROM pos_orders WHERE LOWER(status::text) = LOWER(?::text)', ['open']);
    if ('error' in result) {
      throw new Error(`POS orders sync failed: ${(result as any).error}`);
    }
    
    // Store in localStorage for immediate availability
    try {
      localStorage.setItem('corepms_pos_orders_sync', JSON.stringify({
        data: result.rows || [],
        timestamp: new Date().toISOString()
      }));
    } catch (e) {
      console.warn('Could not cache POS orders data to localStorage:', e);
    }
  }

  /**
   * Sync inventory data
   */
  private async syncInventory(): Promise<void> {
    const result = await db.query('SELECT * FROM inventory_items ORDER BY name');
    if ('error' in result) {
      throw new Error(`Inventory sync failed: ${(result as any).error}`);
    }
    
    // Store in localStorage for immediate availability
    try {
      localStorage.setItem('corepms_inventory_sync', JSON.stringify({
        data: result.rows || [],
        timestamp: new Date().toISOString()
      }));
    } catch (e) {
      console.warn('Could not cache inventory data to localStorage:', e);
    }
  }

  /**
   * Sync folio charges data
   */
  private async syncFolioCharges(): Promise<void> {
    const result = await db.query('SELECT * FROM folio_charges ORDER BY posting_date DESC, inserted_at DESC');
    if ('error' in result) {
      throw new Error(`Folio charges sync failed: ${(result as any).error}`);
    }
    
    // Store in localStorage for immediate availability
    try {
      localStorage.setItem('corepms_folio_charges_sync', JSON.stringify({
        data: result.rows || [],
        timestamp: new Date().toISOString()
      }));
    } catch (e) {
      console.warn('Could not cache folio charges data to localStorage:', e);
    }
  }

  /**
   * Sync guests data
   */
  private async syncGuests(): Promise<void> {
    const result = await db.query('SELECT * FROM guests ORDER BY full_name');
    if ('error' in result) {
      throw new Error(`Guests sync failed: ${(result as any).error}`);
    }
    
    // Store in localStorage for immediate availability
    try {
      localStorage.setItem('corepms_guests_sync', JSON.stringify({
        data: result.rows || [],
        timestamp: new Date().toISOString()
      }));
    } catch (e) {
      console.warn('Could not cache guests data to localStorage:', e);
    }
  }

  /**
   * Sync city ledger data
   */
  private async syncCityLedger(): Promise<void> {
    // Sync city ledger accounts
    const accountsResult = await db.query('SELECT * FROM city_ledger_accounts ORDER BY account_name');
    if ('error' in accountsResult) {
      throw new Error(`City ledger accounts sync failed: ${(accountsResult as any).error}`);
    }

    // Sync city ledger transactions
    const transactionsResult = await db.query('SELECT *, COALESCE(date_field, date) as date FROM city_ledger_transactions ORDER BY COALESCE(date_field, date) DESC');
    if ('error' in transactionsResult) {
      throw new Error(`City ledger transactions sync failed: ${(transactionsResult as any).error}`);
    }

    // Store in localStorage for immediate availability
    try {
      localStorage.setItem('corepms_city_ledger_sync', JSON.stringify({
        accounts: accountsResult.rows || [],
        transactions: transactionsResult.rows || [],
        timestamp: new Date().toISOString()
      }));
    } catch (e) {
      console.warn('Could not cache city ledger data to localStorage:', e);
    }
  }

  /**
   * Sync vendors data
   */
  private async syncVendors(): Promise<void> {
    const result = await db.query('SELECT * FROM vendors ORDER BY name');
    if ('error' in result) {
      throw new Error(`Vendors sync failed: ${(result as any).error}`);
    }
    
    // Store in localStorage for immediate availability
    try {
      localStorage.setItem('corepms_vendors_sync', JSON.stringify({
        data: result.rows || [],
        timestamp: new Date().toISOString()
      }));
    } catch (e) {
      console.warn('Could not cache vendors data to localStorage:', e);
    }
  }

  /**
   * Sync vendor expenses data
   */
  private async syncVendorExpenses(): Promise<void> {
    const result = await db.query('SELECT * FROM vendor_expenses ORDER BY expense_date DESC, created_at DESC');
    if ('error' in result) {
      throw new Error(`Vendor expenses sync failed: ${(result as any).error}`);
    }
    
    // Store in localStorage for immediate availability
    try {
      localStorage.setItem('corepms_vendor_expenses_sync', JSON.stringify({
        data: result.rows || [],
        timestamp: new Date().toISOString()
      }));
    } catch (e) {
      console.warn('Could not cache vendor expenses data to localStorage:', e);
    }
  }

  /**
   * Sync vendor payments data
   */
  private async syncVendorPayments(): Promise<void> {
    const result = await db.query('SELECT * FROM vendor_payments ORDER BY payment_date DESC, created_at DESC');
    if ('error' in result) {
      throw new Error(`Vendor payments sync failed: ${(result as any).error}`);
    }
    
    // Store in localStorage for immediate availability
    try {
      localStorage.setItem('corepms_vendor_payments_sync', JSON.stringify({
        data: result.rows || [],
        timestamp: new Date().toISOString()
      }));
    } catch (e) {
      console.warn('Could not cache vendor payments data to localStorage:', e);
    }
  }

  /**
   * Sync folios data
   */
  private async syncFolios(): Promise<void> {
    const result = await db.query('SELECT * FROM folios');
    if ('error' in result) {
      throw new Error(`Folios sync failed: ${(result as any).error}`);
    }
    
    try {
      localStorage.setItem('corepms_folios_sync', JSON.stringify({
        data: result.rows || [],
        timestamp: new Date().toISOString()
      }));
    } catch (e) {
      console.warn('Could not cache folios data to localStorage:', e);
    }
  }

  /**
   * Check if the service is currently running
   */
  public isRunning(): boolean {
    return this.intervalId !== null;
  }
}