import React, { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { InventoryService, InventoryPeriod } from '@/lib/InventoryService';
import { db } from '@/lib/db';
import { toast } from 'sonner';
import { Loader2, Plus, History, CheckCircle2, AlertCircle, Lock } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/context/AuthContext';

export const InventoryDashboard: React.FC = () => {
  const { user } = useAuth();
  const [periods, setPeriods] = useState<InventoryPeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [closingPeriodId, setClosingPeriodId] = useState<string | null>(null);

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newPeriodName, setNewPeriodName] = useState('');
  const [newPeriodStart, setNewPeriodStart] = useState(new Date().toISOString().split('T')[0]);
  const [newPeriodEnd, setNewPeriodEnd] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const fetchPeriods = async () => {
    setLoading(true);
    try {
      const res = await db.query('SELECT * FROM inventory_periods ORDER BY start_date DESC');
      if ('rows' in res && Array.isArray(res.rows)) {
        setPeriods(res.rows as InventoryPeriod[]);
      }
    } catch (err) {
      toast.error('Failed to load inventory periods');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPeriods();
  }, []);

  const handleStartPeriod = async () => {
    if (!newPeriodName.trim() || !newPeriodStart || !newPeriodEnd) {
      toast.error('Please fill in all fields (Name, Start Date, End Date)');
      return;
    }
    
    setIsCreating(true);
    try {
      const res = await InventoryService.startPeriod(newPeriodName.trim(), newPeriodStart, newPeriodEnd);
      if (res.success) {
        toast.success('Period started successfully');
        setShowCreateDialog(false);
        setNewPeriodName('');
        setNewPeriodEnd('');
        fetchPeriods();
      } else {
        toast.error(res.error || 'Failed to start period');
      }
    } catch (err: any) {
      toast.error(err.message || 'Error creating period');
    } finally {
      setIsCreating(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'open': return <Badge variant="secondary" className="bg-green-100 text-green-700">Open</Badge>;
      case 'reconciling': return <Badge variant="outline" className="text-blue-600 border-blue-600">Reconciling</Badge>;
      case 'closed': return <Badge variant="secondary" className="bg-slate-100 text-slate-500">Closed</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="p-8 space-y-8 animate-in fade-in duration-500">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-4xl font-extrabold text-slate-900 tracking-tight">Inventory Reconciliation</h1>
          <p className="text-slate-500 text-lg mt-1 font-medium italic">Track, reconcile and audit your stocks period-by-period.</p>
        </div>
        <div className="flex gap-4">
          <Button variant="outline" onClick={fetchPeriods} className="h-12 px-6">
            <History className="mr-2 h-5 w-5" />
            Refresh
          </Button>
          <Button onClick={() => setShowCreateDialog(true)} className="h-12 px-6 shadow-xl bg-blue-600 hover:bg-blue-700 font-bold">
            <Plus className="mr-2 h-5 w-5" />
            New Period
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="h-12 w-12 text-blue-500 animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {periods.map((period) => (
            <Card key={period.id} className="shadow-lg hover:shadow-2xl transition-all duration-300 group border-2 border-slate-100 overflow-hidden">
              <CardHeader className="bg-slate-50 border-b border-white pb-6">
                <div className="flex justify-between items-start">
                  <div className="space-y-1">
                    <CardTitle className="text-2xl font-bold text-slate-800">{period.name}</CardTitle>
                    <CardDescription className="font-medium text-slate-500">
                      {new Date(period.start_date).toLocaleDateString()} - {new Date(period.end_date).toLocaleDateString()}
                    </CardDescription>
                  </div>
                  {getStatusBadge(period.status)}
                </div>
              </CardHeader>
              <CardContent className="pt-6 space-y-4">
                <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-2xl">
                  {period.status === 'closed' ? <CheckCircle2 className="text-green-500 h-5 w-5" /> : <AlertCircle className="text-amber-500 h-5 w-5" />}
                  <span className="text-sm font-bold text-slate-600">
                    {period.status === 'closed' ? 'Audit Complete' : 'Reconciliation Pending'}
                  </span>
                </div>
                
                <div className="grid grid-cols-1 gap-2 pt-2">
                  <Button variant="outline" className="w-full justify-start font-bold h-11">
                    📝 View Transactions
                  </Button>
                  <Button 
                    className="w-full justify-start font-bold h-11"
                    variant={period.status === 'closed' ? 'outline' : 'default'}
                    onClick={() => {
                        window.dispatchEvent(new CustomEvent('navigateToModule', { 
                            detail: { 
                                module: 'inventory-reconcile', 
                                props: { periodId: period.id } 
                            } 
                        }));
                    }}
                  >
                    🔍 {period.status === 'closed' ? 'Review Reconciliation' : 'Reconcile Period'}
                  </Button>
                  {period.status !== 'closed' && (
                    <Button 
                      variant="destructive" 
                      className="w-full justify-start font-bold h-11"
                      disabled={closingPeriodId === period.id}
                      onClick={async () => {
                        if (!confirm(`Are you sure you want to close period "${period.name}"? This action will finalize stock levels and cannot be undone.`)) return;
                        setClosingPeriodId(period.id);
                        try {
                          const res = await InventoryService.closePeriod(period.id, user?.id || 'system');
                          if (res.success) {
                            toast.success(`Period "${period.name}" closed successfully`);
                            fetchPeriods();
                          } else {
                            toast.error(res.error || 'Failed to close period');
                          }
                        } catch (err: any) {
                          toast.error(err.message || 'Error closing period');
                        } finally {
                          setClosingPeriodId(null);
                        }
                      }}
                    >
                      {closingPeriodId === period.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Lock className="mr-2 h-4 w-4" />}
                      Close Period
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
          {periods.length === 0 && (
            <div className="col-span-full py-20 text-center space-y-4 bg-slate-50 rounded-3xl border-2 border-dashed border-slate-200">
              <div className="text-6xl grayscale opacity-50">📦</div>
              <h3 className="text-xl font-bold text-slate-600">No inventory periods found</h3>
              <p className="text-slate-400">Start by creating your first accounting period above.</p>
              <Button onClick={() => setShowCreateDialog(true)} variant="outline" className="mt-4 border-2 font-bold px-8">
                Initialize Module
              </Button>
            </div>
          )}
        </div>
      )}

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="sm:max-w-[425px] rounded-3xl">
          <DialogHeader>
            <DialogTitle>Create New Period</DialogTitle>
            <DialogDescription>
              Start a new inventory reconciliation period. Ensure your dates do not overlap with existing open periods.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="period-name">Period Name</Label>
              <Input 
                id="period-name" 
                placeholder="e.g. Jan 2026" 
                value={newPeriodName}
                onChange={(e) => setNewPeriodName(e.target.value)}
                className="font-bold border-slate-200 focus-visible:ring-blue-600"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="start-date">Start Date</Label>
                <Input 
                  id="start-date" 
                  type="date"
                  value={newPeriodStart}
                  onChange={(e) => setNewPeriodStart(e.target.value)}
                  className="font-bold border-slate-200 focus-visible:ring-blue-600"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="end-date">End Date</Label>
                <Input 
                  id="end-date" 
                  type="date"
                  value={newPeriodEnd}
                  onChange={(e) => setNewPeriodEnd(e.target.value)}
                  className="font-bold border-slate-200 focus-visible:ring-blue-600"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)} className="rounded-xl font-bold">Cancel</Button>
            <Button onClick={handleStartPeriod} disabled={isCreating} className="rounded-xl bg-blue-600 hover:bg-blue-700 font-bold min-w-[100px]">
              {isCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
