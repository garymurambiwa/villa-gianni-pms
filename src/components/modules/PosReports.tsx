import React from 'react';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { canManagePOS } from '@/lib/permissions';
import { formatCurrency } from '@/lib/posIntegration';
import menuCats from '@/lib/menuCategories';
import cocktailEng from '@/lib/cocktailEngineering';
import { useToast } from '@/hooks/use-toast';
import db from '@/lib/db';

type DateRange = { start: string; end: string };

const exportCSV = (filename: string, headers: string[], rows: string[][]) => {
  const csv = [headers.join(','), ...rows.map(r => r.map(v => '"' + String(v).replace(/"/g,'""') + '"').join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob); 
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); 
  URL.revokeObjectURL(url);
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

const VoidsReportView: React.FC<{ voidsRows: any[] }> = ({ voidsRows }) => {
  const [voidsFilter, setVoidsFilter] = React.useState<'all'|'kitchen'|'cellar'>('all');
  
  const filtered = voidsRows.filter(v => voidsFilter === 'all' || v.outlet?.toLowerCase().includes(voidsFilter) || v.invCat === voidsFilter);

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
            {filtered.map((v, i) => (
              <tr key={i}>
                <td className="p-2">{new Date(v.voided_at || v.timestamp).toLocaleString()}</td>
                <td className="p-2">VOID</td>
                <td className="p-2">{formatDetailsText(v.items || v.details)}</td>
              </tr>
            ))}
            {!filtered.length && (<tr><td className="p-2 text-center" colSpan={3}>No voids found.</td></tr>)}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const StockMovementReportView: React.FC<{ movementRows: any[] }> = ({ movementRows }) => {
  return (
    <div className="mb-6">
      <h3 className="text-lg font-semibold mb-2">Stock Movement DB</h3>
      <div className="overflow-x-auto">
        <table className="ds-table">
          <thead><tr><th className="p-2 text-left">Time</th><th className="p-2">Type</th><th className="p-2">Item</th><th className="p-2">Change</th></tr></thead>
          <tbody>
            {movementRows.map((m, i) => (
              <tr key={i}>
                <td className="p-2">{new Date(m.inserted_at).toLocaleString()}</td>
                <td className="p-2">DEPLETION</td>
                <td className="p-2">{m.name || m.item_id}</td>
                <td className="p-2">{m.delta}</td>
              </tr>
            ))}
            {!movementRows.length && (<tr><td className="p-2 text-center" colSpan={4}>No movements in range.</td></tr>)}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const GoodsReceivedReportView: React.FC<{ rangeText: string; grnRows: any[] }> = ({ rangeText, grnRows }) => {
  const [grvSupplier, setGrvSupplier] = React.useState<string>('all');
  const [grvLocation, setGrvLocation] = React.useState<'all' | 'loc_main_cellar' | 'loc_dry_goods'>('all');

  const grvSuppliers = React.useMemo(() => {
    const set = new Set<string>();
    grnRows.forEach((v: any) => { if (v.supplier_name) set.add(String(v.supplier_name)); });
    return ['all', ...Array.from(set)];
  }, [grnRows]);

  const grvFiltered = React.useMemo(() =>
    grnRows.filter((v: any) =>
      (grvSupplier === 'all' || String(v.supplier_name) === grvSupplier) &&
      (grvLocation === 'all' || String(v.destination_location_id) === grvLocation)
    ),
    [grnRows, grvSupplier, grvLocation]
  );

  const grvTotals = React.useMemo(() => ({
    qty: grvFiltered.reduce((s, r) => s + Number(r.total_qty || 0), 0),
    cost: grvFiltered.reduce((s, r) => s + Number(r.total_value || 0), 0)
  }), [grvFiltered]);

  return (
    <div className="mb-6">
      <h3 className="text-lg font-semibold mb-2">Goods Received Notes (Live from DB)</h3>
      <div className="flex items-center gap-2 mb-3">
        <label className="text-xs">Supplier</label>
        <Select value={grvSupplier} onValueChange={setGrvSupplier}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>{grvSuppliers.map(s => (<SelectItem key={s} value={s}>{s}</SelectItem>))}</SelectContent>
        </Select>
        <label className="text-xs">Location</label>
        <Select value={grvLocation} onValueChange={(v) => setGrvLocation(v as any)}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All</SelectItem><SelectItem value="loc_main_cellar">Cellar</SelectItem><SelectItem value="loc_dry_goods">Dry Goods</SelectItem></SelectContent>
        </Select>
        <Button variant="outline" onClick={() => exportCSV(`grv_${rangeText}.csv`, ['GRN','Date','Supplier','Location','Total Cost'], grvFiltered.map(r=>[r.grn_number,r.inserted_at,String(r.supplier_name),String(r.destination_location_id),Number(r.total_value || 0).toFixed(2)]))}>CSV</Button>
      </div>
      <div className="grid grid-cols-2 gap-4 mb-3">
        <div className="border rounded p-2">Total GRNs: {grvFiltered.length}</div>
        <div className="border rounded p-2">Total Value: {formatCurrency(Number.isNaN(Number(grvTotals.cost)) ? 0 : Number(grvTotals.cost))}</div>
      </div>
      <div className="overflow-x-auto">
        <table className="ds-table">
          <thead><tr><th className="p-2 text-left">GRN Number</th><th className="p-2">Date</th><th className="p-2">Supplier</th><th className="p-2 text-right">Value</th></tr></thead>
          <tbody>
             {grvFiltered.map((r, i) => (<tr key={i}><td className="p-2">{r.grn_number}</td><td className="p-2">{new Date(r.inserted_at).toLocaleDateString()}</td><td className="p-2">{r.supplier_name}</td><td className="p-2 text-right">{formatCurrency(Number(r.total_value || 0))}</td></tr>))}
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
  const [reportType, setReportType] = React.useState<'individual'|'consolidated'|'custom'>('individual');
  const [selectedCentres, setSelectedCentres] = React.useState<string[]>(['bar']);
  const [selectedReport, setSelectedReport] = React.useState<string>('x-summary');
  const [selectedShift, setSelectedShift] = React.useState<string>('all');
  const [range, setRange] = React.useState<DateRange>(() => ({
    start: new Date().toISOString().slice(0, 10),
    end: new Date().toISOString().slice(0, 10)
  }));
  const [cocktailUsageData, setCocktailUsageData] = React.useState<{ usageRows: any[]; totalIngredients: number }>({ usageRows: [], totalIngredients: 0 });

  const [dbPosBills, setDbPosBills] = React.useState<any[]>([]);
  const [dbInventoryItems, setDbInventoryItems] = React.useState<any[]>([]);
  const [dbGrns, setDbGrns] = React.useState<any[]>([]);
  const [dbMovements, setDbMovements] = React.useState<any[]>([]);

  React.useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const isConfigured = await db.isConfigured();
        if (!isConfigured) return;

        // Fetch POS Bills
        const billsRes = await db.query(
          `SELECT * FROM pos_bills WHERE DATE(opened_at) >= $1 AND DATE(opened_at) <= $2`,
          [range.start, range.end]
        );
        if(!('error' in billsRes)) {
          // Parse JSON if needed
          const processedBills = (billsRes.rows || []).map((row: any) => ({
             ...row,
             items: typeof row.items === 'string' ? JSON.parse(row.items) : (row.items || [])
          }));
          setDbPosBills(processedBills);
        }

        // Fetch GRNs
        const grnsRes = await db.query(
          `SELECT * FROM inv_grn_headers WHERE DATE(inserted_at) >= $1 AND DATE(inserted_at) <= $2`,
          [range.start, range.end]
        );
        if(!('error' in grnsRes)) setDbGrns(grnsRes.rows || []);

        // Fetch Movememts
        const movRes = await db.query(
          `SELECT m.*, i.name FROM inventory_movements m LEFT JOIN inventory_items i ON m.item_id = i.id WHERE DATE(m.inserted_at) >= $1 AND DATE(m.inserted_at) <= $2`,
          [range.start, range.end]
        );
        if(!('error' in movRes)) setDbMovements(movRes.rows || []);

        // Fetch items
        const invRes = await db.query(`SELECT id, name, cost FROM inventory_items`);
        if(!('error' in invRes)) setDbInventoryItems(invRes.rows || []);

      } catch (err) {
        console.error('Failed to fetch report data from DB', err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [range]);

  const itemIndexByName = React.useMemo(() => {
    const map = new Map<string, any>();
    dbInventoryItems.forEach((it: any) => map.set(String(it.name || '').toLowerCase(), it));
    return map;
  }, [dbInventoryItems]);

  const availableShifts = React.useMemo(() => Array.from(new Set(dbPosBills.map((a:any)=>a.shift_id).filter(Boolean))).sort().reverse(), [dbPosBills]);

  const nonVoidedBills = React.useMemo(() => {
    return dbPosBills.filter(b => !b.is_voided && (selectedShift === 'all' ? true : b.shift_id === selectedShift));
  }, [dbPosBills, selectedShift]);

  const voidedBills = React.useMemo(() => {
    return dbPosBills.filter(b => b.is_voided && (selectedShift === 'all' ? true : b.shift_id === selectedShift));
  }, [dbPosBills, selectedShift]);

  const categorySummary = React.useMemo(() => {
    const map = new Map<string, { itemsSold: number; grossSales: number; discounts: number; netSales: number }>();
    nonVoidedBills.forEach((bill: any) => {
      (bill.items || []).forEach((d: any) => {
        const qty = Number(d.quantity || 0);
        const price = Number(d.price || 0);
        // We use the bill's outlet to categorise (Restaurant / Bar)
        const catName = bill.outlet || 'Unknown';
        
        const row = map.get(catName) || { itemsSold: 0, grossSales: 0, discounts: 0, netSales: 0 };
        row.itemsSold += qty; 
        row.grossSales += qty * price; 
        row.netSales = row.grossSales - row.discounts;
        map.set(catName, row);
      });
    });
    const totalGross = Array.from(map.values()).reduce((s, r) => s + r.grossSales, 0);
    return { rows: Array.from(map.entries()).map(([name, r]) => ({ name, ...r, percent: totalGross ? (r.grossSales / totalGross) * 100 : 0 })), totalGross };
  }, [nonVoidedBills]);

  const detailedRowsByCategory = React.useMemo(() => {
    const groups = new Map<string, any[]>();
    nonVoidedBills.forEach((bill: any) => {
      (bill.items || []).forEach((d: any) => {
        const catName = bill.outlet || 'Unknown';
        const qty = Number(d.quantity || 0);
        const price = Number(d.price || 0);
        
        const arr = groups.get(catName) || [];
        arr.push({ ts: bill.opened_at, sku: d.id || '', desc: d.name, qty, unit: price, total: qty * price });
        groups.set(catName, arr);
      });
    });
    return groups;
  }, [nonVoidedBills]);

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
  }, [range]);


  if (!isManager) return <div className="p-6 text-center">Manager Access Required</div>;

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
      
      {loading && <div className="py-8 text-center text-gray-500">Loading Database Records...</div>}
      
      {!loading && selectedReport === 'x-summary' && (
        <div>
          <h3 className="font-bold mb-2">Category Summary</h3>
          <table className="ds-table">
            <thead><tr><th>Outlet</th><th className="right">Sold</th><th className="right">Gross</th><th className="right">Percent</th></tr></thead>
            <tbody>
              {categorySummary.rows.map(r => (<tr key={r.name}><td>{r.name}</td><td className="right">{r.itemsSold}</td><td className="right">{formatCurrency(r.grossSales)}</td><td className="right">{r.percent.toFixed(2)}%</td></tr>))}
              {categorySummary.rows.length === 0 && <tr><td colSpan={4} className="text-center p-4">No Sales found in range</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {!loading && selectedReport === 'x-detail' && (
        <div>
          <h3 className="font-bold mb-2">Detailed Sales</h3>
          {Array.from(detailedRowsByCategory.entries()).map(([cat, rows]) => (
            <div key={cat} className="mb-4">
              <div className="font-semibold bg-gray-50 p-1">{cat}</div>
              <table className="ds-table">
                <tbody>
                  {rows.map((r, i) => (<tr key={i}><td className="text-xs">{new Date(r.ts).toLocaleString()}</td><td>{r.desc}</td><td className="right">{r.qty}</td><td className="right">{formatCurrency(r.total)}</td></tr>))}
                </tbody>
              </table>
            </div>
          ))}
          {detailedRowsByCategory.size === 0 && <div className="text-center p-4 border rounded">No Sales found in range</div>}
        </div>
      )}

      {!loading && selectedReport === 'cocktail-usage' && (
        <table className="ds-table">
          <thead><tr><th>Ingredient</th><th>Unit</th><th className="right">Used</th></tr></thead>
          <tbody>{cocktailUsageData.usageRows.map((r, i) => (<tr key={i}><td>{r.name}</td><td>{r.unit}</td><td className="right">{r.used.toFixed(2)}</td></tr>))}</tbody>
        </table>
      )}

      {!loading && selectedReport === 'goods-received' && <GoodsReceivedReportView rangeText={`${range.start} to ${range.end}`} grnRows={dbGrns} />}
      {!loading && selectedReport === 'voids' && <VoidsReportView voidsRows={voidedBills} />}
      {!loading && selectedReport === 'stock-movement' && <StockMovementReportView movementRows={dbMovements} />}
    </div>
  );
};

export default PosReports;
