import { describe, it, expect } from 'vitest'

function evaluateCheckInPrereqs(reservation: any, room: any, opts: { paymentPreAuth: boolean; registrationPrinted: boolean }) {
  const reasons: string[] = []
  if (!reservation) reasons.push('No reservation selected')
  if (!room) reasons.push('No room selected')
  if (room && room.status !== 'VC') reasons.push('Selected room is not Vacant & Ready')
  if (!opts.paymentPreAuth) reasons.push('Payment pre-authorization is required')
  if (reservation && !reservation.paymentVerified) reasons.push('Payment details not verified')
  if (reservation && !reservation.paymentInfoSource) reasons.push('Payment info source is missing')
  if (!opts.registrationPrinted) reasons.push('Registration card must be printed and signed')
  return { allowed: reasons.length === 0, reasons }
}

describe('FrontOffice Check-In prerequisites', () => {
  it('allows check-in when all prerequisites met', () => {
    const reservation = { id: 'RES1', paymentVerified: true, paymentInfoSource: 'Guest provided' }
    const room = { id: 'R101', status: 'VC' }
    const res = evaluateCheckInPrereqs(reservation, room, { paymentPreAuth: true, registrationPrinted: true })
    expect(res.allowed).toBe(true)
    expect(res.reasons.length).toBe(0)
  })

  it('disallows check-in when payment verification missing', () => {
    const reservation = { id: 'RES1', paymentVerified: false, paymentInfoSource: '' }
    const room = { id: 'R101', status: 'VC' }
    const res = evaluateCheckInPrereqs(reservation, room, { paymentPreAuth: true, registrationPrinted: true })
    expect(res.allowed).toBe(false)
    expect(res.reasons).toContain('Payment details not verified')
    expect(res.reasons).toContain('Payment info source is missing')
  })
})