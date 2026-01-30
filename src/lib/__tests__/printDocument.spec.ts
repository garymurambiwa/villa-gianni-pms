import { describe, it, expect, vi, beforeEach } from 'vitest'
import { printDocument } from '../posIntegration'
import { writePrintSettings } from '../printSettings'

const createStubWindow = () => {
  const listeners: Record<string, Function[]> = {}
  return {
    document: {
      open: vi.fn(),
      write: vi.fn(),
      close: vi.fn(),
    },
    focus: vi.fn(),
    print: vi.fn(),
    close: vi.fn(),
    addEventListener: vi.fn((evt: string, cb: Function) => {
      listeners[evt] = listeners[evt] || []
      listeners[evt].push(cb)
      cb()
    }),
  } as unknown as Window
}

describe('printDocument', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('prints basic text content', () => {
    const stub = createStubWindow()
    vi.spyOn(window, 'open').mockReturnValue(stub)
    printDocument('Hello World', 'Document', true)
    expect(stub.document.open).toHaveBeenCalled()
    expect(stub.document.write).toHaveBeenCalled()
    expect(stub.print).toHaveBeenCalled()
  })

  it('prints complex layouts with images and styling', () => {
    const stub = createStubWindow()
    vi.spyOn(window, 'open').mockReturnValue(stub)
    const html = `<div><img src="https://example.com/logo.png" alt="Logo"/><style>.bold{font-weight:bold}</style><p class="bold">Test</p></div>`
    printDocument(html, 'Complex', true)
    const arg = (stub.document.write as any).mock.calls[0][0] as string
    expect(arg).toContain('<title>Complex</title>')
    expect(arg).toContain('--brand-color: #0073e6')
    expect(stub.print).toHaveBeenCalled()
  })

  it('handles empty content without errors', () => {
    const stub = createStubWindow()
    vi.spyOn(window, 'open').mockReturnValue(stub)
    printDocument('', 'Empty', true)
    expect(stub.document.write).toHaveBeenCalled()
    expect(stub.print).toHaveBeenCalled()
  })

  it('handles very long content', () => {
    const stub = createStubWindow()
    vi.spyOn(window, 'open').mockReturnValue(stub)
    const long = '<div>' + 'x'.repeat(100000) + '</div>'
    printDocument(long, 'Long', true)
    expect(stub.document.write).toHaveBeenCalled()
    expect(stub.print).toHaveBeenCalled()
  })

  it('applies different print settings (landscape orientation)', () => {
    const stub = createStubWindow()
    vi.spyOn(window, 'open').mockReturnValue(stub)
    writePrintSettings({ orientation: 'landscape' })
    printDocument('<div>Content</div>', 'Landscape', true)
    const arg = (stub.document.write as any).mock.calls[0][0] as string
    expect(arg).toContain('size: landscape')
  })

  it('alerts when popups are blocked', () => {
    vi.spyOn(window, 'open').mockReturnValue(null as any)
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
    printDocument('<div>Test</div>', 'PopupBlocked', true)
    expect(alertSpy).toHaveBeenCalled()
  })

  it('prints li with basic text content', () => {
    const stub = createStubWindow()
    vi.spyOn(window, 'open').mockReturnValue(stub)
    const html = `<ul><li>Item One</li><li>Item Two</li></ul>`
    printDocument(html, 'ListBasic', true)
    const arg = (stub.document.write as any).mock.calls[0][0] as string
    expect(arg).toContain('<li>Item One</li>')
    expect(arg).toContain('<li>Item Two</li>')
    expect(stub.print).toHaveBeenCalled()
  })

  it('prints li with complex layout including image and styling', () => {
    const stub = createStubWindow()
    vi.spyOn(window, 'open').mockReturnValue(stub)
    const html = `<ul><li><img src="https://example.com/pic.png" alt="Pic"/><span style="font-weight:bold;color:#333">Styled</span></li></ul>`
    printDocument(html, 'ListComplex', true)
    const arg = (stub.document.write as any).mock.calls[0][0] as string
    expect(arg).toContain('<img src="https://example.com/pic.png"')
    expect(arg).toContain('<span style="font-weight:bold;color:#333">Styled</span>')
    expect(stub.print).toHaveBeenCalled()
  })

  it('prints li for edge cases: empty and max length content', () => {
    const stub = createStubWindow()
    vi.spyOn(window, 'open').mockReturnValue(stub)
    const empty = `<ul><li></li></ul>`
    printDocument(empty, 'ListEmpty', true)
    const longText = 'x'.repeat(50000)
    const long = `<ul><li>${longText}</li></ul>`
    printDocument(long, 'ListLong', true)
    expect(stub.document.write).toHaveBeenCalled()
    expect(stub.print).toHaveBeenCalled()
  })

  it('prints li respecting print settings for margins and orientation', () => {
    const stub = createStubWindow()
    vi.spyOn(window, 'open').mockReturnValue(stub)
    writePrintSettings({ orientation: 'portrait', margins: { top: 12, right: 8, bottom: 12, left: 8 } })
    const html = `<ul><li>MarginsCheck</li></ul>`
    printDocument(html, 'ListSettings', true)
    const arg = (stub.document.write as any).mock.calls[0][0] as string
    expect(arg).toContain('@page { size: 210mm 297mm; margin: 12mm 8mm 12mm 8mm; }')
    expect(stub.print).toHaveBeenCalled()
  })
})
