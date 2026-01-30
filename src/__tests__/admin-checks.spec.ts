import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

describe('Admin checks in Electron IPC', () => {
  it('does not contain ADMIN_CHECK_FAILED and includes local DB fallback', () => {
    const file = path.join(process.cwd(), 'electron', 'main.cjs')
    const content = fs.readFileSync(file, 'utf8')
    expect(content.includes('ADMIN_CHECK_FAILED')).toBe(false)
    expect(content.includes("SELECT role FROM public.app_users WHERE id = $1 OR username = $2")).toBe(true)
  })
})