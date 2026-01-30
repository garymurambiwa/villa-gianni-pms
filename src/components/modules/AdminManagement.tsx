import React from 'react'
import { useAuth } from '@/context/AuthContext'
import { searchUsers, getAdminStatus, setAdminStatus, listAudit } from '@/lib/adminService'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import BackToFOSettingsButton from '@/components/modules/common/BackToFOSettingsButton'
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

const ConfirmDialog: React.FC<{ open: boolean; onCancel: () => void; onConfirm: () => void; message: string }> = ({ open, onCancel, onConfirm, message }) => {
  if (!open) return null
  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-lg p-6 max-w-md w-full">
        <h3 className="text-lg font-semibold mb-2">Confirm Change</h3>
        <p className="text-sm text-gray-600 mb-4">{message}</p>
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button variant="default" onClick={onConfirm}>Confirm</Button>
        </div>
      </div>
    </div>
  )
}

export const AdminManagement: React.FC = () => {
  const { user } = useAuth()
  const [query, setQuery] = React.useState('')
  const [results, setResults] = React.useState<ProfileRow[]>([])
  const [selected, setSelected] = React.useState<ProfileRow | null>(null)
  const [isAdmin, setIsAdmin] = React.useState<boolean>(false)
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const [pendingToggle, setPendingToggle] = React.useState<boolean | null>(null)
  const [audits, setAudits] = React.useState<any[]>([])

  const performSearch = async () => {
    try {
      logger.debug('AdminManagement.performSearch query=', query)
      const res: any = await searchUsers(query)
      if (Array.isArray(res)) setResults(res)
      else {
        logger.warn('AdminManagement.performSearch error=', res?.error)
        toast({ title: 'Search Error', description: res?.error || 'Could not search users', variant: 'destructive' })
      }
    } catch (err: any) {
      const msg = String(err?.message || err)
      logger.error('AdminManagement.performSearch exception=', msg)
      toast({ title: 'Search Error', description: msg, variant: 'destructive' })
    }
  }

  const handleSelect = async (row: ProfileRow) => {
    try {
      setSelected(row)
      const status = await getAdminStatus(row.id)
      if (status?.error) logger.warn('AdminManagement.getAdminStatus error=', status.error)
      setIsAdmin(!!status?.isAdmin)
    } catch (err: any) {
      const msg = String(err?.message || err)
      logger.error('AdminManagement.getAdminStatus exception=', msg)
      toast({ title: 'Status Error', description: msg, variant: 'destructive' })
    }
  }

  const handleToggleClick = () => {
    if (!selected) return
    const next = !isAdmin
    setPendingToggle(next)
    setConfirmOpen(true)
  }

  const handleConfirm = async () => {
    try {
      if (pendingToggle === null || !selected) return
      setConfirmOpen(false)
      const res = await setAdminStatus({ targetUserId: selected.id, makeAdmin: pendingToggle, actorUserId: user?.id, reason: `UI toggle by ${user?.username || 'user'}` })
      if (res.ok) {
        setIsAdmin(pendingToggle)
        toast({ title: 'Saved', description: `Admin ${pendingToggle ? 'granted' : 'revoked'} for ${selected.full_name || selected.email}` })
        const a = await listAudit()
        if (Array.isArray(a)) setAudits(a)
      } else {
        logger.error('AdminManagement.setAdminStatus failed=', res.error)
        toast({ title: 'Save Failed', description: res.error || 'Could not save change', variant: 'destructive' })
      }
    } catch (err: any) {
      const msg = String(err?.message || err)
      logger.error('AdminManagement.handleConfirm exception=', msg)
      toast({ title: 'Save Failed', description: msg, variant: 'destructive' })
    }
  }

  React.useEffect(() => {
    listAudit()
      .then(a => { if (Array.isArray(a)) setAudits(a) })
      .catch((err: any) => {
        const msg = String(err?.message || err)
        logger.warn('AdminManagement.listAudit exception=', msg)
      })
  }, [])

  return (
    <div className="p-6">
      <div className="sticky top-0 z-20 bg-white/90 backdrop-blur border-b px-6 -mx-6 py-3 mb-4 flex items-center gap-3">
        <BackToFOSettingsButton />
        <h2 className="text-2xl font-bold">Admin Management</h2>
      </div>
      <div className="max-w-4xl mx-auto bg-white rounded-lg shadow p-6">
        <p className="text-sm text-gray-600 mb-6">Search users and toggle admin privileges without SQL.</p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end mb-6">
          <div className="md:col-span-2">
            <Label htmlFor="search">Username or Email</Label>
            <Input id="search" placeholder="Search by name or email" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <Button onClick={performSearch}>Search</Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h3 className="text-lg font-semibold mb-2">Results</h3>
            <div className="border rounded-md overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left">Name</th>
                    <th className="px-3 py-2 text-left">Email</th>
                    <th className="px-3 py-2 text-left">Role</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map(r => (
                    <tr key={r.id} className={`cursor-pointer hover:bg-gray-100 ${selected?.id === r.id ? 'bg-blue-50' : ''}`} onClick={() => handleSelect(r)}>
                      <td className="px-3 py-2">{r.full_name || '—'}</td>
                      <td className="px-3 py-2">{r.email || '—'}</td>
                      <td className="px-3 py-2">{r.role || '—'}</td>
                    </tr>
                  ))}
                  {results.length === 0 && (
                    <tr><td className="px-3 py-4 text-gray-500" colSpan={3}>No results</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h3 className="text-lg font-semibold mb-2">Admin Toggle</h3>
            {selected ? (
              <div className="space-y-3">
                <div>
                  <Label>User</Label>
                  <div className="p-3 border rounded-md">
                    <div className="font-medium">{selected.full_name || selected.email || selected.id}</div>
                    <div className="text-xs text-gray-600">ID: {selected.id}</div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <input id="admin-toggle" type="checkbox" checked={isAdmin} onChange={handleToggleClick} className="w-5 h-5" />
                  <Label htmlFor="admin-toggle">Admin status</Label>
                </div>
                <div>
                  <Button onClick={() => { setPendingToggle(isAdmin); setConfirmOpen(true); }}>Save Changes</Button>
                </div>
                <p className="text-xs text-gray-500">Changes are audited and applied immediately.</p>
              </div>
            ) : (
              <p className="text-sm text-gray-600">Select a user from search results to manage admin status.</p>
            )}
          </div>
        </div>

        <div className="mt-8">
          <h3 className="text-lg font-semibold mb-2">Audit Trail</h3>
          <div className="border rounded-md overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left">Timestamp</th>
                  <th className="px-3 py-2 text-left">Action</th>
                  <th className="px-3 py-2 text-left">Target</th>
                  <th className="px-3 py-2 text-left">Actor</th>
                  <th className="px-3 py-2 text-left">Reason</th>
                </tr>
              </thead>
              <tbody>
                {audits.map((a, idx) => (
                  <tr key={idx}>
                    <td className="px-3 py-2">{a.timestamp}</td>
                    <td className="px-3 py-2">{a.type}</td>
                    <td className="px-3 py-2">{a.targetUserId}</td>
                    <td className="px-3 py-2">{a.actorUserId || '—'}</td>
                    <td className="px-3 py-2">{a.reason || '—'}</td>
                  </tr>
                ))}
                {audits.length === 0 && (
                  <tr><td className="px-3 py-4 text-gray-500" colSpan={5}>No audit entries yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={handleConfirm}
        message={`Are you sure you want to ${pendingToggle ? 'grant' : 'revoke'} admin for ${selected?.full_name || selected?.email}?`}
      />
    </div>
  )
}

export default AdminManagement
