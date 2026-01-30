import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Login } from '@/components/Login'
import { AuthProvider } from '@/context/AuthContext'
import { vi } from 'vitest'

// Mock dependencies
vi.mock('@/lib/logger', () => ({
  logger: {
    logAuth: vi.fn(),
    logSecurity: vi.fn()
  }
}))

vi.mock('@/lib/supabaseClient', () => ({
  supabase: null
}))

vi.mock('@/lib/db', () => ({
  db: {
    isConfigured: vi.fn().mockResolvedValue(false)
  }
}))

vi.mock('@/lib/pmsAuthDb', () => ({
  default: {
    init: vi.fn(),
    ensureSuperUser: vi.fn(),
    grantPrivilegesForSuperUser: vi.fn(),
    verifyLogin: vi.fn()
  }
}))

vi.mock('@/lib/authService', () => ({
  default: {
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    getSession: vi.fn(),
    listUsers: vi.fn(),
    touchSession: vi.fn(),
    createSession: vi.fn()
  },
  initAuth: vi.fn()
}))

vi.mock('@/lib/profile', () => ({
  mergeUserWithProfile: vi.fn().mockImplementation(user => Promise.resolve(user))
}))

describe('Authentication Integration Tests', () => {
  let queryClient: QueryClient
  let user: ReturnType<typeof userEvent.setup>

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false }
      }
    })
    user = userEvent.setup()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const renderWithProviders = (ui: React.ReactElement) => {
    return render(
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            {ui}
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    )
  }

  describe('Login Flow Integration', () => {
    it('should handle successful login flow', async () => {
      const mockAuthService = await import('@/lib/authService')
      const { default: auth } = mockAuthService
      
      vi.mocked(auth.login).mockResolvedValue({
        ok: true,
        user: {
          id: 'test-user-id',
          username: 'testuser',
          profile: { name: 'Test User' },
          role: 'manager',
          active: true
        }
      })

      renderWithProviders(<Login />)

      // Fill in login form
      const usernameInput = screen.getByPlaceholderText('Enter username')
      const passwordInput = screen.getByPlaceholderText('Enter password')
      const submitButton = screen.getByRole('button', { name: /sign in/i })

      await user.type(usernameInput, 'testuser')
      await user.type(passwordInput, 'testpass123')
      await user.click(submitButton)

      // Wait for login to complete
      await waitFor(() => {
        expect(auth.login).toHaveBeenCalledWith('testuser', 'testpass123')
      })
    })

    it('should handle invalid credentials with appropriate error message', async () => {
      const mockAuthService = await import('@/lib/authService')
      const { default: auth } = mockAuthService
      
      vi.mocked(auth.login).mockResolvedValue({ ok: false, user: null })

      renderWithProviders(<Login />)

      const usernameInput = screen.getByPlaceholderText('Enter username')
      const passwordInput = screen.getByPlaceholderText('Enter password')
      const submitButton = screen.getByRole('button', { name: /sign in/i })

      await user.type(usernameInput, 'wronguser')
      await user.type(passwordInput, 'wrongpass')
      await user.click(submitButton)

      await waitFor(() => {
        expect(screen.getByText('Invalid username or password')).toBeInTheDocument()
      })
    })

    it('should handle account locked error', async () => {
      const mockPmsAuthDb = await import('@/lib/pmsAuthDb')
      const { default: pmsAuthDb } = mockPmsAuthDb
      
      vi.mocked(pmsAuthDb.verifyLogin).mockResolvedValue({
        ok: false,
        error: 'Account is locked due to multiple failed attempts',
        user: null
      })

      renderWithProviders(<Login />)

      const usernameInput = screen.getByPlaceholderText('Enter username')
      const passwordInput = screen.getByPlaceholderText('Enter password')
      const submitButton = screen.getByRole('button', { name: /sign in/i })

      await user.type(usernameInput, 'lockeduser')
      await user.type(passwordInput, 'password')
      await user.click(submitButton)

      await waitFor(() => {
        expect(screen.getByText('Account is locked due to multiple failed attempts. Please try again later.')).toBeInTheDocument()
      })
    })

    it('should handle rate limiting error', async () => {
      const mockPmsAuthDb = await import('@/lib/pmsAuthDb')
      const { default: pmsAuthDb } = mockPmsAuthDb
      
      vi.mocked(pmsAuthDb.verifyLogin).mockResolvedValue({
        ok: false,
        error: 'Rate limit exceeded. Too many attempts',
        user: null
      })

      renderWithProviders(<Login />)

      const usernameInput = screen.getByPlaceholderText('Enter username')
      const passwordInput = screen.getByPlaceholderText('Enter password')
      const submitButton = screen.getByRole('button', { name: /sign in/i })

      await user.type(usernameInput, 'ratelimiteduser')
      await user.type(passwordInput, 'password')
      await user.click(submitButton)

      await waitFor(() => {
        expect(screen.getByText('Too many login attempts. Please wait before trying again.')).toBeInTheDocument()
      })
    })

    it('should handle network/database errors', async () => {
      const mockAuthService = await import('@/lib/authService')
      const { default: auth } = mockAuthService
      
      vi.mocked(auth.login).mockRejectedValue(new Error('Network error'))

      renderWithProviders(<Login />)

      const usernameInput = screen.getByPlaceholderText('Enter username')
      const passwordInput = screen.getByPlaceholderText('Enter password')
      const submitButton = screen.getByRole('button', { name: /sign in/i })

      await user.type(usernameInput, 'testuser')
      await user.type(passwordInput, 'password')
      await user.click(submitButton)

      await waitFor(() => {
        expect(screen.getByText('Unable to connect to authentication service. Please try again later.')).toBeInTheDocument()
      })
    })

    it('should disable submit button during login attempt', async () => {
      const mockAuthService = await import('@/lib/authService')
      const { default: auth } = mockAuthService
      
      let resolveLogin: (value: any) => void
      const loginPromise = new Promise(resolve => {
        resolveLogin = resolve
      })
      
      vi.mocked(auth.login).mockReturnValue(loginPromise)

      renderWithProviders(<Login />)

      const usernameInput = screen.getByPlaceholderText('Enter username')
      const passwordInput = screen.getByPlaceholderText('Enter password')
      const submitButton = screen.getByRole('button', { name: /sign in/i })

      await user.type(usernameInput, 'testuser')
      await user.type(passwordInput, 'password')
      await user.click(submitButton)

      // Button should be disabled during login
      expect(submitButton).toBeDisabled()
      expect(submitButton).toHaveTextContent('Signing In…')

      // Resolve the login
      resolveLogin!({ ok: false, user: null })
      await waitFor(() => {
        expect(submitButton).not.toBeDisabled()
        expect(submitButton).toHaveTextContent('Sign In')
      })
    })

    it('should clear error message on new input', async () => {
      const mockAuthService = await import('@/lib/authService')
      const { default: auth } = mockAuthService
      
      vi.mocked(auth.login).mockResolvedValue({ ok: false, user: null })

      renderWithProviders(<Login />)

      const usernameInput = screen.getByPlaceholderText('Enter username')
      const passwordInput = screen.getByPlaceholderText('Enter password')
      const submitButton = screen.getByRole('button', { name: /sign in/i })

      // Trigger error
      await user.type(usernameInput, 'wronguser')
      await user.type(passwordInput, 'wrongpass')
      await user.click(submitButton)

      await waitFor(() => {
        expect(screen.getByText('Invalid username or password')).toBeInTheDocument()
      })

      // Clear error by typing new input
      await user.type(usernameInput, 'new')

      await waitFor(() => {
        expect(screen.queryByText('Invalid username or password')).not.toBeInTheDocument()
      })
    })
  })

  describe('Security Features', () => {
    it('should not expose sensitive information in error messages', async () => {
      const mockAuthService = await import('@/lib/authService')
      const { default: auth } = mockAuthService
      
      vi.mocked(auth.login).mockRejectedValue(new Error('Database connection string: postgres://user:password@localhost:5432/db'))

      renderWithProviders(<Login />)

      const usernameInput = screen.getByPlaceholderText('Enter username')
      const passwordInput = screen.getByPlaceholderText('Enter password')
      const submitButton = screen.getByRole('button', { name: /sign in/i })

      await user.type(usernameInput, 'testuser')
      await user.type(passwordInput, 'password')
      await user.click(submitButton)

      await waitFor(() => {
        const errorMessage = screen.getByRole('alert')
        expect(errorMessage).toHaveTextContent('Unable to connect to authentication service')
        expect(errorMessage).not.toHaveTextContent('postgres://')
        expect(errorMessage).not.toHaveTextContent('password')
      })
    })

    it('should log authentication events with appropriate data', async () => {
      const mockAuthService = await import('@/lib/authService')
      const { default: auth } = mockAuthService
      const { logger } = await import('@/lib/logger')
      
      vi.mocked(auth.login).mockResolvedValue({ ok: false, user: null })

      renderWithProviders(<Login />)

      const usernameInput = screen.getByPlaceholderText('Enter username')
      const passwordInput = screen.getByPlaceholderText('Enter password')
      const submitButton = screen.getByRole('button', { name: /sign in/i })

      await user.type(usernameInput, 'testuser')
      await user.type(passwordInput, 'password')
      await user.click(submitButton)

      await waitFor(() => {
        // Verify logging calls
        expect(logger.logAuth).toHaveBeenCalledWith('login_attempt', expect.objectContaining({
          username: 'testuser',
          timestamp: expect.any(String)
        }))
        
        expect(logger.logAuth).toHaveBeenCalledWith('login_failure', expect.objectContaining({
          username: 'testuser',
          errorCode: 'INVALID_CREDENTIALS',
          timestamp: expect.any(String)
        }))
      })
    })

    it('should sanitize sensitive data in logs', async () => {
      const { logger } = await import('@/lib/logger')
      
      renderWithProviders(<Login />)

      const usernameInput = screen.getByPlaceholderText('Enter username')
      const passwordInput = screen.getByPlaceholderText('Enter password')

      await user.type(usernameInput, 'testuser')
      await user.type(passwordInput, 'secretpassword123')

      // Simulate direct logging (this would normally happen internally)
      logger.logAuth('test_event', {
        username: 'testuser',
        password: 'secretpassword123',
        token: 'bearer-token-123',
        refreshToken: 'refresh-token-456'
      })

      // Verify sensitive data is sanitized
      const logCall = vi.mocked(logger.logAuth).mock.calls[0]
      const logData = logCall[1]
      
      expect(logData).not.toHaveProperty('password')
      expect(logData).not.toHaveProperty('token')
      expect(logData).not.toHaveProperty('refreshToken')
      expect(logData).toHaveProperty('username', 'testuser')
    })
  })

  describe('Accessibility', () => {
    it('should have proper ARIA labels and roles', () => {
      renderWithProviders(<Login />)

      expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()
      expect(screen.getByPlaceholderText('Enter username')).toHaveAttribute('type', 'text')
      expect(screen.getByPlaceholderText('Enter password')).toHaveAttribute('type', 'password')
      
      // Error messages should have appropriate roles
      const errorDiv = screen.getByText(/credentials hidden for security/i).closest('div')
      expect(errorDiv).toHaveAttribute('aria-live', 'polite')
    })

    it('should be keyboard navigable', async () => {
      renderWithProviders(<Login />)

      const usernameInput = screen.getByPlaceholderText('Enter username')
      const passwordInput = screen.getByPlaceholderText('Enter password')
      const submitButton = screen.getByRole('button', { name: /sign in/i })

      // Tab navigation
      usernameInput.focus()
      expect(document.activeElement).toBe(usernameInput)
      
      await user.tab()
      expect(document.activeElement).toBe(passwordInput)
      
      await user.tab()
      expect(document.activeElement).toBe(submitButton)
    })
  })
})

describe('Password Change and Session Persistence', () => {
  let queryClient: QueryClient
  let userCtl: ReturnType<typeof userEvent.setup>

  const TestConsumer: React.FC = () => {
    const { user, changePassword } = require('@/context/AuthContext').useAuth()
    return (
      <div>
        <div data-testid="user-present">{user ? 'yes' : 'no'}</div>
        <button onClick={() => changePassword('oldpass123','Newpass@123')} aria-label="change" />
      </div>
    )
  }

  const renderWithProviders = (ui: React.ReactElement) => {
    return render(
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            {ui}
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    )
  }

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
    })
    userCtl = userEvent.setup()
    vi.clearAllMocks()
  })

  it('maintains session after successful local password change', async () => {
    const mockAuthService = await import('@/lib/authService')
    const { default: auth } = mockAuthService
    const session = { token: 'SESS_1', userId: 'u1', role: 'manager', permissions: [], expiresAt: new Date(Date.now()+30*60*1000).toISOString(), lastActiveAt: new Date().toISOString() }
    vi.mocked(auth.getSession).mockReturnValue(session as any)
    vi.mocked(auth.listUsers).mockReturnValue([{
      id: 'u1', username: 'user1', email: '', role: 'manager', profile: { name: 'User One' },
      password: { salt: '', hash: '', iterations: 0, derivedLen: 0 }, active: true, createdAt: '', updatedAt: '', permissions: []
    }] as any)
    vi.mocked(auth.changePassword as any)?.mockResolvedValue?.({ ok: true })
    renderWithProviders(<TestConsumer />)
    expect(screen.getByTestId('user-present').textContent).toBe('yes')
    const btn = screen.getByRole('button', { name: 'change' })
    await userCtl.click(btn)
    await waitFor(() => {
      expect(auth.createSession).toHaveBeenCalled()
    })
    expect(screen.getByTestId('user-present').textContent).toBe('yes')
  })

  it('maintains session after DB password change and regenerates session', async () => {
    vi.doMock('@/lib/supabaseClient', () => ({ supabase: null }))
    const mockDb = await import('@/lib/db')
    mockDb.db.isConfigured = vi.fn().mockResolvedValue(true)
    const mockPmsAuthDb = await import('@/lib/pmsAuthDb')
    mockPmsAuthDb.default.updatePasswordForUser = vi.fn().mockResolvedValue({ ok: true })
    const mockAuthService = await import('@/lib/authService')
    const { default: auth } = mockAuthService
    const session = { token: 'SESS_2', userId: 'db1', role: 'manager', permissions: [], expiresAt: new Date(Date.now()+30*60*1000).toISOString(), lastActiveAt: new Date().toISOString() }
    vi.mocked(auth.getSession).mockReturnValue(session as any)
    vi.mocked(auth.listUsers).mockReturnValue([{
      id: 'db1', username: 'dbuser', email: '', role: 'manager', profile: { name: 'DB User' },
      password: { salt: '', hash: '', iterations: 0, derivedLen: 0 }, active: true, createdAt: '', updatedAt: '', permissions: []
    }] as any)
    // Seed AuthProvider with DB user
    const mockAuthContext = await import('@/context/AuthContext')
    const origUseAuth = mockAuthContext.useAuth
    renderWithProviders(<TestConsumer />)
    const btn = screen.getByRole('button', { name: 'change' })
    await userCtl.click(btn)
    await waitFor(() => {
      const { logger } = require('@/lib/logger')
      expect(logger.logAuth).toHaveBeenCalledWith('session_regenerated_after_password_change', expect.objectContaining({ provider: 'db' }))
    })
  })

  it('handles not logged in error gracefully', async () => {
    const mockAuthService = await import('@/lib/authService')
    const { default: auth } = mockAuthService
    vi.mocked(auth.getSession).mockReturnValue(null as any)
    vi.mocked(auth.listUsers).mockReturnValue([])
    renderWithProviders(<TestConsumer />)
    const btn = screen.getByRole('button', { name: 'change' })
    await userCtl.click(btn)
    await waitFor(() => {
      const { logger } = require('@/lib/logger')
      expect(logger.logAuth).toHaveBeenCalledWith('password_change_attempt', expect.any(Object))
    })
  })
})
