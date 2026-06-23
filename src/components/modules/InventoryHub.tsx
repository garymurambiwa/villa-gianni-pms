/**
 * InventoryHub — unified back-office hub for POS inventory management.
 * Tabs: Items · Suppliers · GRN · Transfer · Recipes · Reports
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { TransactionFilterBar } from '@/components/shared/TransactionFilterBar';
import { filterRows, printTransactionList, EMPTY_TRANSACTION_FILTER, type TransactionFilterValue } from '@/lib/transactionFilters';
import { usePagination } from '@/hooks/usePagination';
import PaginationBar from '@/components/shared/PaginationBar';

const API = '/api/v1/inventory';
const DB  = '/api/db/query';
const fmt = (n: number) => `$${Number(n || 0).toFixed(2)}`;
const fmtQ = (n: number) => Number(n || 0).toFixed(3).replace(/\.?0+$/, '');

// ── helpers ──────────────────────────────────────────────────────────────────
async function apiGet(path: string) {
  const r = await fetch(`${API}${path}`);
  return r.json();
}
async function apiPost(path: string, body: object) {
  const r = await fetch(`${API}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return r.json();
}
function downloadCSV(filename: string, rows: Record<string, unknown>[], columns: string[]) {
  const header = columns.join(',');
  const body = rows.map(r => columns.map(c => JSON.stringify(r[c] ?? '')).join(',')).join('\n');
  const blob = new Blob([header + '\n' + body], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
async function dbQuery(sql: string, params?: any[]) {
  const r = await fetch(DB, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, params })
  });
  return r.json();
}

// ── shared useInventoryData hook ─────────────────────────────────────────────
function useInventoryData() {
  const [items, setItems]         = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [uoms, setUoms]           = useState<any[]>([]);
  const [vendors, setVendors]     = useState<any[]>([]);
  const [loading, setLoading]     = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    const [iR, lR, uR] = await Promise.all([
      apiGet('/items?limit=10000'),
      apiGet('/locations'),
      apiGet('/uom'),
    ]);
    if (iR.ok) setItems(iR.data);
    if (lR.ok) setLocations(lR.data);
    if (uR.ok) setUoms(uR.data);
    // vendors from main DB
    try {
      const vd = await dbQuery(`SELECT id, name, contact_person, phone, email, payment_terms FROM vendors WHERE status = 'active' ORDER BY name`);
      if (vd.ok) setVendors(vd.rows);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { reload(); }, [reload]);
  return { items, locations, uoms, vendors, loading, reload };
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 1 — ITEM MASTER
// ─────────────────────────────────────────────────────────────────────────────
const CATEGORIES = ['Food', 'Beverage', 'Cleaning', 'Stationery', 'Linen', 'Other'];
const LOCATIONS_STORAGE = ['loc_main_cellar','loc_dry_goods','loc_freezer','loc_perishables'];

function ItemMaster({ data }: { data: ReturnType<typeof useInventoryData> }) {
  const { items, locations, uoms, vendors, reload } = data;
  const { toast } = useToast();
  const { user } = useAuth();
  const [filters, setFilters] = useState<TransactionFilterValue>({ ...EMPTY_TRANSACTION_FILTER });
  const [editItem, setEditItem] = useState<any | null>(null);
  const [form, setForm] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null);
  const imgRef = useRef<HTMLInputElement>(null);

  const deleteItem = async (item: any) => {
    if (!window.confirm(`Delete "${item.name}"? This cannot be undone.`)) return;
    setDeletingItemId(item.id);
    try {
      const r = await fetch(`${API}/items/${item.id}`, { method: 'DELETE' }).then(x => x.json());
      if (r.ok) {
        toast({ title: 'Item deleted' });
        reload();
      } else {
        toast({ title: 'Delete failed', description: r.error || 'Item may have GRN history — archive instead', variant: 'destructive' });
      }
    } catch (e: any) {
      toast({ title: 'Delete failed', description: e?.message, variant: 'destructive' });
    }
    setDeletingItemId(null);
  };

  const printItem = (item: any) => {
    const loc = locations.find((l:any) => l.id === item.default_location_id)?.name || '—';
    const uom = uoms.find((u:any) => u.id === item.base_uom_id)?.name || item.base_uom_id;
    const supplier = vendors.find((v:any) => v.id === item.supplier_id)?.name || '—';
    const fmt2 = (n: any) => Number(n || 0).toFixed(2);
    const html = `<!doctype html><html><head><meta charset="utf-8"/><title>Item — ${item.name}</title>
      <style>
        body { font-family: system-ui, -apple-system, sans-serif; padding: 28px; color: #111; max-width: 600px; margin: auto; }
        h1 { font-size: 22px; margin: 0 0 4px; }
        .sub { color: #666; font-size: 13px; margin-bottom: 18px; }
        table { width: 100%; border-collapse: collapse; font-size: 13px; }
        td { padding: 8px 10px; border-bottom: 1px solid #eee; }
        td.label { color: #555; width: 40%; font-weight: 600; }
        .barcode { margin: 20px 0; padding: 16px; border: 2px dashed #ccc; text-align: center; font-family: 'Courier New', monospace; font-size: 16px; letter-spacing: 2px; }
        .footer { margin-top: 24px; font-size: 11px; color: #888; border-top: 1px solid #eee; padding-top: 8px; }
      </style></head><body>
      <h1>${item.name}</h1>
      <div class="sub">SKU: ${item.sku || '—'} · Category: ${item.category || '—'}</div>
      ${item.barcode ? `<div class="barcode">${item.barcode}</div>` : ''}
      <table>
        <tr><td class="label">Item ID</td><td>${item.id}</td></tr>
        <tr><td class="label">Short ID</td><td>${item.short_id || String(item.id || '').slice(-4).toUpperCase()}</td></tr>
        <tr><td class="label">Sub-Category</td><td>${item.sub_category || '—'}</td></tr>
        <tr><td class="label">Base UOM</td><td>${uom}</td></tr>
        <tr><td class="label">Holding Location</td><td>${loc}</td></tr>
        <tr><td class="label">Last Cost Price</td><td>$${fmt2(item.last_cost_price)}</td></tr>
        <tr><td class="label">Weighted Avg Cost</td><td>$${fmt2(item.weighted_avg_cost)}</td></tr>
        <tr><td class="label">Selling Price</td><td>$${fmt2(item.selling_price)}</td></tr>
        <tr><td class="label">Par Level (reorder)</td><td>${item.par_level || '—'}</td></tr>
        <tr><td class="label">Default Wastage %</td><td>${item.default_wastage_pct ? item.default_wastage_pct + '%' : '—'}</td></tr>
        <tr><td class="label">Preferred Supplier</td><td>${supplier}</td></tr>
        <tr><td class="label">Expiry Tracking</td><td>${item.expiry_tracking ? 'Yes' : 'No'}</td></tr>
        ${item.notes ? `<tr><td class="label">Notes</td><td>${item.notes}</td></tr>` : ''}
        <tr><td class="label">Created</td><td>${new Date(item.inserted_at).toLocaleString()}</td></tr>
      </table>
      <div class="footer">Printed ${new Date().toLocaleString()} · Powered by COREPMS</div>
      <script>window.onload = () => { setTimeout(() => window.print(), 250); };</script>
      </body></html>`;
    const w = window.open('about:blank', '_blank');
    if (!w) { toast({ title: 'Pop-up blocked', description: 'Allow pop-ups to print item specs.', variant: 'destructive' }); return; }
    w.document.open(); w.document.write(html); w.document.close();
  };

  const filtered = filterRows(items, filters, {
    date: (i:any) => i.inserted_at,
    category: (i:any) => i.category,
    search: (i:any) => [i.name, i.sku, i.short_id, i.id],
  });
  const itemsPg = usePagination<any>(filtered);

  // Categories actually present (fall back to the master list for new setups).
  const itemCategories = (() => {
    const present = Array.from(new Set(items.map((i:any) => i.category).filter(Boolean))).sort();
    return present.length ? present : CATEGORIES;
  })();

  const printItems = () => printTransactionList({
    title: 'Inventory Items',
    filters,
    columns: [
      { header: 'Short ID', value: (i:any) => '#' + (i.short_id || String(i.id || '').slice(-4)).toUpperCase() },
      { header: 'SKU', value: (i:any) => i.sku || '—' },
      { header: 'Name', value: (i:any) => i.name || '' },
      { header: 'Category', value: (i:any) => i.category || '' },
      { header: 'UOM', value: (i:any) => i.base_uom_code || i.base_uom_id || '' },
      { header: 'Cost', value: (i:any) => fmt(i.last_cost_price), align: 'right' },
      { header: 'Avg Cost', value: (i:any) => fmt(i.weighted_avg_cost), align: 'right' },
      { header: 'Location', value: (i:any) => locations.find((l:any) => l.id === i.default_location_id)?.name || '—' },
      { header: 'Date', value: (i:any) => i.inserted_at ? new Date(i.inserted_at).toLocaleDateString() : '' },
    ],
    rows: filtered,
    footer: [{ label: 'Items', value: filtered.length }],
  });

  const openNew = () => {
    setForm({ category: 'Food', base_uom_id: 'uom_unit', expiry_tracking: false });
    setEditItem({});
  };
  const openEdit = (item: any) => { setForm({ ...item }); setEditItem(item); };
  const closeModal = () => { setEditItem(null); setForm({}); };

  const save = async () => {
    if (!form.name?.trim()) { toast({ title: 'Name required', variant: 'destructive' }); return; }
    if (!form.base_uom_id) { toast({ title: 'Base UOM required', variant: 'destructive' }); return; }
    if (Number(form.selling_price || 0) > 0 && Number(form.last_cost_price || 0) > 0 &&
        Number(form.selling_price) < Number(form.last_cost_price)) {
      toast({ title: 'Warning', description: 'Selling price is below cost price — margin will be negative', variant: 'destructive' });
    }
    setSaving(true);
    try {
      const method  = editItem?.id ? 'PUT' : 'POST';
      const url     = editItem?.id ? `${API}/items/${editItem.id}` : `${API}/items`;
      const payload = { ...form, id: editItem?.id || undefined };

      let res = await fetch(url, {
        method, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(r => r.json());

      // ── Auto-retry if server auto-seeded UOMs (FK constraint was missing data) ──
      // Server returns retry:true when it detected and fixed an empty UOM table
      if (!res.ok && res.retry) {
        toast({ title: 'Fixing data…', description: res.hint || 'Re-initialising inventory data. Retrying…' });
        await new Promise(resolve => setTimeout(resolve, 1200)); // brief pause for seeding
        res = await fetch(url, {
          method, headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }).then(r => r.json());
      }

      if (res.ok) {
        toast({ title: editItem?.id ? 'Item updated' : 'Item created' });
        closeModal();
        reload();
      } else {
        toast({ title: 'Save failed', description: res.error || 'Unknown error', variant: 'destructive' });
      }
    } catch (e: any) {
      toast({ title: 'Network error', description: e?.message || 'Could not save item', variant: 'destructive' });
    }
    setSaving(false);
  };

  const handleImg = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setForm((f: any) => ({ ...f, media_url: ev.target?.result as string }));
    reader.readAsDataURL(file);
  };

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <TransactionFilterBar
        value={filters}
        onChange={setFilters}
        show={{ department: false, status: false }}
        categories={itemCategories}
        searchPlaceholder="Search by ID, short ID, name, or SKU…"
        resultCount={filtered.length}
        onPrint={printItems}
        rightActions={
          <Button onClick={openNew} className="bg-indigo-600 text-white hover:bg-indigo-700">＋ New Item</Button>
        }
        className="mb-4"
      />

      {/* Table */}
      <div className="flex-1 overflow-auto rounded-lg border border-gray-200">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              {['ID','SKU','Name','Category','Base UOM','Cost Price','Avg Cost','Location','Expiry','Date','Actions'].map(h => (
                <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.length === 0 && (
              <tr><td colSpan={11} className="text-center py-12 text-gray-400">No items found</td></tr>
            )}
            {itemsPg.pageItems.map((item: any) => (
              <tr key={item.id} className="hover:bg-gray-50">
                <td className="px-3 py-2 font-mono text-xs text-gray-500">
                  <span className="bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded text-[11px] font-mono font-semibold tracking-wide">
                    #{(item.short_id || String(item.id || '').slice(-4)).toUpperCase()}
                  </span>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-purple-700">{item.sku || '—'}</td>
                <td className="px-3 py-2 font-medium">{item.name}</td>
                <td className="px-3 py-2">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${item.category==='Beverage'?'bg-blue-100 text-blue-700':'bg-green-100 text-green-700'}`}>
                    {item.category}
                  </span>
                </td>
                <td className="px-3 py-2 text-gray-500">{item.base_uom_code || item.base_uom_id}</td>
                <td className="px-3 py-2">{fmt(item.last_cost_price)}</td>
                <td className="px-3 py-2 font-medium text-indigo-700">{fmt(item.weighted_avg_cost)}</td>
                <td className="px-3 py-2 text-xs text-gray-500">
                  {locations.find(l => l.id === item.default_location_id)?.name || '—'}
                </td>
                <td className="px-3 py-2">
                  {item.expiry_tracking ? <span className="text-orange-600 text-xs">● Tracked</span> : <span className="text-gray-300 text-xs">—</span>}
                </td>
                <td className="px-3 py-2 text-gray-500 text-xs">{new Date(item.inserted_at).toLocaleDateString()}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => openEdit(item)}
                      title="Edit item"
                      className="text-xs text-blue-600 hover:text-blue-800 px-2 py-1 rounded border border-blue-200 hover:bg-blue-50 transition-colors">
                      Edit
                    </button>
                    <button
                      onClick={() => printItem(item)}
                      title="Print item label / spec sheet"
                      className="text-xs text-gray-700 hover:text-gray-900 px-2 py-1 rounded border border-gray-200 hover:bg-gray-50 transition-colors">
                      Print
                    </button>
                    <button
                      onClick={() => deleteItem(item)}
                      disabled={deletingItemId === item.id}
                      title="Delete item"
                      className="text-xs text-red-500 hover:text-red-700 disabled:opacity-40 px-2 py-1 rounded border border-red-200 hover:bg-red-50 transition-colors">
                      {deletingItemId === item.id ? '…' : 'Delete'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <PaginationBar {...itemsPg} itemLabel="items" />

      {/* Item Edit/Create Modal — SINGLE SOURCE OF TRUTH */}
      {editItem !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6">
            <h3 className="text-lg font-bold mb-1">{editItem?.id ? 'Edit Item' : 'New Stock Item'}</h3>
            <p className="text-xs text-gray-500 mb-4">
              {editItem?.id
                ? 'Changes sync to POS menu automatically.'
                : '📦 Inventory is the source of truth. Once saved, this item will appear in the POS stock list and can be received via GRN.'}
            </p>

            <div className="grid grid-cols-2 gap-4">
              {/* Name */}
              <div className="col-span-2">
                <label className="block text-xs font-semibold text-gray-600 mb-1">Item Name *</label>
                <Input value={form.name||''} onChange={e => setForm((f:any)=>({...f,name:e.target.value}))} placeholder="e.g. Coke Can 330ml" />
              </div>

              {/* SKU */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">SKU Code</label>
                <Input value={form.sku||''} onChange={e => setForm((f:any)=>({...f,sku:e.target.value}))} placeholder="e.g. BEV00001" />
              </div>

              {/* Barcode */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Barcode (future use)</label>
                <Input value={form.barcode||''} onChange={e => setForm((f:any)=>({...f,barcode:e.target.value}))} placeholder="EAN-13 or QR" />
              </div>

              {/* Category */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Category *</label>
                <select className="w-full border rounded-md px-3 py-2 text-sm"
                  value={form.category||'Food'} onChange={e => setForm((f:any)=>({...f,category:e.target.value}))}>
                  {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>

              {/* Sub-category */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Sub-Category</label>
                <Input value={form.sub_category||''} onChange={e => setForm((f:any)=>({...f,sub_category:e.target.value}))} placeholder="e.g. Spirits, Poultry" />
              </div>

              {/* Base UOM */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Base Unit of Measure *</label>
                <select className="w-full border rounded-md px-3 py-2 text-sm"
                  value={form.base_uom_id||'uom_unit'} onChange={e => setForm((f:any)=>({...f,base_uom_id:e.target.value}))}>
                  {uoms.map((u:any) => <option key={u.id} value={u.id}>{u.name} ({u.code})</option>)}
                </select>
              </div>

              {/* Holding Location */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Holding Location</label>
                <select className="w-full border rounded-md px-3 py-2 text-sm"
                  value={form.default_location_id||''} onChange={e => setForm((f:any)=>({...f,default_location_id:e.target.value}))}>
                  <option value="">— Select —</option>
                  {locations.filter((l:any) => l.location_type === 'Storage').map((l:any) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              </div>

              {/* Cost Price */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  Cost Price <span className="text-gray-400 font-normal text-[10px]">(internal — not shown on POS)</span>
                </label>
                <Input type="number" min={0} step="0.0001" value={form.last_cost_price||''} placeholder="0.0000"
                  onChange={e => setForm((f:any)=>({...f,last_cost_price:e.target.value}))} />
              </div>

              {/* Selling Price */}
              <div>
                <label className="block text-xs font-semibold text-purple-700 mb-1">
                  Selling Price <span className="text-gray-400 font-normal text-[10px]">(shown on POS menu)</span>
                </label>
                <Input type="number" min={0} step="0.01" value={form.selling_price||''} placeholder="0.00"
                  className="border-purple-300 focus:ring-purple-400"
                  onChange={e => setForm((f:any)=>({...f,selling_price:e.target.value}))} />
              </div>

              {/* Par Level */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Par Level (reorder point)</label>
                <Input type="number" min={0} step="0.001" value={form.par_level||''} placeholder="0"
                  onChange={e => setForm((f:any)=>({...f,par_level:e.target.value}))} />
              </div>

              {/* Wastage % */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Default Wastage %</label>
                <Input type="number" min={0} max={100} step="0.1" value={form.default_wastage_pct||''} placeholder="0"
                  onChange={e => setForm((f:any)=>({...f,default_wastage_pct:e.target.value}))} />
              </div>

              {/* Supplier */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Preferred Supplier</label>
                <select className="w-full border rounded-md px-3 py-2 text-sm"
                  value={form.supplier_id||''} onChange={e => setForm((f:any)=>({...f,supplier_id:e.target.value}))}>
                  <option value="">— None —</option>
                  {Array.from(new Map(data.vendors.map((v:any) => [v.id, v])).values()).map((v:any) => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
              </div>

               {/* Expiry tracking */}
               <div className="flex items-center gap-3">
                 <input type="checkbox" id="expiry" checked={!!form.expiry_tracking}
                   onChange={e => setForm((f:any)=>({...f,expiry_tracking:e.target.checked}))} className="w-4 h-4" />
                 <label htmlFor="expiry" className="text-sm font-medium cursor-pointer">Track Expiry Dates</label>
               </div>

               {/* Date */}
               <div className="col-span-2">
                 <label className="block text-xs font-semibold text-gray-600 mb-1">Date</label>
                 <input type="date" className="w-full border rounded-md px-3 py-2 text-sm" value={form.date||''} onChange={e => setForm((f:any)=>({...f,date:e.target.value}))} />
               </div>

               {/* Notes */}
               <div className="col-span-2">
                 <label className="block text-xs font-semibold text-gray-600 mb-1">Notes</label>
                 <textarea className="w-full border rounded-md px-3 py-2 text-sm" rows={2}
                   value={form.notes||''} onChange={e => setForm((f:any)=>({...f,notes:e.target.value}))}
                   placeholder="Any additional notes..." />
               </div>

              {/* Picture */}
              <div className="col-span-2">
                <label className="block text-xs font-semibold text-gray-600 mb-1">Product Picture</label>
                <div className="flex items-center gap-3">
                  <Button variant="outline" size="sm" onClick={() => imgRef.current?.click()}>Upload Image</Button>
                  <input ref={imgRef} type="file" accept="image/*" className="hidden" onChange={handleImg} />
                  {form.media_url && <img src={form.media_url} alt="preview" className="h-12 w-12 object-cover rounded border" />}
                </div>
              </div>
            </div>

            {/* Computed avg cost display */}
            {form.weighted_avg_cost > 0 && (
              <div className="mt-4 p-3 rounded bg-indigo-50 border border-indigo-100 text-sm">
                <span className="text-indigo-600 font-semibold">Weighted Average Cost: </span>
                <span className="font-bold">{fmt(form.weighted_avg_cost)}</span>
                <span className="text-gray-400 text-xs ml-2">(auto-calculated from GRNs)</span>
              </div>
            )}

            <div className="flex gap-3 mt-6 justify-end">
              <Button variant="outline" onClick={closeModal}>Cancel</Button>
              <Button onClick={save} disabled={saving} className="bg-indigo-600 text-white hover:bg-indigo-700">
                {saving ? 'Saving…' : 'Save Item'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 2 — GRN (Goods Received Note)
// ─────────────────────────────────────────────────────────────────────────────
function GRNModule({ data }: { data: ReturnType<typeof useInventoryData> }) {
  const { items, locations, uoms, vendors } = data;
  const { user } = useAuth();
  const { toast } = useToast();
  const [grns, setGrns] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [fullScreen, setFullScreen] = useState(false);
  const [supplier, setSupplier] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [invoiceNum, setInvoiceNum] = useState('');
  // FIX: never hardcode loc_main_cellar — it may be is_active=false on some properties.
  // Initialize to empty string and let useEffect below set the first active storage location.
  const [destLocation, setDestLocation] = useState('');
  const [lines, setLines] = useState<any[]>([{ item_id:'', item_name:'', qty:1, uom:'uom_unit', unit_cost:0, vat_type:'15.50', expiry_date:'' }]);
  const [saving, setSaving] = useState(false);
  const [itemSearch, setItemSearch] = useState<Record<number,string>>({});
  // Floating dropdown state
  const [dropdownAnchor, setDropdownAnchor] = useState<{ lineIdx: number; rect: DOMRect } | null>(null);
  const inputRefs = useRef<Record<number, HTMLInputElement | null>>({});
  // GRN detail/delete state
  const [detailGrn, setDetailGrn] = useState<any | null>(null);
  const [detailLines, setDetailLines] = useState<any[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [postingId, setPostingId] = useState<string | null>(null);
  const [editingGrnId, setEditingGrnId] = useState<string | null>(null); // null = new GRN, non-null = editing draft
  // GRN header fields — these were the missing state variables causing ReferenceError
  const [grnDate, setGrnDate] = useState(new Date().toISOString().split('T')[0]);
  const [grnNotes, setGrnNotes] = useState('');
  // Shared transaction filters (date period / status / search)
  const [filters, setFilters] = useState<TransactionFilterValue>({ ...EMPTY_TRANSACTION_FILTER });

  useEffect(() => {
    apiGet('/grn?limit=500').then(r => { if (r.ok) setGrns(r.data); });
  }, []);

  const locName = (id: string) => locations.find((l:any) => l.id === id)?.name || id || '';

  // Apply shared filters. GRNs have no category/department, so we filter on
  // date (receipt/created), status (posted/draft) and free-text search.
  const filteredGrns = filterRows(grns, filters, {
    date: (g:any) => g.receipt_date || g.inserted_at,
    status: (g:any) => g.status,
    search: (g:any) => [g.grn_number, g.supplier_name, g.supplier_invoice_number, locName(g.destination_location_id)],
  });
  const grnsPg = usePagination<any>(filteredGrns);

  const printGrns = () => printTransactionList({
    title: 'Goods Received Notes',
    filters,
    columns: [
      { header: 'GRN #', value: (g:any) => g.grn_number || '' },
      { header: 'Supplier', value: (g:any) => g.supplier_name || '' },
      { header: 'Invoice #', value: (g:any) => g.supplier_invoice_number || '—' },
      { header: 'Destination', value: (g:any) => locName(g.destination_location_id) },
      { header: 'Total', value: (g:any) => fmt(g.total_value), align: 'right' },
      { header: 'Status', value: (g:any) => g.status || '' },
      { header: 'Date', value: (g:any) => { const d = g.receipt_date || g.inserted_at; return d ? new Date(d).toLocaleDateString() : ''; } },
    ],
    rows: filteredGrns,
    footer: [
      { label: 'GRNs', value: filteredGrns.length },
      { label: 'Total Value', value: fmt(filteredGrns.reduce((s:number, g:any) => s + Number(g.total_value || 0), 0)) },
    ],
  });

  // Auto-initialize destLocation to first ACTIVE storage location from the API.
  // Prevents the React controlled-select mismatch where hardcoded 'loc_main_cellar'
  // may be is_active=false — browser shows first option visually but state
  // stays wrong → GRN posts to the wrong (inactive) location.
  const storageLocations = locations.filter((l:any) => l.location_type === 'Storage');
  useEffect(() => {
    if (!destLocation && storageLocations.length > 0) {
      setDestLocation(storageLocations[0].id);
    }
  }, [storageLocations.length]);

  const addLine = () => setLines(l => [...l, { item_id:'', item_name:'', qty:1, uom:'uom_unit', unit_cost:0, vat_type:'15.50', expiry_date:'' }]);
  const removeLine = (i: number) => setLines(l => l.filter((_,idx) => idx !== i));
  const updateLine = (i: number, field: string, val: any) => setLines(l => l.map((ln,idx) => idx===i ? {...ln,[field]:val} : ln));

  const selectItem = (lineIdx: number, item: any) => {
    updateLine(lineIdx, 'item_id', item.id);
    updateLine(lineIdx, 'item_name', item.name);
    updateLine(lineIdx, 'uom', item.base_uom_id || 'uom_unit');
    updateLine(lineIdx, 'unit_cost', Number(item.last_cost_price || item.weighted_avg_cost || 0));
    // Remove itemSearch entry so badge shows; close floating dropdown immediately
    setItemSearch(s => { const next = { ...s }; delete next[lineIdx]; return next; });
    setDropdownAnchor(null);
  };

  const openDetailGrn = async (g: any) => {
    setDetailGrn(g);
    setLoadingDetail(true);
    try {
      const r = await fetch(`/api/v1/inventory/grn/${g.id}`).then(x => x.json());
      setDetailLines(r.ok ? (r.data?.lines || []) : []);
    } catch { setDetailLines([]); }
    setLoadingDetail(false);
  };

  const deleteGrn = async (id: string) => {
    if (!window.confirm('Delete this GRN? This cannot be undone.')) return;
    setDeletingId(id);
    try {
      const r = await fetch(`/api/v1/inventory/grn/${id}`, { method: 'DELETE' }).then(x => x.json());
      if (r.ok) {
        toast({ title: 'GRN deleted' });
        setGrns(prev => prev.filter(g => g.id !== id));
        if (detailGrn?.id === id) setDetailGrn(null);
      } else {
        toast({ title: 'Delete failed', description: r.error, variant: 'destructive' });
      }
    } catch (e: any) {
      toast({ title: 'Delete failed', description: e.message, variant: 'destructive' });
    }
    setDeletingId(null);
  };

  // Post a draft GRN: commits it to the stock ledger (draft → posted). This is
  // the same server action used when a GRN is created+posted in one step, so the
  // stock receipt and weighted-average cost update happen exactly once. Posted
  // GRNs become read-only (no further edit).
  const postGrn = async (g: any) => {
    if (g.status === 'posted') return;
    if (!window.confirm(`Post ${g.grn_number}? This commits the stock receipt and locks the GRN.`)) return;
    setPostingId(g.id);
    try {
      const r = await apiPost(`/grn/${g.id}/post`, { posted_by: user?.id || 'system' });
      if (r.ok) {
        toast({ title: `GRN ${g.grn_number} posted`, description: 'Stock receipt committed to the ledger.' });
        const res = await apiGet('/grn?limit=500');
        if (res.ok) setGrns(res.data);
        if (detailGrn?.id === g.id) setDetailGrn(prev => prev ? { ...prev, status: 'posted' } : prev);
      } else {
        toast({ title: 'Post failed', description: r.error, variant: 'destructive' });
      }
    } catch (e: any) {
      toast({ title: 'Post failed', description: e.message, variant: 'destructive' });
    }
    setPostingId(null);
  };

  // Edit a saved GRN: load its lines and pre-populate the form.
  // Posted GRNs are read-only — edits would require reversing the stock ledger
  // which we don't expose here. Draft GRNs can be edited & re-saved.
  const editGrn = async (g: any) => {
    if (g.status === 'posted') {
      toast({ title: 'Cannot edit a posted GRN', description: 'Posted GRNs are locked. Delete and recreate if needed.', variant: 'destructive' });
      return;
    }
    try {
      const r = await fetch(`/api/v1/inventory/grn/${g.id}`).then(x => x.json());
      if (!r.ok) throw new Error(r.error || 'Failed to load GRN');
      const loadedLines = (r.data?.lines || []).map((l: any) => ({
        item_id:     l.item_id,
        item_name:   l.item_name || items.find((i:any) => i.id === l.item_id)?.name || '',
        qty:         Number(l.qty_received || 0),
        uom:         l.received_uom_id || l.uom_id || 'uom_unit',
        unit_cost:   Number(l.unit_cost || 0),
        vat_type:    String(Number(l.vat_rate || 0)) === '0' ? '0' : String(l.vat_rate ?? '15.50'),
        expiry_date: l.expiry_date ? String(l.expiry_date).slice(0, 10) : '',
      }));
      setSupplier(g.supplier_name || '');
      setSupplierId(g.supplier_id || '');
      setInvoiceNum(g.supplier_invoice_number || '');
      setDestLocation(g.destination_location_id || destLocation);
      setGrnDate(g.receipt_date ? String(g.receipt_date).slice(0, 10) : new Date().toISOString().slice(0, 10));
      setGrnNotes(g.notes || '');
      setLines(loadedLines.length ? loadedLines : [{ item_id:'', item_name:'', qty:1, uom:'uom_unit', unit_cost:0, vat_type:'15.50', expiry_date:'' }]);
      setEditingGrnId(g.id);
      setShowForm(true);
      setDetailGrn(null);
    } catch (e: any) {
      toast({ title: 'Edit failed', description: e.message, variant: 'destructive' });
    }
  };

  // Print a GRN: fetch its lines, render an A4 receipt and pop a print window.
  const printGrn = async (g: any) => {
    try {
      const r = await fetch(`/api/v1/inventory/grn/${g.id}`).then(x => x.json());
      const ls = r.ok ? (r.data?.lines || []) : [];
      const fmt2 = (n: any) => Number(n || 0).toFixed(2);
      let sub = 0, vat = 0;
      const rows = ls.map((l: any) => {
        const qty = Number(l.qty_received || 0);
        const cost = Number(l.unit_cost || 0);
        const lt = qty * cost;
        const rate = Number(l.vat_rate || 0);
        const rv = lt * (rate / 100);
        sub += lt; vat += rv;
        const name = l.item_name || items.find((i:any) => i.id === l.item_id)?.name || l.item_id;
        return `<tr><td>${name}</td><td class="r">${qty}</td><td class="r">${fmt2(cost)}</td><td class="r">${rate ? rate.toFixed(2) + '%' : '—'}</td><td class="r">${fmt2(rv)}</td><td class="r">${fmt2(lt)}</td></tr>`;
      }).join('');
      const grand = sub + vat;
      const locName = locations.find((l:any) => l.id === g.destination_location_id)?.name || g.destination_location_id;
      const html = `<!doctype html><html><head><meta charset="utf-8"/><title>GRN ${g.grn_number}</title>
        <style>
          body { font-family: system-ui, -apple-system, sans-serif; padding: 24px; color: #111; max-width: 760px; margin: auto; }
          h1 { font-size: 20px; margin: 0 0 4px; }
          .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 20px; margin: 14px 0 20px; font-size: 13px; }
          .meta div b { display: inline-block; min-width: 110px; color: #555; font-weight: 600; }
          table { width: 100%; border-collapse: collapse; font-size: 12px; }
          th, td { padding: 6px 8px; border-bottom: 1px solid #e5e5e5; text-align: left; }
          th { background: #f5f5f5; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
          td.r, th.r { text-align: right; }
          .totals { margin-top: 16px; display: flex; justify-content: flex-end; }
          .totals table { width: 280px; }
          .totals td { border: none; padding: 3px 8px; font-size: 13px; }
          .totals .grand { border-top: 1px solid #111; font-weight: 700; font-size: 15px; padding-top: 8px; }
          .footer { margin-top: 32px; font-size: 11px; color: #888; border-top: 1px solid #eee; padding-top: 8px; }
        </style></head><body>
        <h1>Goods Received Note — ${g.grn_number}</h1>
        <div class="meta">
          <div><b>Supplier:</b> ${g.supplier_name || '—'}</div>
          <div><b>Invoice #:</b> ${g.supplier_invoice_number || '—'}</div>
          <div><b>Destination:</b> ${locName}</div>
          <div><b>Receipt Date:</b> ${g.receipt_date ? new Date(g.receipt_date).toLocaleDateString() : '—'}</div>
          <div><b>Status:</b> ${g.status}</div>
          <div><b>Created:</b> ${new Date(g.inserted_at).toLocaleString()}</div>
          ${g.notes ? `<div style="grid-column: 1 / -1"><b>Notes:</b> ${g.notes}</div>` : ''}
        </div>
        <table>
          <thead><tr>
            <th>Item</th><th class="r">Qty</th><th class="r">Unit Cost</th>
            <th class="r">VAT Rate</th><th class="r">Row VAT</th><th class="r">Line Total</th>
          </tr></thead>
          <tbody>${rows || '<tr><td colspan="6" style="text-align:center;color:#888;padding:12px">No lines</td></tr>'}</tbody>
        </table>
        <div class="totals"><table>
          <tr><td>Sub Total</td><td class="r">${fmt2(sub)}</td></tr>
          <tr><td>VAT</td><td class="r">${fmt2(vat)}</td></tr>
          <tr class="grand"><td>GRN Total</td><td class="r">${fmt2(grand)}</td></tr>
        </table></div>
        <div class="footer">Printed ${new Date().toLocaleString()} · Powered by COREPMS</div>
        <script>window.onload = () => { setTimeout(() => window.print(), 250); };</script>
        </body></html>`;
      const w = window.open('about:blank', '_blank');
      if (!w) { toast({ title: 'Pop-up blocked', description: 'Allow pop-ups to print GRNs.', variant: 'destructive' }); return; }
      w.document.open(); w.document.write(html); w.document.close();
    } catch (e: any) {
      toast({ title: 'Print failed', description: e.message, variant: 'destructive' });
    }
  };

  // Per-line subtotal (qty * unit cost) and VAT (subtotal * rate%).
  // Sub Total is sum of subtotals; VAT total is sum of per-row VAT; GRN Total = Sub + VAT.
  const lineSubtotal = (l: any) => Number(l.qty || 0) * Number(l.unit_cost || 0);
  const lineVat      = (l: any) => lineSubtotal(l) * (Number(l.vat_type || 0) / 100);
  const total        = lines.reduce((s, l) => s + lineSubtotal(l), 0);
  const totalVat     = lines.reduce((s, l) => s + lineVat(l), 0);
  const grnGrand     = total + totalVat;

  const submit = async () => {
    if (!supplier) { toast({ title: 'Supplier required', variant:'destructive' }); return; }
    if (!lines.some(l => l.item_id)) { toast({ title: 'At least one item required', variant:'destructive' }); return; }
    setSaving(true);
    // FIX: was referencing StockTransfer variables (srcLoc, dstLoc, reqRef, transferDate,
    // notes, tLines) — all undefined in GRNModule scope → ReferenceError: notes is not defined.
    // Corrected to use GRN-specific state variables.
    const payload = {
      supplier_name: supplier,
      supplier_id: supplierId || undefined,
      supplier_invoice_number: invoiceNum || undefined,
      destination_location_id: destLocation,
      receipt_date: grnDate || undefined,
      notes: grnNotes || undefined,
      created_by: user?.id || 'system',
      lines: lines.filter(l => l.item_id).map(l => {
        const sub = Number(l.qty || 0) * Number(l.unit_cost || 0);
        const rate = Number(l.vat_type || 0);
        const rowVat = Number((sub * (rate / 100)).toFixed(2));
        return {
          item_id:         l.item_id,
          qty_received:    Number(l.qty),
          received_uom_id: l.uom,
          unit_cost:       Number(l.unit_cost),
          vat_rate:        rate,
          row_vat:         rowVat,
          line_total:      sub,
          expiry_date:     l.expiry_date || undefined,
        };
      }),
      totals: { sub_total: total, vat_total: totalVat, grn_total: grnGrand },
    };
    // When editing an existing draft, PUT to the resource instead of creating a new one.
    const r = editingGrnId
      ? await fetch(`/api/v1/inventory/grn/${editingGrnId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }).then(x => x.json()).catch(e => ({ ok: false, error: e?.message }))
      : await apiPost('/grn', payload);

    if (r.ok) {
      if (!editingGrnId) {
        // Auto-post only on initial creation; edits stay as draft until the user re-posts.
        await apiPost(`/grn/${r.data.id}/post`, { posted_by: user?.id || 'system' });
      }
      toast({ title: editingGrnId ? `GRN updated` : `GRN ${r.data.grn_number} posted successfully` });
      setEditingGrnId(null);
      setShowForm(false); setFullScreen(false);
      setLines([{ item_id:'', item_name:'', qty:1, uom:'uom_unit', unit_cost:0, expiry_date:'' }]);
      setSupplier(''); setSupplierId(''); setInvoiceNum('');
      setGrnDate(new Date().toISOString().split('T')[0]); setGrnNotes('');
      apiGet('/grn?limit=500').then(res => { if (res.ok) setGrns(res.data); });
    } else {
      toast({ title: 'GRN failed', description: r.error, variant:'destructive' });
    }
    setSaving(false);
  };

  return (
    <div className="h-full flex flex-col">
      <div className="mb-4">
        <h3 className="text-base font-bold text-gray-700 mb-3">Goods Received Notes</h3>
        <TransactionFilterBar
          value={filters}
          onChange={setFilters}
          show={{ category: false, department: false }}
          statuses={[{ value: 'posted', label: 'Posted' }, { value: 'draft', label: 'Draft' }]}
          searchPlaceholder="Search GRN #, supplier, invoice…"
          resultCount={filteredGrns.length}
          onPrint={printGrns}
          rightActions={
            <Button
              onClick={() => {
                // Reset to a clean slate when opening as "New GRN"
                setEditingGrnId(null);
                setSupplier(''); setSupplierId(''); setInvoiceNum('');
                setGrnDate(new Date().toISOString().split('T')[0]); setGrnNotes('');
                setLines([{ item_id:'', item_name:'', qty:1, uom:'uom_unit', unit_cost:0, vat_type:'15.50', expiry_date:'' }]);
                setShowForm(true);
              }}
              className="bg-green-700 text-white hover:bg-green-800">＋ New GRN</Button>
          }
        />
      </div>

      {/* GRN history */}
      <div className="flex-1 overflow-auto rounded-lg border border-gray-200">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              {['GRN #','Supplier','Invoice #','Destination','Total','Status','Date','Actions'].map(h => (
                <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filteredGrns.length === 0 && <tr><td colSpan={8} className="text-center py-10 text-gray-400">{grns.length === 0 ? 'No GRNs yet' : 'No GRNs match the current filter'}</td></tr>}
            {grnsPg.pageItems.map((g:any) => (
              <tr key={g.id}
                className={`hover:bg-indigo-50 cursor-pointer transition-colors ${detailGrn?.id === g.id ? 'bg-indigo-50 ring-1 ring-inset ring-indigo-300' : ''}`}
                onClick={() => openDetailGrn(g)}>
                <td className="px-3 py-2 font-mono font-bold text-indigo-700">{g.grn_number}</td>
                <td className="px-3 py-2">{g.supplier_name}</td>
                <td className="px-3 py-2 text-gray-500">{g.supplier_invoice_number || '—'}</td>
                <td className="px-3 py-2">{locations.find((l:any) => l.id === g.destination_location_id)?.name || g.destination_location_id}</td>
                <td className="px-3 py-2 font-bold">{fmt(g.total_value)}</td>
                <td className="px-3 py-2">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${g.status==='posted'?'bg-green-100 text-green-700':'bg-yellow-100 text-yellow-700'}`}>
                    {g.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-gray-500 text-xs">{new Date(g.inserted_at).toLocaleDateString()}</td>
                <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center gap-1">
                    {g.status === 'draft' && (
                      <button
                        disabled={postingId === g.id}
                        onClick={() => postGrn(g)}
                        title="Post this draft GRN (commit stock receipt)"
                        className="text-xs text-white bg-green-600 hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed px-2 py-1 rounded transition-colors">
                        {postingId === g.id ? 'Posting…' : 'Post'}
                      </button>
                    )}
                    <button
                      onClick={() => editGrn(g)}
                      title={g.status === 'posted' ? 'Posted GRNs are locked' : 'Edit this GRN'}
                      disabled={g.status === 'posted'}
                      className="text-xs text-blue-600 hover:text-blue-800 disabled:opacity-40 disabled:cursor-not-allowed px-2 py-1 rounded border border-blue-200 hover:bg-blue-50 transition-colors">
                      Edit
                    </button>
                    <button
                      onClick={() => printGrn(g)}
                      title="Print GRN receipt"
                      className="text-xs text-gray-700 hover:text-gray-900 px-2 py-1 rounded border border-gray-200 hover:bg-gray-50 transition-colors">
                      Print
                    </button>
                    <button
                      disabled={deletingId === g.id}
                      onClick={() => deleteGrn(g.id)}
                      title="Delete GRN"
                      className="text-xs text-red-500 hover:text-red-700 disabled:opacity-40 px-2 py-1 rounded border border-red-200 hover:bg-red-50 transition-colors">
                      {deletingId === g.id ? '…' : 'Delete'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <PaginationBar {...grnsPg} itemLabel="GRNs" />

      {/* GRN Detail Panel */}
      {detailGrn && (
        <div className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50 p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <span className="font-mono font-bold text-indigo-700 text-base">{detailGrn.grn_number}</span>
              <span className="ml-3 text-sm text-gray-600">— {detailGrn.supplier_name}</span>
              {detailGrn.supplier_invoice_number && <span className="ml-2 text-xs text-gray-400">INV# {detailGrn.supplier_invoice_number}</span>}
            </div>
            <div className="flex items-center gap-2">
              {detailGrn.status === 'draft' && (
                <button
                  disabled={postingId === detailGrn.id}
                  onClick={() => postGrn(detailGrn)}
                  className="text-xs text-white bg-green-600 hover:bg-green-700 disabled:opacity-40 px-3 py-1 rounded transition-colors">
                  {postingId === detailGrn.id ? 'Posting…' : 'Post GRN'}
                </button>
              )}
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${detailGrn.status==='posted'?'bg-green-100 text-green-700':'bg-yellow-100 text-yellow-700'}`}>{detailGrn.status}</span>
              <button onClick={() => setDetailGrn(null)} className="text-gray-400 hover:text-gray-700">✕</button>
            </div>
          </div>
          {loadingDetail
            ? <p className="text-sm text-gray-400 py-4 text-center">Loading lines…</p>
            : detailLines.length === 0
              ? <p className="text-sm text-gray-400 py-2 text-center">No line items recorded</p>
              : (
                <table className="min-w-full text-xs bg-white rounded-lg overflow-hidden">
                  <thead className="bg-gray-100">
                    <tr>{['Item','Qty','UOM','Unit Cost','Total'].map(h=><th key={h} className="px-3 py-1.5 text-left font-semibold text-gray-600">{h}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {detailLines.map((l:any, i:number) => (
                      <tr key={i} className="hover:bg-gray-50">
                        <td className="px-3 py-1.5 font-medium">{l.item_name || items.find((it:any)=>it.id===l.item_id)?.name || l.item_id}</td>
                        <td className="px-3 py-1.5">{fmtQ(l.qty_received)}</td>
                        <td className="px-3 py-1.5">{uoms.find((u:any)=>u.id===l.uom_id || u.id===l.received_uom_id)?.name || l.uom_id}</td>
                        <td className="px-3 py-1.5">{fmt(l.unit_cost)}</td>
                        <td className="px-3 py-1.5 font-bold">{fmt(Number(l.qty_received||0)*Number(l.unit_cost||0))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
          }
          <div className="mt-2 flex justify-end">
            <span className="text-sm font-bold text-indigo-700">Total: {fmt(detailGrn.total_value)}</span>
          </div>
        </div>
      )}

      {/* GRN Form Modal — supports windowed and full-screen modes */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 backdrop-blur-sm overflow-y-auto pt-4 pb-4">
          <div className={`bg-white shadow-2xl p-6 transition-all duration-200 ${fullScreen ? 'fixed inset-0 rounded-none overflow-y-auto z-50' : 'rounded-xl w-full max-w-6xl mx-4'}`}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-bold">New Goods Received Note</h3>
              <div className="flex items-center gap-2">
                {/* Full-screen toggle */}
                <button
                  title={fullScreen ? 'Windowed view' : 'Full-screen view'}
                  onClick={() => setFullScreen(f => !f)}
                  className="text-gray-400 hover:text-indigo-600 text-base px-2 py-1 rounded hover:bg-indigo-50 transition-colors border border-gray-200">
                  {fullScreen ? '⊡ Windowed' : '⛶ Full Screen'}
                </button>
                <button onClick={() => { setShowForm(false); setFullScreen(false); }} className="text-gray-400 hover:text-gray-700 text-xl">✕</button>
              </div>
            </div>

            {/* Header */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <div className="col-span-2">
                <label className="block text-xs font-semibold text-gray-600 mb-1">Supplier *</label>
                <select className="w-full border rounded-md px-3 py-2 text-sm"
                  value={supplierId}
                  onChange={e => {
                    setSupplierId(e.target.value);
                    const v = vendors.find((v:any) => v.id === e.target.value);
                    if (v) setSupplier(v.name);
                  }}>
                  <option value="">— Select supplier —</option>
                  {vendors.map((v:any) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
                {!supplierId && (
                  <Input className="mt-1" placeholder="Or type supplier name…" value={supplier}
                    onChange={e => setSupplier(e.target.value)} />
                )}
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Supplier Invoice #</label>
                <Input value={invoiceNum} onChange={e => setInvoiceNum(e.target.value)} placeholder="INV-0001" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Destination Store</label>
                <select className="w-full border rounded-md px-3 py-2 text-sm" value={destLocation} onChange={e => setDestLocation(e.target.value)}>
                  {storageLocations.map((l:any) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </div>
            </div>

            {/* GRN date + notes row — both fields are part of the GRN payload */}
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Receipt / Delivery Date</label>
                <Input type="date" value={grnDate} onChange={e => setGrnDate(e.target.value)} className="text-sm" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Notes</label>
                <Input value={grnNotes} onChange={e => setGrnNotes(e.target.value)} placeholder="Delivery notes, batch info…" />
              </div>
            </div>

             {/* Lines */}
            <div className="overflow-x-auto rounded-lg border border-gray-200 mb-4">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    {['Item (SKU or name)','Qty','UOM','Unit Cost','VAT Tax Option','Row VAT ($)','Line Total','Expiry Date',''].map(h => (
                      <th key={h} className="px-2 py-2 text-left text-xs font-semibold text-gray-600">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, i) => {
                    const isTyping  = Object.prototype.hasOwnProperty.call(itemSearch, i);
                    const searchVal = isTyping ? (itemSearch[i] ?? '') : (line.item_name || '');
                    const suggestions = isTyping && searchVal.length >= 2
                      ? items.filter((it:any) => {
                          const q = searchVal.toLowerCase();
                          return (
                            it.name.toLowerCase().includes(q) ||
                            (it.sku||'').toLowerCase().includes(q) ||
                            String(it.id||'').toLowerCase().slice(-4).startsWith(q)
                          );
                        }).slice(0, 12)
                      : [];
                    const isThisDropdownOpen = dropdownAnchor?.lineIdx === i && suggestions.length > 0;
                    return (
                      <tr key={i} className="border-t border-gray-100">
                        <td className="px-2 py-1 relative min-w-[240px]">
                          {line.item_id && !isTyping && (
                            <div className="flex items-center gap-1">
                              <span className="text-[10px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded font-mono">
                                #{String(line.item_id).slice(-4).toUpperCase()}
                              </span>
                              <span className="text-xs font-medium text-gray-700 truncate max-w-[160px]">{line.item_name}</span>
                              <button onClick={() => { updateLine(i,'item_id',''); updateLine(i,'item_name',''); setItemSearch(s=>({...s,[i]:''})); setDropdownAnchor(null); }}
                                className="ml-auto text-gray-300 hover:text-red-400 text-xs">✕</button>
                            </div>
                          )}
                          <Input
                            ref={(el) => { inputRefs.current[i] = el; }}
                            value={isTyping ? searchVal : ''}
                            placeholder={line.item_id ? 'Click ✕ to change…' : 'Search by name, SKU or last 4 of ID…'}
                            onFocus={e => {
                              if (!line.item_id) {
                                setItemSearch(s => ({ ...s, [i]: '' }));
                                setDropdownAnchor({ lineIdx: i, rect: e.currentTarget.getBoundingClientRect() });
                              }
                            }}
                            onChange={e => {
                              setItemSearch(s => ({ ...s, [i]: e.target.value }));
                              if (!e.target.value) { updateLine(i,'item_id',''); updateLine(i,'item_name',''); }
                              const el = inputRefs.current[i];
                              if (el) setDropdownAnchor({ lineIdx: i, rect: el.getBoundingClientRect() });
                            }}
                            onBlur={() => {
                              setTimeout(() => {
                                setItemSearch(s => { const n={...s}; delete n[i]; return n; });
                                setDropdownAnchor(null);
                              }, 180);
                            }}
                            className={`text-sm ${line.item_id ? 'opacity-0 h-0 p-0 border-0 absolute pointer-events-none' : ''}`}
                          />
                          {/* Floating window overlay — rendered via fixed position */}
                          {isThisDropdownOpen && dropdownAnchor && (
                            <div
                              style={{
                                position: 'fixed',
                                top: dropdownAnchor.rect.bottom + 4,
                                left: dropdownAnchor.rect.left,
                                width: Math.max(dropdownAnchor.rect.width, 320),
                                zIndex: 9999,
                              }}
                              className="bg-white border border-indigo-200 rounded-xl shadow-2xl overflow-hidden">
                              <div className="px-3 py-1.5 bg-indigo-50 border-b border-indigo-100 flex items-center justify-between">
                                <span className="text-[10px] font-semibold text-indigo-600 uppercase tracking-wide">Select Item</span>
                                <span className="text-[10px] text-gray-400">{suggestions.length} match{suggestions.length !== 1 ? 'es' : ''}</span>
                              </div>
                              <div className="max-h-56 overflow-y-auto">
                                {suggestions.map((it:any) => (
                                  <div key={it.id}
                                    onMouseDown={e => { e.preventDefault(); selectItem(i, it); }}
                                    className="px-3 py-2.5 hover:bg-indigo-50 cursor-pointer border-b border-gray-50 last:border-0 transition-colors">
                                    <div className="flex items-center gap-2">
                                      <span className="font-mono text-[10px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">
                                        #{String(it.id).slice(-4).toUpperCase()}
                                      </span>
                                      {it.sku && <span className="text-[10px] text-gray-400 font-mono">{it.sku}</span>}
                                      <span className={`ml-auto text-[9px] px-1.5 py-0.5 rounded-full font-medium ${it.category==='Beverage'?'bg-blue-100 text-blue-600':it.category==='Food'?'bg-green-100 text-green-600':'bg-gray-100 text-gray-500'}`}>{it.category}</span>
                                    </div>
                                    <div className="text-xs font-semibold text-gray-800 mt-0.5">{it.name}</div>
                                    <div className="text-[10px] text-gray-400">{fmt(it.last_cost_price || 0)}/unit · {uoms.find((u:any)=>u.id===it.base_uom_id)?.name || it.base_uom_id}</div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {isTyping && searchVal.length >= 2 && suggestions.length === 0 && !line.item_id && (
                            <p className="text-xs text-red-500 mt-0.5">No items found — create it in Items tab first</p>
                          )}
                         </td>
                         <td className="px-2 py-1 w-24">
                           <Input type="number" min={0} step="0.001" value={line.qty}
                             onChange={e => updateLine(i, 'qty', e.target.value)} className="text-sm text-center" />
                         </td>
                        <td className="px-2 py-1 w-28">
                          <select className="border rounded-md px-2 py-1.5 text-sm w-full"
                            value={line.uom} onChange={e => updateLine(i, 'uom', e.target.value)}>
                            {uoms.map((u:any) => <option key={u.id} value={u.id}>{u.name}</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-1 w-28">
                          <Input type="number" min={0} step="0.0001" value={line.unit_cost}
                            onChange={e => updateLine(i, 'unit_cost', e.target.value)} className="text-sm text-right" />
                        </td>
                        {/* VAT Tax Option dropdown */}
                        <td className="px-2 py-1 w-32">
                          <select
                            value={line.vat_type || '15.50'}
                            onChange={e => updateLine(i, 'vat_type', e.target.value)}
                            className="w-full h-9 px-2 text-xs border border-gray-300 rounded-md bg-white
                                       focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500">
                            <option value="15.50">15.50%</option>
                            <option value="0">No VAT</option>
                          </select>
                        </td>
                        {/* Computed Row VAT — read-only */}
                        <td className="px-2 py-1 w-24">
                          <input
                            readOnly
                            tabIndex={-1}
                            value={'$' + fmt(lineVat(line))}
                            className="w-full h-9 px-2 text-xs text-right border border-gray-200 rounded-md bg-gray-100 text-gray-700 cursor-not-allowed"
                          />
                        </td>
                        <td className="px-2 py-1 w-24 text-right font-medium">
                          {fmt(lineSubtotal(line))}
                        </td>
                        <td className="px-2 py-1 w-32">
                          <Input type="date" value={line.expiry_date||''}
                            onChange={e => updateLine(i, 'expiry_date', e.target.value)} className="text-sm" />
                        </td>
                        <td className="px-2 py-1">
                          <button onClick={() => removeLine(i)} className="text-red-400 hover:text-red-600 text-lg">×</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

              <div className="flex items-start justify-between mt-4 gap-4">
                <Button variant="outline" onClick={addLine}>＋ Add Line</Button>
                <div className="border rounded-lg bg-gray-50/50 px-4 py-3 w-72 space-y-1.5">
                  <div className="flex justify-between text-sm text-gray-700">
                    <span>Sub Total:</span>
                    <span className="font-mono">{fmt(total)}</span>
                  </div>
                  <div className="flex justify-between text-sm text-gray-700">
                    <span>VAT:</span>
                    <span className="font-mono">{fmt(totalVat)}</span>
                  </div>
                  <div className="flex justify-between pt-2 border-t border-gray-300 font-semibold">
                    <span>GRN Total:</span>
                    <span className="font-mono text-base text-indigo-700">{fmt(grnGrand)}</span>
                  </div>
                </div>
              </div>

              <div className="flex gap-3 mt-5 justify-end">
                <Button variant="outline" onClick={() => { setShowForm(false); setFullScreen(false); }}>Cancel</Button>
                <Button onClick={submit} disabled={saving} className="bg-green-700 text-white hover:bg-green-800">
                  {saving ? 'Posting…' : 'Post GRN'}
                </Button>
              </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 3 — STOCK TRANSFER
// ─────────────────────────────────────────────────────────────────────────────
function StockTransfer({ data }: { data: ReturnType<typeof useInventoryData> }) {
  const { items, locations, uoms } = data;
  const { user } = useAuth();
  const { toast } = useToast();
  const [transfers, setTransfers] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  // FIX: initialize dynamically — hardcoded IDs may be inactive on some properties
  const [srcLoc, setSrcLoc] = useState('');
  const [dstLoc, setDstLoc] = useState('');
  const [reqRef, setReqRef] = useState('');
  const [tLines, setTLines] = useState<any[]>([{ item_id:'', item_name:'', qty:1, uom:'uom_unit', date:'' }]);
  const [saving, setSaving] = useState(false);
  const [balances, setBalances] = useState<any[]>([]);
  const [itemSearch, setItemSearch] = useState<Record<number,string>>({});
  const [filters, setFilters] = useState<TransactionFilterValue>({ ...EMPTY_TRANSACTION_FILTER });
  const [fullScreen, setFullScreen] = useState(false);
  const [transferDate, setTransferDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);

  useEffect(() => {
    apiGet('/transfer?limit=500').then(r => { if (r.ok) setTransfers(r.data); });
  }, []);

  // Auto-initialize src/dst to first active storage/outlet locations from the API
  const allStorageLocs  = locations.filter((l:any) => l.location_type === 'Storage');
  const allOutletLocs   = locations.filter((l:any) => l.location_type === 'Outlet');
  useEffect(() => {
    if (!srcLoc && allStorageLocs.length > 0) setSrcLoc(allStorageLocs[0].id);
  }, [allStorageLocs.length]);
  useEffect(() => {
    if (!dstLoc && allOutletLocs.length > 0) setDstLoc(allOutletLocs[0].id);
  }, [allOutletLocs.length]);

  useEffect(() => {
    if (srcLoc) apiGet(`/balance/${srcLoc}`).then(r => { if (r.ok) setBalances(r.data || []); });
  }, [srcLoc]);

  const locName = (id: string) => locations.find((l:any) => l.id === id)?.name || id || '';

  // Shared transaction filters (date period / status / search). No category/department for transfers.
  const filteredTransfers = filterRows(transfers, filters, {
    date: (t:any) => t.inserted_at,
    status: (t:any) => t.status,
    search: (t:any) => [t.transfer_number, t.reference_note, locName(t.source_location_id), locName(t.destination_location_id)],
  });
  const transfersPg = usePagination<any>(filteredTransfers);

  const printTransfers = () => printTransactionList({
    title: 'Stock Transfers / Requisitions',
    filters,
    columns: [
      { header: 'Transfer #', value: (t:any) => t.transfer_number || '' },
      { header: 'From', value: (t:any) => locName(t.source_location_id) },
      { header: 'To', value: (t:any) => locName(t.destination_location_id) },
      { header: 'Ref', value: (t:any) => t.reference_note || '—' },
      { header: 'Status', value: (t:any) => t.status || '' },
      { header: 'Date', value: (t:any) => { const d = new Date(t.inserted_at); return isNaN(d.getTime()) ? '' : d.toLocaleDateString(); } },
    ],
    rows: filteredTransfers,
    footer: [{ label: 'Transfers', value: filteredTransfers.length }],
  });

  const addTLine = () => setTLines(l => [...l, { item_id:'', item_name:'', qty:1, uom:'uom_unit', date:'' }]);
  const removeTLine = (i: number) => setTLines(l => l.filter((_,idx) => idx !== i));
  const updateTLine = (i: number, field: string, val: any) => setTLines(l => l.map((ln,idx) => idx===i ? {...ln,[field]:val} : ln));

  // Transfer item selection — matches GRN pattern:
  // delete key from itemSearch (not set to '') so badge shows after selection
  const [transferDropdownAnchor, setTransferDropdownAnchor] = useState<{ lineIdx: number; rect: DOMRect } | null>(null);
  const transferInputRefs = useRef<Record<number, HTMLInputElement | null>>({});

  const selectTransferItem = (lineIdx: number, item: any) => {
    const bal = balances.find((b:any) => b.item_id === item.id);
    updateTLine(lineIdx, 'item_id', item.id);
    updateTLine(lineIdx, 'item_name', item.name);
    updateTLine(lineIdx, 'uom', item.base_uom_id || 'uom_unit');
    updateTLine(lineIdx, 'balance', bal ? Number(bal.current_balance || 0) : 0);
    // FIX: delete the key (don't set to '') — same as GRN so badge shows correctly
    setItemSearch(s => { const n = {...s}; delete n[lineIdx]; return n; });
    setTransferDropdownAnchor(null);
  };

  const submit = async () => {
    if (!reqRef) { toast({ title: 'Requisition reference required', variant:'destructive' }); return; }
    if (!tLines.some(l => l.item_id)) { toast({ title: 'At least one item required', variant:'destructive' }); return; }
    setSaving(true);
      const r = await apiPost('/transfer', {
        source_location_id: srcLoc,
        destination_location_id: dstLoc,
        reference_note: reqRef,
        created_by: user?.id || 'system',
        lines: tLines.filter(l => l.item_id).map(l => ({
          item_id: l.item_id, qty_requested: Number(l.qty),
          source_uom_id: l.uom, breakdown_flag: false,
          date: l.date || undefined
        }))
      });
    if (r.ok) {
      // Auto-approve
      await apiPost(`/transfer/${r.data.id}/approve`, { approved_by: user?.id || 'system' });
      toast({ title: `Transfer posted — ${r.data.transfer_number}` });
      setShowForm(false);
      setTLines([{ item_id:'', item_name:'', qty:1, uom:'uom_unit', date:'' }]);
      setReqRef('');
      setTransferDate('');
      setNotes('');
      apiGet('/transfer?limit=500').then(res => { if (res.ok) setTransfers(res.data); });
    } else {
      toast({ title: 'Transfer failed', description: r.error, variant:'destructive' });
    }
    setSaving(false);
  };

  return (
    <div className="h-full flex flex-col">
      <div className="mb-4">
        <h3 className="text-base font-bold text-gray-700 mb-3">Stock Transfers</h3>
        <TransactionFilterBar
          value={filters}
          onChange={setFilters}
          show={{ category: false, department: false }}
          statuses={[{ value: 'approved', label: 'Approved' }, { value: 'pending', label: 'Pending' }, { value: 'draft', label: 'Draft' }, { value: 'reversed', label: 'Reversed' }]}
          searchPlaceholder="Search transfer #, ref, location…"
          resultCount={filteredTransfers.length}
          onPrint={printTransfers}
          rightActions={<Button onClick={() => setShowForm(true)} className="bg-amber-600 text-white hover:bg-amber-700">＋ New Transfer</Button>}
        />
      </div>

      <div className="flex-1 overflow-auto rounded-lg border border-gray-200">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              {['Transfer #','From','To','Ref','Status','Date'].map(h => (
                <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filteredTransfers.length === 0 && <tr><td colSpan={6} className="text-center py-10 text-gray-400">No transfers found</td></tr>}
            {transfersPg.pageItems.map((t:any) => (
              <tr key={t.id} className="hover:bg-amber-50 cursor-pointer" onClick={() => setDetailId(t.id)}
                  title="Click to view transfer details">
                <td className="px-3 py-2 font-mono font-bold text-amber-700">{t.transfer_number}</td>
                <td className="px-3 py-2">{locations.find((l:any) => l.id === t.source_location_id)?.name || t.source_location_id}</td>
                <td className="px-3 py-2">{locations.find((l:any) => l.id === t.destination_location_id)?.name || t.destination_location_id}</td>
                <td className="px-3 py-2 text-gray-500">{t.reference_note || '—'}</td>
                <td className="px-3 py-2">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${t.status==='approved'?'bg-green-100 text-green-700':t.status==='reversed'?'bg-red-100 text-red-700':'bg-yellow-100 text-yellow-700'}`}>
                    {t.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-gray-500 text-xs">{new Date(t.inserted_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <PaginationBar {...transfersPg} itemLabel="transfers" />

      {detailId && (
        <TransferDetailModal
          id={detailId}
          user={user}
          locName={locName}
          onClose={() => setDetailId(null)}
          onChanged={() => {
            apiGet('/transfer?limit=500').then(r => { if (r.ok) setTransfers(r.data); });
          }}
        />
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 backdrop-blur-sm overflow-y-auto pt-8 pb-8">
          <div className={`bg-white shadow-2xl p-6 transition-all duration-200 ${fullScreen ? 'fixed inset-0 rounded-none overflow-y-auto z-50' : 'rounded-xl w-full max-w-3xl mx-4'}`}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-bold">New Stock Transfer</h3>
              <div className="flex items-center gap-2">
                <button
                  title={fullScreen ? 'Windowed view' : 'Full-screen view'}
                  onClick={() => setFullScreen(f => !f)}
                  className="text-gray-400 hover:text-indigo-600 text-base px-2 py-1 rounded hover:bg-indigo-50 transition-colors border border-gray-200">
                  {fullScreen ? '⊡ Windowed' : '⛶ Full Screen'}
                </button>
                <button onClick={() => { setShowForm(false); setFullScreen(false); }} className="text-gray-400 hover:text-gray-700 text-xl">✕</button>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">From (Source)</label>
                <select className="w-full border rounded-md px-3 py-2 text-sm" value={srcLoc} onChange={e => setSrcLoc(e.target.value)}>
                  {locations.map((l:any) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">To (Destination / Cost Centre)</label>
                <select className="w-full border rounded-md px-3 py-2 text-sm" value={dstLoc} onChange={e => setDstLoc(e.target.value)}>
                  {locations.filter((l:any) => l.id !== srcLoc).map((l:any) => (
                    <option key={l.id} value={l.id}>{l.name} ({l.location_type})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Requisition Ref *</label>
                <Input value={reqRef} onChange={e => setReqRef(e.target.value)} placeholder="REQ-0001" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Transfer Date</label>
                <Input type="date" value={transferDate} onChange={e => setTransferDate(e.target.value)} className="text-sm" />
              </div>
            </div>
            <div className="mb-4">
              <label className="block text-xs font-semibold text-gray-600 mb-1">Notes / Reason</label>
              <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Reason for transfer, event name…" />
            </div>

            <div className="overflow-x-auto rounded-lg border border-gray-200 mb-4">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    {['Item (SKU or name)','On Hand','Qty to Transfer','UOM',''].map(h => (
                      <th key={h} className="px-2 py-2 text-left text-xs font-semibold text-gray-600">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tLines.map((line, i) => {
                    // GRN-aligned pattern: delete key on select so badge shows (not blank input)
                    const isTyping  = Object.prototype.hasOwnProperty.call(itemSearch, i);
                    const searchVal = isTyping ? (itemSearch[i] ?? '') : (line.item_name || '');
                    const suggestions = isTyping && searchVal.length >= 2
                      ? items.filter((it:any) => {
                          const q = searchVal.toLowerCase();
                          return (
                            it.name.toLowerCase().includes(q) ||
                            (it.sku||'').toLowerCase().includes(q) ||
                            String(it.id||'').slice(-4).toLowerCase().startsWith(q)
                          );
                        }).slice(0, 12)
                      : [];
                    const isThisOpen = transferDropdownAnchor?.lineIdx === i && suggestions.length > 0;
                    const onHand  = line.balance ?? 0;
                    const overQty = Number(line.qty) > onHand && onHand >= 0;
                    return (
                      <tr key={i} className="border-t border-gray-100">
                        <td className="px-2 py-1 relative min-w-[240px]">
                          {/* Badge when item selected */}
                          {line.item_id && !isTyping && (
                            <div className="flex items-center gap-1">
                              <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-mono font-semibold">
                                #{String(line.item_id).slice(-4).toUpperCase()}
                              </span>
                              <span className="text-xs font-medium text-gray-700 truncate max-w-[160px]">{line.item_name}</span>
                              <button onClick={() => { updateTLine(i,'item_id',''); updateTLine(i,'item_name',''); updateTLine(i,'balance',0); setItemSearch(s=>({...s,[i]:''})); setTransferDropdownAnchor(null); }}
                                className="ml-auto text-gray-300 hover:text-red-400 text-xs">✕</button>
                            </div>
                          )}
                          <Input
                            ref={(el) => { transferInputRefs.current[i] = el; }}
                            value={isTyping ? searchVal : ''}
                            placeholder={line.item_id ? 'Click ✕ to change…' : 'Search by name or last 4 of ID…'}
                            onFocus={e => {
                              if (!line.item_id) {
                                setItemSearch(s => ({...s,[i]:''}));
                                setTransferDropdownAnchor({ lineIdx: i, rect: e.currentTarget.getBoundingClientRect() });
                              }
                            }}
                            onChange={e => {
                              setItemSearch(s => ({...s,[i]:e.target.value}));
                              if (!e.target.value) { updateTLine(i,'item_id',''); updateTLine(i,'item_name',''); }
                              const el = transferInputRefs.current[i];
                              if (el) setTransferDropdownAnchor({ lineIdx: i, rect: el.getBoundingClientRect() });
                            }}
                            onBlur={() => { setTimeout(() => { setItemSearch(s=>{const n={...s};delete n[i];return n;}); setTransferDropdownAnchor(null); }, 180); }}
                            className={`text-sm ${line.item_id ? 'opacity-0 h-0 p-0 border-0 absolute pointer-events-none' : ''}`}
                          />
                          {/* Floating dropdown — fixed position, same as GRN */}
                          {isThisOpen && transferDropdownAnchor && (
                            <div style={{ position:'fixed', top:transferDropdownAnchor.rect.bottom+4, left:transferDropdownAnchor.rect.left, width:Math.max(transferDropdownAnchor.rect.width,320), zIndex:9999 }}
                              className="bg-white border border-amber-200 rounded-xl shadow-2xl overflow-hidden">
                              <div className="px-3 py-1.5 bg-amber-50 border-b border-amber-100 flex items-center justify-between">
                                <span className="text-[10px] font-semibold text-amber-700 uppercase tracking-wide">Select Item</span>
                                <span className="text-[10px] text-gray-400">{suggestions.length} match{suggestions.length!==1?'es':''}</span>
                              </div>
                              <div className="max-h-52 overflow-y-auto">
                                {suggestions.map((it:any) => {
                                  const bal = balances.find((b:any) => b.item_id === it.id);
                                  const avail = bal ? Number(bal.current_balance||0) : 0;
                                  return (
                                    <div key={it.id}
                                      onMouseDown={e => { e.preventDefault(); selectTransferItem(i, it); }}
                                      className="px-3 py-2.5 hover:bg-amber-50 cursor-pointer border-b border-gray-50 last:border-0">
                                      <div className="flex items-center gap-2">
                                        <span className="font-mono text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
                                          #{String(it.id).slice(-4).toUpperCase()}
                                        </span>
                                        {it.sku && <span className="text-[10px] text-gray-400 font-mono">{it.sku}</span>}
                                        <span className={`ml-auto text-[9px] px-1.5 py-0.5 rounded-full font-medium ${avail>0?'bg-green-100 text-green-600':'bg-gray-100 text-gray-400'}`}>
                                          {avail>0?`${avail.toFixed(1)} in stock`:'0 in stock'}
                                        </span>
                                      </div>
                                      <div className="text-xs font-semibold text-gray-800 mt-0.5">{it.name}</div>
                                      <div className="text-[10px] text-gray-400">{it.category} · {uoms.find((u:any)=>u.id===it.base_uom_id)?.name||it.base_uom_id}</div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-1 w-28 text-center">
                          <span className={`font-bold text-sm ${onHand <= 0 ? 'text-red-500' : 'text-green-700'}`}>
                            {fmtQ(onHand)}
                          </span>
                          {overQty && <p className="text-[10px] text-red-500 mt-0.5">Exceeds balance</p>}
                        </td>
                        <td className="px-2 py-1 w-24">
                          <Input type="number" min={0} step="0.001" value={line.qty}
                            onChange={e => updateTLine(i, 'qty', e.target.value)}
                            className={`text-sm text-center ${overQty ? 'border-red-400 ring-1 ring-red-300' : ''}`} />
                        </td>
                        <td className="px-2 py-1 w-24">
                          <select className="border rounded-md px-2 py-1.5 text-sm w-full" value={line.uom} onChange={e => updateTLine(i,'uom',e.target.value)}>
                            {uoms.map((u:any) => <option key={u.id} value={u.id}>{u.code}</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-1">
                          <button onClick={() => removeTLine(i)} className="text-red-400 hover:text-red-600 text-lg">×</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between mt-2">
              <Button variant="outline" onClick={addTLine}>＋ Add Item</Button>
              <div className="flex gap-3">
                <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
                <Button onClick={submit} disabled={saving} className="bg-amber-600 text-white hover:bg-amber-700">
                  {saving ? 'Posting…' : 'Post Transfer'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 4 — RECIPE BUILDER
// ─────────────────────────────────────────────────────────────────────────────
function RecipeBuilder({ data }: { data: ReturnType<typeof useInventoryData> }) {
  const { items, uoms } = data;
  const { toast } = useToast();
  const [menuSearch, setMenuSearch] = useState('');
  const [menuItems, setMenuItems] = useState<any[]>([]);
  const [selectedMenu, setSelectedMenu] = useState<any>(null);
  const [ingredients, setIngredients] = useState<any[]>([{ item_id:'', item_name:'', qty:1, uom:'uom_unit', wastage_pct:0, unit_cost:0 }]);
  const [saving, setSaving] = useState(false);
  const [itemSearch, setItemSearch] = useState<Record<number,string>>({});

  useEffect(() => {
    // Load POS menu items
    fetch('/api/db/query', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      // Load the ENTIRE active POS menu (no 300-cap) so every dish/cocktail is recipe-able
      body: JSON.stringify({ sql: `SELECT id, name, price, department FROM products WHERE active=true ORDER BY department, name LIMIT 5000` })
    }).then(r => r.json()).then(d => { if (d.ok) setMenuItems(d.rows); });
  }, []);

  const addIngredient = () => setIngredients(l => [...l, { item_id:'', item_name:'', qty:1, uom:'uom_unit', wastage_pct:0, unit_cost:0 }]);
  const removeIngredient = (i: number) => setIngredients(l => l.filter((_,idx) => idx !== i));
  const updateIngredient = (i: number, field: string, val: any) =>
    setIngredients(l => l.map((ln,idx) => idx===i ? {...ln,[field]:val} : ln));

  const selectIngredientItem = (lineIdx: number, item: any) => {
    updateIngredient(lineIdx, 'item_id', item.id);
    updateIngredient(lineIdx, 'item_name', item.name);
    updateIngredient(lineIdx, 'uom', item.base_uom_id || 'uom_unit');
    updateIngredient(lineIdx, 'unit_cost', Number(item.weighted_avg_cost || item.last_cost_price || 0));
    setItemSearch(s => ({ ...s, [lineIdx]: '' }));
  };

  const theoreticalCost = ingredients.reduce((s, l) => {
    const waste = 1 + (Number(l.wastage_pct || 0) / 100);
    return s + Number(l.qty||0) * Number(l.unit_cost||0) * waste;
  }, 0);

  const save = async () => {
    if (!selectedMenu) { toast({ title: 'Select a menu item', variant:'destructive' }); return; }
    if (!ingredients.some(l => l.item_id)) { toast({ title: 'Add at least one ingredient', variant:'destructive' }); return; }
    setSaving(true);
    const r = await apiPost('/recipe', {
      menu_item_id: selectedMenu.id,
      menu_item_name: selectedMenu.name,
      created_by: 'system',
      ingredients: ingredients.filter(l => l.item_id).map(l => ({
        item_id: l.item_id, qty: Number(l.qty),
        uom_id: l.uom, wastage_pct: Number(l.wastage_pct||0)
      }))
    });
    setSaving(false);
    if (r.ok) toast({ title: `Recipe saved for ${selectedMenu.name}` });
    else toast({ title: 'Error', description: r.error, variant:'destructive' });
  };

  const menuFiltered = menuSearch.length >= 2
    ? menuItems.filter(m => m.name.toLowerCase().includes(menuSearch.toLowerCase())).slice(0,8)
    : [];

  return (
    <div className="max-w-4xl">
      <h3 className="text-base font-bold text-gray-700 mb-4">Recipe Builder</h3>

      {/* Menu item selection */}
      <div className="mb-5 p-4 border rounded-lg bg-gray-50">
        <label className="block text-xs font-semibold text-gray-600 mb-2">Menu Item (from POS)</label>
        <div className="relative">
          <Input value={selectedMenu ? selectedMenu.name : menuSearch}
            placeholder="Search POS menu item…"
            onChange={e => { setMenuSearch(e.target.value); setSelectedMenu(null); }} />
          {menuFiltered.length > 0 && !selectedMenu && (
            <div className="absolute z-20 top-full left-0 bg-white border rounded-lg shadow-lg w-full max-h-40 overflow-y-auto">
              {menuFiltered.map((m:any) => (
                <div key={m.id} onClick={() => { setSelectedMenu(m); setMenuSearch(''); }}
                  className="px-3 py-2 hover:bg-indigo-50 cursor-pointer text-sm flex justify-between">
                  <span>{m.name}</span>
                  <span className="text-gray-400">{m.department} · ${Number(m.price||0).toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        {selectedMenu && (
          <div className="mt-2 flex items-center gap-4 text-sm">
            <span className="font-medium">{selectedMenu.name}</span>
            <span className="text-gray-500">Selling price: <strong>${Number(selectedMenu.price||0).toFixed(2)}</strong></span>
            {theoreticalCost > 0 && (
              <span className="text-green-700">
                Food cost: <strong>{((theoreticalCost / Number(selectedMenu.price||1)) * 100).toFixed(1)}%</strong>
              </span>
            )}
            <button onClick={() => setSelectedMenu(null)} className="text-gray-400 hover:text-red-500 ml-auto">✕</button>
          </div>
        )}
      </div>

      {/* Ingredients table */}
      <div className="rounded-lg border border-gray-200 overflow-x-auto mb-4">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              {['Ingredient (Inventory Item)','Qty','UOM','Wastage %','Unit Cost','Effective Cost',''].map(h => (
                <th key={h} className="px-2 py-2 text-left text-xs font-semibold text-gray-600">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ingredients.map((line, i) => {
              const searchVal = itemSearch[i] ?? line.item_name;
                    const suggestions = searchVal.length >= 2
                      ? items.filter((it:any) =>
                          it.name.toLowerCase().includes(searchVal.toLowerCase()) ||
                          (it.sku||'').toLowerCase().includes(searchVal.toLowerCase()) ||
                          (it.id||'').toLowerCase().includes(searchVal.toLowerCase())
                        ).slice(0, 8)
                      : [];
              const waste = 1 + (Number(line.wastage_pct||0)/100);
              const effectiveCost = Number(line.qty||0) * Number(line.unit_cost||0) * waste;
              return (
                <tr key={i} className="border-t border-gray-100">
                  <td className="px-2 py-1 relative min-w-[200px]">
                    <Input value={searchVal} placeholder="Search inventory item…"
                      onChange={e => { setItemSearch(s=>({...s,[i]:e.target.value})); if (!e.target.value) updateIngredient(i,'item_id',''); }}
                      className="text-sm" />
                    {suggestions.length > 0 && (
                      <div className="absolute z-30 top-full left-2 bg-white border rounded-lg shadow-lg w-72 max-h-40 overflow-y-auto">
                        {suggestions.map((it:any) => (
                          <div key={it.id} onClick={() => selectIngredientItem(i, it)}
                            className="px-3 py-1.5 hover:bg-indigo-50 cursor-pointer text-xs flex justify-between items-center gap-2">
                            {/* Item name only — never expose the raw item id (per cost-controller UX) */}
                            <span className="truncate">{it.name}</span>
                            <span className="text-indigo-600 whitespace-nowrap">{fmt(it.weighted_avg_cost)}/{it.base_uom_code || ''}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-1 w-20">
                    <Input type="number" min={0} step="0.001" value={line.qty}
                      onChange={e => updateIngredient(i,'qty',e.target.value)} className="text-sm text-center" />
                  </td>
                  <td className="px-2 py-1 w-24">
                    <select className="border rounded px-2 py-1 text-sm w-full" value={line.uom}
                      onChange={e => updateIngredient(i,'uom',e.target.value)}>
                      {uoms.map((u:any) => <option key={u.id} value={u.id}>{u.code}</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-1 w-20">
                    <Input type="number" min={0} max={100} step="0.1" value={line.wastage_pct}
                      onChange={e => updateIngredient(i,'wastage_pct',e.target.value)} className="text-sm text-center" />
                  </td>
                  <td className="px-2 py-1 w-24 text-right text-gray-500">{fmt(line.unit_cost)}</td>
                  <td className="px-2 py-1 w-24 text-right font-medium text-indigo-700">{fmt(effectiveCost)}</td>
                  <td className="px-2 py-1">
                    <button onClick={() => removeIngredient(i)} className="text-red-400 hover:text-red-600 text-lg">×</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between">
        <Button variant="outline" onClick={addIngredient}>＋ Add Ingredient</Button>
        <div className="text-right">
          <div className="text-sm text-gray-500">Theoretical Cost per Portion</div>
          <div className="text-2xl font-bold text-indigo-700">{fmt(theoreticalCost)}</div>
          {selectedMenu && Number(selectedMenu.price) > 0 && (
            <div className="text-xs text-gray-500">
              GP: {(((Number(selectedMenu.price) - theoreticalCost) / Number(selectedMenu.price)) * 100).toFixed(1)}%
            </div>
          )}
        </div>
      </div>

      <div className="flex justify-end mt-5 gap-3">
        <Button onClick={save} disabled={saving} className="bg-indigo-600 text-white hover:bg-indigo-700">
          {saving ? 'Saving…' : 'Save Recipe'}
        </Button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB — LOCATIONS MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────
function LocationsManager({ data }: { data: ReturnType<typeof useInventoryData> }) {
  const { locations, reload } = data;
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editLoc, setEditLoc] = useState<any|null>(null);
  const [form, setForm] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string|null>(null);

  const openNew = () => { setForm({ location_type: 'Storage' }); setEditLoc({}); setShowForm(true); };
  const openEdit = (loc: any) => { setForm({ ...loc }); setEditLoc(loc); setShowForm(true); };
  const close = () => { setShowForm(false); setEditLoc(null); setForm({}); };

  const save = async () => {
    if (!form.name?.trim()) { toast({ title: 'Name required', variant: 'destructive' }); return; }
    setSaving(true);
    try {
      const isEdit = !!editLoc?.id;
      const url    = isEdit ? `${API}/locations/${editLoc.id}` : `${API}/locations`;
      const method = isEdit ? 'PUT' : 'POST';
      const res    = await fetch(url, { method, headers:{'Content-Type':'application/json'}, body: JSON.stringify(form) }).then(r=>r.json());

      if (res.ok) {
        // ── If new Outlet location, also create corresponding POS cost centre ──
        // So POS station selector immediately shows the new outlet without extra steps
        if (!isEdit && form.location_type === 'Outlet') {
          try {
            const pmsAuthDb = (await import('@/lib/pmsAuthDb')).default;
            await pmsAuthDb.addCostCentre(form.name.trim(), form.description || undefined);
          } catch { /* non-fatal — location was already created */ }
        }
        toast({ title: isEdit ? 'Location updated' : `${form.location_type} location created` });
        close();
        reload();
      } else {
        toast({ title: 'Error', description: res.error, variant: 'destructive' });
      }
    } catch (e: any) {
      toast({ title: 'Error', description: e?.message || 'Save failed', variant: 'destructive' });
    }
    setSaving(false);
  };

  const del = async (id: string, name: string) => {
    if (!confirm(`Deactivate "${name}"? This cannot be undone if stock exists.`)) return;
    setDeleting(id);
    const res = await fetch(`${API}/locations/${id}`, { method: 'DELETE' }).then(r=>r.json());
    setDeleting(null);
    if (res.ok) { toast({ title: `${name} deactivated` }); reload(); }
    else toast({ title: 'Cannot delete', description: res.error, variant: 'destructive' });
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-base font-bold text-gray-700">Destination Stores & Outlets</h3>
          <p className="text-xs text-gray-400">Storage = receiving locations. Outlet = cost centres (Bar, Kitchen, Restaurant).</p>
        </div>
        <Button onClick={openNew} className="bg-emerald-600 text-white hover:bg-emerald-700">＋ New Location</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-2">
        {['Storage','Outlet'].map(type => (
          <div key={type} className="border rounded-lg overflow-hidden">
            <div className={`px-4 py-2 font-semibold text-sm ${type==='Storage'?'bg-blue-50 text-blue-800':'bg-orange-50 text-orange-800'}`}>
              {type === 'Storage' ? '🏪 Storage Locations' : '🍽 Outlets / Cost Centres'}
            </div>
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50"><tr>
                <th className="px-3 py-1.5 text-left text-xs font-semibold text-gray-500">Name</th>
                <th className="px-3 py-1.5 text-left text-xs font-semibold text-gray-500">Description</th>
                <th className="px-3 py-1.5 text-xs">Actions</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100">
                {locations.filter((l:any)=>l.location_type===type).map((loc:any)=>(
                  <tr key={loc.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-medium">{loc.name}</td>
                    <td className="px-3 py-2 text-gray-400 text-xs">{loc.description||'—'}</td>
                    <td className="px-3 py-2 flex gap-1 justify-center">
                      <Button variant="outline" size="sm" onClick={()=>openEdit(loc)}>Edit</Button>
                      <Button variant="destructive" size="sm" disabled={deleting===loc.id}
                        onClick={()=>del(loc.id, loc.name)}>
                        {deleting===loc.id?'…':'Del'}
                      </Button>
                    </td>
                  </tr>
                ))}
                {locations.filter((l:any)=>l.location_type===type).length===0 && (
                  <tr><td colSpan={3} className="px-3 py-4 text-center text-gray-400 text-xs">No {type.toLowerCase()} locations</td></tr>
                )}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      {showForm && editLoc !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
            <h3 className="text-lg font-bold mb-4">{editLoc?.id ? 'Edit Location' : 'New Location'}</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Name *</label>
                <Input value={form.name||''} onChange={e=>setForm((f:any)=>({...f,name:e.target.value}))} placeholder="e.g. Bar 2, Cold Room" />
              </div>
              {!editLoc?.id && (
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Type *</label>
                  <select className="w-full border rounded-md px-3 py-2 text-sm" value={form.location_type||'Storage'} onChange={e=>setForm((f:any)=>({...f,location_type:e.target.value}))}>
                    <option value="Storage">Storage (receiving dock, cellar, freezer)</option>
                    <option value="Outlet">Outlet / Cost Centre (bar, kitchen, room service)</option>
                  </select>
                </div>
              )}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Description</label>
                <Input value={form.description||''} onChange={e=>setForm((f:any)=>({...f,description:e.target.value}))} placeholder="Optional notes" />
              </div>
            </div>
            <div className="flex gap-3 mt-5 justify-end">
              <Button variant="outline" onClick={close}>Cancel</Button>
              <Button onClick={save} disabled={saving} className="bg-emerald-600 text-white">{saving?'Saving…':'Save'}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB — UOM MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────
function UOMManager({ data }: { data: ReturnType<typeof useInventoryData> }) {
  const { uoms, reload } = data;
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editUom, setEditUom] = useState<any|null>(null);
  const [form, setForm] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string|null>(null);

  const openNew = () => { setForm({ category: 'Count' }); setEditUom({}); setShowForm(true); };
  const openEdit = (u: any) => { setForm({ ...u }); setEditUom(u); setShowForm(true); };
  const close = () => { setShowForm(false); setEditUom(null); setForm({}); };

  const save = async () => {
    if (!form.code?.trim() || !form.name?.trim()) { toast({ title: 'Code and Name required', variant: 'destructive' }); return; }
    setSaving(true);
    const res = editUom?.id
      ? await fetch(`${API}/uom/${editUom.id}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(form) }).then(r=>r.json())
      : await fetch(`${API}/uom`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(form) }).then(r=>r.json());
    setSaving(false);
    if (res.ok) { toast({ title: editUom?.id ? 'UOM updated' : 'UOM created' }); close(); reload(); }
    else toast({ title: 'Error', description: res.error, variant: 'destructive' });
  };

  const del = async (id: string, code: string) => {
    if (!confirm(`Delete UOM "${code}"? This will fail if any items use it.`)) return;
    setDeleting(id);
    const res = await fetch(`${API}/uom/${id}`, { method: 'DELETE' }).then(r=>r.json());
    setDeleting(null);
    if (res.ok) { toast({ title: `UOM ${code} deleted` }); reload(); }
    else toast({ title: 'Cannot delete', description: res.error, variant: 'destructive' });
  };

  const grouped = ['Count','Volume','Weight'].map(cat => ({
    cat, items: uoms.filter((u:any) => u.category === cat)
  }));

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-base font-bold text-gray-700">Units of Measure</h3>
          <p className="text-xs text-gray-400">Manage UOM codes used in GRNs, transfers and recipes. Code is immutable once items use it.</p>
        </div>
        <Button onClick={openNew} className="bg-violet-600 text-white hover:bg-violet-700">＋ New UOM</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {grouped.map(({ cat, items: uomItems }) => (
          <div key={cat} className="border rounded-lg overflow-hidden">
            <div className="px-4 py-2 bg-gray-50 font-semibold text-sm text-gray-700">{cat}</div>
            <table className="min-w-full text-sm">
              <thead><tr>
                <th className="px-3 py-1.5 text-left text-xs font-semibold text-gray-500">Code</th>
                <th className="px-3 py-1.5 text-left text-xs font-semibold text-gray-500">Name</th>
                <th className="px-3 py-1.5 text-xs">Actions</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100">
                {uomItems.map((u:any) => (
                  <tr key={u.id} className="hover:bg-gray-50">
                    <td className="px-3 py-1.5 font-mono font-bold text-violet-700">{u.code}</td>
                    <td className="px-3 py-1.5">{u.name}</td>
                    <td className="px-3 py-1.5 flex gap-1">
                      <Button variant="outline" size="sm" onClick={()=>openEdit(u)} className="text-xs px-2">Edit</Button>
                      <Button variant="destructive" size="sm" disabled={deleting===u.id}
                        onClick={()=>del(u.id, u.code)} className="text-xs px-2">
                        {deleting===u.id?'…':'×'}
                      </Button>
                    </td>
                  </tr>
                ))}
                {uomItems.length===0 && (
                  <tr><td colSpan={3} className="px-3 py-3 text-center text-gray-400 text-xs">None</td></tr>
                )}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      {showForm && editUom !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
            <h3 className="text-lg font-bold mb-4">{editUom?.id ? 'Edit UOM' : 'New Unit of Measure'}</h3>
            <div className="space-y-3">
              {!editUom?.id && (
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Code * <span className="font-normal text-gray-400">(e.g. BTL, ML, KG — immutable)</span></label>
                  <Input value={form.code||''} onChange={e=>setForm((f:any)=>({...f,code:e.target.value.toUpperCase()}))} placeholder="BTL" maxLength={10} />
                </div>
              )}
              {editUom?.id && <div className="text-sm text-gray-500">Code: <strong className="font-mono text-violet-700">{editUom.code}</strong> (cannot be changed)</div>}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Name *</label>
                <Input value={form.name||''} onChange={e=>setForm((f:any)=>({...f,name:e.target.value}))} placeholder="e.g. Bottle" />
              </div>
              {!editUom?.id && (
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Category *</label>
                  <select className="w-full border rounded-md px-3 py-2 text-sm" value={form.category||'Count'} onChange={e=>setForm((f:any)=>({...f,category:e.target.value}))}>
                    <option value="Count">Count (Case, Bottle, Unit, Box…)</option>
                    <option value="Volume">Volume (ML, L, Tot…)</option>
                    <option value="Weight">Weight (G, KG…)</option>
                  </select>
                </div>
              )}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Description</label>
                <Input value={form.description||''} onChange={e=>setForm((f:any)=>({...f,description:e.target.value}))} placeholder="Optional" />
              </div>
            </div>
            <div className="flex gap-3 mt-5 justify-end">
              <Button variant="outline" onClick={close}>Cancel</Button>
              <Button onClick={save} disabled={saving} className="bg-violet-600 text-white">{saving?'Saving…':'Save'}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 5 — SUPPLIERS
// ─────────────────────────────────────────────────────────────────────────────
function Suppliers({ data }: { data: ReturnType<typeof useInventoryData> }) {
  const { vendors, reload } = data;
  const { toast } = useToast();
  const [form, setForm] = useState<any>({});
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!form.name) { toast({ title: 'Supplier name required', variant:'destructive' }); return; }
    setSaving(true);
    const r = await fetch('/api/db/query', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sql: `INSERT INTO vendors (id, name, contact_person, phone, email, address, payment_terms, status, created_at, updated_at)
              VALUES (gen_random_uuid(), $1,$2,$3,$4,$5,$6,'active',NOW(),NOW()) RETURNING id`,
        params: [form.name, form.contact_person||'', form.phone||'', form.email||'', form.address||'', form.payment_terms||'30 days']
      })
    });
    const d = await r.json();
    setSaving(false);
    if (d.ok) { toast({ title: `Supplier ${form.name} added` }); setShowForm(false); setForm({}); reload(); }
    else toast({ title: 'Error', description: d.error, variant:'destructive' });
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-bold text-gray-700">Suppliers / Vendors</h3>
        <Button onClick={() => setShowForm(true)} className="bg-teal-600 text-white hover:bg-teal-700">＋ New Supplier</Button>
      </div>

      <div className="flex-1 overflow-auto rounded-lg border border-gray-200">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              {['Name','Contact','Phone','Email','Payment Terms','Actions'].map(h => (
                <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {vendors.length === 0 && <tr><td colSpan={6} className="text-center py-10 text-gray-400">No suppliers yet</td></tr>}
            {vendors.map((v:any) => (
              <tr key={v.id} className="hover:bg-gray-50">
                <td className="px-3 py-2 font-medium">{v.name}</td>
                <td className="px-3 py-2 text-gray-500">{v.contact_person || '—'}</td>
                <td className="px-3 py-2">{v.phone || '—'}</td>
                <td className="px-3 py-2">{v.email || '—'}</td>
                <td className="px-3 py-2">{v.payment_terms || '—'}</td>
                <td className="px-3 py-2 text-gray-400 text-xs">—</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-6">
            <h3 className="text-lg font-bold mb-5">New Supplier</h3>
            <div className="space-y-3">
              {[['name','Supplier Name *'],['contact_person','Contact Person'],['phone','Phone'],['email','Email'],['address','Address'],['payment_terms','Payment Terms']].map(([field, label]) => (
                <div key={field}>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">{label}</label>
                  <Input value={form[field]||''} onChange={e => setForm((f:any) => ({...f,[field]:e.target.value}))}
                    placeholder={field === 'payment_terms' ? '30 days' : ''} />
                </div>
              ))}
            </div>
            <div className="flex gap-3 mt-5 justify-end">
              <Button variant="outline" onClick={() => { setShowForm(false); setForm({}); }}>Cancel</Button>
              <Button onClick={save} disabled={saving} className="bg-teal-600 text-white">
                {saving ? 'Saving…' : 'Save Supplier'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 6 — VARIANCE REPORTS
// ─────────────────────────────────────────────────────────────────────────────
function VarianceReports({ data }: { data: ReturnType<typeof useInventoryData> }) {
  const { locations } = data;
  const { user } = useAuth();
  const { toast } = useToast();
  // FIX: initialize dynamically from first active location, not hardcoded ID
  const [location, setLocation] = useState(() => locations.length > 0 ? locations[0].id : '');
  React.useEffect(() => {
    if (!location && locations.length > 0) setLocation(locations[0].id);
  }, [locations.length]);
  const [dateFrom, setDateFrom] = useState(new Date(Date.now()-30*86400000).toISOString().slice(0,10));
  const [dateTo, setDateTo] = useState(new Date().toISOString().slice(0,10));
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<'all'|'warning'|'critical'>('all');
  const [closing, setClosing] = useState(false);
  const [periodLocked, setPeriodLocked] = useState(false);
  const [closeError, setCloseError] = useState('');
  const [stockSummary, setStockSummary] = useState<any[]>([]);

  const loadStock = async () => {
    const r = await apiGet(`/stock-summary?location_id=${location}`);
    if (r.ok) setStockSummary(r.data);
  };

  useEffect(() => { loadStock(); }, [location]);

  const generate = async () => {
    setLoading(true);
    const r = await apiPost('/variance/generate', {
      location_id: location,
      period_start: dateFrom,
      period_end:   dateTo,
      generated_by: user?.id || 'system'
    });
    setLoading(false);
    if (r.ok) { setReport(r.data); toast({ title: `Variance report ${r.data.report_number} generated` }); }
    else toast({ title: 'Failed', description: r.error, variant:'destructive' });
  };

  const lines = (report?.lines || []).filter((l:any) =>
    filter === 'all' || l.alert === filter
  );

  const handleClosePeriod = async () => {
    setClosing(true);
    setCloseError('');
    try {
      const counts = (report?.lines || []).map((line: any) => ({
        item_id: line.item_id,
        physical_qty: line.physical,
        unit_cost: line.unit_cost || 0,
      }));
      const r = await fetch('/api/v1/inventory/close-period', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          location_id: location,
          period_start: dateFrom,
          period_end: dateTo,
          closed_by: 'manager',
          counts,
        }),
      }).then(r => r.json());
      if (!r.ok) {
        if (r.error?.includes('already locked')) setPeriodLocked(true);
        throw new Error(r.error || 'Close period failed');
      }
      setPeriodLocked(true);
    } catch (e) {
      setCloseError(e instanceof Error ? e.message : String(e));
    } finally {
      setClosing(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end p-4 bg-gray-50 rounded-lg border">
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Location</label>
          <select className="border rounded-md px-3 py-2 text-sm" value={location} onChange={e => setLocation(e.target.value)}>
            {locations.map((l:any) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">From</label>
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">To</label>
          <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
        </div>
        <Button onClick={generate} disabled={loading} className="bg-purple-700 text-white hover:bg-purple-800">
          {loading ? 'Generating…' : '▶ Generate Variance Report'}
        </Button>
      </div>

      {/* Stock-on-hand summary */}
      <div>
        <h4 className="text-sm font-bold text-gray-600 mb-2">📦 Current Stock on Hand — {locations.find((l:any)=>l.id===location)?.name}</h4>
        <div className="overflow-auto rounded-lg border border-gray-200 max-h-64">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 sticky top-0">
              <tr>{['SKU','Item','Category','Qty on Hand','UOM','Unit Cost','Stock Value'].map(h=>(
                <th key={h} className="px-3 py-1.5 text-left text-xs font-semibold text-gray-600">{h}</th>
              ))}</tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {stockSummary.length === 0 && <tr><td colSpan={7} className="text-center py-6 text-gray-400">No stock movements recorded yet</td></tr>}
              {stockSummary.map((s:any, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-3 py-1.5 font-mono text-xs text-purple-700">{s.sku||'—'}</td>
                  <td className="px-3 py-1.5 font-medium">{s.name}</td>
                  <td className="px-3 py-1.5 text-gray-500">{s.category}</td>
                  <td className="px-3 py-1.5 text-right font-bold text-indigo-700">{fmtQ(s.qty_on_hand)}</td>
                  <td className="px-3 py-1.5">{s.uom||'—'}</td>
                  <td className="px-3 py-1.5 text-right">{fmt(s.unit_cost)}</td>
                  <td className="px-3 py-1.5 text-right font-medium">{fmt(Number(s.qty_on_hand)*Number(s.unit_cost))}</td>
                </tr>
              ))}
            </tbody>
            {stockSummary.length > 0 && (
              <tfoot className="bg-gray-50 font-bold">
                <tr>
                  <td colSpan={6} className="px-3 py-2 text-right text-sm">Total Stock Value:</td>
                  <td className="px-3 py-2 text-right text-indigo-700">
                    {fmt(stockSummary.reduce((s:number,r:any)=>s+Number(r.qty_on_hand)*Number(r.unit_cost),0))}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Variance report results */}
      {report && (
        <div>
          <div className="flex items-center gap-4 mb-3">
            <h4 className="text-sm font-bold text-gray-700">Variance Report — {report.report_number}</h4>
            <div className="flex gap-2">
              {[['all','All'],['warning','⚠ Warning'],['critical','🔴 Critical']].map(([v,l]) => (
                <button key={v} onClick={() => setFilter(v as any)}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition ${filter===v ? 'bg-purple-700 text-white border-purple-700' : 'border-gray-300 text-gray-600 hover:bg-gray-100'}`}>
                  {l}
                </button>
              ))}
            </div>
          </div>

          {/* Stat cards */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            {[
              { label:'OK', count: report.ok_count,       color:'bg-green-50 text-green-700 border-green-200' },
              { label:'Warning (2–5%)', count: report.warning_count,  color:'bg-yellow-50 text-yellow-700 border-yellow-200' },
              { label:'Critical (>5%)', count: report.critical_count, color:'bg-red-50 text-red-700 border-red-200' },
            ].map(c => (
              <div key={c.label} className={`p-4 rounded-lg border ${c.color}`}>
                <div className="text-2xl font-bold">{c.count}</div>
                <div className="text-xs mt-1">{c.label}</div>
              </div>
            ))}
          </div>

          <div className="overflow-auto rounded-lg border border-gray-200">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr>{['Item','Theoretical Qty','Physical Qty','Variance','Variance %','Variance Value','Alert'].map(h=>(
                  <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-600">{h}</th>
                ))}</tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {lines.length === 0 && <tr><td colSpan={7} className="text-center py-8 text-gray-400">No variances in this period</td></tr>}
                {lines.map((l:any, i:number) => (
                  <tr key={i} className={l.alert==='critical'?'bg-red-50':l.alert==='warning'?'bg-yellow-50':''}>
                    <td className="px-3 py-2 font-medium">{l.name || l.item_id}</td>
                    <td className="px-3 py-2 text-right">{fmtQ(l.theoretical)}</td>
                    <td className="px-3 py-2 text-right">{fmtQ(l.physical)}</td>
                    <td className={`px-3 py-2 text-right font-bold ${l.variance<0?'text-red-600':'text-green-700'}`}>{fmtQ(l.variance)}</td>
                    <td className="px-3 py-2 text-right">{Number(l.variancePct||0).toFixed(2)}%</td>
                    <td className="px-3 py-2 text-right font-medium">{fmt(l.varianceVal)}</td>
                    <td className="px-3 py-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${l.alert==='critical'?'bg-red-200 text-red-700':l.alert==='warning'?'bg-yellow-200 text-yellow-700':'bg-green-100 text-green-700'}`}>
                        {l.alert?.toUpperCase()}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {report && (
        <div style={{ marginTop: 24, display: 'flex', alignItems: 'center', gap: 12 }}>
          {periodLocked ? (
            <>
            <span style={{ padding: '6px 16px', background: '#dcfce7', color: '#166534',
                           border: '1px solid #86efac', borderRadius: 6, fontWeight: 600 }}>
              🔒 Period LOCKED
            </span>
            {user?.role === 'admin' && (
              <button
                onClick={async () => {
                  const reason = window.prompt('Reason for reopening this period (required):');
                  if (!reason || !reason.trim()) return;
                  setClosing(true);
                  setCloseError('');
                  try {
                    const pr = await fetch('/api/v1/inventory/periods').then(r => r.json());
                    const match = (pr.data || pr.periods || []).find((p: any) =>
                      p.location_id === location && p.start_date === dateFrom &&
                      p.end_date === dateTo && p.status === 'locked');
                    if (!match) throw new Error('No locked period found for this location/date range');
                    const r = await fetch('/api/v1/inventory/reopen-period', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', 'x-user-role': user?.role || '' },
                      body: JSON.stringify({ period_id: match.id, reopened_by: user?.username || user?.id || 'admin', reason }),
                    }).then(r => r.json());
                    if (!r.ok) throw new Error(r.error || 'Reopen failed');
                    setPeriodLocked(false);
                  } catch (e) {
                    setCloseError(e instanceof Error ? e.message : String(e));
                  } finally {
                    setClosing(false);
                  }
                }}
                disabled={closing}
                style={{ padding: '8px 20px', background: '#b91c1c', color: '#fff',
                         border: 'none', borderRadius: 6, cursor: 'pointer',
                         opacity: closing ? 0.6 : 1, fontWeight: 600 }}
              >
                {closing ? 'Reopening…' : 'Reopen Period'}
              </button>
            )}
            </>
          ) : (
            <button
              onClick={handleClosePeriod}
              disabled={closing || !report}
              style={{ padding: '8px 20px', background: '#dc2626', color: '#fff',
                       border: 'none', borderRadius: 6, cursor: 'pointer',
                       opacity: closing ? 0.6 : 1, fontWeight: 600 }}
            >
              {closing ? 'Closing…' : 'Close Period'}
            </button>
          )}
          {closeError && (
            <span style={{ color: '#dc2626', fontSize: 13 }}>{closeError}</span>
          )}
        </div>
      )}
    </div>
  );
}

// ─── STOCK REPORTS ───────────────────────────────────────────────────────────
function StockReports({ data }: { data: ReturnType<typeof useInventoryData> }) {
  const { toast } = useToast();
  const [subTab, setSubTab] = React.useState<'onhand' | 'movement' | 'variance'>('onhand');

  // Stock On Hand state
  const [ohLocation, setOhLocation] = React.useState('');
  const [ohAsOf, setOhAsOf] = React.useState(new Date().toISOString().split('T')[0]);
  const [ohRows, setOhRows] = React.useState<any[]>([]);
  const [ohLoading, setOhLoading] = React.useState(false);

  // Movement state
  const [mvLocation, setMvLocation] = React.useState('');
  const [mvFrom, setMvFrom] = React.useState(new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0]);
  const [mvTo, setMvTo] = React.useState(new Date().toISOString().split('T')[0]);
  const [mvRows, setMvRows] = React.useState<any[]>([]);
  const [mvLoading, setMvLoading] = React.useState(false);
  const [mvItemFilter, setMvItemFilter] = React.useState('');

  // Drill-down: clicking a stock-on-hand row opens the item's stock card
  // (movement report scoped to that item at the same location).
  const drillToMovement = async (row: any) => {
    const from = new Date(new Date(ohAsOf).getTime() - 30 * 86400000).toISOString().split('T')[0];
    setMvLocation(ohLocation);
    setMvFrom(from);
    setMvTo(ohAsOf);
    setMvItemFilter(row.name);
    setSubTab('movement');
    setMvLoading(true);
    try {
      const r = await fetch(`/api/v1/inventory/report/movement?location_id=${ohLocation}&from=${from}&to=${ohAsOf}`);
      const d = await r.json();
      if (d.ok) setMvRows(d.rows);
      else toast({ title: 'Error', description: d.error, variant: 'destructive' });
    } catch (e: any) {
      toast({ title: 'Network error', description: e.message, variant: 'destructive' });
    } finally { setMvLoading(false); }
  };

  const visibleMvRows = mvItemFilter
    ? mvRows.filter(r => r.item_name === mvItemFilter)
    : mvRows;

  const runStockOnHand = async () => {
    if (!ohLocation) { toast({ title: 'Select a location', variant: 'destructive' }); return; }
    setOhLoading(true);
    try {
      const r = await fetch(`/api/v1/inventory/report/stock-on-hand?location_id=${ohLocation}&as_of=${ohAsOf}T23:59:59`);
      const d = await r.json();
      if (d.ok) setOhRows(d.rows);
      else toast({ title: 'Error', description: d.error, variant: 'destructive' });
    } catch (e: any) {
      toast({ title: 'Network error', description: e.message, variant: 'destructive' });
    } finally { setOhLoading(false); }
  };

  const runMovement = async () => {
    if (!mvLocation) { toast({ title: 'Select a location', variant: 'destructive' }); return; }
    setMvLoading(true);
    try {
      const r = await fetch(`/api/v1/inventory/report/movement?location_id=${mvLocation}&from=${mvFrom}&to=${mvTo}`);
      const d = await r.json();
      if (d.ok) setMvRows(d.rows);
      else toast({ title: 'Error', description: d.error, variant: 'destructive' });
    } catch (e: any) {
      toast({ title: 'Network error', description: e.message, variant: 'destructive' });
    } finally { setMvLoading(false); }
  };

  const SUB_TABS = [
    { id: 'onhand',   label: '📋 Stock On Hand' },
    { id: 'movement', label: '🔀 Movement' },
    { id: 'variance', label: '⚖ Variance' },
  ] as const;

  return (
    <div className="space-y-4">
      {/* Sub-tab bar */}
      <div className="flex gap-1 border-b pb-2">
        {SUB_TABS.map(t => (
          <button key={t.id} onClick={() => setSubTab(t.id as any)}
            className={`px-4 py-1.5 rounded-t text-sm font-medium transition-all ${
              subTab === t.id ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Stock On Hand */}
      {subTab === 'onhand' && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Location</label>
              <select value={ohLocation} onChange={e => setOhLocation(e.target.value)}
                className="border rounded px-2 py-1.5 text-sm min-w-[180px]">
                <option value="">Select location…</option>
                {((data as any).locations || []).map((l: any) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">As Of</label>
              <input type="date" value={ohAsOf} onChange={e => setOhAsOf(e.target.value)}
                className="border rounded px-2 py-1.5 text-sm" />
            </div>
            <button onClick={runStockOnHand} disabled={ohLoading}
              className="px-4 py-1.5 bg-indigo-600 text-white rounded text-sm font-medium disabled:opacity-50">
              {ohLoading ? 'Running…' : 'Run Report'}
            </button>
            {ohRows.length > 0 && (
              <button onClick={() => downloadCSV(
                `stock-onhand-${ohLocation}-${ohAsOf}.csv`,
                ohRows,
                ['id','name','category','balance','uom']
              )} className="px-4 py-1.5 border rounded text-sm font-medium text-gray-600 hover:bg-gray-50">
                ⬇ Export CSV
              </button>
            )}
          </div>
          {ohRows.length > 0 && (
            <div className="overflow-x-auto rounded border">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">Item</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">Category</th>
                    <th className="px-4 py-2 text-right font-medium text-gray-600">Balance</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">UOM</th>
                  </tr>
                </thead>
                <tbody>
                  {ohRows.map((row, i) => (
                    <tr key={row.id} onClick={() => drillToMovement(row)}
                      title="Click to view this item's stock card (movement history)"
                      className={`border-b cursor-pointer hover:bg-indigo-50 ${Number(row.balance) === 0 ? 'text-gray-400' : ''} ${i % 2 === 0 ? '' : 'bg-gray-50/50'}`}>
                      <td className="px-4 py-2">{row.name}</td>
                      <td className="px-4 py-2 text-gray-500">{row.category}</td>
                      <td className="px-4 py-2 text-right font-mono">{fmtQ(Number(row.balance))}</td>
                      <td className="px-4 py-2 text-gray-500">{row.uom}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {ohRows.length === 0 && !ohLoading && (
            <p className="text-sm text-gray-400 text-center py-8">Select a location and run the report.</p>
          )}
        </div>
      )}

      {/* Movement */}
      {subTab === 'movement' && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Location</label>
              <select value={mvLocation} onChange={e => setMvLocation(e.target.value)}
                className="border rounded px-2 py-1.5 text-sm min-w-[180px]">
                <option value="">Select location…</option>
                {((data as any).locations || []).map((l: any) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">From</label>
              <input type="date" value={mvFrom} onChange={e => setMvFrom(e.target.value)}
                className="border rounded px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">To</label>
              <input type="date" value={mvTo} onChange={e => setMvTo(e.target.value)}
                className="border rounded px-2 py-1.5 text-sm" />
            </div>
            <button onClick={runMovement} disabled={mvLoading}
              className="px-4 py-1.5 bg-indigo-600 text-white rounded text-sm font-medium disabled:opacity-50">
              {mvLoading ? 'Running…' : 'Run Report'}
            </button>
            {mvItemFilter && (
              <span className="flex items-center gap-1.5 bg-indigo-100 text-indigo-700 px-3 py-1.5 rounded-full text-xs font-medium">
                Item: {mvItemFilter}
                <button onClick={() => setMvItemFilter('')} className="hover:text-indigo-900 font-bold">✕</button>
              </span>
            )}
            {mvRows.length > 0 && (
              <button onClick={() => downloadCSV(
                `movement-${mvLocation}-${mvFrom}-${mvTo}.csv`,
                mvRows,
                ['date','item_name','ledger_type','reference_number','quantity_change','uom','running_balance','posted_by']
              )} className="px-4 py-1.5 border rounded text-sm font-medium text-gray-600 hover:bg-gray-50">
                ⬇ Export CSV
              </button>
            )}
          </div>
          {mvRows.length > 0 && (
            <div className="overflow-x-auto rounded border">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">Date</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">Item</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">Type</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">Reference</th>
                    <th className="px-4 py-2 text-right font-medium text-gray-600">Qty Change</th>
                    <th className="px-4 py-2 text-right font-medium text-gray-600">Running Bal</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">Posted By</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleMvRows.map((row, i) => (
                    <tr key={i} className={`border-b ${i % 2 === 0 ? '' : 'bg-gray-50/50'}`}>
                      <td className="px-4 py-2 text-gray-500">{row.date}</td>
                      <td className="px-4 py-2">{row.item_name}</td>
                      <td className="px-4 py-2">
                        <span className={`text-xs px-1.5 py-0.5 rounded font-mono ${
                          row.ledger_type?.includes('OUT') || row.ledger_type?.includes('ADJ')
                            ? 'bg-red-50 text-red-700'
                            : 'bg-green-50 text-green-700'
                        }`}>{row.ledger_type}</span>
                      </td>
                      <td className="px-4 py-2 text-gray-500 text-xs">{row.reference_number || '—'}</td>
                      <td className={`px-4 py-2 text-right font-mono ${Number(row.quantity_change) < 0 ? 'text-red-600' : 'text-green-700'}`}>
                        {Number(row.quantity_change) > 0 ? '+' : ''}{fmtQ(Number(row.quantity_change))}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-gray-700">{fmtQ(Number(row.running_balance))}</td>
                      <td className="px-4 py-2 text-gray-500 text-xs">{row.posted_by || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {mvRows.length === 0 && !mvLoading && (
            <p className="text-sm text-gray-400 text-center py-8">Select a location and date range, then run the report.</p>
          )}
        </div>
      )}

      {/* Variance — delegate to existing component */}
      {subTab === 'variance' && <VarianceReports data={data} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN HUB
// ─────────────────────────────────────────────────────────────────────────────
const TABS = [
  { id: 'items',     label: '📦 Items',      desc: 'Item master & stock codes'       },
  { id: 'suppliers', label: '🏢 Suppliers',   desc: 'Vendor management'               },
  { id: 'grn',       label: '📥 GRN',         desc: 'Goods received notes'            },
  { id: 'transfer',  label: '🔄 Transfer',    desc: 'Stock transfers'                 },
  { id: 'recipes',   label: '🍽 Recipes',     desc: 'Recipe builder & costing'        },
  { id: 'reports',   label: '📊 Reports',     desc: 'Variance & stock reports'        },
  { id: 'locations', label: '🏪 Stores',      desc: 'Storage & outlet locations'      },
  { id: 'uom',       label: '⚖ UOM',          desc: 'Units of measure'                },
  { id: 'stock-take', label: '📋 Stock Take', desc: 'Monthly physical count sheets'   },
] as const;
type TabId = typeof TABS[number]['id'];

// ── Adjust Modal ──────────────────────────────────────────────────────────────
const AdjustModal: React.FC<{
  itemName: string;
  onSubmit: (qty: number, reason: string) => void;
  onClose: () => void;
}> = ({ itemName, onSubmit, onClose }) => {
  const [qty, setQty] = React.useState('');
  const [reason, setReason] = React.useState('');
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-96 space-y-4 shadow-xl">
        <h3 className="font-semibold text-lg">Record Adjustment — {itemName}</h3>
        <p className="text-sm text-gray-500">Writes a WASTE entry to the stock ledger immediately.</p>
        <label className="block text-sm font-medium text-gray-700">
          Qty to write off
          <input type="number" step="0.01" min="0" value={qty} onChange={e => setQty(e.target.value)}
            className="mt-1 block w-full border rounded px-3 py-1.5 text-sm" placeholder="e.g. 2.5" />
        </label>
        <label className="block text-sm font-medium text-gray-700">
          Reason
          <input type="text" value={reason} onChange={e => setReason(e.target.value)}
            placeholder="e.g. breakage, spillage"
            className="mt-1 block w-full border rounded px-3 py-1.5 text-sm" />
        </label>
        <div className="flex gap-3 justify-end pt-2">
          <button onClick={onClose}
            className="text-sm px-4 py-1.5 border rounded hover:bg-gray-50">
            Cancel
          </button>
          <button
            onClick={() => { const n = parseFloat(qty); if (!isNaN(n) && n > 0) onSubmit(n, reason); }}
            disabled={!qty || parseFloat(qty) <= 0}
            className="text-sm px-4 py-1.5 bg-amber-600 text-white rounded disabled:opacity-50">
            Record Adjustment
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Transfer Detail (master-detail drill-down) ────────────────────────────────
const TransferDetailModal: React.FC<{
  id: string;
  user: any;
  locName: (id: string) => string;
  onClose: () => void;
  onChanged: () => void;
}> = ({ id, user, locName, onClose, onChanged }) => {
  const [transfer, setTransfer] = React.useState<any>(null);
  const [lines, setLines] = React.useState<any[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const isAdmin = user?.role === 'admin';

  const load = React.useCallback(() => {
    fetch(`/api/v1/inventory/transfer/${id}`)
      .then(r => r.json())
      .then(d => {
        if (d.ok) { setTransfer(d.transfer); setLines(d.lines); }
        else setError(d.error || 'Failed to load transfer');
      })
      .catch(() => setError('Network error'));
  }, [id]);
  React.useEffect(() => { load(); }, [load]);

  const hotelName = (import.meta as any).env?.VITE_HOTEL_NAME || 'Villa Gianni';

  const printGTN = () => {
    if (!transfer) return;
    const rows = lines.map((l, i) => `
      <tr>
        <td>${i + 1}</td><td>${l.item_name}</td><td>${l.sku || '—'}</td>
        <td style="text-align:right">${Number(l.qty_requested).toFixed(2)}</td>
        <td>${l.source_uom_code || ''}</td>
      </tr>`).join('');
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html><head><title>${hotelName} — Goods Transfer Note ${transfer.transfer_number}</title>
      <style>
        body{font-family:Arial,sans-serif;margin:32px;color:#111}
        h1{font-size:20px;margin:0} .muted{color:#666;font-size:12px}
        table{width:100%;border-collapse:collapse;margin-top:16px;font-size:13px}
        th,td{border:1px solid #ccc;padding:6px 8px;text-align:left}
        th{background:#f3f4f6}
        .grid{display:flex;gap:32px;margin-top:16px;font-size:13px}
        .sig{margin-top:48px;display:flex;gap:48px;font-size:13px}
        .sig div{flex:1;border-top:1px solid #555;padding-top:6px}
      </style></head><body>
      <h1>${hotelName}</h1>
      <div class="muted">Goods Transfer Note — Internal Document</div>
      <div class="grid">
        <div><strong>GTN #:</strong> ${transfer.transfer_number}</div>
        <div><strong>Date:</strong> ${new Date(transfer.inserted_at).toLocaleDateString()}</div>
        <div><strong>Status:</strong> ${String(transfer.status).toUpperCase()}</div>
      </div>
      <div class="grid">
        <div><strong>From:</strong> ${transfer.source_location_name || locName(transfer.source_location_id)}</div>
        <div><strong>To:</strong> ${transfer.destination_location_name || locName(transfer.destination_location_id)}</div>
        <div><strong>Ref:</strong> ${transfer.reference_text || '—'}</div>
      </div>
      <table><thead><tr><th>#</th><th>Item</th><th>SKU</th><th style="text-align:right">Qty</th><th>UOM</th></tr></thead>
      <tbody>${rows}</tbody></table>
      <div class="sig"><div>Issued by</div><div>Received by</div><div>Authorised by</div></div>
      <div class="muted" style="margin-top:24px">${hotelName} | Printed ${new Date().toLocaleString()}</div>
      <script>window.print()</script></body></html>`);
    w.document.close();
  };

  const handleReverse = async () => {
    const reason = window.prompt('Reason for reversing this transfer (required):');
    if (!reason || !reason.trim()) return;
    setBusy(true); setError('');
    try {
      const r = await fetch(`/api/v1/inventory/transfer/${id}/reverse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': user?.role || '' },
        body: JSON.stringify({ reversed_by: user?.username || user?.id || 'admin', reason }),
      }).then(r => r.json());
      if (!r.ok) return setError(r.error || 'Reverse failed');
      load(); onChanged();
    } catch (_e) { setError('Network error'); }
    finally { setBusy(false); }
  };

  const handleDelete = async () => {
    if (!window.confirm('Delete this transfer? Only unposted transfers can be deleted.')) return;
    setBusy(true); setError('');
    try {
      const r = await fetch(`/api/v1/inventory/transfer/${id}`, { method: 'DELETE' }).then(r => r.json());
      if (!r.ok) return setError(r.error || 'Delete failed');
      onChanged(); onClose();
    } catch (_e) { setError('Network error'); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 backdrop-blur-sm overflow-y-auto pt-8 pb-8" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-2xl mx-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold">
            Transfer {transfer?.transfer_number || '…'}
            {transfer && (
              <span className={`ml-3 px-2 py-0.5 rounded-full text-xs font-semibold align-middle ${
                transfer.status === 'approved' ? 'bg-green-100 text-green-700'
                : transfer.status === 'reversed' ? 'bg-red-100 text-red-700'
                : 'bg-yellow-100 text-yellow-700'}`}>
                {String(transfer.status).toUpperCase()}
              </span>
            )}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        {error && <p className="text-red-600 text-sm bg-red-50 px-3 py-2 rounded mb-3">{error}</p>}

        {transfer && (
          <>
            <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 text-sm mb-4">
              <div><span className="text-gray-500">From:</span> <strong>{transfer.source_location_name || locName(transfer.source_location_id)}</strong></div>
              <div><span className="text-gray-500">To:</span> <strong>{transfer.destination_location_name || locName(transfer.destination_location_id)}</strong></div>
              <div><span className="text-gray-500">Date:</span> {new Date(transfer.inserted_at).toLocaleString()}</div>
              <div><span className="text-gray-500">Ref:</span> {transfer.reference_text || '—'}</div>
              <div><span className="text-gray-500">Created by:</span> {transfer.created_by || '—'}</div>
              {transfer.status === 'reversed' && (
                <div><span className="text-gray-500">Reversed:</span> {transfer.reversed_by} on {new Date(transfer.reversed_at).toLocaleDateString()}</div>
              )}
            </div>

            <div className="rounded-lg border border-gray-200 overflow-hidden mb-4">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    {['#','Item','SKU','Qty','UOM'].map(h => (
                      <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {lines.map((l, i) => (
                    <tr key={l.id}>
                      <td className="px-3 py-2 text-gray-400">{i + 1}</td>
                      <td className="px-3 py-2 font-medium">{l.item_name}</td>
                      <td className="px-3 py-2 text-gray-500">{l.sku || '—'}</td>
                      <td className="px-3 py-2 text-right">{Number(l.qty_requested).toFixed(2)}</td>
                      <td className="px-3 py-2 text-gray-500">{l.source_uom_code || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex gap-2 justify-end">
              <button onClick={printGTN}
                className="border border-gray-300 px-4 py-1.5 rounded text-sm font-medium hover:bg-gray-50">
                🖨 Print GTN
              </button>
              {['pending','draft','rejected','cancelled'].includes(transfer.status) && (
                <button onClick={handleDelete} disabled={busy}
                  className="border border-red-300 text-red-600 px-4 py-1.5 rounded text-sm font-medium hover:bg-red-50 disabled:opacity-50">
                  Delete
                </button>
              )}
              {transfer.status === 'approved' && isAdmin && (
                <button onClick={handleReverse} disabled={busy}
                  title="Creates offsetting ledger entries — audited"
                  className="bg-red-600 text-white px-4 py-1.5 rounded text-sm font-medium disabled:opacity-50">
                  {busy ? 'Reversing…' : 'Reverse Transfer'}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

// ── Stock Take ────────────────────────────────────────────────────────────────
const StockTake: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [locations, setLocations] = React.useState<{ id: string; name: string }[]>([]);
  const [locationId, setLocationId] = React.useState('');
  const [period, setPeriod] = React.useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [sheet, setSheet] = React.useState<any>(null);
  const [lines, setLines] = React.useState<any[]>([]);
  const [generating, setGenerating] = React.useState(false);
  const [locking, setLocking] = React.useState(false);
  const [adjustModal, setAdjustModal] = React.useState<any>(null);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    fetch('/api/v1/inventory/locations')
      .then(r => r.json())
      .then(d => { if (d.ok) setLocations(d.data || []); })
      .catch(() => {});
  }, []);

  const periodStart = `${period}-01`;
  const periodEnd = (() => {
    const [y, m] = period.split('-').map(Number);
    return `${y}-${String(m).padStart(2, '0')}-${new Date(y, m, 0).getDate()}`;
  })();

  const attachVariance = (ls: any[]) =>
    ls.map(l => ({
      ...l,
      variance_qty:
        l.physical_qty != null
          ? Number(l.physical_qty) -
            (Number(l.opening_qty) + Number(l.purchases_qty) + Number(l.transfers_in_qty) -
              Number(l.transfers_out_qty) - Number(l.theoretical_sales_qty) - Number(l.adjustments_qty))
          : null,
    }));

  const handleGenerate = async () => {
    if (!locationId) return setError('Select a location first');
    setGenerating(true);
    setError('');
    try {
      const r = await fetch('/api/v1/inventory/stock-take/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ location_id: locationId, period_start: periodStart, period_end: periodEnd }),
      }).then(r => r.json());
      if (!r.ok) return setError(r.error || 'Generate failed');
      setSheet(r.sheet);
      setLines(attachVariance(r.lines));
    } catch (_e) {
      setError('Network error');
    } finally {
      setGenerating(false);
    }
  };

  const handlePhysicalQty = async (lineId: string, value: string) => {
    const qty = parseFloat(value);
    if (isNaN(qty)) return;
    try {
      const r = await fetch(`/api/v1/inventory/stock-take/lines/${lineId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ physical_qty: qty }),
      }).then(r => r.json());
      if (r.ok) setLines(prev => prev.map(l => l.id === lineId ? { ...l, ...r.line } : l));
      else setError(r.error || 'Save failed');
    } catch (_e) {
      setError('Network error');
    }
  };

  const handleLock = async () => {
    if (!window.confirm('Lock this period? Physical counts will be frozen and a GL batch created. This cannot be undone.')) return;
    setLocking(true);
    setError('');
    try {
      const r = await fetch(`/api/v1/inventory/stock-take/${sheet.id}/lock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locked_by: 'staff' }),
      }).then(r => r.json());
      if (!r.ok) return setError(r.error || 'Lock failed');
      setSheet((s: any) => ({ ...s, status: 'locked' }));
    } catch (_e) {
      setError('Network error');
    } finally {
      setLocking(false);
    }
  };

  const handleReopen = async () => {
    if (!sheet) return;
    const reason = window.prompt('Reason for reopening this sheet (required):');
    if (!reason || !reason.trim()) return;
    setLocking(true);
    setError('');
    try {
      const r = await fetch(`/api/v1/inventory/stock-take/${sheet.id}/reopen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': user?.role || '' },
        body: JSON.stringify({ reopened_by: user?.username || user?.id || 'admin', reason }),
      }).then(r => r.json());
      if (!r.ok) return setError(r.error || 'Reopen failed');
      setSheet((s: any) => ({ ...s, status: 'draft' }));
    } catch (_e) {
      setError('Network error');
    } finally {
      setLocking(false);
    }
  };

  const handleAdjust = async (qty: number, reason: string) => {
    if (!adjustModal || !sheet) return;
    try {
      const r = await fetch(`/api/v1/inventory/stock-take/${sheet.id}/adjust`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: adjustModal.item_id, qty, reason }),
      }).then(r => r.json());
      if (r.ok) {
        setLines(prev => prev.map(l => l.id === r.line.id ? { ...l, ...r.line } : l));
        setAdjustModal(null);
      } else {
        setError(r.error || 'Adjust failed');
      }
    } catch (_e) {
      setError('Network error');
    }
  };

  const locked = sheet?.status === 'locked';
  const unfilledCount = lines.filter(l => l.physical_qty == null).length;

  return (
    <div className="space-y-4">
      {/* Controls row */}
      <div className="flex flex-wrap gap-3 items-center">
        <select value={locationId} onChange={e => setLocationId(e.target.value)}
          className="border rounded px-3 py-1.5 text-sm">
          <option value="">Select location…</option>
          {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <input type="month" value={period} onChange={e => setPeriod(e.target.value)}
          className="border rounded px-3 py-1.5 text-sm" />
        <button onClick={handleGenerate} disabled={generating || !locationId}
          className="bg-indigo-600 text-white px-4 py-1.5 rounded text-sm font-medium disabled:opacity-50">
          {generating ? 'Generating…' : 'Generate Sheet'}
        </button>
        {sheet && (
          <div className="ml-auto flex items-center gap-3">
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
              locked ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
            }`}>
              {locked ? '🔒 LOCKED' : 'DRAFT'}
            </span>
            {!locked && (
              <button
                onClick={handleLock}
                disabled={locking || unfilledCount > 0}
                title={unfilledCount > 0 ? `${unfilledCount} item(s) still need a count` : 'Lock this period'}
                className="bg-green-700 text-white px-4 py-1.5 rounded text-sm font-medium disabled:opacity-50">
                {locking ? 'Locking…' : `Lock Period${unfilledCount > 0 ? ` (${unfilledCount} remaining)` : ''}`}
              </button>
            )}
            {locked && isAdmin && (
              <button
                onClick={handleReopen}
                disabled={locking}
                title="Reopen this sheet for corrections (admin only — audited)"
                className="bg-red-600 text-white px-4 py-1.5 rounded text-sm font-medium disabled:opacity-50">
                {locking ? 'Reopening…' : 'Reopen Sheet'}
              </button>
            )}
          </div>
        )}
      </div>

      {error && <p className="text-red-600 text-sm bg-red-50 px-3 py-2 rounded">{error}</p>}

      {lines.length === 0 && !sheet && (
        <p className="text-gray-400 text-sm">Select a location and period, then click Generate Sheet.</p>
      )}
      {lines.length === 0 && sheet && (
        <p className="text-gray-400 text-sm">No inventory movements found for this location and period.</p>
      )}

      {/* Count grid */}
      {lines.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-gray-200 shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b text-gray-500 text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-3 py-2.5 font-medium">Item</th>
                <th className="text-right px-3 py-2.5 font-medium">Opening</th>
                <th className="text-right px-3 py-2.5 font-medium">Purchases</th>
                <th className="text-right px-3 py-2.5 font-medium">Trans. In</th>
                <th className="text-right px-3 py-2.5 font-medium">Trans. Out</th>
                <th className="text-right px-3 py-2.5 font-medium">Theo. Sales</th>
                <th className="text-right px-3 py-2.5 font-medium">Adjustments</th>
                <th className="text-right px-3 py-2.5 font-medium text-indigo-600">Physical Count</th>
                <th className="text-right px-3 py-2.5 font-medium">Variance</th>
                <th className="px-3 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {lines.map(line => {
                const v = line.variance_qty as number | null;
                const rowBg = v != null && v < 0 ? 'bg-red-50' : '';
                const varColor =
                  v == null ? 'text-gray-300' :
                  v < 0 ? 'text-red-600 font-semibold' :
                  v > 0 ? 'text-amber-600' :
                  'text-green-600';
                const inputBorder = v != null && v !== 0 ? 'border-red-400 focus:border-red-500' : 'border-indigo-300 focus:border-indigo-500';
                return (
                  <tr key={line.id} className={rowBg}>
                    <td className="px-3 py-2 font-medium text-gray-800">{line.item_name}</td>
                    <td className="text-right px-3 py-2 text-gray-500">{Number(line.opening_qty).toFixed(2)}</td>
                    <td className="text-right px-3 py-2 text-gray-500">{Number(line.purchases_qty).toFixed(2)}</td>
                    <td className="text-right px-3 py-2 text-gray-500">{Number(line.transfers_in_qty).toFixed(2)}</td>
                    <td className="text-right px-3 py-2 text-gray-500">{Number(line.transfers_out_qty).toFixed(2)}</td>
                    <td className="text-right px-3 py-2 text-gray-500">{Number(line.theoretical_sales_qty).toFixed(2)}</td>
                    <td className="text-right px-3 py-2 text-gray-500">{Number(line.adjustments_qty).toFixed(2)}</td>
                    <td className="text-right px-3 py-2">
                      {locked ? (
                        <span className="text-gray-700">{line.physical_qty != null ? Number(line.physical_qty).toFixed(2) : '—'}</span>
                      ) : (
                        <input
                          type="number" step="0.01"
                          defaultValue={line.physical_qty != null ? String(line.physical_qty) : ''}
                          placeholder="—"
                          onBlur={e => { if (e.target.value !== '') handlePhysicalQty(line.id, e.target.value); }}
                          className={`w-20 text-right border rounded px-2 py-1 text-sm outline-none ${inputBorder}`}
                        />
                      )}
                    </td>
                    <td className={`text-right px-3 py-2 ${varColor}`}>
                      {v != null ? v.toFixed(2) : '—'}
                    </td>
                    <td className="px-3 py-2">
                      {!locked && line.physical_qty != null && (
                        <button
                          onClick={() => setAdjustModal(line)}
                          className="text-xs text-gray-500 border border-gray-200 rounded px-2 py-0.5 hover:bg-gray-100">
                          Adjust
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Footer summary */}
          <div className="flex gap-4 px-3 py-2 border-t bg-gray-50 text-xs text-gray-500">
            <span>{lines.length} items</span>
            {unfilledCount > 0 && <span className="text-amber-600">{unfilledCount} not yet counted</span>}
            {lines.some(l => l.variance_qty != null && l.variance_qty < 0) && (
              <span className="ml-auto text-red-600 font-medium">
                Total shrinkage: {lines
                  .filter(l => l.variance_qty != null && l.variance_qty < 0)
                  .reduce((s, l) => s + Math.abs(l.variance_qty) * Number(l.unit_cost), 0)
                  .toFixed(2)}
              </span>
            )}
          </div>
        </div>
      )}

      {adjustModal && (
        <AdjustModal
          itemName={adjustModal.item_name}
          onSubmit={handleAdjust}
          onClose={() => setAdjustModal(null)}
        />
      )}
    </div>
  );
};

export const InventoryHub: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabId>('items');
  const data = useInventoryData();

  // Listen for navigation events from other modules (e.g. POS Settings "Add Item" button)
  React.useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { module?: string; tab?: TabId };
      if (detail.module === 'inventory' && detail.tab) {
        setActiveTab(detail.tab);
      }
    };
    window.addEventListener('navigateToModule', handler as EventListener);
    return () => window.removeEventListener('navigateToModule', handler as EventListener);
  }, []);

  const renderTab = () => {
    switch (activeTab) {
      case 'items':     return <ItemMaster      data={data} />;
      case 'suppliers': return <Suppliers       data={data} />;
      case 'grn':       return <GRNModule       data={data} />;
      case 'transfer':  return <StockTransfer   data={data} />;
      case 'recipes':   return <RecipeBuilder   data={data} />;
      case 'reports':   return <StockReports      data={data} />;
      case 'locations': return <LocationsManager data={data} />;
      case 'uom':       return <UOMManager      data={data} />;
      case 'stock-take': return <StockTake />;
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b shadow-sm px-6 py-3">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Inventory Control</h2>
            <p className="text-xs text-gray-500">Back-office hub for POS stock, costing and reporting</p>
          </div>
          {data.loading && <span className="text-xs text-gray-400 animate-pulse">Loading…</span>}
        </div>
        {/* Tab bar */}
        <div className="flex gap-1 overflow-x-auto">
          {TABS.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-t-lg text-sm font-semibold whitespace-nowrap transition-all border-b-2 ${
                activeTab === tab.id
                  ? 'bg-indigo-600 text-white border-indigo-600 shadow'
                  : 'text-gray-500 border-transparent hover:text-gray-700 hover:bg-gray-100'
              }`}>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-6">
        {renderTab()}
      </div>
    </div>
  );
};

export default InventoryHub;
