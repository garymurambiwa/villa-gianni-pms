import { describe, it, expect, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import App from '@/App'
import { supabase } from '@/lib/supabaseClient'

describe('Auth redirect behavior', () => {
  beforeEach(async () => {
    // Ensure we start from a clean unauthenticated state
    await supabase.auth.signOut()
    window.location.hash = '#/'
  })

  it('redirects unauthenticated deep-link to /login', async () => {
    window.location.hash = '#/?module=profile'
    render(<App />)
    await waitFor(() => {
      expect(window.location.hash.startsWith('#/login')).toBe(true)
    })
  })

  it('preserves destination and does not redirect when authenticated', async () => {
    // Sign in using mock supabase client
    await supabase.auth.signInWithPassword({ email: 'mock@example.com', password: 'any' })
    window.location.hash = '#/?module=profile'
    render(<App />)
    await waitFor(() => {
      expect(window.location.hash).toBe('#/?module=profile')
    })
  })
})

