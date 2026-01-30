import { describe, it, expect } from 'vitest'
import { Config, isProduction, isDevelopment } from '@/config'

describe('Config', () => {
  it('provides default values when env is missing', () => {
    expect(typeof Config.supabaseUrl).toBe('string')
    expect(typeof Config.supabaseAnonKey).toBe('string')
    expect(['silent','error','warn','info','debug']).toContain(Config.logLevel)
  })

  it('mode flags align with Config.mode', () => {
    expect(isProduction).toBe(Config.mode === 'production')
    expect(isDevelopment).toBe(Config.mode === 'development')
    // Never both true; in test/staging both can be false
    expect(!(isProduction && isDevelopment)).toBe(true)
  })
})
