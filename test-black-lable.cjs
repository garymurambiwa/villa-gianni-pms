const http = require('http');

const testData = {
  supplier_name: 'Delta Beverages',
  destination_location_id: 'loc_main_cellar',
  created_by: 'test-user',
  lines: [
    {
      item_id: 'Black Lable',  // This item doesn't exist - should be auto-created
      qty_received: 20,
      received_uom_id: 'uom_crate',
      unit_cost: 12
    }
  ]
};

const postData = JSON.stringify(testData);

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
    console.log('GRN TEST - Auto-Item Creation');
    console.log('='.repeat(70));
    console.log('Status:', res.statusCode);
    
    try {
      const response = JSON.parse(data);
      if (response.ok) {
        console.log('✅ SUCCESS!');
        console.log('  GRN Number:', response.data.grn_number);
        console.log('  Total Value:', '$' + response.data.total_value);
      } else {
        console.log('❌ ERROR:', response.error);
      }
    } catch (e) {
      console.log('❌ Invalid response:', data);
    }
    console.log('='.repeat(70) + '\n');
  });
});

req.on('error', (e) => console.error('Request Error:', e.message));
req.write(postData);
req.end();
