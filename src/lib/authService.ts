// Client-side auth service wrapper for IPC
// Replaces localStorage with window.native.auth calls

declare global {
  interface Window {
    native?: {
      auth?: {
        listUsers: () => Promise<{ ok: boolean; users?: any[]; error?: string }>;
        register: (p: any) => Promise<{ ok: boolean; user?: any; error?: string }>;
        login: (p: any) => Promise<{ ok: boolean; user?: any; error?: string }>;
        updateUser: (id: string, p: any) => Promise<{ ok: boolean; error?: string }>;
        deleteUser: (id: string) => Promise<{ ok: boolean; error?: string }>;
        heartbeat: (userId: string) => Promise<{ ok: boolean }>;
      };
    };
  }
}

export type Role = 'admin' | 'manager' | 'frontdesk' | 'auditor' | 'posmanager' | 'housekeeping' | 'cashier' | 'barman' | 'supervisor';

export interface UserRecord {
  id: string;
  username: string;
  email: string;
  role: Role;
  name: string;
  active: boolean;
  permissions: string[];
  createdAt: string;
  updatedAt: string;
  lastLogin?: string;
  lastActivity?: string;
  profile?: { name?: string; phone?: string };
  // Legacy fields kept for compatibility but not used for auth check
  password?: any;
}

export interface Session {
  token: string;
  userId: string;
  role: Role;
  permissions: string[];
  expiresAt: string;
  lastActiveAt: string;
}

const K_SESSION = 'corepms_session';
const readJSON = <T>(key: string, fallback: T): T => { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; } };
const writeJSON = (key: string, value: any) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { } };

// Helper to map DB user to UserRecord
const mapDbUser = (u: any): UserRecord => ({
  id: u.id,
  username: u.username || u.email,
  email: u.email || '',
  role: u.role as Role,
  name: u.name || u.full_name || u.username,
  active: u.active === true || u.active === 'true',
  permissions: u.permissions || [],
  createdAt: u.created_at || new Date().toISOString(),
  updatedAt: u.updated_at || u.created_at || new Date().toISOString(),
  lastLogin: u.last_login,
  lastActivity: u.last_activity,
  profile: { name: u.name || u.full_name },
});

// --- Mock Backend for Browser Environment ---
const MOCK_STORAGE_KEY = 'corepms_mock_users';

const getMockUsers = (): UserRecord[] => {
  try {
    const raw = localStorage.getItem(MOCK_STORAGE_KEY);
    if (!raw) {
      // Seed with some defaults if empty
      const defaults: UserRecord[] = [
        { id: '1', username: 'admin', email: 'admin@system.local', role: 'admin', name: 'System Administrator', active: true, permissions: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        { id: '2', username: 'frontdesk', email: 'reception@hotel.com', role: 'frontdesk', name: 'Front Desk', active: true, permissions: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
      ];
      localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(defaults));
      return defaults;
    }
    return JSON.parse(raw);
  } catch { return []; }
};

const saveMockUsers = (users: UserRecord[]) => {
  localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(users));
};

// IPC Wrappers - NOW ASYNC with Mock Fallback
export const listUsers = async (): Promise<UserRecord[]> => {
  if (typeof window !== 'undefined' && window.native?.auth?.listUsers) {
    try {
      const res = await window.native.auth.listUsers();
      if (res.ok && res.users) {
        return res.users.map(mapDbUser);
      }
    } catch (e) { console.error('listUsers failed', e); }
  } else {
    // Browser fallback
    console.warn('Running in browser mode: using mock users');
    return new Promise(resolve => setTimeout(() => resolve(getMockUsers()), 300));
  }
  return [];
};

export const register = async (payload: { username: string; email?: string; password: string; role?: Role; name?: string; phone?: string; permissions?: string[] }): Promise<{ ok: boolean; error?: string; user?: UserRecord }> => {
  if (!payload.username || !payload.password) return { ok: false, error: 'Missing fields' };

  if (window.native?.auth?.register) {
    try {
      const res = await window.native.auth.register(payload);
      if (res.ok && res.user) {
        return { ok: true, user: mapDbUser(res.user) };
      }
      return { ok: false, error: res.error || 'Registration failed' };
    } catch (e: any) { return { ok: false, error: e.message || String(e) }; }
  } else {
    // Browser fallback
    const users = getMockUsers();
    if (users.some(u => u.username === payload.username)) return { ok: false, error: 'Username already exists (mock)' };

    const newUser: UserRecord = {
      id: 'mock_' + Date.now(),
      username: payload.username,
      email: payload.email || '',
      role: payload.role || 'frontdesk',
      name: payload.name || payload.username,
      active: true,
      permissions: payload.permissions || [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastLogin: undefined
    };
    users.push(newUser);
    saveMockUsers(users);
    return new Promise(resolve => setTimeout(() => resolve({ ok: true, user: newUser }), 500));
  }
};

export const login = async (usernameOrEmail: string, password: string): Promise<{ ok: boolean; error?: string; session?: Session; user?: UserRecord }> => {
  if (window.native?.auth?.login) {
    try {
      const res = await window.native.auth.login({ username: usernameOrEmail, password });
      if (res.ok && res.user) {
        const u = mapDbUser(res.user);
        const session = createSession(u);
        return { ok: true, session, user: u };
      }
      return { ok: false, error: res.error || 'Login failed' };
    } catch (e: any) { return { ok: false, error: e.message || String(e) }; }
  } else {
    // Browser fallback
    const users = getMockUsers();
    const u = users.find(x => x.username === usernameOrEmail || x.email === usernameOrEmail);
    // For mock mode, accept any password or check simplified logic
    if (u) {
      const session = createSession(u);
      return { ok: true, session, user: u };
    }
    return { ok: false, error: 'Invalid credentials (mock)' };
  }
};

export const updateUser = async (userId: string, patch: any): Promise<{ ok: boolean; error?: string; user?: UserRecord }> => {
  if (window.native?.auth?.updateUser) {
    const res = await window.native.auth.updateUser(userId, patch);
    if (res.ok) return { ok: true };
    return res;
  } else {
    // Browser fallback
    const users = getMockUsers();
    const idx = users.findIndex(u => u.id === userId);
    if (idx !== -1) {
      users[idx] = { ...users[idx], ...patch, updatedAt: new Date().toISOString() };
      saveMockUsers(users);
      return { ok: true, user: users[idx] };
    }
    return { ok: false, error: 'User not found (mock)' };
  }
};

export const deleteUser = async (userId: string): Promise<{ ok: boolean; error?: string }> => {
  if (window.native?.auth?.deleteUser) {
    return window.native.auth.deleteUser(userId);
  } else {
    // Browser fallback
    const users = getMockUsers();
    const filtered = users.filter(u => u.id !== userId);
    saveMockUsers(filtered);
    return { ok: true };
  }
};

export const sendHeartbeat = async (userId: string): Promise<void> => {
  if (window.native?.auth?.heartbeat && userId) {
    await window.native.auth.heartbeat(userId).catch(() => { });
  }
};

// --- Session Management (Local Storage) ---
// Kept for seamless UI integration with AuthContext
export const createSession = (user: UserRecord, minutes: number = 240): Session => {
  const token = `SESS_${Math.random().toString(36).slice(2)}`;
  const now = new Date();
  const expires = new Date(now.getTime() + minutes * 60 * 1000);
  const sess: Session = { token, userId: user.id, role: user.role, permissions: user.permissions || [], expiresAt: expires.toISOString(), lastActiveAt: now.toISOString() };
  writeJSON(K_SESSION, sess);
  return sess;
};

export const getSession = (): Session | null => {
  const sess = readJSON<Session | null>(K_SESSION, null);
  if (!sess) return null;
  if (new Date() > new Date(sess.expiresAt)) { logout(); return null; }
  return sess;
};

export const touchSession = () => {
  const sess = getSession(); if (!sess) return;
  sess.lastActiveAt = new Date().toISOString();
  writeJSON(K_SESSION, sess);
};

export const logout = () => { localStorage.removeItem(K_SESSION); };

// --- Compatibility Aliases ---
export const updateProfile = (id: string, patch: any) => updateUser(id, patch);
export const changePassword = (id: string, oldP: string, newP: string) => updateUser(id, { password: newP });
export const setUserRole = (id: string, role: Role) => updateUser(id, { role });

// --- Utils ---
export const validateEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
export const validatePasswordStrength = (password: string) => password && password.length >= 4;

// Legacy/No-ops
export const setUsers = (users: any[]) => { /* no-op in DB mode */ };
// Client-side encryption for local features (e.g. Admin PIN)
export const hashPassword = async (password: string) => {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']);
  const hash = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256);
  return {
    hash: Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join(''),
    salt: Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join(''),
    iterations: 100000
  };
};

export const verifyPassword = async (password: string, stored: { hash: string; salt: string; iterations: number }) => {
  if (!stored || !stored.salt || !stored.hash) return false;
  try {
    const enc = new TextEncoder();
    const salt = new Uint8Array(stored.salt.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
    const key = await crypto.subtle.importKey('raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']);
    const hash = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: stored.iterations, hash: 'SHA-256' }, key, 256);
    const hashHex = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex === stored.hash;
  } catch (e) {
    console.error('Password verification failed', e);
    return false;
  }
};

export const requestPasswordReset = (usernameOrEmail: string) => ({ ok: false, error: 'Use admin reset' }); // Stub
export const resetPassword = async (token: string, newPassword: string) => ({ ok: false, error: 'Use admin reset' }); // Stub
export const initAuth = async () => { }; // Stub

export const mapStandardRoleToInternal = (name: string): Role => {
  const n = (name || '').toLowerCase();
  switch (n) {
    case 'super admin': return 'admin';
    case 'admin': return 'admin';
    case 'fo manager': return 'manager';
    case 'fnb manager': return 'posmanager';
    case 'fo supervisor': return 'supervisor';
    case 'fnb supervisor': return 'supervisor';
    case 'restaurant cashier': return 'cashier';
    case 'front office cashier': return 'cashier';
    case 'barman': return 'barman';
    case 'accountant': return 'auditor';
    case 'night auditor': return 'auditor';
    case 'house keeper': return 'housekeeping';
    case 'maintenance': return 'supervisor';
    default: return 'frontdesk';
  }
};

export const mapInternalRoleToStandard = (role: Role): string => {
  switch (role) {
    case 'admin': return 'Admin';
    case 'manager': return 'FO Manager';
    case 'posmanager': return 'FNB Manager';
    case 'supervisor': return 'FO Supervisor';
    case 'cashier': return 'Front office Cashier';
    case 'barman': return 'Barman';
    case 'auditor': return 'Night Auditor';
    case 'housekeeping': return 'House keeper';
    case 'frontdesk': return 'FO Supervisor';
    default: return role;
  }
};

// Export default for consumers importing 'auth'
export default {
  listUsers, register, login, logout, getSession, touchSession, createSession,
  updateUser, deleteUser, updateProfile, changePassword, setUserRole,
  validateEmail, validatePasswordStrength,
  requestPasswordReset, resetPassword,
  setUsers, hashPassword, verifyPassword, initAuth
};
