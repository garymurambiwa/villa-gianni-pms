import React from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import taxSvc, { TaxRecord } from '@/lib/taxService'

const appliesOptions: Array<{ label: string; value: 'all'|'accommodation'|'pos'|'services' }> = [
  { label: 'All', value: 'all' },
  { label: 'Accommodation', value: 'accommodation' },
  { label: 'POS', value: 'pos' },
  { label: 'Services', value: 'services' },
]

const AccountingTaxConfiguration: React.FC = () => {
  const [taxes, setTaxes] = React.useState<TaxRecord[]>([])
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState('')
  const [percentage, setPercentage] = React.useState('')
  const [isInclusive, setIsInclusive] = React.useState<'inclusive'|'exclusive'>('exclusive')
  const [appliesTo, setAppliesTo] = React.useState<'all'|'accommodation'|'pos'|'services'>('all')
  const [busy, setBusy] = React.useState(false)
  const [err, setErr] = React.useState('')
  const [edit, setEdit] = React.useState<TaxRecord | null>(null)

  const refresh = async () => {
    const list = await taxSvc.listTaxes()
    setTaxes(list)
  }
  React.useEffect(() => { refresh() }, [])

  const resetForm = () => { setName(''); setPercentage(''); setIsInclusive('exclusive'); setAppliesTo('all'); setErr('') }
  const openForm = () => { resetForm(); setEdit(null); setOpen(true) }
  const closeForm = () => { setOpen(false) }

  const create = async () => {
    setBusy(true); setErr('')
    try {
      const pct = Number(percentage)
      if (!name || !Number.isFinite(pct)) { setErr('Provide name and percentage'); setBusy(false); return }
      const res = await taxSvc.createTax({ name, percentage: pct, is_inclusive: isInclusive === 'inclusive', applies_to: appliesTo })
      if (!res.ok) { setErr(res.error || 'Failed to create tax'); setBusy(false); return }
      closeForm(); await refresh()
    } catch (e: unknown) { setErr(String((e as Error)?.message || e)); } finally { setBusy(false) }
  }

  const startEdit = (t: TaxRecord) => {
    setEdit(t)
    setName(t.name)
    setPercentage(String(t.percentage))
    setIsInclusive(t.is_inclusive ? 'inclusive' : 'exclusive')
    setAppliesTo(t.applies_to)
    setErr('')
    setOpen(true)
  }

  const saveEdit = async () => {
    if (!edit) return
    setBusy(true); setErr('')
    try {
      const pct = Number(percentage)
      if (!name || !Number.isFinite(pct)) { setErr('Provide name and percentage'); setBusy(false); return }
      const res = await taxSvc.updateTax(edit.id, { name, percentage: pct, is_inclusive: isInclusive === 'inclusive', applies_to: appliesTo })
      if (!res.ok) { setErr(res.error || 'Failed to update tax'); setBusy(false); return }
      closeForm(); await refresh()
    } catch (e: unknown) { setErr(String((e as Error)?.message || e)); } finally { setBusy(false) }
  }

  const toggleActive = async (id: string, active: boolean) => { await taxSvc.toggleTaxActive(id, active); await refresh() }
  const remove = async (id: string) => {
    if (!window.confirm('Delete this tax? This cannot be undone.')) return
    const res = await taxSvc.deleteTax(id)
    if (!res.ok) { setErr(res.error || 'Failed to delete'); return }
    await refresh()
  }

  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-4">
        <h2 className="text-2xl font-bold">Accounting • Tax Configuration</h2>
        <Button onClick={openForm} className="bg-blue-600 text-white hover:bg-blue-700">Add New Tax</Button>
      </div>
      <div className="bg-white rounded shadow">
        <table className="w-full">
          <thead>
            <tr>
              <th className="text-left p-3">Name</th>
              <th className="text-left p-3">Rate (%)</th>
              <th className="text-left p-3">Type</th>
              <th className="text-left p-3">Applies To</th>
              <th className="text-left p-3">Active</th>
              <th className="text-right p-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {taxes.map(t => (
              <tr key={t.id} className="border-t">
                <td className="p-3">{t.name}</td>
                <td className="p-3">{Number(t.percentage).toFixed(2)}</td>
                <td className="p-3">{t.is_inclusive ? 'Inclusive' : 'Exclusive'}</td>
                <td className="p-3">{t.applies_to}</td>
                <td className="p-3">{t.active ? 'Enabled' : 'Disabled'}</td>
                <td className="p-3 text-right">
                  <div className="flex gap-2 justify-end">
                    <Button variant="outline" onClick={() => startEdit(t)}>Edit</Button>
                    <Button variant="outline" onClick={() => toggleActive(t.id, !t.active)}>{t.active ? 'Disable' : 'Enable'}</Button>
                    <Button variant="destructive" onClick={() => remove(t.id)}>Delete</Button>
                  </div>
                </td>
              </tr>
            ))}
            {taxes.length === 0 && (
              <tr><td className="p-3 text-gray-500" colSpan={6}>No taxes configured</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {open && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white w-full max-w-md rounded-xl shadow-xl p-6">
            <h3 className="text-lg font-semibold mb-2">{edit ? 'Edit Tax' : 'Add New Tax'}</h3>
            {err && (<div className="p-2 mb-2 rounded bg-red-50 text-red-700 text-sm">{err}</div>)}
            <label className="text-sm">Name</label>
            <Input value={name} onChange={e=> setName(e.target.value)} />
            <label className="text-sm mt-2">Rate (%)</label>
            <Input value={percentage} onChange={e=> setPercentage(e.target.value)} />
            <div className="mt-2">
              <label className="text-sm">Type</label>
              <Select value={isInclusive} onValueChange={(v: 'exclusive'|'inclusive')=> setIsInclusive(v)}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="exclusive">Exclusive</SelectItem>
                  <SelectItem value="inclusive">Inclusive</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="mt-2">
              <label className="text-sm">Applies To</label>
              <Select value={appliesTo} onValueChange={(v: 'all'|'accommodation'|'pos'|'services')=> setAppliesTo(v)}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  {appliesOptions.map(o => (<SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div className="mt-4 flex items-center gap-2 justify-end">
              <Button variant="outline" onClick={closeForm}>Cancel</Button>
              <Button onClick={edit ? saveEdit : create} disabled={busy} className="bg-blue-600 text-white hover:bg-blue-700">{busy ? 'Saving…' : (edit ? 'Update' : 'Save')}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default AccountingTaxConfiguration
