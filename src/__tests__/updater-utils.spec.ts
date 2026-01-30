import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
const updater = require('../../electron/updater.cjs')

describe('Updater utilities', () => {
  it('validates HTTPS URLs', () => {
    expect(updater.isHttpsUrl('https://example.com/a')).toBe(true)
    expect(updater.isHttpsUrl('http://example.com/a')).toBe(false)
    expect(updater.isHttpsUrl('ftp://example.com/a')).toBe(false)
    expect(updater.isHttpsUrl('not-a-url')).toBe(false)
  })

  it('compares semantic versions correctly', () => {
    expect(updater.isVersionNewer('0.2.4', '0.2.5')).toBe(true)
    expect(updater.isVersionNewer('0.2.4', '0.3.0')).toBe(true)
    expect(updater.isVersionNewer('1.0.0', '1.0.0')).toBe(false)
    expect(updater.isVersionNewer('1.2.0', '1.1.9')).toBe(false)
  })

  it('verifies SHA256 checksum', async () => {
    const tmp = path.join(process.cwd(), 'tmp-test.bin')
    const data = Buffer.from('corepms-update-checksum')
    fs.writeFileSync(tmp, data)
    const expected = crypto.createHash('sha256').update(data).digest('hex')
    const ok = await updater.verifyChecksum(tmp, expected)
    expect(ok).toBe(true)
    fs.unlinkSync(tmp)
  })
})
