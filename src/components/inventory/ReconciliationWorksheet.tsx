import React, { useEffect, useState } from 'react';
import { InventoryService, ReconciliationRow } from '@/lib/InventoryService';
import { db } from '@/lib/db';
import { toast } from 'sonner';
import { Loader2, Save, XCircle, ArrowLeft, Info, AlertTriangle, TrendingDown, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHeader, TableHead, TableRow } from '@/components/ui/table';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { useAuth } from '@/context/AuthContext';

interface Props {
  periodId: string;
}

export const ReconciliationWorksheet: React.FC<Props> = ({ periodId }) => {
  const { user } = useAuth();
  const [data, setData] = useState<ReconciliationRow[]>([]);
  const [period, setPeriod] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const pRes = await db.query('SELECT * FROM inventory_periods WHERE id = $1', [periodId]);
      if (pRes.rows?.[0]) setPeriod(pRes.rows[0]);
      
      const worksheet = await InventoryService.getReconciliationWorksheet(periodId);
      setData(worksheet);
    } catch (err) {
      toast.error('Failed to load worksheet');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [periodId]);

  const handleUpdatePhysical = async (productId: string, val: string) => {
    const num = parseFloat(val);
    if (isNaN(num)) return;

    try {
      await InventoryService.updatePhysicalCount(periodId, productId, num);
      // Update local state without full refetch for smoothness
      setData(prev => prev.map(row => {
        if (row.product_id === productId) {
          const expected = Number(row.expected_qty);
          return { ...row, physical_qty: num, variance: num - expected };
        }
        return row;
      }));
    } catch (err) {
      toast.error('Failed to update count');
    }
  };

  const handleClosePeriod = async () => {
    const incomplete = data.some(r => r.physical_qty === null);
    if (incomplete) {
      toast.error('Cannot close period. Some items are missing physical counts.');
      return;
    }

    if (!confirm('Are you sure you want to CLOSE this period? This action is immutable and will rollover stock levels.')) return;

    setSaving(true);
    const res = await InventoryService.closePeriod(periodId, user?.id || 'system-audit');
    if (res.success) {
      toast.success('Period closed successfully. Stock levels updated.');
      fetchData();
    } else {
      toast.error(res.error || 'Closure failed');
    }
    setSaving(false);
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-12 w-12 animate-spin text-blue-500" /></div>;

  const isClosed = period?.status === 'closed';

  return (
    <div className="p-8 space-y-6">
      <div className="flex justify-between items-center bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
        <div className="flex items-center gap-6">
          <Button variant="ghost" onClick={() => window.dispatchEvent(new CustomEvent('navigateToModule', { detail: { module: 'inventory' } }))} className="h-12 w-12 p-0 rounded-2xl hover:bg-slate-50">
            <ArrowLeft className="h-6 w-6 text-slate-400" />
          </Button>
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <h2 className="text-3xl font-black text-slate-800 tracking-tight">{period?.name}</h2>
              {isClosed && <span className="bg-slate-100 text-slate-500 text-xs font-bold px-2 py-1 rounded">CLOSED</span>}
            </div>
            <p className="text-slate-400 font-medium">Reconciliation & Physical Stock Audit</p>
          </div>
        </div>
        
        {!isClosed && (
          <Button onClick={handleClosePeriod} disabled={saving} className="bg-green-600 hover:bg-green-700 h-14 px-8 shadow-xl font-black uppercase tracking-wider transition-all duration-300 transform hover:scale-105 rounded-2xl">
            {saving ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Save className="mr-2 h-5 w-5" />}
            Finalize & Close Period
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <Card className="rounded-3xl border-0 shadow-sm bg-blue-50 text-blue-900 overflow-hidden">
            <CardHeader className="pb-2">
                <CardTitle className="text-xs font-black uppercase tracking-widest opacity-60">Items Reconciled</CardTitle>
            </CardHeader>
            <CardContent>
                <div className="text-4xl font-black">{data.filter(r => r.physical_qty !== null).length} / {data.length}</div>
            </CardContent>
          </Card>
          <Card className={`rounded-3xl border-0 shadow-sm overflow-hidden ${data.some(r => r.variance < 0) ? 'bg-red-50 text-red-900 uppercase' : 'bg-green-50 text-green-900 uppercase'}`}>
            <CardHeader className="pb-2">
                <CardTitle className="text-xs font-black tracking-widest opacity-60">Total Variances</CardTitle>
            </CardHeader>
            <CardContent>
                <div className="text-4xl font-black">
                    {data.reduce((acc, r) => acc + (r.variance || 0), 0) > 0 ? '+' : ''}
                    {data.reduce((acc, r) => acc + (r.variance || 0), 0).toFixed(2)}
                </div>
            </CardContent>
          </Card>
      </div>

      <div className="bg-white rounded-[2.5rem] shadow-xl border border-slate-100 overflow-hidden">
        <Table>
          <TableHeader className="bg-slate-50/50">
            <TableRow className="border-b-2 border-slate-100 hover:bg-transparent">
              <TableHead className="font-black text-slate-800 p-6">Stock Item</TableHead>
              <TableHead className="font-black text-slate-800 text-center">Unit</TableHead>
              <TableHead className="font-black text-slate-800 text-center bg-blue-50/30">Opening</TableHead>
              <TableHead className="font-black text-slate-800 text-center bg-blue-50/30">Received (+)</TableHead>
              <TableHead className="font-black text-slate-800 text-center bg-red-50/30">Usage (-)</TableHead>
              <TableHead className="font-black text-slate-800 text-center font-bold">Expected</TableHead>
              <TableHead className="font-black text-blue-600 text-center min-w-[200px]">Actual Physical</TableHead>
              <TableHead className="font-black text-slate-800 text-center">Variance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((row) => (
              <TableRow key={row.product_id} className="hover:bg-slate-50 transition-colors group">
                <TableCell className="p-6">
                    <div className="font-extrabold text-slate-700">{row.product_name}</div>
                    <div className="text-[10px] text-slate-400 font-bold tracking-tight">ID: {row.product_id.slice(0,8)}</div>
                </TableCell>
                <TableCell className="text-center font-bold text-slate-500 uppercase text-xs tracking-widest">{row.unit || 'n/a'}</TableCell>
                <TableCell className="text-center font-medium bg-blue-50/10 text-slate-600">{row.opening_qty}</TableCell>
                <TableCell className="text-center font-medium bg-blue-50/10 text-slate-600">{row.received_qty}</TableCell>
                <TableCell className="text-center font-medium bg-red-50/10 text-slate-600">{row.system_usage_qty}</TableCell>
                <TableCell className="text-center font-black text-slate-600">{row.expected_qty}</TableCell>
                <TableCell className="p-4 px-8 min-w-[200px]">
                  <Input 
                    type="number" 
                    value={row.physical_qty ?? ''} 
                    onChange={(e) => handleUpdatePhysical(row.product_id, e.target.value)}
                    disabled={isClosed}
                    className={`h-12 text-lg font-black text-center border-2 rounded-2xl transition-all duration-200 ${row.physical_qty === null ? 'border-amber-300 bg-amber-50 animate-pulse' : 'border-slate-100 focus:border-blue-500'}`}
                    placeholder="Enter Count..."
                  />
                </TableCell>
                <TableCell className="text-center">
                  {row.physical_qty !== null ? (
                    <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-black ${row.variance < 0 ? 'bg-red-100 text-red-600 shadow-sm shadow-red-100' : row.variance > 0 ? 'bg-green-100 text-green-600 shadow-sm shadow-green-100' : 'bg-slate-100 text-slate-500'}`}>
                        {row.variance < 0 ? <TrendingDown className="h-4 w-4" /> : row.variance > 0 ? <TrendingUp className="h-4 w-4" /> : <Info className="h-4 w-4" />}
                        {row.variance > 0 ? '+' : ''}{row.variance}
                    </div>
                  ) : <span className="text-slate-300 font-bold text-xs uppercase tracking-widest">Awaiting Count</span>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      
      {!isClosed && (
        <div className="bg-amber-50 border-2 border-amber-200 border-dashed rounded-[2.5rem] p-8 mt-8 flex gap-6 items-start shadow-inner">
            <AlertTriangle className="h-12 w-12 text-amber-500 shrink-0 mt-1" />
            <div className="space-y-2">
                <h4 className="text-xl font-bold text-amber-900">Important Period Closing Policy</h4>
                <p className="text-amber-700 font-medium leading-relaxed">Closing this period will perform three irreversible actions: 1. Generate opening stock for the next period. 2. Lock all transactions within this date range. 3. Sync the global property product stock levels to these counts. Please perform a double audit on high-variance items before proceeding.</p>
            </div>
        </div>
      )}
    </div>
  );
};
