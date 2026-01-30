import React from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/hooks/use-toast'
import { addTask, deleteTask, listTasks, subscribeToTasks, toggleTask, isRealtimeAvailable, type Task } from '@/lib/tasks'
import { supabase } from '@/lib/supabaseClient'

const Tasks: React.FC = () => {
  const { toast } = useToast()
  const [items, setItems] = React.useState<Task[]>([])
  const [title, setTitle] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [ready, setReady] = React.useState<boolean>(!!supabase)

  const load = React.useCallback(async () => {
    if (!supabase) return
    setLoading(true)
    try {
      const data = await listTasks()
      setItems(data)
    } catch (err) {
      toast({ title: 'Failed to load tasks', description: String(err), variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [toast])

  React.useEffect(() => {
    setReady(!!supabase)
    if (!supabase) return
    load()
    const unsubscribe = subscribeToTasks((c) => {
      setItems((prev) => {
        switch (c.type) {
          case 'INSERT': return [c.new as Task, ...prev]
          case 'UPDATE': return prev.map((t) => (t.id === (c.new as Task)?.id ? (c.new as Task) : t))
          case 'DELETE': return prev.filter((t) => t.id !== (c.old as Task)?.id)
          default: return prev
        }
      })
    })
    return () => unsubscribe()
  }, [load])

  const onAdd = async () => {
    if (!title.trim()) { toast({ title: 'Title required', description: 'Enter a task title.', variant: 'destructive' }); return }
    try {
      await addTask(title.trim())
      setTitle('')
      if (!isRealtimeAvailable()) await load()
    } catch (err) {
      toast({ title: 'Add failed', description: String(err), variant: 'destructive' })
    }
  }

  const onToggle = async (id: string, completed: boolean) => {
    try {
      await toggleTask(id, completed)
      if (!isRealtimeAvailable()) await load()
    } catch (err) {
      toast({ title: 'Update failed', description: String(err), variant: 'destructive' })
    }
  }

  const onDelete = async (id: string) => {
    try {
      await deleteTask(id)
      if (!isRealtimeAvailable()) await load()
    } catch (err) {
      toast({ title: 'Delete failed', description: String(err), variant: 'destructive' })
    }
  }

  if (!ready) {
    return (
      <div className="p-6">
        <div className="max-w-2xl mx-auto bg-card border rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-2">Cloud not configured</h2>
          <p className="text-sm text-muted-foreground">Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, then sign in via Supabase Auth to use real-time tasks.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6">
      <div className="max-w-2xl mx-auto">
        <div className="mb-6 bg-card border rounded-lg p-4">
          <h2 className="text-lg font-semibold mb-3">My Tasks</h2>
          <div className="flex gap-2">
            <Input placeholder="Task title" value={title} onChange={(e) => setTitle(e.target.value)} />
            <Button onClick={onAdd} disabled={!title.trim()}>Add</Button>
            <Button variant="outline" onClick={load} disabled={loading}>Refresh</Button>
          </div>
        </div>

        <ul className="space-y-2">
          {items.map((t) => (
            <li key={t.id} className="flex items-center gap-3 bg-card border rounded-lg p-3">
              <input
                type="checkbox"
                checked={t.completed}
                onChange={(e) => onToggle(t.id, e.target.checked)}
              />
              <div className={`flex-1 ${t.completed ? 'line-through text-muted-foreground' : ''}`}>{t.title}</div>
              <Button variant="destructive" onClick={() => onDelete(t.id)}>Delete</Button>
            </li>
          ))}
          {!items.length && (
            <li className="text-sm text-muted-foreground">No tasks yet. Add one above.</li>
          )}
        </ul>
      </div>
    </div>
  )
}

export default Tasks
