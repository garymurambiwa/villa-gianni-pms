const http = require('http');

// Real data from the database
const testData = {
  supplier_name: 'Local Vegetable Market',
  destination_location_id: 'loc_dry_goods',  // Real location ID
  created_by: 'test-user',
  lines: [
    {
      item_id: 'item_onions',
      qty_received: 50,
      received_uom_id: 'uom_case',
      unit_cost: 0.1
    },
    {
      item_id: 'item_tomatoes',
      qty_received: 50,
      received_uom_id: 'uom_case',
      unit_cost: 0.2
    },
    {
      item_id: 'item_beans',
      qty_received: 30,
      received_uom_id: 'uom_case',
      unit_cost: 0.5
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

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    console.log('\n' + '='.repeat(60));
    console.log('GRN CREATION TEST RESULTS');
    console.log('='.repeat(60));
    console.log('Status:', res.statusCode);
    
    try {
      const response = JSON.parse(data);
      if (response.ok) {
        console.log('\n✅ SUCCESS! GRN created successfully');
        console.log('GRN Number:', response.data.grn_number);
        console.log('ID:', response.data.id);
        console.log('Supplier:', response.data.supplier_name);
        console.log('Location:', response.data.destination_location_id);
        console.log('Created By:', response.data.created_by);
        console.log('Status:', response.data.status);
      } else {
        console.log('\n❌ FAILED - API returned error');
        console.log('Error:', response.error);
      }
    } catch (e) {
      console.log('\n❌ FAILED - Invalid response');
      console.log('Response:', data);
    }
    console.log('='.repeat(60) + '\n');
  });
});

req.on('error', (error) => {
  console.error('\n❌ REQUEST ERROR:', error.message);
});

console.log('\n📋 GRN Creation Test');
console.log('=' .repeat(60));
console.log('Test Data:');
console.log(JSON.stringify(testData, null, 2));
console.log('\nSending request to http://localhost:3000/api/v1/inventory/grn');
console.log('=' .repeat(60));

req.write(postData);
req.end();
