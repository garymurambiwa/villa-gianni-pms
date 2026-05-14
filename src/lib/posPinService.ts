/**
 * POS PIN Service
 * Manages 4-digit PINs for POS staff identification.
 * PINs are stored per-user in localStorage.
 * Every successful login is logged for audit/reporting.
 */

const PIN_STORE_KEY = 'corepms_pos_pins';        // { [userId]: "1234" }
const ACCESS_LOG_KEY = 'corepms_pos_access_log'; // [{...}]
const SESSION_KEY = 'corepms_pos_pin_session';   // current active POS operator
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;       // 30 minutes

const readJSON = <T>(key: string, fallback: T): T => {
  try { const r = localStorage.getItem(key); return r ? JSON.parse(r) as T : fallback; } catch { return fallback; }
};
const writeJSON = (key: string, value: any) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
};

// ─── PIN Storage ─────────────────────────────────────────────────────────────

/** Set or update a user's POS PIN */
export const setPosPin = (userId: string, pin: string): void => {
  if (!/^\d{4}$/.test(pin)) throw new Error('PIN must be exactly 4 digits');
  const store = readJSON<Record<string, string>>(PIN_STORE_KEY, {});
  store[userId] = pin;
  writeJSON(PIN_STORE_KEY, store);
};

/** Remove a user's POS PIN */
export const clearPosPin = (userId: string): void => {
  const store = readJSON<Record<string, string>>(PIN_STORE_KEY, {});
  delete store[userId];
  writeJSON(PIN_STORE_KEY, store);
};

/** Check if a user has a PIN set */
export const hasPosPin = (userId: string): boolean => {
  const store = readJSON<Record<string, string>>(PIN_STORE_KEY, {});
  return !!store[userId];
};

/** Verify a PIN for a given user */
export const verifyPosPin = (userId: string, pin: string): boolean => {
  const store = readJSON<Record<string, string>>(PIN_STORE_KEY, {});
  return store[userId] === pin;
};

// ─── Access Logging ───────────────────────────────────────────────────────────

export interface PosAccessEntry {
  id: string;
  userId: string;
  userName: string;
  userRole: string;
  action: 'login' | 'logout' | 'timeout';
  timestamp: string;
  outlet?: string;
}

export const logPosAccess = (entry: Omit<PosAccessEntry, 'id'>): void => {
  const log = readJSON<PosAccessEntry[]>(ACCESS_LOG_KEY, []);
  const newEntry: PosAccessEntry = {
    id: `POS_ACC_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    ...entry,
  };
  writeJSON(ACCESS_LOG_KEY, [newEntry, ...log].slice(0, 2000));
};

export const getPosAccessLog = (): PosAccessEntry[] =>
  readJSON<PosAccessEntry[]>(ACCESS_LOG_KEY, []);

// ─── Active POS Session ───────────────────────────────────────────────────────

export interface PosOperatorSession {
  userId: string;
  userName: string;
  userRole: string;
  loginAt: string;
  expiresAt: string;
  outlet?: string;
}

export const startPosSession = (operator: { userId: string; userName: string; userRole: string; outlet?: string }): PosOperatorSession => {
  const now = new Date();
  const session: PosOperatorSession = {
    ...operator,
    loginAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + SESSION_TIMEOUT_MS).toISOString(),
  };
  writeJSON(SESSION_KEY, session);
  logPosAccess({ ...operator, action: 'login', timestamp: now.toISOString() });
  return session;
};

export const getPosSession = (): PosOperatorSession | null => {
  const sess = readJSON<PosOperatorSession | null>(SESSION_KEY, null);
  if (!sess) return null;
  if (new Date() > new Date(sess.expiresAt)) {
    logPosAccess({ userId: sess.userId, userName: sess.userName, userRole: sess.userRole, action: 'timeout', timestamp: new Date().toISOString() });
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
  return sess;
};

/** Touch the session to reset its expiry */
export const touchPosSession = (): void => {
  const sess = getPosSession();
  if (!sess) return;
  sess.expiresAt = new Date(Date.now() + SESSION_TIMEOUT_MS).toISOString();
  writeJSON(SESSION_KEY, sess);
};

export const endPosSession = (): void => {
  const sess = readJSON<PosOperatorSession | null>(SESSION_KEY, null);
  if (sess) {
    logPosAccess({ userId: sess.userId, userName: sess.userName, userRole: sess.userRole, action: 'logout', timestamp: new Date().toISOString() });
  }
  localStorage.removeItem(SESSION_KEY);
};

export default {
  setPosPin, clearPosPin, hasPosPin, verifyPosPin,
  logPosAccess, getPosAccessLog,
  startPosSession, getPosSession, touchPosSession, endPosSession,
};
