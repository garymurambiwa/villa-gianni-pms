/**
 * InventoryHub — unified back-office hub for POS inventory management.
 * Tabs: Items · Suppliers · GRN · Transfer · Recipes · Reports
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';

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
      apiGet('/items?limit=500'),
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
  const [search, setSearch] = useState('');
  const [editItem, setEditItem] = useState<any | null>(null);
  const [form, setForm] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const imgRef = useRef<HTMLInputElement>(null);

  const filtered = items.filter(i =>
    !search || i.name.toLowerCase().includes(search.toLowerCase()) ||
    (i.sku||'').toLowerCase().includes(search.toLowerCase()) ||
    (i.short_id||'').toLowerCase().includes(search.toLowerCase()) ||
    (i.id||'').toLowerCase().includes(search.toLowerCase())
  );

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
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <Input placeholder="Search by ID, short ID, name, or SKU…" value={search} onChange={e => setSearch(e.target.value)} className="max-w-xs" />
        <span className="text-sm text-gray-500">{filtered.length} items</span>
        <div className="ml-auto flex gap-2">
          <Button onClick={openNew} className="bg-indigo-600 text-white hover:bg-indigo-700">＋ New Item</Button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto rounded-lg border border-gray-200">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              {['ID','SKU','Name','Category','Base UOM','Cost Price','Avg Cost','Location','Expiry','Actions'].map(h => (
                <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.length === 0 && (
              <tr><td colSpan={10} className="text-center py-12 text-gray-400">No items found</td></tr>
            )}
            {filtered.map((item: any) => (
              <tr key={item.id} className="hover:bg-gray-50">
                <td className="px-3 py-2 font-mono text-xs text-gray-500">{item.short_id || item.id}</td>
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
                <td className="px-3 py-2">
                  <Button variant="outline" size="sm" onClick={() => openEdit(item)}>Edit</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
  const [supplier, setSupplier] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [invoiceNum, setInvoiceNum] = useState('');
  const [destLocation, setDestLocation] = useState('loc_main_cellar');
  const [lines, setLines] = useState<any[]>([{ item_id:'', item_name:'', qty:1, uom:'uom_unit', unit_cost:0, expiry_date:'' }]);
  const [saving, setSaving] = useState(false);
  const [itemSearch, setItemSearch] = useState<Record<number,string>>({});

  useEffect(() => {
    apiGet('/grn?limit=30').then(r => { if (r.ok) setGrns(r.data); });
  }, []);

  const storageLocations = locations.filter((l:any) => l.location_type === 'Storage');

  const addLine = () => setLines(l => [...l, { item_id:'', item_name:'', qty:1, uom:'uom_unit', unit_cost:0, expiry_date:'' }]);
  const removeLine = (i: number) => setLines(l => l.filter((_,idx) => idx !== i));
  const updateLine = (i: number, field: string, val: any) => setLines(l => l.map((ln,idx) => idx===i ? {...ln,[field]:val} : ln));

  const selectItem = (lineIdx: number, item: any) => {
    updateLine(lineIdx, 'item_id', item.id);
    updateLine(lineIdx, 'item_name', item.name);
    updateLine(lineIdx, 'uom', item.base_uom_id || 'uom_unit');
    updateLine(lineIdx, 'unit_cost', Number(item.last_cost_price || 0));
    setItemSearch(s => ({ ...s, [lineIdx]: '' }));
  };

  const total = lines.reduce((s, l) => s + (Number(l.qty||0) * Number(l.unit_cost||0)), 0);

  const submit = async () => {
    if (!supplier) { toast({ title: 'Supplier required', variant:'destructive' }); return; }
    if (!lines.some(l => l.item_id)) { toast({ title: 'At least one item required', variant:'destructive' }); return; }
    setSaving(true);
    const payload = {
      supplier_name: supplier,
      supplier_id: supplierId || undefined,
      supplier_invoice_number: invoiceNum || undefined,
      destination_location_id: destLocation,
      created_by: user?.id || 'system',
      lines: lines.filter(l => l.item_id).map(l => ({
        item_id:       l.item_id,
        qty_received:  Number(l.qty),
        received_uom_id: l.uom,
        unit_cost:     Number(l.unit_cost),
        expiry_date:   l.expiry_date || undefined,
      }))
    };
    const r = await apiPost('/grn', payload);
    if (r.ok) {
      // Auto-post
      await apiPost(`/grn/${r.data.id}/post`, { posted_by: user?.id || 'system' });
      toast({ title: `GRN ${r.data.grn_number} posted successfully` });
      setShowForm(false);
      setLines([{ item_id:'', item_name:'', qty:1, uom:'uom_unit', unit_cost:0, expiry_date:'' }]);
      setSupplier(''); setSupplierId(''); setInvoiceNum('');
      apiGet('/grn?limit=30').then(res => { if (res.ok) setGrns(res.data); });
    } else {
      toast({ title: 'GRN failed', description: r.error, variant:'destructive' });
    }
    setSaving(false);
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-bold text-gray-700">Goods Received Notes</h3>
        <Button onClick={() => setShowForm(true)} className="bg-green-700 text-white hover:bg-green-800">＋ New GRN</Button>
      </div>

      {/* GRN history */}
      <div className="flex-1 overflow-auto rounded-lg border border-gray-200">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              {['GRN #','Supplier','Invoice #','Destination','Total','Status','Date'].map(h => (
                <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {grns.length === 0 && <tr><td colSpan={7} className="text-center py-10 text-gray-400">No GRNs yet</td></tr>}
            {grns.map((g:any) => (
              <tr key={g.id} className="hover:bg-gray-50">
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* GRN Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 backdrop-blur-sm overflow-y-auto pt-8 pb-8">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-bold">New Goods Received Note</h3>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-700 text-xl">✕</button>
            </div>

            {/* Header */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
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

            {/* Lines */}
            <div className="overflow-x-auto rounded-lg border border-gray-200 mb-4">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    {['Item (SKU or name)','Qty Received','UOM','Unit Cost','Line Total','Expiry Date',''].map(h => (
                      <th key={h} className="px-2 py-2 text-left text-xs font-semibold text-gray-600">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, i) => {
                    const searchVal = itemSearch[i] ?? line.item_name;
                    const suggestions = searchVal.length >= 2
                      ? items.filter((it:any) =>
                          it.name.toLowerCase().includes(searchVal.toLowerCase()) ||
                          (it.sku||'').toLowerCase().includes(searchVal.toLowerCase()) ||
                          (it.id||'').toLowerCase().includes(searchVal.toLowerCase())
                        ).slice(0, 8)
                      : [];
                    return (
                      <tr key={i} className="border-t border-gray-100">
                        <td className="px-2 py-1 relative min-w-[220px]">
                          <Input
                            value={searchVal}
                            placeholder="Type name or SKU…"
                            onChange={e => {
                              setItemSearch(s => ({ ...s, [i]: e.target.value }));
                              if (!e.target.value) updateLine(i, 'item_id', '');
                            }}
                            className="text-sm"
                          />
                          {suggestions.length > 0 && (
                            <div className="absolute z-30 left-2 top-full bg-white border rounded-lg shadow-lg w-64 max-h-40 overflow-y-auto">
                              {suggestions.map((it:any) => (
                                <div key={it.id} onClick={() => selectItem(i, it)}
                                  className="px-3 py-1.5 hover:bg-indigo-50 cursor-pointer text-xs">
                                  <span className="font-mono text-purple-600">{it.sku || it.id}</span>
                                  <span className="ml-2">{it.name}</span>
                                  <span className="ml-auto text-gray-400 float-right">{it.id} · {fmt(it.last_cost_price)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                          {!line.item_id && searchVal.length > 0 && suggestions.length === 0 && (
                            <p className="text-xs text-red-500 mt-0.5">Item not in stock master — create it first</p>
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
                        <td className="px-2 py-1 w-24 text-right font-medium">
                          {fmt(Number(line.qty||0) * Number(line.unit_cost||0))}
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

            <div className="flex items-center justify-between">
              <Button variant="outline" onClick={addLine}>＋ Add Line</Button>
              <div className="text-right">
                <div className="text-sm text-gray-500">GRN Total</div>
                <div className="text-2xl font-bold text-indigo-700">{fmt(total)}</div>
              </div>
            </div>

            <div className="flex gap-3 mt-5 justify-end">
              <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
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
  const [srcLoc, setSrcLoc] = useState('loc_main_cellar');
  const [dstLoc, setDstLoc] = useState('loc_bar1');
  const [reqRef, setReqRef] = useState('');
  const [tLines, setTLines] = useState<any[]>([{ item_id:'', item_name:'', qty:1, uom:'uom_unit' }]);
  const [saving, setSaving] = useState(false);
  const [balances, setBalances] = useState<any[]>([]);
  const [itemSearch, setItemSearch] = useState<Record<number,string>>({});

  useEffect(() => {
    apiGet('/transfer?limit=30').then(r => { if (r.ok) setTransfers(r.data); });
  }, []);

  useEffect(() => {
    if (srcLoc) apiGet(`/balance/${srcLoc}`).then(r => { if (r.ok) setBalances(r.data || []); });
  }, [srcLoc]);

  const addTLine = () => setTLines(l => [...l, { item_id:'', item_name:'', qty:1, uom:'uom_unit' }]);
  const removeTLine = (i: number) => setTLines(l => l.filter((_,idx) => idx !== i));
  const updateTLine = (i: number, field: string, val: any) => setTLines(l => l.map((ln,idx) => idx===i ? {...ln,[field]:val} : ln));

  const selectTransferItem = (lineIdx: number, item: any) => {
    const bal = balances.find((b:any) => b.item_id === item.id);
    updateTLine(lineIdx, 'item_id', item.id);
    updateTLine(lineIdx, 'item_name', item.name);
    updateTLine(lineIdx, 'uom', item.base_uom_id || 'uom_unit');
    updateTLine(lineIdx, 'balance', bal ? Number(bal.current_balance || 0) : 0);
    setItemSearch(s => ({ ...s, [lineIdx]: '' }));
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
        source_uom_id: l.uom, breakdown_flag: false
      }))
    });
    if (r.ok) {
      // Auto-approve
      await apiPost(`/transfer/${r.data.id}/approve`, { approved_by: user?.id || 'system' });
      toast({ title: `Transfer posted — ${r.data.transfer_number}` });
      setShowForm(false);
      setTLines([{ item_id:'', item_name:'', qty:1, uom:'uom_unit' }]);
      setReqRef('');
      apiGet('/transfer?limit=30').then(res => { if (res.ok) setTransfers(res.data); });
    } else {
      toast({ title: 'Transfer failed', description: r.error, variant:'destructive' });
    }
    setSaving(false);
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-bold text-gray-700">Stock Transfers</h3>
        <Button onClick={() => setShowForm(true)} className="bg-amber-600 text-white hover:bg-amber-700">＋ New Transfer</Button>
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
            {transfers.length === 0 && <tr><td colSpan={6} className="text-center py-10 text-gray-400">No transfers yet</td></tr>}
            {transfers.map((t:any) => (
              <tr key={t.id} className="hover:bg-gray-50">
                <td className="px-3 py-2 font-mono font-bold text-amber-700">{t.transfer_number}</td>
                <td className="px-3 py-2">{locations.find((l:any) => l.id === t.source_location_id)?.name || t.source_location_id}</td>
                <td className="px-3 py-2">{locations.find((l:any) => l.id === t.destination_location_id)?.name || t.destination_location_id}</td>
                <td className="px-3 py-2 text-gray-500">{t.reference_note || '—'}</td>
                <td className="px-3 py-2">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${t.status==='approved'?'bg-green-100 text-green-700':'bg-yellow-100 text-yellow-700'}`}>
                    {t.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-gray-500 text-xs">{new Date(t.inserted_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 backdrop-blur-sm overflow-y-auto pt-8 pb-8">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-bold">New Stock Transfer</h3>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-700 text-xl">✕</button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-5">
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
            </div>

            <div className="overflow-x-auto rounded-lg border border-gray-200 mb-4">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    {['Item','On Hand','Qty to Transfer','UOM',''].map(h => (
                      <th key={h} className="px-2 py-2 text-left text-xs font-semibold text-gray-600">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tLines.map((line, i) => {
                    const searchVal = itemSearch[i] ?? line.item_name;
                    const suggestions = searchVal.length >= 2
                      ? items.filter((it:any) =>
                          it.name.toLowerCase().includes(searchVal.toLowerCase()) ||
                          (it.sku||'').toLowerCase().includes(searchVal.toLowerCase()) ||
                          (it.id||'').toLowerCase().includes(searchVal.toLowerCase())
                        ).slice(0, 8)
                      : [];
                    const onHand = line.balance ?? 0;
                    const overQty = Number(line.qty) > onHand;
                    return (
                      <tr key={i} className="border-t border-gray-100">
                        <td className="px-2 py-1 relative min-w-[200px]">
                          <Input value={searchVal} placeholder="Search item…"
                            onChange={e => { setItemSearch(s => ({...s,[i]:e.target.value})); if (!e.target.value) updateTLine(i,'item_id',''); }}
                            className="text-sm" />
                          {suggestions.length > 0 && (
                            <div className="absolute z-30 left-2 top-full bg-white border rounded-lg shadow-lg w-64 max-h-40 overflow-y-auto">
                              {suggestions.map((it:any) => (
                                <div key={it.id} onClick={() => selectTransferItem(i, it)}
                                  className="px-3 py-1.5 hover:bg-amber-50 cursor-pointer text-xs">
                                  <span className="font-mono text-purple-600">{it.sku || it.id}</span>
                                  <span className="ml-2">{it.name}</span>
                                  <span className="ml-auto text-gray-400 float-right">{it.id}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-1 w-24 text-center">
                          <span className={`font-bold ${onHand <= 0 ? 'text-red-500' : 'text-green-700'}`}>
                            {fmtQ(onHand)}
                          </span>
                        </td>
                        <td className="px-2 py-1 w-24">
                          <Input type="number" min={0} step="0.001" value={line.qty}
                            onChange={e => updateTLine(i, 'qty', e.target.value)}
                            className={`text-sm text-center ${overQty ? 'border-red-400' : ''}`} />
                          {overQty && <p className="text-xs text-red-500">Exceeds balance</p>}
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
      body: JSON.stringify({ sql: `SELECT id, name, price, department FROM products WHERE active=true ORDER BY department, name LIMIT 300` })
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
                            className="px-3 py-1.5 hover:bg-indigo-50 cursor-pointer text-xs flex justify-between">
                            <span>{it.name}</span>
                            <span className="text-gray-500 text-xs">{it.id}</span>
                            <span className="text-indigo-600">{fmt(it.weighted_avg_cost)}/{it.base_uom_code}</span>
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
  const [location, setLocation] = useState('loc_main_cellar');
  const [dateFrom, setDateFrom] = useState(new Date(Date.now()-30*86400000).toISOString().slice(0,10));
  const [dateTo, setDateTo] = useState(new Date().toISOString().slice(0,10));
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<'all'|'warning'|'critical'>('all');
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
] as const;
type TabId = typeof TABS[number]['id'];

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
      case 'reports':   return <VarianceReports data={data} />;
      case 'locations': return <LocationsManager data={data} />;
      case 'uom':       return <UOMManager      data={data} />;
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
