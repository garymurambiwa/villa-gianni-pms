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
const cacheGet = (key: string, maxAgeMs: number) => {
  try { const raw = localStorage.getItem(key); if (!raw) return null; const obj = JSON.parse(raw); return (Date.now() - obj.ts) <= maxAgeMs ? obj.value : null; } catch { return null; }
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
  win.document.write(`<html><head><title>${title}</title><style>body{font-family:system-ui,sans-serif;padding:16px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:6px;text-align:left}</style></head><body>${header}${html}${footer}</body></html>`);
  win.document.close();
  try { win.focus(); win.print(); } catch {}
};

// Module-level XLSX loader (CDN) for use across report views
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

// Dedicated Voids report view
const VoidsReportView: React.FC<{ auditLog: any[]; itemIndexByName: Map<string, any>; rangeText: string }>
= ({ auditLog, itemIndexByName, rangeText }) => {
  const [voidsFilter, setVoidsFilter] = React.useState<'all'|'kitchen'|'cellar'>('all');
  const voids = auditLog.filter((a: any) => String(a.action || '').includes('VOID'));
  const voidsEnriched = React.useMemo(() => {
    const tryParse = (s: any) => { if (typeof s !== 'string') return s; try { return JSON.parse(s); } catch { return s; } };
    return voids.map((a: any) => {
      const d = tryParse(a.details);
      let nameCandidate = '';
      if (typeof d === 'string') nameCandidate = d;
      else if (d && typeof d === 'object') nameCandidate = String(d.name || d.item || d.menuItem || d.desc || '');
      const key = String(nameCandidate || '').toLowerCase();
      const it = itemIndexByName.get(key);
      const invCat = it
        ? (String(it.inventoryCategory||'').toLowerCase() === 'cellar' ? 'cellar'
          : String(it.inventoryCategory||'').toLowerCase() === 'kitchen' ? 'kitchen'
          : it.costCenter === 'bar' ? 'cellar' : it.costCenter === 'restaurant' ? 'kitchen' : '')
        : '';
      return { ...a, invCat };
    });
  }, [voids, itemIndexByName]);
  const voidsByInvCat = React.useMemo(() => {
    const counts: Record<string, number> = { kitchen: 0, cellar: 0 };
    voidsEnriched.forEach(v => { if (v.invCat === 'kitchen') counts.kitchen++; else if (v.invCat === 'cellar') counts.cellar++; });
    return counts;
  }, [voidsEnriched]);
  return (
    <div className="mb-6">
      <h3 className="text-lg font-semibold mb-2">Voids</h3>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs">Filter:</span>
        <Button variant={voidsFilter==='all'?'secondary':'outline'} onClick={()=>setVoidsFilter('all')}>All</Button>
        <Button variant={voidsFilter==='kitchen'?'secondary':'outline'} onClick={()=>setVoidsFilter('kitchen')}>Kitchen</Button>
        <Button variant={voidsFilter==='cellar'?'secondary':'outline'} onClick={()=>setVoidsFilter('cellar')}>Cellar</Button>
        <span className="text-xs text-gray-600 ml-2">Kitchen: {voidsByInvCat.kitchen} · Cellar: {voidsByInvCat.cellar}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="ds-table">
          <thead><tr><th className="p-2 text-left">Action</th><th className="p-2">Entity</th><th className="p-2">Inventory Category</th><th className="p-2">Timestamp</th><th className="p-2">Details</th></tr></thead>
          <tbody>
            {voidsEnriched
              .filter((a:any)=> voidsFilter==='all' ? true : a.invCat === voidsFilter)
              .map((a:any, idx:number) => (<tr key={idx}><td className="p-2">{a.action}</td><td className="p-2">{a.entity||a.entityType}</td><td className="p-2 capitalize">{a.invCat || '—'}</td><td className="p-2">{a.timestamp}</td><td className="p-2">{formatDetailsText(a.details)}</td></tr>))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// Dedicated Stock Movement report view
const StockMovementReportView: React.FC<{ auditLog: any[]; itemIndexByName: Map<string, any>; rangeText: string }>
= ({ auditLog, itemIndexByName }) => {
  const [movementsFilter, setMovementsFilter] = React.useState<'all'|'kitchen'|'cellar'>('all');
  const movements = auditLog.filter((a: any) => String(a.action || '').includes('INVENTORY_'));
  const movementsEnriched = React.useMemo(() => {
    const tryParse = (s: any) => { if (typeof s !== 'string') return s; try { return JSON.parse(s); } catch { return s; } };
    const pickName = (d: any): string => {
      if (!d) return '';
      if (Array.isArray(d) && d.length) { const first = d[0]; return String(first?.name || first?.item || ''); }
      if (typeof d === 'string') return d;
      if (typeof d === 'object') return String(d.name || d.item || d.desc || '');
      return '';
    };
    return movements.map((a: any) => {
      const d = tryParse(a.details);
      const key = String(pickName(d) || '').toLowerCase();
      const it = itemIndexByName.get(key);
      const invCat = it
        ? (String(it.inventoryCategory||'').toLowerCase() === 'cellar' ? 'cellar'
          : String(it.inventoryCategory||'').toLowerCase() === 'kitchen' ? 'kitchen'
          : it.costCenter === 'bar' ? 'cellar' : it.costCenter === 'restaurant' ? 'kitchen' : '')
        : '';
      return { ...a, invCat };
    });
  }, [movements, itemIndexByName]);
  const movementsByInvCat = React.useMemo(() => {
    const counts: Record<string, number> = { kitchen: 0, cellar: 0 };
    movementsEnriched.forEach(v => { if (v.invCat === 'kitchen') counts.kitchen++; else if (v.invCat === 'cellar') counts.cellar++; });
    return counts;
  }, [movementsEnriched]);
  return (
    <div className="mb-6">
      <h3 className="text-lg font-semibold mb-2">Stock Movement</h3>
      <div className="text-xs text-gray-600 mb-2">Derived from inventory-related audit actions.</div>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs">Filter:</span>
        <Button variant={movementsFilter==='all'?'secondary':'outline'} onClick={()=>setMovementsFilter('all')}>All</Button>
        <Button variant={movementsFilter==='kitchen'?'secondary':'outline'} onClick={()=>setMovementsFilter('kitchen')}>Kitchen</Button>
        <Button variant={movementsFilter==='cellar'?'secondary':'outline'} onClick={()=>setMovementsFilter('cellar')}>Cellar</Button>
        <span className="text-xs text-gray-600 ml-2">Kitchen: {movementsByInvCat.kitchen} · Cellar: {movementsByInvCat.cellar}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="ds-table">
          <thead><tr><th className="p-2 text-left">Action</th><th className="p-2">Entity</th><th className="p-2">Inventory Category</th><th className="p-2">Timestamp</th></tr></thead>
          <tbody>
            {movementsEnriched
              .filter((a:any)=> movementsFilter==='all' ? true : a.invCat === movementsFilter)
              .map((a:any, idx:number) => (<tr key={idx}><td className="p-2">{a.action}</td><td className="p-2">{a.entity||a.entityType}</td><td className="p-2 capitalize">{a.invCat || '—'}</td><td className="p-2">{a.timestamp}</td></tr>))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// Dedicated Goods Received Vouchers report view
const GoodsReceivedReportView: React.FC<{ rangeText: string; inRange: (ts: string)=>boolean }>
= ({ rangeText, inRange }) => {
  const goodsReceived = React.useMemo(() => readJSON('corepms_goods_received', []), []);
  const goodsReceivedInRange = React.useMemo(() => goodsReceived.filter((v:any) => inRange(v.dateReceived)), [goodsReceived, inRange]);
  // (GRV-specific filters and projections moved into dedicated view component)
  return (
    <div className="mb-6">
      <h3 className="text-lg font-semibold mb-2">Goods Received Vouchers</h3>
      <div className="text-xs text-gray-600 mb-2">Range: {rangeText}</div>
      <div className="flex items-center gap-2 mb-3">
        <label className="text-xs">Supplier</label>
        <Select value={grvSupplier} onValueChange={(v)=> setGrvSupplier(v)}>
          <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            {grvSuppliers.map(s => (<SelectItem key={s} value={s}>{s==='all'?'All':s}</SelectItem>))}
          </SelectContent>
        </Select>
        <label className="text-xs">Location</label>
        <Select value={grvLocation} onValueChange={(v)=> setGrvLocation(v as any)}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="Kitchen">Kitchen</SelectItem>
            <SelectItem value="Cellar">Cellar</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={()=> {
          const headers = ['VoucherID','Date','Supplier','Location','ItemID','Qty','TotalCost'];
          const rows = grvRows.map(r => [r.id, r.date, String(r.supplier||''), String(r.location||''), r.itemId, String(r.qty), r.totalCost.toFixed(2)]);
          exportCSV(`goods_received_${rangeText}.csv`, headers, rows);
        }}>Export CSV</Button>
        <Button variant="outline" onClick={async ()=> { const XLSX = await loadXLSX(); if (!XLSX) return; const data = grvRows.map(r => ({ VoucherID: r.id, Date: r.date, Supplier: r.supplier||'', Location: r.location||'', ItemID: r.itemId, Qty: r.qty, TotalCost: r.totalCost })); const ws = XLSX.utils.json_to_sheet(data); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'GRV'); XLSX.writeFile(wb, `goods_received_${rangeText}.xlsx`); }}>Export Excel (XLSX)</Button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
        <div className="border rounded p-3">Total Qty: <span className="font-semibold">{grvTotals.qty}</span></div>
        <div className="border rounded p-3">Total Cost: <span className="font-semibold">{formatCurrency(grvTotals.cost)}</span></div>
        <div className="border rounded p-3">Vouchers: <span className="font-semibold">{grvFiltered.length}</span></div>
      </div>
      <div className="overflow-x-auto">
        <table className="ds-table">
          <thead><tr><th className="p-2 text-left">Voucher</th><th className="p-2">Date</th><th className="p-2">Supplier</th><th className="p-2">Location</th><th className="p-2">Item</th><th className="p-2 text-right">Qty</th><th className="p-2 text-right">Total Cost</th></tr></thead>
          <tbody>
            {grvRows.map((r, idx) => (<tr key={idx}><td className="p-2">{r.id}</td><td className="p-2">{r.date}</td><td className="p-2">{r.supplier}</td><td className="p-2">{r.location}</td><td className="p-2">{r.itemId}</td><td className="p-2 text-right">{r.qty}</td><td className="p-2 text-right">{formatCurrency(r.totalCost)}</td></tr>))}
            {!grvRows.length && (<tr><td className="p-2" colSpan={7}>No vouchers in range.</td></tr>)}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const useAuditLog = (userId?: string) => {
  return (action: string, details?: any) => {
    try {
      const entry = createAuditEntry(action, 'REPORT', 'pos', userId || 'unknown', details);
      const list = readJSON('corepms_pos_audit');
      const next = [entry, ...list].slice(0, 500);
      localStorage.setItem('corepms_pos_audit', JSON.stringify(next));
    } catch {}
  };
};

// Safely format audit `details` for display without causing React to render plain objects
const formatDetailsText = (d: any): string => {
  if (!d) return '';
  if (typeof d === 'string') {
    // Try parsing JSON strings to readable text
    try {
      const obj = JSON.parse(d);
      if (obj && typeof obj === 'object') {
        return Object.entries(obj).map(([k, v]) => `${k}: ${String(v)}`).join(', ');
      }
    } catch { /* not JSON, keep as-is */ }
    return d;
  }
  if (typeof d === 'object') {
    try {
      return Object.entries(d).map(([k, v]) => `${k}: ${String(v)}`).join(', ');
    } catch {
      return JSON.stringify(d);
    }
  }
  return String(d);
};

export const PosReports: React.FC = () => {
  const { user } = useAuth();
  const isManager = canManagePOS(user?.role);
  const audit = useAuditLog(user?.id);
  const { toast } = useToast();
  const [loading, setLoading] = React.useState<boolean>(true);
  const [error, setError] = React.useState<string>('');
  const [reportType, setReportType] = React.useState<'individual'|'consolidated'|'custom'>('individual');
  const [preset, setPreset] = React.useState<'none'|'today'|'this-week'|'this-month'|'last-quarter'>('none');
  const [centresDropdownOpen, setCentresDropdownOpen] = React.useState<boolean>(false);
  const [centreSearch, setCentreSearch] = React.useState<string>('');
  const [selectedCentres, setSelectedCentres] = React.useState<string[]>(['bar']);
  const [generating, setGenerating] = React.useState<boolean>(false);
  const [backgroundMode, setBackgroundMode] = React.useState<boolean>(false);
  const cancelRef = React.useRef<() => void>(() => {});
  const [selectedReport, setSelectedReport] = React.useState<string>('');
  const [showPrintSettings, setShowPrintSettings] = React.useState<boolean>(false);

  const [range, setRange] = React.useState<DateRange>(() => ({
    start: new Date(new Date().setHours(0,0,0,0)).toISOString().slice(0,10),
    end: new Date().toISOString().slice(0,10)
  }));
  const [centre, setCentre] = React.useState<'all'|'bar'|'restaurant'>('all');
  const [readingType, setReadingType] = React.useState<'x'|'z'>('x');
  const [kickBeforePrint, setKickBeforePrint] = React.useState<boolean | undefined>(undefined);

  const kickDrawerIfEnabled = React.useCallback(async () => {
    try {
      const propertyId = (user as any)?.propertyId || 'DEFAULT';
      const cfg = await readPrinterConfig(propertyId);
      const dc = cfg.pos;
      const shouldKick = typeof kickBeforePrint === 'boolean' ? kickBeforePrint : !!dc?.enabled;
      if (shouldKick && (window as any).native?.kickDrawer) {
        const res = await (window as any).native.kickDrawer({
          ip: dc.ip,
          port: dc.port,
          drawer: (dc.drawerNumber ?? 0) as 0|1,
          onMs: dc.pulseOnTimeMs ?? 50,
          offMs: dc.pulseOffTimeMs ?? 50,
          printer: dc.printerDeviceName,
          model: dc.model,
          customCommandHex: dc.customCommandHex,
        });
        if (res && res.error) throw new Error(res.error);
      }
    } catch (err: any) {
      toast({ title: 'Drawer kick failed', description: err?.message || String(err), duration: 2000 });
    }
  }, [user, toast, kickBeforePrint]);

  const items = React.useMemo(() => {
    console.log('[PosReports] init: reading items');
    try { return readJSON('corepms_pos_items', []); } catch (err) { console.error('[PosReports] items read error', err); return []; }
  }, []);
  const auditLog = React.useMemo(() => {
    console.log('[PosReports] init: reading audit');
    try { return readJSON('corepms_pos_audit', []); } catch (err) { console.error('[PosReports] audit read error', err); return []; }
  }, []);

  // X/Z Reading: category summary and details computed from inventory depletion audit entries in date range
  const inRange = React.useCallback((ts: string) => {
    const start = new Date(range.start + 'T00:00:00');
    const end = new Date(range.end + 'T23:59:59');
    const dt = new Date(ts);
    return dt >= start && dt <= end;
  }, [range.start, range.end]);

  const depletionEntries = React.useMemo(() => auditLog.filter((a: any) => a.action === 'INVENTORY_DEPLETION' && inRange(a.timestamp)), [auditLog, inRange]);
  const itemIndexByName = React.useMemo(() => {
    const idx = new Map<string, any>();
    (items||[]).forEach((it: any) => idx.set(String(it.name || '').toLowerCase(), it));
    return idx;
  }, [items]);

  const categorySummary = React.useMemo(() => {
    const map = new Map<string, { itemsSold: number; grossSales: number; discounts: number; netSales: number }>();
    depletionEntries.forEach((e: any) => {
      const details = Array.isArray(e.details) ? e.details : (() => { try { return JSON.parse(e.details || '[]'); } catch { return []; } })();
      details.forEach((d: any) => {
        const nameKey = String(d.name || '').toLowerCase();
        const qty = Number(d.quantity || 0);
        const it = itemIndexByName.get(nameKey);
        const price = Number(it?.sellingPrice || 0);
        const catId = String(it?.category_id || '') || 'UNCATEGORIZED';
        const catName = catId === 'UNCATEGORIZED' ? 'Uncategorized' : (menuCats.getCategoryById(catId)?.category_name || 'Uncategorized');
        const row = map.get(catName) || { itemsSold: 0, grossSales: 0, discounts: 0, netSales: 0 };
        row.itemsSold += qty;
        row.grossSales += qty * price;
        row.discounts += 0; // Placeholder until discount data is available
        row.netSales = row.grossSales - row.discounts;
        map.set(catName, row);
      });
    });
    const totalGross = Array.from(map.values()).reduce((s, r) => s + r.grossSales, 0);
    const rows = Array.from(map.entries()).map(([name, r]) => ({ name, ...r, percent: totalGross ? (r.grossSales / totalGross) * 100 : 0 }));
    rows.sort((a,b)=> b.grossSales - a.grossSales);
    return { rows, totalGross };
  }, [depletionEntries, itemIndexByName]);

  const detailedRowsByCategory = React.useMemo(() => {
    const groups = new Map<string, Array<{ ts: string; sku: string; desc: string; qty: number; unit: number; total: number }>>();
    depletionEntries.forEach((e: any) => {
      const ts = e.timestamp;
      const details = Array.isArray(e.details) ? e.details : (() => { try { return JSON.parse(e.details || '[]'); } catch { return []; } })();
      details.forEach((d: any) => {
        const nameKey = String(d.name || '').toLowerCase();
        const it = itemIndexByName.get(nameKey);
        const sku = String(it?.id || it?.name || d.name || '');
        const catId = String(it?.category_id || '') || 'UNCATEGORIZED';
        const catName = catId === 'UNCATEGORIZED' ? 'Uncategorized' : (menuCats.getCategoryById(catId)?.category_name || 'Uncategorized');
        const qty = Number(d.quantity || 0);
        const unit = Number(it?.sellingPrice || 0);
        const total = qty * unit;
        const desc = String(it?.name || d.name || '');
        const arr = groups.get(catName) || [];
        arr.push({ ts, sku, desc, qty, unit, total });
        groups.set(catName, arr);
      });
    });
    groups.forEach(arr => arr.sort((a,b)=> (new Date(a.ts).getTime()) - (new Date(b.ts).getTime())));
    return groups;
  }, [depletionEntries, itemIndexByName]);

  // Cocktail usage reporting (must be declared before any early returns to keep hook order stable)
  const cocktailUsage = React.useMemo(() => {
    const u = cocktailEng.listUsageInRange(range.start, range.end);
    const ingMap = new Map<string, any>(); cocktailEng.listIngredients().forEach(i => ingMap.set(i.id, i));
    const totalsByIngredient = new Map<string, { name: string; unit: string; used: number; threshold?: number }>();
    u.forEach(e => {
      e.ingredients.forEach((ri: any) => {
        const ing = ingMap.get(ri.ingredientId);
        if (!ing) return;
        // Convert recipe unit to ingredient unit
        let qtyInIngUnit = ri.qty;
        if (ing.unit !== ri.unit && (ing.unit !== 'each' && ri.unit !== 'each')) {
          // Approximate conversion using ml base
          const toMl = (q: number, unit: string) => unit==='ml'?q:unit==='oz'?q*29.5735:unit==='cl'?q*10:q;
          const fromMl = (ml: number, unit: string) => unit==='ml'?ml:unit==='oz'?ml/29.5735:unit==='cl'?ml/10:ml;
          qtyInIngUnit = fromMl(toMl(ri.qty, ri.unit), ing.unit);
        }
        const used = qtyInIngUnit * Number(e.count || 1);
        const cur = totalsByIngredient.get(ri.ingredientId) || { name: ing.name, unit: ing.unit, used: 0, threshold: ing.threshold };
        cur.used += used; totalsByIngredient.set(ri.ingredientId, cur);
      });
    });
    const rows = Array.from(totalsByIngredient.values()).sort((a,b)=> b.used - a.used);
    return { usageRows: rows, totalIngredients: rows.length };
  }, [range.start, range.end]);

  // Goods Received vouchers: data, filters, projections (declare BEFORE any early returns)
  const goodsReceived = React.useMemo(() => readJSON('corepms_goods_received', []), []);
  const goodsReceivedInRange = React.useMemo(() => goodsReceived.filter((v:any) => inRange(v.dateReceived)), [goodsReceived, inRange]);
  const [grvSupplier, setGrvSupplier] = React.useState<string>('all');
  const [grvLocation, setGrvLocation] = React.useState<'all'|'Kitchen'|'Cellar'>('all');
  const grvSuppliers = React.useMemo(() => {
    const set = new Set<string>(); goodsReceived.forEach((v:any)=> { if (v.supplier) set.add(String(v.supplier)); }); return ['all', ...Array.from(set)];
  }, [goodsReceived]);
  const grvFiltered = React.useMemo(() => goodsReceivedInRange.filter((v:any)=> (grvSupplier==='all' || String(v.supplier)===grvSupplier) && (grvLocation==='all' || String(v.location)===grvLocation)), [goodsReceivedInRange, grvSupplier, grvLocation]);
  const grvRows = React.useMemo(() => grvFiltered.flatMap((v:any) => (v.items||[]).map((it:any)=> ({ id: v.id, date: v.dateReceived, supplier: v.supplier, location: v.location, itemId: it.itemId, qty: Number(it.qty||0), totalCost: Number(it.totalCost||0) }))), [grvFiltered]);
  const grvTotals = React.useMemo(() => ({ qty: grvRows.reduce((s,r)=>s+r.qty,0), cost: grvRows.reduce((s,r)=>s+r.totalCost,0) }), [grvRows]);

  // XLSX loader via CDN to avoid build-time resolution issues
  // (XLSX loader moved to module-level)

  // Voids and Movements enrichment (declare BEFORE any early returns)
  // (Voids/Movements views compute their own data)

  const refreshCache = React.useCallback(() => {
    cacheSet('pos_reports_cache_items', items);
    cacheSet('pos_reports_cache_audit', auditLog);
  }, [items, auditLog]);

  React.useEffect(() => {
    try {
      console.log('[PosReports] caching start');
      refreshCache();
      setLoading(false);
    } catch (err: any) {
      console.error('[PosReports] caching error', err);
      setError('Failed to initialize reports');
      setLoading(false);
    }
  }, [refreshCache]);

  // Cost centres list
  const centreOptions: string[] = React.useMemo(() => {
    try {
      const set = new Set<string>();
      (items || []).forEach((it: any) => { if (it?.costCenter) set.add(String(it.costCenter)); });
      const arr = Array.from(set);
      return arr.length ? arr : ['bar','restaurant'];
    } catch { return ['bar','restaurant']; }
  }, [items]);
  const filteredCentres = React.useMemo(() => centreOptions.filter(c => c.toLowerCase().includes(centreSearch.toLowerCase())), [centreOptions, centreSearch]);
  const reportOptions = React.useMemo(() => (
    [
      { key: 'x-summary', name: `${readingType.toUpperCase()} Reading — Category Summary` },
      { key: 'x-detail', name: `${readingType.toUpperCase()} Reading — Detailed Sales by Category` },
      { key: 'pnl', name: 'Profit and Loss Statement' },
      { key: 'daily-collection', name: 'Daily Collection Report' },
      { key: 'cocktail-usage', name: 'Cocktail Inventory & Usage' },
      { key: 'menu-cos', name: 'Menu Item Cost of Sales' },
      { key: 'sales-summary-inventory', name: 'Sales Summary by Inventory Category' },
      { key: 'sales-summary-centre', name: 'Sales Summary by Cost Centre' },
      { key: 'goods-received', name: 'Goods Received Vouchers' },
      { key: 'stock-movement', name: 'Stock Movement' },
      { key: 'voids', name: 'Voids' },
      { key: 'reconciliation', name: 'Daily Reconciliation (Summary)' },
      { key: 'stock-adjust', name: 'Stock Adjustments' },
      { key: 'purchases', name: 'Purchases' },
      { key: 'journal', name: 'Journal' },
    ]
  ), [readingType]);

  // Preset application
  React.useEffect(() => {
    const todayISO = new Date().toISOString().slice(0,10);
    const startOfWeek = (() => { const d = new Date(); const day = d.getDay(); const diff = d.getDate() - day + (day === 0 ? -6 : 1); const s = new Date(d.setDate(diff)); return s.toISOString().slice(0,10); })();
    const startOfMonth = (() => { const d = new Date(); d.setDate(1); return d.toISOString().slice(0,10); })();
    const lastQuarterRange = (() => { const d = new Date(); const m = d.getMonth(); const qStartMonth = m - 3 < 0 ? 9 : m - 3; const year = m - 3 < 0 ? d.getFullYear()-1 : d.getFullYear(); const start = new Date(year, qStartMonth, 1); const end = new Date(); return { start: start.toISOString().slice(0,10), end: end.toISOString().slice(0,10) }; })();
    if (preset === 'today') setRange({ start: todayISO, end: todayISO });
    else if (preset === 'this-week') setRange(r => ({ ...r, start: startOfWeek, end: todayISO }));
    else if (preset === 'this-month') setRange(r => ({ ...r, start: startOfMonth, end: todayISO }));
    else if (preset === 'last-quarter') setRange(lastQuarterRange);
  }, [preset]);

  const validateConfig = (): boolean => {
    const errs: string[] = [];
    if (!reportType) errs.push('Select a report type');
    if (!range.start || !range.end) errs.push('Provide a valid date range');
    if (range.end < range.start) errs.push('End date cannot be before start date');
    if (reportType === 'individual' && (!selectedCentres.length)) errs.push('Select at least one cost centre');
    if (errs.length) {
      toast({ title: 'Validation error', description: errs.join(' • '), duration: 2000 });
      return false;
    }
    return true;
  };

  const generateReports = () => {
    if (!validateConfig()) return;
    setGenerating(true);
    toast({ title: 'Generating reports…', description: 'Please wait', duration: 1500 });
    if (backgroundMode) {
      try {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        const worker = new Worker(new URL('../../workers/xzWorker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = () => {
          setGenerating(false);
          toast({ title: 'Reports ready', description: 'Background generation completed', duration: 1800 });
          audit('REPORT_GENERATE_BG_DONE', { range, readingType });
          worker.terminate();
        };
        worker.onerror = (ev) => {
          console.error('[PosReports] Worker error', ev);
          setGenerating(false);
          toast({ title: 'Background generation failed', description: 'Falling back to foreground' });
          audit('REPORT_GENERATE_BG_ERROR', { range, readingType, error: String(ev.message || ev) });
          worker.terminate();
        };
        worker.postMessage({ items, auditLog, range });
        cancelRef.current = () => { setGenerating(false); toast({ title: 'Background cancelled', duration: 1500 }); worker.terminate(); };
      } catch {
        setGenerating(false);
        toast({ title: 'Background generation failed', description: 'Falling back to foreground' });
      }
    } else {
      const timer = setTimeout(() => {
        setGenerating(false);
        toast({ title: 'Reports ready', description: 'Generation completed', duration: 1800 });
        audit('REPORT_GENERATE', { reportType, range, centres: selectedCentres });
      }, 1200);
      cancelRef.current = () => { clearTimeout(timer); setGenerating(false); toast({ title: 'Generation cancelled', duration: 1500 }); };
    }
  };

  if (!isManager) {
    return (
      <div className="bg-white rounded-xl shadow p-6 text-center">
        <h3 className="text-xl font-semibold mb-2">Access Denied</h3>
        <p className="text-sm text-gray-600">Manager or Admin role required to view POS Reports.</p>
      </div>
    );
  }

  if (loading) {
    return <div className="text-sm text-gray-600">Loading POS Reports…</div>;
  }
  if (error) {
    return <div className="text-sm text-red-700">{error}</div>;
  }

  const rangeText = `${range.start} → ${range.end}`;
  const centreText = centre === 'all' ? 'All' : centre;

  const filteredItems = items.filter((it: any) => centre==='all' ? true : it.costCenter === centre);

  const salesSummaryRows = filteredItems.map((it: any) => {
    const qty = Number(it.qtyInStock || 0); // placeholder: use movement/audit to derive sales if available
    const revenue = Number(it.sellingPrice || 0) * qty;
    return {
      name: it.name,
      centre: it.costCenter || '',
      invCat: (String(it.inventoryCategory||'').toLowerCase() === 'cellar') ? 'cellar' : (String(it.inventoryCategory||'').toLowerCase() === 'kitchen') ? 'kitchen' : (it.costCenter === 'bar' ? 'cellar' : it.costCenter === 'restaurant' ? 'kitchen' : ''),
      qty,
      revenue,
      cost: Number(it.costPrice || 0) * qty,
      margin: revenue - (Number(it.costPrice || 0) * qty)
    };
  });

  const stockAdjustments = auditLog.filter((a: any) => String(a.action || '').includes('ADJUST'));

  // Local filters for segmented views
  // (Segment filters moved into dedicated views)


  const exportReport = (type: string) => {
    audit('REPORT_EXPORT', { type, range, centre });
    if (type === 'sales-summary') {
      const headers = ['Item','Center','Qty','Revenue','Cost','Margin'];
      const rows = salesSummaryRows.map(r => [r.name, r.centre, String(r.qty), r.revenue.toFixed(2), r.cost.toFixed(2), r.margin.toFixed(2)]);
      exportCSV(`sales_summary_${centreText}_${rangeText}.csv`, headers, rows);
    } else if (type === 'sales-summary-inventory') {
      const headers = ['Item','InventoryCategory','Qty','Revenue','Cost','Margin'];
      const rows = salesSummaryRows.map(r => [r.name, r.invCat || '', String(r.qty), r.revenue.toFixed(2), r.cost.toFixed(2), r.margin.toFixed(2)]);
      exportCSV(`sales_summary_inventory_${rangeText}.csv`, headers, rows);
    } else if (type === 'stock-adjust') {
      const headers = ['Action','Entity','Timestamp','Details'];
      const rows = stockAdjustments.map((a: any) => [a.action, a.entity || a.entityType, a.timestamp, formatDetailsText(a.details)]);
      exportCSV(`stock_adjust_${rangeText}.csv`, headers, rows);
    } else if (type === 'voids') {
      const headers = ['Action','Entity','Timestamp','Details'];
      const rows = voids.map((a: any) => [a.action, a.entity || a.entityType, a.timestamp, formatDetailsText(a.details)]);
      exportCSV(`voids_${rangeText}.csv`, headers, rows);
    }
  };

  
  const printReport = async (title: string, table: { headers: string[]; rows: string[][] }) => {
    audit('REPORT_PRINT', { title, range, centre });
    const html = `
      <h2>${title}</h2>
      <div><strong>Range:</strong> ${rangeText} &nbsp; <strong>Centre:</strong> ${centreText}</div>
      <table><tr>${table.headers.map(h=>`<th>${h}</th>`).join('')}</tr>
      ${table.rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}
      </table>
    `;
    await kickDrawerIfEnabled();
    openPrintable(title, html);
  };

  const printReadingReport = async () => {
    const title = `${readingType==='x'?'X':'Z'} Reading — Category & Detail`;
    const brand = readJSON('corepms_receipt_settings', { restaurant_name: 'Property', address: '', phone: '', email: '', logo_url: '', show_logo: true });
    const header = `
      ${brand.show_logo && brand.logo_url ? `<div style=\"text-align:center\"><img src=\"${brand.logo_url}\" alt=\"Logo\" style=\"max-width:120px\"/></div>` : ''}
      <div style="text-align:center;font-weight:bold">${brand.restaurant_name || 'Property'}</div>
      ${brand.address ? `<div style=\"text-align:center\">${brand.address}</div>` : ''}
      ${brand.phone ? `<div style=\"text-align:center\">Phone: ${brand.phone}</div>` : ''}
      ${brand.email ? `<div style=\"text-align:center\">Email: ${brand.email}</div>` : ''}
      <div style="text-align:center;font-weight:bold">${title}</div>
      <div style="text-align:center">Range: ${rangeText}</div>
      <hr/>
    `;
    const summary = `
      <h3>Category Sales Summary</h3>
      <table>
        <tr><th>Category</th><th>Items Sold</th><th class="right">Gross</th><th class="right">Discounts</th><th class="right">Net</th><th class="right">Percent</th></tr>
        ${categorySummary.rows.map(r => `<tr><td>${r.name}</td><td>${r.itemsSold}</td><td class="right">${formatCurrency(r.grossSales)}</td><td class="right">${formatCurrency(r.discounts)}</td><td class="right">${formatCurrency(r.netSales)}</td><td class="right">${r.percent.toFixed(2)}%</td></tr>`).join('')}
      </table>
    `;
    const detail = `
      <h3>Detailed Sales by Category</h3>
      ${Array.from(detailedRowsByCategory.entries()).map(([cat, rows]) => `
        <div style="margin-top:8px;font-weight:bold">${cat}</div>
        <table>
          <tr><th>Time</th><th>Category</th><th>SKU</th><th>Description</th><th class="right">Qty</th><th class="right">Unit</th><th class="right">Total</th></tr>
          ${rows.map(r => `<tr><td>${r.ts}</td><td>${cat}</td><td>${r.sku}</td><td>${r.desc}</td><td class="right">${r.qty}</td><td class="right">${formatCurrency(r.unit)}</td><td class="right">${formatCurrency(r.total)}</td></tr>`).join('')}
          <tr><td colspan="6" style="font-weight:bold">Subtotal</td><td class="right" style="font-weight:bold">${formatCurrency(rows.reduce((s,rr)=>s+rr.total,0))}</td></tr>
        </table>
      `).join('')}
    `;
    const html = `
      ${header}
      ${summary}
      ${detail}
    `;
    await kickDrawerIfEnabled();
    openPrintable(title, html);
    audit('REPORT_PRINT', { title, range });
  };

  return (
    <div className="ds-card">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div>
            <label className="text-xs font-medium">Select Report</label>
            <Select value={selectedReport} onValueChange={(v) => setSelectedReport(v)}>
              <SelectTrigger className="w-72"><SelectValue placeholder="Select a Report" /></SelectTrigger>
              <SelectContent>
                {reportOptions.map(r => (<SelectItem key={r.key} value={r.key}>{r.name}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium">Report Type</label>
            <Select value={reportType} onValueChange={(v) => setReportType(v as any)}>
              <SelectTrigger className="w-56"><SelectValue placeholder="Select report" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="individual">Individual cost center reports</SelectItem>
                <SelectItem value="consolidated">Consolidated report view</SelectItem>
                <SelectItem value="custom">Custom report configuration</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium">Start</label>
            <Input type="date" value={range.start} onChange={(e) => setRange(r => ({ ...r, start: e.target.value }))} />
          </div>
          <div>
            <label className="text-xs font-medium">End</label>
            <Input type="date" value={range.end} onChange={(e) => setRange(r => ({ ...r, end: e.target.value }))} />
          </div>
          <div>
            <label className="text-xs font-medium">Preset Range</label>
            <Select value={preset} onValueChange={(v) => setPreset(v as any)}>
              <SelectTrigger className="w-44"><SelectValue placeholder="Preset" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="this-week">This Week</SelectItem>
                <SelectItem value="this-month">This Month</SelectItem>
                <SelectItem value="last-quarter">Last Quarter</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium">Reading</label>
            <Select value={readingType} onValueChange={(v) => setReadingType(v as any)}>
              <SelectTrigger className="w-36"><SelectValue placeholder="Reading" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="x">X-Reading</SelectItem>
                <SelectItem value="z">Z-Reading</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium">Kick Drawer</label>
            <Switch checked={!!kickBeforePrint} onCheckedChange={(v)=> setKickBeforePrint(v)} />
            <Button variant="outline" className="h-8 px-2" onClick={()=> setKickBeforePrint(undefined)}>Use saved config</Button>
          </div>
          {reportType !== 'consolidated' && (
            <div className="relative">
              <label className="text-xs font-medium">Cost Centres</label>
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={() => setCentresDropdownOpen(o => !o)} aria-haspopup="listbox" aria-expanded={centresDropdownOpen}>Select Centres</Button>
                <Input placeholder="Search" value={centreSearch} onChange={(e) => setCentreSearch(e.target.value)} className="w-40" />
                <Button variant="outline" onClick={() => setSelectedCentres(centreOptions.slice())}>Select All</Button>
              </div>
              {centresDropdownOpen && (
                <div className="absolute z-50 mt-1 w-56 bg-white border rounded shadow p-2" role="listbox">
                  {filteredCentres.map(c => (
                    <label key={c} className="flex items-center gap-2 py-1">
                      <input type="checkbox" checked={selectedCentres.includes(c)} onChange={(e) => {
                        const checked = e.target.checked; setSelectedCentres(prev => checked ? Array.from(new Set([...prev, c])) : prev.filter(x => x !== c));
                      }} />
                      <span className="text-sm">{c}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="ds-toolbar">
          {/* Print customization modal trigger */}
          <Button variant="outline" onClick={() => setShowPrintSettings(true)}>Customize Print</Button>
          <Button variant="outline" onClick={() => printReport('Sales Summary by Cost Centre', {
            headers: ['Item','Center','Qty','Revenue','Cost','Margin'],
            rows: salesSummaryRows.map(r => [r.name, r.centre, String(r.qty), formatCurrency(r.revenue), formatCurrency(r.cost), formatCurrency(r.margin)])
          })}>Export PDF</Button>
          <Button variant="outline" onClick={() => exportReport('sales-summary')}>Export CSV</Button>
          <Button variant="outline" onClick={() => exportReport(readingType==='x'?'x-reading':'z-reading')}>Export X/Z CSV</Button>
          <Button variant="outline" onClick={printReadingReport}>Export X/Z PDF</Button>
          <Button className="ds-button-primary" onClick={generateReports} disabled={generating}>Generate</Button>
          {generating && (<Button variant="outline" onClick={() => cancelRef.current()}>Cancel</Button>)}
        </div>
        {selectedReport === 'sales-summary-inventory' && (
          <div className="ds-toolbar mt-2">
            <Button variant="outline" onClick={() => exportReport('sales-summary-inventory')}>Export Inventory Category CSV</Button>
            <Button variant="outline" onClick={async () => { const XLSX = await loadXLSX(); if (!XLSX) return; const data = salesSummaryRows.map(r => ({ Item: r.name, InventoryCategory: r.invCat || '', Qty: r.qty, Revenue: Number(r.revenue.toFixed(2)), Cost: Number(r.cost.toFixed(2)), Margin: Number(r.margin.toFixed(2)) })); const ws = XLSX.utils.json_to_sheet(data); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'InventoryCategory'); XLSX.writeFile(wb, `sales_summary_inventory_${rangeText}.xlsx`); }}>Export Excel (XLSX)</Button>
            <Button variant="outline" onClick={() => printReport('Sales Summary by Inventory Category', {
              headers: ['Item','InventoryCategory','Qty','Revenue','Cost','Margin'],
              rows: salesSummaryRows.map(r => [r.name, r.invCat || '', String(r.qty), formatCurrency(r.revenue), formatCurrency(r.cost), formatCurrency(r.margin)])
            })}>Export PDF</Button>
          </div>
        )}
      </div>
      {/* Print customization modal */}
      {showPrintSettings && (<PrintCustomizationModal open={showPrintSettings} onClose={() => setShowPrintSettings(false)} />)}
      <div className="flex items-center gap-2 mb-3">
        <Checkbox checked={backgroundMode} onCheckedChange={(v)=> setBackgroundMode(!!v)} />
        <span className="text-sm">Background mode (Web Worker)</span>
      </div>
      {generating && (<div className="text-sm text-gray-600 mb-2">Generating…</div>)}

      {selectedReport === '' && (
        <div className="mb-6 text-sm text-gray-600">Select a report from the dropdown to view.</div>
      )}

      {/* X/Z Reading: Category Sales Summary */}
      {selectedReport === 'x-summary' && (
      <div className="mb-6">
        <h3 className="text-lg font-semibold mb-2">{readingType==='x'?'X':'Z'} Reading — Category Sales Summary</h3>
        <div className="text-xs text-gray-600 mb-2">Range: {rangeText}</div>
        <div className="overflow-x-auto">
          <table className="ds-table" role="table" aria-label="Category Sales Summary">
            <thead>
              <tr>
                <th className="p-2 text-left">Category</th>
                <th className="p-2 text-right">Items Sold</th>
                <th className="p-2 text-right">Gross Sales</th>
                <th className="p-2 text-right">Discounts</th>
                <th className="p-2 text-right">Net Sales</th>
                <th className="p-2 text-right">Percent</th>
              </tr>
            </thead>
            <tbody>
              {categorySummary.rows.map(r => (
                <tr key={r.name}>
                  <td className="p-2">{r.name}</td>
                  <td className="p-2 text-right">{r.itemsSold}</td>
                  <td className="p-2 text-right">{formatCurrency(r.grossSales)}</td>
                  <td className="p-2 text-right">{formatCurrency(r.discounts)}</td>
                  <td className="p-2 text-right">{formatCurrency(r.netSales)}</td>
                  <td className="p-2 text-right">{r.percent.toFixed(2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {/* X/Z Reading: Detailed by Category */}
      {selectedReport === 'x-detail' && (
      <div className="mb-6">
        <h3 className="text-lg font-semibold mb-2">{readingType==='x'?'X':'Z'} Reading — Detailed Sales by Category</h3>
        <div className="text-xs text-gray-600 mb-2">Range: {rangeText}</div>
        <div className="overflow-x-auto">
          <table className="ds-table" role="table" aria-label="Detailed Sales by Category">
            <thead>
              <tr>
                <th className="p-2 text-left">Time</th>
                <th className="p-2 text-left">Category</th>
                <th className="p-2">SKU</th>
                <th className="p-2 text-left">Description</th>
                <th className="p-2 text-right">Qty</th>
                <th className="p-2 text-right">Unit Price</th>
                <th className="p-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {Array.from(detailedRowsByCategory.entries()).map(([cat, rows]) => (
                <React.Fragment key={cat}>
                  <tr><td className="p-2 font-semibold" colSpan={7}>{cat}</td></tr>
                  {rows.map((r, idx) => (
                    <tr key={`${cat}-${idx}`}>
                      <td className="p-2">{r.ts}</td>
                      <td className="p-2">{cat}</td>
                      <td className="p-2">{r.sku}</td>
                      <td className="p-2">{r.desc}</td>
                      <td className="p-2 text-right">{r.qty}</td>
                      <td className="p-2 text-right">{formatCurrency(r.unit)}</td>
                      <td className="p-2 text-right">{formatCurrency(r.total)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td className="p-2 font-semibold" colSpan={6}>Subtotal</td>
                    <td className="p-2 text-right font-semibold">{formatCurrency(rows.reduce((s,r)=>s+r.total,0))}</td>
                  </tr>
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {/* Profit and Loss Statement */}
      {selectedReport === 'pnl' && (
      <div className="mb-6">
        <h3 className="text-lg font-semibold mb-2">Profit and Loss Statement</h3>
        <div className="text-xs text-gray-600 mb-2">Range: {rangeText} · Centre: {centreText}</div>
        <div className="overflow-x-auto">
          <table className="ds-table">
            <thead><tr><th className="p-2 text-left">Metric</th><th className="p-2 text-right">Amount</th></tr></thead>
            <tbody>
              {(() => {
                const revenue = salesSummaryRows.reduce((s,r)=>s+r.revenue,0);
                const cost = salesSummaryRows.reduce((s,r)=>s+r.cost,0);
                const gross = revenue - cost;
                return (
                  <>
                    <tr><td className="p-2">Total Revenue</td><td className="p-2 text-right">{formatCurrency(revenue)}</td></tr>
                    <tr><td className="p-2">Cost of Sales</td><td className="p-2 text-right">{formatCurrency(cost)}</td></tr>
                    <tr><td className="p-2 font-semibold">Gross Margin</td><td className="p-2 text-right font-semibold">{formatCurrency(gross)}</td></tr>
                  </>
                );
              })()}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {/* Daily Collection Report */}
      {selectedReport === 'daily-collection' && (
      <div className="mb-6">
        <h3 className="text-lg font-semibold mb-2">Daily Collection Report</h3>
        <div className="flex items-center gap-2 mb-2">
          <Button variant="outline" onClick={() => exportReport('sales-summary')}>Export Excel (CSV)</Button>
          <Button variant="outline" onClick={() => printReport('Daily Collection', { headers: ['Action','Entity','Timestamp'], rows: auditLog.map((a:any)=>[a.action,a.entity||a.entityType,a.timestamp]) })}>Export PDF</Button>
        </div>
        <div className="text-xs text-gray-600">Actions recorded: {auditLog.length}</div>
      </div>
      )}

      {/* Cocktail Inventory & Waste Report */}
      {selectedReport === 'cocktail-usage' && (
      <div className="mb-6">
        <h3 className="text-lg font-semibold mb-2">Cocktail Inventory & Usage</h3>
        <div className="text-xs text-gray-600 mb-2">Range: {rangeText}</div>
        <div className="overflow-x-auto">
          <table className="ds-table">
            <thead><tr><th className="p-2 text-left">Ingredient</th><th className="p-2">Unit</th><th className="p-2 text-right">Used (range)</th><th className="p-2">Threshold</th></tr></thead>
            <tbody>
              {cocktailUsage.usageRows.map((r, idx) => (
                <tr key={idx}><td className="p-2">{r.name}</td><td className="p-2">{r.unit}</td><td className="p-2 text-right">{Number(r.used.toFixed(2))}</td><td className="p-2">{typeof r.threshold==='number' ? r.threshold : '—'}</td></tr>
              ))}
              {!cocktailUsage.usageRows.length && (<tr><td className="p-2" colSpan={4}>No cocktail usage recorded in range</td></tr>)}
            </tbody>
          </table>
        </div>
        <div className="text-xs text-gray-600 mt-2">Waste analysis: placeholder (add bartender waste logging to quantify spills/overpours).</div>
      </div>
      )}

      {/* Menu Item COS Report */}
      {selectedReport === 'menu-cos' && (
      <div className="mb-6">
        <h3 className="text-lg font-semibold mb-2">Menu Item Cost of Sales</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr><th className="p-2 text-left">Item</th><th className="p-2">Centre</th><th className="p-2 text-right">Cost</th><th className="p-2 text-right">Price</th><th className="p-2 text-right">COS%</th><th className="p-2 text-right">Gross Margin</th></tr></thead>
            <tbody>
              {filteredItems.map((it:any) => {
                const price = Number(it.sellingPrice||0); const cost = Number(it.costPrice||0);
                const cos = price>0 ? ((cost/price)*100) : 0; const margin = price - cost;
                return (<tr key={it.id}><td className="p-2">{it.name}</td><td className="p-2">{it.costCenter}</td><td className="p-2 text-right">{formatCurrency(cost)}</td><td className="p-2 text-right">{formatCurrency(price)}</td><td className="p-2 text-right">{cos.toFixed(2)}%</td><td className="p-2 text-right">{formatCurrency(margin)}</td></tr>);
              })}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {/* Sales Summary by Cost Centre */}
      {selectedReport === 'sales-summary-centre' && (
      <div className="mb-6">
        <h3 className="text-lg font-semibold mb-2">Sales Summary by Cost Centre</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {['bar','restaurant'].map(cc => {
            const rows = salesSummaryRows.filter(r=> cc==='bar' ? r.centre==='bar' : r.centre==='restaurant');
            const revenue = rows.reduce((s,r)=>s+r.revenue,0); const cost = rows.reduce((s,r)=>s+r.cost,0);
            return (
              <div key={cc} className="border rounded p-3">
                <div className="font-semibold mb-1">{cc === 'bar' ? 'Bar' : 'Restaurant'}</div>
                <div className="text-sm">Revenue: <span className="font-semibold">{formatCurrency(revenue)}</span></div>
                <div className="text-sm">Cost: <span className="font-semibold">{formatCurrency(cost)}</span></div>
                <div className="text-sm">Gross: <span className="font-semibold">{formatCurrency(revenue - cost)}</span></div>
              </div>
            );
          })}
        </div>
        <div className="mt-3">
          <h4 className="font-semibold mb-1">Detailed Sales (by Item)</h4>
          <div className="overflow-x-auto">
            <table className="ds-table">
              <thead><tr><th className="p-2 text-left">Item</th><th className="p-2">Centre</th><th className="p-2 text-right">Qty</th><th className="p-2 text-right">Revenue</th></tr></thead>
              <tbody>
                {salesSummaryRows.map(r => (<tr key={`${r.name}-${r.centre}`}><td className="p-2">{r.name}</td><td className="p-2">{r.centre}</td><td className="p-2 text-right">{r.qty}</td><td className="p-2 text-right">{formatCurrency(r.revenue)}</td></tr>))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      )}

      {/* Sales Summary by Inventory Category */}
      {selectedReport === 'sales-summary-inventory' && (
      <div className="mb-6">
        <h3 className="text-lg font-semibold mb-2">Sales Summary by Inventory Category</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {['kitchen','cellar'].map(cat => {
            const rows = salesSummaryRows.filter(r=> cat==='kitchen' ? r.invCat==='kitchen' : r.invCat==='cellar');
            const revenue = rows.reduce((s,r)=>s+r.revenue,0); const cost = rows.reduce((s,r)=>s+r.cost,0);
            return (
              <div key={cat} className="border rounded p-3">
                <div className="font-semibold mb-1">{cat === 'kitchen' ? 'Kitchen' : 'Cellar'}</div>
                <div className="text-sm">Revenue: <span className="font-semibold">{formatCurrency(revenue)}</span></div>
                <div className="text-sm">Cost: <span className="font-semibold">{formatCurrency(cost)}</span></div>
                <div className="text-sm">Gross: <span className="font-semibold">{formatCurrency(revenue - cost)}</span></div>
              </div>
            );
          })}
        </div>
        <div className="mt-3">
          <h4 className="font-semibold mb-1">Detailed Sales (by Item)</h4>
          <div className="overflow-x-auto">
            <table className="ds-table">
              <thead><tr><th className="p-2 text-left">Item</th><th className="p-2">Inventory Category</th><th className="p-2 text-right">Qty</th><th className="p-2 text-right">Revenue</th></tr></thead>
              <tbody>
                {salesSummaryRows.map(r => (
                  <tr key={`${r.name}-${r.invCat}`}><td className="p-2">{r.name}</td><td className="p-2 capitalize">{r.invCat || '—'}</td><td className="p-2 text-right">{r.qty}</td><td className="p-2 text-right">{formatCurrency(r.revenue)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      )}

      {/* Goods Received Vouchers */}
      {selectedReport === 'goods-received' && (
        <GoodsReceivedReportView rangeText={rangeText} inRange={inRange} />
      )}

      {/* Stock Movement Report */}
      {selectedReport === 'stock-movement' && (
        <StockMovementReportView auditLog={auditLog} itemIndexByName={itemIndexByName} rangeText={rangeText} />
      )}

      {/* Voids Report */}
      {selectedReport === 'voids' && (
        <VoidsReportView auditLog={auditLog} itemIndexByName={itemIndexByName} rangeText={rangeText} />
      )}

      {/* Daily Reconciliation (Summary) */}
      {selectedReport === 'reconciliation' && (
      <div className="mb-6">
        <h3 className="text-lg font-semibold mb-2">Daily Reconciliation (Summary)</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="border rounded p-3">Expected Cash: <span className="font-semibold">{formatCurrency(0)}</span></div>
          <div className="border rounded p-3">Closing Cash: <span className="font-semibold">{formatCurrency(0)}</span></div>
          <div className="border rounded p-3">Difference: <span className="font-semibold">{formatCurrency(0)}</span></div>
        </div>
      </div>
      )}

      {/* Stock Adjustments */}
      {selectedReport === 'stock-adjust' && (
      <div className="mb-6">
        <h3 className="text-lg font-semibold mb-2">Stock Adjustments</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr><th className="p-2 text-left">Timestamp</th><th className="p-2">Action</th><th className="p-2">Details</th></tr></thead>
            <tbody>
              {stockAdjustments.map((a:any, idx:number) => (<tr key={idx}><td className="p-2">{a.timestamp}</td><td className="p-2">{a.action}</td><td className="p-2">{formatDetailsText(a.details)}</td></tr>))}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {/* Purchases */}
      {selectedReport === 'purchases' && (
      <div className="mb-6">
        <h3 className="text-lg font-semibold mb-2">Purchases</h3>
        <div className="text-xs text-gray-600">Vendor analysis placeholder (extend when vendor data is available).</div>
      </div>
      )}

      {/* Journal */}
      {selectedReport === 'journal' && (
      <div className="mb-2">
        <h3 className="text-lg font-semibold mb-2">Journal</h3>
        <div className="text-xs text-gray-600">Accounting entries audit trail placeholder.</div>
      </div>
      )}
    </div>
  );
};

export default PosReports;
