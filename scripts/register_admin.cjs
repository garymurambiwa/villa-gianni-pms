
const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
    connectionString: process.env.DATABASE_URL,
});

const DEFAULT_USER = {
    username: 'admin',
    password: 'test123',
    role: 'admin',
    name: 'System Administrator'
};

async function registerUser() {
    try {
        await client.connect();
        console.log('Connected to database');

        // Check if user already exists
        const checkRes = await client.query('SELECT id FROM app_users WHERE username = $1', [DEFAULT_USER.username]);
        if (checkRes.rows.length > 0) {
            console.log(`User '${DEFAULT_USER.username}' already exists.`);
            console.log('You can log in with:');
            console.log(`Username: ${DEFAULT_USER.username}`);
            console.log(`Password: ${DEFAULT_USER.password}`);
            return;
        }

        // Insert new user using pgcrypto for password hashing
        const insertQuery = `
      INSERT INTO app_users (id, username, password_hash, role, name, active)
      VALUES (gen_random_uuid(), $1, crypt($2, gen_salt('bf')), $3, $4, true)
      RETURNING id, username, role;
    `;

        const res = await client.query(insertQuery, [
            DEFAULT_USER.username,
            DEFAULT_USER.password,
            DEFAULT_USER.role,
            DEFAULT_USER.name
        ]);

        console.log('User registered successfully!');
        console.log('Details:', res.rows[0]);
        console.log('-----------------------------------');
        console.log('LOGIN CREDENTIALS:');
        console.log(`Username: ${DEFAULT_USER.username}`);
        console.log(`Password: ${DEFAULT_USER.password}`);
        console.log('-----------------------------------');

    } catch (err) {
        console.error('Error registering user:', err);
    } finally {
        await client.end();
    }
}

registerUser();
