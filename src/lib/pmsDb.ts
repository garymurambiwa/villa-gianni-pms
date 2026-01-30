import db from './db'
import pmsAuthDb from '@/lib/pmsAuthDb'
import { Reservation } from '@/types'
import { v4 as uuidv4 } from 'uuid'

type DbReservationRow = {
  id: string
  guest_id: string
  full_name: string
  check_in_date: string
  check_out_date: string
  status: string
  source?: string
  id_document_enc?: string
  id_document_type?: string
  nationality_code?: string
  nationality_name?: string
  booking_source?: string
  partner_code?: string
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  utm_term?: string
  utm_content?: string
  terms_accepted?: boolean
  confirmed_at?: string
  signature_encrypted?: string
  payment_info_source?: string
  payment_verified?: boolean
  package_code?: string
}

let statusColCache: string | null = null
async function resolveStatusColumn(): Promise<string> {
  if (statusColCache) return statusColCache
  // PostgreSQL compatible query to check which column exists
  const res = await db.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns 
     WHERE table_name = 'reservations' 
       AND column_name IN ('reservation_status','status')
       AND (table_schema = 'public' OR table_schema = current_schema())`
  )
  if ('error' in res) { statusColCache = 'status'; return statusColCache }
  const names = res.rows.map(r => r.column_name)
  if (names.includes('reservation_status')) { statusColCache = 'reservation_status'; return statusColCache }
  statusColCache = 'status'
  return statusColCache
}

const statusFromDb = (s: string): Reservation['status'] => {
  switch ((s || '').toLowerCase()) {
    case 'booked': return 'confirmed'
    case 'checked_in': return 'checked-in'
    case 'checked_out': return 'checked-out'
    case 'cancelled': return 'cancelled'
    default: return 'confirmed'
  }
}
const statusToDb = (s: Reservation['status']): string => {
  switch (s) {
    case 'confirmed': return 'booked'
    case 'checked-in': return 'checked_in'
    case 'checked-out': return 'checked_out'
    case 'cancelled': return 'cancelled'
    default: return 'booked'
  }
}

const toReservation = (row: DbReservationRow): Reservation => ({
  id: row.id,
  guestName: row.full_name,
  originRegion: row.source || '',
  packageCode: row.package_code || 'RO',
  roomType: 'Standard King',
  checkIn: row.check_in_date,
  checkOut: row.check_out_date,
  status: statusFromDb(row.status),
  rate: 120,
  adults: 2,
  children: 0,
  idDocumentNumberEncrypted: row.id_document_enc,
  idDocumentType: (row.id_document_type as any) || 'Passport',
  nationalityCode: row.nationality_code || '',
  nationalityName: row.nationality_name || '',
  bookingSource: (row.booking_source as any) || undefined,
  partnerCode: row.partner_code || undefined,
  utmSource: row.utm_source || undefined,
  utmMedium: row.utm_medium || undefined,
  utmCampaign: row.utm_campaign || undefined,
  utmTerm: row.utm_term || undefined,
  utmContent: row.utm_content || undefined,
  termsAccepted: !!row.terms_accepted,
  confirmedAt: row.confirmed_at || undefined,
  signatureEncrypted: row.signature_encrypted || undefined,
  paymentInfoSource: row.payment_info_source || undefined,
  paymentVerified: !!row.payment_verified,
})

async function ensureGuest(fullName: string): Promise<string> {
  const existing = await db.query<{ id: string }>(
    'select id from guests where full_name = ? limit 1',
    [fullName]
  )
  if ('error' in existing) throw new Error(existing.error)
  if (existing.rows[0]?.id) return existing.rows[0].id
  
  const newId = uuidv4()
  const ins = await db.query(
    'insert into guests (id, full_name) values (?, ?)',
    [newId, fullName]
  )
  if ('error' in ins) throw new Error(ins.error)
  return newId
}

export const pmsDb = {
  async listReservations(): Promise<Reservation[]> {
    try {
      const statusCol = await resolveStatusColumn()
      // console.log('[pmsDb] Using status column:', statusCol)
      let res = await db.query<DbReservationRow>(
        `select r.id, r.guest_id, g.full_name, r.check_in_date, r.check_out_date, r.${statusCol} as status, r.source,
                r.id_document_enc, r.id_document_type, r.nationality_code, r.nationality_name,
                r.booking_source, r.partner_code, r.utm_source, r.utm_medium, r.utm_campaign, r.utm_term, r.utm_content,
                r.terms_accepted, r.confirmed_at, r.signature_encrypted, r.payment_info_source, r.payment_verified,
                r.package_code
           from reservations r
           join guests g on g.id = r.guest_id
           order by r.inserted_at desc`
      )
      if ('error' in res) {
        const msg = String(res.error || '')
        const missing = msg.includes(`doesn't exist`) || msg.toLowerCase().includes('unknown table')
        if (missing) {
          try { await pmsAuthDb.init() } catch {}
          res = await db.query<DbReservationRow>(
            `select r.id, r.guest_id, g.full_name, r.check_in_date, r.check_out_date, r.${statusCol} as status, r.source,
                    r.id_document_enc, r.id_document_type, r.nationality_code, r.nationality_name,
                    r.booking_source, r.partner_code, r.utm_source, r.utm_medium, r.utm_campaign, r.utm_term, r.utm_content,
                    r.terms_accepted, r.confirmed_at, r.signature_encrypted, r.payment_info_source, r.payment_verified,
                    r.package_code
               from reservations r
               join guests g on g.id = r.guest_id
               order by r.inserted_at desc`
          )
          if ('error' in res) {
            throw new Error(`Database not initialized: ${msg}`)
          }
        } else {
          throw new Error(msg)
        }
      }
      const mapped = res.rows.map(toReservation)
      // console.log('[pmsDb] listReservations found:', mapped.length)
      return mapped
    } catch (e) {
      console.error('[pmsDb] listReservations failed:', e)
      throw e
    }
  },

  async createReservation(input: Omit<Reservation, 'id'>): Promise<Reservation> {
    try {
      const statusCol = await resolveStatusColumn()
      const guestId = await ensureGuest(input.guestName)
      const statusDb = statusToDb(input.status || 'confirmed')
      const enc = input.idDocumentNumberEncrypted || ''
      const newId = uuidv4()
      
      // console.log('[pmsDb] Creating reservation for:', input.guestName, 'status:', statusDb)
      
      let ins = await db.query<DbReservationRow>(
        `insert into reservations (
           id, guest_id, check_in_date, check_out_date, ${statusCol}, source,
           id_document_enc, id_document_type, nationality_code, nationality_name,
           booking_source, partner_code, utm_source, utm_medium, utm_campaign, utm_term, utm_content,
           terms_accepted, confirmed_at, signature_encrypted, payment_info_source, payment_verified,
           package_code
         ) values (
           ?, ?, ?, ?, ?, ?,
           ?, ?, ?, ?,
           ?, ?, ?, ?, ?, ?, ?,
           ?, ?, ?, ?, ?,
           ?
         )`,
        [
          newId, guestId, input.checkIn, input.checkOut, statusDb, input.originRegion || null,
          enc, input.idDocumentType || null, input.nationalityCode || null, input.nationalityName || null,
          input.bookingSource || null, input.partnerCode || null, input.utmSource || null, input.utmMedium || null, input.utmCampaign || null, input.utmTerm || null, input.utmContent || null,
          !!input.termsAccepted, input.confirmedAt || null, input.signatureEncrypted || null, (input as any).paymentInfoSource || null, (input as any).paymentVerified || null,
          input.packageCode || 'RO'
        ]
      )
      if ('error' in ins) {
        const msg = String(ins.error || '')
        const missing = msg.includes(`doesn't exist`) || msg.toLowerCase().includes('unknown table')
        if (missing) {
          try { await pmsAuthDb.init() } catch {}
          ins = await db.query<DbReservationRow>(
            `insert into reservations (
               id, guest_id, check_in_date, check_out_date, ${statusCol}, source,
               id_document_enc, id_document_type, nationality_code, nationality_name,
               booking_source, partner_code, utm_source, utm_medium, utm_campaign, utm_term, utm_content,
               terms_accepted, confirmed_at, signature_encrypted, payment_info_source, payment_verified,
               package_code
             ) values (
               ?, ?, ?, ?, ?, ?,
               ?, ?, ?, ?,
               ?, ?, ?, ?, ?, ?, ?,
               ?, ?, ?, ?, ?,
               ?
             )`,
            [
              newId, guestId, input.checkIn, input.checkOut, statusDb, input.originRegion || null,
              enc, input.idDocumentType || null, input.nationalityCode || null, input.nationalityName || null,
              input.bookingSource || null, input.partnerCode || null, input.utmSource || null, input.utmMedium || null, input.utmCampaign || null, input.utmTerm || null, input.utmContent || null,
              !!input.termsAccepted, input.confirmedAt || null, input.signatureEncrypted || null, (input as any).paymentInfoSource || null, (input as any).paymentVerified || null,
              input.packageCode || 'RO'
            ]
          )
          if ('error' in ins) throw new Error(`Database not initialized: ${msg}`)
        } else {
          throw new Error(msg)
        }
      }
      const id = newId
      
      // Read back full row for mapping
      const one = await db.query<DbReservationRow>(
        `select r.id, r.guest_id, g.full_name, r.check_in_date, r.check_out_date, r.${statusCol} as status, r.source,
                r.id_document_enc, r.id_document_type, r.nationality_code, r.nationality_name,
                r.booking_source, r.partner_code, r.utm_source, r.utm_medium, r.utm_campaign, r.utm_term, r.utm_content,
                r.terms_accepted, r.confirmed_at, r.signature_encrypted, r.payment_info_source, r.payment_verified,
                r.package_code
           from reservations r join guests g on g.id = r.guest_id
          where r.id = ?`,
        [id]
      )
      if ('error' in one) throw new Error(one.error)
      const final = toReservation(one.rows[0])
      // console.log('[pmsDb] Created reservation:', final)
      return final
    } catch (e) {
      console.error('[pmsDb] createReservation failed:', e)
      throw e
    }
  },

  async updateReservation(id: string, patch: Partial<Omit<Reservation, 'id'>>): Promise<Reservation> {
    const statusCol = await resolveStatusColumn()
    const fields: string[] = []
    const values: any[] = []
    const push = (expr: string, val: any) => { fields.push(expr); values.push(val) }
    
    if (patch.checkIn !== undefined) push(`check_in_date = ?`, patch.checkIn)
    if (patch.checkOut !== undefined) push(`check_out_date = ?`, patch.checkOut)
    if (patch.status !== undefined) push(`${statusCol} = ?`, statusToDb(patch.status))
    if (patch.originRegion !== undefined) push(`source = ?`, patch.originRegion)
    if (patch.idDocumentNumberEncrypted !== undefined) push(`id_document_enc = ?`, patch.idDocumentNumberEncrypted)
    if (patch.idDocumentType !== undefined) push(`id_document_type = ?`, patch.idDocumentType)
    if (patch.nationalityCode !== undefined) push(`nationality_code = ?`, patch.nationalityCode)
    if (patch.nationalityName !== undefined) push(`nationality_name = ?`, patch.nationalityName)
    if (patch.bookingSource !== undefined) push(`booking_source = ?`, patch.bookingSource)
    if (patch.partnerCode !== undefined) push(`partner_code = ?`, patch.partnerCode)
    if (patch.utmSource !== undefined) push(`utm_source = ?`, patch.utmSource)
    if (patch.utmMedium !== undefined) push(`utm_medium = ?`, patch.utmMedium)
    if (patch.utmCampaign !== undefined) push(`utm_campaign = ?`, patch.utmCampaign)
    if (patch.utmTerm !== undefined) push(`utm_term = ?`, patch.utmTerm)
    if (patch.utmContent !== undefined) push(`utm_content = ?`, patch.utmContent)
    if (patch.termsAccepted !== undefined) push(`terms_accepted = ?`, !!patch.termsAccepted)
    if (patch.confirmedAt !== undefined) push(`confirmed_at = ?`, patch.confirmedAt)
    if (patch.signatureEncrypted !== undefined) push(`signature_encrypted = ?`, patch.signatureEncrypted)
    if ((patch as any).paymentInfoSource !== undefined) push(`payment_info_source = ?`, (patch as any).paymentInfoSource)
    if ((patch as any).paymentVerified !== undefined) push(`payment_verified = ?`, (patch as any).paymentVerified)
    if (patch.packageCode !== undefined) push(`package_code = ?`, patch.packageCode)
    
    if (!fields.length) {
      // Nothing to update; return the row
      const one = await db.query<DbReservationRow>(
        `select r.id, r.guest_id, g.full_name, r.check_in_date, r.check_out_date, r.${statusCol} as status, r.source,
                r.id_document_enc, r.id_document_type, r.nationality_code, r.nationality_name,
                r.booking_source, r.partner_code, r.utm_source, r.utm_medium, r.utm_campaign, r.utm_term, r.utm_content,
                r.terms_accepted, r.confirmed_at, r.signature_encrypted, r.payment_info_source, r.payment_verified,
                r.package_code
           from reservations r join guests g on g.id = r.guest_id
          where r.id = ?`, [id])
      if ('error' in one) throw new Error(one.error)
      return toReservation(one.rows[0])
    }
    
    const sql = `update reservations set ${fields.join(', ')} where id = ?`
    values.push(id)
    const upd = await db.query(sql, values)
    if ('error' in upd) throw new Error(upd.error)
    
    const one = await db.query<DbReservationRow>(
      `select r.id, r.guest_id, g.full_name, r.check_in_date, r.check_out_date, r.${statusCol} as status, r.source,
              r.id_document_enc, r.id_document_type, r.nationality_code, r.nationality_name,
              r.booking_source, r.partner_code, r.utm_source, r.utm_medium, r.utm_campaign, r.utm_term, r.utm_content,
              r.terms_accepted, r.confirmed_at, r.signature_encrypted, r.payment_info_source, r.payment_verified,
              r.package_code
         from reservations r join guests g on g.id = r.guest_id
        where r.id = ?`, [id])
    if ('error' in one) throw new Error(one.error)
    return toReservation(one.rows[0])
  }
}

export default pmsDb
