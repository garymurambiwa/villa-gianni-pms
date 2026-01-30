import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'U1', username: 'admin', role: 'admin', active: true } })
}))

vi.mock('@/lib/db', () => ({
  db: { isConfigured: vi.fn().mockResolvedValue(false), query: vi.fn() }
}))

vi.mock('@/components/ui/button', () => ({ Button: (p: any) => <button {...p} /> }))
vi.mock('@/components/ui/input', () => ({ Input: (p: any) => <input {...p} /> }))
vi.mock('@/components/ui/textarea', () => ({ Textarea: (p: any) => <textarea {...p} /> }))
vi.mock('@/components/ui/select', () => ({
  Select: (p: any) => <div {...p} />,
  SelectTrigger: (p: any) => <div {...p} />,
  SelectValue: (p: any) => <div {...p} />,
  SelectContent: (p: any) => <div {...p} />,
  SelectItem: (p: any) => <div {...p} />
}))
vi.mock('@/components/ui/dialog', () => ({
  Dialog: (p: any) => <div {...p} />,
  DialogContent: (p: any) => <div {...p} />,
  DialogHeader: (p: any) => <div {...p} />,
  DialogTitle: (p: any) => <div {...p} />,
  DialogFooter: (p: any) => <div {...p} />
}))
vi.mock('@/components/ui/checkbox', () => ({ Checkbox: (p: any) => <input type="checkbox" {...p} /> }))
vi.mock('@/components/ui/tabs', () => ({ Tabs: (p: any) => <div {...p} />, TabsList: (p: any) => <div {...p} />, TabsTrigger: (p: any) => <button {...p} /> }))
vi.mock('@/components/ui/HorizontalScrollNav', () => ({ default: (p: any) => <div {...p} /> }))
vi.mock('@/components/ui/label', () => ({ Label: (p: any) => <label {...p} /> }))
vi.mock('@/components/modules/InventoryItemsButton', () => ({ default: (p: any) => <div {...p} /> }))
vi.mock('@/components/modules/ReceiptSettingsModal', () => ({ default: (p: any) => <div {...p} /> }))
vi.mock('@/components/modules/StockTab', () => ({ default: (p: any) => <div {...p} /> }))
vi.mock('@/components/modules/CocktailEngineering', () => ({ default: (p: any) => <div {...p} /> }))
vi.mock('@/contexts/HotkeysContext', () => ({ useHotkeys: () => ({ register: () => {}, unregister: () => {} }) }))
vi.mock('@/lib/menuCategories', () => ({ default: { listCategories: () => [], listSubTreeByCategory: () => [], getCategoryById: () => null } }))
vi.mock('@/lib/permissions', () => ({ canManagePOS: () => true, canEditStockItem: () => true, canFixStockItem: () => true, canDeleteStockItem: () => true, canImportStockCSV: () => true, canExportIssuesCSV: () => true, canExportStockCSV: () => true, canDownloadTemplate: () => true }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: () => {} }) }))

describe('POS Settings render', () => {
  it('renders without triggering error boundary', () => {
    return (async () => {
      const ErrorBoundary = (await import('../components/ErrorBoundary')).default
      const { PosSettings } = await import('../components/modules/PosSettings')
      render(
        <ErrorBoundary fallbackTitle="POS Settings Error" fallbackMessage="Please reload or contact support.">
          <PosSettings />
        </ErrorBoundary>
      )
      expect(screen.getByText('POS Back Office Settings')).toBeInTheDocument()
    })()
  })
})
