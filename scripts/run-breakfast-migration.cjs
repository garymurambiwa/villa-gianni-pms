const { Client } = require('pg');

async function runMigration() {
  const client = new Client({
    host: 'localhost',
    port: 54320,
    database: 'corepms_db',
    user: 'postgres',
    password: 'postgres'
  });

  try {
    await client.connect();
    console.log('Connected to database');

    // Read the breakfast package migration file
    const fs = require('fs');
    const path = require('path');
    const migrationPath = path.join(__dirname, '..', 'db', 'migration', 'V7__add_breakfast_packages.sql');
    const migrationSql = fs.readFileSync(migrationPath, 'utf8');

    console.log('Running breakfast package migration...');
    
    // Split the migration into individual statements
    const statements = migrationSql
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));

    for (const statement of statements) {
      try {
        console.log('Executing:', statement.substring(0, 50) + '...');
        await client.query(statement);
        console.log('✓ Success');
      } catch (error) {
        if (error.message.includes('already exists') || error.message.includes('duplicate')) {
          console.log('⚠ Already exists, continuing...');
        } else {
          console.error('✗ Error:', error.message);
          throw error;
        }
      }
    }

    console.log('\nMigration completed successfully!');
    
    // Verify the tables were created
    const tablesResult = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('breakfast_packages', 'breakfast_package_seasonal_rates')
      ORDER BY table_name
    `);
    
    console.log('\nCreated tables:');
    tablesResult.rows.forEach(row => {
      console.log('- ' + row.table_name);
    });

  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    await client.end();
  }
}

runMigration();