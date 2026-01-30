import { describe, it, expect } from 'vitest'
import { getResPackageLabel, computeTotalRate, sanitizePackageCode } from './packageUtils'

const options = [
  { code: 'RO', label: 'Room Only', surcharge: 0 },
  { code: 'BB', label: 'Bed & Breakfast', surcharge: 15 },
  { code: 'DBB', label: 'Dinner, Bed & Breakfast', surcharge: 45 },
]

describe('packageUtils', () => {
  it('getResPackageLabel returns label for known codes', () => {
    expect(getResPackageLabel({ packageCode: 'RO' }, options, 'RO')).toBe('Room Only')
    expect(getResPackageLabel({ packageCode: 'BB' }, options, 'RO')).toBe('Bed & Breakfast')
    expect(getResPackageLabel({ package_code: 'DBB' }, options, 'RO')).toBe('Dinner, Bed & Breakfast')
  })

  it('getResPackageLabel falls back to code string', () => {
    expect(getResPackageLabel({ packageCode: 'AI' }, options, 'RO')).toBe('AI')
  })

  it('computeTotalRate adds surcharge and guards non-numeric', () => {
    expect(computeTotalRate(100, 'BB', options, 'RO')).toBe(115)
    expect(computeTotalRate('100', 'DBB', options, 'RO')).toBe(145)
    expect(computeTotalRate(undefined, 'RO', options, 'RO')).toBe(0)
  })

  it('sanitizePackageCode returns fallback for non-string input', () => {
    expect(sanitizePackageCode(() => 'RO', 'RO')).toBe('RO')
    expect(sanitizePackageCode(null, 'RO')).toBe('RO')
    expect(sanitizePackageCode('BB', 'RO')).toBe('BB')
  })
})

