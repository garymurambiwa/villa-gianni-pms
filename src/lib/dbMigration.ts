/**
 * Database Migration: Sequence Counters and Draft Transactions
 * 
 * Run this to add:
 * 1. sequence_counters table - for atomic bill numbering
 * 2. draft_transactions table - for draft transaction persistence
 * 3. Updated pos_bills table - with proper constraints
 */

import { db } from './db';

export async function runMigration(): Promise<{ success: boolean; error?: string }> {
  try {
    const isConfigured = await db.isConfigured();
    if (!isConfigured) {
      console.log('[Migration] Database not configured, skipping');
      return { success: true };
    }

    // Create sequence_counters table
    await db.query(`
      CREATE TABLE IF NOT EXISTS sequence_counters (
        outlet VARCHAR(50) PRIMARY KEY,
        last_number INTEGER NOT NULL DEFAULT 0,
        last_reset_date DATE,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create draft_transactions table
    await db.query(`
      CREATE TABLE IF NOT EXISTS draft_transactions (
        id VARCHAR(36) PRIMARY KEY,
        session_id VARCHAR(100) NOT NULL,
        user_id VARCHAR(50),
        outlet VARCHAR(20) NOT NULL,
        data JSONB NOT NULL,
        created_at TIMESTAMP NOT NULL,
        updated_at TIMESTAMP NOT NULL,
        version INTEGER NOT NULL DEFAULT 1
      )
    `);

    // Create indexes for draft_transactions
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_draft_session ON draft_transactions(session_id);
      CREATE INDEX IF NOT EXISTS idx_draft_user ON draft_transactions(user_id);
    `);

    // Add constraints to pos_bills for data integrity
    await db.query(`
      ALTER TABLE pos_bills 
      ADD CONSTRAINT IF NOT EXISTS chk_positive_subtotal CHECK (subtotal >= 0),
      ADD CONSTRAINT IF NOT EXISTS chk_positive_total CHECK (total_amount >= 0)
    `).catch(() => {}); // Ignore if already exist

    // Update pos_bills with bill_sequence column for ordering
    await db.query(`
      ALTER TABLE pos_bills 
      ADD COLUMN IF NOT EXISTS bill_sequence INTEGER
    `);

    console.log('[Migration] Successfully created sequence_counters and draft_transactions tables');
    return { success: true };
  } catch (err: any) {
    console.error('[Migration] Failed:', err);
    return { success: false, error: err?.message || String(err) };
  }
}

export async function initializeSequences(): Promise<void> {
  const isConfigured = await db.isConfigured();
  if (!isConfigured) return;

  const outlets = ['REST', 'BAR', 'CONF'];
  for (const outlet of outlets) {
    await db.query(`
      INSERT INTO sequence_counters (outlet, last_number, last_reset_date)
      VALUES ($1, 0, NULL)
      ON CONFLICT (outlet) DO NOTHING
    `, [outlet]);
  }
}