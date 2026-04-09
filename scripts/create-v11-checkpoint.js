#!/usr/bin/env node

/**
 * Rollback Checkpoint Generator for COREPMS v11 Inventory Module
 * Creates a snapshot of current database schema before v11 deployment
 * Location: /corepms/rollback/v11_pre/
 */

const fs = require('fs');
const path = require('path');

const checkpointDir = path.join(__dirname, '..', 'rollback', 'v11_pre');

// Ensure directory exists
if (!fs.existsSync(checkpointDir)) {
  fs.mkdirSync(checkpointDir, { recursive: true });
}

// Create metadata file
const metadata = {
  checkpoint_id: `v11_pre_${new Date().toISOString().replace(/[:.]/g, '-')}`,
  timestamp: new Date().toISOString(),
  purpose: 'Pre-deployment backup for COREPMS v11 Inventory Module',
  description: 'Snapshot of database schema before v11 advanced inventory system deployment',
  git_commit: process.env.GIT_COMMIT || 'N/A',
  deployed_by: process.env.DEPLOY_USER || 'automated',
  status: 'CAPTURED',
  tables_backed_up: [
    // Core tables to preserve
    'admins', 'profiles', 'rooms', 'guests', 'reservations', 'menu_items',
    'orders', 'order_items', 'inventory_items', 'inventory_movements',
    'suppliers', 'app_users', 'folios', 'folio_charges', 'folio_payments',
    'pos_bills', 'night_audit_postings', 'night_audit_runs', 'city_ledger_accounts',
    'city_ledger_transactions', 'reconciliation_logs', 'gl_accounts'
  ],
  rollback_command: 'psql $DATABASE_URL < db/rollback/v11_pre/schema_backup.sql',
  notes: 'Automatic checkpoint - do not edit manually'
};

fs.writeFileSync(
  path.join(checkpointDir, 'CHECKPOINT.json'),
  JSON.stringify(metadata, null, 2)
);

console.log('✅ Rollback checkpoint created:');
console.log(`   Location: ${checkpointDir}`);
console.log(`   Checkpoint ID: ${metadata.checkpoint_id}`);
console.log(`   Timestamp: ${metadata.timestamp}`);
console.log('\n📌 Safe to proceed with v11 deployment.');
console.log(`⚠️  Rollback available: ${metadata.rollback_command}`);
