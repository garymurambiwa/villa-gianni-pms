const mysql = require('mysql2/promise');

async function verifyPersistence() {
  const config = {
    host: '192.168.100.18',
    user: 'root',
    password: 'ChangeMe', // Assuming default/env password
    database: 'corepms_db',
    port: 3306
  };

  console.log(`Connecting to ${config.host}...`);
  let conn;
  try {
    conn = await mysql.createConnection(config);
    console.log('✅ Connected to database.');

    // Create a test table if not exists
    await conn.query(`
      CREATE TABLE IF NOT EXISTS _persistence_check (
        id INT AUTO_INCREMENT PRIMARY KEY,
        check_val VARCHAR(255),
        created_at DATETIME DEFAULT NOW()
      )
    `);

    // Insert data
    const testVal = `test_${Date.now()}`;
    console.log(`Attempting to save data: ${testVal}`);
    const [res] = await conn.query('INSERT INTO _persistence_check (check_val) VALUES (?)', [testVal]);
    
    if (res.affectedRows === 1) {
      console.log('✅ Data saved successfully.');
    } else {
      console.error('❌ Data save reported 0 affected rows.');
    }

    // Read back data
    console.log('Verifying data persistence (reading back)...');
    const [rows] = await conn.query('SELECT * FROM _persistence_check WHERE check_val = ?', [testVal]);
    
    if (rows.length > 0 && rows[0].check_val === testVal) {
      console.log(`✅ Verified! Found record ID: ${rows[0].id}, Value: ${rows[0].check_val}`);
    } else {
      console.error('❌ Could not find saved data.');
      process.exit(1);
    }

    // Clean up
    await conn.query('DELETE FROM _persistence_check WHERE check_val = ?', [testVal]);
    console.log('✅ Test data cleaned up.');

  } catch (err) {
    console.error('❌ Persistence verification failed:', err.message);
    process.exit(1);
  } finally {
    if (conn) await conn.end();
  }
}

verifyPersistence();
