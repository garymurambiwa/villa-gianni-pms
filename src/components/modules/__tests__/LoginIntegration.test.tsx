import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Login } from '../../Login';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { MemoryRouter } from 'react-router-dom';

// Mock dependencies
vi.mock('@/lib/logger', () => ({
  logger: {
    logAuth: vi.fn(),
  },
}));

vi.mock('@/lib/db', () => ({
  db: {
    isConfigured: vi.fn().mockResolvedValue(false),
  }
}));

vi.mock('@/lib/supabaseClient', () => ({
  supabase: null
}));

vi.mock('@/lib/pmsAuthDb', () => ({
  default: {
    init: vi.fn().mockResolvedValue(undefined),
    ensureSuperUser: vi.fn().mockResolvedValue(undefined),
  }
}));

// Mock authService module completely
const mockLogin = vi.fn();
const mockGetSession = vi.fn();
const mockListUsers = vi.fn();
const mockInitAuth = vi.fn();

vi.mock('@/lib/authService', () => ({
  default: {
    login: (...args) => mockLogin(...args),
    getSession: (...args) => mockGetSession(...args),
    listUsers: (...args) => mockListUsers(...args),
    logout: vi.fn(),
    register: vi.fn(),
    requestPasswordReset: vi.fn(),
    resetPassword: vi.fn(),
    updateProfile: vi.fn(),
    changePassword: vi.fn(),
    touchSession: vi.fn(),
  },
  initAuth: () => mockInitAuth(),
  setUsers: vi.fn(),
  hashPassword: vi.fn(),
}));

// Mock window.native
Object.defineProperty(window, 'native', {
  value: {
    security: {
      revealDefaultCredentials: vi.fn(),
    },
    db: {
      onSetupRequired: vi.fn(),
    }
  },
  writable: true
});

describe('Login Integration Test', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    // Reset default mock implementations
    mockInitAuth.mockResolvedValue(undefined);
    mockListUsers.mockReturnValue([]);
    mockGetSession.mockReturnValue(null);
  });

  it('renders login form correctly', () => {
    render(
      <AuthProvider>
        <MemoryRouter>
          <Login />
        </MemoryRouter>
      </AuthProvider>
    );

    expect(screen.getByPlaceholderText('Enter username')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('handles successful login with valid credentials', async () => {
    mockLogin.mockResolvedValue({
      ok: true,
      user: {
        id: 'test-user',
        username: 'admin',
        role: 'admin',
        active: true,
        permissions: []
      }
    });

    render(
      <AuthProvider>
        <MemoryRouter>
          <Login />
        </MemoryRouter>
      </AuthProvider>
    );

    fireEvent.change(screen.getByPlaceholderText('Enter username'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByPlaceholderText('Enter password'), { target: { value: 'test123' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('admin', 'test123');
    });
  });

  it('handles failed login with invalid credentials', async () => {
    mockLogin.mockResolvedValue({
      ok: false,
      error: 'Invalid credentials'
    });

    render(
      <AuthProvider>
        <MemoryRouter>
          <Login />
        </MemoryRouter>
      </AuthProvider>
    );

    fireEvent.change(screen.getByPlaceholderText('Enter username'), { target: { value: 'wrong' } });
    fireEvent.change(screen.getByPlaceholderText('Enter password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByText(/invalid username or password/i)).toBeInTheDocument();
    });
  });

  it('persists session on reload (simulated)', async () => {
    const sessionUser = {
      id: 'persisted-user',
      username: 'admin',
      role: 'admin',
      active: true
    };
    
    mockGetSession.mockReturnValue({
      userId: 'persisted-user',
      token: 'fake-token',
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      role: 'admin'
    });

    mockListUsers.mockReturnValue([sessionUser]);

    render(
      <AuthProvider>
        <MemoryRouter>
          <AuthConsumer /> 
        </MemoryRouter>
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Logged in as: admin')).toBeInTheDocument();
    });
  });
});

const AuthConsumer = () => {
  const { user } = useAuth();
  if (!user) return <div>Not logged in</div>;
  return <div>Logged in as: {user.username}</div>;
};
