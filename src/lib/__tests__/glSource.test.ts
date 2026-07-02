import { describe, expect, it } from 'vitest';
import { normalizeGLSource } from '../../../server/glSource.cjs';

describe('normalizeGLSource', () => {
  it('maps inventory-related values to allowed GL source values', () => {
    expect(normalizeGLSource('inventory')).toBe('adjustment');
    expect(normalizeGLSource('inventory_control')).toBe('adjustment');
    expect(normalizeGLSource('stock_take')).toBe('reconciliation');
    expect(normalizeGLSource('pending_batch')).toBe('adjustment');
  });

  it('keeps already-supported sources unchanged', () => {
    expect(normalizeGLSource('night_audit')).toBe('night_audit');
    expect(normalizeGLSource('reconciliation')).toBe('reconciliation');
    expect(normalizeGLSource('expense')).toBe('expense');
  });

  it('falls back safely for unknown values', () => {
    expect(normalizeGLSource('something_else')).toBe('manual');
  });
});
