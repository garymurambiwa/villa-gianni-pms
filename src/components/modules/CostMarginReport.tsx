import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CalendarDays, DollarSign, TrendingUp, TrendingDown, AlertTriangle, Download, Printer } from 'lucide-react';
import { formatCurrency } from '@/lib/posIntegration';
import { printReportHtml } from '@/lib/reportPrint';

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
      const days = parseInt(dateRange) || 30;
      const dbQuery = (sql: string, params: any[] = []) =>
        fetch('/api/db/query', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sql, params }),
        }).then(r => r.json());

      // 1. REAL per-item margins from the products table (selling price + cost price).
      const catFilter = category !== 'all' ? ` AND category = $1` : '';
      const prodRes = await dbQuery(
        `SELECT id, name, category, department,
                COALESCE(price,0)::float       AS selling_price,
                COALESCE(cost_price,0)::float  AS cost_price
         FROM products
         WHERE COALESCE(price,0) > 0${catFilter}
         ORDER BY (COALESCE(price,0) - COALESCE(cost_price,0)) DESC`,
        category !== 'all' ? [category] : []
      );
      const products = (prodRes.ok && prodRes.rows) ? prodRes.rows : [];

      // 2. REAL units sold per product from closed POS orders within the window.
      //    Handles both item shapes: { menuItem:{id}, quantity } and { id, quantity }.
      let soldMap: Record<string, number> = {};
      try {
        const soldRes = await dbQuery(
          `SELECT COALESCE(item->'menuItem'->>'id', item->>'id') AS pid,
                  SUM(COALESCE((item->>'quantity')::numeric, 0))::float AS qty
           FROM pos_orders, jsonb_array_elements(
                  CASE WHEN jsonb_typeof(items) = 'array' THEN items ELSE '[]'::jsonb END
                ) AS item
           WHERE created_at >= NOW() - ($1 || ' days')::interval
           GROUP BY 1`,
          [String(days)]
        );
        if (soldRes.ok && soldRes.rows) {
          soldMap = Object.fromEntries(soldRes.rows.filter((r: any) => r.pid).map((r: any) => [String(r.pid), Number(r.qty) || 0]));
        }
      } catch { /* sales aggregation optional — margins still real without it */ }

      // 3. Merge — every figure below is real; items never sold show qty 0.
      const rows = products.map((p: any) => {
        const sellingPrice = Number(p.selling_price) || 0;
        const costPrice = Number(p.cost_price) || 0;
        const marginAmount = sellingPrice - costPrice;
        const marginPercentage = costPrice > 0 ? (marginAmount / costPrice) * 100 : (sellingPrice > 0 ? 100 : 0);
        const totalSold = soldMap[String(p.id)] || 0;
        const totalRevenue = totalSold * sellingPrice;
        const totalCost = totalSold * costPrice;
        return {
          item_id: p.id,
          item_name: p.name,
          category: p.category,
          sku: p.department || '',
          cost_price: costPrice,
          selling_price: sellingPrice,
          margin_amount: marginAmount,
          margin_percentage: marginPercentage,
          total_sold: totalSold,
          total_revenue: totalRevenue,
          total_cost: totalCost,
          total_profit: totalRevenue - totalCost,
        };
      });
      setMarginData(rows);
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
          <Button onClick={exportToCSV} variant="outline" className="gap-2" disabled={marginData.length === 0}>
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
          <Button
            onClick={() => printReportHtml({
              title: 'Cost Margin Analysis',
              subtitle: 'Profit margins by item and category',
              meta: `Period: last ${dateRange} days  ·  Category: ${category}`,
              columns: [
                { header: 'Item', key: 'item_name' },
                { header: 'Category', key: 'category' },
                { header: 'Cost', key: (r) => formatCurrency(r.cost_price), align: 'right' },
                { header: 'Selling', key: (r) => formatCurrency(r.selling_price), align: 'right' },
                { header: 'Margin %', key: (r) => `${r.margin_percentage.toFixed(1)}%`, align: 'right' },
                { header: 'Sold', key: 'total_sold', align: 'right' },
                { header: 'Revenue', key: (r) => formatCurrency(r.total_revenue), align: 'right' },
                { header: 'Profit', key: (r) => formatCurrency(r.total_profit), align: 'right' },
              ],
              rows: marginData,
              summary: [
                `Total Revenue: ${formatCurrency(getTotalRevenue())}`,
                `Total Profit: ${formatCurrency(getTotalProfit())}`,
                `Average Margin: ${getAverageMargin().toFixed(1)}%`,
              ],
            })}
            variant="outline" className="gap-2" disabled={marginData.length === 0}>
            <Printer className="h-4 w-4" /> Print
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
                      <TableCell className="font-medium">{String(item.item_name)}</TableCell>
                      <TableCell>{String(item.sku)}</TableCell>
                      <TableCell>{String(item.category)}</TableCell>
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