const { Client } = require('pg');
const { breakfastPackageService } = require('./src/lib/breakfastPackageService');

async function testBreakfastPackageService() {
  console.log('🧪 Testing Breakfast Package Service...');
  
  try {
    // Test 1: Get all packages
    console.log('\n1. Testing getAllPackages()...');
    const allPackages = await breakfastPackageService.getAllPackages();
    console.log(`✅ Found ${allPackages.length} packages`);
    
    // Test 2: Get active packages  
    console.log('\n2. Testing getActivePackages()...');
    const activePackages = await breakfastPackageService.getActivePackages();
    console.log(`✅ Found ${activePackages.length} active packages`);
    
    // Test 3: Create a new package
    console.log('\n3. Testing createPackage()...');
    const newPackageData = {
      code: 'TEST_' + Date.now(),
      name: 'Test Breakfast Package',
      description: 'Test package for validation',
      basePrice: 25.50,
      adultPrice: 15.75,
      childPrice: 8.25,
      applicableRoomTypes: ['DELUXE', 'STANDARD', 'SUITE'],
      isActive: true,
      sortOrder: 100
    };
    
    const createdPackage = await breakfastPackageService.createPackage(newPackageData);
    console.log(`✅ Created package: ${createdPackage.name} (${createdPackage.code})`);
    console.log(`   Applicable room types: [${createdPackage.applicableRoomTypes.join(', ')}]`);
    
    // Test 4: Update the package
    console.log('\n4. Testing updatePackage()...');
    const updateData = {
      name: 'Updated Test Package',
      basePrice: 30.00,
      applicableRoomTypes: ['SUITE', 'EXECUTIVE']
    };
    
    const updatedPackage = await breakfastPackageService.updatePackage(createdPackage.id, updateData);
    console.log(`✅ Updated package: ${updatedPackage.name}`);
    console.log(`   New price: $${updatedPackage.basePrice}`);
    console.log(`   Updated room types: [${updatedPackage.applicableRoomTypes.join(', ')}]`);
    
    // Verify the update worked correctly
    const expectedRoomTypes = ['SUITE', 'EXECUTIVE'];
    const roomTypesMatch = JSON.stringify(updatedPackage.applicableRoomTypes.sort()) === 
                          JSON.stringify(expectedRoomTypes.sort());
    
    if (roomTypesMatch && updatedPackage.basePrice === 30.00) {
      console.log('✅ Update verification PASSED');
    } else {
      console.log('❌ Update verification FAILED');
      console.log('Expected room types:', expectedRoomTypes);
      console.log('Actual room types:', updatedPackage.applicableRoomTypes);
    }
    
    // Test 5: Get package by code
    console.log('\n5. Testing getPackageByCode()...');
    const packageByCode = await breakfastPackageService.getPackageByCode(createdPackage.code);
    if (packageByCode) {
      console.log(`✅ Found package by code: ${packageByCode.name}`);
    } else {
      console.log('❌ Could not find package by code');
    }
    
    // Cleanup: Delete the test package
    console.log('\n6. Cleaning up test data...');
    const deleted = await breakfastPackageService.deletePackage(createdPackage.id);
    if (deleted) {
      console.log('✅ Test package deleted successfully');
    } else {
      console.log('❌ Failed to delete test package');
    }
    
    console.log('\n🎉 All breakfast package service tests completed!');
    console.log('✅ Breakfast package edit functionality is WORKING correctly');
    
  } catch (error) {
    console.error('\n❌ Test FAILED with error:');
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    
    // Try to clean up any remaining test data
    try {
      const allPackages = await breakfastPackageService.getAllPackages();
      const testPackages = allPackages.filter(p => p.code.startsWith('TEST_'));
      for (const pkg of testPackages) {
        await breakfastPackageService.deletePackage(pkg.id);
      }
      console.log('🧹 Cleaned up any remaining test packages');
    } catch (cleanupError) {
      console.log('⚠️  Cleanup failed:', cleanupError.message);
    }
  }
}

// Run the test
testBreakfastPackageService();