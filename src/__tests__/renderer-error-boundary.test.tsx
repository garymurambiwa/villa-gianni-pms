import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ErrorBoundary } from '@/components/ErrorBoundary'

const Thrower = () => { throw new Error('boom') }

describe('Renderer Error Boundary', () => {
  it('shows fallback and reloads', async () => {
    const reload = vi.fn()
    const orig = window.location.reload
    // @ts-ignore
    window.location.reload = reload
    render(
      <ErrorBoundary>
        <Thrower />
      </ErrorBoundary>
    )
    const fallback = await screen.findByText('Something went wrong')
    expect(!!fallback).toBe(true)
    const btn = await screen.findByRole('button', { name: /reload/i })
    btn.click()
    expect(reload).toHaveBeenCalled()
    // @ts-ignore
    window.location.reload = orig
  })
})