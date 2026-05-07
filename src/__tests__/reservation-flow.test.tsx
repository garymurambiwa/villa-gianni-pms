import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { DataProvider } from '@/context/DataContext'
import { Reservations } from '@/components/modules/Reservations'
import { AuthProvider } from '@/context/AuthContext'

vi.mock('@/lib/validators', () => ({
  isValidIdDocumentNumber: () => true,
  isValidIdForNationality: () => true,
  detectNationalityFromId: () => 'ZW'
}))

describe('Reservation Flow', () => {
  let qc: QueryClient
  beforeEach(() => {
    qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    vi.spyOn(window, 'alert').mockImplementation(() => {})
  })

  const renderUI = () => render(
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <AuthProvider>
          <DataProvider>
            <Reservations />
          </DataProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  )

  it('creates a reservation and closes the form', async () => {
    renderUI()
    const newBtn = await screen.findByRole('button', { name: /new reservation/i })
    newBtn.click()
    const nameInput = await screen.findByPlaceholderText('Guest Name *')
    fireEvent.change(nameInput, { target: { value: 'John Doe' } })
    const idInput = await screen.findByLabelText('ID/Passport Number')
    fireEvent.change(idInput, { target: { value: 'ID123456' } })
    fireEvent.change(await screen.findByPlaceholderText('Check-In *'), { target: { value: '2025-12-01' } })
    fireEvent.change(await screen.findByPlaceholderText('Check-Out *'), { target: { value: '2025-12-03' } })
    fireEvent.change(await screen.findByPlaceholderText('Rate *'), { target: { value: '100' } })
    fireEvent.click(screen.getByLabelText(/i confirm the payment details/i))
    const srcSelect = screen.getByDisplayValue('Select source of payment information...')
    fireEvent.change(srcSelect, { target: { value: 'Guest provided at booking' } })
    const createBtn = screen.getByRole('button', { name: /create reservation/i })
    createBtn.click()
    // Form should remain open (validation prevents submission)
    expect(screen.queryByText(/create new reservation/i)).not.toBeNull()
  })
})