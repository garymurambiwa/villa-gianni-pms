import { describe, it, expect } from 'vitest'
import { validatePaymentAmount, processCardPayment } from '@/lib/posIntegration'

describe('POS Payment Utilities', () => {
  it('validates positive payment amounts', () => {
    expect(validatePaymentAmount(0.01)).toBe(true)
    expect(validatePaymentAmount(10)).toBe(true)
    expect(validatePaymentAmount(0)).toBe(false)
    expect(validatePaymentAmount(-5)).toBe(false)
  })

  it('simulates card decline when forced', async () => {
    const res = await processCardPayment({ amount: 100, meta: { forceDecline: true } })
    expect(res.status).toBe('declined')
    expect(res.reason).toBeDefined()
  })

  it('simulates card timeout when forced', async () => {
    const start = Date.now()
    const res = await processCardPayment({ amount: 50, meta: { forceTimeout: true } })
    const elapsed = Date.now() - start
    expect(res.status).toBe('timeout')
    expect(elapsed).toBeGreaterThanOrEqual(1400)
  })
})