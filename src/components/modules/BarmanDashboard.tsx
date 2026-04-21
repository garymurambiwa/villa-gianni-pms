import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Package, TrendingDown, BarChart3 } from 'lucide-react';

interface BarmanDashboardProps {}

export const BarmanDashboard: React.FC<BarmanDashboardProps> = () => {
  const [stockAlerts, setStockAlerts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchBarmanStock();
  }, []);

  const fetchBarmanStock = async () => {
    try {
      // Fetch stock for bar locations
      const response = await fetch('/api/v1/inventory/balance/loc_bar1');
      const data = await response.json();

      if (data.ok && data.data) {
        // Filter for low stock items (less than 10 units)
        const lowStockItems = data.data.filter((item: any) =>
          parseFloat(item.balance) < 10 && parseFloat(item.balance) > 0
        );
        setStockAlerts(lowStockItems);
      }
    } catch (error) {
      console.error('Failed to fetch bar stock:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStockStatus = (balance: number) => {
    if (balance <= 0) return { status: 'Out of Stock', color: 'destructive' };
    if (balance < 5) return { status: 'Critical', color: 'destructive' };
    if (balance < 10) return { status: 'Low', color: 'secondary' };
    return { status: 'Good', color: 'default' };
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Bar Dashboard</h1>
        <Badge variant="outline" className="text-sm">
          Bar Staff
        </Badge>
      </div>

      {/* Stock Alerts */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Stock Alerts</CardTitle>
            <AlertTriangle className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">
              {stockAlerts.length}
            </div>
            <p className="text-xs text-muted-foreground">
              Items running low
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Items</CardTitle>
            <Package className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">24</div>
            <p className="text-xs text-muted-foreground">
              Active stock items
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Today's Sales</CardTitle>
            <BarChart3 className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">$0.00</div>
            <p className="text-xs text-muted-foreground">
              Sales from bar
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Low Stock Items */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingDown className="h-5 w-5 text-orange-500" />
            Low Stock Alerts
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-center text-muted-foreground">Loading stock data...</p>
          ) : stockAlerts.length === 0 ? (
            <p className="text-center text-muted-foreground">All stock levels are good! 🎉</p>
          ) : (
            <div className="space-y-3">
              {stockAlerts.map((item, idx) => {
                const stockStatus = getStockStatus(parseFloat(item.balance));
                return (
                  <div key={idx} className="flex items-center justify-between p-3 border rounded-lg">
                    <div>
                      <p className="font-medium">{item.item_name}</p>
                      <p className="text-sm text-muted-foreground">
                        SKU: {item.sku} • {item.category}
                      </p>
                    </div>
                    <div className="text-right">
                      <Badge variant={stockStatus.color as any}>
                        {stockStatus.status}
                      </Badge>
                      <p className="text-sm font-medium mt-1">
                        {item.balance} {item.uom_symbol}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <button className="w-full text-left p-3 border rounded-lg hover:bg-gray-50 transition-colors">
              <div className="font-medium">View Full Inventory</div>
              <div className="text-sm text-muted-foreground">Check all bar stock levels</div>
            </button>
            <button className="w-full text-left p-3 border rounded-lg hover:bg-gray-50 transition-colors">
              <div className="font-medium">Order Supplies</div>
              <div className="text-sm text-muted-foreground">Request restocking</div>
            </button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Today's Tips</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">$0.00</div>
            <p className="text-sm text-muted-foreground mt-1">
              Tips collected today
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};