// Simple test to verify GRN creation works after SQL fixes
const http = require('http');

const testData = {
  supplier_name: 'Test Supplier',
  destination_location_id: 'loc-dry-goods',
  created_by: 'test-user',
  lines: [
    {
      item_id: 'item-onions',
      qty_received: 50,
      source_uom_id: 'uom_case',
      unit_cost: 0.1
    },
    {
      item_id: 'item-tomatoes',
      qty_received: 50,
      source_uom_id: 'uom_case',
      unit_cost: 0.2
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
    console.log('Status:', res.statusCode);
    console.log('Response:', data);
    if (res.statusCode === 200) {
      const response = JSON.parse(data);
      if (response.ok) {
        console.log('\n✅ GRN CREATION SUCCESSFUL!');
        console.log('GRN Number:', response.data.grn_number);
      } else {
        console.log('\n❌ GRN Creation failed:', response.error);
      }
    } else {
      console.log('\n❌ HTTP Error:', res.statusCode);
    }
  });
});

req.on('error', (error) => {
  console.error('Request error:', error);
});

console.log('Testing GRN creation with fixed SQL...');
console.log('Request Data:', JSON.stringify(testData, null, 2));
console.log('\nSending request to http://localhost:3000/api/v1/inventory/grn\n');

req.write(postData);
req.end();
