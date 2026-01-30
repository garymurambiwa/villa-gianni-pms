import { requireSupabase } from './supabaseClient'

export type Task = {
  id: string
  user_id: string
  title: string
  completed: boolean
  inserted_at: string
}

async function getCurrentUserId(): Promise<string> {
  const sb = requireSupabase()
  const { data, error } = await sb.auth.getUser()
  if (error) throw error
  const user = data?.user
  if (!user) throw new Error('Not authenticated')
  return user.id
}

export async function listTasks(): Promise<Task[]> {
  const sb = requireSupabase()
  // RLS restricts rows by user; order by newest first
  const { data, error } = await sb
    .from('tasks')
    .select('*')
    .order('inserted_at', { ascending: false })
  if (error) throw error
  return (data || []) as Task[]
}

export async function addTask(title: string): Promise<Task> {
  const sb = requireSupabase()
  const userId = await getCurrentUserId()
  const { data, error } = await sb
    .from('tasks')
    .insert({ title, user_id: userId })
    .select()
    .single()
  if (error) throw error
  return data as Task
}

export async function toggleTask(id: string, completed: boolean): Promise<Task> {
  const sb = requireSupabase()
  const { data, error } = await sb
    .from('tasks')
    .update({ completed })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data as Task
}

export async function deleteTask(id: string): Promise<void> {
  const sb = requireSupabase()
  const { error } = await sb
    .from('tasks')
    .delete()
    .eq('id', id)
  if (error) throw error
}

export type TaskChange = { type: 'INSERT' | 'UPDATE' | 'DELETE'; new?: Task; old?: Task }

export function subscribeToTasks(onChange: (change: TaskChange) => void): () => void {
  const sb = requireSupabase()
  // Gracefully handle environments where realtime is unavailable (mock/offline)
  const hasRealtime = typeof (sb as any)?.channel === 'function' && typeof (sb as any)?.removeChannel === 'function'
  if (!hasRealtime) {
    try { console.warn('Supabase realtime unavailable: subscribeToTasks is a no-op in this mode.') } catch {}
    return () => {}
  }
  const channel = sb
    .channel('realtime:tasks')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, (payload: any) => {
      const { eventType, new: n, old: o } = payload
      onChange({ type: eventType as TaskChange['type'], new: n, old: o })
    })
  channel.subscribe(() => {})
  return () => {
    sb.removeChannel(channel)
  }
}

export function isRealtimeAvailable(): boolean {
  try {
    const sb = requireSupabase()
    return typeof (sb as any)?.channel === 'function' && typeof (sb as any)?.removeChannel === 'function'
  } catch {
    return false
  }
}
