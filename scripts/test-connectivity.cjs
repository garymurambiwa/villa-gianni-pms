#!/usr/bin/env node

/**
 * Simple test for server connectivity
 */

const http = require('http');

function testEndpoint(path, description) {
  return new Promise((resolve) => {
    console.log(`\n🧪 Testing: ${description}`);
    console.log(`   URL: http://localhost:3000${path}`);

    const options = {
      hostname: 'localhost',
      port: 3000,
      path: path,
      method: 'GET',
      timeout: 3000
    };

    const req = http.request(options, (res) => {
      console.log(`   ✅ Status: ${res.statusCode}`);

      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode === 200 && path.includes('/api/')) {
          try {
            const jsonData = JSON.parse(data);
            if (jsonData.ok) {
              console.log(`   ✅ API Response: ${jsonData.data ? jsonData.data.length + ' items' : 'OK'}`);
            } else {
              console.log(`   ❌ API Error: ${jsonData.error}`);
            }
          } catch (e) {
            console.log(`   ⚠️  Non-JSON response`);
          }
        }
        resolve(true);
      });
    });

    req.on('timeout', () => {
      console.log(`   ❌ Request timed out`);
      req.destroy();
      resolve(false);
    });

    req.on('error', (e) => {
      console.log(`   ❌ Connection failed: ${e.message}`);
      resolve(false);
    });

    req.end();
  });
}

async function runTests() {
  console.log('🚀 Server Connectivity Test');
  console.log('=' .repeat(50));

  // Test basic server connectivity
  await testEndpoint('/', 'Basic server connectivity');

  // Test API root
  await testEndpoint('/api/v1/inventory', 'API root endpoint');

  // Test items endpoint
  await testEndpoint('/api/v1/inventory/items', 'Inventory items endpoint');

  console.log('\n' + '=' .repeat(50));
  console.log('Test complete');
}

runTests();