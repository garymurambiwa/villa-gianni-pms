import { describe, it, expect } from 'vitest'

function canCheckInCash(reservation: any, room: any, opts: { paymentPreAuth: boolean; registrationPrinted: boolean }) {
  const pm = String(reservation?.paymentMethod || '').toLowerCase()
  const isCash = pm === 'cash'
  const verified = isCash ? !!reservation?.paymentInfoSource : !!reservation?.paymentVerified
  const allowed = !!reservation && !!room && room.status === 'VC' && (!!reservation?.paymentInfoSource) && verified && (!!opts.registrationPrinted) && (isCash || !!opts.paymentPreAuth)
  return allowed
}

describe('FrontOffice Check-In with Cash', () => {
  it('allows check-in with cash without preauth when source provided', () => {
    const reservation = { id: 'RES2', paymentMethod: 'Cash', paymentInfoSource: 'Guest provided', paymentVerified: false }
    const room = { id: 'R101', status: 'VC' }
    const allowed = canCheckInCash(reservation, room, { paymentPreAuth: false, registrationPrinted: true })
    expect(allowed).toBe(true)
  })

  it('disallows cash check-in when source missing', () => {
    const reservation = { id: 'RES2', paymentMethod: 'Cash', paymentInfoSource: '', paymentVerified: false }
    const room = { id: 'R101', status: 'VC' }
    const allowed = canCheckInCash(reservation, room, { paymentPreAuth: false, registrationPrinted: true })
    expect(allowed).toBe(false)
  })
})