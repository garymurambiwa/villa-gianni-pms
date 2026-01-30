import { describe, it, expect, vi } from 'vitest'

vi.mock('react-router-dom', async (orig) => {
  const actual = await orig()
  return {
    ...actual,
    useNavigate: () => {
      const fn = vi.fn()
      // Expose for assertions
      ;(globalThis as any).__nav = fn
      return fn
    },
  }
})

describe('ModuleAlias POS Settings redirect', () => {
  it('redirects to /?module=pos-settings', async () => {
    const { default: ModuleAlias } = await import('../pages/ModuleAlias')
    // Render component to trigger useEffect navigate call
    const React = await import('react')
    const { render } = await import('@testing-library/react')
    render(React.createElement(ModuleAlias, { module: 'pos-settings' }))
    const nav = (globalThis as any).__nav
    expect(nav).toHaveBeenCalledWith('/?module=pos-settings')
  })
})
