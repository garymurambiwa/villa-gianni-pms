import { describe, it, expect } from 'vitest'
import userMgmtService from '@/lib/userMgmtService'

describe('password strength', () => {
  it('accepts strong passwords', () => {
    expect(userMgmtService.validatePassword('Aa1!aaaa')).toBe(true)
  })
  it('rejects weak passwords', () => {
    expect(userMgmtService.validatePassword('password')).toBe(false)
  })
})

describe('email validation', () => {
  it('valid format', () => {
    expect(userMgmtService.validateEmail('user@example.com')).toBe(true)
  })
  it('invalid format', () => {
    expect(userMgmtService.validateEmail('bad@')).toBe(false)
  })
})