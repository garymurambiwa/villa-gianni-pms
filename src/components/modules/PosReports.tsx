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
import ReconciliationService, { ReconciliationReport } from '@/lib/ReconciliationService';

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
      <div className="ds-table-container">
        <table className="ds-table">
          <thead><tr><th className="p-2 text-left">Time</th><th className="p-2">Action</th><th className="p-2">Details</th></tr></thead>
          <tbody>
            {filtered.map((v, i) => (
              <tr key={i}>
                <td className="p-2 text-xs">{String(new Date(v.voided_at || v.timestamp).toLocaleString())}</td>
                <td className="p-2 text-center">VOID</td>
                <td className="p-2 text-xs">{String(formatDetailsText(v.items || v.details))}</td>
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
      <div className="ds-table-container">
        <table className="ds-table">
          <thead><tr><th className="p-2 text-left">Time</th><th className="p-2">Type</th><th className="p-2">Item</th><th className="p-2">Change</th></tr></thead>
          <tbody>
            {movementRows.map((m, i) => (
              <tr key={i}>
                <td className="p-2 text-xs">{String(new Date(m.inserted_at).toLocaleString())}</td>
                <td className="p-2 text-center">DEPLETION</td>
                <td className="p-2">{String(m.name || m.item_id)}</td>
                <td className="p-2 text-center">{String(m.delta)}</td>
              </tr>
            ))}
            {!movementRows.length && (<tr><td className="p-2 text-center" colSpan={4}>No movements in range.</td></tr>)}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const DriftAuditReportView: React.FC<{ report: ReconciliationReport | null }> = ({ report }) => {
  if (!report) return <div className="p-4 text-center text-gray-500">No audit data loaded</div>;

  return (
    <div className="mb-6">
      <div className="flex justify-between items-end mb-4">
        <h3 className="text-lg font-semibold">Inventory Drift Audit</h3>
        <div className="text-right">
          <div className="text-sm font-medium">Accuracy Rate: <span className={report.summary.accuracyRate < 95 ? 'text-red-600' : 'text-green-600'}>{report.summary.accuracyRate.toFixed(1)}%</span></div>
          <div className="text-xs text-gray-500">{report.summary.totalDriftCount} items with discrepancies</div>
        </div>
      </div>
      
      <div className="ds-table-container">
        <table className="ds-table">
          <thead>
            <tr>
              <th className="p-2 text-left">Item Name</th>
              <th className="p-2 text-center">Sold (POS)</th>
              <th className="p-2 text-center">Ledger (Inv)</th>
              <th className="p-2 text-center">Drift (Δ)</th>
              <th className="p-2 text-center">Status</th>
            </tr>
          </thead>
          <tbody>
            {report.discrepancies.map((d, i) => (
              <tr key={i} className={Math.abs(d.drift) > 0 ? 'bg-red-50' : ''}>
                <td className="p-2">{d.itemName}</td>
                <td className="p-2 text-center font-mono">{d.soldQty}</td>
                <td className="p-2 text-center font-mono">{d.ledgerQty}</td>
                <td className={`p-2 text-center font-bold font-mono ${d.drift > 0 ? 'text-red-600' : 'text-blue-600'}`}>
                  {d.drift > 0 ? `+${d.drift}` : d.drift}
                </td>
                <td className="p-2 text-center text-xs">
                  {d.drift > 0 ? '⚠️ Under-recorded' : '🔍 Over-recorded'}
                </td>
              </tr>
            ))}
            {!report.discrepancies.length && (
              <tr>
                <td colSpan={5} className="p-8 text-center text-green-600 font-medium">
                  Perfect alignment! No inventory drift detected in this period.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-4 text-xs text-gray-500 italic">
        * Drift represents the difference between items sold in POS and quantity decrements recorded in the inventory ledger. 
        Positive drift (+) means items were sold but inventory wasn't decremented. 
        Negative drift (-) means inventory was decremented more than what was recorded as sold.
      </p>
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
      <div className="ds-table-container">
        <table className="ds-table">
          <thead><tr><th className="p-2 text-left">GRN Number</th><th className="p-2">Date</th><th className="p-2 hide-on-mobile">Supplier</th><th className="p-2 text-right">Value</th></tr></thead>
          <tbody>
             {grvFiltered.map((r, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="p-2 font-mono text-xs">{String(r.grn_number)}</td>
                  <td className="p-2 text-xs">{String(new Date(r.inserted_at).toLocaleDateString())}</td>
                  <td className="p-2 hide-on-mobile">{String(r.supplier_name)}</td>
                  <td className="p-2 text-right font-mono">{formatCurrency(Number(r.total_value || 0))}</td>
                </tr>
             ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const ItemSalesReportView: React.FC<{ itemsRows: any[] }> = ({ itemsRows }) => {
  const [itemSort, setItemSort] = React.useState<'qty' | 'revenue' | 'profit'>('revenue');
  
  const sorted = React.useMemo(() => {
    return [...itemsRows].sort((a, b) => {
      if (itemSort === 'qty') return b.qty - a.qty;
      if (itemSort === 'revenue') return b.revenue - a.revenue;
      if (itemSort === 'profit') return b.profit - a.profit;
      return 0;
    });
  }, [itemsRows, itemSort]);

  return (
    <div className="mb-6">
      <h3 className="text-lg font-semibold mb-2">Item-wise Sales Performance</h3>
      <div className="flex gap-2 mb-3">
        <Button variant={itemSort==='qty'?'secondary':'outline'} onClick={()=>setItemSort('qty')}>Sort by Qty</Button>
        <Button variant={itemSort==='revenue'?'secondary':'outline'} onClick={()=>setItemSort('revenue')}>Sort by Revenue</Button>
        <Button variant={itemSort==='profit'?'secondary':'outline'} onClick={()=>setItemSort('profit')}>Sort by Profit</Button>
      </div>
      <div className="ds-table-container">
        <table className="ds-table">
          <thead>
            <tr>
              <th className="p-2 text-left">Item Name</th>
              <th className="p-2 text-right">Qty Sold</th>
              <th className="p-2 text-right">Revenue</th>
              <th className="p-2 text-right hide-on-mobile">Cost (COGS)</th>
              <th className="p-2 text-right font-bold">Profit</th>
              <th className="p-2 text-right hide-on-mobile">Margin</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => (
              <tr key={i}>
                <td className="p-2 font-medium text-xs sm:text-sm">{String(r.name)}</td>
                <td className="p-2 text-right">{String(r.qty)}</td>
                <td className="p-2 text-right font-mono">{formatCurrency(r.revenue)}</td>
                <td className="p-2 text-right text-red-600 font-mono hide-on-mobile">{formatCurrency(r.cost)}</td>
                <td className="p-2 text-right font-bold text-green-600 font-mono">{formatCurrency(r.profit)}</td>
                <td className="p-2 text-right text-xs hide-on-mobile">{String(r.revenue ? ((r.profit / r.revenue) * 100).toFixed(1) : 0)}%</td>
              </tr>
            ))}
            {!sorted.length && (<tr><td className="p-2 text-center" colSpan={6}>No item sales found.</td></tr>)}
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
  const [driftReport, setDriftReport] = React.useState<ReconciliationReport | null>(null);
  const fetchData = React.useCallback(async () => {

      setLoading(true);
      try {
        const isConfigured = await db.isConfigured();
        if (!isConfigured) return;

        // Fetch POS Bills and Orders (Unified Sales)
        const [billsRes, ordersRes] = await Promise.all([
          db.query(
            `SELECT * FROM pos_bills WHERE DATE(opened_at) >= $1 AND DATE(opened_at) <= $2`,
            [range.start, range.end]
          ),
          db.query(
            `SELECT * FROM pos_orders WHERE status = 'closed' AND DATE(created_at) >= $1 AND DATE(created_at) <= $2`,
            [range.start, range.end]
          )
        ]);

        const processedBills = [];
        
if(!('error' in billsRes)) {
  (billsRes.rows || []).forEach((row: any) => {
    if ((row.outlet || '').toLowerCase().includes('room') || (row.outlet || '').toLowerCase().includes('front')) return; // POS only
    processedBills.push({
      ...row,
      id: row.id,
      outlet: row.outlet || 'Restaurant',
      opened_at: row.opened_at,
      items: typeof row.items === 'string' ? JSON.parse(row.items) : (row.items || []),
      total_amount: Number(row.total_amount || 0),
      is_voided: !!row.is_voided,
      staff: row.opened_by || 'System',
      shift_id: row.shift_id,
      payment_method: row.payment_method || null
    });
  });
}

if(!('error' in ordersRes)) {
  (ordersRes.rows || []).forEach((row: any) => {
    processedBills.push({
      ...row,
      id: row.id,
      outlet: row.cost_center || 'Restaurant',
      opened_at: row.created_at, // Map created_at to opened_at
      items: typeof row.items === 'string' ? JSON.parse(row.items) : (row.items || []),
      total_amount: Number(row.total_amount || 0),
      is_voided: false, // Orders table doesn't have voided flag usually
      staff: 'System', // Orders table doesn't have staff usually
      shift_id: row.shift_id,
      payment_method: row.payment_method || null
    });
  });
}
      setDbPosBills(processedBills);

      // Fetch GRNs
      const grnsRes = await db.query(
        `SELECT * FROM inv_grn_headers WHERE DATE(inserted_at) >= $1 AND DATE(inserted_at) <= $2`,
        [range.start, range.end]
      );
      if(!('error' in grnsRes)) setDbGrns(grnsRes.rows || []);

      // Fetch Movements from New Stock Ledger (v11)
      const movRes = await db.query(
        `SELECT l.*, i.name FROM inv_stock_ledger l 
         LEFT JOIN inv_items i ON l.item_id = i.id 
         WHERE DATE(l.inserted_at) >= $1 AND DATE(l.inserted_at) <= $2`,
        [range.start, range.end]
      );
      if(!('error' in movRes)) {
        // Normalize v11 ledger to old movement format for UI
        const normalizedMovs = (movRes.rows || []).map((l: any) => ({
          ...l,
          delta: l.quantity_change,
          inserted_at: l.inserted_at
        }));
        setDbMovements(normalizedMovs);
      }

      // Fetch items from New Inventory (v11)
      const invRes = await db.query(`SELECT id, name, weighted_avg_cost as cost FROM inv_items`);
      if(!('error' in invRes)) setDbInventoryItems(invRes.rows || []);

    } catch (err) {
      console.error('Failed to fetch report data from DB', err);
    } finally {
      if (selectedReport === 'drift-audit') {
        const audit = await ReconciliationService.runAudit(range.start, range.end);
        setDriftReport(audit);
      }

      setLoading(false);
    }
  }, [range, selectedReport]);


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
    const map = new Map<string, { itemsSold: number; grossSales: number; discounts: number; netSales: number; cogs: number }>();
    
    // Create an ID index for better accuracy
    const itemIndexById = new Map<string, any>();
    dbInventoryItems.forEach((it: any) => itemIndexById.set(String(it.id), it));

    nonVoidedBills.forEach((bill: any) => {
      (bill.items || []).forEach((d: any) => {
        // Handle both formats: flat (pos_bills) or nested menuItem (pos_orders)
        const qty = Number(d.quantity || 0);
        const price = Number(d.price || d.menuItem?.price || 0);
        const id = String(d.id || d.itemId || d.menuItem?.id || '');
        const name = d.name || d.menuItem?.name || 'Unknown Item';
        
        // Find cost from inventory (Try ID first, then Name)
        const itemObj = itemIndexById.get(id) || itemIndexByName.get(name.toLowerCase());
        const cost = itemObj ? Number(itemObj.cost || 0) : 0;

        const catName = bill.outlet || 'Restaurant';
        
        const row = map.get(catName) || { itemsSold: 0, grossSales: 0, discounts: 0, netSales: 0, cogs: 0 };
        row.itemsSold += qty; 
        row.grossSales += qty * price; 
        row.cogs += qty * cost;
        row.netSales = row.grossSales - row.discounts;
        map.set(catName, row);
      });
    });
    const totalGross = Array.from(map.values()).reduce((s, r) => s + r.grossSales, 0);
    return { rows: Array.from(map.entries()).map(([name, r]) => ({ name, ...r, percent: totalGross ? (r.grossSales / totalGross) * 100 : 0, profit: r.netSales - r.cogs })), totalGross };
  }, [nonVoidedBills, itemIndexByName, dbInventoryItems]);

  const paymentSummary = React.useMemo(() => {
    const map = new Map<string, number>();
    nonVoidedBills.forEach((bill: any) => {
       const method = (bill.payment_method || 'Unknown').toUpperCase();
       map.set(method, (map.get(method) || 0) + Number(bill.total_amount || 0));
    });
    return Array.from(map.entries()).map(([method, total]) => ({ method, total }));
  }, [nonVoidedBills]);

  const itemSalesSummary = React.useMemo(() => {
    const map = new Map<string, { id: string; name: string; qty: number; revenue: number; cost: number; profit: number }>();
    
    // Create an ID index for better accuracy
    const itemIndexById = new Map<string, any>();
    dbInventoryItems.forEach((it: any) => itemIndexById.set(String(it.id), it));

    nonVoidedBills.forEach((bill: any) => {
      (bill.items || []).forEach((d: any) => {
        // Handle both formats: flat (pos_bills) or nested menuItem (pos_orders)
        const id = String(d.id || d.itemId || d.menuItem?.id || '');
        const name = d.name || d.menuItem?.name || 'Unknown Item';
        const qty = Number(d.quantity || 0);
        const price = Number(d.price || d.menuItem?.price || 0);
        
        // Find cost from inventory (Try ID first, then Name)
        const itemObj = itemIndexById.get(id) || itemIndexByName.get(name.toLowerCase());
        const cost = itemObj ? Number(itemObj.cost || 0) : 0;

        const key = id || name;
        const row = map.get(key) || { id, name, qty: 0, revenue: 0, cost: 0, profit: 0 };
        row.qty += qty;
        row.revenue += qty * price;
        row.cost += qty * cost;
        row.profit = row.revenue - row.cost;
        map.set(key, row);
      });
    });
    return Array.from(map.values());
  }, [nonVoidedBills, itemIndexByName, dbInventoryItems]);

  const staffSummary = React.useMemo(() => {
    const map = new Map<string, { bills: number; totalSales: number }>();
    nonVoidedBills.forEach((bill: any) => {
       const staff = bill.staff || bill.opened_by || 'System';
       const current = map.get(staff) || { bills: 0, totalSales: 0 };
       current.bills += 1;
       current.totalSales += Number(bill.total_amount || 0);
       map.set(staff, current);
    });
    return Array.from(map.entries()).sort((a,b) => b[1].totalSales - a[1].totalSales);
  }, [nonVoidedBills]);

  const detailedRowsByCategory = React.useMemo(() => {
    const groups = new Map<string, any[]>();
    nonVoidedBills.forEach((bill: any) => {
      (bill.items || []).forEach((d: any) => {
        const catName = bill.outlet || 'Restaurant';
        const qty = Number(d.quantity || 0);
        const price = Number(d.price || d.menuItem?.price || 0);
        const desc = d.name || d.menuItem?.name || 'Unknown Item';
        
        const arr = groups.get(catName) || [];
        arr.push({ ts: bill.opened_at, sku: d.id || d.menuItem?.id || '', desc: desc, qty, unit: price, total: qty * price });
        groups.set(catName, arr);
      });
    });
    return groups;
  }, [nonVoidedBills]);

  const fetchCocktailUsage = React.useCallback(async () => {
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

  React.useEffect(() => {
    fetchData();
    fetchCocktailUsage();
  }, [fetchData, fetchCocktailUsage]);


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
              <SelectItem value="payment-methods">Payment Methods</SelectItem>
              <SelectItem value="item-sales">Item Sales</SelectItem>
              <SelectItem value="staff-performance">Staff Performance</SelectItem>
              <SelectItem value="cocktail-usage">Cocktail Usage</SelectItem>
              <SelectItem value="goods-received">Goods Received</SelectItem>
              <SelectItem value="voids">Voids</SelectItem>
              <SelectItem value="stock-movement">Movement</SelectItem>
              <SelectItem value="drift-audit">Inventory Drift Audit</SelectItem>
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
        <div className="flex gap-2 ml-auto no-print">
          <Button variant="outline" size="sm" onClick={() => fetchData()} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => window.print()}>
            <Printer className="w-4 h-4 mr-2" />
            Print
          </Button>
        </div>
      </div>
      
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
          .ds-card { border: none !important; box-shadow: none !important; padding: 0 !important; }
          .ds-table { border-collapse: collapse !important; width: 100% !important; }
          .ds-table th, .ds-table td { border: 1px solid #ddd !important; padding: 8px !important; }
          thead { display: table-header-group; }
          tr { page-break-inside: avoid; }
        }
      `}</style>
      {loading && <div className="py-8 text-center text-gray-500">Loading Database Records...</div>}
      
      {!loading && selectedReport === 'x-summary' && (
        <div>
          <h3 className="font-bold mb-2">Category Financial Summary (COGS & Profit)</h3>
          <table className="ds-table">
            <thead><tr><th>Outlet</th><th className="right">Sold</th><th className="right">Gross Sales</th><th className="right">COGS</th><th className="right">Gross Profit</th><th className="right">Margin %</th></tr></thead>
            <tbody>
              {categorySummary.rows.map(r => (<tr key={r.name}><td>{r.name}</td><td className="right">{r.itemsSold}</td><td className="right">{formatCurrency(r.grossSales)}</td><td className="right text-red-600">-{formatCurrency(r.cogs)}</td><td className="right font-bold text-green-600">{formatCurrency(r.profit)}</td><td className="right">{r.grossSales ? ((r.profit / r.grossSales) * 100).toFixed(1) : 0}%</td></tr>))}
              {categorySummary.rows.length === 0 && <tr><td colSpan={6} className="text-center p-4">No Sales found in range</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {!loading && selectedReport === 'payment-methods' && (
        <div className="max-w-xl">
          <h3 className="font-bold mb-2">Payment Method Breakdown</h3>
          <table className="ds-table">
            <thead><tr><th>Method</th><th className="right">Total Expected</th></tr></thead>
            <tbody>
              {paymentSummary.map(p => (
                <tr key={p.method} className="border-b">
                  <td>{String(p.method)}</td>
                  <td className="right font-bold">{formatCurrency(p.total)}</td>
                </tr>
              ))}
              {paymentSummary.length === 0 && <tr><td colSpan={2} className="text-center p-4">No payments recorded</td></tr>}
            </tbody>
          </table>
          <p className="text-xs text-gray-500 mt-2">Use this total to reconcile your physical cash drawer vs card machine printouts at Z-reading.</p>
        </div>
      )}

      {!loading && selectedReport === 'item-sales' && (
        <ItemSalesReportView itemsRows={itemSalesSummary} />
      )}

      {!loading && selectedReport === 'staff-performance' && (
        <div className="max-w-2xl">
          <h3 className="font-bold mb-2">Staff Sales Performance</h3>
          <table className="ds-table">
            <thead><tr><th>Staff Member (Opened By)</th><th className="right">Total Bills Handled</th><th className="right">Total Sales Captured</th></tr></thead>
            <tbody>
              {staffSummary.map(([staff, data]) => (
                <tr key={staff} className="border-b">
                  <td>{String(staff)}</td>
                  <td className="right">{String(data.bills)}</td>
                  <td className="right font-bold">{formatCurrency(data.totalSales)}</td>
                </tr>
              ))}
              {staffSummary.length === 0 && <tr><td colSpan={3} className="text-center p-4">No staff sales recorded</td></tr>}
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
                  {rows.map((r, i) => (
                    <tr key={i} className="border-b hover:bg-gray-50">
                      <td className="text-xs">{String(new Date(r.ts).toLocaleString())}</td>
                      <td>{String(r.desc)}</td>
                      <td className="right">{String(r.qty)}</td>
                      <td className="right">{formatCurrency(r.total)}</td>
                    </tr>
                  ))}
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
          <tbody>
            {cocktailUsageData.usageRows.map((r, i) => (
              <tr key={i} className="border-b">
                <td>{String(r.name)}</td>
                <td>{String(r.unit)}</td>
                <td className="right">{String(r.used.toFixed(2))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {!loading && selectedReport === 'goods-received' && <GoodsReceivedReportView rangeText={`${range.start} to ${range.end}`} grnRows={dbGrns} />}
      {!loading && selectedReport === 'voids' && <VoidsReportView voidsRows={voidedBills} />}
      {!loading && selectedReport === 'stock-movement' && <StockMovementReportView movementRows={dbMovements} />}
      {!loading && selectedReport === 'drift-audit' && <DriftAuditReportView report={driftReport} />}
    </div>
  );
};

export default PosReports;
