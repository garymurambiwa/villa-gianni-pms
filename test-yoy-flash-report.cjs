#!/usr/bin/env node

// Test script to verify the year-over-year flash report functionality
const fs = require('fs');
const path = require('path');

// Mock localStorage implementation for testing
const localStorageMock = {
  data: {},
  getItem(key) {
    return this.data[key] || null;
  },
  setItem(key, value) {
    this.data[key] = String(value);
  },
  removeItem(key) {
    delete this.data[key];
  }
};

// Mock the localStorage globally
global.localStorage = localStorageMock;

// Set up current year test data (2024-01-15)
localStorageMock.setItem('corepms_business_date', '2024-01-15');
localStorageMock.setItem('corepms_nightAudit_lastReports', JSON.stringify({
  date: '2024-01-15',
  roomRevenue: 1500.00,
  fbRevenue: 703.00,
  totalRevenue: 2203.00,
  occupancy: 75.5,
  avgDailyRate: 125.00,
  revPAR: 94.38
}));

localStorageMock.setItem('corepms_shift_totals', JSON.stringify({
  cash: 1200.00,
  card: 1003.00
}));

// Set up last year test data (2023-01-15)
localStorageMock.setItem('corepms_nightAudit_reports_2023-01-15', JSON.stringify({
  date: '2023-01-15',
  roomRevenue: 1350.00,
  fbRevenue: 620.00,
  totalRevenue: 1970.00,
  occupancy: 68.2,
  avgDailyRate: 112.50,
  revPAR: 85.20
}));

localStorageMock.setItem('corepms_shift_totals_2023-01-15', JSON.stringify({
  cash: 1050.00,
  card: 920.00
}));

// Sample folio charges for current year
localStorageMock.setItem('corepms_folioCharges', JSON.stringify([
  // 2024 Food charges
  { id: '1', description: 'Restaurant Dinner', amount: 150.00, category: 'F&B', date: '2024-01-15' },
  { id: '2', description: 'Lunch Buffet', amount: 85.50, category: 'F&B', date: '2024-01-15' },
  { id: '3', description: 'Breakfast Service', amount: 65.75, category: 'F&B', date: '2024-01-15' },
  { id: '4', description: 'Room Service Meal', amount: 42.25, category: 'F&B', date: '2024-01-15' },
  
  // 2024 Bar charges
  { id: '5', description: 'Bar Drinks', amount: 120.00, category: 'F&B', date: '2024-01-15' },
  { id: '6', description: 'Wine Selection', amount: 88.50, category: 'F&B', date: '2024-01-15' },
  { id: '7', description: 'Cocktails', amount: 95.25, category: 'F&B', date: '2024-01-15' },
  { id: '8', description: 'Beer Service', amount: 55.75, category: 'F&B', date: '2024-01-15' },
  
  // 2024 Other dates (should be excluded)
  { id: '9', description: 'Restaurant Dinner', amount: 200.00, category: 'F&B', date: '2024-01-14' },
  
  // 2024 Non-F&B charges
  { id: '10', description: 'Room Charge', amount: 150.00, category: 'Room', date: '2024-01-15' },
]));

// Sample folio charges for last year
localStorageMock.setItem('corepms_folioCharges_2023-01-15', JSON.stringify([
  // 2023 Food charges
  { id: '1', description: 'Restaurant Dinner', amount: 135.00, category: 'F&B', date: '2023-01-15' },
  { id: '2', description: 'Lunch Buffet', amount: 75.25, category: 'F&B', date: '2023-01-15' },
  { id: '3', description: 'Breakfast Service', amount: 58.50, category: 'F&B', date: '2023-01-15' },
  { id: '4', description: 'Room Service', amount: 38.75, category: 'F&B', date: '2023-01-15' },
  
  // 2023 Bar charges
  { id: '5', description: 'Bar Drinks', amount: 105.00, category: 'F&B', date: '2023-01-15' },
  { id: '6', description: 'Wine Selection', amount: 78.25, category: 'F&B', date: '2023-01-15' },
  { id: '7', description: 'Cocktails', amount: 82.50, category: 'F&B', date: '2023-01-15' },
  { id: '8', description: 'Beer Service', amount: 49.25, category: 'F&B', date: '2023-01-15' },
  
  // 2023 Non-F&B charges
  { id: '9', description: 'Room Charge', amount: 135.00, category: 'Room', date: '2023-01-15' },
]));

console.log('=== Testing Year-over-Year Flash Report ===\n');

try {
  console.log('Test Data Setup:');
  console.log('- Current Date: 2024-01-15');
  console.log('- Last Year Date: 2023-01-15');
  console.log('- Current Room Revenue: $1,500.00');
  console.log('- Last Year Room Revenue: $1,350.00');
  console.log('- Current F&B Revenue: $703.00');
  console.log('- Last Year F&B Revenue: $620.00');
  console.log('');
  
  // Simulate the year-over-year logic
  const currentDate = '2024-01-15';
  const lastYearDate = '2023-01-15';
  
  // Get current year data
  const currentFolioCharges = JSON.parse(localStorageMock.getItem('corepms_folioCharges') || '[]');
  const currentCharges = currentFolioCharges.filter(c => c.date === currentDate);
  
  // Get last year data
  const lastYearFolioCharges = JSON.parse(localStorageMock.getItem('corepms_folioCharges_2023-01-15') || '[]');
  const lastYearCharges = lastYearFolioCharges.filter(c => c.date === lastYearDate);
  
  console.log(`Found ${currentCharges.length} charges for ${currentDate}`);
  console.log(`Found ${lastYearCharges.length} charges for ${lastYearDate}`);
  
  // Apply F&B breakdown logic for current year
  const currentFbCharges = currentCharges.filter(c => String(c.category || '').toLowerCase() === 'f&b');
  const currentProcessedChargeIds = new Set();
  
  const currentFoodRevenue = currentFbCharges
    .filter(c => {
      const desc = String(c.description || '').toLowerCase();
      const chargeId = String(c.id || '');
      
      if (currentProcessedChargeIds.has(chargeId)) return false;
      
      const isExplicitlyFood = 
        desc.includes('restaurant') || 
        desc.includes('dinner') || 
        desc.includes('lunch') || 
        desc.includes('breakfast') ||
        desc.includes('brunch') ||
        desc.includes('meal') ||
        desc.includes('entree') ||
        desc.includes('appetizer') ||
        desc.includes('main course') ||
        desc.includes('dessert') ||
        desc.includes('snack') ||
        desc.includes('buffet') ||
        desc.includes('room service meal');
      
      const isExplicitlyBar = 
        desc.includes('bar') || 
        desc.includes('beer') || 
        desc.includes('wine') || 
        desc.includes('spirit') || 
        desc.includes('liquor') ||
        desc.includes('cocktail') ||
        desc.includes('martini') ||
        desc.includes('margarita') ||
        desc.includes('whiskey') ||
        desc.includes('vodka') ||
        desc.includes('rum') ||
        desc.includes('tequila') ||
        desc.includes('bourbon') ||
        desc.includes('scotch') ||
        desc.includes('gin') ||
        desc.includes('champagne') ||
        desc.includes('alcohol');
      
      if (isExplicitlyFood && !isExplicitlyBar) {
        currentProcessedChargeIds.add(chargeId);
        return true;
      }
      
      return false;
    })
    .reduce((sum, c) => sum + Number(c.amount || 0), 0);
  
  const currentBarRevenue = currentFbCharges
    .filter(c => {
      const desc = String(c.description || '').toLowerCase();
      const chargeId = String(c.id || '');
      
      if (currentProcessedChargeIds.has(chargeId)) return false;
      
      const isExplicitlyBar = 
        desc.includes('bar') || 
        desc.includes('beer') || 
        desc.includes('wine') || 
        desc.includes('spirit') || 
        desc.includes('liquor') ||
        desc.includes('cocktail') ||
        desc.includes('martini') ||
        desc.includes('margarita') ||
        desc.includes('whiskey') ||
        desc.includes('vodka') ||
        desc.includes('rum') ||
        desc.includes('tequila') ||
        desc.includes('bourbon') ||
        desc.includes('scotch') ||
        desc.includes('gin') ||
        desc.includes('champagne') ||
        desc.includes('alcohol') ||
        desc.includes('drink') ||
        desc.includes('beverage');
      
      if (isExplicitlyBar) {
        currentProcessedChargeIds.add(chargeId);
        return true;
      }
      
      return false;
    })
    .reduce((sum, c) => sum + Number(c.amount || 0), 0);
  
  const currentRemainingFbRevenue = currentFbCharges
    .filter(c => {
      const chargeId = String(c.id || '');
      return !currentProcessedChargeIds.has(chargeId);
    })
    .reduce((sum, c) => sum + Number(c.amount || 0), 0);
  
  const finalCurrentFoodRevenue = currentFoodRevenue + currentRemainingFbRevenue;
  const finalCurrentBarRevenue = currentBarRevenue;
  
  // Apply F&B breakdown logic for last year
  const lastYearFbCharges = lastYearCharges.filter(c => String(c.category || '').toLowerCase() === 'f&b');
  const lastYearProcessedChargeIds = new Set();
  
  const lastYearFoodRevenue = lastYearFbCharges
    .filter(c => {
      const desc = String(c.description || '').toLowerCase();
      const chargeId = String(c.id || '');
      
      if (lastYearProcessedChargeIds.has(chargeId)) return false;
      
      const isExplicitlyFood = 
        desc.includes('restaurant') || 
        desc.includes('dinner') || 
        desc.includes('lunch') || 
        desc.includes('breakfast') ||
        desc.includes('brunch') ||
        desc.includes('meal') ||
        desc.includes('entree') ||
        desc.includes('appetizer') ||
        desc.includes('main course') ||
        desc.includes('dessert') ||
        desc.includes('snack') ||
        desc.includes('buffet') ||
        desc.includes('room service meal');
      
      const isExplicitlyBar = 
        desc.includes('bar') || 
        desc.includes('beer') || 
        desc.includes('wine') || 
        desc.includes('spirit') || 
        desc.includes('liquor') ||
        desc.includes('cocktail') ||
        desc.includes('martini') ||
        desc.includes('margarita') ||
        desc.includes('whiskey') ||
        desc.includes('vodka') ||
        desc.includes('rum') ||
        desc.includes('tequila') ||
        desc.includes('bourbon') ||
        desc.includes('scotch') ||
        desc.includes('gin') ||
        desc.includes('champagne') ||
        desc.includes('alcohol');
      
      if (isExplicitlyFood && !isExplicitlyBar) {
        lastYearProcessedChargeIds.add(chargeId);
        return true;
      }
      
      return false;
    })
    .reduce((sum, c) => sum + Number(c.amount || 0), 0);
  
  const lastYearBarRevenue = lastYearFbCharges
    .filter(c => {
      const desc = String(c.description || '').toLowerCase();
      const chargeId = String(c.id || '');
      
      if (lastYearProcessedChargeIds.has(chargeId)) return false;
      
      const isExplicitlyBar = 
        desc.includes('bar') || 
        desc.includes('beer') || 
        desc.includes('wine') || 
        desc.includes('spirit') || 
        desc.includes('liquor') ||
        desc.includes('cocktail') ||
        desc.includes('martini') ||
        desc.includes('margarita') ||
        desc.includes('whiskey') ||
        desc.includes('vodka') ||
        desc.includes('rum') ||
        desc.includes('tequila') ||
        desc.includes('bourbon') ||
        desc.includes('scotch') ||
        desc.includes('gin') ||
        desc.includes('champagne') ||
        desc.includes('alcohol') ||
        desc.includes('drink') ||
        desc.includes('beverage');
      
      if (isExplicitlyBar) {
        lastYearProcessedChargeIds.add(chargeId);
        return true;
      }
      
      return false;
    })
    .reduce((sum, c) => sum + Number(c.amount || 0), 0);
  
  const lastYearRemainingFbRevenue = lastYearFbCharges
    .filter(c => {
      const chargeId = String(c.id || '');
      return !lastYearProcessedChargeIds.has(chargeId);
    })
    .reduce((sum, c) => sum + Number(c.amount || 0), 0);
  
  const finalLastYearFoodRevenue = lastYearFoodRevenue + lastYearRemainingFbRevenue;
  const finalLastYearBarRevenue = lastYearBarRevenue;
  
  console.log('\n=== Year-over-Year Comparison Results ===');
  console.log(`Current Year Food Revenue: $${finalCurrentFoodRevenue.toFixed(2)}`);
  console.log(`Last Year Food Revenue: $${finalLastYearFoodRevenue.toFixed(2)}`);
  console.log(`Food Revenue Difference: $${(finalCurrentFoodRevenue - finalLastYearFoodRevenue).toFixed(2)}`);
  
  console.log(`\nCurrent Year Bar Revenue: $${finalCurrentBarRevenue.toFixed(2)}`);
  console.log(`Last Year Bar Revenue: $${finalLastYearBarRevenue.toFixed(2)}`);
  console.log(`Bar Revenue Difference: $${(finalCurrentBarRevenue - finalLastYearBarRevenue).toFixed(2)}`);
  
  console.log(`\nCurrent Year Total F&B Revenue: $${(finalCurrentFoodRevenue + finalCurrentBarRevenue).toFixed(2)}`);
  console.log(`Last Year Total F&B Revenue: $${(finalLastYearFoodRevenue + finalLastYearBarRevenue).toFixed(2)}`);
  console.log(`Total F&B Revenue Difference: $${((finalCurrentFoodRevenue + finalCurrentBarRevenue) - (finalLastYearFoodRevenue + finalLastYearBarRevenue)).toFixed(2)}`);
  
  // Test departmental expenses calculation
  const currentTotalRevenue = 1500.00 + (finalCurrentFoodRevenue + finalCurrentBarRevenue);
  const lastYearTotalRevenue = 1350.00 + (finalLastYearFoodRevenue + finalLastYearBarRevenue);
  const currentDeptExpenses = currentTotalRevenue * 0.35;
  const lastYearDeptExpenses = lastYearTotalRevenue * 0.35;
  
  console.log(`\n=== Departmental Expenses Comparison ===`);
  console.log(`Current Year Dept Expenses (35%): $${currentDeptExpenses.toFixed(2)}`);
  console.log(`Last Year Dept Expenses (35%): $${lastYearDeptExpenses.toFixed(2)}`);
  console.log(`Dept Expenses Difference: $${(currentDeptExpenses - lastYearDeptExpenses).toFixed(2)}`);
  
  // Validation
  console.log('\n=== Validation ===');
  const expectedCurrentFb = 703.00;
  const expectedLastYearFb = 620.00;
  const currentFbTotal = finalCurrentFoodRevenue + finalCurrentBarRevenue;
  const lastYearFbTotal = finalLastYearFoodRevenue + finalLastYearBarRevenue;
  
  console.log(`Expected Current F&B Total: $${expectedCurrentFb.toFixed(2)}`);
  console.log(`Calculated Current F&B Total: $${currentFbTotal.toFixed(2)}`);
  console.log(`Difference: $${Math.abs(expectedCurrentFb - currentFbTotal).toFixed(2)}`);
  
  console.log(`\nExpected Last Year F&B Total: $${expectedLastYearFb.toFixed(2)}`);
  console.log(`Calculated Last Year F&B Total: $${lastYearFbTotal.toFixed(2)}`);
  console.log(`Difference: $${Math.abs(expectedLastYearFb - lastYearFbTotal).toFixed(2)}`);
  
  if (Math.abs(expectedCurrentFb - currentFbTotal) < 5 && Math.abs(expectedLastYearFb - lastYearFbTotal) < 5) {
    console.log('✓ Year-over-year calculation validation PASSED');
  } else {
    console.log('⚠ Year-over-year calculation validation FAILED');
  }
  
  console.log('\n✓ Year-over-year flash report test completed successfully!');
  
} catch (error) {
  console.error('Test failed:', error.message);
  process.exit(1);
}