// Simple test for breakfast package array handling
const { Client } = require('pg');

async function testArrayHandling() {
  const client = new Client({
    host: 'localhost',
    port: 54320,
    database: 'postgres',
    user: 'postgres',
    password: 'postgres'
  });

  try {
    await client.connect();
    console.log('✅ Connected to database');
    
    // Test creating a table with jsonb column
    await client.query(`
      CREATE TABLE IF NOT EXISTS test_breakfast_packages (
        id SERIAL PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        applicable_room_types JSONB DEFAULT '[]'::JSONB
      )
    `);
    console.log('✅ Test table created');
    
    // Test inserting with array converted to JSON
    const roomTypes = ['DELUXE', 'STANDARD', 'SUITE'];
    const result = await client.query(
      `INSERT INTO test_breakfast_packages (code, name, applicable_room_types) 
       VALUES ($1, $2, $3) 
       RETURNING *`,
      ['TEST001', 'Test Package', JSON.stringify(roomTypes)]
    );
    
    console.log('✅ Insert successful:', result.rows[0]);
    
    // Test updating with new array
    const newRoomTypes = ['SUITE', 'EXECUTIVE'];
    const updateResult = await client.query(
      `UPDATE test_breakfast_packages 
       SET applicable_room_types = $1, name = $2 
       WHERE code = $3 
       RETURNING *`,
      [JSON.stringify(newRoomTypes), 'Updated Test Package', 'TEST001']
    );
    
    console.log('✅ Update successful:', updateResult.rows[0]);
    
    // Verify the data
    const verifyResult = await client.query(
      'SELECT * FROM test_breakfast_packages WHERE code = $1',
      ['TEST001']
    );
    
    const retrievedData = verifyResult.rows[0];
    console.log('✅ Retrieved data:', retrievedData);
    
    // Parse the JSON back to array
    const parsedRoomTypes = JSON.parse(retrievedData.applicable_room_types);
    console.log('✅ Parsed room types:', parsedRoomTypes);
    
    // Verify it matches expected
    const expected = ['SUITE', 'EXECUTIVE'];
    const matches = JSON.stringify(parsedRoomTypes.sort()) === JSON.stringify(expected.sort());
    
    if (matches) {
      console.log('🎉 ARRAY HANDLING TEST PASSED!');
      console.log('✅ JSON array serialization/deserialization is working correctly');
    } else {
      console.log('❌ ARRAY HANDLING TEST FAILED');
      console.log('Expected:', expected);
      console.log('Got:', parsedRoomTypes);
    }
    
    // Cleanup
    await client.query('DROP TABLE IF EXISTS test_breakfast_packages');
    console.log('🧹 Test table cleaned up');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    await client.end();
  }
}

testArrayHandling();