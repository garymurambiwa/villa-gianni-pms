#!/usr/bin/env node

const http = require('http');

console.log('Testing basic test API route...');

const options = {
  hostname: 'localhost',
  port: 3001,
  headers: {
    'User-Agent': 'Test-Script'
  }
  path: '/api/test',
  method: 'GET',
  timeout: 3000
};

const req = http.request(options, (res) => {
  console.log(`✅ Status: ${res.statusCode}`);

  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    console.log('Response:', data);
  });
});

req.on('timeout', () => {
  console.log('❌ Request timed out');
  req.destroy();
});

req.on('error', (e) => {
  console.error(`❌ Connection failed: ${e.message}`);
});

req.end();