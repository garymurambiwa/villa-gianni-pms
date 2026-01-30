import { describe, it, expect } from 'vitest'
const nameMatches = (full: string, first: string, last: string) => {
  const f = String(full || '').toLowerCase()
  const fn = String(first || '').toLowerCase()
  const ln = String(last || '').toLowerCase()
  if (fn && !f.includes(fn)) return false
  if (ln && !f.includes(ln)) return false
  return true
}

describe('Guest name fuzzy matching', () => {
  it('matches first name only', () => {
    expect(nameMatches('John Doe', 'Jo', '')).toBe(true)
    expect(nameMatches('John Doe', 'Jane', '')).toBe(false)
  })
  it('matches last name only', () => {
    expect(nameMatches('John Doe', '', 'Do')).toBe(true)
    expect(nameMatches('John Doe', '', 'Smith')).toBe(false)
  })
  it('matches both names', () => {
    expect(nameMatches('Mary Ann Smith', 'Mary', 'Smith')).toBe(true)
    expect(nameMatches('Mary Ann Smith', 'Mar', 'Smi')).toBe(true)
  })
})
