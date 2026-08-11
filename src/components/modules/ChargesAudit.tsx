import React, { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { getHotelName } from '@/lib/brand';
import { formatShortId } from '@/lib/formatId';

interface Charge {
  id: string; tx_date: string; posting_date: string; business_date: string;
  guest_id: string; guest_name: string; room_number: string | null;
  charge_type: string; category: string; description: string; source: string;
  amount: string | number; tax_amount: string | number; total_amount: string | number;
  folio_id: string | null; reservation_id: string | null; created_by: string | null; code: string;
}

const today = () => new Date().toISOString().slice(0, 10);
const d10 = (s: any) => (s ? String(s).slice(0, 10) : '—');

// Daily Audit Review — server-side paginated folio charges with guest/room join,
// transaction codes, a date filter (defaults to today), and a detail drawer.
export const ChargesAudit: React.FC = () => {
  const [rows, setRows] = useState<Charge[]>([]);
  const [codes, setCodes] = useState<string[]>([]);
  const [meta, setMeta] = useState({ totalCount: 0, totalPages: 1, currentPage: 1 });
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [limit] = useState(25);
  const [startDate, setStartDate] = useState(today());
  const [endDate, setEndDate] = useState(today());
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [chargeCode, setChargeCode] = useState('all');
  const [detail, setDetail] = useState<Charge | null>(null);

  useEffect(() => { fetch('/api/charges/codes').then(r => r.json()).then(r => { if (r.ok) setCodes(r.codes || []); }).catch(() => {}); }, []);
  useEffect(() => { const t = setTimeout(() => { setDebounced(search); setPage(1); }, 300); return () => clearTimeout(t); }, [search]);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (startDate) qs.set('startDate', startDate);
      if (endDate) qs.set('endDate', endDate);
      if (debounced) qs.set('search', debounced);
      if (chargeCode !== 'all') qs.set('chargeCode', chargeCode);
      const r = await fetch(`/api/charges?${qs}`).then(r => r.json());
      if (r.ok) { setRows(r.rows || []); setMeta({ totalCount: r.totalCount, totalPages: r.totalPages, currentPage: r.currentPage }); }
    } finally { setLoading(false); }
  }, [page, limit, startDate, endDate, debounced, chargeCode]);

  useEffect(() => { load(); }, [load]);

  const money = (n: any) => `$ ${Number(n || 0).toFixed(2)}`;
  const esc = (s: any) => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));

  const print = () => {
    const body = rows.map(c =>
      `<tr><td>${esc(d10(c.tx_date))}</td><td>${esc(c.guest_name)}</td><td>${esc(c.room_number || '—')}</td><td>${esc(c.code)}</td><td>${esc(c.description || '')}</td><td class="r">${money(c.total_amount ?? c.amount)}</td></tr>`).join('');
    const html = `<!doctype html><html><head><title>Charges Audit — ${esc(startDate)}${endDate !== startDate ? '→' + esc(endDate) : ''}</title><style>
      body{font-family:system-ui,-apple-system,sans-serif;padding:24px;color:#111}h1{font-size:19px;margin:0 0 2px}.sub{color:#666;font-size:12px;margin-bottom:12px}
      table{width:100%;border-collapse:collapse;font-size:12px}th,td{border-bottom:1px solid #ddd;padding:5px 8px;text-align:left}th{background:#f5f5f7;text-transform:uppercase;font-size:10px;color:#555}.r{text-align:right}
    </style></head><body><h1>${esc(getHotelName())} — Charges Audit Review</h1>
      <div class="sub">${esc(startDate)}${endDate !== startDate ? ' → ' + esc(endDate) : ''} · ${meta.totalCount} postings · Printed ${new Date().toLocaleString()}</div>
      <table><thead><tr><th>Date</th><th>Guest</th><th>Room</th><th>Code</th><th>Description</th><th class="r">Amount</th></tr></thead><tbody>${body}</tbody></table>
    </body></html>`;
    const w = window.open('', '_blank'); if (w) { w.document.write(html); w.document.close(); w.focus(); setTimeout(() => w.print(), 300); }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div><label className="text-xs block">From (audit date)</label><Input type="date" className="w-[150px]" value={startDate} onChange={e => { setStartDate(e.target.value); setPage(1); }} /></div>
        <div><label className="text-xs block">To</label><Input type="date" className="w-[150px]" value={endDate} onChange={e => { setEndDate(e.target.value); setPage(1); }} /></div>
        <div>
          <label className="text-xs block">Code</label>
          <select className="border rounded px-2 py-2 text-sm" value={chargeCode} onChange={e => { setChargeCode(e.target.value); setPage(1); }}>
            <option value="all">All codes</option>
            {codes.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="flex-1 min-w-[180px]"><label className="text-xs block">Search (guest / room / description)</label><Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Type to search…" /></div>
        <Button variant="outline" onClick={print} disabled={rows.length === 0}>🖨 Print</Button>
      </div>

      <div className="border rounded overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="bg-gray-50 text-gray-600">
            <th className="p-2 text-left">Date</th><th className="p-2 text-left">Guest</th><th className="p-2 text-left">Room</th>
            <th className="p-2 text-left">Code</th><th className="p-2 text-left">Description</th><th className="p-2 text-right">Amount</th>
          </tr></thead>
          <tbody>
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => <tr key={i} className="border-t animate-pulse"><td colSpan={6} className="p-3"><div className="h-3 bg-gray-100 rounded" /></td></tr>)
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} className="p-6 text-center text-gray-500">No charges for this filter.</td></tr>
            ) : rows.map(c => (
              <tr key={c.id} className="border-t hover:bg-indigo-50 cursor-pointer" onClick={() => setDetail(c)} title="Click for full posting detail">
                <td className="p-2 whitespace-nowrap">{d10(c.tx_date)}</td>
                <td className="p-2">{c.guest_name}</td>
                <td className="p-2">{c.room_number || '—'}</td>
                <td className="p-2"><span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-indigo-100 text-indigo-700">{c.code}</span></td>
                <td className="p-2 text-gray-600">{c.description || '—'}</td>
                <td className={`p-2 text-right font-mono ${String(c.charge_type).toLowerCase() === 'payment' ? 'text-green-700' : ''}`}>{money(c.total_amount ?? c.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm">
        <div className="text-gray-500">{meta.totalCount} postings</div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage(p => p - 1)}>Previous</Button>
          <span className="text-xs">Page {meta.currentPage} of {meta.totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= meta.totalPages || loading} onClick={() => setPage(p => p + 1)}>Next</Button>
        </div>
      </div>

      {detail && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40" onClick={() => setDetail(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-3 border-b flex items-center justify-between">
              <div className="font-bold text-sm">Posting Detail</div>
              <button onClick={() => setDetail(null)} className="text-gray-400 hover:text-gray-700 font-bold text-lg">✕</button>
            </div>
            <div className="px-5 py-4 space-y-1.5 text-sm">
              {[['Guest', detail.guest_name], ['Room', detail.room_number || '—'], ['Date', d10(detail.tx_date)],
                ['Posting date', d10(detail.posting_date)], ['Code', detail.code], ['Description', detail.description || '—'],
                ['Category', detail.category || '—'], ['Source', detail.source || '—'],
                ['Amount', money(detail.amount)], ['Tax', money(detail.tax_amount)], ['Total', money(detail.total_amount ?? detail.amount)],
                ['Folio', formatShortId(detail.folio_id)], ['Posted by', detail.created_by || '—']].map(([k, v]) => (
                <div key={k as string} className="flex justify-between gap-4"><span className="text-gray-500">{k}</span><span className="font-medium text-right" title={String(v)}>{v}</span></div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChargesAudit;
