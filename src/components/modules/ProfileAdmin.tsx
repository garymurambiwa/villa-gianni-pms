import React from 'react'
import { useAuth } from '@/context/AuthContext'
import { requireSupabase } from '@/lib/supabaseClient'
import type { UserRole } from '@/types'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import BackToFOSettingsButton from '@/components/modules/common/BackToFOSettingsButton'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'

type ProfileRow = {
  id: string
  email: string | null
  full_name: string | null
  role: UserRole | null
  property_id: string | null
  is_active: boolean | null
  inserted_at?: string
}

const roleOptions: UserRole[] = ['admin','frontdesk','auditor','posmanager','housekeeping','manager']

const ProfileAdmin: React.FC = () => {
  const { user } = useAuth()
  const [rows, setRows] = React.useState<ProfileRow[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string>('')
  const [creating, setCreating] = React.useState(false)
  const [newRow, setNewRow] = React.useState<ProfileRow>({ id: '', email: '', full_name: '', role: 'manager', property_id: '', is_active: true })
  const [adminStatus, setAdminStatus] = React.useState<'unknown' | 'active' | 'missing'>('unknown')
  const [checkingAdmin, setCheckingAdmin] = React.useState(false)
  const [propertyFilter, setPropertyFilter] = React.useState<string>('')
  const [showInstructions, setShowInstructions] = React.useState(false)
  const [roleFilter, setRoleFilter] = React.useState<UserRole | ''>('')
  const [searchQuery, setSearchQuery] = React.useState<string>('')

  const isAdmin = (user?.role || '').toLowerCase() === 'admin'

  const load = async () => {
    setLoading(true); setError('')
    try {
      const sb = requireSupabase()
      let query = sb
        .from('profiles')
        .select('id,email,full_name,role,property_id,is_active,inserted_at')
        .order('inserted_at', { ascending: false })
      if (propertyFilter.trim()) {
        query = query.eq('property_id', propertyFilter.trim())
      }
      if (roleFilter) {
        query = query.eq('role', roleFilter)
      }
      if (searchQuery.trim()) {
        const term = `%${searchQuery.trim()}%`
        query = query.or(`email.ilike.${term},full_name.ilike.${term}`)
      }
      const { data, error: err } = await query
      if (err) throw err
      setRows((data || []) as ProfileRow[])
    } catch (e: any) {
      setError('Failed to load profiles. Ensure admin override is configured.')
    } finally {
      setLoading(false)
    }
  }

  const checkAdminMembership = async () => {
    setCheckingAdmin(true)
    try {
      const sb = requireSupabase()
      const { data, error: err } = await sb
        .from('admins')
        .select('user_id')
        .eq('user_id', user?.id || '')
      if (err) throw err
      const hasRow = Array.isArray(data) && data.length > 0
      setAdminStatus(hasRow ? 'active' : 'missing')
    } catch {
      setAdminStatus('missing')
    } finally {
      setCheckingAdmin(false)
    }
  }

  React.useEffect(() => {
    if (isAdmin) {
      checkAdminMembership()
      load()
    }
  }, [isAdmin])

  // Debounce filters/search to reduce manual reloads
  React.useEffect(() => {
    if (!isAdmin) return
    const t = setTimeout(() => {
      load()
    }, 500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyFilter, roleFilter, searchQuery, isAdmin])

  const saveRow = async (row: ProfileRow) => {
    try {
      const sb = requireSupabase()
      const payload = {
        id: row.id,
        email: row.email,
        full_name: row.full_name,
        role: row.role,
        property_id: row.property_id,
        is_active: row.is_active,
      }
      const { error: err } = await sb
        .from('profiles')
        .update(payload)
        .eq('id', row.id)
      if (err) throw err
      setRows(prev => prev.map(r => (r.id === row.id ? { ...r, ...payload } : r)))
    } catch (e: any) {
      setError('Save failed. Check RLS and your admin membership.')
    }
  }

  const createRow = async () => {
    setCreating(true); setError('')
    try {
      const sb = requireSupabase()
      const payload = {
        id: newRow.id,
        email: newRow.email,
        full_name: newRow.full_name,
        role: newRow.role,
        property_id: newRow.property_id,
        is_active: newRow.is_active ?? true,
      }
      const { error: err } = await sb
        .from('profiles')
        .insert(payload)
      if (err) throw err
      setRows(prev => [payload as ProfileRow, ...prev])
      setNewRow({ id: '', email: '', full_name: '', role: 'manager', property_id: '', is_active: true })
    } catch (e: any) {
      setError('Create failed. Validate UID and admin override.')
    } finally {
      setCreating(false)
    }
  }

  if (!isAdmin) {
    return (
      <div className="p-6">
        <div className="max-w-xl mx-auto bg-white shadow rounded-lg p-6 text-center">
          <h2 className="text-xl font-semibold mb-2">Access Denied</h2>
          <p className="text-sm text-gray-600">You do not have permission to access Profile Admin.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-4">
        <BackToFOSettingsButton />
        <h2 className="text-2xl font-bold">Profile Admin</h2>
      </div>
      <Dialog open={showInstructions} onOpenChange={setShowInstructions}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Admin Setup Instructions</DialogTitle>
            <DialogDescription>
              To enable admin override, add your UID to <code>public.admins</code> using the Supabase SQL editor. Only service role or privileged SQL should perform this operation.
            </DialogDescription>
          </DialogHeader>
          <ol className="list-decimal list-inside text-sm text-foreground mb-3">
            <li>Open Supabase dashboard → SQL editor.</li>
            <li>Paste and run the following statements (replace the placeholders):</li>
          </ol>
          <div className="bg-muted rounded p-3 text-xs mb-3">
            <pre>insert into public.admins (user_id) values ('&lt;AUTH_UID&gt;');</pre>
            <pre>insert into public.profiles (id, email, full_name, role, property_id, is_active) values ('&lt;AUTH_UID&gt;', 'user@example.com', 'Alice Admin', 'admin', 'property-123', true);</pre>
          </div>
          <p className="text-xs text-muted-foreground">After running these, click "Recheck Admin Status" below and then "Reload Profiles".</p>
          <DialogFooter>
            <Button variant="outline" onClick={()=> setShowInstructions(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <div className="mb-4">
        <div className={`p-3 rounded text-sm ${adminStatus === 'active' ? 'bg-green-50 text-green-700' : adminStatus === 'missing' ? 'bg-yellow-50 text-yellow-800' : 'bg-gray-50 text-gray-700'}`}>
          {checkingAdmin ? (
            <>Checking admin membership…</>
          ) : adminStatus === 'active' ? (
            <>Admin status: Active. You can manage all profiles.</>
          ) : (
            <>Admin status: Not registered. Use SQL to add your UID to <code>public.admins</code> (see Supabase README).</>
          )}
        </div>
        <div className="mt-2 flex gap-2 flex-wrap items-end">
          <Button variant="outline" onClick={checkAdminMembership}>Recheck Admin Status</Button>
          <Button variant="outline" onClick={load}>Reload Profiles</Button>
          {adminStatus === 'missing' && (
            <Button variant="outline" onClick={()=> setShowInstructions(true)}>Admin Setup Instructions</Button>
          )}
          <div className="flex items-end gap-2">
            <div>
              <Label htmlFor="pa-filter" className="text-sm">Filter by Property</Label>
              <Input id="pa-filter" value={propertyFilter} onChange={(e)=> setPropertyFilter(e.target.value)} placeholder="property-123" />
            </div>
            <div>
              <Label htmlFor="pa-role" className="text-sm">Filter by Role</Label>
              <select id="pa-role" className="border rounded-md px-3 py-2 w-full" value={roleFilter || ''} onChange={(e)=> setRoleFilter((e.target.value || '') as UserRole | '')}>
                <option value="">Any</option>
                {roleOptions.map(r => (<option key={r} value={r}>{r}</option>))}
              </select>
            </div>
            <div>
              <Label htmlFor="pa-search" className="text-sm">Search name or email</Label>
              <Input id="pa-search" value={searchQuery} onChange={(e)=> setSearchQuery(e.target.value)} placeholder="e.g. alice or @example.com" />
            </div>
            <Button variant="outline" onClick={load}>Apply Filters</Button>
            <Button variant="outline" onClick={()=> { setPropertyFilter(''); setRoleFilter(''); setSearchQuery(''); load(); }}>Clear Filters</Button>
          </div>
        </div>
      </div>
      {error && (<div className="p-3 mb-3 rounded bg-red-50 text-red-700">{error}</div>)}

      <div className="bg-white p-4 rounded shadow mb-6">
        <h3 className="text-lg font-semibold mb-2">Create Profile</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <Label htmlFor="pa-id">User UID</Label>
            <Input id="pa-id" value={newRow.id} onChange={(e)=> setNewRow({ ...newRow, id: e.target.value })} placeholder="auth.users.id" />
          </div>
          <div>
            <Label htmlFor="pa-email">Email</Label>
            <Input id="pa-email" value={newRow.email || ''} onChange={(e)=> setNewRow({ ...newRow, email: e.target.value })} placeholder="user@example.com" />
          </div>
          <div>
            <Label htmlFor="pa-name">Full Name</Label>
            <Input id="pa-name" value={newRow.full_name || ''} onChange={(e)=> setNewRow({ ...newRow, full_name: e.target.value })} placeholder="Display name" />
          </div>
          <div>
            <Label>Role</Label>
            <select className="border rounded-md px-3 py-2 w-full" value={newRow.role || 'manager'} onChange={(e)=> setNewRow({ ...newRow, role: e.target.value as UserRole })}>
              {roleOptions.map(r => (<option key={r} value={r}>{r}</option>))}
            </select>
          </div>
          <div>
            <Label htmlFor="pa-prop">Property ID</Label>
            <Input id="pa-prop" value={newRow.property_id || ''} onChange={(e)=> setNewRow({ ...newRow, property_id: e.target.value })} placeholder="property-123" />
          </div>
          <div className="flex items-center gap-2 mt-6">
            <input id="pa-active" type="checkbox" checked={!!newRow.is_active} onChange={(e)=> setNewRow({ ...newRow, is_active: e.target.checked })} />
            <Label htmlFor="pa-active">Active</Label>
          </div>
        </div>
        <div className="mt-3">
          <Button onClick={createRow} disabled={creating || !newRow.id}>Create Profile</Button>
        </div>
      </div>

      <div className="bg-white rounded shadow overflow-x-auto">
        {loading ? (
          <div className="p-4">Loading profiles…</div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-100">
              <tr>
                <th className="px-4 py-2 text-left text-sm">UID</th>
                <th className="px-4 py-2 text-left text-sm">Email</th>
                <th className="px-4 py-2 text-left text-sm">Full Name</th>
                <th className="px-4 py-2 text-left text-sm">Role</th>
                <th className="px-4 py-2 text-left text-sm">Property</th>
                <th className="px-4 py-2 text-left text-sm">Active</th>
                <th className="px-4 py-2 text-center text-sm">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2 text-xs break-all">{r.id}</td>
                  <td className="px-4 py-2">
                    <Input value={r.email || ''} onChange={(e)=> setRows(prev => prev.map(x => x.id === r.id ? { ...x, email: e.target.value } : x))} />
                  </td>
                  <td className="px-4 py-2">
                    <Input value={r.full_name || ''} onChange={(e)=> setRows(prev => prev.map(x => x.id === r.id ? { ...x, full_name: e.target.value } : x))} />
                  </td>
                  <td className="px-4 py-2">
                    <select className="border rounded-md px-3 py-2 w-full" value={r.role || ''} onChange={(e)=> setRows(prev => prev.map(x => x.id === r.id ? { ...x, role: e.target.value as UserRole } : x))}>
                      {roleOptions.map(ro => (<option key={ro} value={ro}>{ro}</option>))}
                    </select>
                  </td>
                  <td className="px-4 py-2">
                    <Input value={r.property_id || ''} onChange={(e)=> setRows(prev => prev.map(x => x.id === r.id ? { ...x, property_id: e.target.value } : x))} />
                  </td>
                  <td className="px-4 py-2 text-center">
                    <input type="checkbox" checked={!!r.is_active} onChange={(e)=> setRows(prev => prev.map(x => x.id === r.id ? { ...x, is_active: e.target.checked } : x))} />
                  </td>
                  <td className="px-4 py-2 text-center">
                    <Button onClick={()=> saveRow(r)}>Save</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

export default ProfileAdmin
