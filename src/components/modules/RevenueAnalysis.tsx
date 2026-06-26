import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { formatCurrency } from '@/lib/posIntegration';
import { normalizePaymentMethod, paymentMethodLabel } from '@/lib/paymentMethods';
import db from '@/lib/db';
import { RefreshCw, Printer } from 'lucide-react';

// ── Revenue Analysis ─────────────────────────────────────────────────────────
// A self-contained suite of revenue-analysis reports, all driven by live DB data
// over a user-selected date range. Replaces the previous single static
// "Revenue Overview" two-row table.
//
// Reports:
//   • overview        – revenue by GL account (from /api/reports/pl) + share %
//   • by-department   – revenue grouped by the chart-of-accounts department
//   • by-payment      – POS revenue by payment method
//   • by-outlet       – POS revenue by cost centre / outlet
//   • daily-trend     – room revenue (night audit) + POS revenue per day
//   • rooms-kpi       – ADR / RevPAR / Occupancy / room revenue per audited day

type Range = { start: string; end: string };
type Col = { key: string; label: string; align?: 'left' | 'right'; money?: boolean; pct?: boolean };
type ReportData = { columns: Col[]; rows: any[]; total?: Record<string, number> } | null;

const REPORTS = [
  { key: 'overview', name: 'Revenue Overview (by Account)' },
  { key: 'by-department', name: 'Revenue by Department' },
  { key: 'by-payment', name: 'Revenue by Payment Method' },
  { key: 'by-outlet', name: 'Revenue by Outlet / Cost Centre' },
  { key: 'payment-by-dept', name: 'Sales by Payment Method × Department' },
  { key: 'daily-trend', name: 'Daily Revenue Trend' },
  { key: 'rooms-kpi', name: 'Rooms KPIs (ADR / RevPAR / Occupancy)' },
  { key: 'journal-daily', name: 'Daily Journal — Summary (by day, who posted)' },
  { key: 'journal-summary', name: 'Journal Postings — Summary (by Category / Dept)' },
  { key: 'journal-detailed', name: 'Journal Postings — Detailed (per transaction)' },
];

// Reports that support the Category filter (the GL journal-posting reports).
const JOURNAL_REPORTS = new Set(['journal-daily', 'journal-summary', 'journal-detailed']);
const CATEGORIES = ['all', 'Revenue', 'Expense', 'Asset', 'Liability', 'Equity'];

const last30 = (): Range => {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 30);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
};

const exportCSV = (filename: string, headers: string[], rows: string[][]) => {
  const csv = [headers.join(','), ...rows.map(r => r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
};

export const RevenueAnalysis: React.FC = () => {
  const [range, setRange] = React.useState<Range>(() => last30());
  const [selected, setSelected] = React.useState<string>('overview');
  const [catFilter, setCatFilter] = React.useState<string>('all');
  const [loading, setLoading] = React.useState<boolean>(false);
  const [error, setError] = React.useState<string>('');
  const [data, setData] = React.useState<ReportData>(null);

  const load = React.useCallback(async () => {
    setLoading(true); setError(''); setData(null);
    try {
      const { start, end } = range;

      if (selected === 'overview' || selected === 'by-department') {
        // Revenue line items from the GL P&L endpoint (COA-driven, with department).
        const res = await fetch(`/api/reports/pl?from=${start}&to=${end}`);
        const d = await res.json();
        if (!d.ok) throw new Error(d.error || 'P&L fetch failed');
        const revRows = (d.rows || []).filter((r: any) => r.category === 'Revenue');
        const total = revRows.reduce((s: number, r: any) => s + Number(r.amount || 0), 0);

        if (selected === 'overview') {
          const rows = revRows
            .map((r: any) => ({
              account: r.name, department: r.department || 'Undistributed',
              amount: Number(r.amount || 0), pct: total ? (Number(r.amount || 0) / total) * 100 : 0
            }))
            .sort((a: any, b: any) => b.amount - a.amount);
          setData({
            columns: [
              { key: 'account', label: 'Revenue Account', align: 'left' },
              { key: 'department', label: 'Department', align: 'left' },
              { key: 'amount', label: 'Amount', align: 'right', money: true },
              { key: 'pct', label: 'Share', align: 'right', pct: true },
            ],
            rows, total: { amount: total, pct: 100 }
          });
        } else {
          const byDept = new Map<string, number>();
          revRows.forEach((r: any) => {
            const dpt = r.department || 'Undistributed';
            byDept.set(dpt, (byDept.get(dpt) || 0) + Number(r.amount || 0));
          });
          const rows = Array.from(byDept.entries())
            .map(([department, amount]) => ({ department, amount, pct: total ? (amount / total) * 100 : 0 }))
            .sort((a, b) => b.amount - a.amount);
          setData({
            columns: [
              { key: 'department', label: 'Department', align: 'left' },
              { key: 'amount', label: 'Revenue', align: 'right', money: true },
              { key: 'pct', label: 'Share', align: 'right', pct: true },
            ],
            rows, total: { amount: total, pct: 100 }
          });
        }
        return;
      }

      if (selected === 'by-payment') {
        const res = await db.query<any>(
          `SELECT COALESCE(payment_method, 'unknown') AS pm,
                  COALESCE(SUM(total_amount), 0) AS total, COUNT(*) AS orders
           FROM pos_orders
           WHERE status = 'closed' AND created_at::date >= $1::date AND created_at::date <= $2::date
           GROUP BY 1 ORDER BY 2 DESC`,
          [start, end]
        );
        const raw = 'rows' in res ? res.rows : [];
        const grand = raw.reduce((s: number, r: any) => s + Number(r.total || 0), 0);
        const rows = raw.map((r: any) => ({
          method: paymentMethodLabel(normalizePaymentMethod(r.pm)),
          orders: Number(r.orders || 0),
          amount: Number(r.total || 0),
          pct: grand ? (Number(r.total || 0) / grand) * 100 : 0
        }));
        setData({
          columns: [
            { key: 'method', label: 'Payment Method', align: 'left' },
            { key: 'orders', label: 'Orders', align: 'right' },
            { key: 'amount', label: 'Revenue', align: 'right', money: true },
            { key: 'pct', label: 'Share', align: 'right', pct: true },
          ],
          rows, total: { orders: rows.reduce((s, r) => s + r.orders, 0), amount: grand, pct: 100 }
        });
        return;
      }

      if (selected === 'payment-by-dept') {
        // Cross-tab: department (cost centre) × payment method, with per-department subtotals.
        const res = await db.query<any>(
          `SELECT COALESCE(cost_center, 'Unassigned') AS dept,
                  COALESCE(payment_method, 'unknown') AS pm,
                  COALESCE(SUM(total_amount), 0) AS total, COUNT(*) AS orders
           FROM pos_orders
           WHERE status = 'closed' AND created_at::date >= $1::date AND created_at::date <= $2::date
           GROUP BY 1, 2 ORDER BY 1, 3 DESC`,
          [start, end]
        );
        const raw = 'rows' in res ? res.rows : [];
        const grand = raw.reduce((s: number, r: any) => s + Number(r.total || 0), 0);
        const sorted = raw
          .map((r: any) => ({ dept: r.dept, method: paymentMethodLabel(normalizePaymentMethod(r.pm)), orders: Number(r.orders || 0), amount: Number(r.total || 0) }))
          .sort((a, b) => a.dept.localeCompare(b.dept));
        const rows: any[] = [];
        let curDept = ''; let dOrders = 0, dAmt = 0;
        const flush = () => { if (curDept) rows.push({ __subtotal: true, dept: `Subtotal — ${curDept}`, method: '', orders: dOrders, amount: dAmt }); };
        sorted.forEach(r => {
          if (r.dept !== curDept) { flush(); curDept = r.dept; dOrders = 0; dAmt = 0; }
          rows.push(r); dOrders += r.orders; dAmt += r.amount;
        });
        flush();
        setData({
          columns: [
            { key: 'dept', label: 'Department', align: 'left' },
            { key: 'method', label: 'Payment Method', align: 'left' },
            { key: 'orders', label: 'Orders', align: 'right' },
            { key: 'amount', label: 'Revenue', align: 'right', money: true },
          ],
          rows, total: { orders: sorted.reduce((s, r) => s + r.orders, 0), amount: grand }
        });
        return;
      }

      if (selected === 'by-outlet') {
        const res = await db.query<any>(
          `SELECT COALESCE(cost_center, 'Unassigned') AS outlet,
                  COALESCE(SUM(total_amount), 0) AS total, COUNT(*) AS orders
           FROM pos_orders
           WHERE status = 'closed' AND created_at::date >= $1::date AND created_at::date <= $2::date
           GROUP BY 1 ORDER BY 2 DESC`,
          [start, end]
        );
        const raw = 'rows' in res ? res.rows : [];
        const grand = raw.reduce((s: number, r: any) => s + Number(r.total || 0), 0);
        const rows = raw.map((r: any) => ({
          outlet: r.outlet, orders: Number(r.orders || 0), amount: Number(r.total || 0),
          pct: grand ? (Number(r.total || 0) / grand) * 100 : 0
        }));
        setData({
          columns: [
            { key: 'outlet', label: 'Outlet / Cost Centre', align: 'left' },
            { key: 'orders', label: 'Orders', align: 'right' },
            { key: 'amount', label: 'Revenue', align: 'right', money: true },
            { key: 'pct', label: 'Share', align: 'right', pct: true },
          ],
          rows, total: { orders: rows.reduce((s, r) => s + r.orders, 0), amount: grand, pct: 100 }
        });
        return;
      }

      if (selected === 'daily-trend') {
        const [posRes, naRes] = await Promise.all([
          db.query<any>(
            `SELECT created_at::date AS d, COALESCE(SUM(total_amount), 0) AS pos
             FROM pos_orders
             WHERE status = 'closed' AND created_at::date >= $1::date AND created_at::date <= $2::date
             GROUP BY 1`,
            [start, end]
          ),
          db.query<any>(
            `SELECT business_date::date AS d, COALESCE(SUM(room_revenue), 0) AS room
             FROM night_audit_runs
             WHERE status = 'completed' AND business_date >= $1::date AND business_date <= $2::date
             GROUP BY 1`,
            [start, end]
          ),
        ]);
        const byDay = new Map<string, { pos: number; room: number }>();
        ('rows' in posRes ? posRes.rows : []).forEach((r: any) => {
          const k = String(r.d).slice(0, 10);
          byDay.set(k, { pos: Number(r.pos || 0), room: (byDay.get(k)?.room || 0) });
        });
        ('rows' in naRes ? naRes.rows : []).forEach((r: any) => {
          const k = String(r.d).slice(0, 10);
          const cur = byDay.get(k) || { pos: 0, room: 0 };
          cur.room = Number(r.room || 0);
          byDay.set(k, cur);
        });
        const rows = Array.from(byDay.entries())
          .map(([date, v]) => ({ date, room: v.room, pos: v.pos, total: v.room + v.pos }))
          .sort((a, b) => (a.date < b.date ? 1 : -1));
        setData({
          columns: [
            { key: 'date', label: 'Date', align: 'left' },
            { key: 'room', label: 'Room Revenue', align: 'right', money: true },
            { key: 'pos', label: 'F&B / POS', align: 'right', money: true },
            { key: 'total', label: 'Total', align: 'right', money: true },
          ],
          rows,
          total: {
            room: rows.reduce((s, r) => s + r.room, 0),
            pos: rows.reduce((s, r) => s + r.pos, 0),
            total: rows.reduce((s, r) => s + r.total, 0),
          }
        });
        return;
      }

      if (selected === 'rooms-kpi') {
        const res = await db.query<any>(
          `SELECT business_date::date AS d, room_revenue, total_revenue, occupancy_percent, adr, revpar
           FROM night_audit_runs
           WHERE status = 'completed' AND business_date >= $1::date AND business_date <= $2::date
           ORDER BY business_date DESC`,
          [start, end]
        );
        const raw = 'rows' in res ? res.rows : [];
        const rows = raw.map((r: any) => ({
          date: String(r.d).slice(0, 10),
          room: Number(r.room_revenue || 0),
          occupancy: Number(r.occupancy_percent || 0),
          adr: Number(r.adr || 0),
          revpar: Number(r.revpar || 0),
        }));
        setData({
          columns: [
            { key: 'date', label: 'Audit Date', align: 'left' },
            { key: 'room', label: 'Room Revenue', align: 'right', money: true },
            { key: 'occupancy', label: 'Occupancy %', align: 'right', pct: true },
            { key: 'adr', label: 'ADR', align: 'right', money: true },
            { key: 'revpar', label: 'RevPAR', align: 'right', money: true },
          ],
          rows,
          total: { room: rows.reduce((s, r) => s + r.room, 0) }
        });
        return;
      }

      if (selected === 'journal-daily' || selected === 'journal-summary' || selected === 'journal-detailed') {
        // All posted journal lines in range, optionally filtered by category.
        const res = await fetch(`/api/reports/journals?from=${start}&to=${end}`);
        const d = await res.json();
        if (!d.ok) throw new Error(d.error || 'Journals fetch failed');
        let lines = (d.rows || []) as any[];
        if (catFilter !== 'all') lines = lines.filter((l: any) => l.account_category === catFilter);

        const grandDr = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
        const grandCr = lines.reduce((s, l) => s + Number(l.credit || 0), 0);

        if (selected === 'journal-daily') {
          // One row per business date: entry count, who posted, Dr/Cr totals.
          const byDay = new Map<string, { entries: Set<string>; posters: Set<string>; sources: Set<string>; debit: number; credit: number }>();
          lines.forEach((l: any) => {
            const day = l.business_date;
            const cur = byDay.get(day) || { entries: new Set(), posters: new Set(), sources: new Set(), debit: 0, credit: 0 };
            cur.entries.add(l.entry_id); cur.posters.add(l.posted_by || 'system'); cur.sources.add(l.source || '—');
            cur.debit += Number(l.debit || 0); cur.credit += Number(l.credit || 0);
            byDay.set(day, cur);
          });
          const rows = Array.from(byDay.entries())
            .map(([date, v]) => ({ date, entries: v.entries.size, posted_by: Array.from(v.posters).join(', '), sources: Array.from(v.sources).join(', '), debit: v.debit, credit: v.credit }))
            .sort((a, b) => (a.date < b.date ? 1 : -1));
          setData({
            columns: [
              { key: 'date', label: 'Business Date', align: 'left' },
              { key: 'entries', label: 'Entries', align: 'right' },
              { key: 'sources', label: 'Source(s)', align: 'left' },
              { key: 'posted_by', label: 'Posted By', align: 'left' },
              { key: 'debit', label: 'Total Debit', align: 'right', money: true },
              { key: 'credit', label: 'Total Credit', align: 'right', money: true },
            ],
            rows, total: { entries: rows.reduce((s, r) => s + r.entries, 0), debit: grandDr, credit: grandCr }
          });
          return;
        }

        if (selected === 'journal-summary') {
          // Group by Category → Department → Account; per-category subtotals + grand total.
          const key = (l: any) => `${l.account_category}|${l.department || 'Undistributed'}|${l.account_id}`;
          const agg = new Map<string, any>();
          lines.forEach((l: any) => {
            const k = key(l);
            const cur = agg.get(k) || { category: l.account_category, department: l.department || 'Undistributed', account: `${l.account_id} · ${l.account_name}`, debit: 0, credit: 0 };
            cur.debit += Number(l.debit || 0); cur.credit += Number(l.credit || 0);
            agg.set(k, cur);
          });
          const sorted = Array.from(agg.values())
            .map(r => ({ ...r, net: r.debit - r.credit }))
            .sort((a, b) => (a.category + a.department + a.account).localeCompare(b.category + b.department + b.account));
          // inject per-category subtotal rows
          const rows: any[] = [];
          let curCat = ''; let catDr = 0, catCr = 0;
          const flushCat = () => { if (curCat) rows.push({ __subtotal: true, category: `Subtotal — ${curCat}`, department: '', account: '', debit: catDr, credit: catCr, net: catDr - catCr }); };
          sorted.forEach(r => {
            if (r.category !== curCat) { flushCat(); curCat = r.category; catDr = 0; catCr = 0; }
            rows.push(r); catDr += r.debit; catCr += r.credit;
          });
          flushCat();
          setData({
            columns: [
              { key: 'category', label: 'Category', align: 'left' },
              { key: 'department', label: 'Department', align: 'left' },
              { key: 'account', label: 'Account', align: 'left' },
              { key: 'debit', label: 'Debit', align: 'right', money: true },
              { key: 'credit', label: 'Credit', align: 'right', money: true },
              { key: 'net', label: 'Net (Dr−Cr)', align: 'right', money: true },
            ],
            rows, total: { debit: grandDr, credit: grandCr, net: grandDr - grandCr }
          });
        } else {
          // Detailed: every transaction, grouped by category with per-category subtotals.
          const sorted = [...lines].sort((a, b) =>
            (a.account_category + (a.department || '') + a.business_date).localeCompare(b.account_category + (b.department || '') + b.business_date));
          const rows: any[] = [];
          let curCat = ''; let catDr = 0, catCr = 0;
          const flushCat = () => { if (curCat) rows.push({ __subtotal: true, date: `Subtotal — ${curCat}`, debit: catDr, credit: catCr }); };
          sorted.forEach((l: any) => {
            if (l.account_category !== curCat) { flushCat(); curCat = l.account_category; catDr = 0; catCr = 0; }
            rows.push({
              date: l.business_date, account: `${l.account_id} · ${l.account_name}`, category: l.account_category,
              department: l.department || 'Undistributed', reference: l.reference || l.entry_id, source: l.source || '—',
              posted_by: l.posted_by || 'system',
              description: l.line_description || '', debit: Number(l.debit || 0), credit: Number(l.credit || 0),
            });
            catDr += Number(l.debit || 0); catCr += Number(l.credit || 0);
          });
          flushCat();
          setData({
            columns: [
              { key: 'date', label: 'Date', align: 'left' },
              { key: 'account', label: 'Account', align: 'left' },
              { key: 'department', label: 'Department', align: 'left' },
              { key: 'reference', label: 'Reference', align: 'left' },
              { key: 'source', label: 'Source', align: 'left' },
              { key: 'posted_by', label: 'Posted By', align: 'left' },
              { key: 'description', label: 'Description', align: 'left' },
              { key: 'debit', label: 'Debit', align: 'right', money: true },
              { key: 'credit', label: 'Credit', align: 'right', money: true },
            ],
            rows, total: { debit: grandDr, credit: grandCr }
          });
        }
        return;
      }
    } catch (err: any) {
      console.error('[RevenueAnalysis] load failed', err);
      setError(err?.message || 'Failed to load report');
    } finally {
      setLoading(false);
    }
  }, [range, selected, catFilter]);

  React.useEffect(() => { load(); }, [load]);

  const fmt = (col: Col, v: any) => {
    if (v == null || v === '') return '';
    if (col.money) return formatCurrency(Number(v));
    if (col.pct) return `${Number(v).toFixed(1)}%`;
    return String(v);
  };

  const reportName = REPORTS.find(r => r.key === selected)?.name || 'Revenue';
  const rangeText = range.start === range.end ? range.start : `${range.start} to ${range.end}`;

  const onExport = () => {
    if (!data) return;
    const headers = data.columns.map(c => c.label);
    const rows = data.rows.map(r => data.columns.map(c => {
      const v = r[c.key];
      if (c.money) return Number(v || 0).toFixed(2);
      if (c.pct) return Number(v || 0).toFixed(1);
      return String(v ?? '');
    }));
    if (data.total) {
      rows.push(data.columns.map((c, i) => {
        if (i === 0) return 'TOTAL';
        const v = data.total![c.key];
        if (v == null) return '';
        if (c.money) return Number(v).toFixed(2);
        if (c.pct) return Number(v).toFixed(1);
        return String(v);
      }));
    }
    exportCSV(`revenue_${selected}_${rangeText}.csv`, headers, rows);
  };

  return (
    <div className="bg-white rounded-xl shadow-lg p-6">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <h3 className="text-xl font-bold text-gray-800">Revenue Analysis</h3>
        <div className="flex items-end gap-2 no-print">
          <div>
            <label className="text-xs font-medium block">Start</label>
            <Input type="date" value={range.start} onChange={e => setRange(r => ({ ...r, start: e.target.value }))} className="w-40" />
          </div>
          <div>
            <label className="text-xs font-medium block">End</label>
            <Input type="date" value={range.end} onChange={e => setRange(r => ({ ...r, end: e.target.value }))} className="w-40" />
          </div>
          <Button variant="outline" size="sm" onClick={() => load()} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div>
          <label className="text-xs font-medium block">Select Report</label>
          <Select value={selected} onValueChange={setSelected}>
            <SelectTrigger className="w-80"><SelectValue placeholder="Select a Report" /></SelectTrigger>
            <SelectContent>
              {REPORTS.map(r => (<SelectItem key={r.key} value={r.key}>{r.name}</SelectItem>))}
            </SelectContent>
          </Select>
        </div>
        {JOURNAL_REPORTS.has(selected) && (
          <div>
            <label className="text-xs font-medium block">Category</label>
            <Select value={catFilter} onValueChange={setCatFilter}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORIES.map(c => (<SelectItem key={c} value={c}>{c === 'all' ? 'All Categories' : c}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="flex gap-2 no-print">
          <Button variant="outline" size="sm" onClick={onExport} disabled={!data || !data.rows.length}>Export CSV</Button>
          <Button variant="outline" size="sm" onClick={() => window.print()} disabled={!data || !data.rows.length}>
            <Printer className="w-4 h-4 mr-2" /> Print
          </Button>
        </div>
      </div>

      <div className="text-xs text-gray-500 mb-3">{reportName} · {rangeText}</div>

      {loading && <div className="py-8 text-center text-gray-500">Loading revenue data…</div>}
      {error && <div className="py-3 text-sm text-red-700">{error}</div>}

      {!loading && !error && data && (
        <div className="ds-table-container">
          <table className="ds-table">
            <thead className="bg-gray-100">
              <tr>
                {data.columns.map(c => (
                  <th key={c.key} className={`px-4 py-3 text-${c.align || 'left'} text-sm font-semibold text-gray-700`}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {data.rows.map((row, i) => (
                <tr key={i} className={row.__subtotal ? 'bg-gray-100 font-semibold border-t' : 'hover:bg-gray-50'}>
                  {data.columns.map(c => (
                    <td key={c.key} className={`px-4 py-3 text-sm text-${c.align || 'left'} ${c.money ? `font-mono ${row.__subtotal ? '' : 'font-semibold'} text-gray-800` : 'text-gray-700'}`}>
                      {fmt(c, row[c.key])}
                    </td>
                  ))}
                </tr>
              ))}
              {!data.rows.length && (
                <tr><td className="px-4 py-6 text-center text-gray-500" colSpan={data.columns.length}>No revenue data in this range.</td></tr>
              )}
            </tbody>
            {data.total && data.rows.length > 0 && (
              <tfoot>
                <tr className="font-bold border-t-2 bg-gray-50">
                  {data.columns.map((c, i) => (
                    <td key={c.key} className={`px-4 py-3 text-${c.align || 'left'} ${c.money ? 'font-mono' : ''}`}>
                      {i === 0 ? 'TOTAL' : (data.total![c.key] != null ? fmt(c, data.total![c.key]) : '')}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  );
};

export default RevenueAnalysis;
