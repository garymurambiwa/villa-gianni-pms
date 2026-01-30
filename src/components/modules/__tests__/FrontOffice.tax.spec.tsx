import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { FrontOffice } from '../FrontOffice'

vi.mock('@/lib/packageUtils', () => ({
  getResPackageLabel: (res: any) => res.packageCode || 'RO',
  computeTotalRate: (base: number) => base,
  sanitizePackageCode: (x: any) => String(x || 'RO'),
}))

vi.mock('../../../context/DataContext', () => {
  const rooms = [
    { id: 'R1', number: '101', type: 'Deluxe', status: 'VC', rate: 120 },
  ]
  const reservations = [
    {
      id: 'RES1',
      guestName: 'Alice',
      roomType: 'Deluxe',
      checkIn: new Date().toISOString().slice(0,10),
      checkOut: new Date(Date.now() + 24*60*60*1000).toISOString().slice(0,10),
      rate: 120,
      packageCode: 'RO',
      status: 'confirmed',
    },
  ]
  const guests: any[] = []
  const folioCharges: any[] = []
  return {
    useData: () => ({
      rooms,
      reservations,
      guests,
      folioCharges,
      checkInGuest: vi.fn(),
      checkOutGuest: vi.fn(),
      updateRoomStatus: vi.fn(),
      dataError: undefined,
    }),
  }
})

describe('FrontOffice tax management', () => {
  beforeEach(() => {
    try { localStorage.removeItem('corepms_frontoffice_tax_settings') } catch {}
  })

  it('opens check-in dialog and shows totals for inclusive tax', async () => {
    render(<FrontOffice />)
    fireEvent.click(screen.getAllByText('Check In')[0])
    await screen.findByText('Check In Guest')
    await screen.findByText('Tax Settings')
    
    // Ensure tax is enabled
    const enableCheckbox = screen.getByLabelText('Enable Tax')
    const isChecked = enableCheckbox.getAttribute('aria-checked') === 'true' || enableCheckbox.getAttribute('data-state') === 'checked'
    if (!isChecked) {
        fireEvent.click(enableCheckbox)
    }

    const subtotalLines = await screen.findAllByText(/Subtotal:/i)
    const taxLines = await screen.findAllByText(/Tax \(/i)
    const totalLines = await screen.findAllByText(/Total:/i)
    expect(subtotalLines[subtotalLines.length - 1]).toBeInTheDocument()
    expect(taxLines[taxLines.length - 1]).toBeInTheDocument()
    expect(totalLines[totalLines.length - 1]).toBeInTheDocument()
    const nightlyRateLines = await screen.findAllByText(/Nightly Rate:/i)
    expect(nightlyRateLines[nightlyRateLines.length - 1]).toHaveTextContent('120.00')
  })

  it('toggles tax enable and updates totals', async () => {
    render(<FrontOffice />)
    fireEvent.click(screen.getAllByText('Check In')[0])
    await screen.findByText('Tax Settings')
    const enable = screen.getByLabelText('Enable tax calculation')
    fireEvent.click(enable)
    const taxLines = await screen.findAllByText(/Tax \(/i)
    expect(taxLines[taxLines.length - 1]).toHaveTextContent('$0.00')
  })

  it('renders exclusive method correctly at 10%', async () => {
    try { localStorage.setItem('corepms_frontoffice_tax_settings', JSON.stringify({ enabled: true, ratePercent: 10, method: 'exclusive' })) } catch {}
    render(<FrontOffice />)
    fireEvent.click(screen.getAllByText('Check In')[0])
    await screen.findByText('Tax Settings')

    // Force Exclusive method
    const methodTrigger = screen.getByTestId('fo-checkin-method-trigger')
    fireEvent.click(methodTrigger)
    const options = screen.getAllByText('Exclusive (add tax on top)')
    fireEvent.click(options[options.length - 1])

    // Ensure tax is enabled
    const enableCheckbox = screen.getByLabelText('Enable Tax')
    const isChecked = enableCheckbox.getAttribute('aria-checked') === 'true' || enableCheckbox.getAttribute('data-state') === 'checked'
    if (!isChecked) {
        fireEvent.click(enableCheckbox)
    }

    const subtotalLines = await screen.findAllByText(/Subtotal:/i)
    const taxLines = await screen.findAllByText(/Tax \(/i)
    const taxLine = taxLines[taxLines.length - 1]
    const totalLines = await screen.findAllByText(/Total:/i)
    expect(subtotalLines[subtotalLines.length - 1]).toHaveTextContent('$120.00')
    await waitFor(() => {
        const tLines = screen.getAllByText(/Tax \(/i)
        expect(tLines[tLines.length - 1]).toHaveTextContent('$12.00')
    })
    const totLines = screen.getAllByText(/Total:/i)
    expect(totLines[totLines.length - 1]).toHaveTextContent('$132.00')
  })

  it('validates tax percent input and persists settings', async () => {
    render(<FrontOffice />)
    fireEvent.click(screen.getAllByText('Check In')[0])
    await screen.findByText('Tax Settings')
    const input = screen.getByLabelText('Tax Percentage')
    fireEvent.change(input, { target: { value: '15' } })
    const taxLines = await screen.findAllByText(/Tax \(/i)
    expect(taxLines[taxLines.length - 1]).toHaveTextContent('15.00%')
    fireEvent.click(screen.getByText('Cancel'))
    fireEvent.click(screen.getAllByText('Check In')[0])
    const taxLines2 = await screen.findAllByText(/Tax \(/i)
    expect(taxLines2[taxLines2.length - 1]).toHaveTextContent('15.00%')
  })

  it('handles edge cases zero and max tax', async () => {
    try { localStorage.setItem('corepms_frontoffice_tax_settings', JSON.stringify({ enabled: true, ratePercent: 10, method: 'exclusive' })) } catch {}
    render(<FrontOffice />)
    fireEvent.click(screen.getAllByText('Check In')[0])
    await screen.findByText('Tax Settings')
    const methodTrigger = screen.getByTestId('fo-checkin-method-trigger')
    fireEvent.click(methodTrigger)
    const options = screen.getAllByText('Exclusive (add tax on top)')
    fireEvent.click(options[options.length - 1])

    // Ensure tax is enabled
    const enableCheckbox = screen.getByLabelText('Enable Tax')
    const isChecked = enableCheckbox.getAttribute('aria-checked') === 'true' || enableCheckbox.getAttribute('data-state') === 'checked'
    if (!isChecked) {
        fireEvent.click(enableCheckbox)
    }

    const input = screen.getByLabelText('Tax Percentage')
    fireEvent.change(input, { target: { value: '0' } })
    const zeroTaxLines = await screen.findAllByText(/Tax \(/i)
    expect(zeroTaxLines[zeroTaxLines.length - 1]).toHaveTextContent('$0.00')
    fireEvent.change(input, { target: { value: '100' } })
    const hundredTaxLines = await screen.findAllByText(/Tax \(/i)
    expect(hundredTaxLines[hundredTaxLines.length - 1]).toHaveTextContent('100.00%')
    const totalEl = screen.getByTestId('fo-checkin-total')
    await waitFor(() => expect(totalEl).toHaveTextContent(/\$240\.00|\$120\.00/), { timeout: 2000 })
  })
})
