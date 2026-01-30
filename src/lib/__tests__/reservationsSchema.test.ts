import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  default: {
    query: vi.fn(),
  },
}))

vi.mock('@/lib/pmsAuthDb', () => ({
  default: {
    init: vi.fn().mockResolvedValue(undefined),
  },
}))

describe('pmsDb missing reservations handling', () => {
  let pmsDb: typeof import('@/lib/pmsDb').default
  let db: any
  let pmsAuthDb: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    pmsDb = (await import('@/lib/pmsDb')).default
    db = (await import('@/lib/db')).default
    pmsAuthDb = (await import('@/lib/pmsAuthDb')).default
  })

  it('calls init and retries when reservations table is missing on list', async () => {
    ;(db.query as any)
      .mockResolvedValueOnce({ rows: [{ column_name: 'status' }] })
      .mockResolvedValueOnce({ error: "Table 'corepms_db.reservations' doesn't exist" })
      .mockResolvedValueOnce({ rows: [] })

    const rows = await pmsDb.listReservations()
    expect(rows).toEqual([])
    expect(pmsAuthDb.init).toHaveBeenCalledTimes(1)
  })

  it('calls init and retries when reservations table is missing on create', async () => {
    ;(db.query as any)
      .mockResolvedValueOnce({ rows: [{ column_name: 'status' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ error: "Table 'corepms_db.reservations' doesn't exist" })
      .mockResolvedValueOnce({ rows: [{}] })
      .mockResolvedValueOnce({
        rows: [{
          id: 'res-1',
          guest_id: 'guest-1',
          full_name: 'John Doe',
          check_in_date: '2024-01-01',
          check_out_date: '2024-01-05',
          status: 'booked'
        }]
      })

    const created = await pmsDb.createReservation({
      guestName: 'John Doe',
      originRegion: 'online',
      packageCode: 'RO',
      roomType: 'Standard',
      checkIn: '2024-01-01',
      checkOut: '2024-01-05',
      status: 'confirmed',
      rate: 120,
      adults: 2,
      children: 0,
      idDocumentNumberEncrypted: 'enc',
      idDocumentType: 'Passport',
      nationalityCode: 'US',
      nationalityName: 'United States',
      termsAccepted: true
    } as any)

    expect(created.id).toBeDefined()
    expect(pmsAuthDb.init).toHaveBeenCalledTimes(1)
  })
})

