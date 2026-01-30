// Test script to verify breakfast package creation fix
const { breakfastPackageService } = require('./src/lib/breakfastPackageService');

async function testBreakfastPackageCreation() {
  console.log('🧪 Testing Breakfast Package Creation Fix...');
  
  try {
    // Test creating a breakfast package with room types array
    const testData = {
      code: 'TEST_' + Date.now(),
      name: 'Test Breakfast Package',
      description: 'Test package to verify array handling fix',
      basePrice: 25.50,
      adultPrice: 15.75,
      childPrice: 8.25,
      applicableRoomTypes: ['DELUXE', 'STANDARD', 'SUITE'],
      isActive: true,
      sortOrder: 100
    };
    
    console.log('\n1. Creating test breakfast package...');
    const createdPackage = await breakfastPackageService.createPackage(testData);
    console.log('✅ Package created successfully');
    console.log('   ID:', createdPackage.id);
    console.log('   Code:', createdPackage.code);
    console.log('   Name:', createdPackage.name);
    console.log('   Applicable Room Types:', createdPackage.applicableRoomTypes);
    
    // Verify the room types were stored correctly
    const expectedRoomTypes = ['DELUXE', 'STANDARD', 'SUITE'];
    const roomTypesMatch = JSON.stringify(createdPackage.applicableRoomTypes.sort()) === 
                          JSON.stringify(expectedRoomTypes.sort());
    
    if (roomTypesMatch) {
      console.log('✅ Room types stored correctly');
    } else {
      console.log('❌ Room types mismatch');
      console.log('   Expected:', expectedRoomTypes);
      console.log('   Actual:', createdPackage.applicableRoomTypes);
      throw new Error('Room types not stored correctly');
    }
    
    // Test retrieving the package
    console.log('\n2. Retrieving created package...');
    const retrievedPackage = await breakfastPackageService.getPackageByCode(createdPackage.code);
    if (retrievedPackage) {
      console.log('✅ Package retrieved successfully');
      console.log('   Retrieved room types:', retrievedPackage.applicableRoomTypes);
      
      // Verify retrieved data matches created data
      if (JSON.stringify(retrievedPackage.applicableRoomTypes.sort()) === 
          JSON.stringify(expectedRoomTypes.sort())) {
        console.log('✅ Retrieved room types match original');
      } else {
        throw new Error('Retrieved room types do not match original');
      }
    } else {
      throw new Error('Could not retrieve created package');
    }
    
    // Test updating the package
    console.log('\n3. Updating package room types...');
    const updateData = {
      applicableRoomTypes: ['SUITE', 'EXECUTIVE']
    };
    
    const updatedPackage = await breakfastPackageService.updatePackage(createdPackage.id, updateData);
    console.log('✅ Package updated successfully');
    console.log('   Updated room types:', updatedPackage.applicableRoomTypes);
    
    // Verify update worked
    const expectedUpdatedTypes = ['SUITE', 'EXECUTIVE'];
    const updateMatch = JSON.stringify(updatedPackage.applicableRoomTypes.sort()) === 
                       JSON.stringify(expectedUpdatedTypes.sort());
    
    if (updateMatch) {
      console.log('✅ Package update verified successfully');
    } else {
      console.log('❌ Update verification failed');
      console.log('   Expected:', expectedUpdatedTypes);
      console.log('   Actual:', updatedPackage.applicableRoomTypes);
      throw new Error('Package update verification failed');
    }
    
    // Cleanup
    console.log('\n4. Cleaning up test data...');
    const deleted = await breakfastPackageService.deletePackage(createdPackage.id);
    if (deleted) {
      console.log('✅ Test package cleaned up successfully');
    } else {
      console.log('⚠️  Warning: Could not delete test package');
    }
    
    console.log('\n🎉 ALL TESTS PASSED!');
    console.log('✅ Breakfast package creation fix is working correctly');
    console.log('✅ Array handling for applicable_room_types is fixed');
    
  } catch (error) {
    console.error('\n❌ TEST FAILED:', error.message);
    console.error('Stack trace:', error.stack);
    
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
    
    process.exit(1);
  }
}

// Run the test
if (require.main === module) {
  testBreakfastPackageCreation()
    .then(() => {
      console.log('\n✅ Breakfast package creation test completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Breakfast package creation test failed:', error);
      process.exit(1);
    });
}

module.exports = { testBreakfastPackageCreation };