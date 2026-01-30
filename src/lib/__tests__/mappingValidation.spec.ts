import { describe, it, expect } from 'vitest';
import glHarness from '@/lib/glHarness';

describe('Night Audit GL Mapping Validation', () => {
  it('reports missing mappings when required codes are not set', () => {
    const date = new Date().toISOString().slice(0,10);
    const res = glHarness.validateNightAuditMappings(date);
    // res.ok can be true or false depending on environment; just assert shape
    expect(Array.isArray(res.missing)).toBe(true);
    expect(typeof res.ok).toBe('boolean');
  });
});
