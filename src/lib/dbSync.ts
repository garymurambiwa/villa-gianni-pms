/**
 * Database Sync Service
 * 
 * Provides centralized database synchronization for menu items, inventory items,
 * and other data that needs to be persisted to PostgreSQL.
 * 
 * This service ensures that:
 * 1. All CRUD operations are properly synced to the database
 * 2. LocalStorage serves as a cache while PostgreSQL is the source of truth
 * 3. Offline support - localStorage works when DB is unavailable
 * 4. Consistent patterns for all modules to follow
 */

import { db } from './db';

// ============================================================================
// TYPES
// ============================================================================

export interface MenuItemRecord {
  id: string;
  name: string;
  category: string;
  price: number;
  active: boolean;
  cost_price?: number;
  description?: string;
  image_url?: string;
  category_id?: string;
  sub_id?: string;
  visibility?: { bar?: boolean; restaurant?: boolean };
}

export interface InventoryItemRecord {
  id: string;
  name: string;
  category: string;
  stock_level: number;
  price: number;
  cost_price?: number;
  reorder_level?: number;
  unit?: string;
}

export interface FolioChargeRecord {
  id: string;
  folio_id?: string;
  guest_id: string;
  reservation_id?: string;
  room_number?: string;
  charge_type: 'charge' | 'payment' | 'adjustment' | 'transfer' | 'void';
  category: string;
  description: string;
  amount: number;
  tax_amount?: number;
  total_amount: number;
  source: 'manual' | 'night_audit' | 'pos' | 'front_office' | 'system' | 'transfer';
  source_reference?: string;
  posting_date?: string;
  business_date?: string;
  is_voided?: boolean;
  voided_at?: string;
  voided_by?: string;
  void_reason?: string;
  created_by?: string;
}

export interface PosBillRecord {
  id: string;
  bill_number: string;
  outlet: string;
  table_number?: string;
  guest_id?: string;
  folio_id?: string;
  room_number?: string;
  subtotal: number;
  tax_amount: number;
  discount_amount?: number;
  service_charge?: number;
  total_amount: number;
  items: any[];
  payment_method?: string;
  payment_status: 'pending' | 'paid' | 'charged_to_room' | 'voided' | 'partial';
  amount_paid?: number;
  change_amount?: number;
  business_date?: string;
  opened_at?: string;
  closed_at?: string;
  opened_by?: string;
  closed_by?: string;
  is_voided?: boolean;
  voided_at?: string;
  voided_by?: string;
  void_reason?: string;
  shift_id?: string;
}

export interface SyncResult {
  success: boolean;
  error?: string;
  synced?: number;
}

// ============================================================================
// MENU ITEMS SYNC
// ============================================================================

/**
 * Sync a single menu item to the database
 * Uses UPSERT pattern (INSERT ... ON CONFLICT UPDATE)
 */
export async function syncMenuItemToDb(item: MenuItemRecord): Promise<SyncResult> {
  try {
    // Validate required fields
    if (!item.id || !item.name || typeof item.price === 'undefined' || item.price === null) {
      console.error('[dbSync] Invalid menu item data:', item);
      return { success: false, error: 'Missing required fields (id, name, price)' };
    }

    const isConfigured = await db.isConfigured();
    if (!isConfigured) {
      console.log('[dbSync] Database not configured, skipping menu item sync');
      return { success: true, synced: 0 };
    }

    // Map costCenter to category for database
    const category = item.category || 'restaurant';
    const price = Number(item.price) || 0;
    const active = item.active !== false;

    // Use PostgreSQL UPSERT syntax
    const sql = `
      INSERT INTO menu_items (id, name, category, price, active, inserted_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        category = EXCLUDED.category,
        price = EXCLUDED.price,
        active = EXCLUDED.active,
        updated_at = NOW()
    `;

    const result = await db.query(sql, [item.id, item.name, category, price, active]);

    if ('error' in result) {
      console.error('[dbSync] Menu item sync failed:', (result as any).error);
      return { success: false, error: (result as any).error };
    }

    console.log('[dbSync] Menu item synced to DB:', item.id, item.name);
    return { success: true, synced: 1 };
  } catch (err: any) {
    console.error('[dbSync] Menu item sync error:', err?.message || err);
    return { success: false, error: err?.message || String(err) };
  }
}

/**
 * Delete a menu item from the database
 */
export async function deleteMenuItemFromDb(itemId: string): Promise<SyncResult> {
  try {
    const isConfigured = await db.isConfigured();
    if (!isConfigured) {
      return { success: true, synced: 0 };
    }

    const sql = `DELETE FROM menu_items WHERE id = $1`;
    const result = await db.query(sql, [itemId]);

    if ('error' in result) {
      console.error('[dbSync] Menu item delete failed:', (result as any).error);
      return { success: false, error: (result as any).error };
    }

    console.log('[dbSync] Menu item deleted from DB:', itemId);
    return { success: true, synced: 1 };
  } catch (err: any) {
    console.error('[dbSync] Menu item delete error:', err?.message || err);
    return { success: false, error: err?.message || String(err) };
  }
}

/**
 * Bulk sync all menu items from localStorage to database
 * Useful for initial sync or data migration
 */
export async function syncAllMenuItemsToDb(): Promise<SyncResult> {
  try {
    const isConfigured = await db.isConfigured();
    if (!isConfigured) {
      console.log('[dbSync] Database not configured, skipping bulk menu sync');
      return { success: true, synced: 0 };
    }

    // Read from localStorage
    const raw = localStorage.getItem('corepms_pos_items');
    if (!raw) {
      console.log('[dbSync] No menu items in localStorage to sync');
      return { success: true, synced: 0 };
    }

    const items = JSON.parse(raw);
    if (!Array.isArray(items) || items.length === 0) {
      return { success: true, synced: 0 };
    }

    let syncedCount = 0;
    const errors: string[] = [];

    for (const item of items) {
      const menuItem: MenuItemRecord = {
        id: String(item.id),
        name: String(item.name || ''),
        category: String(item.costCenter || item.category || 'restaurant'),
        price: Number(item.sellingPrice || item.price || 0),
        active: item.available !== false,
        cost_price: Number(item.costPrice || 0),
        category_id: item.category_id,
        sub_id: item.sub_id,
        visibility: item.visibility
      };

      const result = await syncMenuItemToDb(menuItem);
      if (result.success) {
        syncedCount++;
      } else if (result.error) {
        errors.push(`${item.name}: ${result.error}`);
      }
    }

    console.log(`[dbSync] Bulk menu sync complete: ${syncedCount}/${items.length} items synced`);

    if (errors.length > 0) {
      return { success: false, error: errors.join('; '), synced: syncedCount };
    }

    return { success: true, synced: syncedCount };
  } catch (err: any) {
    console.error('[dbSync] Bulk menu sync error:', err?.message || err);
    return { success: false, error: err?.message || String(err) };
  }
}

// ============================================================================
// INVENTORY ITEMS SYNC
// ============================================================================

/**
 * Sync a single inventory item to the database
 */
export async function syncInventoryItemToDb(item: InventoryItemRecord): Promise<SyncResult> {
  try {
    // Validate required fields
    if (!item.id || !item.name || typeof item.stock_level === 'undefined' || item.stock_level === null) {
      console.error('[dbSync] Invalid inventory item data:', item);
      return { success: false, error: 'Missing required fields (id, name, stock_level)' };
    }

    const isConfigured = await db.isConfigured();
    if (!isConfigured) {
      console.log('[dbSync] Database not configured, skipping inventory sync');
      return { success: true, synced: 0 };
    }

    const stockLevel = Number(item.stock_level) || 0;
    const price = Number(item.price) || 0;
    const category = item.category || 'general';

    // Use PostgreSQL UPSERT syntax
    const sql = `
      INSERT INTO inventory_items (id, name, category, stock_level, price, inserted_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        category = EXCLUDED.category,
        stock_level = EXCLUDED.stock_level,
        price = EXCLUDED.price,
        updated_at = NOW()
    `;

    const result = await db.query(sql, [item.id, item.name, category, stockLevel, price]);

    if ('error' in result) {
      console.error('[dbSync] Inventory item sync failed:', (result as any).error);
      return { success: false, error: (result as any).error };
    }

    console.log('[dbSync] Inventory item synced to DB:', item.id, item.name);
    return { success: true, synced: 1 };
  } catch (err: any) {
    console.error('[dbSync] Inventory item sync error:', err?.message || err);
    return { success: false, error: err?.message || String(err) };
  }
}

/**
 * Delete an inventory item from the database
 */
export async function deleteInventoryItemFromDb(itemId: string): Promise<SyncResult> {
  try {
    const isConfigured = await db.isConfigured();
    if (!isConfigured) {
      return { success: true, synced: 0 };
    }

    const sql = `DELETE FROM inventory_items WHERE id = $1`;
    const result = await db.query(sql, [itemId]);

    if ('error' in result) {
      console.error('[dbSync] Inventory item delete failed:', (result as any).error);
      return { success: false, error: (result as any).error };
    }

    console.log('[dbSync] Inventory item deleted from DB:', itemId);
    return { success: true, synced: 1 };
  } catch (err: any) {
    console.error('[dbSync] Inventory item delete error:', err?.message || err);
    return { success: false, error: err?.message || String(err) };
  }
}

/**
 * Bulk sync all inventory items from localStorage to database
 */
export async function syncAllInventoryItemsToDb(): Promise<SyncResult> {
  try {
    const isConfigured = await db.isConfigured();
    if (!isConfigured) {
      console.log('[dbSync] Database not configured, skipping bulk inventory sync');
      return { success: true, synced: 0 };
    }

    // Read from localStorage (same source as menu items)
    const raw = localStorage.getItem('corepms_pos_items');
    if (!raw) {
      console.log('[dbSync] No inventory items in localStorage to sync');
      return { success: true, synced: 0 };
    }

    const items = JSON.parse(raw);
    if (!Array.isArray(items) || items.length === 0) {
      return { success: true, synced: 0 };
    }

    let syncedCount = 0;
    const errors: string[] = [];

    for (const item of items) {
      const invItem: InventoryItemRecord = {
        id: String(item.id),
        name: String(item.name || ''),
        category: String(item.inventoryCategory || item.costCenter || 'general'),
        stock_level: Number(item.qtyInStock || 0),
        price: Number(item.costPrice || item.sellingPrice || 0)
      };

      const result = await syncInventoryItemToDb(invItem);
      if (result.success) {
        syncedCount++;
      } else if (result.error) {
        errors.push(`${item.name}: ${result.error}`);
      }
    }

    console.log(`[dbSync] Bulk inventory sync complete: ${syncedCount}/${items.length} items synced`);

    if (errors.length > 0) {
      return { success: false, error: errors.join('; '), synced: syncedCount };
    }

    return { success: true, synced: syncedCount };
  } catch (err: any) {
    console.error('[dbSync] Bulk inventory sync error:', err?.message || err);
    return { success: false, error: err?.message || String(err) };
  }
}

// ============================================================================
// COMBINED SYNC HELPER
// ============================================================================

/**
 * Sync a POS item to both menu_items and inventory_items tables
 * This is the main function to call when saving items in PosSettings
 */
export async function syncPosItemToDb(item: any): Promise<SyncResult> {
  try {
    const isConfigured = await db.isConfigured();
    if (!isConfigured) {
      return { success: true, synced: 0 };
    }

    // Sync to menu_items
    const menuItem: MenuItemRecord = {
      id: String(item.id),
      name: String(item.name || ''),
      category: String(item.costCenter || 'restaurant'),
      price: Number(item.sellingPrice || 0),
      active: item.available !== false,
      cost_price: Number(item.costPrice || 0)
    };
    const menuResult = await syncMenuItemToDb(menuItem);

    // Sync to inventory_items
    const invItem: InventoryItemRecord = {
      id: String(item.id),
      name: String(item.name || ''),
      category: String(item.inventoryCategory || item.costCenter || 'general'),
      stock_level: Number(item.qtyInStock || 0),
      price: Number(item.costPrice || 0)
    };
    const invResult = await syncInventoryItemToDb(invItem);

    if (!menuResult.success || !invResult.success) {
      return {
        success: false,
        error: [menuResult.error, invResult.error].filter(Boolean).join('; '),
        synced: (menuResult.synced || 0) + (invResult.synced || 0)
      };
    }

    return { success: true, synced: 2 };
  } catch (err: any) {
    const msg = err?.message || String(err);
    console.error('[dbSync] POS item sync CRITICAL FAILURE:', msg, item);
    return { success: false, error: msg };
  }
}

/**
 * Delete a POS item from both menu_items and inventory_items tables
 */
export async function deletePosItemFromDb(itemId: string): Promise<SyncResult> {
  try {
    const isConfigured = await db.isConfigured();
    if (!isConfigured) {
      return { success: true, synced: 0 };
    }

    await deleteMenuItemFromDb(itemId);
    await deleteInventoryItemFromDb(itemId);

    return { success: true, synced: 2 };
  } catch (err: any) {
    console.error('[dbSync] POS item delete error:', err?.message || err);
    return { success: false, error: err?.message || String(err) };
  }
}

// ============================================================================
// FULL DATABASE SYNC
// ============================================================================

/**
 * Perform a full sync of all POS items to the database
 * Called on app startup or manual sync request
 */
export async function performFullSync(): Promise<SyncResult> {
  try {
    console.log('[dbSync] Starting full database sync...');

    const isConfigured = await db.isConfigured();
    if (!isConfigured) {
      console.log('[dbSync] Database not configured, skipping full sync');
      return { success: true, synced: 0 };
    }

    const menuResult = await syncAllMenuItemsToDb();
    const invResult = await syncAllInventoryItemsToDb();

    const totalSynced = (menuResult.synced || 0) + (invResult.synced || 0);
    const errors = [menuResult.error, invResult.error].filter(Boolean);

    console.log(`[dbSync] Full sync complete: ${totalSynced} items synced`);

    if (errors.length > 0) {
      return { success: false, error: errors.join('; '), synced: totalSynced };
    }

    return { success: true, synced: totalSynced };
  } catch (err: any) {
    console.error('[dbSync] Full sync CRITICAL FAILURE:', err?.message || err);
    return { success: false, error: err?.message || String(err) };
  }
}

/**
 * Check if database tables exist and create them if needed
 * This ensures proper table structure before syncing
 */
export async function ensureTablesExist(): Promise<boolean> {
  try {
    const isConfigured = await db.isConfigured();
    if (!isConfigured) {
      return false;
    }

    // Create menu_items table if not exists
    await db.query(`
      CREATE TABLE IF NOT EXISTS menu_items (
        id VARCHAR(36) PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        price NUMERIC(12,2) NOT NULL,
        active BOOLEAN NOT NULL DEFAULT true,
        inserted_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create inventory_items table if not exists
    await db.query(`
      CREATE TABLE IF NOT EXISTS inventory_items (
        id VARCHAR(36) PRIMARY KEY,
        name TEXT NOT NULL,
        category VARCHAR(50),
        stock_level NUMERIC NOT NULL DEFAULT 0,
        price NUMERIC(12,2) NOT NULL DEFAULT 0,
        inserted_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Ensure rooms table has floor column
    try {
      await db.query(`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS floor INTEGER DEFAULT 1`);
    } catch (e) {
      console.warn('[dbSync] Failed to add floor column to rooms:', e);
    }

    // Ensure menu_items table has updated_at column
    try {
      await db.query(`ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();`);
    } catch (e) {
      console.warn('[dbSync] Failed to add updated_at column to menu_items:', e);
    }

    // Ensure inventory_items table has updated_at column
    try {
      await db.query(`ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();`);
    } catch (e) {
      console.warn('[dbSync] Failed to add updated_at column to inventory_items:', e);
    }

    // Create app_users table if not exists (for Browser Auth)
    await db.query(`
      CREATE TABLE IF NOT EXISTS public.app_users (
        id VARCHAR(50) PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        email VARCHAR(255),
        password_hash VARCHAR(255),
        name VARCHAR(100),
        role VARCHAR(20) DEFAULT 'staff',
        active BOOLEAN DEFAULT true,
        permissions TEXT[],
        last_login TIMESTAMP,
        last_activity TIMESTAMP,
        is_verified BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create profiles table (linked to app_users)
    await db.query(`
      CREATE TABLE IF NOT EXISTS public.profiles (
        id VARCHAR(50) PRIMARY KEY REFERENCES public.app_users(id) ON DELETE CASCADE,
        email VARCHAR(255),
        full_name VARCHAR(100),
        role VARCHAR(20),
        is_active BOOLEAN,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Ensure pgcrypto for password hashing
    try { await db.query('CREATE EXTENSION IF NOT EXISTS pgcrypto'); } catch (e) {
      console.warn('[dbSync] Failed to create pgcrypto extension - password hashing might fail if not pre-installed:', e);
    }

    console.log('[dbSync] Database tables verified/created');
    return true;
    return true;
  } catch (err: any) {
    console.error('[dbSync] Table creation CRITICAL FAILURE:', err?.message || err);
    return false;
  }
}

// ============================================================================
// FOLIO CHARGES SYNC
// ============================================================================

/**
 * Sync a single folio charge to the database
 * Uses UPSERT pattern (INSERT ... ON CONFLICT UPDATE)
 */
export async function syncFolioChargeToDb(charge: FolioChargeRecord): Promise<SyncResult> {
  try {
    // Validate required fields
    if (!charge.id || !charge.guest_id || !charge.description || typeof charge.amount === 'undefined' || charge.amount === null) {
      console.error('[dbSync] Invalid folio charge data:', charge);
      return { success: false, error: 'Missing required fields (id, guest_id, description, amount)' };
    }

    const isConfigured = await db.isConfigured();
    if (!isConfigured) {
      console.log('[dbSync] Database not configured, skipping folio charge sync');
      return { success: true, synced: 0 };
    }

    const totalAmount = charge.total_amount || (Number(charge.amount || 0) + Number(charge.tax_amount || 0));
    const postingDate = charge.posting_date || new Date().toISOString().slice(0, 10);
    const businessDate = charge.business_date || postingDate;

    const sql = `
      INSERT INTO folio_charges (
        id, guest_id, folio_id, reservation_id, room_number,
        charge_type, category, description, amount, tax_amount, total_amount,
        source, source_reference, posting_date, business_date,
        is_voided, voided_at, voided_by, void_reason, created_by, inserted_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, NOW())
      ON CONFLICT (id) DO UPDATE SET
        charge_type = EXCLUDED.charge_type,
        category = EXCLUDED.category,
        description = EXCLUDED.description,
        amount = EXCLUDED.amount,
        tax_amount = EXCLUDED.tax_amount,
        total_amount = EXCLUDED.total_amount,
        is_voided = EXCLUDED.is_voided,
        voided_at = EXCLUDED.voided_at,
        voided_by = EXCLUDED.voided_by,
        void_reason = EXCLUDED.void_reason,
        updated_at = NOW()
    `;

    const params = [
      charge.id,
      charge.guest_id,
      charge.folio_id || null,
      charge.reservation_id || null,
      charge.room_number || null,
      charge.charge_type || 'charge',
      charge.category || 'Other',
      charge.description,
      Number(charge.amount || 0),
      Number(charge.tax_amount || 0),
      totalAmount,
      charge.source || 'manual',
      charge.source_reference || null,
      postingDate,
      businessDate,
      charge.is_voided || false,
      charge.voided_at || null,
      charge.voided_by || null,
      charge.void_reason || null,
      charge.created_by || null
    ];

    const result = await db.query(sql, params);

    if ('error' in result) {
      console.error('[dbSync] Folio charge sync failed:', (result as any).error);
      return { success: false, error: (result as any).error };
    }

    console.log('[dbSync] Folio charge synced to DB:', charge.id);
    return { success: true, synced: 1 };
  } catch (err: any) {
    console.error('[dbSync] Folio charge sync error:', err?.message || err);
    return { success: false, error: err?.message || String(err) };
  }
}

/**
 * Load folio charges from database for a specific guest
 */
export async function loadFolioChargesFromDb(guestId?: string): Promise<{ success: boolean; charges: any[]; error?: string }> {
  try {
    const isConfigured = await db.isConfigured();
    if (!isConfigured) {
      return { success: true, charges: [] };
    }

    let sql = 'SELECT * FROM folio_charges';
    const params: any[] = [];

    if (guestId) {
      sql += ' WHERE guest_id = $1';
      params.push(guestId);
    }

    sql += ' ORDER BY posting_date DESC, inserted_at DESC';

    const result = await db.query(sql, params);

    if ('error' in result) {
      console.error('[dbSync] Load folio charges failed:', (result as any).error);
      return { success: false, charges: [], error: (result as any).error };
    }

    const charges = ('rows' in result ? result.rows : []).map((row: any) => ({
      id: row.id,
      guestId: row.guest_id,
      folioId: row.folio_id,
      reservationId: row.reservation_id,
      roomNumber: row.room_number,
      type: row.charge_type,
      category: row.category,
      description: row.description,
      amount: Number(row.amount || 0),
      taxAmount: Number(row.tax_amount || 0),
      totalAmount: Number(row.total_amount || 0),
      source: row.source,
      sourceReference: row.source_reference,
      date: row.posting_date,
      businessDate: row.business_date,
      isVoided: row.is_voided,
      voidedAt: row.voided_at,
      voidedBy: row.voided_by,
      voidReason: row.void_reason,
      createdBy: row.created_by
    }));

    console.log(`[dbSync] Loaded ${charges.length} folio charges from DB`);
    return { success: true, charges };
  } catch (err: any) {
    console.error('[dbSync] Load folio charges error:', err?.message || err);
    return { success: false, charges: [], error: err?.message || String(err) };
  }
}

/**
 * Sync all folio charges from localStorage to database
 */
export async function syncAllFolioChargesToDb(): Promise<SyncResult> {
  try {
    const isConfigured = await db.isConfigured();
    if (!isConfigured) {
      return { success: true, synced: 0 };
    }

    // Read from localStorage
    const raw = localStorage.getItem('corepms_folioCharges');
    const charges: any[] = raw ? JSON.parse(raw) : [];

    if (charges.length === 0) {
      return { success: true, synced: 0 };
    }

    let synced = 0;
    for (const charge of charges) {
      const record: FolioChargeRecord = {
        id: charge.id,
        guest_id: charge.guestId,
        folio_id: charge.folioId,
        reservation_id: charge.reservationId,
        room_number: charge.roomNumber,
        charge_type: charge.type || 'charge',
        category: charge.category || 'Other',
        description: charge.description || '',
        amount: Number(charge.amount || 0),
        tax_amount: Number(charge.taxAmount || 0),
        total_amount: Number(charge.totalAmount || charge.amount || 0),
        source: charge.source || 'manual',
        source_reference: charge.sourceReference,
        posting_date: charge.date,
        business_date: charge.businessDate || charge.date,
        is_voided: charge.isVoided || charge.voidedBy ? true : false,
        voided_at: charge.voidedAt,
        voided_by: charge.voidedBy,
        void_reason: charge.voidReason,
        created_by: charge.createdBy
      };

      const result = await syncFolioChargeToDb(record);
      if (result.success) synced++;
    }

    console.log(`[dbSync] Synced ${synced}/${charges.length} folio charges to DB`);
    return { success: true, synced };
  } catch (err: any) {
    console.error('[dbSync] Sync all folio charges error:', err?.message || err);
    return { success: false, error: err?.message || String(err) };
  }
}

// ============================================================================
// POS BILLS SYNC
// ============================================================================

/**
 * Sync a POS bill to the database
 */
export async function syncPosBillToDb(bill: PosBillRecord): Promise<SyncResult> {
  try {
    // Validate required fields
    if (!bill.id || !bill.bill_number || typeof bill.subtotal === 'undefined' || bill.subtotal === null || typeof bill.total_amount === 'undefined' || bill.total_amount === null) {
      console.error('[dbSync] Invalid POS bill data:', bill);
      return { success: false, error: 'Missing required fields (id, bill_number, subtotal, total_amount)' };
    }

    const isConfigured = await db.isConfigured();
    if (!isConfigured) {
      return { success: true, synced: 0 };
    }

    const businessDate = bill.business_date || new Date().toISOString().slice(0, 10);

    const sql = `
      INSERT INTO pos_bills (
        id, bill_number, outlet, table_number,
        guest_id, folio_id, room_number,
        subtotal, tax_amount, discount_amount, service_charge, total_amount,
        items, payment_method, payment_status, amount_paid, change_amount,
        business_date, opened_at, closed_at, opened_by, closed_by,
        is_voided, voided_at, voided_by, void_reason, shift_id, inserted_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, NOW())
      ON CONFLICT (id) DO UPDATE SET
        payment_method = EXCLUDED.payment_method,
        payment_status = EXCLUDED.payment_status,
        amount_paid = EXCLUDED.amount_paid,
        change_amount = EXCLUDED.change_amount,
        closed_at = EXCLUDED.closed_at,
        closed_by = EXCLUDED.closed_by,
        is_voided = EXCLUDED.is_voided,
        voided_at = EXCLUDED.voided_at,
        voided_by = EXCLUDED.voided_by,
        void_reason = EXCLUDED.void_reason,
        updated_at = NOW()
    `;

    const params = [
      bill.id,
      bill.bill_number,
      bill.outlet || 'Restaurant',
      bill.table_number || null,
      bill.guest_id || null,
      bill.folio_id || null,
      bill.room_number || null,
      Number(bill.subtotal || 0),
      Number(bill.tax_amount || 0),
      Number(bill.discount_amount || 0),
      Number(bill.service_charge || 0),
      Number(bill.total_amount || 0),
      JSON.stringify(bill.items || []),
      bill.payment_method || null,
      bill.payment_status || 'pending',
      Number(bill.amount_paid || 0),
      Number(bill.change_amount || 0),
      businessDate,
      bill.opened_at || new Date().toISOString(),
      bill.closed_at || null,
      bill.opened_by || null,
      bill.closed_by || null,
      bill.is_voided || false,
      bill.voided_at || null,
      bill.voided_by || null,
      bill.void_reason || null,
      bill.shift_id || null
    ];

    const result = await db.query(sql, params);

    if ('error' in result) {
      console.error('[dbSync] POS bill sync failed:', (result as any).error);
      return { success: false, error: (result as any).error };
    }

    console.log('[dbSync] POS bill synced to DB:', bill.id);
    return { success: true, synced: 1 };
  } catch (err: any) {
    console.error('[dbSync] POS bill sync error:', err?.message || err);
    return { success: false, error: err?.message || String(err) };
  }
}

/**
 * Load POS bills from database
 */
export async function loadPosBillsFromDb(businessDate?: string): Promise<{ success: boolean; bills: any[]; error?: string }> {
  try {
    const isConfigured = await db.isConfigured();
    if (!isConfigured) {
      return { success: true, bills: [] };
    }

    let sql = 'SELECT * FROM pos_bills';
    const params: any[] = [];

    if (businessDate) {
      sql += ' WHERE business_date = $1';
      params.push(businessDate);
    }

    sql += ' ORDER BY opened_at DESC';

    const result = await db.query(sql, params);

    if ('error' in result) {
      console.error('[dbSync] Load POS bills failed:', (result as any).error);
      return { success: false, bills: [], error: (result as any).error };
    }

    const bills = ('rows' in result ? result.rows : []).map((row: any) => ({
      id: row.id,
      billNumber: row.bill_number,
      outlet: row.outlet,
      tableNumber: row.table_number,
      guestId: row.guest_id,
      folioId: row.folio_id,
      roomNumber: row.room_number,
      subtotal: Number(row.subtotal || 0),
      taxAmount: Number(row.tax_amount || 0),
      discountAmount: Number(row.discount_amount || 0),
      serviceCharge: Number(row.service_charge || 0),
      totalAmount: Number(row.total_amount || 0),
      items: typeof row.items === 'string' ? JSON.parse(row.items) : (row.items || []),
      paymentMethod: row.payment_method,
      paymentStatus: row.payment_status,
      amountPaid: Number(row.amount_paid || 0),
      changeAmount: Number(row.change_amount || 0),
      businessDate: row.business_date,
      openedAt: row.opened_at,
      closedAt: row.closed_at,
      openedBy: row.opened_by,
      closedBy: row.closed_by,
      isVoided: row.is_voided,
      voidedAt: row.voided_at,
      voidedBy: row.voided_by,
      voidReason: row.void_reason,
      shiftId: row.shift_id
    }));

    console.log(`[dbSync] Loaded ${bills.length} POS bills from DB`);
    return { success: true, bills };
  } catch (err: any) {
    console.error('[dbSync] Load POS bills error:', err?.message || err);
    return { success: false, bills: [], error: err?.message || String(err) };
  }
}

// ============================================================================
// NIGHT AUDIT POSTINGS SYNC
// ============================================================================

/**
 * Sync night audit posting to database
 */
export async function syncNightAuditPostingToDb(posting: {
  id: string;
  business_date: string;
  room_number: string;
  guest_id?: string;
  reservation_id?: string;
  folio_id?: string;
  posting_type: string;
  base_rate: number;
  tax_amount: number;
  total_amount: number;
  rate_plan_code?: string;
  package_code?: string;
  status?: string;
  folio_charge_id?: string;
  posted_by?: string;
}): Promise<SyncResult> {
  try {
    const isConfigured = await db.isConfigured();
    if (!isConfigured) {
      return { success: true, synced: 0 };
    }

    const sql = `
      INSERT INTO night_audit_postings (
        id, business_date, room_number, guest_id, reservation_id, folio_id,
        posting_type, base_rate, tax_amount, total_amount,
        rate_plan_code, package_code, status, folio_charge_id,
        posted_by, posted_at, inserted_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), NOW())
      ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        folio_charge_id = EXCLUDED.folio_charge_id
    `;

    const params = [
      posting.id,
      posting.business_date,
      posting.room_number,
      posting.guest_id || null,
      posting.reservation_id || null,
      posting.folio_id || null,
      posting.posting_type || 'ROOM_TAX',
      Number(posting.base_rate || 0),
      Number(posting.tax_amount || 0),
      Number(posting.total_amount || 0),
      posting.rate_plan_code || null,
      posting.package_code || 'RO',
      posting.status || 'posted',
      posting.folio_charge_id || null,
      posting.posted_by || null
    ];

    const result = await db.query(sql, params);

    if ('error' in result) {
      console.error('[dbSync] Night audit posting sync failed:', (result as any).error);
      return { success: false, error: (result as any).error };
    }

    console.log('[dbSync] Night audit posting synced to DB:', posting.id);
    return { success: true, synced: 1 };
  } catch (err: any) {
    console.error('[dbSync] Night audit posting sync error:', err?.message || err);
    return { success: false, error: err?.message || String(err) };
  }
}

/**
 * Record a night audit run in the database
 */
export async function recordNightAuditRun(runData: {
  business_date: string;
  next_business_date: string;
  rooms_posted: number;
  room_revenue: number;
  tax_revenue: number;
  total_revenue: number;
  city_ledger_transfers: number;
  city_ledger_amount: number;
  occupied_rooms: number;
  available_rooms: number;
  occupancy_percent: number;
  adr: number;
  revpar: number;
  run_by?: string;
  reports_snapshot?: any;
}): Promise<SyncResult> {
  try {
    const isConfigured = await db.isConfigured();
    if (!isConfigured) {
      return { success: true, synced: 0 };
    }

    const sql = `
      INSERT INTO night_audit_runs (
        id, business_date, next_business_date,
        rooms_posted, room_revenue, tax_revenue, total_revenue,
        city_ledger_transfers, city_ledger_amount,
        occupied_rooms, available_rooms, occupancy_percent, adr, revpar,
        status, run_by, started_at, completed_at, reports_snapshot, inserted_at
      ) VALUES (
        gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
        'completed', $14, NOW(), NOW(), $15, NOW()
      )
      ON CONFLICT (business_date) DO UPDATE SET
        rooms_posted = EXCLUDED.rooms_posted,
        room_revenue = EXCLUDED.room_revenue,
        tax_revenue = EXCLUDED.tax_revenue,
        total_revenue = EXCLUDED.total_revenue,
        city_ledger_transfers = EXCLUDED.city_ledger_transfers,
        city_ledger_amount = EXCLUDED.city_ledger_amount,
        occupied_rooms = EXCLUDED.occupied_rooms,
        available_rooms = EXCLUDED.available_rooms,
        occupancy_percent = EXCLUDED.occupancy_percent,
        adr = EXCLUDED.adr,
        revpar = EXCLUDED.revpar,
        completed_at = NOW(),
        reports_snapshot = EXCLUDED.reports_snapshot
    `;

    const params = [
      runData.business_date,
      runData.next_business_date,
      runData.rooms_posted,
      runData.room_revenue,
      runData.tax_revenue,
      runData.total_revenue,
      runData.city_ledger_transfers,
      runData.city_ledger_amount,
      runData.occupied_rooms,
      runData.available_rooms,
      runData.occupancy_percent,
      runData.adr,
      runData.revpar,
      runData.run_by || null,
      runData.reports_snapshot ? JSON.stringify(runData.reports_snapshot) : null
    ];

    const result = await db.query(sql, params);

    if ('error' in result) {
      console.error('[dbSync] Night audit run record failed:', (result as any).error);
      return { success: false, error: (result as any).error };
    }

    console.log('[dbSync] Night audit run recorded for:', runData.business_date);
    return { success: true, synced: 1 };
  } catch (err: any) {
    console.error('[dbSync] Night audit run record error:', err?.message || err);
    return { success: false, error: err?.message || String(err) };
  }
}

// ============================================================================
// RECONCILIATION LOGS SYNC
// ============================================================================

export interface ReconciliationLogRecord {
  id?: string;
  business_date: string;
  reconciliation_type: 'manual' | 'automatic' | 'forced' | 'override';
  status: 'pending' | 'completed' | 'failed' | 'forced_complete';
  folio_total: number;
  shift_total: number;
  postings_total: number;
  variance_folio_vs_shift: number;
  variance_folio_vs_postings: number;
  total_variance: number;
  is_forced: boolean;
  force_reason?: string;
  journal_entry_ids?: string[];
  affected_accounts?: Array<{ account: string; debit?: number; credit?: number }>;
  performed_by?: string;
  night_audit_run_id?: string;
  notes?: string;
  metadata?: any;
}

export interface VarianceJournalEntryRecord {
  id?: string;
  reconciliation_log_id?: string;
  journal_entry_id: string;
  business_date: string;
  entry_type: 'variance_adjustment' | 'over_short' | 'suspense' | 'correction';
  debit_account: string;
  credit_account: string;
  amount: number;
  description: string;
  reference?: string;
  created_by?: string;
  metadata?: any;
}

/**
 * Record a reconciliation log to the database
 */
export async function recordReconciliationLog(log: ReconciliationLogRecord): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    const isConfigured = await db.isConfigured();
    if (!isConfigured) {
      console.log('[dbSync] Database not configured, skipping reconciliation log');
      return { success: true };
    }

    const logId = log.id || `RECON_${log.business_date}_${Date.now()}`;

    const sql = `
      INSERT INTO reconciliation_logs (
        id, business_date, reconciliation_type, status,
        folio_total, shift_total, postings_total,
        variance_folio_vs_shift, variance_folio_vs_postings, total_variance,
        is_forced, force_reason, journal_entry_ids, affected_accounts,
        performed_by, night_audit_run_id, notes, metadata, inserted_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, NOW()
      )
      ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        is_forced = EXCLUDED.is_forced,
        force_reason = EXCLUDED.force_reason,
        journal_entry_ids = EXCLUDED.journal_entry_ids,
        affected_accounts = EXCLUDED.affected_accounts,
        notes = EXCLUDED.notes,
        updated_at = NOW()
    `;

    const params = [
      logId,
      log.business_date,
      log.reconciliation_type,
      log.status,
      Number(log.folio_total || 0),
      Number(log.shift_total || 0),
      Number(log.postings_total || 0),
      Number(log.variance_folio_vs_shift || 0),
      Number(log.variance_folio_vs_postings || 0),
      Number(log.total_variance || 0),
      log.is_forced || false,
      log.force_reason || null,
      log.journal_entry_ids || null,
      log.affected_accounts ? JSON.stringify(log.affected_accounts) : null,
      log.performed_by || null,
      log.night_audit_run_id || null,
      log.notes || null,
      log.metadata ? JSON.stringify(log.metadata) : null
    ];

    const result = await db.query(sql, params);

    if ('error' in result) {
      console.error('[dbSync] Reconciliation log failed:', (result as any).error);
      return { success: false, error: (result as any).error };
    }

    console.log('[dbSync] Reconciliation log recorded:', logId);
    return { success: true, id: logId };
  } catch (err: any) {
    console.error('[dbSync] Reconciliation log error:', err?.message || err);
    return { success: false, error: err?.message || String(err) };
  }
}

/**
 * Record a variance journal entry to the database
 */
export async function recordVarianceJournalEntry(entry: VarianceJournalEntryRecord): Promise<SyncResult> {
  try {
    const isConfigured = await db.isConfigured();
    if (!isConfigured) {
      console.log('[dbSync] Database not configured, skipping variance journal entry');
      return { success: true, synced: 0 };
    }

    const sql = `
      INSERT INTO variance_journal_entries (
        id, reconciliation_log_id, journal_entry_id, business_date,
        entry_type, debit_account, credit_account, amount,
        description, reference, created_by, metadata, created_at
      ) VALUES (
        gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW()
      )
    `;

    const params = [
      entry.reconciliation_log_id || null,
      entry.journal_entry_id,
      entry.business_date,
      entry.entry_type,
      entry.debit_account,
      entry.credit_account,
      Number(entry.amount || 0),
      entry.description,
      entry.reference || null,
      entry.created_by || null,
      entry.metadata ? JSON.stringify(entry.metadata) : null
    ];

    const result = await db.query(sql, params);

    if ('error' in result) {
      console.error('[dbSync] Variance journal entry failed:', (result as any).error);
      return { success: false, error: (result as any).error };
    }

    console.log('[dbSync] Variance journal entry recorded:', entry.journal_entry_id);
    return { success: true, synced: 1 };
  } catch (err: any) {
    console.error('[dbSync] Variance journal entry error:', err?.message || err);
    return { success: false, error: err?.message || String(err) };
  }
}

/**
 * Load reconciliation logs from database
 */
export async function loadReconciliationLogs(businessDate?: string): Promise<{ success: boolean; logs: any[]; error?: string }> {
  try {
    const isConfigured = await db.isConfigured();
    if (!isConfigured) {
      return { success: true, logs: [] };
    }

    let sql = 'SELECT * FROM reconciliation_logs';
    const params: any[] = [];

    if (businessDate) {
      sql += ' WHERE business_date = $1';
      params.push(businessDate);
    }

    sql += ' ORDER BY performed_at DESC';

    const result = await db.query(sql, params);

    if ('error' in result) {
      console.error('[dbSync] Load reconciliation logs failed:', (result as any).error);
      return { success: false, logs: [], error: (result as any).error };
    }

    const logs = 'rows' in result ? result.rows : [];
    console.log(`[dbSync] Loaded ${logs.length} reconciliation logs`);
    return { success: true, logs };
  } catch (err: any) {
    console.error('[dbSync] Load reconciliation logs error:', err?.message || err);
    return { success: false, logs: [], error: err?.message || String(err) };
  }
}

/**
 * Load variance journal entries from database
 */
export async function loadVarianceJournalEntries(reconciliationLogId?: string): Promise<{ success: boolean; entries: any[]; error?: string }> {
  try {
    const isConfigured = await db.isConfigured();
    if (!isConfigured) {
      return { success: true, entries: [] };
    }

    let sql = 'SELECT * FROM variance_journal_entries';
    const params: any[] = [];

    if (reconciliationLogId) {
      sql += ' WHERE reconciliation_log_id = $1';
      params.push(reconciliationLogId);
    }

    sql += ' ORDER BY created_at DESC';

    const result = await db.query(sql, params);

    if ('error' in result) {
      console.error('[dbSync] Load variance journal entries failed:', (result as any).error);
      return { success: false, entries: [], error: (result as any).error };
    }

    const entries = 'rows' in result ? result.rows : [];
    console.log(`[dbSync] Loaded ${entries.length} variance journal entries`);
    return { success: true, entries };
  } catch (err: any) {
    console.error('[dbSync] Load variance journal entries error:', err?.message || err);
    return { success: false, entries: [], error: err?.message || String(err) };
  }
}

// ============================================================================
// GL ACCOUNTS (CHART OF ACCOUNTS) SYNC
// ============================================================================

export interface GLAccountRecord {
  id: string; // Account code e.g., '4000'
  name: string;
  description?: string;
  category: 'Asset' | 'Liability' | 'Equity' | 'Revenue' | 'Expense';
  account_type?: string;
  usali_code?: string;
  usali_name?: string;
  department?: string;
  parent_account_id?: string;
  level?: number;
  normal_balance?: 'debit' | 'credit';
  is_active?: boolean;
  is_header?: boolean;
  is_system?: boolean;
  current_balance?: number;
  ytd_balance?: number;
  created_by?: string;
}

/**
 * Sync a GL account to the database
 */
export async function syncGLAccountToDb(account: GLAccountRecord): Promise<SyncResult> {
  try {
    // Validate required fields
    if (!account.id || !account.name || !account.category) {
      console.error('[dbSync] Invalid GL account data:', account);
      return { success: false, error: 'Missing required fields (id, name, category)' };
    }

    const isConfigured = await db.isConfigured();
    if (!isConfigured) {
      return { success: true, synced: 0 };
    }

    const sql = `
      INSERT INTO gl_accounts (
        id, name, description, category, account_type,
        usali_code, usali_name, department, parent_account_id, level,
        normal_balance, is_active, is_header, is_system,
        current_balance, ytd_balance, created_by, inserted_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW())
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        account_type = EXCLUDED.account_type,
        department = EXCLUDED.department,
        is_active = EXCLUDED.is_active,
        current_balance = EXCLUDED.current_balance,
        ytd_balance = EXCLUDED.ytd_balance,
        updated_at = NOW()
    `;

    const params = [
      account.id,
      account.name,
      account.description || null,
      account.category,
      account.account_type || null,
      account.usali_code || null,
      account.usali_name || null,
      account.department || null,
      account.parent_account_id || null,
      account.level || 1,
      account.normal_balance || 'debit',
      account.is_active !== false,
      account.is_header || false,
      account.is_system || false,
      Number(account.current_balance || 0),
      Number(account.ytd_balance || 0),
      account.created_by || null
    ];

    const result = await db.query(sql, params);

    if ('error' in result) {
      console.error('[dbSync] GL account sync failed:', (result as any).error);
      return { success: false, error: (result as any).error };
    }

    console.log('[dbSync] GL account synced:', account.id);
    return { success: true, synced: 1 };
  } catch (err: any) {
    console.error('[dbSync] GL account sync error:', err?.message || err);
    return { success: false, error: err?.message || String(err) };
  }
}

/**
 * Load GL accounts from database
 */
export async function loadGLAccountsFromDb(): Promise<{ success: boolean; accounts: GLAccountRecord[]; error?: string }> {
  try {
    const isConfigured = await db.isConfigured();
    if (!isConfigured) {
      return { success: true, accounts: [] };
    }

    const sql = 'SELECT * FROM gl_accounts ORDER BY id';
    const result = await db.query(sql);

    if ('error' in result) {
      console.error('[dbSync] Load GL accounts failed:', (result as any).error);
      return { success: false, accounts: [], error: (result as any).error };
    }

    const accounts = ('rows' in result ? result.rows : []) as GLAccountRecord[];
    console.log(`[dbSync] Loaded ${accounts.length} GL accounts from DB`);
    return { success: true, accounts };
  } catch (err: any) {
    console.error('[dbSync] Load GL accounts error:', err?.message || err);
    return { success: false, accounts: [], error: err?.message || String(err) };
  }
}

/**
 * Sync all GL accounts from localStorage to database
 */
export async function syncAllGLAccountsToDb(): Promise<SyncResult> {
  try {
    const isConfigured = await db.isConfigured();
    if (!isConfigured) {
      return { success: true, synced: 0 };
    }

    const raw = localStorage.getItem('corepms_gl_accounts');
    const accounts: any[] = raw ? JSON.parse(raw) : [];

    if (accounts.length === 0) {
      return { success: true, synced: 0 };
    }

    let synced = 0;
    for (const acc of accounts) {
      const record: GLAccountRecord = {
        id: acc.id,
        name: acc.name,
        category: acc.category,
        department: acc.department,
        usali_code: acc.usali,
        is_active: acc.isActive !== false
      };
      const result = await syncGLAccountToDb(record);
      if (result.success) synced++;
    }

    console.log(`[dbSync] Synced ${synced}/${accounts.length} GL accounts to DB`);
    return { success: true, synced };
  } catch (err: any) {
    console.error('[dbSync] Sync all GL accounts error:', err?.message || err);
    return { success: false, error: err?.message || String(err) };
  }
}

// ============================================================================
// GL JOURNAL ENTRIES SYNC
// ============================================================================

export interface GLJournalEntryRecord {
  id: string;
  entry_date: string;
  business_date: string;
  description?: string;
  reference?: string;
  source: 'manual' | 'night_audit' | 'expense' | 'pos' | 'folio' | 'reconciliation' | 'adjustment' | 'closing' | 'opening' | 'system';
  source_reference?: string;
  source_id?: string;
  entry_type?: 'standard' | 'adjusting' | 'closing' | 'opening' | 'reversing' | 'recurring';
  status?: 'draft' | 'pending' | 'posted' | 'voided' | 'reversed';
  total_debit: number;
  total_credit: number;
  is_balanced?: boolean;
  is_voided?: boolean;
  created_by?: string;
  posted_by?: string;
  attachments?: any;
}

export interface GLJournalLineRecord {
  journal_entry_id: string;
  line_number?: number;
  gl_account_id: string;
  debit_amount: number;
  credit_amount: number;
  description?: string;
  department?: string;
  cost_center?: string;
  reference?: string;
}

/**
 * Sync a GL journal entry with its lines to the database
 */
export async function syncGLJournalEntryToDb(
  entry: GLJournalEntryRecord,
  lines: GLJournalLineRecord[]
): Promise<SyncResult> {
  try {
    // Validate required fields
    if (!entry.id || !entry.entry_date || !entry.business_date) {
      console.error('[dbSync] Invalid GL journal entry data:', entry);
      return { success: false, error: 'Missing required fields (id, entry_date, business_date)' };
    }

    if (!lines || lines.length === 0) {
      console.error('[dbSync] Invalid GL journal entry lines data:', lines);
      return { success: false, error: 'Journal entry must have at least one line' };
    }

    const isConfigured = await db.isConfigured();
    if (!isConfigured) {
      return { success: true, synced: 0 };
    }

    // Insert/update journal entry header
    const entrySql = `
      INSERT INTO gl_journal_entries (
        id, entry_date, business_date, description, reference,
        source, source_reference, source_id, entry_type, status,
        total_debit, total_credit, is_balanced, is_voided,
        created_by, posted_by, posted_at, attachments, inserted_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW(), $17, NOW())
      ON CONFLICT (id) DO UPDATE SET
        description = EXCLUDED.description,
        reference = EXCLUDED.reference,
        status = EXCLUDED.status,
        total_debit = EXCLUDED.total_debit,
        total_credit = EXCLUDED.total_credit,
        is_balanced = EXCLUDED.is_balanced,
        is_voided = EXCLUDED.is_voided,
        updated_at = NOW()
    `;

    const entryParams = [
      entry.id,
      entry.entry_date,
      entry.business_date,
      entry.description || null,
      entry.reference || null,
      entry.source || 'manual',
      entry.source_reference || null,
      entry.source_id || null,
      entry.entry_type || 'standard',
      entry.status || 'posted',
      Number(entry.total_debit || 0),
      Number(entry.total_credit || 0),
      entry.is_balanced !== false,
      entry.is_voided || false,
      entry.created_by || null,
      entry.posted_by || null,
      entry.attachments ? JSON.stringify(entry.attachments) : null
    ];

    const entryResult = await db.query(entrySql, entryParams);
    if ('error' in entryResult) {
      console.error('[dbSync] GL journal entry sync failed:', (entryResult as any).error);
      return { success: false, error: (entryResult as any).error };
    }

    // Delete existing lines and re-insert
    await db.query('DELETE FROM gl_journal_lines WHERE journal_entry_id = $1', [entry.id]);

    // Insert lines
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Validate each line
      if (!line.gl_account_id) {
        console.error('[dbSync] Invalid GL journal line data:', line);
        return { success: false, error: `Line ${i + 1} missing required field (gl_account_id)` };
      }
      const lineSql = `
        INSERT INTO gl_journal_lines (
          journal_entry_id, line_number, gl_account_id,
          debit_amount, credit_amount, description,
          department, cost_center, reference, inserted_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      `;
      await db.query(lineSql, [
        entry.id,
        line.line_number || i + 1,
        line.gl_account_id,
        Number(line.debit_amount || 0),
        Number(line.credit_amount || 0),
        line.description || null,
        line.department || null,
        line.cost_center || null,
        line.reference || null
      ]);
    }

    console.log('[dbSync] GL journal entry synced:', entry.id, `with ${lines.length} lines`);
    return { success: true, synced: 1 };
  } catch (err: any) {
    console.error('[dbSync] GL journal entry sync error:', err?.message || err);
    return { success: false, error: err?.message || String(err) };
  }
}

/**
 * Load GL journal entries from database
 */
export async function loadGLJournalEntriesFromDb(fromDate?: string, toDate?: string): Promise<{ success: boolean; entries: any[]; error?: string }> {
  try {
    const isConfigured = await db.isConfigured();
    if (!isConfigured) {
      return { success: true, entries: [] };
    }

    let sql = `
      SELECT e.*, 
        json_agg(json_build_object(
          'line_number', l.line_number,
          'gl_account_id', l.gl_account_id,
          'debit_amount', l.debit_amount,
          'credit_amount', l.credit_amount,
          'description', l.description,
          'department', l.department
        ) ORDER BY l.line_number) as lines
      FROM gl_journal_entries e
      LEFT JOIN gl_journal_lines l ON l.journal_entry_id = e.id
    `;
    const params: any[] = [];
    const conditions: string[] = [];

    if (fromDate) {
      conditions.push(`e.entry_date >= $${params.length + 1}`);
      params.push(fromDate);
    }
    if (toDate) {
      conditions.push(`e.entry_date <= $${params.length + 1}`);
      params.push(toDate);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' GROUP BY e.id ORDER BY e.entry_date DESC, e.id DESC';

    const result = await db.query(sql, params);

    if ('error' in result) {
      console.error('[dbSync] Load GL journal entries failed:', (result as any).error);
      return { success: false, entries: [], error: (result as any).error };
    }

    const entries = 'rows' in result ? result.rows : [];
    console.log(`[dbSync] Loaded ${entries.length} GL journal entries from DB`);
    return { success: true, entries };
  } catch (err: any) {
    console.error('[dbSync] Load GL journal entries error:', err?.message || err);
    return { success: false, entries: [], error: err?.message || String(err) };
  }
}

// ============================================================================
// EXPENSES SYNC
// ============================================================================

export interface ExpenseRecord {
  id?: string;
  expense_number: string;
  vendor_id?: string;
  vendor_name?: string;
  invoice_number?: string;
  invoice_date?: string;
  due_date?: string;
  expense_date: string;
  business_date: string;
  expense_type?: 'Operating' | 'Capital' | 'Payroll' | 'Tax' | 'Interest' | 'Other';
  category: string;
  gl_account_id?: string;
  cost_center?: string;
  department?: string;
  amount: number;
  tax_amount?: number;
  total_amount: number;
  currency?: string;
  payment_method?: 'Cash' | 'Check' | 'BankTransfer' | 'CreditCard' | 'Petty Cash' | 'Other';
  payment_reference?: string;
  paid_date?: string;
  paid_amount?: number;
  status: 'draft' | 'pending_approval' | 'approved' | 'rejected' | 'posted' | 'paid' | 'voided';
  requires_approval?: boolean;
  approved_by?: string;
  approved_at?: string;
  journal_entry_id?: string;
  description?: string;
  notes?: string;
  is_voided?: boolean;
  created_by?: string;
}

/**
 * Sync an expense to the database
 */
export async function syncExpenseToDb(expense: ExpenseRecord): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    // Validate required fields
    if (!expense.expense_number || !expense.expense_date || !expense.business_date || typeof expense.amount === 'undefined' || expense.amount === null) {
      console.error('[dbSync] Invalid expense data:', expense);
      return { success: false, error: 'Missing required fields (expense_number, expense_date, business_date, amount)' };
    }

    const isConfigured = await db.isConfigured();
    if (!isConfigured) {
      return { success: true };
    }

    const sql = `
      INSERT INTO expenses (
        id, expense_number, vendor_id, vendor_name,
        invoice_number, invoice_date, due_date,
        expense_date, business_date, expense_type, category,
        gl_account_id, cost_center, department,
        amount, tax_amount, total_amount, currency,
        payment_method, payment_reference, paid_date, paid_amount,
        status, requires_approval, approved_by, approved_at,
        journal_entry_id, description, notes, is_voided,
        created_by, inserted_at
      ) VALUES (
        COALESCE($1, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22,
        $23, $24, $25, $26, $27, $28, $29, $30, $31, NOW()
      )
      ON CONFLICT (expense_number) DO UPDATE SET
        vendor_id = EXCLUDED.vendor_id,
        vendor_name = EXCLUDED.vendor_name,
        status = EXCLUDED.status,
        approved_by = EXCLUDED.approved_by,
        approved_at = EXCLUDED.approved_at,
        journal_entry_id = EXCLUDED.journal_entry_id,
        payment_method = EXCLUDED.payment_method,
        paid_date = EXCLUDED.paid_date,
        paid_amount = EXCLUDED.paid_amount,
        is_voided = EXCLUDED.is_voided,
        updated_at = NOW()
      RETURNING id
    `;

    const params = [
      expense.id || null,
      expense.expense_number,
      expense.vendor_id || null,
      expense.vendor_name || null,
      expense.invoice_number || null,
      expense.invoice_date || null,
      expense.due_date || null,
      expense.expense_date,
      expense.business_date,
      expense.expense_type || 'Operating',
      expense.category || 'General',
      expense.gl_account_id || null,
      expense.cost_center || null,
      expense.department || null,
      Number(expense.amount || 0),
      Number(expense.tax_amount || 0),
      Number(expense.total_amount || expense.amount || 0),
      expense.currency || 'PHP',
      expense.payment_method || null,
      expense.payment_reference || null,
      expense.paid_date || null,
      expense.paid_amount ? Number(expense.paid_amount) : null,
      expense.status || 'draft',
      expense.requires_approval || false,
      expense.approved_by || null,
      expense.approved_at || null,
      expense.journal_entry_id || null,
      expense.description || null,
      expense.notes || null,
      expense.is_voided || false,
      expense.created_by || null
    ];

    const result = await db.query(sql, params);

    if ('error' in result) {
      console.error('[dbSync] Expense sync failed:', (result as any).error);
      return { success: false, error: (result as any).error };
    }

    const rows = 'rows' in result ? result.rows : [];
    const expenseId = rows[0]?.id;
    console.log('[dbSync] Expense synced:', expense.expense_number);
    return { success: true, id: expenseId };
  } catch (err: any) {
    console.error('[dbSync] Expense sync error:', err?.message || err);
    return { success: false, error: err?.message || String(err) };
  }
}

/**
 * Load expenses from database
 */
export async function loadExpensesFromDb(fromDate?: string, toDate?: string): Promise<{ success: boolean; expenses: any[]; error?: string }> {
  try {
    const isConfigured = await db.isConfigured();
    if (!isConfigured) {
      return { success: true, expenses: [] };
    }

    let sql = 'SELECT * FROM expenses';
    const params: any[] = [];
    const conditions: string[] = [];

    if (fromDate) {
      conditions.push(`expense_date >= $${params.length + 1}`);
      params.push(fromDate);
    }
    if (toDate) {
      conditions.push(`expense_date <= $${params.length + 1}`);
      params.push(toDate);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY expense_date DESC, expense_number DESC';

    const result = await db.query(sql, params);

    if ('error' in result) {
      console.error('[dbSync] Load expenses failed:', (result as any).error);
      return { success: false, expenses: [], error: (result as any).error };
    }

    const expenses = 'rows' in result ? result.rows : [];
    console.log(`[dbSync] Loaded ${expenses.length} expenses from DB`);
    return { success: true, expenses };
  } catch (err: any) {
    console.error('[dbSync] Load expenses error:', err?.message || err);
    return { success: false, expenses: [], error: err?.message || String(err) };
  }
}

// ============================================================================
// VENDORS SYNC
// ============================================================================

export interface VendorRecord {
  id?: string;
  name: string;
  code?: string;
  vendor_type?: 'Supplier' | 'Contractor' | 'Service Provider' | 'Utility' | 'Government' | 'Other';
  category?: string;
  contact_name?: string;
  phone?: string;
  email?: string;
  address_line1?: string;
  city?: string;
  country?: string;
  tax_id?: string;
  payment_terms?: string;
  default_gl_account_id?: string;
  is_active?: boolean;
  notes?: string;
  created_by?: string;
}

/**
 * Sync a vendor to the database
 */
export async function syncVendorToDb(vendor: VendorRecord): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    // Validate required fields
    if (!vendor.name) {
      console.error('[dbSync] Invalid vendor data:', vendor);
      return { success: false, error: 'Missing required field (name)' };
    }

    const isConfigured = await db.isConfigured();
    if (!isConfigured) {
      return { success: true };
    }

    const sql = `
      INSERT INTO vendors (
        id, name, code, vendor_type, category,
        contact_name, phone, email, address_line1, city, country,
        tax_id, payment_terms, default_gl_account_id, is_active,
        notes, created_by, inserted_at
      ) VALUES (
        COALESCE($1, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, NOW()
      )
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        vendor_type = EXCLUDED.vendor_type,
        category = EXCLUDED.category,
        contact_name = EXCLUDED.contact_name,
        phone = EXCLUDED.phone,
        email = EXCLUDED.email,
        is_active = EXCLUDED.is_active,
        updated_at = NOW()
      RETURNING id
    `;

    const params = [
      vendor.id || null,
      vendor.name,
      vendor.code || null,
      vendor.vendor_type || 'Supplier',
      vendor.category || null,
      vendor.contact_name || null,
      vendor.phone || null,
      vendor.email || null,
      vendor.address_line1 || null,
      vendor.city || null,
      vendor.country || 'Philippines',
      vendor.tax_id || null,
      vendor.payment_terms || 'Net 30',
      vendor.default_gl_account_id || null,
      vendor.is_active !== false,
      vendor.notes || null,
      vendor.created_by || null
    ];

    const result = await db.query(sql, params);

    if ('error' in result) {
      console.error('[dbSync] Vendor sync failed:', (result as any).error);
      return { success: false, error: (result as any).error };
    }

    const rows = 'rows' in result ? result.rows : [];
    const vendorId = rows[0]?.id;
    console.log('[dbSync] Vendor synced:', vendor.name);
    return { success: true, id: vendorId };
  } catch (err: any) {
    console.error('[dbSync] Vendor sync error:', err?.message || err);
    return { success: false, error: err?.message || String(err) };
  }
}

/**
 * Load vendors from database
 */
export async function loadVendorsFromDb(): Promise<{ success: boolean; vendors: any[]; error?: string }> {
  try {
    const isConfigured = await db.isConfigured();
    if (!isConfigured) {
      return { success: true, vendors: [] };
    }

    const sql = 'SELECT * FROM vendors WHERE is_active = true ORDER BY name';
    const result = await db.query(sql);

    if ('error' in result) {
      console.error('[dbSync] Load vendors failed:', (result as any).error);
      return { success: false, vendors: [], error: (result as any).error };
    }

    const vendors = 'rows' in result ? result.rows : [];
    console.log(`[dbSync] Loaded ${vendors.length} vendors from DB`);
    return { success: true, vendors };
  } catch (err: any) {
    console.error('[dbSync] Load vendors error:', err?.message || err);
    return { success: false, vendors: [], error: err?.message || String(err) };
  }
}

// ============================================================================
// POS SHIFTS SYNC
// ============================================================================

export interface PosShiftRecord {
  id: string;
  outlet: string;
  shift_number?: number;
  business_date: string;
  opened_at: string;
  closed_at?: string;
  opened_by: string;
  closed_by?: string;
  opening_cash: number;
  closing_cash?: number;
  expected_cash?: number;
  cash_variance?: number;
  total_sales: number;
  total_cash: number;
  total_card: number;
  total_room_charge: number;
  total_city_ledger: number;
  total_voids: number;
  total_discounts: number;
  total_refunds: number;
  transaction_count: number;
  status: 'open' | 'closing' | 'closed' | 'reconciled';
  is_reconciled?: boolean;
  z_reading_number?: string;
}

/**
 * Sync a POS shift to the database
 */
export async function syncPosShiftToDb(shift: PosShiftRecord): Promise<SyncResult> {
  try {
    // Validate required fields
    if (!shift.id || !shift.outlet || !shift.business_date || !shift.opened_at || !shift.opened_by) {
      console.error('[dbSync] Invalid POS shift data:', shift);
      return { success: false, error: 'Missing required fields (id, outlet, business_date, opened_at, opened_by)' };
    }

    const isConfigured = await db.isConfigured();
    if (!isConfigured) {
      return { success: true, synced: 0 };
    }

    const sql = `
      INSERT INTO pos_shifts (
        id, outlet, shift_number, business_date,
        opened_at, closed_at, opened_by, closed_by,
        opening_cash, closing_cash, expected_cash, cash_variance,
        total_sales, total_cash, total_card, total_room_charge,
        total_city_ledger, total_voids, total_discounts, total_refunds,
        transaction_count, status, is_reconciled, z_reading_number, inserted_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
        $17, $18, $19, $20, $21, $22, $23, $24, NOW()
      )
      ON CONFLICT (id) DO UPDATE SET
        closed_at = EXCLUDED.closed_at,
        closed_by = EXCLUDED.closed_by,
        closing_cash = EXCLUDED.closing_cash,
        expected_cash = EXCLUDED.expected_cash,
        cash_variance = EXCLUDED.cash_variance,
        total_sales = EXCLUDED.total_sales,
        total_cash = EXCLUDED.total_cash,
        total_card = EXCLUDED.total_card,
        total_room_charge = EXCLUDED.total_room_charge,
        total_city_ledger = EXCLUDED.total_city_ledger,
        total_voids = EXCLUDED.total_voids,
        total_discounts = EXCLUDED.total_discounts,
        total_refunds = EXCLUDED.total_refunds,
        transaction_count = EXCLUDED.transaction_count,
        status = EXCLUDED.status,
        is_reconciled = EXCLUDED.is_reconciled,
        z_reading_number = EXCLUDED.z_reading_number,
        updated_at = NOW()
    `;

    const params = [
      shift.id,
      shift.outlet,
      shift.shift_number || 1,
      shift.business_date,
      shift.opened_at,
      shift.closed_at || null,
      shift.opened_by,
      shift.closed_by || null,
      Number(shift.opening_cash || 0),
      shift.closing_cash ? Number(shift.closing_cash) : null,
      shift.expected_cash ? Number(shift.expected_cash) : null,
      shift.cash_variance ? Number(shift.cash_variance) : null,
      Number(shift.total_sales || 0),
      Number(shift.total_cash || 0),
      Number(shift.total_card || 0),
      Number(shift.total_room_charge || 0),
      Number(shift.total_city_ledger || 0),
      Number(shift.total_voids || 0),
      Number(shift.total_discounts || 0),
      Number(shift.total_refunds || 0),
      shift.transaction_count || 0,
      shift.status || 'open',
      shift.is_reconciled || false,
      shift.z_reading_number || null
    ];

    const result = await db.query(sql, params);

    if ('error' in result) {
      console.error('[dbSync] POS shift sync failed:', (result as any).error);
      return { success: false, error: (result as any).error };
    }

    console.log('[dbSync] POS shift synced:', shift.id);
    return { success: true, synced: 1 };
  } catch (err: any) {
    console.error('[dbSync] POS shift sync error:', err?.message || err);
    return { success: false, error: err?.message || String(err) };
  }
}

/**
 * Load POS shifts from database
 */
export async function loadPosShiftsFromDb(businessDate?: string): Promise<{ success: boolean; shifts: any[]; error?: string }> {
  try {
    const isConfigured = await db.isConfigured();
    if (!isConfigured) {
      return { success: true, shifts: [] };
    }

    let sql = 'SELECT * FROM pos_shifts';
    const params: any[] = [];

    if (businessDate) {
      sql += ' WHERE business_date = $1';
      params.push(businessDate);
    }

    sql += ' ORDER BY opened_at DESC';

    const result = await db.query(sql, params);

    if ('error' in result) {
      console.error('[dbSync] Load POS shifts failed:', (result as any).error);
      return { success: false, shifts: [], error: (result as any).error };
    }

    const shifts = 'rows' in result ? result.rows : [];
    console.log(`[dbSync] Loaded ${shifts.length} POS shifts from DB`);
    return { success: true, shifts };
  } catch (err: any) {
    console.error('[dbSync] Load POS shifts error:', err?.message || err);
    return { success: false, shifts: [], error: err?.message || String(err) };
  }
}

/**
 * Deduct stock from inventory based on POS sales
 */
export async function deductInventoryStock(items: { id: string; qty: number }[]): Promise<SyncResult> {
  const isConfigured = await db.isConfigured();
  if (!isConfigured) return { success: false, error: 'DB not configured' };

  try {
    // Basic aggregation to handle duplicate items in list if any
    const updates = new Map<string, number>();
    for (const item of items) {
      if (item.id) {
        updates.set(item.id, (updates.get(item.id) || 0) + item.qty);
      }
    }

    const operations = Array.from(updates.entries()).map(([id, qty]) => ({
      sql: `UPDATE inventory_items SET stock_level = GREATEST(0, stock_level - $1), updated_at = NOW() WHERE id = $2`,
      params: [qty, id]
    }));

    if (operations.length === 0) return { success: true, synced: 0 };

    const result = await db.transaction(operations);
    if (!result.ok) throw new Error((result as any).error);

    console.log(`[dbSync] Deducted stock for ${operations.length} items`);
    return { success: true, synced: operations.length };
  } catch (err: any) {
    console.error('[dbSync] Deduct stock failed:', err);
    return { success: false, error: err.message };
  }
}
