import { expect, vi } from 'vitest'
import * as matchers from '@testing-library/jest-dom/matchers'
expect.extend(matchers as any)

if (!window.alert) {
  // @ts-ignore
  window.alert = () => {}
}
vi.spyOn(window, 'alert').mockImplementation(() => {})

// Polyfills for JSDOM + Radix UI
// @ts-ignore
if (!Element.prototype.scrollIntoView) {
  // @ts-ignore
  Element.prototype.scrollIntoView = vi.fn()
}
// @ts-ignore
if (!window.ResizeObserver) {
  // @ts-ignore
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as any
}
