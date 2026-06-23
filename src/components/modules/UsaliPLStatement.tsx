import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatCurrency } from '@/lib/posIntegration';
import db from '@/lib/db';
import { buildUsaliStatement, UsaliStatement, PLAccountRow } from '@/lib/usaliPL';
import { RefreshCw, Printer, ChevronRight, ChevronDown } from 'lucide-react';

// Interactive USALI Hotel Profit & Loss statement. Date-range driven (not static),
// with % of revenue and three drill levels: section line → GL account → individual
// journal transactions. Revenue and expenses are broken down by outlet/department
// per the chart-of-accounts. Includes KPI header (Occupancy / ADR / RevPAR).

type Range = { start: string; end: string };
type JournalLine = { date: string; reference: string; source: string; description: string; debit: number; credit: number };

const firstOfMonth = (): Range => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  return { start: start.toISOString().slice(0, 10), end: now.toISOString().slice(0, 10) };
};

const exportCSV = (filename: string, rows: string[][]) => {
  const csv = rows.map(r => r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
};

export const UsaliPLStatement: React.FC = () => {
  const [range, setRange] = React.useState<Range>(() => firstOfMonth());
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [stmt, setStmt] = React.useState<UsaliStatement | null>(null);
  const [kpi, setKpi] = React.useState({ available: 0, occupied: 0, occupancy: 0, adr: 0, revpar: 0 });
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
  // account_id -> journal lines (lazy-loaded drill to transactions)
  const [txByAccount, setTxByAccount] = React.useState<Record<string, JournalLine[]>>({});

  const load = React.useCallback(async () => {
    setLoading(true); setError(''); setStmt(null); setTxByAccount({});
    try {
      const { start, end } = range;
      const res = await fetch(`/api/reports/pl?from=${start}&to=${end}`);
      const d = await res.json();
      if (!d.ok) throw new Error(d.error || 'P&L fetch failed');
      const rows: PLAccountRow[] = (d.rows || []).map((r: any) => ({
        category: r.category, department: r.department, accountId: r.accountId, name: r.name, amount: Number(r.amount || 0),
      }));
      setStmt(buildUsaliStatement(rows));

      // KPI header from night audit runs in range (sum rooms, average rates)
      try {
        const k = await db.query<any>(
          `SELECT COALESCE(SUM(available_rooms),0) AS avail, COALESCE(SUM(occupied_rooms),0) AS occ,
                  COALESCE(SUM(room_revenue),0) AS room_rev
           FROM night_audit_runs WHERE status='completed' AND business_date >= $1::date AND business_date <= $2::date`,
          [start, end]
        );
        const row = 'rows' in k ? k.rows[0] : null;
        if (row) {
          const avail = Number(row.avail || 0), occ = Number(row.occ || 0), roomRev = Number(row.room_rev || 0);
          setKpi({
            available: avail, occupied: occ,
            occupancy: avail ? (occ / avail) * 100 : 0,
            adr: occ ? roomRev / occ : 0,
            revpar: avail ? roomRev / avail : 0,
          });
        }
      } catch { /* KPI is best-effort */ }
    } catch (err: any) {
      console.error('[UsaliPL] load failed', err);
      setError(err?.message || 'Failed to load P&L');
    } finally {
      setLoading(false);
    }
  }, [range]);

  React.useEffect(() => { load(); }, [load]);

  // Drill level 3: lazy-load the individual journal transactions for an account.
  const loadAccountTx = React.useCallback(async (accountId: string) => {
    if (txByAccount[accountId]) return;
    try {
      const res = await fetch(`/api/reports/journals?from=${range.start}&to=${range.end}`);
      const d = await res.json();
      const all = (d.ok ? d.rows || [] : []) as any[];
      const grouped: Record<string, JournalLine[]> = {};
      all.forEach(r => {
        const id = r.account_id;
        (grouped[id] = grouped[id] || []).push({
          date: r.business_date, reference: r.reference || r.entry_id, source: r.source || '—',
          description: r.line_description || '', debit: Number(r.debit || 0), credit: Number(r.credit || 0),
        });
      });
      setTxByAccount(prev => ({ ...grouped, ...prev }));
    } catch (e) { console.warn('[UsaliPL] tx load failed', e); }
  }, [range, txByAccount]);

  const toggle = (key: string) => setExpanded(p => ({ ...p, [key]: !p[key] }));
  const toggleAccount = (accountId: string) => { toggle(`acct:${accountId}`); loadAccountTx(accountId); };

  const rangeText = range.start === range.end ? range.start : `${range.start} to ${range.end}`;
  const pct = (n: number) => (stmt && stmt.totals.totalRevenue ? ((n / stmt.totals.totalRevenue) * 100).toFixed(1) + '%' : '—');

  const onExport = () => {
    if (!stmt) return;
    const out: string[][] = [['USALI Profit & Loss', rangeText], [], ['Line', 'Amount', '% of Revenue']];
    for (const s of stmt.sections) {
      out.push([s.title, '', '']);
      s.lines.forEach(l => out.push([`  ${l.line}`, l.amount.toFixed(2), l.pct.toFixed(1)]));
      out.push([`  TOTAL ${s.title}`, s.total.toFixed(2), s.pct.toFixed(1)]);
      if (s.key === 'departmental') out.push(['TOTAL DEPARTMENTAL PROFIT', stmt.totals.totalDepartmentalProfit.toFixed(2), pct(stmt.totals.totalDepartmentalProfit)]);
      if (s.key === 'undistributed') out.push(['GROSS OPERATING PROFIT (GOP)', stmt.totals.gop.toFixed(2), pct(stmt.totals.gop)]);
      if (s.key === 'nonoperating') out.push(['EBITDA / NET OPERATING INCOME', stmt.totals.ebitda.toFixed(2), pct(stmt.totals.ebitda)]);
    }
    out.push(['NET INCOME (Bottom Line)', stmt.totals.netIncome.toFixed(2), pct(stmt.totals.netIncome)]);
    exportCSV(`usali_pl_${rangeText}.csv`, out);
  };

  // A bold computed-subtotal row (Departmental Profit, GOP, EBITDA, Net Income)
  const SummaryRow: React.FC<{ label: string; amount: number; strong?: boolean }> = ({ label, amount, strong }) => (
    <tr className={`border-t-2 ${strong ? 'bg-blue-50' : 'bg-gray-50'}`}>
      <td className={`px-4 py-2 ${strong ? 'font-extrabold text-blue-900' : 'font-bold'}`} colSpan={2}>{label}</td>
      <td className={`px-4 py-2 text-right font-mono ${strong ? 'font-extrabold text-blue-900' : 'font-bold'} ${amount < 0 ? 'text-red-600' : ''}`}>{formatCurrency(amount)}</td>
      <td className="px-4 py-2 text-right text-gray-600">{pct(amount)}</td>
    </tr>
  );

  return (
    <div className="bg-white rounded-xl shadow-lg p-6">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <h3 className="text-xl font-bold text-gray-800">Profit &amp; Loss Statement (USALI)</h3>
          <p className="text-xs text-gray-500">Hotel operating statement — revenue &amp; cost of sales by outlet, drill-down to transactions</p>
        </div>
        <div className="flex items-end gap-2 no-print">
          <div><label className="text-xs font-medium block">Start</label><Input type="date" value={range.start} onChange={e => setRange(r => ({ ...r, start: e.target.value }))} className="w-40" /></div>
          <div><label className="text-xs font-medium block">End</label><Input type="date" value={range.end} onChange={e => setRange(r => ({ ...r, end: e.target.value }))} className="w-40" /></div>
          <Button variant="outline" size="sm" onClick={() => load()} disabled={loading}><RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />Refresh</Button>
          <Button variant="outline" size="sm" onClick={onExport} disabled={!stmt}>Export CSV</Button>
          <Button variant="outline" size="sm" onClick={() => window.print()} disabled={!stmt}><Printer className="w-4 h-4 mr-2" />Print</Button>
        </div>
      </div>

      {/* KPI header */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
        {[
          { l: 'Available Rooms', v: kpi.available.toLocaleString() },
          { l: 'Occupied Rooms', v: kpi.occupied.toLocaleString() },
          { l: 'Occupancy', v: `${kpi.occupancy.toFixed(1)}%` },
          { l: 'ADR', v: formatCurrency(kpi.adr) },
          { l: 'RevPAR', v: formatCurrency(kpi.revpar) },
        ].map(k => (
          <div key={k.l} className="border rounded-lg p-3 bg-gray-50">
            <p className="text-[11px] text-gray-500">{k.l}</p>
            <p className="text-lg font-bold text-gray-800">{k.v}</p>
          </div>
        ))}
      </div>
      <div className="text-xs text-gray-500 mb-3">Period: {rangeText}</div>

      {loading && <div className="py-8 text-center text-gray-500">Loading statement…</div>}
      {error && <div className="py-3 text-sm text-red-700">{error}</div>}

      {!loading && !error && stmt && (
        <div className="ds-table-container">
          <table className="ds-table w-full">
            <thead className="bg-gray-100">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700" colSpan={2}>Line Item</th>
                <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700">Amount</th>
                <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700">% of Revenue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {stmt.sections.map(section => (
                <React.Fragment key={section.key}>
                  <tr className="bg-gray-800 text-white">
                    <td className="px-4 py-2 font-bold uppercase text-xs tracking-wide" colSpan={4}>{section.title}</td>
                  </tr>
                  {section.lines.map(line => {
                    const lkey = `line:${section.key}:${line.line}`;
                    const isOpen = !!expanded[lkey];
                    return (
                      <React.Fragment key={lkey}>
                        <tr className="hover:bg-gray-50 cursor-pointer" onClick={() => toggle(lkey)}>
                          <td className="px-2 py-2 w-6 text-gray-400">{isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</td>
                          <td className="px-2 py-2 text-sm text-gray-800">{line.line}</td>
                          <td className={`px-4 py-2 text-right font-mono text-sm ${section.kind === 'expense' ? 'text-red-600' : 'text-gray-800'}`}>
                            {section.kind === 'expense' ? `(${formatCurrency(line.amount)})` : formatCurrency(line.amount)}
                          </td>
                          <td className="px-4 py-2 text-right text-sm text-gray-600">{line.pct.toFixed(1)}%</td>
                        </tr>
                        {/* Drill level 2: GL accounts under this line */}
                        {isOpen && line.detail.map(acc => {
                          const akey = `acct:${acc.accountId}`;
                          const aOpen = !!expanded[akey];
                          const tx = txByAccount[acc.accountId] || [];
                          return (
                            <React.Fragment key={akey}>
                              <tr className="bg-gray-50/60 hover:bg-gray-100 cursor-pointer" onClick={() => toggleAccount(acc.accountId)}>
                                <td></td>
                                <td className="px-2 py-1.5 text-xs text-gray-600 pl-6">{aOpen ? '▾' : '▸'} {acc.accountId} · {acc.name}</td>
                                <td className="px-4 py-1.5 text-right font-mono text-xs text-gray-700">{formatCurrency(acc.amount)}</td>
                                <td></td>
                              </tr>
                              {/* Drill level 3: individual journal transactions */}
                              {aOpen && (
                                <tr><td></td><td colSpan={3} className="px-2 pb-2">
                                  <table className="w-full text-[11px] border border-gray-200 rounded">
                                    <thead className="bg-gray-100 text-gray-600">
                                      <tr><th className="px-2 py-1 text-left">Date</th><th className="px-2 py-1 text-left">Reference</th><th className="px-2 py-1 text-left">Source</th><th className="px-2 py-1 text-left">Description</th><th className="px-2 py-1 text-right">Debit</th><th className="px-2 py-1 text-right">Credit</th></tr>
                                    </thead>
                                    <tbody>
                                      {tx.map((t, i) => (
                                        <tr key={i} className="border-t border-gray-100">
                                          <td className="px-2 py-1">{t.date}</td><td className="px-2 py-1 font-mono">{t.reference}</td><td className="px-2 py-1">{t.source}</td>
                                          <td className="px-2 py-1">{t.description}</td>
                                          <td className="px-2 py-1 text-right font-mono">{t.debit ? formatCurrency(t.debit) : ''}</td>
                                          <td className="px-2 py-1 text-right font-mono">{t.credit ? formatCurrency(t.credit) : ''}</td>
                                        </tr>
                                      ))}
                                      {!tx.length && <tr><td colSpan={6} className="px-2 py-1 text-center text-gray-400">No transactions in range.</td></tr>}
                                    </tbody>
                                  </table>
                                </td></tr>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </React.Fragment>
                    );
                  })}
                  {section.lines.length === 0 && (
                    <tr><td colSpan={4} className="px-4 py-2 text-xs text-gray-400 italic">No activity in this range.</td></tr>
                  )}
                  {/* Section total + USALI computed subtotals */}
                  <tr className="border-t bg-gray-100">
                    <td className="px-4 py-2 font-semibold text-sm" colSpan={2}>TOTAL {section.title}</td>
                    <td className={`px-4 py-2 text-right font-mono font-semibold ${section.kind === 'expense' ? 'text-red-600' : ''}`}>
                      {section.kind === 'expense' ? `(${formatCurrency(section.total)})` : formatCurrency(section.total)}
                    </td>
                    <td className="px-4 py-2 text-right text-gray-600">{section.pct.toFixed(1)}%</td>
                  </tr>
                  {section.key === 'departmental' && <SummaryRow label="TOTAL DEPARTMENTAL PROFIT" amount={stmt.totals.totalDepartmentalProfit} />}
                  {section.key === 'undistributed' && <SummaryRow label="GROSS OPERATING PROFIT (GOP)" amount={stmt.totals.gop} strong />}
                  {section.key === 'nonoperating' && <SummaryRow label="EBITDA / NET OPERATING INCOME" amount={stmt.totals.ebitda} />}
                </React.Fragment>
              ))}
              <SummaryRow label="NET INCOME (Bottom-Line Profit)" amount={stmt.totals.netIncome} strong />
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default UsaliPLStatement;
