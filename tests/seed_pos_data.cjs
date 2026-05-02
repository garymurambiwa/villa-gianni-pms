const { Client } = require('pg');
require('dotenv').config();

async function seed() {
    const client = new Client({
        connectionString: process.env.VITE_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/villa_gianni'
    });

    try {
        await client.connect();
        console.log('Connected to DB');

        // 1. Create Menu Items if they don't exist
        const menuItems = [
            { id: 'item_pizza', name: 'Margherita Pizza', category: 'Food', price: 15.00 },
            { id: 'item_beer', name: 'Local Beer', category: 'Beverage', price: 5.00 },
            { id: 'item_steak', name: 'Beef Steak', category: 'Food', price: 25.00 },
            { id: 'item_wine', name: 'House Wine', category: 'Beverage', price: 8.00 }
        ];

        for (const item of menuItems) {
            await client.query(
                `INSERT INTO menu_items (id, name, category, price, active) 
                 VALUES ($1, $2, $3, $4, true) 
                 ON CONFLICT (id) DO UPDATE SET price = EXCLUDED.price`,
                [item.id, item.name, item.category, item.price]
            );
        }
        console.log('Menu items seeded');

        // 2. Ensure Receipt Settings has a tax rate
        await client.query(`
            CREATE TABLE IF NOT EXISTS app_settings (
                key VARCHAR(255) PRIMARY KEY,
                value TEXT,
                updated_at TIMESTAMP DEFAULT NOW()
            )
        `);
        
        const receiptSettings = JSON.stringify({
            outlet_name: 'Villa Gianni POS',
            tax_rate: 15,
            address: '123 Villa St',
            phone: '+123456789'
        });

        await client.query(
            `INSERT INTO app_settings (key, value) VALUES ($1, $2) 
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
            ['receipt_settings', receiptSettings]
        );
        console.log('Receipt settings seeded (15% tax)');

        // 3. Clear old test data if needed
        // await client.query('DELETE FROM pos_bills WHERE opened_by = $1', ['System Audit']);

        console.log('Seeding complete');
    } catch (err) {
        console.error('Seed failed:', err);
    } finally {
        await client.end();
    }
}

seed();
