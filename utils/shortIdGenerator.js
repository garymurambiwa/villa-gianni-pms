/**
 * Utility functions for generating compliant short IDs for inventory items
 * Ensures generated IDs comply with the inv_items_short_id_len constraint (<= 10 characters)
 */

const crypto = require('crypto');

// Option 1: Using nanoid (recommended)
// const { nanoid, customAlphabet } = require('nanoid');
// Uncomment above if you want to use nanoid

/**
 * Generate a cryptographically secure short ID using native crypto module
 * @param {number} length - Desired length (default: 10, max: 10 for constraint compliance)
 * @returns {string} Generated short ID
 */
function generateSecureShortId(length = 10) {
  // Validate length against constraint
  if (length > 10) {
    throw new Error(`Short ID length cannot exceed 10 characters due to database constraint. Requested: ${length}`);
  }
  
  if (length <= 0) {
    throw new Error('Short ID length must be positive');
  }
  
  // Use URL-safe base64 characters (A-Z, a-z, 0-9, -, _)
  // This gives us 64 possible values per character
  const randomBytes = crypto.randomBytes(Math.ceil(length * 3 / 4)); // Base64 uses 4 chars per 3 bytes
  
  // Convert to base64url and trim to exact length
  let id = randomBytes.toString('base64url')
    .slice(0, length);
  
  return id;
}

/**
 * Generate an alphanumeric short ID using native crypto module
 * @param {number} length - Desired length (default: 10, max: 10 for constraint compliance)
 * @returns {string} Generated short ID (only A-Z, a-z, 0-9)
 */
function generateAlphanumericShortId(length = 10) {
  // Validate length against constraint
  if (length > 10) {
    throw new Error(`Short ID length cannot exceed 10 characters due to database constraint. Requested: ${length}`);
  }
  
  if (length <= 0) {
    throw new Error('Short ID length must be positive');
  }
  
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  
  // Use crypto.randomInt for unbiased random selection
  for (let i = 0; i < length; i++) {
    const randomIndex = crypto.randomInt(0, chars.length);
    id += chars[randomIndex];
  }
  
  return id;
}

/**
 * Generate a short ID using nanoid (if available)
 * @param {number} length - Desired length (default: 10, max: 10 for constraint compliance)
 * @param {string} alphabet - Custom alphabet (optional)
 * @returns {string} Generated short ID
 */
// function generateNanoId(length = 10, alphabet) {
//   // Validate length against constraint
//   if (length > 10) {
//     throw new Error(`Short ID length cannot exceed 10 characters due to database constraint. Requested: ${length}`);
//   }
//   
//   if (length <= 0) {
//     throw new Error('Short ID length must be positive');
//   }
//   
//   if (alphabet) {
//     const customNanoid = customAlphabet(alphabet, length);
//     return customNanoid();
//   } else {
//     // Default nanoid alphabet is URL-safe: A-Z, a-z, 0-9, -, _
//     return nanoid(length);
//   }
// }

/**
 * Validate that a short ID complies with the database constraint
 * @param {string|null} shortId - The short ID to validate (can be null)
 * @returns {Object} Validation result
 */
function validateShortId(shortId) {
  if (shortId === null) {
    return {
      valid: true,
      message: 'Short ID is null (allowed)'
    };
  }
  
  if (typeof shortId !== 'string') {
    return {
      valid: false,
      message: 'Short ID must be a string or null',
      providedType: typeof shortId
    };
  }
  
  const length = shortId.length;
  
  if (length > 10) {
    return {
      valid: false,
      message: `Short ID exceeds maximum length of 10 characters`,
      providedLength: length,
      maxAllowed: 10
    };
  }
  
  return {
    valid: true,
    message: `Short ID is valid (length: ${length})`,
    length: length
  };
}

// Example usage:
/*
try {
  // Generate compliant IDs
  const secureId = generateSecureShortId(10);
  const alphaId = generateAlphanumericShortId(8);
  
  console.log('Secure ID:', secureId, `(length: ${secureId.length})`);
  console.log('Alphanumeric ID:', alphaId, `(length: ${alphaId.length})`);
  
  // Validate IDs
  console.log('Validation for secureId:', validateShortId(secureId));
  console.log('Validation for alphaId:', validateShortId(alphaId));
  console.log('Validation for null:', validateShortId(null));
  
  // This would throw an error:
  // const tooLongId = generateSecureShortId(15);
} catch (error) {
  console.error('Error generating short ID:', error.message);
}
*/

module.exports = {
  generateSecureShortId,
  generateAlphanumericShortId,
  // generateNanoId, // Uncomment if using nanoid
  validateShortId
};