// Client-side auth service with secure password hashing (PBKDF2), localStorage-backed users, and session management
// NOTE: For production, replace localStorage with a secure backend. This implementation focuses on secure hashing and validation in-browser.

export type Role = 'admin' | 'manager' | 'frontdesk' | 'auditor' | 'posmanager' | 'housekeeping' | 'cashier' | 'barman' | 'supervisor';

export interface UserRecord {
  id: string;
  username: string;
  email: string; // may be empty string if user uses System ID
  role: Role;
  profile?: { name?: string; phone?: string };
  password: { salt: string; hash: string; iterations: number; derivedLen: number };
  active: boolean;
  createdAt: string;
  updatedAt: string;
  permissions?: string[];
}

export interface Session {
  token: string;
  userId: string;
  role: Role;
  permissions: string[];
  expiresAt: string;
  lastActiveAt: string;
}

const K_USERS = 'corepms_users';
const K_SESSION = 'corepms_session';
const K_SESSION_PRIV = 'corepms_session_priv';
const K_RESETS = 'corepms_password_resets';

const readJSON = <T>(key: string, fallback: T): T => { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; } };
const writeJSON = (key: string, value: any) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };

const enc = new TextEncoder();
const toBase64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromBase64 = (b64: string) => Uint8Array.from(atob(b64), c => c.charCodeAt(0));

export const genSalt = (len = 16): Uint8Array => {
  const salt = new Uint8Array(len);
  crypto.getRandomValues(salt);
  return salt;
};

export const hashPassword = async (password: string, salt?: Uint8Array, iterations: number = 100_000, derivedLen: number = 32): Promise<{ salt: string; hash: string; iterations: number; derivedLen: number }> => {
  const s = salt || genSalt();
  const key = await crypto.subtle.importKey('raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: s, iterations }, key, derivedLen * 8);
  return { salt: toBase64(s.buffer), hash: toBase64(bits), iterations, derivedLen };
};

export const verifyPassword = async (password: string, stored: { salt: string; hash: string; iterations: number; derivedLen: number }): Promise<boolean> => {
  try {
    const salt = fromBase64(stored.salt);
    const { hash } = await hashPassword(password, salt, stored.iterations, stored.derivedLen);
    return hash === stored.hash;
  } catch { return false; }
};

export const listUsers = (): UserRecord[] => readJSON<UserRecord[]>(K_USERS, []);
export const setUsers = (rows: UserRecord[]) => writeJSON(K_USERS, rows);
export const findUser = (usernameOrEmail: string): UserRecord | undefined => listUsers().find(u => {
  const q = usernameOrEmail.toLowerCase();
  const em = (u.email || '').toLowerCase();
  return u.username.toLowerCase() === q || (!!em && em === q);
});

export const validateEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
export const validatePasswordStrength = (password: string) => /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^\da-zA-Z]).{8,}$/.test(password);

export const register = async (payload: { username: string; email?: string; password: string; role?: Role; name?: string; phone?: string; permissions?: string[] }): Promise<{ ok: boolean; error?: string; user?: UserRecord }> => {
  const { username, email, password } = payload;
  if (!username || !password) return { ok:false, error:'Missing fields' };
  if (email && !validateEmail(email)) return { ok:false, error:'Invalid email' };
  if (!validatePasswordStrength(password)) return { ok:false, error:'Weak password (min 8 chars, at least 1 letter & 1 number)' };
  if (findUser(username) || (email && findUser(email))) return { ok:false, error:'User already exists' };
  const now = new Date().toISOString();
  const hashed = await hashPassword(password);
  const user: UserRecord = {
    id: `USR_${Date.now()}`,
    username,
    email: email || '',
    role: payload.role || ((String(username).toLowerCase()==='admin') ? 'admin' : 'frontdesk'),
    profile: { name: payload.name, phone: payload.phone },
    password: hashed,
    active: true,
    createdAt: now,
    updatedAt: now,
    permissions: Array.isArray(payload.permissions) ? payload.permissions : [],
  };
  const next = [user, ...listUsers()].slice(0, 2000);
  setUsers(next);
  return { ok:true, user };
};

export const createSession = (user: UserRecord, minutes: number = 30): Session => {
  const token = `SESS_${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`;
  const now = new Date();
  const expires = new Date(now.getTime() + minutes*60*1000);
  const sess: Session = { token, userId: user.id, role: user.role, permissions: Array.isArray(user.permissions) ? user.permissions : [], expiresAt: expires.toISOString(), lastActiveAt: now.toISOString() };
  try { localStorage.removeItem(K_SESSION_PRIV) } catch {}
  writeJSON(K_SESSION, sess);
  writeJSON(K_SESSION_PRIV, { role: sess.role, permissions: sess.permissions });
  return sess;
};

export const getSession = (): Session | null => {
  const sess = readJSON<Session | null>(K_SESSION, null);
  if (!sess) return null;
  const exp = new Date(sess.expiresAt).getTime();
  if (Date.now() > exp) { try { localStorage.removeItem(K_SESSION); } catch {}; return null; }
  return sess;
};

export const touchSession = () => {
  const sess = getSession(); if (!sess) return;
  sess.lastActiveAt = new Date().toISOString();
  writeJSON(K_SESSION, sess);
};

export const logout = () => { try { localStorage.removeItem(K_SESSION); } catch {} };

export const login = async (usernameOrEmail: string, password: string): Promise<{ ok: boolean; error?: string; session?: Session; user?: UserRecord }> => {
  const user = findUser(usernameOrEmail);
  if (!user) return { ok:false, error:'USER_NOT_FOUND' };
  if (!user.active) return { ok:false, error:'USER_INACTIVE' };
  const ok = await verifyPassword(password, user.password);
  if (!ok) return { ok:false, error:'INVALID_CREDENTIALS' };
  const session = createSession(user);
  return { ok:true, session, user };
};

export const updateProfile = (userId: string, patch: Partial<UserRecord['profile']>): { ok:boolean; error?: string; user?: UserRecord } => {
  const rows = listUsers(); const idx = rows.findIndex(u => u.id === userId); if (idx<0) return { ok:false, error:'User not found' };
  rows[idx].profile = { ...(rows[idx].profile || {}), ...(patch || {}) };
  rows[idx].updatedAt = new Date().toISOString(); setUsers(rows);
  return { ok:true, user: rows[idx] };
};

export const changePassword = async (userId: string, currentPassword: string, newPassword: string): Promise<{ ok:boolean; error?: string }> => {
  const rows = listUsers(); const idx = rows.findIndex(u => u.id === userId); if (idx<0) return { ok:false, error:'User not found' };
  const user = rows[idx]; const verified = await verifyPassword(currentPassword, user.password); if (!verified) return { ok:false, error:'Incorrect current password' };
  if (!validatePasswordStrength(newPassword)) return { ok:false, error:'Weak password' };
  rows[idx].password = await hashPassword(newPassword);
  rows[idx].updatedAt = new Date().toISOString(); setUsers(rows);
  return { ok:true };
};

export const setUserRole = (userId: string, role: Role): { ok:boolean; error?: string } => {
  const rows = listUsers(); const idx = rows.findIndex(u => u.id === userId); if (idx<0) return { ok:false, error:'User not found' };
  rows[idx].role = role; rows[idx].updatedAt = new Date().toISOString(); setUsers(rows);
  return { ok:true };
};

export const updateUser = (userId: string, patch: Partial<Pick<UserRecord, 'role' | 'active' | 'permissions' | 'profile'>>): { ok:boolean; error?: string; user?: UserRecord } => {
  const rows = listUsers(); const idx = rows.findIndex(u => u.id === userId); if (idx<0) return { ok:false, error:'User not found' };
  const prev = rows[idx];
  rows[idx] = {
    ...prev,
    role: patch.role ?? prev.role,
    active: patch.active ?? prev.active,
    permissions: Array.isArray(patch.permissions) ? patch.permissions : prev.permissions,
    profile: { ...(prev.profile || {}), ...(patch.profile || {}) },
    updatedAt: new Date().toISOString(),
  };
  setUsers(rows);
  return { ok:true, user: rows[idx] };
};

export const deleteUser = (userId: string): { ok:boolean; error?: string } => {
  const rows = listUsers();
  const idx = rows.findIndex(u => u.id === userId);
  if (idx < 0) return { ok:false, error:'User not found' };
  rows.splice(idx, 1);
  setUsers(rows);
  return { ok:true };
};

// Map standardized UI role names to internal Role codes used across the app
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

export const requestPasswordReset = (usernameOrEmail: string): { ok:boolean; error?: string; token?: string } => {
  const user = findUser(usernameOrEmail); if (!user) return { ok:false, error:'User not found' };
  const token = `RST_${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`;
  const expiresAt = new Date(Date.now() + 15*60*1000).toISOString();
  const list = readJSON<any[]>(K_RESETS, []);
  writeJSON(K_RESETS, [{ token, userId: user.id, expiresAt }, ...list].slice(0, 200));
  return { ok:true, token };
};

export const resetPassword = async (token: string, newPassword: string): Promise<{ ok:boolean; error?: string }> => {
  const list = readJSON<any[]>(K_RESETS, []);
  const idx = list.findIndex(r => r.token === token);
  if (idx<0) return { ok:false, error:'Invalid token' };
  if (Date.now() > new Date(list[idx].expiresAt).getTime()) return { ok:false, error:'Token expired' };
  const rows = listUsers(); const uIdx = rows.findIndex(u => u.id === list[idx].userId);
  if (uIdx<0) return { ok:false, error:'User not found' };
  if (!validatePasswordStrength(newPassword)) return { ok:false, error:'Weak password' };
  rows[uIdx].password = await hashPassword(newPassword);
  rows[uIdx].updatedAt = new Date().toISOString(); setUsers(rows);
  list.splice(idx,1); writeJSON(K_RESETS, list);
  return { ok:true };
};

export default {
  listUsers, setUsers, findUser,
  register, login, logout,
  createSession, getSession, touchSession,
  updateProfile, changePassword, setUserRole,
  requestPasswordReset, resetPassword,
  validateEmail, validatePasswordStrength,
};

// Default seeds are intentionally disabled to avoid embedding plaintext credentials in the client bundle.
// Admins can provision accounts via secure channels or reveal-and-seed flow in Electron.
export const initAuth = async () => {
  // No-op: leave user store empty until explicit registration occurs.
  return;
};
