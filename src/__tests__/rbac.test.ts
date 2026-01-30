import { describe, it, expect } from 'vitest'
import auth, { register, login, logout, getSession, setUsers, listUsers } from '@/lib/authService'
import { canAccessTransactionClearing, canManageStaff, canProcessTransactions, normalizeRole } from '@/lib/permissions'

describe('RBAC privileges', () => {
  it('new users receive only assigned privileges', async () => {
    setUsers([])
    const r = await register({ username: 'u1', email: 'u1@example.com', password: 'P@ssw0rd1', name: 'U1', phone: '000' })
    expect(r.ok).toBe(true)
    const u = listUsers().find(x => x.username === 'u1')!
    expect(normalizeRole(u.role)).toBe('frontdesk')
    expect(canAccessTransactionClearing(u.role)).toBe(false)
    expect(canManageStaff(u.role)).toBe(false)
    expect(canProcessTransactions(u.role)).toBe(false)
  })

  it('privilege escalation attempts are blocked via checks', () => {
    expect(canAccessTransactionClearing('manager')).toBe(false)
    expect(canAccessTransactionClearing('admin')).toBe(true)
  })

  it('session data reflects user privileges and resets on new session', async () => {
    setUsers([])
    await register({ username: 'fd', email: 'fd@example.com', password: 'P@ssw0rd1', name: 'FD' })
    const ok = await login('fd', 'P@ssw0rd1')
    expect(ok.ok).toBe(true)
    const s1 = getSession()!
    expect(normalizeRole(s1.role)).toBe('frontdesk')
    logout()
    await register({ username: 'adm', email: 'adm@example.com', password: 'P@ssw0rd1', name: 'AD', })
    const uadm = listUsers().find(x => x.username === 'adm')!
    uadm.role = 'admin' as any
    setUsers([uadm, ...listUsers().filter(x => x.username !== 'adm')])
    const ok2 = await login('adm', 'P@ssw0rd1')
    expect(ok2.ok).toBe(true)
    const s2 = getSession()!
    expect(normalizeRole(s2.role)).toBe('admin')
  })
})