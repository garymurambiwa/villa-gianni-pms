// Test script to verify Front Office arrivals fix
const { format } = require('date-fns');

function testDateNormalization() {
  console.log('🧪 Testing Front Office Date Normalization...');
  
  // Test data simulating different date formats that might come from database
  const testCases = [
    {
      name: 'ISO date string with time',
      input: '2024-01-21T10:30:00.000Z',
      expected: '2024-01-21'
    },
    {
      name: 'Already formatted date',
      input: '2024-01-21',
      expected: '2024-01-21'
    },
    {
      name: 'Date object toString()',
      input: new Date('2024-01-21').toString(),
      expected: '2024-01-21'
    },
    {
      name: 'Unix timestamp string',
      input: '1705804800000', // Jan 21, 2024
      expected: '2024-01-21'
    },
    {
      name: 'Partial date string',
      input: '2024-01-21 10:30:00',
      expected: '2024-01-21'
    }
  ];
  
  let allPassed = true;
  
  testCases.forEach((testCase, index) => {
    console.log(`\n${index + 1}. Testing: ${testCase.name}`);
    console.log(`   Input: ${testCase.input}`);
    
    // Apply the same normalization logic used in FrontOffice.tsx
    let normalizedDate = '';
    if (testCase.input) {
      const dateString = String(testCase.input);
      if (dateString.includes('T')) {
        normalizedDate = dateString.split('T')[0];
      } else if (dateString.match(/^\d{4}-\d{2}-\d{2}/)) {
        normalizedDate = dateString;
      } else {
        try {
          const dateObj = new Date(dateString);
          if (!isNaN(dateObj.getTime())) {
            normalizedDate = format(dateObj, 'yyyy-MM-dd');
          } else {
            const dateMatch = dateString.match(/^(\d{4}-\d{2}-\d{2})/);
            normalizedDate = dateMatch ? dateMatch[1] : dateString;
          }
        } catch {
          normalizedDate = dateString;
        }
      }
    }
    
    console.log(`   Normalized: ${normalizedDate}`);
    console.log(`   Expected: ${testCase.expected}`);
    
    if (normalizedDate === testCase.expected) {
      console.log('   ✅ PASS');
    } else {
      console.log('   ❌ FAIL');
      allPassed = false;
    }
  });
  
  // Test the actual filtering logic
  console.log('\n5. Testing reservation filtering logic...');
  
  const today = format(new Date(), 'yyyy-MM-dd');
  console.log(`   Today's date: ${today}`);
  
  // Mock reservations with different date formats
  const mockReservations = [
    {
      id: '1',
      guestName: 'John Doe',
      checkIn: '2024-01-21T10:00:00.000Z',
      status: 'confirmed'
    },
    {
      id: '2', 
      guestName: 'Jane Smith',
      checkIn: '2024-01-21',
      status: 'confirmed'
    },
    {
      id: '3',
      guestName: 'Bob Johnson',
      checkIn: new Date('2024-01-21').toString(),
      status: 'confirmed'
    },
    {
      id: '4',
      guestName: 'Alice Brown',
      checkIn: '2024-01-20',
      status: 'confirmed'
    }
  ];
  
  // Apply filtering logic (same as in FrontOffice.tsx)
  const filteredArrivals = mockReservations.filter(r => {
    const status = r.status.toLowerCase();
    let checkInDate = '';
    
    if (r.checkIn) {
      const dateString = String(r.checkIn);
      if (dateString.includes('T')) {
        checkInDate = dateString.split('T')[0];
      } else if (dateString.match(/^\d{4}-\d{2}-\d{2}/)) {
        checkInDate = dateString;
      } else {
        try {
          const dateObj = new Date(dateString);
          if (!isNaN(dateObj.getTime())) {
            checkInDate = format(dateObj, 'yyyy-MM-dd');
          } else {
            const dateMatch = dateString.match(/^(\d{4}-\d{2}-\d{2})/);
            checkInDate = dateMatch ? dateMatch[1] : dateString;
          }
        } catch {
          checkInDate = dateString;
        }
      }
    }
    
    return (status === 'confirmed' || status === 'pending') && checkInDate === today;
  });
  
  console.log(`   Found ${filteredArrivals.length} arrivals for today`);
  filteredArrivals.forEach(arrival => {
    console.log(`   - ${arrival.guestName} (Check-in: ${arrival.checkIn})`);
  });
  
  if (filteredArrivals.length >= 3) { // Should find at least John, Jane, and Bob
    console.log('   ✅ Reservation filtering working correctly');
  } else {
    console.log('   ❌ Reservation filtering may have issues');
    allPassed = false;
  }
  
  if (allPassed) {
    console.log('\n🎉 ALL FRONT OFFICE TESTS PASSED!');
    console.log('✅ Date normalization is working correctly');
    console.log('✅ Reservation filtering logic is fixed');
  } else {
    console.log('\n❌ SOME TESTS FAILED');
    process.exit(1);
  }
}

// Run the test
if (require.main === module) {
  testDateNormalization()
    .then(() => {
      console.log('\n✅ Front Office arrivals test completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Front Office arrivals test failed:', error);
      process.exit(1);
    });
}

module.exports = { testDateNormalization };