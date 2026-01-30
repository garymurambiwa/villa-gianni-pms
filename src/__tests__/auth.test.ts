import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { AuthProvider, useAuth, AuthError } from '@/context/AuthContext'
import { logger } from '@/lib/logger'

// Mock dependencies
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
    touchSession: vi.fn()
  },
  initAuth: vi.fn()
}))

vi.mock('@/lib/profile', () => ({
  mergeUserWithProfile: vi.fn().mockImplementation(user => Promise.resolve(user))
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    logAuth: vi.fn(),
    logSecurity: vi.fn()
  }
}))

describe('Authentication System', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('AuthProvider Context', () => {
    it('should provide authentication context without errors', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <AuthProvider>{children}</AuthProvider>
      )

      const { result } = renderHook(() => useAuth(), { wrapper })

      expect(result.current).toBeDefined()
      expect(result.current.user).toBeNull()
      expect(result.current.login).toBeInstanceOf(Function)
      expect(result.current.logout).toBeInstanceOf(Function)
    })

    it('should throw error when useAuth is used outside AuthProvider', () => {
      // Suppress console.error for this test
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      
      expect(() => {
        renderHook(() => useAuth())
      }).toThrow('useAuth must be used within AuthProvider')
      
      consoleSpy.mockRestore()
    })
  })

  describe('Login Error Handling', () => {
    it('should handle invalid credentials with proper error structure', async () => {
      const mockAuthService = await import('@/lib/authService')
      const { default: auth } = mockAuthService
      
      vi.mocked(auth.login).mockResolvedValue({ ok: false, user: null })

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <AuthProvider>{children}</AuthProvider>
      )

      const { result } = renderHook(() => useAuth(), { wrapper })

      await act(async () => {
        const response = await result.current.login('invaliduser', 'wrongpass')
        expect(response.success).toBe(false)
        expect(response.error).toBeDefined()
        expect(response.error?.code).toBe('INVALID_CREDENTIALS')
        expect(response.error?.message).toBe('Invalid username or password')
      })

      expect(logger.logAuth).toHaveBeenCalledWith('login_failure', expect.objectContaining({
        username: 'invaliduser',
        errorCode: 'INVALID_CREDENTIALS'
      }))
    })

    it('should handle user locked errors', async () => {
      const mockPmsAuthDb = await import('@/lib/pmsAuthDb')
      const { default: pmsAuthDb } = mockPmsAuthDb
      
      vi.mocked(pmsAuthDb.verifyLogin).mockResolvedValue({ 
        ok: false, 
        error: 'Account is locked due to multiple failed attempts',
        user: null 
      })

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <AuthProvider>{children}</AuthProvider>
      )

      const { result } = renderHook(() => useAuth(), { wrapper })

      await act(async () => {
        const response = await result.current.login('lockeduser', 'password')
        expect(response.success).toBe(false)
        expect(response.error?.code).toBe('USER_LOCKED')
      })
    })

    it('should handle rate limiting errors', async () => {
      const mockPmsAuthDb = await import('@/lib/pmsAuthDb')
      const { default: pmsAuthDb } = mockPmsAuthDb
      
      vi.mocked(pmsAuthDb.verifyLogin).mockResolvedValue({ 
        ok: false, 
        error: 'Rate limit exceeded. Too many attempts',
        user: null 
      })

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <AuthProvider>{children}</AuthProvider>
      )

      const { result } = renderHook(() => useAuth(), { wrapper })

      await act(async () => {
        const response = await result.current.login('ratelimiteduser', 'password')
        expect(response.success).toBe(false)
        expect(response.error?.code).toBe('RATE_LIMITED')
      })
    })

    it('should handle network/database errors', async () => {
      const mockPmsAuthDb = await import('@/lib/pmsAuthDb')
      const { default: pmsAuthDb } = mockPmsAuthDb
      
      vi.mocked(pmsAuthDb.verifyLogin).mockRejectedValue(new Error('Database connection failed'))

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <AuthProvider>{children}</AuthProvider>
      )

      const { result } = renderHook(() => useAuth(), { wrapper })

      await act(async () => {
        const response = await result.current.login('user', 'password')
        expect(response.success).toBe(false)
        expect(response.error?.code).toBe('NETWORK_ERROR')
      })
    })
  })

  describe('Session Management', () => {
    it('should handle session expiry', async () => {
      const mockAuthService = await import('@/lib/authService')
      const { default: auth } = mockAuthService
      
      // Mock expired session
      vi.mocked(auth.getSession).mockReturnValue({
        userId: 'test-user',
        expiresAt: new Date(Date.now() - 1000).toISOString() // Expired 1 second ago
      })

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <AuthProvider>{children}</AuthProvider>
      )

      const { result } = renderHook(() => useAuth(), { wrapper })

      // Simulate session check
      await act(async () => {
        // Wait for session check interval
        await new Promise(resolve => setTimeout(resolve, 100))
      })

      // Verify session expiry was logged
      expect(logger.logAuth).toHaveBeenCalledWith('session_expired', expect.objectContaining({
        userId: 'test-user'
      }))
    })

    it('should handle successful login with proper logging', async () => {
      const mockAuthService = await import('@/lib/authService')
      const { default: auth } = mockAuthService
      
      vi.mocked(auth.login).mockResolvedValue({
        ok: true,
        user: {
          id: 'test-user',
          username: 'testuser',
          profile: { name: 'Test User' },
          role: 'manager',
          active: true
        }
      })

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <AuthProvider>{children}</AuthProvider>
      )

      const { result } = renderHook(() => useAuth(), { wrapper })

      await act(async () => {
        const response = await result.current.login('testuser', 'password')
        expect(response.success).toBe(true)
        expect(response.error).toBeUndefined()
      })

      expect(logger.logAuth).toHaveBeenCalledWith('login_success', expect.objectContaining({
        username: 'testuser',
        userId: 'test-user'
      }))
    })
  })

  describe('Security Logging', () => {
    it('should sanitize sensitive data in logs', async () => {
      const mockAuthService = await import('@/lib/authService')
      const { default: auth } = mockAuthService
      
      vi.mocked(auth.login).mockImplementation(async (username, password) => {
        // Simulate logging with password (should be sanitized)
        logger.logAuth('login_attempt', { username, password, secret: 'sensitive' })
        return { ok: false, user: null }
      })

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <AuthProvider>{children}</AuthProvider>
      )

      const { result } = renderHook(() => useAuth(), { wrapper })

      await act(async () => {
        await result.current.login('testuser', 'password123')
      })

      // Verify sensitive data was sanitized
      const logCall = vi.mocked(logger.logAuth).mock.calls[0]
      expect(logCall[1]).not.toHaveProperty('password')
      expect(logCall[1]).not.toHaveProperty('secret')
      expect(logCall[1]).toHaveProperty('username', 'testuser')
    })

    it('should include security metadata in logs', async () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <AuthProvider>{children}</AuthProvider>
      )

      const { result } = renderHook(() => useAuth(), { wrapper })

      await act(async () => {
        await result.current.login('testuser', 'wrongpass')
      })

      // Verify security metadata is included
      expect(logger.logAuth).toHaveBeenCalledWith(
        'login_failure',
        expect.objectContaining({
          timestamp: expect.any(String),
          errorCode: expect.any(String)
        })
      )
    })
  })

  describe('Error Message Security', () => {
    it('should not expose sensitive information in error messages', async () => {
      const mockAuthService = await import('@/lib/authService')
      const { default: auth } = mockAuthService
      
      vi.mocked(auth.login).mockRejectedValue(new Error('Database connection string: postgres://user:password@localhost:5432/db'))

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <AuthProvider>{children}</AuthProvider>
      )

      const { result } = renderHook(() => useAuth(), { wrapper })

      let errorResponse
      await act(async () => {
        errorResponse = await result.current.login('user', 'pass')
      })

      // Verify generic error message is returned, not the detailed database error
      expect(errorResponse.error?.message).not.toContain('postgres://')
      expect(errorResponse.error?.message).toBe('Database connection failed')
    })
  })
})