// Test script to verify breakfast package edit functionality
const { breakfastPackageService } = require('./src/lib/breakfastPackageService.ts');

async function testBreakfastPackageEdit() {
  try {
    console.log('Testing breakfast package edit functionality...');
    
    // Test creating a package
    const testData = {
      code: 'TEST',
      name: 'Test Package',
      description: 'Test breakfast package',
      basePrice: 20,
      adultPrice: 15,
      childPrice: 10,
      applicableRoomTypes: ['DELUXE', 'STANDARD'],
      isActive: true,
      sortOrder: 99
    };
    
    console.log('Creating test package...');
    const createdPackage = await breakfastPackageService.createPackage(testData);
    console.log('Created package:', createdPackage);
    
    // Test updating the package
    console.log('Updating test package...');
    const updateData = {
      name: 'Updated Test Package',
      basePrice: 25,
      applicableRoomTypes: ['SUITE', 'DELUXE']
    };
    
    const updatedPackage = await breakfastPackageService.updatePackage(createdPackage.id, updateData);
    console.log('Updated package:', updatedPackage);
    
    // Verify the update worked
    if (updatedPackage.name === 'Updated Test Package' && 
        updatedPackage.basePrice === 25 &&
        JSON.stringify(updatedPackage.applicableRoomTypes) === JSON.stringify(['SUITE', 'DELUXE'])) {
      console.log('✅ Breakfast package edit test PASSED');
    } else {
      console.log('❌ Breakfast package edit test FAILED');
      console.log('Expected applicableRoomTypes: ["SUITE", "DELUXE"]');
      console.log('Actual applicableRoomTypes:', updatedPackage.applicableRoomTypes);
    }
    
    // Clean up - delete the test package
    await breakfastPackageService.deletePackage(createdPackage.id);
    console.log('Cleaned up test package');
    
  } catch (error) {
    console.error('❌ Breakfast package edit test FAILED with error:', error);
    console.error('Error details:', error.message);
    console.error('Stack trace:', error.stack);
  }
}

// Run the test
testBreakfastPackageEdit();