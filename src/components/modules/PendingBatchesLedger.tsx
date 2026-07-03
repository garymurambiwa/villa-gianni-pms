import React, { useEffect, useMemo, useState } from 'react';

type Status = 'PENDING' | 'POSTED' | 'IGNORED' | 'ALL';

interface Batch {
  id: string;
  origin_table: string;
  origin_id: string;
  description: string;
  debit_gl_account: string;
  credit_gl_account: string;
  amount: number;
  status: string;
  created_at: string;
}

interface Account { id: string; account_number?: string; name: string; category?: string; }

export function PendingBatchesLedger() {
  const [rows, setRows] = useState<Batch[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [filter, setFilter] = useState<Status>('PENDING');
  const [loading, setLoading] = useState(false);
  const [flushing, setFlushing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  // per-row edits: accounts always; description/amount editable from the drill-down
  const [edits, setEdits] = useState<Record<string, { debit: string; credit: string; description?: string; amount?: string }>>({});

  // Map a batch's origin table to the module that owns the source document so the
  // drill-down can jump straight to it (same navigateToModule event GLAccounting uses).
  const sourceModuleOf = (b: Batch): { module: string; label: string } | null => {
    const t = String(b.origin_table || '').toLowerCase();
    if (t.includes('grn')) return { module: 'inventory', label: 'GRN' };
    if (t.includes('stock') || t.includes('inv_')) return { module: 'inventory', label: 'Inventory' };
    if (t.includes('expense')) return { module: 'vendors', label: 'Expense' };
    if (t.includes('folio') || t.includes('reservation')) return { module: 'front-office', label: 'Folio' };
    if (t.includes('pos') || t.includes('order')) return { module: 'pos', label: 'POS Order' };
    return null;
  };
  const openSource = (b: Batch) => {
    const target = sourceModuleOf(b);
    if (!target) return;
    try {
      window.dispatchEvent(new CustomEvent('navigateToModule', { detail: { module: target.module, reference: b.origin_id } }));
    } catch { /* noop */ }
  };

  const pendingCount = useMemo(() => rows.filter(b => b.status === 'PENDING').length, [rows]);
  const acctLabel = (id: string) => { const a = accounts.find(x => x.id === id); return a ? `${a.id} - ${a.name}` : id; };

  const load = async (st: Status) => {
    setLoading(true);
    try {
      if (st === 'ALL') {
        const [p, po, ig] = await Promise.all([
          fetch('/api/gl/pending-batches?status=PENDING').then(r => r.json()),
          fetch('/api/gl/pending-batches?status=POSTED').then(r => r.json()),
          fetch('/api/gl/pending-batches?status=IGNORED').then(r => r.json()),
        ]);
        setRows([...(p.rows || []), ...(po.rows || []), ...(ig.rows || [])]);
      } else {
        const r = await fetch(`/api/gl/pending-batches?status=${st}`).then(r => r.json());
        setRows(r.rows || []);
      }
    } catch (e) {
      setToast('Failed to load batches');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(filter); }, [filter]);
  useEffect(() => {
    fetch('/api/gl/accounts').then(r => r.json()).then(r => { if (r.ok) setAccounts(r.rows || []); }).catch(() => {});
  }, []);

  const editOf = (b: Batch) => edits[b.id] || { debit: b.debit_gl_account, credit: b.credit_gl_account, description: b.description || '', amount: String(b.amount) };
  const isDirty = (b: Batch) => {
    const e = edits[b.id];
    if (!e) return false;
    return e.debit !== b.debit_gl_account || e.credit !== b.credit_gl_account
      || (e.description !== undefined && e.description !== (b.description || ''))
      || (e.amount !== undefined && Number(e.amount) !== Number(b.amount));
  };
  const setEdit = (b: Batch, field: 'debit' | 'credit' | 'description' | 'amount', val: string) =>
    setEdits(prev => ({ ...prev, [b.id]: { ...editOf(b), [field]: val } }));

  const saveAccounts = async (b: Batch) => {
    const e = editOf(b);
    if (e.debit === e.credit) { setToast('Debit and credit accounts must differ'); return; }
    const amt = e.amount === undefined ? Number(b.amount) : Number(e.amount);
    if (!(amt > 0)) { setToast('Amount must be greater than zero'); return; }
    setBusy(b.id);
    try {
      const r = await fetch(`/api/gl/pending-batches/${b.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          debit_gl_account: e.debit, credit_gl_account: e.credit,
          description: e.description === undefined ? undefined : e.description,
          amount: amt,
        }),
      }).then(r => r.json());
      if (!r.ok) throw new Error(r.error || 'Save failed');
      setEdits(prev => { const n = { ...prev }; delete n[b.id]; return n; });
      setToast('Accounts updated');
      await load(filter);
    } catch (err) {
      setToast(err instanceof Error ? err.message : String(err));
    } finally { setBusy(null); }
  };

  const postOne = async (b: Batch) => {
    if (isDirty(b)) { setToast('Save account changes before posting'); return; }
    setBusy(b.id);
    try {
      const r = await fetch(`/api/gl/pending-batches/${b.id}/flush`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
      }).then(r => r.json());
      if (!r.ok) throw new Error(r.error || 'Post failed');
      setToast(`Posted — journal ${r.journal_id}`);
      await load(filter);
    } catch (err) {
      setToast(err instanceof Error ? err.message : String(err));
    } finally { setBusy(null); }
  };

  const ignoreOne = async (id: string) => {
    setBusy(id);
    try {
      const r = await fetch(`/api/gl/pending-batches/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'IGNORED' }),
      }).then(r => r.json());
      if (!r.ok) throw new Error(r.error || 'Update failed');
      setToast('Batch ignored');
      await load(filter);
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); }
  };

  const postAll = async () => {
    if (Object.keys(edits).length) { setToast('Save all account changes before posting the batch'); return; }
    if (!window.confirm(`Post all ${pendingCount} pending batch(es) to the GL? They will flow into the reports.`)) return;
    setFlushing(true);
    try {
      const r = await fetch('/api/gl/pending-batches/flush', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
      }).then(r => r.json());
      if (!r.ok) throw new Error(r.error || 'Flush failed');
      setToast(`Posted ${r.flushed} batch(es)${r.errors?.length ? ` — ${r.errors.length} error(s)` : ''}`);
      await load(filter);
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e));
    } finally {
      setFlushing(false);
    }
  };

  const btn = (bg: string): React.CSSProperties => ({ padding: '2px 8px', background: bg, color: '#fff', border: 'none', borderRadius: 3, cursor: 'pointer', fontSize: 11 });
  const sel: React.CSSProperties = { padding: '2px 4px', fontSize: 12, border: '1px solid #d1d5db', borderRadius: 3, maxWidth: 220 };

  const acctSelect = (value: string, onChange: (v: string) => void) => {
    const cats = ['Asset', 'Liability', 'Equity', 'Revenue', 'Expense'];
    return (
      <select style={sel} value={value} onChange={e => onChange(e.target.value)}>
        {!accounts.find(a => a.id === value) && <option value={value}>{value}</option>}
        {cats.map(cat => {
          const opts = accounts.filter(a => (a.category || 'Other') === cat);
          if (!opts.length) return null;
          return <optgroup key={cat} label={cat}>{opts.map(a => <option key={a.id} value={a.id}>{a.id} - {a.name}</option>)}</optgroup>;
        })}
        {(() => {
          const other = accounts.filter(a => !cats.includes(a.category || ''));
          return other.length ? <optgroup label="Other">{other.map(a => <option key={a.id} value={a.id}>{a.id} - {a.name}</option>)}</optgroup> : null;
        })()}
      </select>
    );
  };

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h2 style={{ margin: 0 }}>GL Pending Batches</h2>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>Review each entry, reallocate the debit/credit accounts if needed, then post individually or all at once.</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {(['PENDING', 'POSTED', 'IGNORED', 'ALL'] as Status[]).map(s => (
            <button key={s} onClick={() => setFilter(s)}
              style={{ padding: '4px 12px', background: filter === s ? '#2563eb' : '#e5e7eb', color: filter === s ? '#fff' : '#111', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
              {s}
            </button>
          ))}
          <button onClick={postAll} disabled={flushing || filter !== 'PENDING' || pendingCount === 0}
            style={{ padding: '4px 16px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', opacity: (flushing || pendingCount === 0) ? 0.6 : 1 }}>
            {flushing ? 'Posting…' : `Post All (${pendingCount})`}
          </button>
        </div>
      </div>

      {toast && (
        <div style={{ marginBottom: 12, padding: '8px 12px', background: '#fef9c3', border: '1px solid #ca8a04', borderRadius: 4, display: 'flex', justifyContent: 'space-between' }}>
          {toast}
          <button onClick={() => setToast('')} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>×</button>
        </div>
      )}

      {loading ? <div>Loading…</div> : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f3f4f6' }}>
              {['', 'Description', 'Debit Acct', 'Credit Acct', 'Amount', 'Status', 'Date', 'Actions'].map((h, i) => (
                <th key={i} style={{ padding: '8px 12px', textAlign: h === 'Amount' ? 'right' : 'left', borderBottom: '1px solid #e5e7eb' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={8} style={{ padding: 16, textAlign: 'center', color: '#6b7280' }}>No batches</td></tr>
            ) : rows.map(b => {
              const pending = b.status === 'PENDING';
              const e = editOf(b);
              const open = expanded === b.id;
              return (
                <React.Fragment key={b.id}>
                  <tr style={{ borderBottom: open ? 'none' : '1px solid #f3f4f6', background: isDirty(b) ? '#eef2ff' : undefined }}>
                    <td style={{ padding: '8px 6px', textAlign: 'center' }}>
                      <button onClick={() => setExpanded(open ? null : b.id)} title="Drill down"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: '#2563eb' }}>{open ? '▼' : '▶'}</button>
                    </td>
                    <td style={{ padding: '8px 12px' }}>{b.description || `${b.origin_table}/${b.origin_id}`}</td>
                    <td style={{ padding: '8px 12px', fontFamily: 'monospace' }}>
                      {pending ? acctSelect(e.debit, v => setEdit(b, 'debit', v)) : acctLabel(b.debit_gl_account)}
                    </td>
                    <td style={{ padding: '8px 12px', fontFamily: 'monospace' }}>
                      {pending ? acctSelect(e.credit, v => setEdit(b, 'credit', v)) : acctLabel(b.credit_gl_account)}
                    </td>
                    <td style={{ padding: '8px 12px', textAlign: 'right' }}>${Number(b.amount).toFixed(2)}</td>
                    <td style={{ padding: '8px 12px' }}>
                      <span style={{ padding: '2px 8px', borderRadius: 12, fontSize: 11,
                        background: b.status === 'PENDING' ? '#fef9c3' : b.status === 'POSTED' ? '#dcfce7' : '#f3f4f6',
                        color: b.status === 'PENDING' ? '#854d0e' : b.status === 'POSTED' ? '#166534' : '#374151' }}>{b.status}</span>
                    </td>
                    <td style={{ padding: '8px 12px', color: '#6b7280', fontSize: 12 }}>{new Date(b.created_at).toLocaleDateString()}</td>
                    <td style={{ padding: '8px 12px' }}>
                      {pending && (
                        <div style={{ display: 'flex', gap: 4 }}>
                          {isDirty(b) && (
                            <button onClick={() => saveAccounts(b)} disabled={busy === b.id} style={btn('#4f46e5')}>Save</button>
                          )}
                          <button onClick={() => postOne(b)} disabled={busy === b.id || isDirty(b)} style={{ ...btn('#16a34a'), opacity: isDirty(b) ? 0.5 : 1 }}>Post</button>
                          <button onClick={() => ignoreOne(b.id)} disabled={busy === b.id} style={btn('#6b7280')}>Ignore</button>
                        </div>
                      )}
                    </td>
                  </tr>
                  {open && (
                    <tr style={{ borderBottom: '1px solid #f3f4f6', background: '#fafafa' }}>
                      <td></td>
                      <td colSpan={7} style={{ padding: '10px 12px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 12 }}>
                          <div>
                            <div style={{ fontWeight: 600, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                              Source document
                              {sourceModuleOf(b) && (
                                <button onClick={() => openSource(b)} title={`Open ${sourceModuleOf(b)!.label} ${b.origin_id}`}
                                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#2563eb', fontSize: 12, fontWeight: 600, padding: 0 }}>
                                  ↗ Open {sourceModuleOf(b)!.label}
                                </button>
                              )}
                            </div>
                            <div>Origin: <span style={{ fontFamily: 'monospace' }}>{b.origin_table} / {b.origin_id}</span></div>
                            <div>Batch id: <span style={{ fontFamily: 'monospace' }}>{b.id}</span></div>
                            {pending ? (
                              <div style={{ marginTop: 6, display: 'grid', gap: 6 }}>
                                <label>
                                  <span style={{ color: '#6b7280' }}>Description</span>
                                  <input style={{ ...sel, width: '100%', maxWidth: 340, display: 'block', marginTop: 2 }}
                                    value={e.description ?? (b.description || '')}
                                    onChange={ev => setEdit(b, 'description', ev.target.value)} />
                                </label>
                                <label>
                                  <span style={{ color: '#6b7280' }}>Amount</span>
                                  <input type="number" step="0.01" min="0.01"
                                    style={{ ...sel, width: 120, display: 'block', marginTop: 2 }}
                                    value={e.amount ?? String(b.amount)}
                                    onChange={ev => setEdit(b, 'amount', ev.target.value)} />
                                </label>
                                {isDirty(b) && (
                                  <div>
                                    <button onClick={() => saveAccounts(b)} disabled={busy === b.id} style={btn('#4f46e5')}>
                                      {busy === b.id ? 'Saving…' : 'Save Changes'}
                                    </button>
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div>Description: {b.description || '—'}</div>
                            )}
                          </div>
                          <div>
                            <div style={{ fontWeight: 600, marginBottom: 4 }}>Resulting journal entry (on post)</div>
                            <table style={{ width: '100%', fontSize: 12 }}>
                              <thead><tr style={{ color: '#6b7280' }}><th style={{ textAlign: 'left' }}>Account</th><th style={{ textAlign: 'right' }}>Debit</th><th style={{ textAlign: 'right' }}>Credit</th></tr></thead>
                              <tbody>
                                <tr><td>{acctLabel(e.debit)}</td><td style={{ textAlign: 'right', fontFamily: 'monospace' }}>${Number(e.amount ?? b.amount).toFixed(2)}</td><td></td></tr>
                                <tr><td>{acctLabel(e.credit)}</td><td></td><td style={{ textAlign: 'right', fontFamily: 'monospace' }}>${Number(e.amount ?? b.amount).toFixed(2)}</td></tr>
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
