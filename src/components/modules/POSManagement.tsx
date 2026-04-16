import React, { useState, useEffect, useMemo } from 'react';
import { db } from '@/lib/db';
import { useAuth } from '@/context/AuthContext';
import { useData } from '@/context/DataContext';
import { TableCard } from '@/components/posimport/TableCard';
import { formatCurrency } from '@/lib/posIntegration';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';

interface TableStatus {
  table_id: string;
  number: number;
  status: 'available' | 'occupied' | 'suspended';
  cost_center: string;
  currentBill?: any;
}

export const POSManagement: React.FC = () => {
  const { user } = useAuth();
  const { closePosOrder } = useData();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [allTables, setAllTables] = useState<TableStatus[]>([]);
  const [filterCentre, setFilterCentre] = useState<string>('all');
  const [search, setSearch] = useState('');

  const fetchAllStatus = async () => {
    setLoading(true);
    try {
      // 1. Fetch table_status from DB
      const res = await db.query(`SELECT table_id, status, cost_center FROM table_status`);
      const rows = (res && 'rows' in res && Array.isArray(res.rows)) ? res.rows : [];
      
      // 2. Fetch active orders from DataContext (proxy via localStorage for now if needed, or better, use the same DB logic)
      // For a Management Module, we want the source of truth.
      const ordersRes = await db.query(`SELECT table_id, items, total, cost_center FROM pos_orders WHERE status = 'open'`);
      const activeOrders = (ordersRes && 'rows' in ordersRes && Array.isArray(ordersRes.rows)) ? ordersRes.rows : [];
      
      const ordersMap = new Map();
      activeOrders.forEach(o => {
        ordersMap.set(`${o.cost_center}:${o.table_id}`, { id: o.table_id, total: Number(o.total), items: o.items });
      });

      // 3. Construct the full view
      // We'll group by cost centre. If a cost centre exists in table_status, we show its tables.
      const tables: TableStatus[] = rows.map(r => ({
        table_id: r.table_id,
        number: parseInt(r.table_id.replace(/\D/g, '') || '0'),
        status: r.status === 'open' ? 'available' : (r.status === 'closed' ? 'suspended' : 'occupied'),
        cost_center: r.cost_center,
        currentBill: ordersMap.get(`${r.cost_center}:${r.table_id}`)
      }));

      setAllTables(tables);
    } catch (err) {
      console.error('Failed to fetch management status', err);
      toast({ title: 'Error', description: 'Failed to sync with POS stations', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAllStatus();
    const iv = setInterval(fetchAllStatus, 30000); // Sync every 30s
    return () => clearInterval(iv);
  }, []);

  const centres = useMemo(() => ['all', ...Array.from(new Set(allTables.map(t => t.cost_center)))], [allTables]);

  const clearBill = async (tableId: string, costCenter: string) => {
    try {
      // Allow clearing even if there's no active bill
      const success = await closePosOrder(tableId, costCenter || undefined);
      if (success) {
        toast({ title: 'Bill Cleared', description: `Table ${tableId} has been cleared.` });
        // Refresh the data
        await fetchAllStatus();
      } else {
        toast({ title: 'Clear Failed', description: 'Unable to clear the table bill.', variant: 'destructive' });
      }
    } catch (error) {
      console.error('Clear bill error:', error);
      toast({ title: 'Clear Failed', description: 'An error occurred while clearing the bill.', variant: 'destructive' });
    }
  };

  const filtered = useMemo(() => {
    return allTables.filter(t => 
      (filterCentre === 'all' || t.cost_center === filterCentre) &&
      (search === '' || String(t.number).includes(search) || t.cost_center.toLowerCase().includes(search.toLowerCase()))
    ).sort((a,b) => a.cost_center.localeCompare(b.cost_center) || a.number - b.number);
  }, [allTables, filterCentre, search]);

  const stats = useMemo(() => {
    const totalBills = allTables.filter(t => t.currentBill).length;
    const totalValue = allTables.reduce((s, t) => s + (t.currentBill?.total || 0), 0);
    const occupied = allTables.filter(t => t.status === 'occupied').length;
    return { totalBills, totalValue, occupied };
  }, [allTables]);

  if (!user || (user.role !== 'admin' && user.role !== 'manager')) {
    return <div className="p-8 text-center bg-white rounded-xl shadow">Manager Authorization Required</div>;
  }

  return (
    <div className="p-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">POS Master Management</h2>
          <p className="text-sm text-gray-500">Global overview of all cost centres and active tables</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="bg-blue-50 border border-blue-200 px-4 py-2 rounded-lg text-center">
            <div className="text-xs text-blue-600 font-bold uppercase tracking-tighter">Active Bills</div>
            <div className="text-xl font-black text-blue-700">{stats.totalBills}</div>
          </div>
          <div className="bg-emerald-50 border border-emerald-200 px-4 py-2 rounded-lg text-center">
            <div className="text-xs text-emerald-600 font-bold uppercase tracking-tighter">Live Revenue</div>
            <div className="text-xl font-black text-emerald-700">{formatCurrency(stats.totalValue)}</div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow p-4 mb-6 sticky top-0 z-20">
        <div className="flex flex-wrap gap-4 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="text-xs font-bold mb-1 block">Search Station / Table</label>
            <Input placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="w-56">
            <label className="text-xs font-bold mb-1 block">Cost Centre Filter</label>
            <Select value={filterCentre} onValueChange={setFilterCentre}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {centres.map(c => <SelectItem key={c} value={c}>{c === 'all' ? 'All Outlets' : c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={fetchAllStatus} disabled={loading} variant="outline">
            {loading ? 'Syncing...' : 'Force Refresh'}
          </Button>
        </div>
      </div>

      {loading && allTables.length === 0 ? (
        <div className="text-center p-12 text-gray-400">Initial sync in progress...</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-6">
          {filtered.map(table => (
            <TableCard
              key={`${table.cost_center}-${table.table_id}`}
              table={{
                id: table.table_id,
                number: table.number,
                status: table.status,
                cost_center: table.cost_center,
                currentBill: table.currentBill
              }}
              onClick={() => {
                toast({ title: `Table ${table.number} - ${table.cost_center}`, description: table.currentBill ? `Active Bill: ${formatCurrency(table.currentBill.total)}` : 'Available' });
              }}
              onClearBill={() => clearBill(table.table_id, table.cost_center)}
            />
          ))}
          {filtered.length === 0 && (
            <div className="col-span-full py-12 text-center text-gray-400 italic">No tables found matching criteria</div>
          )}
        </div>
      )}
    </div>
  );
};
