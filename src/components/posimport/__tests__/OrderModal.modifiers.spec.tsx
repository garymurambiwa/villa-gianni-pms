import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import { OrderModal } from '../../posimport/OrderModal'

vi.mock('@/components/ui/button', () => ({
  Button: (props: any) => React.createElement('button', { ...props })
}))
vi.mock('@/lib/posIntegration', () => ({
  formatCurrency: (n: number) => `$${n.toFixed(2)}`,
  getMenuItemsFromPOSStore: () => []
}))
vi.mock('@/lib/menuCategories', () => ({
  default: {
    listCategories: () => [],
    listSubTreeByCategory: () => [],
    getCategoryById: () => null,
  }
}))
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: () => {} })
}))

const sampleMenu = [
  { id: 'i1', name: 'Grilled Steak', price: 12.5, category: 'food', image: '', description: 'Juicy steak' },
] as any

describe.skip('OrderModal modifiers', () => {
  it('captures preparation level and manual notes per item', () => {
    const onSave = vi.fn()
    render(
      <OrderModal
        tableNumber={1}
        bill={null}
        onClose={() => {}}
        onSave={onSave}
        menuItems={sampleMenu}
      />
    )

    // Click menu item to add
    fireEvent.click(screen.getByText('Grilled Steak'))

    // Select preparation level Medium
    const mediumBtn = screen.getByRole('button', { name: /medium/i })
    fireEvent.click(mediumBtn)

    // Add notes
    const notesArea = screen.getByPlaceholderText(/extra side of chips/i)
    fireEvent.change(notesArea, { target: { value: 'No onions; sauce on side' } })

    // Expect modifiers displayed beneath name
    expect(screen.getByText('(Medium)')).toBeInTheDocument()
    expect(screen.getByText('No onions; sauce on side')).toBeInTheDocument()

    // Save order and ensure fields persisted
    fireEvent.click(screen.getByRole('button', { name: /save order/i }))
    expect(onSave).toHaveBeenCalled()
    const arg = onSave.mock.calls[0][0]
    const item = arg.items[0]
    expect(item.preparation_level).toBe('medium')
    expect(item.manual_notes).toBe('No onions; sauce on side')
  })
})
