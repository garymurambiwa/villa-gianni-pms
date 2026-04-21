import React from 'react';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { canManagePOS } from '@/lib/permissions';
import { createAuditEntry, formatCurrency } from '@/lib/posIntegration';
import menuCats from '@/lib/menuCategories';
import cocktailEng from '@/lib/cocktailEngineering';
import { useToast } from '@/hooks/use-toast';
import { readPrinterConfig } from '@/lib/printerConfig';
import PrintCustomizationModal from '@/components/modules/PrintCustomizationModal';
import { readReceiptBranding } from '@/lib/printSettings';

type DateRange = { start: string; end: string };

const readJSON = (key: string, fallback: any = []) => {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
};

const cacheSet = (key: string, value: any) => {
  try { localStorage.setItem(key, JSON.stringify({ value, ts: Date.now() })); } catch {}
};

const exportCSV = (filename: string, headers: string[], rows: string[][]) => {
  const csv = [headers.join(','), ...rows.map(r => r.map(v => '"' + String(v).replace(/"/g,'""') + '"').join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
};

const openPrintable = (title: string, html: string) => {
  const win = window.open('', '_blank');
  if (!win) return;
  const brand = readReceiptBranding();
  const header = `
    ${brand.show_logo && brand.logo_url ? `<div style="text-align:center"><img src="${brand.logo_url}" alt="Logo" style="max-width:120px"/></div>` : ''}
    <div style="text-align:center;font-weight:bold">${brand.restaurant_name}</div>
  `;
  const footer = `<div style="text-align:center;margin-top:12px;font-size:11px;color:#555">Powered By Coredigita</div>`;
  win.document.write(`<html><head><title>${title}</title><style>body{font-family:system-ui,sans-serif;padding:16px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:6px;text-align:left}.right{text-align:right}</style></head><body>${header}${html}${footer}</body></html>`);
  win.document.close();
  try { win.focus(); win.print(); } catch {}
};

const loadXLSX = async (): Promise<any|null> => {
  try {
    const w = window as any;
    if (w.XLSX) return w.XLSX;
    await new Promise<void>((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('XLSX load failed'));
      document.head.appendChild(s);
    });
    return (window as any).XLSX || null;
  } catch { return null; }
};

const formatDetailsText = (d: any): string => {
  if (!d) return '';
  if (typeof d === 'string') {
    try {
      const obj = JSON.parse(d);
      if (obj && typeof obj === 'object') return Object.entries(obj).map(([k, v]) => `${k}: ${String(v)}`).join(', ');
    } catch { }
    return d;
  }
  if (typeof d === 'object') {
    try { return Object.entries(d).map(([k, v]) => `${k}: ${String(v)}`).join(', '); } catch { return JSON.stringify(d); }
  }
  return String(d);
};

// Sub-components for specific reports
const VoidsReportView: React.FC<{ auditLog: any[]; itemIndexByName: Map<string, any>; rangeText: string }> = ({ auditLog, itemIndexByName, rangeText }) => {
  const [voidsFilter, setVoidsFilter] = React.useState<'all'|'kitchen'|'cellar'>('all');
  const voidsEnriched = React.useMemo(() => {
    return auditLog.filter((a: any) => String(a.action || '').includes('VOID')).map((a: any) => {
      let d = a.details;
      if (typeof d === 'string') { try { d = JSON.parse(d); } catch {} }
      let nameCandidate = '';
      if (typeof d === 'string') nameCandidate = d;
      else if (d && typeof d === 'object') nameCandidate = String(d.name || d.item || d.menuItem || d.desc || '');
      const item = itemIndexByName.get(nameCandidate.toLowerCase());
      const invCat = item ? (item.costCenter === 'bar' ? 'cellar' : 'kitchen') : '';
      return { ...a, invCat };
    });
  }, [auditLog, itemIndexByName]);

  const filtered = voidsEnriched.filter(v => voidsFilter === 'all' || v.invCat === voidsFilter);

  return (
    <div className="mb-6">
      <h3 className="text-lg font-semibold mb-2">Voids Report</h3>
      <div className="flex gap-2 mb-3">
        <Button variant={voidsFilter==='all'?'secondary':'outline'} onClick={()=>setVoidsFilter('all')}>All</Button>
        <Button variant={voidsFilter==='kitchen'?'secondary':'outline'} onClick={()=>setVoidsFilter('kitchen')}>Kitchen</Button>
        <Button variant={voidsFilter==='cellar'?'secondary':'outline'} onClick={()=>setVoidsFilter('cellar')}>Cellar</Button>
      </div>
      <div className="overflow-x-auto">
        <table className="ds-table">
          <thead><tr><th className="p-2 text-left">Time</th><th className="p-2">Action</th><th className="p-2">Details</th></tr></thead>
          <tbody>
            {filtered.map((v, i) => (<tr key={i}><td className="p-2">{v.timestamp}</td><td className="p-2">{v.action}</td><td className="p-2">{formatDetailsText(v.details)}</td></tr>))}
            {!filtered.length && (<tr><td className="p-2 text-center" colSpan={3}>No voids found.</td></tr>)}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const StockMovementReportView: React.FC<{ auditLog: any[]; itemIndexByName: Map<string, any>; rangeText: string }> = ({ auditLog, itemIndexByName, rangeText }) => {
  const movement = auditLog.filter(a => a.action === 'STOCK_ADJUST' || a.action === 'INVENTORY_DEPLETION');
  return (
    <div className="mb-6">
      <h3 className="text-lg font-semibold mb-2">Stock Movement</h3>
      <div className="overflow-x-auto">
        <table className="ds-table">
          <thead><tr><th className="p-2 text-left">Time</th><th className="p-2">Type</th><th className="p-2">Details</th></tr></thead>
          <tbody>
            {movement.map((m, i) => (<tr key={i}><td className="p-2">{m.timestamp}</td><td className="p-2">{m.action}</td><td className="p-2">{formatDetailsText(m.details)}</td></tr>))}
            {!movement.length && (<tr><td className="p-2 text-center" colSpan={3}>No movements in range.</td></tr>)}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const GoodsReceivedReportView: React.FC<{ rangeText: string; inRange: (ts: string) => boolean }> = ({ rangeText, inRange }) => {
  const goodsReceived = React.useMemo(() => readJSON('corepms_goods_received', []), []);
  const goodsReceivedInRange = React.useMemo(() => goodsReceived.filter((v: any) => inRange(v.dateReceived)), [goodsReceived, inRange]);
  const [grvSupplier, setGrvSupplier] = React.useState<string>('all');
  const [grvLocation, setGrvLocation] = React.useState<'all' | 'Kitchen' | 'Cellar'>('all');

  const grvSuppliers = React.useMemo(() => {
    const set = new Set<string>();
    goodsReceived.forEach((v: any) => { if (v.supplier) set.add(String(v.supplier)); });
    return ['all', ...Array.from(set)];
  }, [goodsReceived]);

  const grvFiltered = React.useMemo(() =>
    goodsReceivedInRange.filter((v: any) =>
      (grvSupplier === 'all' || String(v.supplier) === grvSupplier) &&
      (grvLocation === 'all' || String(v.location) === grvLocation)
    ),
    [goodsReceivedInRange, grvSupplier, grvLocation]
  );

  const grvRows = React.useMemo(() =>
    grvFiltered.flatMap((v: any) =>
      (v.items || []).map((it: any) => ({
        id: v.id, date: v.dateReceived, supplier: v.supplier, location: v.location, itemId: it.itemId, qty: Number(it.qty || 0), totalCost: Number(it.totalCost || 0)
      }))
    ),
    [grvFiltered]
  );

  const grvTotals = React.useMemo(() => ({
    qty: grvRows.reduce((s, r) => s + r.qty, 0),
    cost: grvRows.reduce((s, r) => s + r.totalCost, 0)
  }), [grvRows]);

  return (
    <div className="mb-6">
      <h3 className="text-lg font-semibold mb-2">Goods Received Vouchers</h3>
      <div className="flex items-center gap-2 mb-3">
        <label className="text-xs">Supplier</label>
        <Select value={grvSupplier} onValueChange={setGrvSupplier}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>{grvSuppliers.map(s => (<SelectItem key={s} value={s}>{s}</SelectItem>))}</SelectContent>
        </Select>
        <label className="text-xs">Location</label>
        <Select value={grvLocation} onValueChange={(v) => setGrvLocation(v as any)}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All</SelectItem><SelectItem value="Kitchen">Kitchen</SelectItem><SelectItem value="Cellar">Cellar</SelectItem></SelectContent>
        </Select>
        <Button variant="outline" onClick={() => exportCSV(`grv_${rangeText}.csv`, ['ID','Date','Supplier','Location','Item','Qty','Cost'], grvRows.map(r=>[r.id,r.date,String(r.supplier),String(r.location),r.itemId,String(r.qty),r.totalCost.toFixed(2)]))}>CSV</Button>
      </div>
      <div className="grid grid-cols-2 gap-4 mb-3">
        <div className="border rounded p-2">Total Qty: {grvTotals.qty}</div>
        <div className="border rounded p-2">Total Cost: {formatCurrency(Number.isNaN(Number(grvTotals.cost)) ? 0 : Number(grvTotals.cost))}</div>
      </div>
      <div className="overflow-x-auto">
        <table className="ds-table">
          <thead><tr><th className="p-2 text-left">Voucher</th><th className="p-2">Date</th><th className="p-2 text-right">Qty</th><th className="p-2 text-right">Cost</th></tr></thead>
          <tbody>
             {grvRows.map((r, i) => (<tr key={i}><td className="p-2">{r.id}</td><td className="p-2">{r.date}</td><td className="p-2 text-right">{r.qty}</td><td className="p-2 text-right">{formatCurrency(Number.isNaN(Number(r.totalCost)) ? 0 : Number(r.totalCost))}</td></tr>))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export const PosReports: React.FC = () => {
  const { user } = useAuth();
  const isManager = canManagePOS(user?.role);
  const { toast } = useToast();
  const [loading, setLoading] = React.useState<boolean>(true);
  const [error, setError] = React.useState<string>('');
  const [reportType, setReportType] = React.useState<'individual'|'consolidated'|'custom'>('individual');
  const [preset, setPreset] = React.useState<'none'|'today'|'this-week'|'this-month'>('none');
  const [selectedCentres, setSelectedCentres] = React.useState<string[]>(['bar']);
  const [selectedReport, setSelectedReport] = React.useState<string>('x-summary');
  const [selectedShift, setSelectedShift] = React.useState<string>('all');
  const [range, setRange] = React.useState<DateRange>(() => ({
    start: new Date().toISOString().slice(0, 10),
    end: new Date().toISOString().slice(0, 10)
  }));
  const [cocktailUsageData, setCocktailUsageData] = React.useState<{ usageRows: any[]; totalIngredients: number }>({ usageRows: [], totalIngredients: 0 });

  const items = React.useMemo(() => readJSON('corepms_pos_items', []), []);
  const auditLog = React.useMemo(() => readJSON('corepms_pos_audit', []), []);

  const inRange = React.useCallback((ts: string) => {
    const s = new Date(range.start + 'T00:00:00'); const e = new Date(range.end + 'T23:59:59');
    const d = new Date(ts); return d >= s && d <= e;
  }, [range]);

  const depletionEntries = React.useMemo(() => {
    return auditLog.filter((a: any) => {
      if (a.action !== 'INVENTORY_DEPLETION' || !inRange(a.timestamp)) return false;
      if (selectedCentres.length > 0 && a.cost_center && !selectedCentres.includes(a.cost_center)) return false;
      if (selectedShift !== 'all' && a.shift_id && a.shift_id !== selectedShift) return false;
      return true;
    });
  }, [auditLog, inRange, selectedCentres, selectedShift]);

  const itemIndexByName = React.useMemo(() => {
    const map = new Map<string, any>();
    items.forEach((it: any) => map.set(String(it.name || '').toLowerCase(), it));
    return map;
  }, [items]);

       const categorySummary = React.useMemo(() => {
        const map = new Map<string, { itemsSold: number; grossSales: number; discounts: number; netSales: number }>();
        depletionEntries.forEach((e: any) => {
          let details = e.details;
          if (typeof details === 'string') { try { details = JSON.parse(details); } catch { details = []; } }
          (Array.isArray(details) ? details : []).forEach((d: any) => {
            const it = itemIndexByName.get(String(d.name || '').toLowerCase());
            // Handle missing items gracefully
            const catName = it ? (menuCats.getCategoryById(it.category_id)?.category_name || 'Uncategorized') : 'Uncategorized';
            const qty = Number(d.quantity || 0);
            // Use 0 for missing items to avoid NaN, but log for debugging
            const price = it ? Number(it?.sellingPrice || 0) : 0;
            if (!it) {
              console.warn(`PosReports: Item not found in index: "${String(d.name || '').toLowerCase()}"`);
            }
            const row = map.get(catName) || { itemsSold: 0, grossSales: 0, discounts: 0, netSales: 0 };
            row.itemsSold += qty; 
            row.grossSales += qty * price; 
            row.netSales = row.grossSales - row.discounts;
            map.set(catName, row);
          });
        });
        const totalGross = Array.from(map.values()).reduce((s, r) => s + r.grossSales, 0);
        return { rows: Array.from(map.entries()).map(([name, r]) => ({ name, ...r, percent: totalGross ? (r.grossSales / totalGross) * 100 : 0 })), totalGross };
      }, [depletionEntries, itemIndexByName]);

       const detailedRowsByCategory = React.useMemo(() => {
        const groups = new Map<string, any[]>();
        depletionEntries.forEach((e: any) => {
          let details = e.details;
          if (typeof details === 'string') { try { details = JSON.parse(details); } catch { details = []; } }
          (Array.isArray(details) ? details : []).forEach((d: any) => {
            const it = itemIndexByName.get(String(d.name || '').toLowerCase());
            // Handle missing items gracefully
            const catName = it ? (menuCats.getCategoryById(it.category_id)?.category_name || 'Uncategorized') : 'Uncategorized';
            const qty = Number(d.quantity || 0);
            // Use 0 for missing items to avoid NaN, but log for debugging
            const unit = it ? Number(it?.sellingPrice || 0) : 0;
            if (!it) {
              console.warn(`PosReports: Item not found in index for detailed view: "${String(d.name || '').toLowerCase()}"`);
            }
            const arr = groups.get(catName) || [];
            arr.push({ ts: e.timestamp, sku: it?.id || '', desc: it?.name || d.name, qty, unit, total: qty * unit });
            groups.set(catName, arr);
          });
        });
        return groups;
      }, [depletionEntries, itemIndexByName]);

  React.useEffect(() => {
    const fetchUsage = async () => {
      try {
        const u = await cocktailEng.listUsageInRange(range.start, range.end) || [];
        const ingredients = await cocktailEng.listIngredients() || [];
        const ingMap = new Map(); ingredients.forEach(i => ingMap.set(i.id, i));
        const usageMap = new Map();
        u.forEach((e:any) => {
          (e.ingredients || []).forEach((ri:any) => {
            const ing = ingMap.get(ri.ingredientId); if (!ing) return;
            const used = Number(ri.qty || 0) * Number(e.count || 1);
            const cur = usageMap.get(ri.ingredientId) || { name: ing.name, unit: ing.unit, used: 0 };
            cur.used += used; usageMap.set(ri.ingredientId, cur);
          });
        });
        setCocktailUsageData({ usageRows: Array.from(usageMap.values()), totalIngredients: usageMap.size });
      } catch { }
    };
    fetchUsage();
    setLoading(false);
  }, [range]);

  const availableShifts = React.useMemo(() => Array.from(new Set(auditLog.map((a:any)=>a.shift_id).filter(Boolean))).sort().reverse(), [auditLog]);
  const centreOptions = React.useMemo(() => Array.from(new Set(items.map((it:any)=>it.costCenter).filter(Boolean))), [items]);

  if (!isManager) return <div className="p-6 text-center">Manager Access Required</div>;
  if (loading) return <div className="p-6">Loading...</div>;

  return (
    <div className="ds-card p-4">
      <div className="flex flex-wrap gap-4 mb-6 items-end">
        <div><label className="text-xs block">Report</label>
          <Select value={selectedReport} onValueChange={setSelectedReport}>
            <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="x-summary">X-Reading Summary</SelectItem>
              <SelectItem value="x-detail">X-Reading Detail</SelectItem>
              <SelectItem value="cocktail-usage">Cocktail Usage</SelectItem>
              <SelectItem value="goods-received">Goods Received</SelectItem>
              <SelectItem value="voids">Voids</SelectItem>
              <SelectItem value="stock-movement">Movement</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div><label className="text-xs block">Start</label><Input type="date" value={range.start} onChange={e=>setRange(r=>({...r, start:e.target.value}))} /></div>
        <div><label className="text-xs block">End</label><Input type="date" value={range.end} onChange={e=>setRange(r=>({...r, end:e.target.value}))} /></div>
        <div><label className="text-xs block">Shift</label>
          <Select value={selectedShift} onValueChange={setSelectedShift}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All</SelectItem>{availableShifts.map((s: any) => (<SelectItem key={String(s)} value={String(s)}>{String(s)}</SelectItem>))}</SelectContent>
          </Select>
        </div>
      </div>

      {selectedReport === 'x-summary' && (
        <div>
          <h3 className="font-bold mb-2">Category Summary</h3>
          <table className="ds-table">
            <thead><tr><th>Category</th><th className="right">Sold</th><th className="right">Gross</th><th className="right">Percent</th></tr></thead>
            <tbody>
              {categorySummary.rows.map(r => (<tr key={r.name}><td>{r.name}</td><td className="right">{r.itemsSold}</td><td className="right">{formatCurrency(r.grossSales)}</td><td className="right">{r.percent.toFixed(2)}%</td></tr>))}
            </tbody>
          </table>
        </div>
      )}

      {selectedReport === 'x-detail' && (
        <div>
          <h3 className="font-bold mb-2">Detailed Sales</h3>
          {Array.from(detailedRowsByCategory.entries()).map(([cat, rows]) => (
            <div key={cat} className="mb-4">
              <div className="font-semibold bg-gray-50 p-1">{cat}</div>
              <table className="ds-table">
                <tbody>
                  {rows.map((r, i) => (<tr key={i}><td className="text-xs">{r.ts.slice(11,16)}</td><td>{r.desc}</td><td className="right">{r.qty}</td><td className="right">{formatCurrency(r.total)}</td></tr>))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {selectedReport === 'cocktail-usage' && (
        <table className="ds-table">
          <thead><tr><th>Ingredient</th><th>Unit</th><th className="right">Used</th></tr></thead>
          <tbody>{cocktailUsageData.usageRows.map((r, i) => (<tr key={i}><td>{r.name}</td><td>{r.unit}</td><td className="right">{r.used.toFixed(2)}</td></tr>))}</tbody>
        </table>
      )}

      {selectedReport === 'goods-received' && <GoodsReceivedReportView rangeText={`${range.start} to ${range.end}`} inRange={inRange} />}
      {selectedReport === 'voids' && <VoidsReportView auditLog={auditLog} itemIndexByName={itemIndexByName} rangeText="" />}
      {selectedReport === 'stock-movement' && <StockMovementReportView auditLog={auditLog} itemIndexByName={itemIndexByName} rangeText="" />}
    </div>
  );
};

export default PosReports;
