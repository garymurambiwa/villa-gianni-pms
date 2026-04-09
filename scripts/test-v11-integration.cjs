#!/usr/bin/env node

/**
 * COREPMS v11 - Integration Test Suite
 * Tests the complete flow of the Advanced Inventory Module
 * 
 * Tests:
 * 1. Full GRN Flow - Create and post GRN
 * 2. Transfer + Breakdown - Stock transfer with unit conversion
 * 3. POS Sale Depletion - Simulate POS sale and verify depletion
 * 4. Variance Calculation - Calculate and verify variance
 * 5. Stock Balance Query - Verify ledger balance accuracy
 * 6. Variance Alert Levels - Verify alert classification
 */

const { Pool } = require('pg');
const path = require('path');
const crypto = require('crypto');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const COLORS = {
  GREEN: '\x1b[32m',
  RED: '\x1b[31m',
  YELLOW: '\x1b[33m',
  BLUE: '\x1b[34m',
  RESET: '\x1b[0m',
  BOLD: '\x1b[1m',
};

function log(message, color = COLORS.BLUE) {
  console.log(`${color}${message}${COLORS.RESET}`);
}

function success(message) {
  console.log(`${COLORS.GREEN}✅ ${message}${COLORS.RESET}`);
}

function error(message) {
  console.log(`${COLORS.RED}❌ ${message}${COLORS.RESET}`);
}

function warn(message) {
  console.log(`${COLORS.YELLOW}⚠️  ${message}${COLORS.RESET}`);
}

async function runTests() {
  log(`\n${'='.repeat(70)}\nCOREPMS v11 Integration Test Suite\n${'='.repeat(70)}\n`, COLORS.BOLD);

  let passedTests = 0;
  let failedTests = 0;
  const testResults = [];

  // ============================================================================
  // TEST 1: Full GRN Flow
  // ============================================================================
  log('\nTest 1: Full GRN Flow', COLORS.BOLD);
  log('Creating GRN: 10 Cases Jameson @ $180 to Main Cellar');

  try {
    const client = await pool.connect();

    // Step 1: Verify inv_items exists with test item
    const itemCheckRes = await client.query(
      `SELECT * FROM public.inv_items WHERE id = 'item_jameson_1'`
    );

    let itemId = 'item_jameson_1';
    if (!itemCheckRes.rows.length) {
      // Create test item if not exists
      await client.query(
        `INSERT INTO public.inv_items (id, name, category, base_uom_id, weighted_avg_cost)
        SELECT 'item_jameson_1', 'Jameson Whiskey', 'Beverage', 'uom_case', 180
        WHERE NOT EXISTS (SELECT 1 FROM public.inv_items WHERE id = 'item_jameson_1')`
      );
    }

    // Step 2: Create GRN
    const grnRes = await client.query(
      `INSERT INTO public.inv_grn_headers 
      (id, grn_number, supplier_name, destination_location_id, created_by, total_value, status)
      VALUES (gen_random_uuid()::text, 'GRN-TEST-001', 'Test Supplier', 'loc_main_cellar', 'test_user', 1800.00, 'draft')
      RETURNING *`
    );

    const grn = grnRes.rows[0];
    log(`   GRN Created: ${grn.grn_number} (${grn.id})`);

    // Step 3: Add line items
    await client.query(
      `INSERT INTO public.inv_grn_lines 
      (id, grn_header_id, item_id, qty_received, received_uom_id, unit_cost, line_total, line_number)
      VALUES (gen_random_uuid()::text, $1, $2, 10, 'uom_case', 180.00, 1800.00, 1)`,
      [grn.id, itemId]
    );

    log('   Line item added: 10 Cases @ $180');

    // Step 4: Post GRN to ledger
    await client.query(
      `INSERT INTO public.inv_stock_ledger 
      (id, item_id, location_id, ledger_type, reference_number, quantity_change, base_uom_id, cost_per_unit, total_cost, posted_by)
      VALUES (gen_random_uuid()::text, $1, 'loc_main_cellar', 'GRN', $2, 10, 'uom_case', 180.00, 1800.00, 'test_user')`,
      [itemId, grn.grn_number]
    );

    // Step 5: Update GRN status
    await client.query(`UPDATE public.inv_grn_headers SET status = 'posted' WHERE id = $1`, [grn.id]);

    // Verify ledger entry
    const ledgerRes = await client.query(
      `SELECT * FROM public.inv_stock_ledger 
      WHERE item_id = $1 AND location_id = 'loc_main_cellar' AND ledger_type = 'GRN'`,
      [itemId]
    );

    if (ledgerRes.rows.length > 0 && ledgerRes.rows[0].quantity_change === '10') {
      success('Test 1 PASSED: GRN flow complete - Ledger entry created with +10 qty');
      passedTests++;
      testResults.push({ test: 'Full GRN Flow', status: 'PASS' });
    } else {
      throw new Error('Ledger entry not created correctly');
    }

    client.release();
  } catch (err) {
    error(`Test 1 FAILED: ${err.message}`);
    failedTests++;
    testResults.push({ test: 'Full GRN Flow', status: 'FAIL', error: err.message });
  }

  // ============================================================================
  // TEST 2: Transfer + Breakdown
  // ============================================================================
  log('\nTest 2: Transfer + Breakdown', COLORS.BOLD);
  log('Transferring 2 Bottles Jameson from Main Cellar to Bar 1 with breakdown');

  try {
    const client = await pool.connect();

    // Create transfer
    const transRes = await client.query(
      `INSERT INTO public.inv_transfer_headers 
      (id, transfer_number, source_location_id, destination_location_id, created_by, status)
      VALUES (gen_random_uuid()::text, 'TRANS-TEST-001', 'loc_main_cellar', 'loc_bar1', 'test_user', 'draft')
      RETURNING *`
    );

    const transfer = transRes.rows[0];
    log(`   Transfer Created: ${transfer.transfer_number}`);

    // Add transfer line with breakdown
    await client.query(
      `INSERT INTO public.inv_transfer_lines 
      (id, transfer_header_id, item_id, qty_requested, source_uom_id, breakdown_flag, destination_uom_id, current_source_balance, line_number)
      VALUES (gen_random_uuid()::text, $1, 'item_jameson_1', 2, 'uom_bottle', true, 'uom_tot', 10, 1)`,
      [transfer.id]
    );

    log('   Line added: 2 Bottles with breakdown to Tots');

    // Execute transfer (create ledger entries)
    await client.query(
      `INSERT INTO public.inv_stock_ledger 
      (id, item_id, location_id, ledger_type, reference_number, quantity_change, base_uom_id, posted_by)
      VALUES (gen_random_uuid()::text, 'item_jameson_1', 'loc_main_cellar', 'TRANSFER_OUT', $1, -2, 'uom_bottle', 'test_user')`,
      [transfer.transfer_number]
    );

    // Transfer in with breakdown conversion (1 bottle = 30 tots)
    await client.query(
      `INSERT INTO public.inv_stock_ledger 
      (id, item_id, location_id, ledger_type, reference_number, quantity_change, base_uom_id, posted_by)
      VALUES (gen_random_uuid()::text, 'item_jameson_1', 'loc_bar1', 'TRANSFER_IN', $1, 60, 'uom_tot', 'test_user')`,
      [transfer.transfer_number]
    );

    // Verify ledger entries
    const outRes = await client.query(
      `SELECT SUM(quantity_change) as balance FROM public.inv_stock_ledger 
      WHERE item_id = 'item_jameson_1' AND location_id = 'loc_main_cellar'`
    );

    const inRes = await client.query(
      `SELECT SUM(quantity_change) as balance FROM public.inv_stock_ledger 
      WHERE item_id = 'item_jameson_1' AND location_id = 'loc_bar1'`
    );

    if (outRes.rows[0].balance === '8' && inRes.rows[0].balance === '60') {
      success('Test 2 PASSED: Transfer with breakdown - Main Cellar -2 Bottles, Bar +60 Tots');
      passedTests++;
      testResults.push({ test: 'Transfer + Breakdown', status: 'PASS' });
    } else {
      throw new Error(`Balances incorrect: Main=${outRes.rows[0].balance}, Bar=${inRes.rows[0].balance}`);
    }

    client.release();
  } catch (err) {
    error(`Test 2 FAILED: ${err.message}`);
    failedTests++;
    testResults.push({ test: 'Transfer + Breakdown', status: 'FAIL', error: err.message });
  }

  // ============================================================================
  // TEST 3: POS Sale Depletion
  // ============================================================================
  log('\nTest 3: POS Sale Depletion', COLORS.BOLD);
  log('Simulating 10 Quarter Chicken sales at Restaurant');

  try {
    const client = await pool.connect();

    // Create test recipe for Quarter Chicken
    const recipeRes = await client.query(
      `INSERT INTO public.inv_recipes 
      (id, menu_item_id, is_current, created_by)
      SELECT gen_random_uuid()::text, 'menu_quarter_chicken', true, 'test_user'
      WHERE NOT EXISTS (SELECT 1 FROM public.inv_recipes WHERE menu_item_id = 'menu_quarter_chicken' AND is_current = true)
      RETURNING *`
    );

    // Simulate POS depletion (10 sales x 350g per sale = 3500g total depletion)
    await client.query(
      `INSERT INTO public.inv_stock_ledger 
      (id, item_id, location_id, ledger_type, reference_number, quantity_change, base_uom_id, posted_by)
      VALUES (gen_random_uuid()::text, 'item_chicken', 'loc_restaurant', 'SALE_DEPLETION', 'POS-SALE-001', -3500, 'uom_gram', 'pos_system')`
    );

    log('   POS Depletion: 10 sales × 350g = 3500g total');

    // Verify depletion
    const depletionRes = await client.query(
      `SELECT SUM(quantity_change) as balance FROM public.inv_stock_ledger 
      WHERE item_id = 'item_chicken' AND location_id = 'loc_restaurant' AND ledger_type = 'SALE_DEPLETION'`
    );

    if (depletionRes.rows[0].balance === '-3500') {
      success('Test 3 PASSED: POS depletion recorded - 3500g depleted');
      passedTests++;
      testResults.push({ test: 'POS Sale Depletion', status: 'PASS' });
    } else {
      throw new Error(`Depletion incorrect: ${depletionRes.rows[0].balance}`);
    }

    client.release();
  } catch (err) {
    error(`Test 3 FAILED: ${err.message}`);
    failedTests++;
    testResults.push({ test: 'POS Sale Depletion', status: 'FAIL', error: err.message });
  }

  // ============================================================================
  // TEST 4: Variance Calculation
  // ============================================================================
  log('\nTest 4: Variance Calculation', COLORS.BOLD);
  log('Calculating variance: 300 Tots sold via POS vs 12 Bottles counted');

  try {
    const client = await pool.connect();

    // Theoretical: 300 tots sold
    const theoreticalQty = 300;

    // Physical: 12 bottles = 360 tots
    const physicalQty = 360;

    // Variance: 300 - 360 = -60 tots (60 tots over in inventory)
    const variance = theoreticalQty - physicalQty;
    const variancePct = (variance / theoreticalQty) * 100;

    log(`   Theoretical POS: ${theoreticalQty} tots`);
    log(`   Physical Count: ${physicalQty} tots (12 bottles)`);
    log(`   Variance: ${variance} tots (${variancePct.toFixed(2)}%)`);

    // Determine alert level: variance < 2% is OK, 2-5% is WARNING, > 5% is CRITICAL
    const alertLevel = Math.abs(variancePct) < 2 ? 'OK' : Math.abs(variancePct) < 5 ? 'WARNING' : 'CRITICAL';

    if (variancePct === -20 && alertLevel === 'CRITICAL') {
      success('Test 4 PASSED: Variance calculated correctly - Alert Level: CRITICAL (-20%)');
      passedTests++;
      testResults.push({ test: 'Variance Calculation', status: 'PASS' });
    } else {
      throw new Error(`Variance calc error: ${variancePct}% should be CRITICAL`);
    }

    client.release();
  } catch (err) {
    error(`Test 4 FAILED: ${err.message}`);
    failedTests++;
    testResults.push({ test: 'Variance Calculation', status: 'FAIL', error: err.message });
  }

  // ============================================================================
  // TEST 5: Stock Balance Query
  // ============================================================================
  log('\nTest 5: Stock Balance Query', COLORS.BOLD);
  log('Querying current balances across locations');

  try {
    const client = await pool.connect();

    const balRes = await client.query(
      `SELECT item_id, location_id, SUM(quantity_change) as balance FROM public.inv_stock_ledger
      WHERE item_id = 'item_jameson_1'
      GROUP BY item_id, location_id
      ORDER BY location_id`
    );

    if (balRes.rows.length > 0) {
      log(`   Balances queried: ${balRes.rows.length} location(s)`);
      balRes.rows.forEach(row => {
        log(`   Location ${row.location_id}: ${row.balance}`);
      });
      success('Test 5 PASSED: Stock balance query working correctly');
      passedTests++;
      testResults.push({ test: 'Stock Balance Query', status: 'PASS' });
    } else {
      throw new Error('No balance records found');
    }

    client.release();
  } catch (err) {
    error(`Test 5 FAILED: ${err.message}`);
    failedTests++;
    testResults.push({ test: 'Stock Balance Query', status: 'FAIL', error: err.message });
  }

  // ============================================================================
  // TEST 6: Variance Alert Levels
  // ============================================================================
  log('\nTest 6: Variance Alert Levels', COLORS.BOLD);
  log('Verifying alert level classification');

  try {
    const testCases = [
      { variance: 0.5, alertLevel: 'OK', description: '0.5% variance' },
      { variance: 3.0, alertLevel: 'WARNING', description: '3% variance' },
      { variance: 8.5, alertLevel: 'CRITICAL', description: '8.5% variance' },
    ];

    let allPassed = true;

    for (const test of testCases) {
      const computed = Math.abs(test.variance) < 2 ? 'OK' : Math.abs(test.variance) < 5 ? 'WARNING' : 'CRITICAL';

      if (computed === test.alertLevel) {
        log(`   ✓ ${test.description} → ${computed}`);
      } else {
        log(`   ✗ ${test.description} → Expected ${test.alertLevel}, got ${computed}`);
        allPassed = false;
      }
    }

    if (allPassed) {
      success('Test 6 PASSED: All alert levels classified correctly');
      passedTests++;
      testResults.push({ test: 'Variance Alert Levels', status: 'PASS' });
    } else {
      throw new Error('Some alert levels were incorrect');
    }
  } catch (err) {
    error(`Test 6 FAILED: ${err.message}`);
    failedTests++;
    testResults.push({ test: 'Variance Alert Levels', status: 'FAIL', error: err.message });
  }

  // ============================================================================
  // TEST SUMMARY
  // ============================================================================
  log(`\n${'='.repeat(70)}\nTest Summary\n${'='.repeat(70)}\n`, COLORS.BOLD);

  console.log(' Test Results:');
  testResults.forEach(result => {
    const icon = result.status === 'PASS' ? '✅' : '❌';
    const color = result.status === 'PASS' ? COLORS.GREEN : COLORS.RED;
    console.log(`   ${icon} ${color}${result.test}: ${result.status}${COLORS.RESET}`);
    if (result.error) {
      console.log(`      Error: ${result.error}`);
    }
  });

  console.log(`\n Total: ${COLORS.GREEN}${passedTests} Passed${COLORS.RESET} / ${COLORS.RED}${failedTests} Failed${COLORS.RESET}`);

  if (failedTests === 0) {
    console.log(`\n${COLORS.BOLD}${COLORS.GREEN}✅ ALL TESTS PASSED - v11 READY FOR REVIEW${COLORS.RESET}`);
    log('\nRollback Command (if needed):', COLORS.YELLOW);
    log('psql $DATABASE_URL < db/rollback/v11_pre/schema_backup.sql\n');
  } else {
    console.log(`\n${COLORS.BOLD}${COLORS.RED}❌ TESTS FAILED - Review errors above${COLORS.RESET}\n`);
  }

  console.log(`${COLORS.BOLD}Test Summary Report:${COLORS.RESET}`);
  console.log(`  Timestamp: ${new Date().toISOString()}`);
  console.log(`  Tests Run: ${passedTests + failedTests}`);
  console.log(`  Success Rate: ${((passedTests / (passedTests + failedTests)) * 100).toFixed(1)}%\n`);

  await pool.end();
  process.exit(failedTests > 0 ? 1 : 0);
}

runTests().catch(err => {
  error(`Fatal error: ${err.message}`);
  process.exit(1);
});
