/**
 * Error handling utilities for PostgreSQL constraint violations
 * Specifically handles inv_items_short_id_len constraint violations (error code 23514)
 */

class DatabaseConstraintError extends Error {
  /**
   * @param {string} message - Error message
   * @param {string} constraint - Name of the violated constraint
   * @param {string} table - Name of the table
   * @param {string} code - PostgreSQL error code
   */
  constructor(message, constraint, table, code) {
    super(message);
    this.name = 'DatabaseConstraintError';
    this.constraint = constraint;
    this.table = table;
    this.code = code;
    
    // Maintain proper stack trace (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, DatabaseConstraintError);
    }
  }
}

/**
 * Handle PostgreSQL check constraint violation for inv_items_short_id_len
 * @param {Object} error - The error object from pg query
 * @param {Object} itemData - The data that was being inserted/updated
 * @returns {Object|null} Formatted error response if it's a constraint violation, null otherwise
 */
function handleShortIdConstraintViolation(error, itemData) {
  // Check for check_violation (23514)
  if (error.code === '23514') {
    // Check if it's our specific constraint
    if (error.detail && error.detail.includes('inv_items_short_id_len')) {
      const providedValue = itemData?.short_id;
      const actualLength = providedValue ? providedValue.length : 0;
      
      return {
        ok: false,
        error: 'VALIDATION_ERROR',
        message: 'Short ID validation failed',
        details: {
          constraint: 'inv_items_short_id_len',
          table: 'inv_items',
          providedValue: providedValue,
          actualLength: actualLength,
          maxAllowed: 10,
          requirement: 'Short ID must be null or have maximum 10 characters'
        }
      };
    }
  }
  
  // Check for unique constraint violation on short_id
  if (error.code === '23505') { // unique_violation
    if (error.detail && error.detail.includes('short_id')) {
      const providedValue = itemData?.short_id;
      
      return {
        ok: false,
        error: 'CONFLICT',
        message: 'Short ID already exists',
        details: {
          constraint: 'inv_items_short_id_key', // Assuming this is the unique constraint name
          table: 'inv_items',
          providedValue: providedValue
        }
      };
    }
  }
  
  // Not a constraint we're handling specifically
  return null;
}

/**
 * Express-compatible error handler middleware for database constraint errors
 * @param {Object} error - The error object
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
function databaseErrorHandler(error, req, res, next) {
  // Handle our custom database constraint errors
  if (error.name === 'DatabaseConstraintError') {
    if (error.constraint === 'inv_items_short_id_len' && error.code === '23514') {
      return res.status(400).json({
        ok: false,
        error: 'VALIDATION_ERROR',
        message: 'Short ID validation failed',
        details: {
          constraint: error.constraint,
          table: error.table,
          providedValue: error.message.includes('Received:') 
            ? error.message.match(/Received: '(.*)'/)[1] 
            : null,
          actualLength: error.message.includes('Received:') 
            ? error.message.match(/Received: '(.*)'/)[1]?.length || 0
            : 0,
          maxAllowed: 10,
          requirement: 'Short ID must be null or have maximum 10 characters'
        }
      });
    }
    
    if (error.constraint === 'inv_items_short_id_key' && error.code === '23505') {
      return res.status(409).json({
        ok: false,
        error: 'CONFLICT',
        message: 'Short ID already exists',
        details: {
          constraint: error.constraint,
          table: error.table,
          providedValue: error.message.includes('Key') 
            ? error.message.match(/\((.*)\)=\((.*)\)/)[2] 
            : null
        }
      });
    }
  }
  
  // Handle other known PostgreSQL errors
  if (error.code === '23502') { // not_null_violation
    const columnMatch = error.detail?.match(/null in column "(.*?)"/);
    return res.status(400).json({
      ok: false,
      error: 'VALIDATION_ERROR',
      message: 'Missing required field',
      details: { 
        column: columnMatch ? columnMatch[1] : 'unknown' 
      }
    });
  }
  
  // For unexpected errors, log and return generic 500
  console.error('Unexpected database error:', error);
  return res.status(500).json({
    ok: false,
    error: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred'
  });
}

/**
 * Wrapper function for safely executing inventory item operations
 * @param {Function} operationFn - Async function that performs the database operation
 * @param {Object} itemData - Data being operated on (for error context)
 * @returns {Promise<Object>} Result of the operation or formatted error
 */
async function safeInventoryOperation(operationFn, itemData) {
  try {
    const result = await operationFn();
    return { ok: true, data: result };
  } catch (error) {
    // Handle short ID constraint violations
    const constraintError = handleShortIdConstraintViolation(error, itemData);
    if (constraintError) {
      return constraintError;
    }
    
    // Re-throw for unexpected errors
    throw error;
  }
}

module.exports = {
  DatabaseConstraintError,
  handleShortIdConstraintViolation,
  databaseErrorHandler,
  safeInventoryOperation
};