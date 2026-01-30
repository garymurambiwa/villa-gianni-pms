import { describe, it, expect } from 'vitest'
import { Folio, Transaction } from '@/types/folio'
import { filterTransferable, computeFolioToFolioUpdate, computeFolioToLedgerUpdate } from '@/lib/folioTransfer'

const mkTxn = (id: string, type: Transaction['type'], amount: number, extra?: Partial<Transaction>): Transaction => ({
  id,
  folioId: 'folio-1',
  amount,
  description: `${type} ${amount}`,
  date: new Date(),
  type,
  createdBy: 'tester',
  authorizationLevel: 'staff',
  ...extra,
})

describe('folioTransfer helpers', () => {
  it('filters only non-voided positive charge transactions', () => {
    const txns: Transaction[] = [
      mkTxn('c1', 'charge', 100),
      mkTxn('c2', 'charge', -5),
      mkTxn('p1', 'payment', -50),
      mkTxn('a1', 'adjustment', 10),
      mkTxn('c3', 'charge', 20, { voidedBy: 'user' }),
    ]
    const result = filterTransferable(txns)
    expect(result.map(t => t.id)).toEqual(['c1'])
  })

  it('computes folio-to-folio updates and balances correctly', () => {
    const source: Folio = {
      id: 'folio-1', guestId: 'g1', roomNumber: '101', createdAt: new Date(), updatedAt: new Date(), balance: 150, status: 'open',
      transactions: [mkTxn('c1', 'charge', 100), mkTxn('c2', 'charge', 50), mkTxn('p1', 'payment', -20)],
    }
    const target: Folio = {
      id: 'folio-2', guestId: 'g2', roomNumber: '102', createdAt: new Date(), updatedAt: new Date(), balance: 0, status: 'open',
      transactions: [],
    }
    const { updatedSource, updatedTarget, amountDelta } = computeFolioToFolioUpdate(source, target, ['c1', 'c2'])
    expect(amountDelta).toBe(150)
    expect(updatedSource.balance).toBe(0)
    expect(updatedTarget.balance).toBe(150)
    expect(updatedSource.transactions.some(t => t.id === 'c1')).toBe(false)
    expect(updatedSource.transactions.some(t => t.id === 'c2')).toBe(false)
    expect(updatedTarget.transactions.some(t => t.id === 'c1')).toBe(true)
    expect(updatedTarget.transactions.some(t => t.id === 'c2')).toBe(true)
  })

  it('computes folio-to-ledger updates and removes charges from source', () => {
    const source: Folio = {
      id: 'folio-1', guestId: 'g1', roomNumber: '101', createdAt: new Date(), updatedAt: new Date(), balance: 200, status: 'open',
      transactions: [mkTxn('c1', 'charge', 100), mkTxn('c2', 'charge', 100)],
    }
    const { updatedSource, amountDelta } = computeFolioToLedgerUpdate(source, ['c1'], 'cl:ACC1')
    expect(amountDelta).toBe(100)
    expect(updatedSource.balance).toBe(100)
    expect(updatedSource.transactions.some(t => t.id === 'c1')).toBe(false)
    expect(updatedSource.transactions.some(t => t.id === 'c2')).toBe(true)
    // Audit entry added
    expect(updatedSource.transactions.some(t => t.type === 'transfer')).toBe(true)
  })
})

