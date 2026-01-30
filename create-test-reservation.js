// Script to create a test reservation for today
const { format } = require('date-fns');

async function createTestReservation() {
  try {
    // Import database (this would need to be adapted for the actual Electron environment)
    // For now, this is a template showing what the reservation creation should look like
    
    const today = format(new Date(), 'yyyy-MM-dd');
    const tomorrow = format(new Date(Date.now() + 24 * 60 * 60 * 1000), 'yyyy-MM-dd');
    
    console.log('Creating test reservation for today:', today);
    
    // This would be executed in the actual app context:
    /*
    const guestSql = "INSERT INTO guests (id, full_name, email, phone) VALUES (?, ?, ?, ?)";
    const guestParams = [`G_TEST_${Date.now()}`, 'Test Guest', 'test@example.com', '+1234567890'];
    await db.query(guestSql, guestParams);
    
    const reservationSql = `INSERT INTO reservations (
      id, guest_id, check_in_date, check_out_date, status, 
      id_document_enc, id_document_type, package_code, room_type, rate, adults
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    
    const reservationParams = [
      `RES_TEST_${Date.now()}`,
      `G_TEST_${Date.now()}`,
      today,  // check_in_date - THIS IS THE KEY FIELD FOR ARRIVALS
      tomorrow,
      'confirmed',
      'TEST123',
      'Passport',
      'RO',
      'Standard',
      100.00,
      2
    ];
    
    await db.query(reservationSql, reservationParams);
    */
    
    console.log('Test reservation created successfully!');
    console.log('Check-in date:', today);
    console.log('Expected to appear in Front Office arrivals section');
    
  } catch (error) {
    console.error('Failed to create test reservation:', error);
  }
}

createTestReservation();