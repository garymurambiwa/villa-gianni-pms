import pmsAuthDb from '@/lib/pmsAuthDb'

export type RegistrationPayload = { username: string; email: string; password: string; name: string; role: string }

const STRONG_PW = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^\da-zA-Z]).{8,}$/

export const userMgmtService = {
  validateEmail(email: string) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) },
  validatePassword(pw: string) { return STRONG_PW.test(pw) },

  async register(payload: RegistrationPayload): Promise<{ ok: boolean; error?: string; token?: string }>{
    const clean = {
      username: String(payload.username || '').trim(),
      email: String(payload.email || '').trim(),
      password: String(payload.password || ''),
      name: String(payload.name || '').trim(),
      role: String(payload.role || 'frontdesk').trim(),
    }
    if (!this.validateEmail(clean.email)) return { ok: false, error: 'Invalid email' }
    if (!this.validatePassword(clean.password)) return { ok: false, error: 'Weak password' }
    const res = await pmsAuthDb.registerUser(clean)
    return { ok: res.ok, error: res.error, token: res.verifyToken }
  },

  async resendVerification(usernameOrEmail: string): Promise<{ ok: boolean; error?: string; token?: string }>{
    const res = await pmsAuthDb.resendVerification(String(usernameOrEmail).trim())
    return { ok: res.ok, error: res.error, token: res.verifyToken }
  },

  async verifyEmail(token: string): Promise<{ ok: boolean; error?: string }>{
    return pmsAuthDb.verifyEmail(String(token || '').trim())
  },

  async login(username: string, password: string): Promise<{ ok: boolean; error?: string; accessToken?: string; refreshToken?: string; sessionId?: string }>{
    const res = await pmsAuthDb.verifyLogin(String(username || '').trim(), String(password || ''))
    if (!res.ok || !res.user) return { ok: false, error: 'INVALID' }
    try {
      const tokens = await (window as any).native?.auth?.issueTokens?.({ userId: res.user.id, role: res.user.role, userAgent: navigator.userAgent })
      if (!tokens?.ok) return { ok: false, error: tokens?.error || 'TOKEN_FAIL' }
      return { ok: true, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, sessionId: tokens.sessionId }
    } catch {
      return { ok: false, error: 'TOKEN_FAIL' }
    }
  },

  async refresh(sessionId: string, refreshToken: string, userId: string, role: string) {
    return (window as any).native?.auth?.refresh?.({ sessionId, refreshToken, userId, role })
  },
  async revoke(sessionId: string) {
    return (window as any).native?.auth?.revokeSession?.({ sessionId })
  },
}

export default userMgmtService