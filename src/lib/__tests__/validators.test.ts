import { describe, it, expect } from 'vitest';
import { isValidIdDocumentNumber } from '../validators';

describe('isValidIdDocumentNumber', () => {
  it('accepts alphanumeric 6-20 chars', () => {
    expect(isValidIdDocumentNumber('A123456')).toBe(true);
    expect(isValidIdDocumentNumber('ABC-123 456')).toBe(true);
    expect(isValidIdDocumentNumber('P123456789012345678')).toBe(true);
  });

  it('rejects too short or too long', () => {
    expect(isValidIdDocumentNumber('A123')).toBe(false);
    expect(isValidIdDocumentNumber('A12345678901234567890X')).toBe(false);
  });

  it('rejects invalid characters', () => {
    expect(isValidIdDocumentNumber('ABC#123')).toBe(false);
    expect(isValidIdDocumentNumber('12345*')).toBe(false);
  });

  it('trims spaces and validates', () => {
    expect(isValidIdDocumentNumber('   A123456   ')).toBe(true);
  });
});

