import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import { FrontOffice } from '../FrontOffice'

vi.mock('../../../context/DataContext', () => ({
  useData: vi.fn(() => ({
    rooms: undefined,
    reservations: undefined,
    guests: undefined,
    folioCharges: undefined,
    checkInGuest: undefined,
    checkOutGuest: undefined,
    addFolioCharge: undefined,
    updateRoomStatus: undefined,
    dataError: null,
  }))
}))

describe('FrontOffice resilience', () => {
  it('renders without crashing when context arrays are undefined', async () => {
    render(<FrontOffice />)
    // Use getAllByRole to avoid ambiguity and strict checks
    const headings = screen.getAllByRole('heading', { name: /Front Office/i })
    expect(headings[0]).toBeInTheDocument()
    
    expect(screen.getAllByText(/In House \(0\)/i)[0]).toBeInTheDocument()
    
    const arrivalTabs = screen.getAllByText(/Arrivals \(0\)/i)
    expect(arrivalTabs[0]).toBeInTheDocument()
    
    const departedTabs = screen.getAllByText(/Departed \(0\)/i)
    expect(departedTabs[0]).toBeInTheDocument()
  })

  it('handles null context by falling back to safe defaults', async () => {
    const mocked = await import('@/context/DataContext')
    vi.mocked((mocked as any).useData).mockImplementation(() => null as any)
    render(<FrontOffice />)
    const headings = screen.getAllByRole('heading', { name: /Front Office/i })
    expect(headings[0]).toBeInTheDocument()
    
    const arrivalTabs = screen.getAllByText(/Arrivals \(0\)/i)
    expect(arrivalTabs[0]).toBeInTheDocument()
  })

  it('logs a warning when required arrays are missing', async () => {
    const tracker = await import('../../../lib/errorTracker')
    const spy = vi.spyOn(tracker.errorTracker, 'log')
    render(<FrontOffice />)
    expect(spy).toHaveBeenCalled()
    const calls = spy.mock.calls.map(c => String(c[0]))
    expect(calls.some(msg => msg.includes('FrontOffice: missing or invalid data arrays'))).toBe(true)
  })
})
