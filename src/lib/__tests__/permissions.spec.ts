import { describe, it, expect } from 'vitest'
import {
  normalizeRole,
  isAdmin,
  isManager,
  canAccessTransactionClearing,
  canAccessReporting,
  canAccessInventoryManagement,
  canManageStaff,
} from '../permissions'

describe('Permissions role guards', () => {
  it('normalizes role values', () => {
    expect(normalizeRole('Admin')).toBe('admin')
    expect(normalizeRole(' MANAGER ')).toBe(' manager ')
    expect(normalizeRole('Supervisor')).toBe('supervisor')
  })

  it('admin and manager detection', () => {
    expect(isAdmin('admin')).toBe(true)
    expect(isAdmin('manager')).toBe(false)
    expect(isManager('manager')).toBe(true)
    expect(isManager('supervisor')).toBe(true)
    expect(isManager('frontdesk')).toBe(false)
  })

  it('access checks reflect policy', () => {
    expect(canAccessTransactionClearing('admin')).toBe(true)
    expect(canAccessTransactionClearing('manager')).toBe(false)
    expect(canAccessReporting('admin')).toBe(true)
    expect(canAccessReporting('manager')).toBe(true)
    expect(canAccessReporting('frontdesk')).toBe(false)
    expect(canAccessInventoryManagement('admin')).toBe(true)
    expect(canAccessInventoryManagement('posmanager')).toBe(true)
    expect(canAccessInventoryManagement('barman')).toBe(true)
    expect(canManageStaff('admin')).toBe(true)
    expect(canManageStaff('manager')).toBe(false)
    expect(canManageStaff('frontdesk')).toBe(false)
  })
})