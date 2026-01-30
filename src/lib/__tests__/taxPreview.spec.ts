import { describe, it, expect } from 'vitest'
import { calcTaxBreakdown } from '../taxPreview'

describe('calcTaxBreakdown', () => {
  it('inclusive 10% for 1 night', () => {
    const r = calcTaxBreakdown(120, 1, 10, 'inclusive', true)
    expect(r.subtotal).toBeCloseTo(109.0909, 3)
    expect(r.tax).toBeCloseTo(10.9090, 3)
    expect(r.total).toBeCloseTo(120, 3)
  })
  it('exclusive 10% for 1 night', () => {
    const r = calcTaxBreakdown(120, 1, 10, 'exclusive', true)
    expect(r.subtotal).toBeCloseTo(120, 3)
    expect(r.tax).toBeCloseTo(12, 3)
    expect(r.total).toBeCloseTo(132, 3)
  })
  it('disabled tax', () => {
    const r = calcTaxBreakdown(120, 2, 10, 'exclusive', false)
    expect(r.subtotal).toBeCloseTo(240, 3)
    expect(r.tax).toBeCloseTo(0, 3)
    expect(r.total).toBeCloseTo(240, 3)
  })
  it('edge cases: zero percent', () => {
    const r = calcTaxBreakdown(100, 3, 0, 'exclusive', true)
    expect(r.subtotal).toBe(300)
    expect(r.tax).toBe(0)
    expect(r.total).toBe(300)
  })
  it('edge cases: max percent 100', () => {
    const r = calcTaxBreakdown(100, 1, 100, 'exclusive', true)
    expect(r.subtotal).toBe(100)
    expect(r.tax).toBe(100)
    expect(r.total).toBe(200)
  })
})
