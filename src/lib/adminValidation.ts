// Super admin authorization validation (server-side stub)
// In production, this should call a secure backend to validate codes and enforce rate limiting/IP allowlists.

import { hashPassword, verifyPassword } from '@/lib/authService';

const K_SUPERADMIN_CODE = 'corepms_superadmin_code_hash';
const K_SUPERADMIN_META = 'corepms_superadmin_code_meta';
const K_VALIDATE_ATTEMPTS = 'corepms_superadmin_validate_attempts';

const readJSON = <T>(key: string, fallback: T): T => { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; } };
const writeJSON = (key: string, value: any) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };

export const setSuperAdminCode = async (code: string) => {
  if (!code || code.length < 16) throw new Error('Code must be at least 16 characters');
  const hashed = await hashPassword(code);
  writeJSON(K_SUPERADMIN_CODE, hashed);
};

export const setSuperAdminCodeFor = async (adminId: string, code: string) => {
  await setSuperAdminCode(code);
  writeJSON(K_SUPERADMIN_META, { adminId, setAt: new Date().toISOString() });
};

export const getSuperAdminMeta = () => readJSON<{ adminId: string; setAt: string }|null>(K_SUPERADMIN_META, null);

export const validateSuperAdminCode = async (adminId: string, code: string): Promise<{ ok:boolean; error?: string }> => {
  // Rate limiting: max 5 attempts per 10 minutes
  const attempts = readJSON<{ ts:number; count:number }>(K_VALIDATE_ATTEMPTS, { ts: Date.now(), count: 0 });
  const now = Date.now();
  if (now - attempts.ts > 10 * 60 * 1000) { attempts.ts = now; attempts.count = 0; }
  attempts.count += 1; writeJSON(K_VALIDATE_ATTEMPTS, attempts);
  if (attempts.count > 5) return { ok:false, error:'Too many attempts. Try again later.' };

  const stored = readJSON<{ salt:string; hash:string; iterations:number; derivedLen:number }|null>(K_SUPERADMIN_CODE, null);
  if (!stored) return { ok:false, error:'Authorization code not configured' };
  // Basic format validation
  if (!/^[A-Za-z0-9!@#$%^&*()_+\-={}:;"'<>?,.]{16,}$/.test(code)) return { ok:false, error:'Invalid code format' };
  const ok = await verifyPassword(code, stored);
  return ok ? { ok:true } : { ok:false, error:'Invalid authorization code' };
};

export default { setSuperAdminCode, validateSuperAdminCode };
export const __meta = { getSuperAdminMeta, setSuperAdminCodeFor };
