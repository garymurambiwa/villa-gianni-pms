#!/usr/bin/env node

const http = require('http');

// Simple test to see if the server is responding at all
const testServer = () => {
  return new Promise((resolve) => {
    const req = http.get('http://localhost:3000', (res) => {
      console.log(`Server is responding: ${res.statusCode}`);
      resolve(true);
    });

    req.on('error', (err) => {
      console.log(`Server not responding: ${err.message}`);
      resolve(false);
    });

    req.setTimeout(2000, () => {
      console.log('Server request timed out');
      req.destroy();
      resolve(false);
    });
  });
};

testServer().then(() => {
  console.log('Basic server test complete');
});