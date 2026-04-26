import db from '@/lib/db'
import { v4 as uuidv4 } from 'uuid'

export type TaxRecord = {
  id: string
  name: string
  percentage: number
  is_inclusive: boolean
  applies_to: 'all'|'accommodation'|'pos'|'services'
  active: boolean
}

const mapRow = (r: Record<string, unknown>): TaxRecord => ({
  id: String(r.id as string),
  name: String(r.name as string),
  percentage: Number(r.percentage as number),
  is_inclusive: !!(r.is_inclusive as boolean || r.is_inclusive === 1),
  applies_to: String(r.applies_to as string) as 'all'|'accommodation'|'pos'|'services',
  active: !!(r.active as boolean || r.active === 1),
})

export const listTaxes = async (): Promise<TaxRecord[]> => {
  const res = await db.query<TaxRecord>(`SELECT id, name, percentage, is_inclusive, applies_to, active FROM taxes ORDER BY active DESC, name ASC`)
  if ('error' in res) return []
  return (res.rows || []).map(mapRow)
}

export const getActiveTaxes = async (category: 'all'|'accommodation'|'pos'|'services'): Promise<TaxRecord[]> => {
  const res = await db.query<TaxRecord>(`SELECT id, name, percentage, is_inclusive, applies_to, active FROM taxes WHERE active = true AND (applies_to = ? OR applies_to = 'all') ORDER BY name ASC`, [category])
  if ('error' in res) return []
  return (res.rows || []).map(mapRow)
}

export const getTax = async (id: string): Promise<TaxRecord | null> => {
  const res = await db.query<TaxRecord>(`SELECT id, name, percentage, is_inclusive, applies_to, active FROM taxes WHERE id = ?`, [id])
  if ('error' in res || !res.rows || res.rows.length === 0) return null
  return mapRow(res.rows[0])
}

export const createTax = async (payload: { name: string; percentage: number; is_inclusive: boolean; applies_to: 'all'|'accommodation'|'pos'|'services' }): Promise<{ ok: boolean; id?: string; error?: string }> => {
  const id = uuidv4()
  const res = await db.query<{ id: string }>(`INSERT INTO taxes (id, name, percentage, is_inclusive, applies_to, active) VALUES (?, ?, ?, ?, ?, true)`, [id, payload.name, payload.percentage, payload.is_inclusive, payload.applies_to])
  if ('error' in res) return { ok: false, error: res.error }
  return { ok: true, id }
}

export const updateTax = async (id: string, patch: Partial<{ name: string; percentage: number; is_inclusive: boolean; applies_to: 'all'|'accommodation'|'pos'|'services'; active: boolean }>): Promise<{ ok: boolean; error?: string }> => {
  const fields: string[] = []
  const params: Array<string | number | boolean> = []
  if (typeof patch.name === 'string') { fields.push(`name = ?`); params.push(patch.name) }
  if (typeof patch.percentage === 'number') { fields.push(`percentage = ?`); params.push(patch.percentage) }
  if (typeof patch.is_inclusive === 'boolean') { fields.push(`is_inclusive = ?`); params.push(patch.is_inclusive) }
  if (typeof patch.applies_to === 'string') { fields.push(`applies_to = ?`); params.push(patch.applies_to) }
  if (typeof patch.active === 'boolean') { fields.push(`active = ?`); params.push(patch.active) }
  if (!fields.length) return { ok: true }
  params.push(id)
  const sql = `UPDATE taxes SET ${fields.join(', ')} WHERE id = ?`
  const res = await db.query(sql, params)
  if ('error' in res) return { ok: false, error: res.error }
  return { ok: true }
}

export const toggleTaxActive = async (id: string, active: boolean): Promise<{ ok: boolean; error?: string }> => {
  const res = await db.query(`UPDATE taxes SET active = ? WHERE id = ?`, [active, id])
  if ('error' in res) return { ok: false, error: res.error }
  return { ok: true }
}

export const deleteTax = async (id: string): Promise<{ ok: boolean; error?: string }> => {
  const res = await db.query(`DELETE FROM taxes WHERE id = ?`, [id])
  if ('error' in res) return { ok: false, error: res.error }
  return { ok: true }
}

export const calculateTaxesForAmount = async (amount: number, category: 'all'|'accommodation'|'pos'|'services'): Promise<{ subtotal: number; taxTotal: number; total: number; lines: Array<{ id: string; name: string; amount: number; inclusive: boolean }> }> => {
  const taxes = await getActiveTaxes(category)
  const subtotal = Number(amount.toFixed(2))
  let taxTotal = 0
  let exclusiveTaxTotal = 0
  const lines: Array<{ id: string; name: string; amount: number; inclusive: boolean }> = []
  for (const t of taxes) {
    const rate = Number(t.percentage || 0) / 100
    if (t.is_inclusive) {
      const inc = subtotal * (rate / (1 + rate))
      const amt = Number(inc.toFixed(2))
      taxTotal += amt
      lines.push({ id: t.id, name: t.name, amount: amt, inclusive: true })
    } else {
      const exc = subtotal * rate
      const amt = Number(exc.toFixed(2))
      taxTotal += amt
      exclusiveTaxTotal += amt
      lines.push({ id: t.id, name: t.name, amount: amt, inclusive: false })
    }
  }
  const total = Number((subtotal + exclusiveTaxTotal).toFixed(2))
  return { subtotal, taxTotal: Number(taxTotal.toFixed(2)), total, lines }
}

export default { listTaxes, getActiveTaxes, getTax, createTax, updateTax, toggleTaxActive, deleteTax, calculateTaxesForAmount }
