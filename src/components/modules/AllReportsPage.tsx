import React from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { printDocument } from '@/lib/posIntegration';
import { 
  buildFlashReport, 
  buildPosReconciliation, 
  buildMonthlyPL, 
  buildAgedAR, 
  buildInventoryCOGS, 
  buildPurchaseReceivingLog,
  buildTrialBalance,
  buildDepartmentalSummary,
  buildArrivalsDepartures,
  buildHighBalance,
  generateReportHTML,
  generateDetailedReportHTML,
  ReportOptions
} from '@/lib/reporting';
import { ReportViewer, ReportColumn } from '@/components/ui/ReportViewer';

const parseParams = (): Record<string,string> => {
  try {
    const href = window.location.href;
    const q = href.includes('?') ? href.split('?')[1] : '';
    const params = new URLSearchParams(q);
    const obj: Record<string,string> = {};
    params.forEach((v,k)=>{ obj[k]=v; });
    return obj;
  } catch { return {}; }
};

const updateParams = (params: Record<string,string>) => {
  try {
    const url = new URL(window.location.href);
    Object.entries(params).forEach(([k,v]) => url.searchParams.set(k, v));
    window.history.replaceState({}, '', url.toString());
  } catch {}
};

const last30Days = () => {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 30);
  return { start: start.toISOString().slice(0,10), end: end.toISOString().slice(0,10) };
};

type ShiftTx = { id: string; method: 'cash'|'card'|'room-charge'; amount: number; reference?: string; createdAt: string };
type ShiftStore = { id: string; startedAt: string; endedAt?: string; transactions: ShiftTx[] };

const readAllTransactionsInRange = (startISO: string, endISO: string): ShiftTx[] => {
  const start = new Date(startISO);
  const end = new Date(endISO);
  const inRange = (d: string) => { const dt = new Date(d); return dt >= start && dt <= end; };
  const txs: ShiftTx[] = [];
  try {
    const rawActive = localStorage.getItem('corepms_activeShift');
    if (rawActive) {
      const s = JSON.parse(rawActive) as ShiftStore; if (s?.transactions) txs.push(...s.transactions.filter(t => inRange(t.createdAt)));
    }
  } catch {}
  try {
    const rawEnded = localStorage.getItem('corepms_endedShifts');
    if (rawEnded) {
      const arr = JSON.parse(rawEnded) as ShiftStore[]; arr.forEach(s => { if (s?.transactions) txs.push(...s.transactions.filter(t => inRange(t.createdAt))); });
    }
  } catch {}
  return txs;
};

const REPORTS = [
  { key: 'pnl', name: 'Profit and Loss Statement', description: 'Financial performance summary with margins', type: 'summary' as const },
  { key: 'daily-collection', name: 'Daily Collection', description: 'Cost centre selection and transaction summaries', type: 'detailed' as const },
  { key: 'menu-cos', name: 'Menu Item COS', description: 'Sales vs cost with gross margin', type: 'detailed' as const },
  { key: 'sales-summary', name: 'Sales Summary by Cost Centre', description: 'Aggregated sales by centre', type: 'summary' as const },
  { key: 'sales-detail', name: 'Detailed Sales by Cost Centre', description: 'Transaction-level details with filters', type: 'detailed' as const },
  { key: 'stock-movement', name: 'Stock Movement', description: 'Inventory changes over time', type: 'detailed' as const },
  { key: 'voids', name: 'Voids', description: 'Voided transactions with reasons', type: 'detailed' as const },
  { key: 'recon-summary', name: 'Daily Reconciliation (Summary)', description: 'Key reconciliation metrics', type: 'summary' as const },
  { key: 'stock-adjust', name: 'Stock Adjustments', description: 'Before/after quantities and reasons', type: 'detailed' as const },
  { key: 'purchases', name: 'Purchases', description: 'Procurement activities with vendor analysis', type: 'detailed' as const },
  { key: 'journals', name: 'Journal', description: 'Accounting entries with audit trail', type: 'detailed' as const },
  { key: 'trial-balance', name: 'Trial Balance', description: 'Monthly trial balance with debits and credits', type: 'summary' as const },
  { key: 'aged-ar', name: 'Aged Accounts Receivable', description: 'City ledger aging analysis', type: 'detailed' as const },
  { key: 'arrivals', name: 'Arrivals & Departures', description: 'Daily guest movement report', type: 'detailed' as const },
  { key: 'high-balance', name: 'High Balance Report', description: 'Accounts exceeding threshold', type: 'summary' as const }
];

export const AllReportsPage: React.FC = () => {
  const params = React.useMemo(() => parseParams(), []);
  const defaultRange = React.useMemo(() => last30Days(), []);
  const [start, setStart] = React.useState<string>(params.start || defaultRange.start);
  const [end, setEnd] = React.useState<string>(params.end || defaultRange.end);
  const [page, setPage] = React.useState<number>(Number(params.page || 1));
  const [pageSize, setPageSize] = React.useState<number>(10);
  const [loading, setLoading] = React.useState<boolean>(true);
  const [error, setError] = React.useState<string>('');
  const [metrics, setMetrics] = React.useState<{ count: number; cash: number; card: number; roomCharge: number; total: number }>({ count: 0, cash: 0, card: 0, roomCharge: 0, total: 0 });

  React.useEffect(() => {
    try {
      setLoading(true);
      setError('');
      const timer = setTimeout(() => { setLoading(false); }, 350);
      const txs = readAllTransactionsInRange(start, end);
      const m = txs.reduce((acc, t) => {
        if (t.method === 'cash') acc.cash += t.amount;
        else if (t.method === 'card') acc.card += t.amount;
        else if (t.method === 'room-charge') acc.roomCharge += t.amount;
        acc.count += 1; return acc;
      }, { count: 0, cash: 0, card: 0, roomCharge: 0 });
      setMetrics({ ...m, total: m.cash + m.card + m.roomCharge });
      return () => clearTimeout(timer);
    } catch (err: any) {
      setError('Failed to load reports'); setLoading(false);
    }
  }, [start, end, page, pageSize]);

  React.useEffect(() => {
    updateParams({ start, end, page: String(page) });
  }, [start, end, page]);

  const total = REPORTS.length;
  const startIdx = (page - 1) * pageSize;
  const rows = REPORTS.slice(startIdx, startIdx + pageSize);

  const [openingKey, setOpeningKey] = React.useState<string | null>(null);

  const openReportNewTab = (key: string) => {
    setError(''); setOpeningKey(key);
    try {
      // Build the report content directly to avoid SPA routing issues causing blank pages
      const businessDate = new Date().toISOString().slice(0,10);
      const currentMonth = new Date().toISOString().slice(0,7);
      let data: { title: string; columns: string[]; rows: any[] } | null = null;
      switch (key) {
        case 'pnl':
          data = buildMonthlyPL(currentMonth);
          break;
        case 'daily-collection':
          data = buildFlashReport(businessDate);
          break;
        case 'journals':
          data = buildPosReconciliation(businessDate);
          break;
        case 'purchases':
          data = buildPurchaseReceivingLog(businessDate);
          break;
        case 'voids':
        case 'sales-summary':
        case 'sales-detail':
          data = buildPosReconciliation(businessDate);
          break;
        case 'stock-movement':
        case 'stock-adjust':
          data = buildInventoryCOGS(currentMonth);
          break;
        case 'recon-summary':
          data = buildFlashReport(businessDate);
          break;
        case 'menu-cos':
          data = buildPosReconciliation(businessDate);
          break;
        default:
          data = buildFlashReport(businessDate);
      }
      const html = generateReportHTML(data.title, data.columns, data.rows);
      // First attempt: open a blank tab and write HTML
      try {
        const win = window.open('', '_blank', 'noopener,noreferrer');
        if (!win) throw new Error('popup_blocked');
        win.document.open();
        win.document.write(html);
        win.document.close();
      } catch {
        // Fallback: open via object URL anchor (less likely to be blocked)
        const blob = new Blob([html], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        // Final fallback: if still visible after a short delay, open in current tab
        setTimeout(() => {
          if (document.visibilityState === 'visible') {
            window.location.href = url;
          }
          setTimeout(() => URL.revokeObjectURL(url), 10000);
        }, 500);
      }
      setTimeout(() => setOpeningKey(null), 500);
    } catch (e) {
      console.error('Open report failed', e);
      setError('Failed to open the report. Please try again.');
      setOpeningKey(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-end gap-3">
        <div>
          <label className="text-xs font-medium">Start Date</label>
          <Input type="date" value={start} onChange={(e)=>setStart(e.target.value)} />
        </div>
        <div>
          <label className="text-xs font-medium">End Date</label>
          <Input type="date" value={end} onChange={(e)=>setEnd(e.target.value)} />
        </div>
        <div>
          <label className="text-xs font-medium">Page Size</label>
          <select className="border rounded px-2 py-2" value={pageSize} onChange={(e)=>setPageSize(Number(e.target.value))}>
            {[10,20,50].map(n=> <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-gray-600"><span className="animate-spin">⏳</span> Loading reports…</div>
      )}
      {error && (
        <div className="text-sm text-red-700">{error}</div>
      )}

      {!loading && !error && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="p-2 text-left">Report</th>
                <th className="p-2 text-left">Description</th>
                <th className="p-2 text-right">Transactions</th>
                <th className="p-2 text-right">Total Sales</th>
                <th className="p-2 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.key} className="border-b hover:bg-gray-50">
                  <td className="p-2 font-medium">{String(r.name)}</td>
                  <td className="p-2 text-gray-600">{String(r.description)}</td>
                  <td className="p-2 text-right">{metrics.count}</td>
                  <td className="p-2 text-right">${Number(metrics.total || 0).toFixed(2)}</td>
                  <td className="p-2">
                    <div className="flex items-center gap-2">
                      <Button variant="outline" onClick={() => quickPrint(r.key)} className="hover:bg-gray-100 active:scale-[0.99]">Quick Print</Button>
                      <Button
                        variant="outline"
                        onClick={() => openReportNewTab(r.key)}
                        className={`hover:bg-gray-100 active:scale-[0.99] ${openingKey===r.key ? 'opacity-60 cursor-wait' : ''}`}
                        disabled={openingKey===r.key}
                        aria-busy={openingKey===r.key}
                      >
                        {openingKey===r.key ? 'Opening…' : 'View'}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="text-xs text-gray-600">Showing {Math.min(total, startIdx + rows.length)} of {total} reports · Tx: {metrics.count} · Cash: ${metrics.cash.toFixed(2)} · Card: ${metrics.card.toFixed(2)} · Room: ${metrics.roomCharge.toFixed(2)}</div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setPage(p => Math.max(1, p-1))} disabled={page===1}>Prev</Button>
          <div className="text-sm">Page {page}</div>
          <Button variant="outline" onClick={() => setPage(p => (startIdx + pageSize) < total ? p+1 : p)} disabled={(startIdx + pageSize) >= total}>Next</Button>
        </div>
      </div>
    </div>
  );
};

export default AllReportsPage;
  const businessDate = new Date().toISOString().slice(0,10);
  const currentMonth = new Date().toISOString().slice(0,7);
  const quickPrint = (key: string) => {
    try {
      let data: { title: string; columns: string[]; rows: any[] } | null = null;
      switch (key) {
        case 'pnl':
          data = buildMonthlyPL(currentMonth);
          break;
        case 'daily-collection':
          data = buildFlashReport(businessDate);
          break;
        case 'journals':
          data = buildPosReconciliation(businessDate);
          break;
        case 'purchases':
          data = buildPurchaseReceivingLog(businessDate);
          break;
        case 'voids':
        case 'sales-summary':
        case 'sales-detail':
          data = buildPosReconciliation(businessDate);
          break;
        case 'stock-movement':
        case 'stock-adjust':
          data = buildInventoryCOGS(currentMonth);
          break;
        case 'recon-summary':
          data = buildFlashReport(businessDate);
          break;
        case 'menu-cos':
          data = buildPosReconciliation(businessDate);
          break;
        default:
          data = buildFlashReport(businessDate);
      }
      const html = generateReportHTML(data.title, data.columns, data.rows);
      printDocument(html, data.title, true);
    } catch (e) {
      console.error('Quick Print failed', e);
      alert('Quick Print is not available for this report yet.');
    }
  };
