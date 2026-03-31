import React from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { useAuth } from '@/context/AuthContext'
import { useData } from '@/context/DataContext'
import { db } from '@/lib/db'
import { createAuditEntry, formatCurrency } from '@/lib/posIntegration'
import type { Guest, Reservation } from '@/types'

type Props = {
  open: boolean
  onClose: () => void
  onSelect: (payload: { guest?: Guest | null; reservation?: Reservation | null }) => void
}

type SearchQuery = {
  firstName: string
  lastName: string
  reservationId: string
  phone: string
  email: string
  startDate: string
  endDate: string
}

const PAGE_SIZE = 10

const maskEmail = (e: string) => {
  const [user, domain] = String(e || '').split('@')
  if (!domain) return e
  const u = user.length <= 2 ? user[0] + '*' : user.slice(0, 2) + '*'.repeat(Math.max(1, user.length - 2))
  return `${u}@${domain}`
}

const maskPhone = (p: string) => {
  const s = String(p || '')
  if (s.length < 4) return '*'.repeat(s.length)
  return s.slice(0, 2) + '*'.repeat(Math.max(1, s.length - 4)) + s.slice(-2)
}

export const nameMatches = (full: string, first: string, last: string) => {
  const f = String(full || '').toLowerCase()
  const fn = String(first || '').toLowerCase()
  const ln = String(last || '').toLowerCase()
  if (fn && !f.includes(fn)) return false
  if (ln && !f.includes(ln)) return false
  return true
}

export const GuestLookupModal: React.FC<Props> = ({ open, onClose, onSelect }) => {
  const { user } = useAuth()
  const { guests, reservations } = useData()

  const [query, setQuery] = React.useState<SearchQuery>({ firstName: '', lastName: '', reservationId: '', phone: '', email: '', startDate: '', endDate: '' })
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string>('')
  const [page, setPage] = React.useState(1)
  const [results, setResults] = React.useState<Array<{ guest?: Guest; reservation?: Reservation }>>([])

  const canUse = (() => {
    const r = String(user?.role || '').toLowerCase()
    return ['admin', 'manager', 'supervisor', 'frontdesk', 'cashier', 'auditor'].includes(r)
  })()

  const totalPages = Math.max(1, Math.ceil(results.length / PAGE_SIZE))
  const pageSlice = React.useMemo(() => {
    const start = (page - 1) * PAGE_SIZE
    return results.slice(start, start + PAGE_SIZE)
  }, [results, page])

  const runSearch = React.useCallback(async () => {
    if (!canUse) { setResults([]); setError('Not authorized to perform guest lookups'); return }
    setLoading(true); setError('')
    try {
      const qName = `${query.firstName} ${query.lastName}`.trim()
      const rows: Array<{ guest?: Guest; reservation?: Reservation }> = []

      const hasDb = await db.isConfigured?.()
      if (hasDb) {
        const conds: string[] = []
        const params: any[] = []
        if (qName) { conds.push(`lower(g.full_name::text) like lower(?::text)`); params.push(`%${qName}%`) }
        if (query.reservationId) { conds.push(`r.id = ?`); params.push(query.reservationId) }
        if (query.phone) { conds.push(`g.phone like ?`); params.push(`%${query.phone}%`) }
        if (query.email) { conds.push(`lower(g.email::text) like lower(?::text)`); params.push(`%${query.email}%`) }
        if (query.startDate) { conds.push(`r.check_in_date >= ?`); params.push(query.startDate) }
        if (query.endDate) { conds.push(`r.check_out_date <= ?`); params.push(query.endDate) }
        const where = conds.length ? `where ${conds.join(' and ')}` : ''
        const sql = `select r.id, r.guest_id, g.full_name, g.email, g.phone, r.check_in_date, r.check_out_date, r.status, r.source, r.nationality_name
                      from reservations r join guests g on g.id = r.guest_id ${where}
                      order by r.check_in_date desc limit 200`
        const res = await db.query<any>(sql, params)
        if ('error' in res) throw new Error(res.error)
        res.rows.forEach((row: any) => {
          const guest: Guest = { id: row.guest_id, name: row.full_name, email: row.email || '', phone: row.phone || '', folioBalance: 0 }
          const reservation: Reservation = {
            id: row.id,
            guestName: row.full_name,
            originRegion: String(row.source || ''),
            roomType: '',
            checkIn: row.check_in_date,
            checkOut: row.check_out_date,
            status: String(row.status || 'confirmed') as any,
            rate: 0,
            adults: 1,
            children: 0,
            nationalityName: row.nationality_name || ''
          }
          rows.push({ guest, reservation })
        })
      } else {
        const gs = guests.filter(g => {
          const okName = nameMatches(g.name, query.firstName, query.lastName)
          const okPhone = query.phone ? String(g.phone || '').includes(query.phone) : true
          const okEmail = query.email ? String(g.email || '').toLowerCase().includes(query.email.toLowerCase()) : true
          return okName && okPhone && okEmail
        })
        const toDateStr = (d: any) => {
          try {
            const dt = d instanceof Date ? d : new Date(d)
            return dt.toISOString().slice(0, 10)
          } catch { return '' }
        }
        const rs = reservations.filter(r => {
          const okName = nameMatches(r.guestName, query.firstName, query.lastName)
          const okId = query.reservationId ? String(r.id).toLowerCase() === query.reservationId.toLowerCase() : true
          const okPhone = query.phone ? String((r as any).phone || '').includes(query.phone) : true
          const okEmail = query.email ? String((r as any).email || '').toLowerCase().includes(query.email.toLowerCase()) : true
          const okStart = query.startDate ? toDateStr((r as any).checkIn) >= query.startDate : true
          const okEnd = query.endDate ? toDateStr((r as any).checkOut) <= query.endDate : true
          return okName && okId && okPhone && okEmail && okStart && okEnd
        })
        // Merge by name
        rs.forEach(r => {
          const g = gs.find(g => g.name && r.guestName && g.name.toLowerCase() === r.guestName.toLowerCase())
          rows.push({ guest: g, reservation: r })
        })
        // Include guests without reservations if query matches
        gs.forEach(g => {
          if (!rows.find(x => x.guest?.id === g.id)) rows.push({ guest: g, reservation: null as any })
        })
      }

      setResults(rows)
      setPage(1)
      try {
        const audit = createAuditEntry('GUEST_LOOKUP', 'RESERVATION', query.reservationId || '-', user?.id || 'unknown', { query })
        const raw = localStorage.getItem('corepms_guest_lookup_audit')
        const list = raw ? JSON.parse(raw) : []
        localStorage.setItem('corepms_guest_lookup_audit', JSON.stringify([audit, ...list].slice(0, 500)))
      } catch { }
    } catch (e: any) {
      setError(e?.message || 'Search failed')
    } finally {
      setLoading(false)
    }
  }, [query, guests, reservations, user, canUse])

  React.useEffect(() => {
    const t = setTimeout(() => { runSearch() }, 300)
    return () => clearTimeout(t)
  }, [runSearch])

  const selectRow = (row: { guest?: Guest; reservation?: Reservation }) => {
    onSelect({ guest: row.guest || null, reservation: row.reservation || null })
    onClose()
    try {
      const audit = createAuditEntry('GUEST_SELECTED', 'RESERVATION', row.reservation?.id || '-', user?.id || 'unknown', { guestId: row.guest?.id })
      const raw = localStorage.getItem('corepms_guest_lookup_audit')
      const list = raw ? JSON.parse(raw) : []
      localStorage.setItem('corepms_guest_lookup_audit', JSON.stringify([audit, ...list].slice(0, 500)))
    } catch { }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-[800px] w-[800px] h-[600px] sm:w-[95vw] sm:h-[80vh]">
        <DialogHeader>
          <DialogTitle>Guest Lookup</DialogTitle>
          <DialogDescription>Search by name, reservation ID, or contact information</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">First Name</Label>
            <Input value={query.firstName} onChange={(e) => setQuery(q => ({ ...q, firstName: e.target.value }))} placeholder="First name" aria-label="Guest first name" />
          </div>
          <div>
            <Label className="text-xs">Last Name</Label>
            <Input value={query.lastName} onChange={(e) => setQuery(q => ({ ...q, lastName: e.target.value }))} placeholder="Last name" aria-label="Guest last name" />
          </div>
          <div>
            <Label className="text-xs">Reservation ID</Label>
            <Input value={query.reservationId} onChange={(e) => setQuery(q => ({ ...q, reservationId: e.target.value }))} placeholder="e.g. RES123" aria-label="Reservation ID" />
          </div>
          <div>
            <Label className="text-xs">Phone</Label>
            <Input value={query.phone} onChange={(e) => setQuery(q => ({ ...q, phone: e.target.value }))} placeholder="Phone number" aria-label="Phone number" />
          </div>
          <div>
            <Label className="text-xs">Email</Label>
            <Input value={query.email} onChange={(e) => setQuery(q => ({ ...q, email: e.target.value }))} placeholder="Email address" aria-label="Email address" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Start Date</Label>
              <Input type="date" value={query.startDate} onChange={(e) => setQuery(q => ({ ...q, startDate: e.target.value }))} aria-label="Start date" />
            </div>
            <div>
              <Label className="text-xs">End Date</Label>
              <Input type="date" value={query.endDate} onChange={(e) => setQuery(q => ({ ...q, endDate: e.target.value }))} aria-label="End date" />
            </div>
          </div>
        </div>

        <div className="mt-3 text-xs text-gray-600" aria-live="polite">
          {loading ? 'Searching…' : `${results.length} result${results.length === 1 ? '' : 's'} found`}
        </div>
        {error && <div role="alert" className="text-sm text-red-600">{error}</div>}

        <ScrollArea className="mt-2 h-[360px] rounded border" aria-label="Search results">
          <div className="divide-y">
            {loading && (
              <div className="p-4 flex items-center gap-2"><LoadingSpinner /> <span className="text-sm">Loading…</span></div>
            )}
            {!loading && pageSlice.length === 0 && (
              <div className="p-4 text-sm text-gray-500">No results</div>
            )}
            {!loading && pageSlice.map((row, idx) => (
              <button key={idx} className="w-full text-left p-3 hover:bg-muted/50 focus:bg-muted focus:outline-none" onClick={() => selectRow(row)} aria-label={`Select ${row.reservation?.guestName || row.guest?.name || 'record'}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">{row.reservation?.guestName || row.guest?.name}</div>
                    <div className="text-xs text-gray-600">{maskEmail(row.guest?.email || (row as any).email || '')} • {maskPhone(row.guest?.phone || (row as any).phone || '')}</div>
                  </div>
                  <div className="text-right text-xs">
                    {row.reservation ? (
                      <>
                        <div>Stay: {(() => { try { const d = (row.reservation as any).checkIn; const dt = d instanceof Date ? d : new Date(d); return dt.toISOString().slice(0, 10) } catch { return String((row.reservation as any).checkIn || '') } })()} → {(() => { try { const d = (row.reservation as any).checkOut; const dt = d instanceof Date ? d : new Date(d); return dt.toISOString().slice(0, 10) } catch { return String((row.reservation as any).checkOut || '') } })()}</div>
                        <div>Status: {row.reservation.status}</div>
                      </>
                    ) : (
                      <div className="text-gray-500">No reservation</div>
                    )}
                  </div>
                </div>
                {row.reservation && (
                  <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <div className="text-gray-500">Preferences</div>
                      <div>{(row.reservation as any).roomPreference || '—'}</div>
                    </div>
                    <div>
                      <div className="text-gray-500">Special Requests</div>
                      <div>{(row.reservation as any).specialRequests || '—'}</div>
                    </div>
                    <div>
                      <div className="text-gray-500">Loyalty</div>
                      <div>{(row.reservation as any).loyaltyStatus || '—'}</div>
                    </div>
                  </div>
                )}
              </button>
            ))}
          </div>
        </ScrollArea>

        <div className="mt-3 flex items-center justify-between">
          <div className="text-xs">Page {page} / {totalPages}</div>
          <div className="flex gap-2">
            <Button variant="outline" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>Prev</Button>
            <Button variant="outline" disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>Next</Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default GuestLookupModal
