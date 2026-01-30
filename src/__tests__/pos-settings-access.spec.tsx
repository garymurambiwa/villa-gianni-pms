import { describe, it, expect, vi } from 'vitest'
import { shouldDenyPosSettings } from '../lib/posAccess'

describe('POS Settings access guard', () => {
  const canManagePOS = (role?: string) => ['admin','manager','supervisor'].includes(String(role||'').toLowerCase())

  it('flags privilege reduction from admin to frontdesk', () => {
    const deny = shouldDenyPosSettings(
      { id: 'U1', role: 'frontdesk' },
      { userId: 'U1', expiresAt: Date.now() + 60_000 },
      { role: 'admin' },
      false,
      canManagePOS
    )
    expect(deny).toBe('privilege_reduced')
  })

  it('flags invalid or missing session', () => {
    const deny = shouldDenyPosSettings(
      { id: 'U2', role: 'manager' },
      null,
      { role: 'manager' },
      false,
      canManagePOS
    )
    expect(deny).toBe('session_invalid')
  })

  it('flags desktop denied when lacking privileges', () => {
    const deny = shouldDenyPosSettings(
      { id: 'U3', role: 'frontdesk' },
      { userId: 'U3', expiresAt: Date.now() + 60_000 },
      { role: 'frontdesk' },
      true,
      canManagePOS
    )
    expect(deny).toBe('desktop_denied')
  })

  it('flags denied when role cannot manage POS', () => {
    const deny = shouldDenyPosSettings(
      { id: 'U4', role: 'frontdesk' },
      { userId: 'U4', expiresAt: Date.now() + 60_000 },
      { role: 'frontdesk' },
      false,
      canManagePOS
    )
    expect(deny).toBe('denied')
  })
})
