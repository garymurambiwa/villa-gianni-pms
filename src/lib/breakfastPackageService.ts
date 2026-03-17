// Breakfast Package Service Implementation
import { db } from './db';
import {
  BreakfastPackage,
  BreakfastPackageSeasonalRate,
  BreakfastPackageService,
  BreakfastRateCalculationContext
} from '@/types/breakfastPackages';
import { getSeasonForDate } from './ratePlanService';

// Generate UUID function for environments without crypto
function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  // Fallback implementation using timestamp + random for uniqueness
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).substring(2, 15);
  return `bp-${timestamp}-${randomPart}`;
}

// Check if we're in a browser environment with no native DB bridge (dev mode)
function isDevModeWithoutDb(): boolean {
  return typeof window !== 'undefined' &&
    !((window as any).native && (window as any).native.db);
}

// Ensure breakfast package tables exist
async function ensureBreakfastTablesExist(): Promise<void> {
  try {
    // Skip table creation in dev mode without native DB
    if (isDevModeWithoutDb()) {
      console.log('[BreakfastService] Dev mode detected, skipping table creation');
      return;
    }

    // Wait for database to be ready before creating tables
    const isReady = await db.waitForReady();
    if (!isReady) {
      console.warn('[BreakfastService] Database not ready, will retry later');
      return;
    }

    // Create breakfast_packages table with explicit schema
    const createTableResult = await db.exec(`
      CREATE TABLE IF NOT EXISTS public.breakfast_packages (
        id VARCHAR(255) PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT,
        base_price NUMERIC(12,2) NOT NULL DEFAULT 0,
        adult_price NUMERIC(12,2) NOT NULL DEFAULT 0,
        child_price NUMERIC(12,2) NOT NULL DEFAULT 0,
        applicable_room_types TEXT[] DEFAULT '{}',
        is_active BOOLEAN NOT NULL DEFAULT true,
        sort_order INTEGER NOT NULL DEFAULT 0,
        inserted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    if (createTableResult && 'error' in createTableResult && !createTableResult.ok) {
      // Table may already exist, which is fine
      console.log('[BreakfastService] Note: breakfast_packages table creation result:', createTableResult);
    }

    // Create breakfast_package_seasonal_rates table
    await db.exec(`
      CREATE TABLE IF NOT EXISTS public.breakfast_package_seasonal_rates (
        id VARCHAR(255) PRIMARY KEY,
        breakfast_package_id VARCHAR(255) NOT NULL,
        season_key TEXT NOT NULL,
        price_multiplier NUMERIC(5,4) NOT NULL DEFAULT 1.0000,
        start_date DATE,
        end_date DATE,
        is_active BOOLEAN NOT NULL DEFAULT true,
        inserted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Create indexes safely (ignore errors if they already exist)
    try {
      await db.exec(`CREATE INDEX IF NOT EXISTS breakfast_packages_code_idx ON public.breakfast_packages(code)`);
      await db.exec(`CREATE INDEX IF NOT EXISTS breakfast_packages_active_idx ON public.breakfast_packages(is_active)`);
      await db.exec(`CREATE INDEX IF NOT EXISTS breakfast_package_seasonal_rates_package_idx ON public.breakfast_package_seasonal_rates(breakfast_package_id)`);
      await db.exec(`CREATE INDEX IF NOT EXISTS breakfast_package_seasonal_rates_season_idx ON public.breakfast_package_seasonal_rates(season_key)`);
    } catch (indexError) {
      console.warn('[BreakfastService] Index creation warning (may already exist):', indexError);
    }

    // Add breakfast package columns to reservations table if not exists
    try {
      await db.exec(`ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS breakfast_package_code TEXT DEFAULT 'RO'`);
      await db.exec(`ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS breakfast_adults INTEGER DEFAULT 0`);
      await db.exec(`ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS breakfast_children INTEGER DEFAULT 0`);
      await db.exec(`CREATE INDEX IF NOT EXISTS reservations_breakfast_package_idx ON public.reservations(breakfast_package_code)`);
    } catch (alterError) {
      console.warn('[BreakfastService] Reservation column addition warning:', alterError);
    }

    console.log('[BreakfastService] Tables ensured successfully');
  } catch (error) {
    console.error('[BreakfastService] Error ensuring tables exist:', error);
    // Don't throw - allow service to continue in degraded mode
  }
}

class BreakfastPackageServiceImpl implements BreakfastPackageService {
  private tablesInitialized = false;
  private initializationPromise: Promise<void> | null = null;

  private async ensureTables(): Promise<void> {
    if (!this.tablesInitialized) {
      // Prevent concurrent initialization
      if (!this.initializationPromise) {
        this.initializationPromise = ensureBreakfastTablesExist().then(() => {
          this.tablesInitialized = true;
        }).catch(err => {
          console.error('[BreakfastService] Table initialization failed:', err);
          this.initializationPromise = null; // Allow retry
        });
      }
      await this.initializationPromise;
    }
  }

  // Initialize tables when service is first accessed
  constructor() {
    // Delay initialization to allow DB bridge to be ready
    if (typeof window !== 'undefined') {
      setTimeout(() => {
        this.ensureTables().catch(error => {
          console.error('[BreakfastService] Failed to initialize tables:', error);
        });
      }, 1000);
    }
  }

  async getAllPackages(): Promise<BreakfastPackage[]> {
    try {
      await this.ensureTables();
      const result = await db.query('SELECT * FROM public.breakfast_packages ORDER BY sort_order, name');

      if ('error' in result) {
        console.error('[BreakfastService] getAllPackages error:', result.error);
        return [];
      }

      if ('rows' in result && Array.isArray(result.rows)) {
        const packages = result.rows.map(this.mapRowToPackage);
        console.log(`[BreakfastService] Fetched ${packages.length} packages`);
        return packages;
      }
      return [];
    } catch (error) {
      console.error('[BreakfastService] Error fetching breakfast packages:', error);
      return [];
    }
  }

  async getActivePackages(): Promise<BreakfastPackage[]> {
    try {
      await this.ensureTables();
      const result = await db.query(
        'SELECT * FROM public.breakfast_packages WHERE is_active = true ORDER BY sort_order, name'
      );

      if ('error' in result) {
        console.error('[BreakfastService] getActivePackages error:', result.error);
        return [];
      }

      if ('rows' in result && Array.isArray(result.rows)) {
        return result.rows.map(this.mapRowToPackage);
      }
      return [];
    } catch (error) {
      console.error('[BreakfastService] Error fetching active breakfast packages:', error);
      return [];
    }
  }

  async getPackageByCode(code: string): Promise<BreakfastPackage | null> {
    try {
      await this.ensureTables();
      const result = await db.query(
        'SELECT * FROM public.breakfast_packages WHERE code = $1 AND is_active = true',
        [code]
      );

      if ('error' in result) {
        console.error('[BreakfastService] getPackageByCode error:', result.error);
        return null;
      }

      if ('rows' in result && Array.isArray(result.rows) && result.rows.length > 0) {
        return this.mapRowToPackage(result.rows[0]);
      }
      return null;
    } catch (error) {
      console.error('[BreakfastService] Error fetching breakfast package by code:', error);
      return null;
    }
  }

  async createPackage(data: Omit<BreakfastPackage, 'id' | 'insertedAt' | 'updatedAt'>): Promise<BreakfastPackage> {
    try {
      await this.ensureTables();

      // Validate required fields
      if (!data.code || !data.name) {
        throw new Error('Package code and name are required');
      }

      const id = generateUUID();
      const now = new Date().toISOString();

      // Convert room types array to PostgreSQL text[] format
      // PostgreSQL text[] expects format like: '{item1,item2}' or ARRAY['item1','item2']
      const roomTypesArray = data.applicableRoomTypes || [];
      const roomTypesPostgres = roomTypesArray.length > 0
        ? `{${roomTypesArray.map(t => `"${t.replace(/"/g, '\\"')}"`).join(',')}}`
        : '{}';

      console.log('[BreakfastService] Creating package:', {
        id,
        code: data.code,
        name: data.name,
        roomTypesPostgres
      });

      const sql = `
        INSERT INTO public.breakfast_packages 
        (id, code, name, description, base_price, adult_price, child_price, 
         applicable_room_types, is_active, sort_order, inserted_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::text[], $9, $10, $11, $12)
        RETURNING *
      `;

      const params = [
        id,
        data.code.trim(),
        data.name.trim(),
        data.description || '',
        Number(data.basePrice) || 0,
        Number(data.adultPrice) || 0,
        Number(data.childPrice) || 0,
        roomTypesPostgres,
        data.isActive !== false,
        Number(data.sortOrder) || 0,
        now,
        now
      ];

      const result = await db.query(sql, params);

      // Check for errors in result
      if ('error' in result) {
        const errorMsg = (result as any).error || 'Unknown database error';
        console.error('[BreakfastService] Package creation failed:', errorMsg);

        // Provide user-friendly error messages for common issues
        if (errorMsg.includes('duplicate key') && errorMsg.includes('code')) {
          throw new Error(`A package with code "${data.code}" already exists. Please use a different code.`);
        }
        if (errorMsg.includes('duplicate key')) {
          throw new Error('A package with this information already exists.');
        }

        throw new Error(`Database error: ${errorMsg}`);
      }

      // If we got rows back (RETURNING clause), use that
      if ('rows' in result && Array.isArray(result.rows) && result.rows.length > 0) {
        console.log('[BreakfastService] Package created successfully with RETURNING');
        return this.mapRowToPackage(result.rows[0]);
      }

      // If no rows returned but no error, the insert was successful
      // Return the constructed package
      console.log('[BreakfastService] Package created successfully');
      return {
        id,
        code: data.code.trim(),
        name: data.name.trim(),
        description: data.description || '',
        basePrice: Number(data.basePrice) || 0,
        adultPrice: Number(data.adultPrice) || 0,
        childPrice: Number(data.childPrice) || 0,
        applicableRoomTypes: roomTypesArray,
        isActive: data.isActive !== false,
        sortOrder: Number(data.sortOrder) || 0,
        insertedAt: new Date(now),
        updatedAt: new Date(now)
      };
    } catch (error: any) {
      console.error('[BreakfastService] Error creating breakfast package:', error);
      throw new Error(`Failed to create breakfast package: ${error?.message || error}`);
    }
  }

  async updatePackage(
    id: string,
    data: Partial<Omit<BreakfastPackage, 'id' | 'insertedAt' | 'updatedAt'>>
  ): Promise<BreakfastPackage> {
    try {
      await this.ensureTables();

      if (!id) {
        throw new Error('Package ID is required for update');
      }

      const now = new Date().toISOString();
      const updates: string[] = [];
      const params: any[] = [];
      let paramIndex = 1;

      // Build dynamic update query
      const fieldMappings: Record<string, string> = {
        code: 'code',
        name: 'name',
        description: 'description',
        basePrice: 'base_price',
        adultPrice: 'adult_price',
        childPrice: 'child_price',
        isActive: 'is_active',
        sortOrder: 'sort_order'
      };

      Object.entries(data).forEach(([key, value]) => {
        if (value !== undefined && key !== 'applicableRoomTypes') {
          const dbField = fieldMappings[key];
          if (dbField) {
            updates.push(`${dbField} = $${paramIndex}`);
            params.push(value);
            paramIndex++;
          }
        }
      });

      // Handle applicableRoomTypes separately (PostgreSQL text[] array)
      if (data.applicableRoomTypes !== undefined) {
        const roomTypesArray = data.applicableRoomTypes || [];
        const roomTypesPostgres = roomTypesArray.length > 0
          ? `{${roomTypesArray.map(t => `"${t.replace(/"/g, '\\"')}"`).join(',')}}`
          : '{}';
        updates.push(`applicable_room_types = $${paramIndex}::text[]`);
        params.push(roomTypesPostgres);
        paramIndex++;
      }

      if (updates.length === 0) {
        throw new Error('No valid fields to update');
      }

      // Add updated_at
      updates.push(`updated_at = $${paramIndex}`);
      params.push(now);
      paramIndex++;

      // Add id as last parameter
      params.push(id);

      const sql = `UPDATE public.breakfast_packages SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`;

      console.log('[BreakfastService] Updating package:', { id, updates: updates.length });

      const result = await db.query(sql, params);

      if ('error' in result) {
        const errorMsg = (result as any).error || 'Unknown database error';
        console.error('[BreakfastService] Package update failed:', errorMsg);
        throw new Error(`Database error: ${errorMsg}`);
      }

      // If we got rows back from RETURNING, use that
      if ('rows' in result && Array.isArray(result.rows) && result.rows.length > 0) {
        console.log('[BreakfastService] Package updated successfully');
        return this.mapRowToPackage(result.rows[0]);
      }

      // Fallback: fetch the updated record
      const fetchResult = await db.query('SELECT * FROM public.breakfast_packages WHERE id = $1', [id]);
      if ('rows' in fetchResult && Array.isArray(fetchResult.rows) && fetchResult.rows.length > 0) {
        return this.mapRowToPackage(fetchResult.rows[0]);
      }

      throw new Error('Package not found after update');
    } catch (error: any) {
      console.error('[BreakfastService] Error updating breakfast package:', error);
      throw new Error(`Failed to update breakfast package: ${error?.message || error}`);
    }
  }

  async deletePackage(id: string): Promise<boolean> {
    try {
      await this.ensureTables();

      if (!id) {
        throw new Error('Package ID is required for deletion');
      }

      console.log('[BreakfastService] Deleting package:', id);

      const result = await db.query('DELETE FROM public.breakfast_packages WHERE id = $1', [id]);

      if ('error' in result) {
        console.error('[BreakfastService] Delete failed:', (result as any).error);
        return false;
      }

      console.log('[BreakfastService] Package deleted successfully');
      return true;
    } catch (error) {
      console.error('[BreakfastService] Error deleting breakfast package:', error);
      return false;
    }
  }

  async getSeasonalRates(packageId: string): Promise<BreakfastPackageSeasonalRate[]> {
    try {
      await this.ensureTables();
      const result = await db.query(
        'SELECT * FROM public.breakfast_package_seasonal_rates WHERE breakfast_package_id = $1 AND is_active = true ORDER BY season_key',
        [packageId]
      );

      if ('error' in result) {
        console.error('[BreakfastService] getSeasonalRates error:', result.error);
        return [];
      }

      if ('rows' in result && Array.isArray(result.rows)) {
        return result.rows.map(this.mapRowToSeasonalRate);
      }
      return [];
    } catch (error) {
      console.error('[BreakfastService] Error fetching seasonal rates:', error);
      return [];
    }
  }

  async updateSeasonalRate(
    packageId: string,
    seasonKey: string,
    multiplier: number
  ): Promise<BreakfastPackageSeasonalRate> {
    try {
      await this.ensureTables();
      const now = new Date().toISOString();
      const id = generateUUID();

      // Try to update existing or insert new using PostgreSQL's ON CONFLICT
      const upsertSql = `
        INSERT INTO public.breakfast_package_seasonal_rates 
        (id, breakfast_package_id, season_key, price_multiplier, updated_at)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (breakfast_package_id, season_key) 
        DO UPDATE SET price_multiplier = EXCLUDED.price_multiplier, updated_at = EXCLUDED.updated_at
        RETURNING *
      `;

      const result = await db.query(upsertSql, [id, packageId, seasonKey, multiplier, now]);

      if ('error' in result) {
        console.error('[BreakfastService] Seasonal rate update failed:', result.error);
        throw new Error((result as any).error);
      }

      if ('rows' in result && Array.isArray(result.rows) && result.rows.length > 0) {
        return this.mapRowToSeasonalRate(result.rows[0]);
      }

      throw new Error('Failed to update seasonal rate');
    } catch (error) {
      console.error('[BreakfastService] Error updating seasonal rate:', error);
      throw error;
    }
  }

  async calculateBreakfastPrice(
    packageCode: string,
    adults: number,
    children: number,
    date: Date,
    roomType?: string
  ): Promise<number> {
    try {
      const pkg = await this.getPackageByCode(packageCode);
      if (!pkg) return 0;

      // Check if package is applicable to this room type
      if (pkg.applicableRoomTypes.length > 0 && roomType) {
        if (!pkg.applicableRoomTypes.includes(roomType)) {
          return 0; // Package not available for this room type
        }
      }

      // Get seasonal multiplier
      const seasonKey = getSeasonForDate(date);
      const seasonalRates = await this.getSeasonalRates(pkg.id);
      const seasonalRate = seasonalRates.find(rate => rate.seasonKey === seasonKey);
      const multiplier = seasonalRate?.priceMultiplier || 1;

      // Calculate total price
      const baseCost = Number(pkg.basePrice) * multiplier;
      const adultCost = (Number(pkg.adultPrice) * adults) * multiplier;
      const childCost = (Number(pkg.childPrice) * children) * multiplier;

      const total = Math.round((baseCost + adultCost + childCost) * 100) / 100;
      return Math.max(0, total);
    } catch (error) {
      console.error('[BreakfastService] Error calculating breakfast price:', error);
      return 0;
    }
  }

  async getAvailablePackagesForRoomType(roomType: string): Promise<BreakfastPackage[]> {
    try {
      const allPackages = await this.getActivePackages();
      return allPackages.filter(pkg =>
        pkg.applicableRoomTypes.length === 0 || pkg.applicableRoomTypes.includes(roomType)
      );
    } catch (error) {
      console.error('[BreakfastService] Error getting available packages for room type:', error);
      return [];
    }
  }

  // Helper methods
  private mapRowToPackage(row: any): BreakfastPackage {
    // Parse applicable_room_types from various formats
    // PostgreSQL text[] typically returns as a JavaScript array directly
    let applicableRoomTypes: string[] = [];
    if (row.applicable_room_types) {
      if (Array.isArray(row.applicable_room_types)) {
        // PostgreSQL text[] returns as array
        applicableRoomTypes = row.applicable_room_types;
      } else if (typeof row.applicable_room_types === 'string') {
        // Handle string format like '{item1,item2}'
        const str = row.applicable_room_types.trim();
        if (str.startsWith('{') && str.endsWith('}')) {
          // PostgreSQL array literal format
          const inner = str.slice(1, -1);
          if (inner.length > 0) {
            applicableRoomTypes = inner.split(',').map(s => s.replace(/^"|"$/g, '').trim());
          }
        } else {
          // Try JSON parse as fallback
          try {
            applicableRoomTypes = JSON.parse(str);
          } catch {
            applicableRoomTypes = [];
          }
        }
      }
    }

    return {
      id: row.id,
      code: row.code,
      name: row.name,
      description: row.description || '',
      basePrice: Number(row.base_price || 0),
      adultPrice: Number(row.adult_price || 0),
      childPrice: Number(row.child_price || 0),
      applicableRoomTypes,
      isActive: Boolean(row.is_active),
      sortOrder: Number(row.sort_order || 0),
      insertedAt: row.inserted_at ? new Date(row.inserted_at) : undefined,
      updatedAt: row.updated_at ? new Date(row.updated_at) : undefined
    };
  }

  private mapRowToSeasonalRate(row: any): BreakfastPackageSeasonalRate {
    return {
      id: row.id,
      breakfastPackageId: row.breakfast_package_id,
      seasonKey: row.season_key,
      priceMultiplier: Number(row.price_multiplier || 1),
      startDate: row.start_date ? new Date(row.start_date) : undefined,
      endDate: row.end_date ? new Date(row.end_date) : undefined,
      isActive: Boolean(row.is_active),
      insertedAt: row.inserted_at ? new Date(row.inserted_at) : undefined,
      updatedAt: row.updated_at ? new Date(row.updated_at) : undefined
    };
  }
}

export const breakfastPackageService = new BreakfastPackageServiceImpl();
export default breakfastPackageService;