import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CalendarDays, DollarSign, TrendingUp, TrendingDown, AlertTriangle, Download } from 'lucide-react';
import { formatCurrency } from '@/lib/posIntegration';

interface CostMarginReportProps {}

export const CostMarginReport: React.FC<CostMarginReportProps> = () => {
  const [dateRange, setDateRange] = useState('30');
  const [category, setCategory] = useState('all');
  const [marginData, setMarginData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const categories = [
    { id: 'all', name: 'All Categories' },
    { id: 'Food', name: 'Food' },
    { id: 'Beverage', name: 'Beverage' },
  ];

  const dateRanges = [
    { id: '7', name: 'Last 7 days' },
    { id: '30', name: 'Last 30 days' },
    { id: '90', name: 'Last 90 days' },
  ];

  const fetchMarginData = async () => {
    setLoading(true);
    try {
      // Fetch inventory items and calculate margins based on weighted average costs
      const response = await fetch('/api/v1/inventory/items?limit=100');
      const data = await response.json();

      if (data.ok && data.data) {
        // Calculate mock margin data based on inventory items
        const mockMargins = data.data.slice(0, 15).map((item: any, idx: number) => {
          const costPrice = parseFloat(item.weighted_avg_cost || 10);
          const sellingPrice = costPrice * (1.3 + Math.random() * 0.6); // 30-90% markup
          const marginAmount = sellingPrice - costPrice;
          const marginPercentage = (marginAmount / costPrice) * 100;

          // Mock sales data
          const totalSold = Math.floor(Math.random() * 200) + 20;
          const totalRevenue = totalSold * sellingPrice;
          const totalCost = totalSold * costPrice;
          const totalProfit = totalRevenue - totalCost;

          return {
            item_id: item.id,
            item_name: item.name,
            category: item.category,
            sku: item.sku,
            cost_price: costPrice,
            selling_price: sellingPrice,
            margin_amount: marginAmount,
            margin_percentage: marginPercentage,
            total_sold: totalSold,
            total_revenue: totalRevenue,
            total_cost: totalCost,
            total_profit: totalProfit,
          };
        });

        setMarginData(mockMargins);
      }
    } catch (error) {
      console.error('Failed to fetch margin data:', error);
      setMarginData([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMarginData();
  }, [dateRange, category]);

  const getTotalRevenue = () => marginData.reduce((sum, item) => sum + item.total_revenue, 0);
  const getTotalCost = () => marginData.reduce((sum, item) => sum + item.total_cost, 0);
  const getTotalProfit = () => marginData.reduce((sum, item) => sum + item.total_profit, 0);
  const getAverageMargin = () => {
    const total = marginData.reduce((sum, item) => sum + item.margin_percentage, 0);
    return marginData.length > 0 ? total / marginData.length : 0;
  };

  const getMarginColor = (percentage: number) => {
    if (percentage >= 60) return 'text-green-600';
    if (percentage >= 40) return 'text-blue-600';
    if (percentage >= 25) return 'text-yellow-600';
    return 'text-red-600';
  };

  const exportToCSV = () => {
    const csvData = marginData.map(item => ({
      'Item Name': item.item_name,
      'SKU': item.sku,
      'Category': item.category,
      'Cost Price': Number(item.cost_price || 0).toFixed(2),
      'Selling Price': item.selling_price.toFixed(2),
      'Margin %': item.margin_percentage.toFixed(2),
      'Margin Amount': item.margin_amount.toFixed(2),
      'Total Sold': item.total_sold,
      'Total Revenue': Number(item.total_revenue || 0).toFixed(2),
      'Total Cost': Number(item.total_cost || 0).toFixed(2),
      'Total Profit': Number(item.total_profit || 0).toFixed(2)
    }));

    const csvString = [
      Object.keys(csvData[0]).join(','),
      ...csvData.map(row => Object.values(row).join(','))
    ].join('\n');

    const blob = new Blob([csvString], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cost_margin_report_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Cost Margin Analysis</h1>
          <p className="text-muted-foreground">Profit margins by item and category</p>
        </div>
        <div className="flex items-center gap-4">
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {categories.map(cat => (
                <SelectItem key={cat.id} value={cat.id}>
                  {cat.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={dateRange} onValueChange={setDateRange}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {dateRanges.map(range => (
                <SelectItem key={range.id} value={range.id}>
                  {range.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={exportToCSV} variant="outline" className="gap-2">
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
            <DollarSign className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(getTotalRevenue())}</div>
            <p className="text-xs text-muted-foreground">
              Sales revenue
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Cost</CardTitle>
            <TrendingDown className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(getTotalCost())}</div>
            <p className="text-xs text-muted-foreground">
              Cost of goods sold
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Profit</CardTitle>
            <TrendingUp className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(getTotalProfit())}</div>
            <p className="text-xs text-muted-foreground">
              Gross profit
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Average Margin</CardTitle>
            <AlertTriangle className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{getAverageMargin().toFixed(1)}%</div>
            <p className="text-xs text-muted-foreground">
              Average profit margin
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Margin Analysis Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5" />
            Item Margin Analysis
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-center text-muted-foreground">Loading margin data...</p>
          ) : marginData.length === 0 ? (
            <p className="text-center text-muted-foreground">No margin data available.</p>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item Name</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Cost Price</TableHead>
                    <TableHead className="text-right">Selling Price</TableHead>
                    <TableHead className="text-right">Margin %</TableHead>
                    <TableHead className="text-right">Margin $</TableHead>
                    <TableHead className="text-right">Total Sold</TableHead>
                    <TableHead className="text-right">Profit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {marginData.map((item, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="font-medium">{item.item_name}</TableCell>
                      <TableCell>{item.sku}</TableCell>
                      <TableCell>{item.category}</TableCell>
                      <TableCell className="text-right">{formatCurrency(item.cost_price)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(item.selling_price)}</TableCell>
                      <TableCell className="text-right">
                        <span className={getMarginColor(item.margin_percentage)}>
                          {item.margin_percentage.toFixed(1)}%
                        </span>
                      </TableCell>
                      <TableCell className="text-right">{formatCurrency(item.margin_amount)}</TableCell>
                      <TableCell className="text-right">{item.total_sold}</TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(item.total_profit)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};