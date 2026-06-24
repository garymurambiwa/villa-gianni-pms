import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertTriangle, Package, TrendingUp, DollarSign, Calendar, Download, Printer } from 'lucide-react';
import { formatCurrency } from '@/lib/posIntegration';
import { useInventoryLocations } from '@/hooks/useInventoryLocations';
import { printReportHtml } from '@/lib/reportPrint';

interface StockSheetReportProps {}

export const StockSheetReport: React.FC<StockSheetReportProps> = () => {
  // Locations now come live from the DB (no more hardcoded ids that don't exist)
  const { locations } = useInventoryLocations(true);
  const [location, setLocation] = useState('');
  const [stockData, setStockData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // Auto-select the first real location once they load
  useEffect(() => {
    if (!location && locations.length > 0) setLocation(locations[0].id);
  }, [locations, location]);

  const fetchStockSheet = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/v1/inventory/stock-sheet/${location}`);
      const data = await response.json();

      if (data.ok && data.data) {
        setStockData(data.data);
      } else {
        setStockData([]);
      }
    } catch (error) {
      console.error('Failed to fetch stock sheet:', error);
      setStockData([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (location) {
      fetchStockSheet();
    }
  }, [location]);

  const getTotalValue = () => {
    return stockData.reduce((sum, item) => sum + (parseFloat(item.balance) * parseFloat(item.weighted_avg_cost || 0)), 0);
  };

  const exportToCSV = () => {
    const csvData = stockData.map(item => ({
      'Item Name': item.item_name,
      'SKU': item.sku,
      'Category': item.category,
      'Balance': item.balance,
      'UOM': item.uom_symbol,
      'Unit Cost': item.weighted_avg_cost,
      'Total Value': (parseFloat(item.balance) * parseFloat(item.weighted_avg_cost || 0)).toFixed(2)
    }));

    const csvString = [
      Object.keys(csvData[0]).join(','),
      ...csvData.map(row => Object.values(row).join(','))
    ].join('\n');

    const blob = new Blob([csvString], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stock_sheet_${location}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Stock Sheet Report</h1>
          <p className="text-muted-foreground">Physical inventory count sheet by location</p>
        </div>
        <div className="flex items-center gap-4">
          <Select value={location} onValueChange={setLocation}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {locations.map(loc => (
                <SelectItem key={loc.id} value={loc.id}>
                  {loc.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={exportToCSV} variant="outline" className="gap-2" disabled={stockData.length === 0}>
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
          <Button
            onClick={() => printReportHtml({
              title: 'Stock Sheet Report',
              subtitle: 'Physical inventory count sheet by location',
              meta: `Location: ${locations.find(l => l.id === location)?.name || location}`,
              columns: [
                { header: 'Item Name', key: 'item_name' },
                { header: 'SKU', key: 'sku' },
                { header: 'Category', key: 'category' },
                { header: 'Balance', key: (r) => parseFloat(r.balance).toFixed(2), align: 'right' },
                { header: 'UOM', key: 'uom_symbol' },
                { header: 'Unit Cost', key: (r) => formatCurrency(parseFloat(r.weighted_avg_cost || 0)), align: 'right' },
                { header: 'Total Value', key: (r) => formatCurrency(parseFloat(r.balance) * parseFloat(r.weighted_avg_cost || 0)), align: 'right' },
              ],
              rows: stockData,
              summary: [`Total Items: ${stockData.length}`, `Total Value: ${formatCurrency(getTotalValue())}`],
            })}
            variant="outline" className="gap-2" disabled={stockData.length === 0}>
            <Printer className="h-4 w-4" />
            Print
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Items</CardTitle>
            <Package className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stockData.length}</div>
            <p className="text-xs text-muted-foreground">
              Active stock items
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Value</CardTitle>
            <DollarSign className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(getTotalValue())}</div>
            <p className="text-xs text-muted-foreground">
              Current inventory value
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Low Stock Items</CardTitle>
            <AlertTriangle className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">
              {stockData.filter(item => parseFloat(item.balance) < 10 && parseFloat(item.balance) > 0).length}
            </div>
            <p className="text-xs text-muted-foreground">
              Items below threshold
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Out of Stock</CardTitle>
            <TrendingUp className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              {stockData.filter(item => parseFloat(item.balance) <= 0).length}
            </div>
            <p className="text-xs text-muted-foreground">
              Items with zero balance
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Stock Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Current Stock Levels
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-center text-muted-foreground">Loading stock data...</p>
          ) : stockData.length === 0 ? (
            <p className="text-center text-muted-foreground">No stock data found for this location.</p>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item Name</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead>UOM</TableHead>
                    <TableHead className="text-right">Unit Cost</TableHead>
                    <TableHead className="text-right">Total Value</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stockData.map((item, idx) => {
                    const balance = parseFloat(item.balance);
                    const cost = parseFloat(item.weighted_avg_cost || 0);
                    const totalValue = balance * cost;

                    let status = 'Good';
                    let statusColor = 'default';

                    if (balance <= 0) {
                      status = 'Out of Stock';
                      statusColor = 'destructive';
                    } else if (balance < 5) {
                      status = 'Critical';
                      statusColor = 'destructive';
                    } else if (balance < 10) {
                      status = 'Low';
                      statusColor = 'secondary';
                    }

                    return (
                      <TableRow key={idx}>
                        <TableCell className="font-medium">{item.item_name}</TableCell>
                        <TableCell>{item.sku}</TableCell>
                        <TableCell>{item.category}</TableCell>
                        <TableCell className="text-right font-medium">{balance.toFixed(2)}</TableCell>
                        <TableCell>{item.uom_symbol}</TableCell>
                        <TableCell className="text-right">{formatCurrency(cost)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(totalValue)}</TableCell>
                        <TableCell>
                          <Badge variant={statusColor as any}>{status}</Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};