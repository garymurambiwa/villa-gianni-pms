import { supabase, requireSupabase } from '@/lib/supabaseClient'
import { db } from '@/lib/db'
import { toast } from '@/hooks/use-toast'
import { logger } from '@/lib/logger'

type ProfileRow = {
  id: string
  email: string | null
  full_name: string | null
  role: string | null
  property_id: string | null
  is_active: boolean | null
}

export async function searchUsers(query: string): Promise<ProfileRow[] | { error: string }> {
  // Prefer secure Electron IPC if available
  const native: any = (window as any).native
  if (native?.admin?.searchUsers) {
    const res = await native.admin.searchUsers(query)
    if ((res as any)?.error) logger.warn('admin.searchUsers via IPC error:', (res as any).error)
    return res
  }
  // Fallback to Supabase anon (read-only)
  try {
    const client = requireSupabase()
    const { data, error } = await client
      .from('profiles')
      .select('id,email,full_name,role,property_id,is_active')
      .or(`email.ilike.%${query}%,full_name.ilike.%${query}%`)
      .limit(25)
    if (error) {
      logger.error('admin.searchUsers supabase error:', error.message)
      throw new Error(error.message)
    }
    return (data as any[]) as ProfileRow[]
  } catch (err: any) {
    // Direct DB fallback for local production environments
    try {
      const configured = await db.isConfigured()
      if (!configured) throw new Error('Search service not configured')
      const term = `%${String(query || '').trim()}%`
      const sql = `SELECT id, email, name AS full_name, role, NULL AS property_id, active AS is_active
                   FROM app_users
                   WHERE lower(username) LIKE lower(?) OR lower(email) LIKE lower(?)
                   ORDER BY updated_at DESC
                   LIMIT 25`
      const res = await db.query<ProfileRow>(sql, [term, term])
      if ('error' in res) throw new Error(res.error)
      return res.rows as any
    } catch (fallbackErr: any) {
      const msg = String(fallbackErr?.message || fallbackErr)
      logger.error('admin.searchUsers db fallback failed:', msg)
      return { error: msg }
    }
  }
}

export async function getAdminStatus(userId: string): Promise<{ isAdmin: boolean; error?: string }> {
  const native: any = (window as any).native
  if (native?.admin?.getAdminStatus) {
    const res = await native.admin.getAdminStatus(userId)
    if ((res as any)?.error) logger.warn('admin.getAdminStatus via IPC error:', (res as any).error)
    return res
  }
  // Fallback: check via anon (may be blocked by RLS)
  try {
    const client = requireSupabase()
    const { data, error } = await client.from('admins').select('user_id').eq('user_id', userId).maybeSingle()
    if (error) {
      logger.warn('admin.getAdminStatus supabase error:', error.message)
      return { isAdmin: false, error: error.message }
    }
    return { isAdmin: !!data }
  } catch (err: any) {
    const msg = String(err?.message || err)
    logger.error('admin.getAdminStatus exception:', msg)
    return { isAdmin: false, error: msg }
  }
}

export async function setAdminStatus(payload: { targetUserId: string; makeAdmin: boolean; actorUserId?: string; reason?: string }): Promise<{ ok: boolean; error?: string }> {
  const native: any = (window as any).native
  if (native?.admin?.setAdminStatus) {
    const res = await native.admin.setAdminStatus(payload)
    if (!res?.ok) logger.error('admin.setAdminStatus via IPC failed:', res?.error)
    return res
  }
  // Fallback: forbid client-side writes
  const msg = 'Admin status change requires secure backend. Configure Electron or server API.'
  logger.warn('admin.setAdminStatus fallback:', msg)
  toast({ title: 'Not Configured', description: msg })
  return { ok: false, error: msg }
}

export async function listAudit(): Promise<any[] | { error: string }> {
  const native: any = (window as any).native
  if (native?.admin?.listAudit) {
    const res = await native.admin.listAudit()
    if ((res as any)?.error) logger.warn('admin.listAudit via IPC error:', (res as any).error)
    return res
  }
  logger.info('admin.listAudit fallback: returning empty list')
  return []
}
