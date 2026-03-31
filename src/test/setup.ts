import { expect, vi, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import * as matchers from '@testing-library/jest-dom/matchers'
expect.extend(matchers as any)

// Unmount React trees and clear Radix UI portal elements after every test
afterEach(() => {
  cleanup()
})

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
