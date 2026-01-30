import { requireSupabase } from './supabaseClient'
import type { User } from '@/types'

export type ProfileRow = {
  id: string
  email: string | null
  full_name: string | null
  role: string | null
  property_id: string | null
  is_active: boolean | null
}

export async function getProfile(userId: string): Promise<ProfileRow | null> {
  const sb = requireSupabase()
  const { data, error } = await sb
    .from('profiles')
    .select('id,email,full_name,role,property_id,is_active')
    .eq('id', userId)
    .single()
  if (error) return null
  return (data as ProfileRow) || null
}

export async function mergeUserWithProfile(user: User): Promise<User> {
  try {
    const profile = await getProfile(user.id)
    if (!profile) return user
    const usernameFromEmail = (profile.email || '')?.split('@')[0] || user.username
    return {
      ...user,
      username: usernameFromEmail,
      name: profile.full_name || user.name,
      role: (profile.role as any) || user.role,
      propertyId: profile.property_id || user.propertyId,
      active: profile.is_active ?? user.active,
    }
  } catch {
    return user
  }
}

