#!/usr/bin/env node

/**
 * Simple API test for inventory items endpoint
 */

const http = require('http');

console.log('Testing API endpoint: http://localhost:3000/api/v1/inventory/items');

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/v1/inventory/items',
  method: 'GET',
  timeout: 5000
};

const req = http.request(options, (res) => {
  console.log(`✅ Status: ${res.statusCode}`);

  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    try {
      const jsonData = JSON.parse(data);
      console.log('✅ Response data:');
      if (jsonData.ok && jsonData.data) {
        console.log(`   Found ${jsonData.data.length} items:`);
        jsonData.data.forEach((item, idx) => {
          console.log(`   ${idx + 1}. ${item.name} (${item.category}) - ${item.base_uom_symbol}`);
        });
      } else {
        console.log('   Error:', jsonData.error);
      }
    } catch (e) {
      console.log('❌ Failed to parse JSON response');
      console.log('Raw response (first 200 chars):', data.substring(0, 200));
    }
  });
});

req.on('timeout', () => {
  console.log('❌ Request timed out');
  req.destroy();
});

req.on('error', (e) => {
  console.error(`❌ Problem with request: ${e.message}`);
});

req.end();