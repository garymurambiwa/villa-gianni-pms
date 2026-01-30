import db from '@/lib/db'

type Summary = { count: number; total: number; byMethod: Record<string, number> }

export const getTransactionSummary = async (): Promise<Summary> => {
  const res = await db.query<{ count: number; total: number }>(
    `select count(*) as count, coalesce(sum(total),0) as total
       from orders
      where status <> 'void'`
  )
  if ('error' in res) return { count: 0, total: 0, byMethod: { cash: 0, card: 0, 'room-charge': 0 } }
  const count = Number(res.rows[0]?.count || 0)
  const totalNum = Number(res.rows[0]?.total || 0)
  return { count, total: Number(totalNum.toFixed(2)), byMethod: { cash: 0, card: 0, 'room-charge': 0 } }
}

export const clearAllTransactions = async (): Promise<{ removedCount: number; removedTotal: number; affectedShifts: string[] }> => {
  const toArchive = await db.query<{ id: string; total: number }>(
    `select id, total from orders where status <> 'void'`
  )
  if ('error' in toArchive) return { removedCount: 0, removedTotal: 0, affectedShifts: [] }
  const removedCount = toArchive.rows.length
  const removedTotal = Number(toArchive.rows.reduce((s, r) => s + Number(r.total || 0), 0).toFixed(2))
  const upd = await db.query(`update orders set status = 'void' where status <> 'void'`)
  if ('error' in upd) return { removedCount: 0, removedTotal: 0, affectedShifts: [] }
  return { removedCount, removedTotal, affectedShifts: [] }
}

export default { getTransactionSummary, clearAllTransactions }
