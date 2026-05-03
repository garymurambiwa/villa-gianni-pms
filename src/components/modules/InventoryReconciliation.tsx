import React, { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import db from '@/lib/db';
import { offlineSync } from '@/lib/offlineSync';
import { networkStatus } from '@/lib/networkStatus';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';

interface InventoryPeriod {
  id: string;
  period_name: string;
  period_year: number;
  period_month: number;
  start_date: string;
  end_date: string;
  status: 'future' | 'open' | 'reconciling' | 'closed' | 'locked';
  opening_stock_value: number;
  closing_stock_value: number | null;
  received_value: number;
  variance_value: number | null;
  kitchen_cogs: number;
  cellar_cogs: number;
  closed_at: string | null;
  closed_by: string | null;
  is_locked: boolean;
}

interface InventoryTransaction {
  id: string;
  transaction_type: 'purchase' | 'grv' | 'adjustment' | 'transfer' | 'variance_writeoff';
  transaction_number: string;
  period_id: string | null;
  transaction_date: string;
  department: string;
  total_quantity: number;
  total_value: number;
  supplier_name: string | null;
  is_deleted: boolean;
  created_by: string | null;
}

interface InventoryReconciliation {
  id: string;
  period_id: string;
  reconciliation_number: string;
  reconciliation_date: string;
  kitchen_opening_qty: number;
  kitchen_received_qty: number;
  kitchen_physical_qty: number | null;
  kitchen_variance_qty: number | null;
  kitchen_variance_value: number | null;
  cellar_opening_qty: number;
  cellar_received_qty: number;
  cellar_physical_qty: number | null;
  cellar_variance_qty: number | null;
  cellar_variance_value: number | null;
  total_opening_value: number;
  total_received_value: number;
  total_physical_value: number | null;
  total_variance_value: number | null;
  status: 'draft' | 'review' | 'confirmed' | 'reversed';
}

interface Product {
  id: string;
  name: string;
  department: 'Kitchen' | 'Cellar';
  stock_level: number;
  cost_price: number;
  last_inventory_period_id: string | null;
  last_physical_qty: number | null;
  last_physical_date: string | null;
}

const getStatusColor = (status: string) => {
  switch (status) {
    case 'future': return 'bg-gray-100 text-gray-800';
    case 'open': return 'bg-green-100 text-green-800';
    case 'reconciling': return 'bg-amber-100 text-amber-800';
    case 'closed': return 'bg-blue-100 text-blue-800';
    case 'locked': return 'bg-red-100 text-red-800';
    default: return 'bg-gray-100 text-gray-800';
  }
};

export const InventoryReconciliation: React.FC = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  
  const [periods, setPeriods] = useState<InventoryPeriod[]>([]);
  const [transactions, setTransactions] = useState<InventoryTransaction[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState<InventoryPeriod | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCloseDialog, setShowCloseDialog] = useState(false);
  const [showBatchReconDialog, setShowBatchReconDialog] = useState(false);
  const [showNewPeriodDialog, setShowNewPeriodDialog] = useState(false);
  const [showBackfillDialog, setShowBackfillDialog] = useState(false);
  const [batchData, setBatchData] = useState<Record<string, { physicalQty: number; costPrice?: number }>>({});
  
  const [newPeriod, setNewPeriod] = useState({
    periodYear: new Date().getFullYear(),
    periodMonth: new Date().getMonth() + 1,
    startDate: '',
    endDate: '',
    isInitial: false
  });
  
  const [physicalCounts, setPhysicalCounts] = useState<Record<string, number>>({});
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());
  const [closeReason, setCloseReason] = useState('');
  
  const [syncStatus, setSyncStatus] = useState<{ pending: number; isOnline: boolean; isSyncing: boolean }>({
    pending: 0,
    isOnline: networkStatus.isOnline(),
    isSyncing: false
  });

  // Monitor sync status
  useEffect(() => {
    const updateStatus = async () => {
      const count = await offlineSync.getPendingCount();
      setSyncStatus(prev => ({ ...prev, pending: count, isOnline: networkStatus.isOnline() }));
    };

    updateStatus();
    const subNet = networkStatus.subscribe(() => updateStatus());
    const subSync = offlineSync.subscribe((p) => {
      updateStatus();
      setSyncStatus(prev => ({ ...prev, isSyncing: p.status === 'syncing' }));
    });

    return () => {
      subNet();
      subSync();
    };
  }, []);

  const handleForceSync = async () => {
    setSyncStatus(prev => ({ ...prev, isSyncing: true }));
    try {
      const res = await offlineSync.triggerSync();
      if (res.failed > 0) {
        toast({ 
          title: 'Sync completed with errors', 
          description: `Synced ${res.success} items, but ${res.failed} failed. Check console for details.`,
          variant: 'destructive'
        });
        // Reload anyway to show what was synced
        loadData();
      } else if (res.success > 0) {
        toast({ title: 'Sync successful', description: `Successfully saved ${res.success} pending items.` });
        loadData();
      } else {
        toast({ title: 'Sync completed', description: 'No pending items needed syncing.' });
      }
    } catch (e: any) {
      toast({ title: 'Sync failed', description: e.message, variant: 'destructive' });
    } finally {
      setSyncStatus(prev => ({ ...prev, isSyncing: false }));
    }
  };


  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const periodRes = await db.query(
        'SELECT * FROM inventory_periods ORDER BY period_year DESC, period_month DESC'
      );
      
      const count = await offlineSync.getPendingCount();
      setSyncStatus(prev => ({ ...prev, pending: count }));

      if ('rows' in periodRes) {
        setPeriods(periodRes.rows as InventoryPeriod[]);
      }
      
      const txRes = await db.query(
        'SELECT * FROM inventory_transactions WHERE is_deleted = false ORDER BY transaction_date DESC LIMIT 100'
      );
      if ('rows' in txRes) {
        setTransactions(txRes.rows as InventoryTransaction[]);
      }
    } catch (e: any) {
      console.error('Load data error:', e);
      setPeriods([]);
      setTransactions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const loadProducts = async (periodId: string) => {
    try {
      const prodRes = await db.query(
        `SELECT p.id, p.name, p.department, p.stock_level, p.cost_price, 
         p.last_inventory_period_id, p.last_physical_qty, p.last_physical_date
         FROM products p 
         WHERE p.is_stock_item = true AND p.department IN ('Kitchen', 'Cellar')
         ORDER BY p.department, p.name`
      );
      if ('rows' in prodRes) {
        setProducts(prodRes.rows as Product[]);
      }
    } catch (e: any) {
      console.error('Load products error:', e);
      setProducts([]);
    }
  };

   const createPeriod = async () => {
     if (!newPeriod.startDate || !newPeriod.endDate) {
       toast({ title: 'Please select start and end dates', variant: 'destructive' });
       return;
     }

     try {
       const existingRes = await db.query(
         'SELECT id FROM inventory_periods WHERE period_year = ? AND period_month = ?',
         [newPeriod.periodYear, newPeriod.periodMonth]
       );
       if ('rows' in existingRes && existingRes.rows.length > 0) {
         toast({ title: 'Period already exists for this month', variant: 'destructive' });
         return;
       }

       let openingStockValue = 0;
       if (!newPeriod.isInitial) {
         const latestRes = await db.query(
           'SELECT closing_stock_value FROM inventory_periods WHERE status IN (?, ?) ORDER BY period_year DESC, period_month DESC LIMIT 1',
           ['closed', 'locked']
         );
         if ('rows' in latestRes && latestRes.rows.length > 0) {
           openingStockValue = Number(latestRes.rows[0].closing_stock_value || 0);
         }
       } else {
         const stockRes = await db.query(
           `SELECT SUM(p.stock_level * p.cost_price) as total FROM products p WHERE p.is_stock_item = true`
         );
         if ('rows' in stockRes && stockRes.rows.length > 0) {
           openingStockValue = Number(stockRes.rows[0].total || 0);
         }
       }

       const monthName = new Date(newPeriod.periodYear, newPeriod.periodMonth - 1).toLocaleString('default', { month: 'long' });
       const periodName = `${monthName} ${newPeriod.periodYear}`;

       // Use dedicated endpoint with singleton protection
       const response = await fetch('/api/inventory/periods', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({
           period_name: periodName,
           period_year: newPeriod.periodYear,
           period_month: newPeriod.periodMonth,
           start_date: newPeriod.startDate,
           end_date: newPeriod.endDate,
           status: 'open',
           opening_stock_value: openingStockValue,
           created_by: user?.name
         })
       });
       const data = await response.json();
       if (!response.ok || !data.ok) {
         throw new Error(data.error || 'Failed to create period');
       }
       const periodId = data.rows[0]?.id;

       // Audit log (can use generic db)
       await db.query(
         `INSERT INTO inventory_period_audit (period_id, action, user_id, user_name, is_historical_backfill)
          VALUES (?, 'PERIOD_CREATED', ?, ?, false)`,
         [periodId, user?.id, user?.name]
       );

       toast({ title: 'Inventory period created successfully' });
       setShowNewPeriodDialog(false);
       loadData();
     } catch (e: any) {
       console.error('Create period error:', e);
       toast({ title: 'Failed to create period', variant: 'destructive' });
     }
   };

   const openPeriod = async (periodId: string) => {
     try {
       const response = await fetch(`/api/inventory/periods/${periodId}`, {
         method: 'PUT',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({
           status: 'open',
           reopened_by: user?.name,
           reopened_at: new Date().toISOString()
         })
       });
       const data = await response.json();
       if (!response.ok || !data.ok) {
         throw new Error(data.error || 'Failed to open period');
       }

       toast({ title: 'Period opened successfully' });
       loadData();
     } catch (e: any) {
       toast({ title: 'Failed to open period', variant: 'destructive' });
     }
   };

    const startReconciliation = async (periodId: string) => {
      try {
        // Update status to reconciling via dedicated endpoint
        const response = await fetch(`/api/inventory/periods/${periodId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'reconciling' })
        });
        const data = await response.json();
        if (!response.ok || !data.ok) {
          const msg = data.error || 'Failed to start reconciliation';
          throw new Error(msg);
        }

        const periodRes = await db.query('SELECT * FROM inventory_periods WHERE id = ?', [periodId]);
        if ('rows' in periodRes && periodRes.rows.length > 0) {
          const period = periodRes.rows[0] as InventoryPeriod;
          setSelectedPeriod(period);
          await loadProducts(periodId);
        }

        toast({ title: 'Reconciliation started' });
        loadData();
      } catch (e: any) {
        console.error('Start reconciliation error:', e);
        toast({ title: 'Failed to start reconciliation', description: e.message, variant: 'destructive' });
      }
    };

  const savePhysicalCounts = async () => {
    if (!selectedPeriod) return;

    try {
      for (const [productId, qty] of Object.entries(physicalCounts)) {
        await db.query(
          `UPDATE products SET last_inventory_period_id = ?, last_physical_qty = ?, last_physical_date = ? WHERE id = ?`,
          [selectedPeriod.id, qty, new Date().toISOString().split('T')[0], productId]
        );
      }

      toast({ title: 'Physical counts saved' });
    } catch (e: any) {
      toast({ title: 'Failed to save counts', variant: 'destructive' });
    }
  };

   const closePeriod = async () => {
     if (!selectedPeriod) return;

     try {
       // Call server to close period; server will compute totals, create snapshots and adjustments
       const response = await fetch('/api/inventory/close', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({
           period_id: selectedPeriod.id,
           closed_by: user?.name,
           closed_reason: closeReason
           // manager_override will be sent automatically if zero-capture
         })
       });
       const data = await response.json();
       if (!response.ok || !data.ok) {
         if (data.error === 'ZERO_CAPTURE') {
           // Prompt user for override confirmation? For now just show error
           toast({ title: 'Zero capture detected', description: 'No receipts found. Add manager_override or add receipts.', variant: 'destructive' });
           return;
         }
         throw new Error(data.error || 'Failed to close period');
       }

       toast({ title: 'Period closed successfully', description: `Closing stock: $${Number(data.closing_stock_value || 0).toFixed(2)}` });
       setShowCloseDialog(false);
       loadData();
     } catch (e: any) {
       console.error('Close period error:', e);
       toast({ title: 'Failed to close period', description: e.message, variant: 'destructive' });
     }
   };

   const addBackfill = async () => {
     if (!selectedPeriod || selectedProducts.size === 0) {
       toast({ title: 'Please select products to backfill', variant: 'destructive' });
       return;
     }

     try {
       for (const productId of selectedProducts) {
         const product = products.find(p => p.id === productId);
         if (product && physicalCounts[productId]) {
           const qty = parseFloat(String(physicalCounts[productId])) || 0;
           
           // Use dedicated endpoint which also updates period received_value
           const response = await fetch('/api/inventory/transactions', {
             method: 'POST',
             headers: { 'Content-Type': 'application/json' },
             body: JSON.stringify({
               transaction_type: 'grv',
               transaction_number: `BF-${Date.now()}-${productId.slice(0,8)}`,
               period_id: selectedPeriod.id,
               transaction_date: new Date().toISOString().split('T')[0],
               department: product.department,
               total_quantity: qty,
               total_value: qty * Number(product.cost_price || 0),
               supplier_name: 'Historical Backfill',
               created_by: user?.name,
               is_historical_backfill: true
             })
           });
           const data = await response.json();
           if (!response.ok || !data.ok) {
             console.error('Backfill transaction failed:', data.error);
           }
         }
       }

       toast({ title: 'Backfill added successfully' });
       setShowBackfillDialog(false);
       loadData();
     } catch (e: any) {
       toast({ title: 'Failed to add backfill', variant: 'destructive' });
     }
   };

  const calculateVariance = (opening: number, received: number, physical: number) => {
    const expected = opening + received;
    return { expected, variance: physical - expected };
  };

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading inventory data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center bg-white p-4 rounded-xl shadow-sm border">
        <div>
          <h1 className="text-2xl font-bold">Inventory Reconciliation</h1>
          <p className="text-sm text-gray-500">Period-based stock reconciliation and audit trail</p>
        </div>
        <div className="flex items-center gap-4">
          {syncStatus.pending > 0 && (
            <div className="flex items-center gap-2 px-3 py-1 bg-amber-50 border border-amber-200 rounded-lg">
              <span className="text-xs font-bold text-amber-700">{syncStatus.pending} Pending Changes</span>
              <Button 
                size="sm" 
                variant="outline" 
                className="h-7 text-[10px] bg-white hover:bg-amber-100"
                onClick={handleForceSync}
                disabled={syncStatus.isSyncing}
              >
                {syncStatus.isSyncing ? 'Syncing...' : 'Force Sync Now'}
              </Button>
            </div>
          )}
          {!syncStatus.isOnline && (
            <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
              OFFLINE MODE
            </Badge>
          )}
          <Button variant="outline" onClick={() => {
            loadProducts('all'); 
            setShowBatchReconDialog(true);
          }}>
            Batch Stock Take
          </Button>
          <Button onClick={() => setShowNewPeriodDialog(true)}>
            New Period
          </Button>
        </div>
      </div>

      <Tabs defaultValue="periods">
        <TabsList>
          <TabsTrigger value="periods">Periods</TabsTrigger>
          <TabsTrigger value="transactions">Transactions</TabsTrigger>
          <TabsTrigger value="reconciliation">Reconciliation</TabsTrigger>
        </TabsList>

        <TabsContent value="periods">
          <Card>
            <CardHeader>
              <CardTitle>Inventory Periods</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Period</TableHead>
                    <TableHead>Dates</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Opening</TableHead>
                    <TableHead>Received</TableHead>
                    <TableHead>Variance</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {periods.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-gray-500">
                        No inventory periods found. Create one to get started.
                      </TableCell>
                    </TableRow>
                  ) : (
                    periods.map(period => (
                      <TableRow key={period.id}>
                        <TableCell className="font-medium">{period.period_name}</TableCell>
                        <TableCell>
                          {new Date(period.start_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} - {' '}
                          {new Date(period.end_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                        </TableCell>
                        <TableCell>
                          <Badge className={getStatusColor(period.status)}>
                            {period.status}
                          </Badge>
                        </TableCell>
                        <TableCell>${Number(period.opening_stock_value || 0).toFixed(2)}</TableCell>
                        <TableCell>${Number(period.received_value || 0).toFixed(2)}</TableCell>
                        <TableCell className={Number(period.variance_value || 0) ? (Number(period.variance_value) < 0 ? 'text-red-600' : 'text-green-600') : ''}>
                          ${Number(period.variance_value || 0).toFixed(2)}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            {period.status === 'future' && (
                              <Button size="sm" variant="outline" onClick={() => openPeriod(period.id)}>
                                Open
                              </Button>
                            )}
                            {period.status === 'open' && (
                              <Button size="sm" variant="outline" onClick={() => startReconciliation(period.id)}>
                                Start Recon
                              </Button>
                            )}
                            {period.status === 'reconciling' && (
                              <>
                                <Button size="sm" variant="outline" onClick={() => {
                                  setSelectedPeriod(period);
                                  loadProducts(period.id);
                                  setShowBackfillDialog(true);
                                }}>
                                  Backfill
                                </Button>
                                <Button size="sm" onClick={() => {
                                  setSelectedPeriod(period);
                                  loadProducts(period.id);
                                  setShowCloseDialog(true);
                                }}>
                                  Close
                                </Button>
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="transactions">
          <Card>
            <CardHeader>
              <CardTitle>Inventory Transactions</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Number</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead>Quantity</TableHead>
                    <TableHead>Value</TableHead>
                    <TableHead>Supplier</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactions.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-gray-500">
                        No transactions found
                      </TableCell>
                    </TableRow>
                  ) : (
                    transactions.map(tx => (
                      <TableRow key={tx.id}>
                         <TableCell>
                           {new Date(tx.transaction_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                         </TableCell>
                        <TableCell className="capitalize">{tx.transaction_type}</TableCell>
                        <TableCell>{tx.transaction_number}</TableCell>
                        <TableCell>{tx.department}</TableCell>
                        <TableCell>{tx.total_quantity}</TableCell>
                        <TableCell>${Number(tx.total_value || 0).toFixed(2)}</TableCell>
                        <TableCell>{tx.supplier_name || '-'}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="reconciliation">
          {selectedPeriod ? (
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>{selectedPeriod.period_name} - Reconciliation</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="p-4 bg-gray-50 rounded-lg">
                      <div className="text-sm text-gray-600">Opening Stock</div>
                      <div className="text-xl font-bold">${Number(selectedPeriod.opening_stock_value || 0).toFixed(2)}</div>
                    </div>
                    <div className="p-4 bg-gray-50 rounded-lg">
                      <div className="text-sm text-gray-600">Received</div>
                      <div className="text-xl font-bold">${Number(selectedPeriod.received_value || 0).toFixed(2)}</div>
                    </div>
                    <div className="p-4 bg-gray-50 rounded-lg">
                      <div className="text-sm text-gray-600">Expected</div>
                      <div className="text-xl font-bold">${(Number(selectedPeriod.opening_stock_value || 0) + Number(selectedPeriod.received_value || 0)).toFixed(2)}</div>
                    </div>
                    <div className="p-4 bg-gray-50 rounded-lg">
                      <div className="text-sm text-gray-600">Variance</div>
                      <div className={`text-xl font-bold ${Number(selectedPeriod.variance_value || 0) < 0 ? 'text-red-600' : 'text-green-600'}`}>
                        ${Number(selectedPeriod.variance_value || 0).toFixed(2)}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Department Breakdown</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid md:grid-cols-2 gap-6">
                    <div>
                      <h3 className="font-semibold mb-3">Kitchen</h3>
                      <Table>
                        <TableBody>
                          <TableRow>
                            <TableCell>Opening Qty</TableCell>
                            <TableCell className="text-right">{selectedPeriod.opening_stock_value}</TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell>Received Qty</TableCell>
                            <TableCell className="text-right">{selectedPeriod.received_value}</TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell>COGS</TableCell>
                            <TableCell className="text-right">${Number(selectedPeriod.kitchen_cogs || 0).toFixed(2)}</TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </div>
                    <div>
                      <h3 className="font-semibold mb-3">Cellar</h3>
                      <Table>
                        <TableBody>
                          <TableRow>
                            <TableCell>Opening Qty</TableCell>
                            <TableCell className="text-right">{selectedPeriod.opening_stock_value}</TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell>Received Qty</TableCell>
                            <TableCell className="text-right">{selectedPeriod.received_value}</TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell>COGS</TableCell>
                            <TableCell className="text-right">${Number(selectedPeriod.cellar_cogs || 0).toFixed(2)}</TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Button onClick={savePhysicalCounts} className="w-full">
                Save Physical Counts
              </Button>
            </div>
          ) : (
            <Card>
              <CardContent className="py-8 text-center text-gray-500">
                Select a period and click "Start Recon" to begin reconciliation.
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={showNewPeriodDialog} onOpenChange={setShowNewPeriodDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Inventory Period</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Year</Label>
                <Input 
                  type="number" 
                  value={newPeriod.periodYear}
                  onChange={e => setNewPeriod({...newPeriod, periodYear: parseInt(e.target.value)})}
                />
              </div>
              <div>
                <Label>Month</Label>
                <Input 
                  type="number" 
                  min={1}
                  max={12}
                  value={newPeriod.periodMonth}
                  onChange={e => setNewPeriod({...newPeriod, periodMonth: parseInt(e.target.value)})}
                />
              </div>
            </div>
            <div>
              <Label>Start Date</Label>
              <Input 
                type="date" 
                value={newPeriod.startDate}
                onChange={e => setNewPeriod({...newPeriod, startDate: e.target.value})}
              />
            </div>
            <div>
              <Label>End Date</Label>
              <Input 
                type="date" 
                value={newPeriod.endDate}
                onChange={e => setNewPeriod({...newPeriod, endDate: e.target.value})}
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox 
                id="isInitial"
                checked={newPeriod.isInitial}
                onCheckedChange={checked => setNewPeriod({...newPeriod, isInitial: !!checked})}
              />
              <label htmlFor="isInitial" className="text-sm">
                Initial Period (mirror existing stock as opening)
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewPeriodDialog(false)}>Cancel</Button>
            <Button onClick={createPeriod}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showBackfillDialog} onOpenChange={setShowBackfillDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Backfill Wizard</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Select products and enter quantities for historical backfill (skipped/delayed deliveries).
            </p>
            <div className="max-h-64 overflow-y-auto border rounded">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10"></TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead>Quantity</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {products.map(product => (
                    <TableRow key={product.id}>
                      <TableCell>
                        <Checkbox 
                          checked={selectedProducts.has(product.id)}
                          onCheckedChange={checked => {
                            const newSelected = new Set(selectedProducts);
                            if (checked) newSelected.add(product.id);
                            else newSelected.delete(product.id);
                            setSelectedProducts(newSelected);
                          }}
                        />
                      </TableCell>
                      <TableCell>{product.name}</TableCell>
                      <TableCell>{product.department}</TableCell>
                      <TableCell>
                        <Input 
                          type="number"
                          className="w-24"
                          value={physicalCounts[product.id] || ''}
                          onChange={e => setPhysicalCounts({...physicalCounts, [product.id]: e.target.value})}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBackfillDialog(false)}>Cancel</Button>
            <Button onClick={addBackfill}>Add Backfill</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showCloseDialog} onOpenChange={setShowCloseDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Close Period</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Are you sure you want to close this period? This will finalize all reconciliation data and lock the period.
            </p>
            <div>
              <Label>Closing Reason</Label>
              <Input 
                value={closeReason}
                onChange={e => setCloseReason(e.target.value)}
                placeholder="Enter reason for closing..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCloseDialog(false)}>Cancel</Button>
            <Button onClick={closePeriod}>Close Period</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Batch Reconciliation Dialog */}
      <Dialog open={showBatchReconDialog} onOpenChange={setShowBatchReconDialog}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Batch Inventory Reconciliation</DialogTitle>
            <p className="text-sm text-gray-500">Update physical quantities and unit costs for all items simultaneously.</p>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto py-4">
            <Table>
               <TableHeader>
                 <TableRow>
                   <TableHead>Item Name</TableHead>
                   <TableHead>Department</TableHead>
                   <TableHead className="text-right">Current Stock</TableHead>
                   <TableHead className="text-right w-32">Physical Qty</TableHead>
                   <TableHead className="text-right w-32">Unit Cost</TableHead>
                 </TableRow>
               </TableHeader>
               <TableBody>
                 {products.map(p => (
                   <TableRow key={p.id}>
                     <TableCell className="font-medium">{p.name}</TableCell>
                     <TableCell>{p.department}</TableCell>
                     <TableCell className="text-right">{p.stock_level}</TableCell>
                     <TableCell>
                       <Input
                         type="number"
                         className="text-right h-8"
                         placeholder="0"
                         value={batchData[p.id]?.physicalQty ?? ''}
                         onChange={(e) => setBatchData(prev => ({
                           ...prev,
                           [p.id]: { ...(prev[p.id] || { physicalQty: 0 }), physicalQty: parseFloat(e.target.value) || 0 }
                         }))}
                       />
                     </TableCell>
                     <TableCell>
                       <Input
                         type="number"
                         className="text-right h-8"
                         placeholder={p.cost_price?.toString() ?? '0'}
                         value={batchData[p.id]?.costPrice ?? ''}
                         onChange={(e) => setBatchData(prev => ({
                           ...prev,
                           [p.id]: { ...(prev[p.id] || { physicalQty: 0 }), costPrice: parseFloat(e.target.value) || 0 }
                         }))}
                       />
                     </TableCell>
                   </TableRow>
                 ))}
               </TableBody>
            </Table>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBatchReconDialog(false)}>Cancel</Button>
            <Button onClick={async () => {
              try {
                const entries = Object.entries(batchData);
                if (entries.length === 0) {
                  toast({ title: 'No changes entered', variant: 'destructive' });
                  return;
                }

                // Prepare items array for batch endpoint
                const items = entries.map(([id, data]) => ({
                  product_id: id,
                  physical_qty: data.physicalQty,
                  cost_price: data.costPrice
                }));

                const response = await fetch('/api/inventory/batch-reconcile', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    period_id: selectedPeriod.id,
                    user_id: user?.id,
                    items
                  })
                });
                const result = await response.json();
                if (!response.ok || !result.ok) {
                  throw new Error(result.error || 'Batch reconciliation failed');
                }

                toast({ title: 'Batch reconciliation saved successfully' });
                setShowBatchReconDialog(false);
                setBatchData({});
                loadData();
              } catch (err: any) {
                console.error('Batch Recon Error:', err);
                toast({ title: 'Failed to save batch', description: err.message, variant: 'destructive' });
              }
            }}>
              Save All Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default InventoryReconciliation;