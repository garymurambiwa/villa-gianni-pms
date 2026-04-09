const http = require('http');

// Step 1: Create test items
const items = [
  { id: 'item_onions', name: 'Fresh Onions', category: 'Food', base_uom_id: 'uom_case' },
  { id: 'item_tomatoes', name: 'Fresh Tomatoes', category: 'Food', base_uom_id: 'uom_case' },
  { id: 'item_beans', name: 'Dry Beans', category: 'Food', base_uom_id: 'uom_case' }
];

async function createItems() {
  for (const item of items) {
    const insertSQL = `INSERT INTO public.inv_items (id, name, category, base_uom_id, inserted_at) 
                      SELECT $1, $2, $3, $4, NOW() 
                      WHERE NOT EXISTS (SELECT 1 FROM public.inv_items WHERE id = $1)`;
    
    const postData = JSON.stringify({
      sql: insertSQL,
      params: [item.id, item.name, item.category, item.base_uom_id]
    });

    await new Promise((resolve, reject) => {
      const options = {
        hostname: 'localhost',
        port: 3000,
        path: '/api/db/query',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          const response = JSON.parse(data);
          if (response.ok) {
            console.log(`✓ Created/verified item: ${item.id}`);
          } else {
            console.log(`✗ Item creation failed for ${item.id}: ${response.error}`);
          }
          resolve();
        });
      });

      req.on('error', reject);
      req.write(postData);
      req.end();
    });
  }
}

// Step 2: Create GRN
async function createGRN() {
  const testData = {
    supplier_name: 'Local Vegetable Market',
    destination_location_id: 'loc_dry_goods',
    created_by: 'test-user',
    lines: [
      { item_id: 'item_onions', qty_received: 50, source_uom_id: 'uom_case', unit_cost: 0.1 },
      { item_id: 'item_tomatoes', qty_received: 50, source_uom_id: 'uom_case', unit_cost: 0.2 },
      { item_id: 'item_beans', qty_received: 30, source_uom_id: 'uom_case', unit_cost: 0.5 }
    ]
  };

  const postData = JSON.stringify(testData);

  return new Promise((resolve) => {
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: '/api/v1/inventory/grn',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        console.log('\n' + '='.repeat(70));
        console.log('GRN CREATION RESULT');
        console.log('='.repeat(70));
        console.log('Status:', res.statusCode);
        
        try {
          const response = JSON.parse(data);
          if (response.ok) {
            console.log('✅ SUCCESS! GRN Created');
            console.log('  GRN Number:', response.data.grn_number);
            console.log('  ID:', response.data.id);
            console.log('  Supplier:', response.data.supplier_name);
            console.log('  Location:', response.data.destination_location_id);
            console.log('  Status:', response.data.status);
            console.log('='.repeat(70) + '\n');
          } else {
            console.log('❌ FAILED:', response.error);
            console.log('='.repeat(70) + '\n');
          }
        } catch (e) {
          console.log('❌ ERROR parsing response:', data);
          console.log('='.repeat(70) + '\n');
        }
        resolve();
      });
    });

    req.on('error', (e) => {
      console.log('❌ Request error:', e.message);
      resolve();
    });

    req.write(postData);
    req.end();
  });
}

// Run the test workflow
(async () => {
  console.log('Testing GRN Creation Workflow\n');
  console.log('Step 1: Create/verify test items...');
  await createItems();
  
  console.log('\nStep 2: Create GRN...');
  await createGRN();
})();
