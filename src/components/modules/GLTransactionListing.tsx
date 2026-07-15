import React, { useEffect, useMemo, useState } from 'react';
import gl from '@/lib/glAccounting';
import { useAuth } from '@/context/AuthContext';
import { isManager } from '@/lib/permissions';
import { useToast } from '@/hooks/use-toast';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface TxLine {
  line_id: string;
  journal_entry_id: string;
  gl_account_id: string;
  account_name: string | null;
  account_category: string | null;
  debit_amount: string | number;
  credit_amount: string | number;
  line_description: string | null;
  business_date: string;
  reference: string | null;
  entry_description: string | null;
  source: string;
  posted_by: string | null;
}

interface SummaryRow {
  gl_account_id: string;
  account_name: string | null;
  account_category: string | null;
  line_count: string | number;
  total_debit: string | number;
  total_credit: string | number;
  net: string | number;
}

const SOURCES = ['', 'manual', 'night_audit', 'expense', 'pos', 'folio', 'reconciliation', 'adjustment', 'closing', 'opening', 'system'];

const firstOfMonth = () => new Date().toISOString().slice(0, 8) + '01';
const today = () => new Date().toISOString().slice(0, 10);

// GL Transaction Listing — summary (per account) and detailed (posting by posting)
// with drill-down to the full journal entry and controller click-&-edit: change a
// posted line's GL account, which books a balanced offsetting reallocation journal
// (the original entry is preserved for audit).
export const GLTransactionListing: React.FC<{ initialMode?: 'summary' | 'detailed' }> = ({ initialMode }) => {
  const urlMode = (() => {
    try {
      const m = new URLSearchParams(window.location.search).get('glTxMode');
      return m === 'summary' || m === 'detailed' ? m : null;
    } catch { return null; }
  })();
  // Deep-link account filter (e.g. from the Daily Journal modal's drill-down)
  const urlAccount = (() => {
    try { return new URLSearchParams(window.location.search).get('glTxAccount') || ''; } catch { return ''; }
  })();
  const [mode, setMode] = useState<'summary' | 'detailed'>(initialMode || urlMode || 'detailed');
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());
  const [accountFilter, setAccountFilter] = useState(urlAccount);
  const [sourceFilter, setSourceFilter] = useState('');
  const [lines, setLines] = useState<TxLine[]>([]);
  const [summary, setSummary] = useState<SummaryRow[]>([]);
  const [totals, setTotals] = useState({ totalDebit: 0, totalCredit: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expandedEntry, setExpandedEntry] = useState<string | null>(null);
  // click-&-edit: which line is being reallocated + target + reason
  const [editLine, setEditLine] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState('');
  const [editReason, setEditReason] = useState('');
  const [saving, setSaving] = useState(false);
  const { user } = useAuth();
  const { toast } = useToast();
  const isMgr = isManager(user?.role);
  const accounts = gl.getAccounts();

  const load = React.useCallback(async () => {
    setLoading(true); setError('');
    try {
      const qs = new URLSearchParams({ from, to });
      if (accountFilter) qs.set('account_id', accountFilter);
      if (sourceFilter) qs.set('source', sourceFilter);
      const r = await fetch(`/api/gl/transactions?${qs}`).then(r => r.json());
      if (!r.ok) throw new Error(r.error || 'Load failed');
      setLines(r.lines || []);
      setSummary(r.summary || []);
      setTotals({ totalDebit: r.totalDebit || 0, totalCredit: r.totalCredit || 0 });
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally { setLoading(false); }
  }, [from, to, accountFilter, sourceFilter]);

  useEffect(() => { load(); }, [load]);

  // lines of the currently expanded entry (full journal drill-down)
  const entryLines = useMemo(
    () => (expandedEntry ? lines.filter(l => l.journal_entry_id === expandedEntry) : []),
    [expandedEntry, lines]
  );

  const acctLabel = (id: string, name?: string | null) => `${id}${name ? ` - ${name}` : ''}`;

  // Reallocate a posted line: balanced offsetting journal, source 'adjustment'.
  const saveReclass = async (l: TxLine) => {
    if (!editTarget || editTarget === l.gl_account_id) return;
    const amt = Number(l.debit_amount || l.credit_amount || 0);
    if (!(amt > 0)) { toast({ title: 'Edit failed', description: 'Line has no amount to move.' }); return; }
    const wasDebit = Number(l.debit_amount || 0) > 0;
    const ref = `Reclass ${l.gl_account_id}→${editTarget} [${l.reference || l.journal_entry_id}]${editReason ? `: ${editReason}` : ''}`;
    const glLines = (wasDebit
      ? [{ accountId: editTarget, debit: amt, credit: 0 }, { accountId: l.gl_account_id, debit: 0, credit: amt }]
      : [{ accountId: editTarget, debit: 0, credit: amt }, { accountId: l.gl_account_id, debit: amt, credit: 0 }]
    ).map(x => ({ ...x, description: ref }));
    setSaving(true);
    try {
      const r = await fetch('/api/gl/journal-entries', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: `GLRECLASS_${l.business_date?.slice(0, 10)}_${Date.now()}`,
          business_date: l.business_date?.slice(0, 10),
          reference: ref, description: ref, source: 'adjustment', status: 'posted',
          lines: glLines, created_by: user?.username || 'system',
        }),
      }).then(r => r.json());
      if (!r.ok) throw new Error(r.error || 'Post failed');
      toast({ title: 'Reallocated', description: `$ ${amt.toFixed(2)} moved ${l.gl_account_id} → ${editTarget}.` });
      setEditLine(null); setEditTarget(''); setEditReason('');
      await load();
    } catch (e: any) {
      toast({ title: 'Edit failed', description: String(e?.message || e) });
    } finally { setSaving(false); }
  };

  const acctSelect = (value: string, onChange: (v: string) => void, excludeId?: string) => (
    <select className="border rounded px-2 py-1 text-xs min-w-[220px]" value={value} onChange={e => onChange(e.target.value)}>
      <option value="">Select target account…</option>
      {(['Revenue', 'Expense', 'Asset', 'Liability', 'Equity'] as const).map(cat => {
        const opts = accounts.filter(a => a.category === cat && a.id !== excludeId);
        if (!opts.length) return null;
        return <optgroup key={cat} label={cat}>{opts.map(a => <option key={a.id} value={a.id}>{a.id} - {a.name}{a.department ? ` (${a.department})` : ''}</option>)}</optgroup>;
      })}
    </select>
  );

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">GL Transaction Listing</h2>
          <div className="text-xs text-gray-500">Review every posting transaction by transaction. Drill into an entry, click ⇄ Edit to reallocate a line to a different GL account.</div>
        </div>
        <div className="flex gap-2">
          {(['summary', 'detailed'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)}
              className={`px-3 py-1.5 rounded text-sm font-medium ${mode === m ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-800'}`}>
              {m === 'summary' ? 'Summary' : 'Detailed'}
            </button>
          ))}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-2">
        <div><label className="text-xs block">From</label><Input type="date" className="ds-input-compact" value={from} onChange={e => setFrom(e.target.value)} /></div>
        <div><label className="text-xs block">To</label><Input type="date" className="ds-input-compact" value={to} onChange={e => setTo(e.target.value)} /></div>
        <div>
          <label className="text-xs block">GL Account</label>
          <select className="border rounded px-2 py-1.5 text-sm min-w-[200px]" value={accountFilter} onChange={e => setAccountFilter(e.target.value)}>
            <option value="">All accounts</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.id} - {a.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs block">Source</label>
          <select className="border rounded px-2 py-1.5 text-sm" value={sourceFilter} onChange={e => setSourceFilter(e.target.value)}>
            {SOURCES.map(s => <option key={s} value={s}>{s || 'All sources'}</option>)}
          </select>
        </div>
        <Button variant="outline" className="ds-button-compact" onClick={load} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</Button>
        <Button variant="outline" className="ds-button-compact" onClick={() => {
          const rows = mode === 'summary'
            ? [['account', 'name', 'category', 'lines', 'debit', 'credit', 'net'],
               ...summary.map(s => [s.gl_account_id, s.account_name || '', s.account_category || '', s.line_count, s.total_debit, s.total_credit, s.net])]
            : [['date', 'entry', 'source', 'reference', 'account', 'name', 'description', 'debit', 'credit'],
               ...lines.map(l => [l.business_date?.slice(0, 10), l.journal_entry_id, l.source, l.reference || '', l.gl_account_id, l.account_name || '', l.line_description || l.entry_description || '', l.debit_amount, l.credit_amount])];
          const csv = rows.map(r => r.map(x => `"${String(x ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
          const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
          const a = document.createElement('a'); a.href = url; a.download = `gl_transactions_${mode}_${from}_${to}.csv`; a.click(); URL.revokeObjectURL(url);
        }}>Export CSV</Button>
        <div className="text-xs text-gray-600 ml-auto">
          Debits <span className="font-mono font-semibold">$ {totals.totalDebit.toFixed(2)}</span> · Credits <span className="font-mono font-semibold">$ {totals.totalCredit.toFixed(2)}</span> · {lines.length} lines
        </div>
      </div>

      {error && <div className="p-2 text-sm bg-red-50 border border-red-200 rounded text-red-700">{error}</div>}

      {mode === 'summary' ? (
        <div className="overflow-x-auto border rounded">
          <table className="w-full text-sm">
            <thead><tr className="bg-gray-50 text-gray-600">
              <th className="p-2 text-left">Account</th><th className="p-2 text-left">Category</th>
              <th className="p-2 text-right">Lines</th><th className="p-2 text-right">Debit</th>
              <th className="p-2 text-right">Credit</th><th className="p-2 text-right">Net (Dr−Cr)</th><th className="p-2"></th>
            </tr></thead>
            <tbody>
              {summary.map(s => (
                <tr key={s.gl_account_id} className="border-t hover:bg-indigo-50 cursor-pointer"
                  onClick={() => { setAccountFilter(s.gl_account_id); setMode('detailed'); }}
                  title="Click to view this account's transactions">
                  <td className="p-2">{acctLabel(s.gl_account_id, s.account_name)}</td>
                  <td className="p-2"><span className="text-xs px-2 py-0.5 rounded-full bg-gray-100">{s.account_category || '—'}</span></td>
                  <td className="p-2 text-right">{s.line_count}</td>
                  <td className="p-2 text-right font-mono">$ {Number(s.total_debit).toFixed(2)}</td>
                  <td className="p-2 text-right font-mono">$ {Number(s.total_credit).toFixed(2)}</td>
                  <td className={`p-2 text-right font-mono ${Number(s.net) < 0 ? 'text-red-700' : ''}`}>$ {Number(s.net).toFixed(2)}</td>
                  <td className="p-2 text-indigo-600 text-xs font-semibold">Drill ▸</td>
                </tr>
              ))}
              {summary.length === 0 && !loading && <tr><td colSpan={7} className="p-4 text-center text-gray-500">No transactions in range.</td></tr>}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto border rounded">
          <table className="w-full text-xs">
            <thead><tr className="bg-gray-50 text-gray-600">
              <th className="p-2 text-left">Date</th><th className="p-2 text-left">Source</th>
              <th className="p-2 text-left">Reference</th><th className="p-2 text-left">Account</th>
              <th className="p-2 text-left">Description</th>
              <th className="p-2 text-right">Debit</th><th className="p-2 text-right">Credit</th>
              <th className="p-2 text-center">Entry</th>{isMgr && <th className="p-2 text-center">Edit</th>}
            </tr></thead>
            <tbody>
              {lines.map(l => (
                <React.Fragment key={l.line_id}>
                  <tr className="border-t hover:bg-gray-50">
                    <td className="p-2 whitespace-nowrap">{l.business_date?.slice(0, 10)}</td>
                    <td className="p-2"><span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-indigo-100 text-indigo-700 uppercase">{l.source}</span></td>
                    <td className="p-2 text-gray-600">{l.reference || '—'}</td>
                    <td className="p-2 font-mono">{acctLabel(l.gl_account_id, l.account_name)}</td>
                    <td className="p-2 text-gray-600">{l.line_description || l.entry_description || '—'}</td>
                    <td className="p-2 text-right font-mono">{Number(l.debit_amount) ? `$ ${Number(l.debit_amount).toFixed(2)}` : ''}</td>
                    <td className="p-2 text-right font-mono">{Number(l.credit_amount) ? `$ ${Number(l.credit_amount).toFixed(2)}` : ''}</td>
                    <td className="p-2 text-center">
                      <button className="text-indigo-600 font-semibold"
                        onClick={() => setExpandedEntry(expandedEntry === l.journal_entry_id ? null : l.journal_entry_id)}
                        title="Show the full journal entry">{expandedEntry === l.journal_entry_id ? '▼' : '▶'}</button>
                    </td>
                    {isMgr && (
                      <td className="p-2 text-center">
                        <button className="text-amber-700 font-semibold"
                          onClick={() => { if (editLine === l.line_id) { setEditLine(null); } else { setEditLine(l.line_id); setEditTarget(''); setEditReason(''); } }}
                          title="Reallocate this posting to a different GL account">{editLine === l.line_id ? 'Close' : '⇄ Edit'}</button>
                      </td>
                    )}
                  </tr>
                  {expandedEntry === l.journal_entry_id && (
                    <tr className="bg-indigo-50/50">
                      <td colSpan={isMgr ? 9 : 8} className="p-2">
                        <div className="text-[11px] font-semibold mb-1">Journal entry <span className="font-mono">{l.journal_entry_id}</span> — {l.entry_description || l.reference} <span className="text-gray-500">(posted by {l.posted_by || 'system'})</span></div>
                        <table className="w-full text-[11px]">
                          <thead><tr className="text-gray-500"><th className="p-1 text-left">Account</th><th className="p-1 text-right">Debit</th><th className="p-1 text-right">Credit</th><th className="p-1 text-left">Description</th></tr></thead>
                          <tbody>
                            {entryLines.map(el => (
                              <tr key={el.line_id} className="border-t border-indigo-100">
                                <td className="p-1 font-mono">{acctLabel(el.gl_account_id, el.account_name)}</td>
                                <td className="p-1 text-right font-mono">{Number(el.debit_amount) ? `$ ${Number(el.debit_amount).toFixed(2)}` : ''}</td>
                                <td className="p-1 text-right font-mono">{Number(el.credit_amount) ? `$ ${Number(el.credit_amount).toFixed(2)}` : ''}</td>
                                <td className="p-1 text-gray-600">{el.line_description || '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                  {isMgr && editLine === l.line_id && (
                    <tr className="bg-amber-50/70">
                      <td colSpan={9} className="p-2">
                        <div className="flex flex-wrap items-end gap-2">
                          <span className="text-[11px] text-gray-600">
                            Move <span className="font-mono font-semibold">$ {Number(l.debit_amount || l.credit_amount).toFixed(2)}</span> ({Number(l.debit_amount) ? 'Dr' : 'Cr'}) from <span className="font-mono">{l.gl_account_id}</span> to:
                          </span>
                          {acctSelect(editTarget, setEditTarget, l.gl_account_id)}
                          <Input className="ds-input-compact text-xs w-56" placeholder="Reason (optional)" value={editReason} onChange={e => setEditReason(e.target.value)} />
                          <Button className="ds-button-compact bg-amber-600 text-white" disabled={saving || !editTarget} onClick={() => saveReclass(l)}>{saving ? 'Saving…' : 'Save'}</Button>
                          <Button variant="outline" className="ds-button-compact" onClick={() => setEditLine(null)}>Cancel</Button>
                        </div>
                        <div className="text-[10px] text-gray-500 mt-1">Posts a balanced reallocation journal (source: adjustment). The original entry is preserved for audit.</div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
              {lines.length === 0 && !loading && <tr><td colSpan={9} className="p-4 text-center text-gray-500">No transactions in range.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default GLTransactionListing;
