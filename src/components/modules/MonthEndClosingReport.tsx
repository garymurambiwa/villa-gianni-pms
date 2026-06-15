import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar, DollarSign, TrendingUp, FileText, Download, CheckCircle, AlertTriangle } from 'lucide-react';
import { formatCurrency } from '@/lib/posIntegration';

interface MonthEndClosingReportProps {}

interface ClosingData {
  category: string;
  opening_inventory: number;
  purchases_received: number;
  transfers_in: number;
  transfers_out: number;
  sales_consumption: number;
  wastage_loss: number;
  closing_inventory: number;
  variance: number;
  variance_percentage: number;
}

export const MonthEndClosingReport: React.FC<MonthEndClosingReportProps> = () => {
  const [period, setPeriod] = useState('current_month');
  const [closingData, setClosingData] = useState<ClosingData[]>([]);
  const [loading, setLoading] = useState(false);
  const [monthSummary, setMonthSummary] = useState({
    totalOpening: 0,
    totalPurchases: 0,
    totalConsumption: 0,
    totalClosing: 0,
    totalVariance: 0,
    variancePercentage: 0
  });

  const periods = [
    { id: 'current_month', name: 'Current Month' },
    { id: 'last_month', name: 'Last Month' },
    { id: 'last_3_months', name: 'Last 3 Months' },
  ];

  const fetchClosingData = async () => {
    setLoading(true);
    try {
      // Real month-end figures come from the stock ledger + variance/close-period
      // pipeline (opening, purchases, transfers, consumption, wastage per category).
      // We do NOT fabricate these numbers — use Inventory > Stock Take / Close Period
      // for the authoritative close. This view stays empty until wired to that source.
      setClosingData([]);
    } catch (error) {
      console.error('Failed to fetch closing data:', error);
      setClosingData([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchClosingData();
  }, [period]);

  const exportToCSV = () => {
    const csvData = closingData.map(item => ({
      'Category': item.category,
      'Opening Inventory': item.opening_inventory,
      'Purchases Received': item.purchases_received,
      'Transfers In': item.transfers_in,
      'Transfers Out': item.transfers_out,
      'Sales Consumption': item.sales_consumption,
      'Wastage Loss': item.wastage_loss,
      'Closing Inventory': Number(item.closing_inventory || 0).toFixed(2),
      'Variance': Number(item.variance || 0).toFixed(2),
      'Variance %': Number(item.variance_percentage || 0).toFixed(2)
    }));

    const csvString = [
      Object.keys(csvData[0]).join(','),
      ...csvData.map(row => Object.values(row).join(','))
    ].join('\n');

    const blob = new Blob([csvString], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `month_end_closing_${period}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Month-End Closing Report</h1>
          <p className="text-muted-foreground">Period-end inventory reconciliation and financial closing</p>
        </div>
        <div className="flex items-center gap-4">
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {periods.map(p => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
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
            <CardTitle className="text-sm font-medium">Opening Inventory</CardTitle>
            <DollarSign className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(monthSummary.totalOpening)}</div>
            <p className="text-xs text-muted-foreground">
              Beginning balance
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Purchases</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(monthSummary.totalPurchases)}</div>
            <p className="text-xs text-muted-foreground">
              Goods received
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Consumption</CardTitle>
            <FileText className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(monthSummary.totalConsumption)}</div>
            <p className="text-xs text-muted-foreground">
              Sales & usage
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Variance</CardTitle>
            <AlertTriangle className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${monthSummary.totalVariance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {formatCurrency(monthSummary.totalVariance)}
            </div>
            <p className="text-xs text-muted-foreground">
              {Number(monthSummary.variancePercentage || 0).toFixed(1)}% variance
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Closing Statement Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Month-End Inventory Reconciliation
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-center text-muted-foreground">Loading closing data...</p>
          ) : closingData.length === 0 ? (
            <div className="text-center py-8 space-y-1">
              <p className="font-medium text-muted-foreground">Not connected to live data</p>
              <p className="text-xs text-muted-foreground">Use Inventory → Stock Take / Close Period for the authoritative month-end close. This summary view will be enabled once wired to that source — no estimated figures are shown.</p>
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Opening</TableHead>
                    <TableHead className="text-right">Purchases</TableHead>
                    <TableHead className="text-right">Transfers In</TableHead>
                    <TableHead className="text-right">Transfers Out</TableHead>
                    <TableHead className="text-right">Consumption</TableHead>
                    <TableHead className="text-right">Wastage</TableHead>
                    <TableHead className="text-right">Closing</TableHead>
                    <TableHead className="text-right">Variance</TableHead>
                    <TableHead className="text-right">Variance %</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {closingData.map((item, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="font-medium">{String(item.category)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(item.opening_inventory)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(item.purchases_received)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(item.transfers_in)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(item.transfers_out)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(item.sales_consumption)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(item.wastage_loss)}</TableCell>
                      <TableCell className="text-right font-medium">{formatCurrency(item.closing_inventory)}</TableCell>
                      <TableCell className={`text-right font-medium ${item.variance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {formatCurrency(item.variance)}
                      </TableCell>
                      <TableCell className={`text-right ${Math.abs(item.variance_percentage) > 5 ? 'text-red-600' : 'text-green-600'}`}>
                        {Number(item.variance_percentage || 0).toFixed(1)}%
                      </TableCell>
                      <TableCell>
                        <Badge variant={Math.abs(item.variance_percentage) > 5 ? 'destructive' : 'default'}>
                          {Math.abs(item.variance_percentage) > 5 ? 'Review' : 'Good'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                  {/* Summary Row */}
                  <TableRow className="border-t-2 font-medium bg-muted/50">
                    <TableCell>TOTAL</TableCell>
                    <TableCell className="text-right">{formatCurrency(monthSummary.totalOpening)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(monthSummary.totalPurchases)}</TableCell>
                    <TableCell className="text-right">-</TableCell>
                    <TableCell className="text-right">-</TableCell>
                    <TableCell className="text-right">{formatCurrency(monthSummary.totalConsumption)}</TableCell>
                    <TableCell className="text-right">-</TableCell>
                    <TableCell className="text-right">{formatCurrency(monthSummary.totalClosing)}</TableCell>
                    <TableCell className={`text-right ${monthSummary.totalVariance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {formatCurrency(monthSummary.totalVariance)}
                    </TableCell>
                    <TableCell className={`text-right ${Math.abs(monthSummary.variancePercentage) > 5 ? 'text-red-600' : 'text-green-600'}`}>
                      {Number(monthSummary.variancePercentage || 0).toFixed(1)}%
                    </TableCell>
                    <TableCell>
                      <Badge variant={Math.abs(monthSummary.variancePercentage) > 5 ? 'destructive' : 'default'}>
                        {Math.abs(monthSummary.variancePercentage) > 5 ? 'Attention' : 'Balanced'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};