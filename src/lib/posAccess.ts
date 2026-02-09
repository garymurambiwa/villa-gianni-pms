export type AccessUser = { id?: string; role?: string; username?: string } | null | undefined
export type AccessSession = { userId?: string; expiresAt?: number } | null | undefined

export function normalizeRole(role?: string) {
  return String(role || '').toLowerCase()
}

export function shouldDenyPosSettings(
  user: AccessUser,
  session: AccessSession,
  prevPriv: { role?: string } | null | undefined,
  canManagePOS: (role?: string) => boolean
) {
  const uname = String((user as any)?.username || '').toLowerCase()
  if (uname === 'admin') return null
  const roleNow = normalizeRole(user?.role)
  const rolePrev = normalizeRole(prevPriv?.role)
  if (!session) return 'session_invalid'
  const reducedFromAdmin = rolePrev === 'admin' && roleNow !== 'admin'
  const reducedFromManager = rolePrev === 'posmanager' && roleNow !== 'posmanager' && roleNow !== 'admin'
  if (reducedFromAdmin || reducedFromManager) return 'privilege_reduced'
  const allowed = canManagePOS(user?.role)
  if (!allowed) return 'denied'
  return null
}
