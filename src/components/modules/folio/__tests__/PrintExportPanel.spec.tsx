import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import PrintExportPanel from '../PrintExportPanel'
import { Guest, Room } from '@/types'
import { Folio } from '@/types/folio'

vi.mock('@/lib/documentUtils', () => {
  const generatePDF = vi.fn(async () => new Blob(['pdf'], { type: 'application/pdf' }))
  const generateDOCX = vi.fn(async () => new Blob(['docx'], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }))
  const generateXLSX = vi.fn(async () => new Blob(['xlsx'], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const printFolio = vi.fn(async () => true)
  const downloadBlob = vi.fn(() => {})
  const generateFolioContent = vi.fn(() => 'content')
  return { generatePDF, generateDOCX, generateXLSX, printFolio, downloadBlob, generateFolioContent }
})
import { printFolio, downloadBlob, generatePDF } from '@/lib/documentUtils'

const sampleGuest: Guest = { id: 'g1', name: 'John Doe', email: '', phone: '', roomNumber: '101', checkIn: '2024-01-01', checkOut: '2024-01-05', folioBalance: 0 }
const sampleRoom: Room = { id: 'R101', number: '101', type: 'Standard Single', status: 'VC', floor: 1, rate: 85, guestId: 'g1' }
const sampleFolio: Folio = { id: 'folio-1', guestId: 'g1', roomNumber: '101', createdAt: new Date(), updatedAt: new Date(), balance: 0, status: 'open', transactions: [{ id: 't1', folioId: 'folio-1', amount: 100, description: 'Room', date: new Date(), type: 'charge', createdBy: 'staff', authorizationLevel: 'staff' }] }

describe('PrintExportPanel', () => {
  beforeEach(() => { localStorage.clear() })

  it('prints folio from print tab without crashing', async () => {
    render(<PrintExportPanel folio={sampleFolio} availableFolios={[sampleFolio]} guests={[sampleGuest]} rooms={[sampleRoom]} />)
    const printBtn = await screen.findByRole('button', { name: /Print Folio/i })
    fireEvent.click(printBtn)
    expect(printFolio).toHaveBeenCalled()
  })
})
