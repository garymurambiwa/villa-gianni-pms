import React, { useEffect, useState } from 'react';
import { useToast } from '@/hooks/use-toast';

const CATEGORIES = ['Asset','Liability','Equity','Revenue','Expense'] as const;
type Category = typeof CATEGORIES[number];

interface GLAccount {
  id: string;
  account_number: string;
  name: string;
  category: Category;
}

const EMPTY_FORM: GLAccount = { id: '', account_number: '', name: '', category: 'Asset' };

export const ChartOfAccounts: React.FC = () => {
  const { toast } = useToast();
  const [accounts, setAccounts] = useState<GLAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState<Category | 'All'>('All');
  const [modalOpen, setModalOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [form, setForm] = useState<GLAccount>({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/gl/accounts');
      const d = await r.json();
      if (d.ok) setAccounts(d.rows);
      else toast({ title: 'Failed to load accounts', description: d.error, variant: 'destructive' });
    } catch (e: unknown) {
      toast({ title: 'Network error', description: (e instanceof Error ? e.message : String(e)), variant: 'destructive' });
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const seed = async () => {
    setSeeding(true);
    try {
      const r = await fetch('/api/gl/accounts/seed', { method: 'POST' });
      const d = await r.json();
      if (d.ok) {
        toast({ title: 'Seed complete', description: `${d.upserted} accounts upserted` });
        load();
      } else {
        toast({ title: 'Seed failed', description: d.error, variant: 'destructive' });
      }
    } catch (e: unknown) {
      toast({ title: 'Network error', description: (e instanceof Error ? e.message : String(e)), variant: 'destructive' });
    } finally { setSeeding(false); }
  };

  const openAdd = () => {
    setForm({ ...EMPTY_FORM });
    setEditMode(false);
    setModalOpen(true);
  };

  const openEdit = (acc: GLAccount) => {
    setForm({ ...acc });
    setEditMode(true);
    setModalOpen(true);
  };

  const save = async () => {
    if (!form.id || !form.name || !form.category) {
      toast({ title: 'Validation', description: 'ID, Name and Category are required', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      let r: Response;
      if (editMode) {
        r = await fetch(`/api/gl/accounts/${form.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ account_number: form.account_number, name: form.name, category: form.category }),
        });
      } else {
        r = await fetch('/api/gl/accounts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        });
      }
      const d = await r.json();
      if (d.ok) {
        toast({ title: editMode ? 'Account updated' : 'Account created' });
        setModalOpen(false);
        load();
      } else {
        toast({ title: 'Save failed', description: d.error, variant: 'destructive' });
      }
    } catch (e: unknown) {
      toast({ title: 'Network error', description: (e instanceof Error ? e.message : String(e)), variant: 'destructive' });
    } finally { setSaving(false); }
  };

  const visible = accounts.filter(a =>
    (filterCat === 'All' || a.category === filterCat) &&
    (!search || a.name.toLowerCase().includes(search.toLowerCase()) || (a.account_number || '').includes(search))
  );

  const grouped = CATEGORIES.map(cat => ({
    cat,
    rows: visible.filter(a => a.category === cat),
  })).filter(g => g.rows.length > 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Chart of Accounts</h2>
          <p className="text-xs text-gray-500">USALI-aligned general ledger accounts</p>
        </div>
        <div className="flex gap-2">
          <button onClick={seed} disabled={seeding}
            className="px-4 py-2 border rounded text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50">
            {seeding ? 'Seeding…' : '🌱 Seed USALI Accounts'}
          </button>
          <button onClick={openAdd}
            className="px-4 py-2 bg-indigo-600 text-white rounded text-sm font-medium hover:bg-indigo-700">
            + Add Account
          </button>
        </div>
      </div>

      <div className="flex gap-3 items-center flex-wrap">
        <input
          type="text"
          placeholder="Search by name or account #…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="border rounded px-3 py-1.5 text-sm w-64"
        />
        <select value={filterCat} onChange={e => setFilterCat(e.target.value as Category | 'All')}
          className="border rounded px-3 py-1.5 text-sm">
          <option value="All">All Categories</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <span className="text-xs text-gray-400">{visible.length} account{visible.length !== 1 ? 's' : ''}</span>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400 text-center py-8 animate-pulse">Loading accounts…</p>
      ) : (
        <div className="rounded border overflow-hidden">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-gray-600 w-28">Account #</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">Name</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600 w-28">Category</th>
                <th className="px-4 py-2 text-center font-medium text-gray-600 w-20">Actions</th>
              </tr>
            </thead>
            <tbody>
              {grouped.map(({ cat, rows }) => (
                <React.Fragment key={cat}>
                  <tr className="bg-gray-100">
                    <td colSpan={4} className="px-4 py-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      {cat}
                    </td>
                  </tr>
                  {rows.map((acc, i) => (
                    <tr key={acc.id} className={`border-b ${i % 2 === 0 ? '' : 'bg-gray-50/30'} hover:bg-indigo-50/30`}>
                      <td className="px-4 py-2 font-mono text-gray-700">{acc.account_number || acc.id}</td>
                      <td className="px-4 py-2">{acc.name}</td>
                      <td className="px-4 py-2 text-gray-500">{acc.category}</td>
                      <td className="px-4 py-2 text-center">
                        <button onClick={() => openEdit(acc)}
                          className="text-xs text-indigo-600 hover:underline font-medium">Edit</button>
                      </td>
                    </tr>
                  ))}
                </React.Fragment>
              ))}
              {visible.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400 text-sm">No accounts found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md space-y-4">
            <h3 className="text-lg font-bold">{editMode ? 'Edit Account' : 'Add Account'}</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">
                  Account ID {editMode && <span className="text-gray-400">(read-only)</span>}
                </label>
                <input value={form.id} onChange={e => setForm(f => ({ ...f, id: e.target.value }))}
                  readOnly={editMode}
                  className={`w-full border rounded px-3 py-2 text-sm font-mono ${editMode ? 'bg-gray-50 text-gray-400' : ''}`} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Account Number</label>
                <input value={form.account_number} onChange={e => setForm(f => ({ ...f, account_number: e.target.value }))}
                  placeholder="e.g. 4000"
                  className="w-full border rounded px-3 py-2 text-sm font-mono" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Name *</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full border rounded px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Category *</label>
                <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value as Category }))}
                  className="w-full border rounded px-3 py-2 text-sm">
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setModalOpen(false)}
                className="px-4 py-2 border rounded text-sm font-medium text-gray-600 hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={save} disabled={saving}
                className="px-4 py-2 bg-indigo-600 text-white rounded text-sm font-medium disabled:opacity-50">
                {saving ? 'Saving…' : editMode ? 'Save Changes' : 'Add Account'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChartOfAccounts;
