import React, { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface PeriodRow {
  period: string; period_year: number; period_month: number; period_name: string;
  status: string; closed_by?: string | null; closed_at?: string | null;
  reopened_by?: string | null; reopened_at?: string | null;
}

// Accounting Period Close — the controller's month-end lock. Closing a period
// blocks any transaction dated into it (GRN post, journal, batch flush, supplier
// payment, stock-take) with a warning until it is reopened.
export const PeriodClose: React.FC = () => {
  const [rows, setRows] = useState<PeriodRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [newPeriod, setNewPeriod] = useState(new Date().toISOString().slice(0, 7));
  const { user } = useAuth();
  const { toast } = useToast();

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/gl/periods').then(r => r.json());
      if (r.ok) setRows(r.rows || []);
      else toast({ title: 'Load failed', description: r.error });
    } catch (e: any) { toast({ title: 'Load failed', description: String(e?.message || e) }); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const act = async (period: string, action: 'close' | 'reopen') => {
    if (action === 'reopen' && !window.confirm(`Reopen ${period}? Transactions dated in it can be posted again.`)) return;
    if (action === 'close' && !window.confirm(`Close ${period}? Postings dated in this month will be BLOCKED until it is reopened.`)) return;
    setBusy(period);
    try {
      const body = action === 'close'
        ? { period, closed_by: user?.username || user?.name || 'controller' }
        : { period, reopened_by: user?.username || user?.name || 'controller' };
      const r = await fetch(`/api/gl/periods/${action}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }).then(r => r.json());
      if (!r.ok) throw new Error(r.error || `${action} failed`);
      toast({ title: `Period ${action === 'close' ? 'closed' : 'reopened'}`, description: `${period} is now ${r.status}.` });
      await load();
    } catch (e: any) {
      toast({ title: `${action} failed`, description: String(e?.message || e) });
    } finally { setBusy(null); }
  };

  const d = (s: any) => (s ? String(s).slice(0, 10) : '—');

  return (
    <div className="p-6 space-y-4">
      <div>
        <h2 className="text-xl font-bold">Accounting Period Close</h2>
        <div className="text-xs text-gray-500">Close a month to lock it: any transaction dated in a closed period is denied (with a warning) until reopened. Applies to journals, GRN posts, batch flush, supplier payments and stock-take.</div>
      </div>

      <div className="flex items-end gap-2 border rounded p-3 bg-gray-50">
        <div>
          <label className="text-xs block mb-1">Period (YYYY-MM)</label>
          <Input type="month" className="ds-input-compact" value={newPeriod} onChange={e => setNewPeriod(e.target.value)} />
        </div>
        <Button className="ds-button-compact bg-red-600 text-white" disabled={busy === newPeriod} onClick={() => act(newPeriod, 'close')}>Close Period</Button>
        <Button variant="outline" className="ds-button-compact" onClick={load} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</Button>
      </div>

      <div className="border rounded overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="bg-gray-50 text-gray-600">
            <th className="p-2 text-left">Period</th><th className="p-2 text-left">Status</th>
            <th className="p-2 text-left">Closed By</th><th className="p-2 text-left">Closed At</th>
            <th className="p-2 text-left">Reopened By</th><th className="p-2 text-left">Reopened At</th>
            <th className="p-2 text-right">Action</th>
          </tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.period} className="border-t">
                <td className="p-2 font-medium">{r.period} <span className="text-xs text-gray-400">{r.period_name}</span></td>
                <td className="p-2">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${String(r.status).toLowerCase() === 'closed' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                    {String(r.status).toUpperCase()}
                  </span>
                </td>
                <td className="p-2 text-gray-600">{r.closed_by || '—'}</td>
                <td className="p-2 text-gray-600">{d(r.closed_at)}</td>
                <td className="p-2 text-gray-600">{r.reopened_by || '—'}</td>
                <td className="p-2 text-gray-600">{d(r.reopened_at)}</td>
                <td className="p-2 text-right">
                  {String(r.status).toLowerCase() === 'closed'
                    ? <Button variant="outline" className="ds-button-compact" disabled={busy === r.period} onClick={() => act(r.period, 'reopen')}>Reopen</Button>
                    : <Button className="ds-button-compact bg-red-600 text-white" disabled={busy === r.period} onClick={() => act(r.period, 'close')}>Close</Button>}
                </td>
              </tr>
            ))}
            {rows.length === 0 && !loading && <tr><td colSpan={7} className="p-4 text-center text-gray-500">No periods closed yet. Close a month above to lock it.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default PeriodClose;
