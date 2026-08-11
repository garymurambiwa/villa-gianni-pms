import React, { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { getHotelName } from '@/lib/brand';

interface GuestRow { id: string; full_name: string; email: string | null; phone: string | null; id_number?: string | null; }

// Guest Registry with server-side search + pagination (default: most recent 20).
// Replaces loading every guest into state, which would crash as the DB grows.
export const GuestRegistry: React.FC<{ onEdit?: (g: GuestRow) => void; onDeleted?: () => void }> = ({ onEdit, onDeleted }) => {
  const [rows, setRows] = useState<GuestRow[]>([]);
  const [meta, setMeta] = useState({ totalCount: 0, totalPages: 1, currentPage: 1 });
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => { const t = setTimeout(() => { setDebounced(search); setPage(1); }, 300); return () => clearTimeout(t); }, [search]);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ page: String(page), limit: '20' });
      if (debounced) qs.set('search', debounced);
      const r = await fetch(`/api/guests?${qs}`).then(r => r.json());
      if (r.ok) { setRows(r.guests || []); setMeta({ totalCount: r.totalCount, totalPages: r.totalPages, currentPage: r.currentPage }); }
    } finally { setLoading(false); }
  }, [page, debounced]);

  useEffect(() => { load(); }, [load]);

  const del = async (g: GuestRow) => {
    if (!confirm('Delete this guest profile?')) return;
    try {
      const { deleteGuestFromDb } = await import('@/lib/dbSync');
      const res = await deleteGuestFromDb(g.id);
      if (res.success) { const { toast } = await import('sonner'); toast.success('Guest profile deleted'); load(); onDeleted?.(); }
      else { const { toast } = await import('sonner'); toast.error('Failed to delete: ' + res.error); }
    } catch { const { toast } = await import('sonner'); toast.error('Failed to delete guest'); }
  };

  const esc = (s: any) => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));
  const print = () => {
    const body = rows.map(g => `<tr><td>${esc(g.full_name)}</td><td>${esc(g.email || '—')}</td><td>${esc(g.phone || '—')}</td></tr>`).join('');
    const html = `<!doctype html><html><head><title>Guest Registry</title><style>body{font-family:system-ui,-apple-system,sans-serif;padding:24px}h1{font-size:19px;margin:0 0 2px}.sub{color:#666;font-size:12px;margin-bottom:12px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border-bottom:1px solid #ddd;padding:5px 8px;text-align:left}th{background:#f5f5f7;text-transform:uppercase;font-size:10px;color:#555}</style></head><body>
      <h1>${esc(getHotelName())} — Guest Registry</h1>
      <div class="sub">${debounced ? `Filter: "${esc(debounced)}" · ` : ''}${meta.totalCount} guests · Page ${meta.currentPage}/${meta.totalPages} · Printed ${new Date().toLocaleString()}</div>
      <table><thead><tr><th>Guest Name</th><th>Email</th><th>Phone</th></tr></thead><tbody>${body}</tbody></table></body></html>`;
    const w = window.open('', '_blank'); if (w) { w.document.write(html); w.document.close(); w.focus(); setTimeout(() => w.print(), 300); }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[220px]"><label className="text-xs block">Search (name, email or phone)</label><Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Type to search the whole registry…" /></div>
        <Button variant="outline" onClick={print} disabled={rows.length === 0}>🖨 Print List</Button>
      </div>
      <div className="border rounded overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="bg-gray-50 text-gray-600"><th className="p-2 text-left">Guest Name</th><th className="p-2 text-left">Email</th><th className="p-2 text-left">Phone</th><th className="p-2 text-right">Action</th></tr></thead>
          <tbody>
            {loading ? Array.from({ length: 5 }).map((_, i) => <tr key={i} className="border-t animate-pulse"><td colSpan={4} className="p-3"><div className="h-3 bg-gray-100 rounded" /></td></tr>)
              : rows.length === 0 ? <tr><td colSpan={4} className="p-6 text-center text-gray-500">{debounced ? 'No guests match your search.' : 'No guests yet.'}</td></tr>
              : rows.map(g => (
                <tr key={g.id} className="border-t">
                  <td className="p-2 font-medium">{g.full_name}</td>
                  <td className="p-2">{g.email || '—'}</td>
                  <td className="p-2">{g.phone || '—'}</td>
                  <td className="p-2 text-right">
                    <div className="flex justify-end gap-2">
                      {onEdit && <Button size="sm" variant="ghost" onClick={() => onEdit(g)}>Edit</Button>}
                      <Button size="sm" variant="ghost" className="text-red-600 hover:bg-red-50" onClick={() => del(g)}>Delete</Button>
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between text-sm">
        <div className="text-gray-500">{meta.totalCount} guests{debounced ? ' matching' : ''}</div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage(p => p - 1)}>Previous</Button>
          <span className="text-xs">Page {meta.currentPage} of {meta.totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= meta.totalPages || loading} onClick={() => setPage(p => p + 1)}>Next</Button>
        </div>
      </div>
    </div>
  );
};

export default GuestRegistry;
