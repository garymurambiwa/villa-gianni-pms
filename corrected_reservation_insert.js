// CORRECTED RESERVATION INSERT STATEMENT

const sql = `
  INSERT INTO reservations 
  (guest_id, room_id, check_in_date, check_out_date, status, package_code, tax_inclusive, total_amount)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  RETURNING id
`;

const params = [
  resData.guestId, 
  resData.roomId, 
  resData.checkIn,     // Should be Date object or properly formatted date string
  resData.checkOut,    // Should be Date object or properly formatted date string
  'confirmed', 
  resData.packageCode || 'RO',
  resData.taxInclusive ? 1 : 0,
  resData.totalAmount || 0
];

// Execute with proper PostgreSQL parameter binding
const result = await db.query(sql, params);

// Additional considerations:

// 1. Check if all required columns are provided
// The reservations table has several NOT NULL columns that might need values:
// - id_document_enc (NOT NULL)
// - source
// - terms_accepted
// - payment_info_source
// - payment_verified

// 2. Consider using a more complete insert with default values:
/*
const completeSql = `
  INSERT INTO reservations 
  (guest_id, room_id, check_in_date, check_out_date, status, package_code, 
   tax_inclusive, total_amount, id_document_enc, source, terms_accepted, 
   payment_info_source, payment_verified)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
  RETURNING id
`;

const completeParams = [
  resData.guestId,
  resData.roomId,
  resData.checkIn,
  resData.checkOut,
  'confirmed',
  resData.packageCode || 'RO',
  resData.taxInclusive ? 1 : 0,
  resData.totalAmount || 0,
  resData.idDocumentEnc || '',        // Required: id_document_enc
  resData.source || 'direct',         // Required: source
  resData.termsAccepted || false,     // Required: terms_accepted
  resData.paymentInfoSource || 'cash',// Required: payment_info_source
  resData.paymentVerified || false    // Required: payment_verified
];
*/