import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import AccountStatement from '../AccountStatement'
import { Guest } from '@/types'
import { Folio } from '@/types/folio'

vi.mock('@/lib/documentUtils', () => ({
  generatePDF: vi.fn(async () => new Blob(['pdf'], { type: 'application/pdf' })),
  generateDOCX: vi.fn(async () => new Blob(['docx'], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })),
  generateXLSX: vi.fn(async () => new Blob(['xlsx'], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
}))

vi.mock('@/lib/posIntegration', () => {
  const printDocument = vi.fn(() => {})
  return { printDocument }
})
import { printDocument } from '@/lib/posIntegration'

vi.mock('@/lib/printSettings', () => ({
  readReceiptBranding: vi.fn(() => ({ restaurant_name: 'Test Hotel', show_logo: false })),
  applySettingsToHTML: vi.fn((t: string, h: string) => `<html><head><title>${t}</title></head><body>${h}</body></html>`),
  readPrintSettings: vi.fn(() => ({ margins: { top: 10, right: 10, bottom: 12, left: 10 }, paperSize: 'A4', orientation: 'portrait', headerText: '', footerText: '', quality: 'normal' })),
  writePrintSettings: vi.fn((patch: any) => ({ margins: { top: 10, right: 10, bottom: 12, left: 10 }, paperSize: 'A4', orientation: patch.orientation || 'portrait', headerText: patch.headerText || '', footerText: patch.footerText || '', quality: 'normal' }))
}))

const sampleGuest: Guest = { id: 'g1', name: 'Jane Roe', email: '', phone: '', roomNumber: '102', checkIn: '2024-02-01', checkOut: '2024-02-03', folioBalance: 0 }
const sampleFolio: Folio = { id: 'folio-2', guestId: 'g1', roomNumber: '102', createdAt: new Date(), updatedAt: new Date(), balance: 0, status: 'open', transactions: [{ id: 't1', folioId: 'folio-2', amount: 50, description: 'Mini bar', date: new Date(), type: 'charge', createdBy: 'staff', authorizationLevel: 'staff' }] }

describe('AccountStatement', () => {
  beforeEach(() => { localStorage.clear(); vi.clearAllMocks() })

  it('opens export modal and exports with selected range', async () => {
    const { container } = render(<AccountStatement folio={sampleFolio} guests={[sampleGuest]} />)
    const exportBtn = screen.getByRole('button', { name: /Export PDF/i })
    fireEvent.click(exportBtn)
    ;(URL as any).createObjectURL = vi.fn(() => 'blob:test')
    ;(URL as any).revokeObjectURL = vi.fn(() => {})
    ;(HTMLAnchorElement.prototype as any).click = vi.fn(() => {})
    const submit = await screen.findByRole('button', { name: /Export/i })
    fireEvent.click(submit)
    await waitFor(() => expect((URL as any).createObjectURL).toHaveBeenCalled())
  })

  it('opens print modal and prints statement', async () => {
    const { container } = render(<AccountStatement folio={sampleFolio} guests={[sampleGuest]} />)
    const printBtn = screen.getByRole('button', { name: /Print Statement/i })
    fireEvent.click(printBtn)
    const previewBtn = await screen.findByRole('button', { name: /Preview/i })
    fireEvent.click(previewBtn)
    const iframe = await screen.findByTitle('statement-preview')
    expect(iframe).toBeDefined()
    const finalPrint = await screen.findByRole('button', { name: /^Print$/i })
    fireEvent.click(finalPrint)
    expect(printDocument).toHaveBeenCalled()
  })
})
