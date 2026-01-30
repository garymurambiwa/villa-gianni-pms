import { describe, it, expect } from 'vitest'

const trimSource = (s: any) => String(s || '').trim()

describe('Payment info source normalization', () => {
  it('treats non-empty trimmed source as valid', () => {
    expect(!!trimSource(' Guest provided ')).toBe(true)
    expect(!!trimSource('')).toBe(false)
    expect(!!trimSource('   ')).toBe(false)
  })
})