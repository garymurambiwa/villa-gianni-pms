#!/usr/bin/env node

// Test if the routes file can be loaded
try {
  const routes = require('../server/routes/inventory-v11.cjs');
  console.log('Routes file loaded successfully');
  console.log('Routes type:', typeof routes);
  console.log('Routes keys:', Object.keys(routes));
} catch (error) {
  console.error('Error loading routes file:', error.message);
  console.error('Stack:', error.stack);
}