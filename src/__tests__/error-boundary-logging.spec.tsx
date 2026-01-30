import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import ErrorBoundary from '../components/ErrorBoundary'

describe('ErrorBoundary logging', () => {
  beforeEach(() => {
    try { localStorage.removeItem('corepms_error_boundary') } catch {}
  })

  const Boom: React.FC = () => {
    throw new Error('boom')
  }

  it('logs error details to localStorage and shows fallback', () => {
    render(
      <ErrorBoundary fallbackTitle="POS Settings Error" fallbackMessage="Please reload or contact support.">
        <Boom />
      </ErrorBoundary>
    )
    const headers = screen.getAllByText('POS Settings Error')
    expect(headers.length).toBeGreaterThan(0)
    const raw = localStorage.getItem('corepms_error_boundary')
    expect(raw).toBeTruthy()
    const list = JSON.parse(String(raw))
    expect(Array.isArray(list)).toBe(true)
    expect(list[0].message).toContain('boom')
    expect(list[0].url).toBeDefined()
  })

  it('Copy Details button copies latest entry', () => {
    render(
      <ErrorBoundary fallbackTitle="POS Settings Error" fallbackMessage="Please reload or contact support.">
        <Boom />
      </ErrorBoundary>
    )
    const btns = screen.getAllByRole('button', { name: /copy details/i })
    expect(btns.length).toBeGreaterThan(0)
    fireEvent.click(btns[0])
  })
})
