#!/usr/bin/env node

const http = require('http');

console.log('Testing basic server connectivity...');

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/',
  method: 'GET',
  timeout: 2000
};

const req = http.request(options, (res) => {
  console.log(`✅ Server responding: ${res.statusCode}`);
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  res.on('end', () => {
    console.log('Response received');
  });
});

req.on('timeout', () => {
  console.log('❌ Server not responding - timeout');
  req.destroy();
});

req.on('error', (e) => {
  console.error(`❌ Server not responding: ${e.message}`);
});

req.end();