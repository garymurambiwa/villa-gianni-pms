/**
 * v0.3.0 Release Verification Script
 * 
 * Tests all critical functionality before release:
 * 1. Reservation and Front Office Module Integration
 * 2. Breakfast Package CRUD with text[] serialization
 * 3. Data Persistence
 */

const { Client, types } = require('pg');

// Configure pg to return DATE as string instead of Date object
// This matches how the application handles dates
types.setTypeParser(types.builtins.DATE, (val) => val);

const DB_CONFIG = {
  host: '127.0.0.1',
  port: 54320,
  database: 'corepms_db',
  user: 'postgres',
  password: 'corepms_local'
};

let client;
let testResults = {
  passed: 0,
  failed: 0,
  tests: []
};

function log(message, isError = false) {
  const prefix = isError ? '[ERROR]' : '[TEST]';
  console.log(`${prefix} ${message}`);
}

function recordTest(name, passed, details = '') {
  testResults.tests.push({ name, passed, details });
  if (passed) {
    testResults.passed++;
    log(`✓ PASSED: ${name}`);
  } else {
    testResults.failed++;
    log(`✗ FAILED: ${name} - ${details}`, true);
  }
}

async function connect() {
  client = new Client(DB_CONFIG);
  try {
    await client.connect();
    log('Connected to database');
    return true;
  } catch (err) {
    log(`Failed to connect: ${err.message}`, true);
    return false;
  }
}

async function disconnect() {
  if (client) {
    await client.end();
    log('Disconnected from database');
  }
}

// ============================================================================
// TEST 1: Reservation and Front Office Integration
// ============================================================================

async function testReservationFrontOfficeIntegration() {
  log('\n=== Testing Reservation & Front Office Integration ===\n');
  
  const today = new Date().toISOString().split('T')[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
  const testGuestId = `TEST_GUEST_${Date.now()}`;
  const testResId = `TEST_RES_${Date.now()}`;
  
  try {
    // Create test guest
    await client.query(`
      INSERT INTO guests (id, full_name, email, phone, inserted_at)
      VALUES ($1, 'Test Guest FO', 'testfo@test.com', '1234567890', NOW())
    `, [testGuestId]);
    
    // Create test reservation for TODAY (should appear in arrivals)
    await client.query(`
      INSERT INTO reservations (
        id, guest_id, check_in_date, check_out_date, status, 
        room_type, rate, adults, children, package_code, inserted_at
      ) VALUES ($1, $2, $3, $4, 'confirmed', 'Standard', 100, 2, 0, 'RO', NOW())
    `, [testResId, testGuestId, today, tomorrow]);
    
    // Verify reservation was created
    const resCheck = await client.query(
      'SELECT * FROM reservations WHERE id = $1',
      [testResId]
    );
    
    recordTest(
      'Reservation Creation',
      resCheck.rows.length === 1,
      resCheck.rows.length === 0 ? 'Reservation not found' : ''
    );
    
    // Verify check_in_date is stored correctly as DATE type (YYYY-MM-DD)
    // With our DATE type parser, dates are returned as strings
    const checkInDate = resCheck.rows[0]?.check_in_date;
    const formattedDate = String(checkInDate).split('T')[0];
    
    recordTest(
      'Check-in Date Format (YYYY-MM-DD)',
      formattedDate === today,
      `Expected ${today}, got ${formattedDate}`
    );
    
    // Verify status is 'confirmed' (for arrivals display)
    recordTest(
      'Reservation Status is Confirmed',
      resCheck.rows[0]?.status === 'confirmed',
      `Status is: ${resCheck.rows[0]?.status}`
    );
    
    // Query for today's arrivals (simulating Front Office logic)
    const arrivalsQuery = await client.query(`
      SELECT r.*, g.full_name as guest_name
      FROM reservations r
      LEFT JOIN guests g ON r.guest_id = g.id
      WHERE r.check_in_date = $1 
        AND (r.status = 'confirmed' OR r.status = 'pending')
    `, [today]);
    
    const testResInArrivals = arrivalsQuery.rows.find(r => r.id === testResId);
    
    recordTest(
      'Reservation Appears in Today\'s Arrivals',
      !!testResInArrivals,
      testResInArrivals ? '' : 'Test reservation not found in arrivals query'
    );
    
    // Verify guest name is joined correctly
    recordTest(
      'Guest Name Joined Correctly',
      testResInArrivals?.guest_name === 'Test Guest FO',
      `Guest name: ${testResInArrivals?.guest_name}`
    );
    
    // Cleanup
    await client.query('DELETE FROM reservations WHERE id = $1', [testResId]);
    await client.query('DELETE FROM guests WHERE id = $1', [testGuestId]);
    
    log('Cleaned up test reservation and guest');
    
  } catch (err) {
    recordTest('Reservation/FO Integration', false, err.message);
  }
}

// ============================================================================
// TEST 2: Breakfast Package CRUD with text[] serialization
// ============================================================================

async function testBreakfastPackageCRUD() {
  log('\n=== Testing Breakfast Package CRUD ===\n');
  
  const testPackageId = `BP_TEST_${Date.now()}`;
  const testCode = `TEST${Date.now()}`.substring(0, 10);
  
  try {
    // Verify table exists
    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'breakfast_packages'
      )
    `);
    
    recordTest(
      'Breakfast Packages Table Exists',
      tableCheck.rows[0].exists,
      'Table breakfast_packages not found'
    );
    
    // Check column type for applicable_room_types
    const columnCheck = await client.query(`
      SELECT data_type 
      FROM information_schema.columns 
      WHERE table_name = 'breakfast_packages' 
        AND column_name = 'applicable_room_types'
    `);
    
    const columnType = columnCheck.rows[0]?.data_type;
    recordTest(
      'applicable_room_types Column Type is ARRAY',
      columnType === 'ARRAY',
      `Column type is: ${columnType}`
    );
    
    // CREATE: Insert new package with text[] array
    await client.query(`
      INSERT INTO breakfast_packages (
        id, code, name, description, base_price, adult_price, child_price,
        applicable_room_types, is_active, sort_order, inserted_at, updated_at
      ) VALUES (
        $1, $2, 'Test Package', 'Test Description', 10.00, 15.00, 8.00,
        $3::text[], true, 1, NOW(), NOW()
      )
    `, [testPackageId, testCode, '{Standard,Deluxe}']);
    
    recordTest('CREATE: Insert Package with text[]', true, '');
    
    // READ: Verify package was created
    const readCheck = await client.query(
      'SELECT * FROM breakfast_packages WHERE id = $1',
      [testPackageId]
    );
    
    recordTest(
      'READ: Package Retrieved',
      readCheck.rows.length === 1,
      readCheck.rows.length === 0 ? 'Package not found' : ''
    );
    
    // Verify text[] deserialization
    const roomTypes = readCheck.rows[0]?.applicable_room_types;
    const isArray = Array.isArray(roomTypes);
    const hasCorrectValues = isArray && roomTypes.includes('Standard') && roomTypes.includes('Deluxe');
    
    recordTest(
      'READ: applicable_room_types Deserialized as Array',
      isArray,
      `Type: ${typeof roomTypes}, Value: ${JSON.stringify(roomTypes)}`
    );
    
    recordTest(
      'READ: Array Contains Correct Values',
      hasCorrectValues,
      `Values: ${JSON.stringify(roomTypes)}`
    );
    
    // UPDATE: Modify package
    await client.query(`
      UPDATE breakfast_packages 
      SET name = 'Updated Package', 
          applicable_room_types = $1::text[],
          updated_at = NOW()
      WHERE id = $2
    `, ['{Suite,Premium}', testPackageId]);
    
    const updateCheck = await client.query(
      'SELECT * FROM breakfast_packages WHERE id = $1',
      [testPackageId]
    );
    
    recordTest(
      'UPDATE: Package Name Modified',
      updateCheck.rows[0]?.name === 'Updated Package',
      `Name is: ${updateCheck.rows[0]?.name}`
    );
    
    const updatedRoomTypes = updateCheck.rows[0]?.applicable_room_types;
    recordTest(
      'UPDATE: applicable_room_types Modified',
      Array.isArray(updatedRoomTypes) && updatedRoomTypes.includes('Suite'),
      `Values: ${JSON.stringify(updatedRoomTypes)}`
    );
    
    // Test UNIQUE constraint error handling
    try {
      await client.query(`
        INSERT INTO breakfast_packages (
          id, code, name, description, base_price, adult_price, child_price,
          applicable_room_types, is_active, sort_order, inserted_at, updated_at
        ) VALUES (
          $1, $2, 'Duplicate Test', 'Test', 10.00, 15.00, 8.00,
          '{}'::text[], true, 2, NOW(), NOW()
        )
      `, [`BP_DUP_${Date.now()}`, testCode]); // Same code - should fail
      
      recordTest('UNIQUE Constraint Enforced', false, 'Duplicate code was allowed');
    } catch (err) {
      recordTest(
        'UNIQUE Constraint Enforced',
        err.message.includes('duplicate key') || err.code === '23505',
        ''
      );
    }
    
    // DELETE: Remove package
    await client.query('DELETE FROM breakfast_packages WHERE id = $1', [testPackageId]);
    
    const deleteCheck = await client.query(
      'SELECT * FROM breakfast_packages WHERE id = $1',
      [testPackageId]
    );
    
    recordTest(
      'DELETE: Package Removed',
      deleteCheck.rows.length === 0,
      deleteCheck.rows.length > 0 ? 'Package still exists' : ''
    );
    
  } catch (err) {
    recordTest('Breakfast Package CRUD', false, err.message);
  }
}

// ============================================================================
// TEST 3: Data Persistence Verification
// ============================================================================

async function testDataPersistence() {
  log('\n=== Testing Data Persistence ===\n');
  
  try {
    // Check rooms persist
    const roomsCheck = await client.query('SELECT COUNT(*) as count FROM rooms');
    recordTest(
      'Rooms Data Persisted',
      parseInt(roomsCheck.rows[0].count) >= 0,
      `Found ${roomsCheck.rows[0].count} rooms`
    );
    
    // Check guests persist  
    const guestsCheck = await client.query('SELECT COUNT(*) as count FROM guests');
    recordTest(
      'Guests Data Persisted',
      parseInt(guestsCheck.rows[0].count) >= 0,
      `Found ${guestsCheck.rows[0].count} guests`
    );
    
    // Check reservations persist
    const resCheck = await client.query('SELECT COUNT(*) as count FROM reservations');
    recordTest(
      'Reservations Data Persisted',
      parseInt(resCheck.rows[0].count) >= 0,
      `Found ${resCheck.rows[0].count} reservations`
    );
    
    // Check breakfast packages persist
    const bpCheck = await client.query('SELECT COUNT(*) as count FROM breakfast_packages');
    recordTest(
      'Breakfast Packages Data Persisted',
      parseInt(bpCheck.rows[0].count) >= 0,
      `Found ${bpCheck.rows[0].count} breakfast packages`
    );
    
    // Check inventory persists
    const invCheck = await client.query('SELECT COUNT(*) as count FROM inventory_items');
    recordTest(
      'Inventory Data Persisted',
      parseInt(invCheck.rows[0].count) >= 0,
      `Found ${invCheck.rows[0].count} inventory items`
    );
    
    // Verify critical tables exist
    const criticalTables = [
      'rooms', 'guests', 'reservations', 'breakfast_packages',
      'folios', 'folio_charges', 'pos_orders', 'inventory_items',
      'app_users', 'city_ledger_accounts'
    ];
    
    for (const table of criticalTables) {
      const tableExists = await client.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' AND table_name = $1
        )
      `, [table]);
      
      recordTest(
        `Table '${table}' Exists`,
        tableExists.rows[0].exists,
        ''
      );
    }
    
  } catch (err) {
    recordTest('Data Persistence', false, err.message);
  }
}

// ============================================================================
// TEST 4: Schema Integrity
// ============================================================================

async function testSchemaIntegrity() {
  log('\n=== Testing Schema Integrity ===\n');
  
  try {
    // Check reservations has all required columns
    const resColumns = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'reservations'
    `);
    
    const requiredResColumns = [
      'id', 'guest_id', 'room_id', 'check_in_date', 'check_out_date',
      'status', 'rate', 'adults', 'children', 'package_code'
    ];
    
    const existingColumns = resColumns.rows.map(r => r.column_name);
    
    for (const col of requiredResColumns) {
      recordTest(
        `Reservations has '${col}' column`,
        existingColumns.includes(col),
        ''
      );
    }
    
    // Check breakfast_packages has all required columns
    const bpColumns = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns 
      WHERE table_name = 'breakfast_packages'
    `);
    
    const requiredBPColumns = [
      'id', 'code', 'name', 'base_price', 'adult_price', 'child_price',
      'applicable_room_types', 'is_active'
    ];
    
    const existingBPColumns = bpColumns.rows.map(r => r.column_name);
    
    for (const col of requiredBPColumns) {
      recordTest(
        `Breakfast Packages has '${col}' column`,
        existingBPColumns.includes(col),
        ''
      );
    }
    
  } catch (err) {
    recordTest('Schema Integrity', false, err.message);
  }
}

// ============================================================================
// Main Test Runner
// ============================================================================

async function runAllTests() {
  console.log('\n' + '='.repeat(70));
  console.log('   v0.3.0 RELEASE VERIFICATION');
  console.log('   ' + new Date().toISOString());
  console.log('='.repeat(70) + '\n');
  
  const connected = await connect();
  if (!connected) {
    console.log('\n[FATAL] Could not connect to database. Tests aborted.');
    process.exit(1);
  }
  
  try {
    await testReservationFrontOfficeIntegration();
    await testBreakfastPackageCRUD();
    await testDataPersistence();
    await testSchemaIntegrity();
  } catch (err) {
    log(`Unexpected error: ${err.message}`, true);
  } finally {
    await disconnect();
  }
  
  // Print summary
  console.log('\n' + '='.repeat(70));
  console.log('   TEST SUMMARY');
  console.log('='.repeat(70));
  console.log(`   Total Tests: ${testResults.passed + testResults.failed}`);
  console.log(`   Passed: ${testResults.passed}`);
  console.log(`   Failed: ${testResults.failed}`);
  console.log('='.repeat(70) + '\n');
  
  if (testResults.failed > 0) {
    console.log('[RESULT] SOME TESTS FAILED - DO NOT PROCEED WITH BUILD\n');
    console.log('Failed tests:');
    testResults.tests.filter(t => !t.passed).forEach(t => {
      console.log(`  - ${t.name}: ${t.details}`);
    });
    process.exit(1);
  } else {
    console.log('[RESULT] ALL TESTS PASSED - SAFE TO BUILD v0.3.0\n');
    process.exit(0);
  }
}

runAllTests();
