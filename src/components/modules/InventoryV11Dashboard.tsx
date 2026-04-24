/**
 * COREPMS v11 - Inventory Module Dashboard
 * Location: src/components/modules/InventoryV11Dashboard.tsx
 */

import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle, CheckCircle, TrendingDown } from 'lucide-react';

export const InventoryV11Dashboard: React.FC = () => {
  const [stats, setStats] = useState({
    totalStockValue: 0,
    criticalItems: 0,
    pendingTransfers: 0,
    recentGRNs: [],
    varianceAlerts: [],
  });
  const [loading, setLoading] = useState(true);

  const navigateTo = (module: string) => {
    window.dispatchEvent(new CustomEvent('navigateToModule', { detail: { module } }));
  };

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      setLoading(true);
      // Fetch balance for critical stock check
      const balRes = await fetch('/api/v1/inventory/balance/loc_main_cellar');
      const balData = await balRes.json();
      
      // Fetch recent GRNs
      const grnRes = await fetch('/api/v1/inventory/grn?limit=5');
      const grnData = await grnRes.json();

      // Fetch pending transfers
      const transRes = await fetch('/api/v1/inventory/transfer?status=draft');
      const transData = await transRes.json();

      setStats({
        totalStockValue: balData.ok ? balData.data.reduce((sum: number, i: any) => sum + (parseFloat(i.current_balance) * parseFloat(i.weighted_avg_cost || 0)), 0) : 0,
        criticalItems: balData.ok ? balData.data.filter((i: any) => parseFloat(i.current_balance) < 5).length : 0,
        pendingTransfers: transData.ok ? transData.data.length : 0,
        recentGRNs: grnData.ok ? grnData.data : [],
        varianceAlerts: [],
      });
    } catch (error) {
      console.error('Failed to fetch inventory stats:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Stock Value Card */}
        <Card className="border-l-4" style={{ borderLeftColor: '#1D9E75' }}>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-gray-600">Total Stock Value</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-gray-900">${stats.totalStockValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            <p className="text-xs text-gray-500 mt-1">Across all locations</p>
          </CardContent>
        </Card>

        {/* Critical Items Card */}
        <Card className="border-l-4" style={{ borderLeftColor: '#E24B4A' }}>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-gray-600">Critical Variance</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-gray-900">{stats.criticalItems}</div>
            <p className="text-xs text-gray-500 mt-1">Items exceeding 5% variance</p>
          </CardContent>
        </Card>

        {/* Pending Transfers Card */}
        <Card className="border-l-4" style={{ borderLeftColor: '#F59E0B' }}>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-gray-600">Pending Approvals</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-gray-900">{stats.pendingTransfers}</div>
            <p className="text-xs text-gray-500 mt-1">Stock transfers awaiting approval</p>
          </CardContent>
        </Card>
      </div>

      {/* Critical Stock Alerts */}
      {stats.criticalItems > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-500" />
              Critical Stock Alerts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Alert variant="destructive" className="bg-red-50 border-red-200">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                {stats.criticalItems} items have exceeded the critical variance threshold (5%). Review and investigate immediately.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      )}

      {/* Recent GRNs */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle className="text-base">Recent Goods Received Notes</CardTitle>
            <Button size="sm" variant="outline" onClick={() => navigateTo('inventory-v11-grn')}>View All</Button>
          </div>
        </CardHeader>
        <CardContent>
          {stats.recentGRNs.length === 0 ? (
            <p className="text-sm text-gray-500">No GRNs recorded yet</p>
          ) : (
            <div className="space-y-2">
              {stats.recentGRNs.map((grn: any) => (
                <div key={grn.id} className="flex justify-between items-center p-2 hover:bg-gray-50 rounded-md border text-sm">
                  <div className="flex flex-col">
                    <span className="font-semibold">{grn.grn_number}</span>
                    <span className="text-xs text-gray-500">{grn.supplier_name}</span>
                  </div>
                  <div className="flex flex-col items-end">
                    <span className="font-medium">${parseFloat(grn.total_value || 0).toFixed(2)}</span>
                    <span className={`text-[10px] uppercase px-1 rounded ${grn.status === 'posted' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                      {grn.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Button 
              variant="outline" 
              className="w-full h-16 flex flex-col items-center justify-center gap-1 hover:bg-gray-100 transition-colors"
              onClick={() => navigateTo('inventory-v11-grn')}
            >
              <span className="text-2xl">📄</span>
              <span className="text-xs">New GRN</span>
            </Button>
            <Button 
              variant="outline" 
              className="w-full h-16 flex flex-col items-center justify-center gap-1 hover:bg-gray-100 transition-colors"
              onClick={() => navigateTo('inventory-v11-transfer')}
            >
              <span className="text-2xl">↔️</span>
              <span className="text-xs">Transfer Stock</span>
            </Button>
            <Button 
              variant="outline" 
              className="w-full h-16 flex flex-col items-center justify-center gap-1 hover:bg-gray-100 transition-colors"
              onClick={() => navigateTo('inventory-v11-recipes')}
            >
              <span className="text-2xl">🍽️</span>
              <span className="text-xs">Recipe Builder</span>
            </Button>
            <Button 
              variant="outline" 
              className="w-full h-16 flex flex-col items-center justify-center gap-1 hover:bg-gray-100 transition-colors"
              onClick={() => navigateTo('inventory-v11-variance')}
            >
              <span className="text-2xl">📊</span>
              <span className="text-xs">Variance Report</span>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default InventoryV11Dashboard;
