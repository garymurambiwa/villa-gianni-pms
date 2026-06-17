import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar, DollarSign, TrendingUp, FileText, Download, CheckCircle, AlertTriangle, Printer } from 'lucide-react';
import { formatCurrency } from '@/lib/posIntegration';
import { printReportHtml } from '@/lib/reportPrint';

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
      // Resolve the real period window.
      const now = new Date();
      let start: Date, end: Date;
      if (period === 'last_month') {
        start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        end = new Date(now.getFullYear(), now.getMonth(), 1);
      } else if (period === 'last_3_months') {
        start = new Date(now.getFullYear(), now.getMonth() - 3, 1);
        end = now;
      } else { // current_month
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        end = now;
      }

      // REAL value-based reconciliation from the stock ledger (total_cost by
      // ledger_type), grouped by item category. opening = book value before the
      // window; closing = book value at window end; variance = the real ADJUSTMENT
      // (physical-count correction) value that doesn't reconcile to the movements.
      const res = await fetch('/api/db/query', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sql: `
            WITH opening AS (
              SELECT i.category, COALESCE(SUM(sl.total_cost),0)::float AS val
              FROM inv_stock_ledger sl JOIN inv_items i ON i.id = sl.item_id
              WHERE COALESCE(sl.transaction_date, sl.inserted_at) < $1::timestamptz
              GROUP BY i.category
            ),
            moves AS (
              SELECT i.category,
                SUM(CASE WHEN sl.ledger_type='GRN'            THEN sl.total_cost      ELSE 0 END)::float AS purchases,
                SUM(CASE WHEN sl.ledger_type='TRANSFER_IN'    THEN sl.total_cost      ELSE 0 END)::float AS transfers_in,
                SUM(CASE WHEN sl.ledger_type='TRANSFER_OUT'   THEN ABS(sl.total_cost) ELSE 0 END)::float AS transfers_out,
                SUM(CASE WHEN sl.ledger_type='SALE_DEPLETION' THEN ABS(sl.total_cost) ELSE 0 END)::float AS consumption,
                SUM(CASE WHEN sl.ledger_type='WASTE'          THEN ABS(sl.total_cost) ELSE 0 END)::float AS wastage,
                SUM(CASE WHEN sl.ledger_type='ADJUSTMENT'     THEN sl.total_cost      ELSE 0 END)::float AS adjustment
              FROM inv_stock_ledger sl JOIN inv_items i ON i.id = sl.item_id
              WHERE COALESCE(sl.transaction_date, sl.inserted_at) >= $1::timestamptz
                AND COALESCE(sl.transaction_date, sl.inserted_at) <  $2::timestamptz
              GROUP BY i.category
            ),
            closing AS (
              SELECT i.category, COALESCE(SUM(sl.total_cost),0)::float AS val
              FROM inv_stock_ledger sl JOIN inv_items i ON i.id = sl.item_id
              WHERE COALESCE(sl.transaction_date, sl.inserted_at) < $2::timestamptz
              GROUP BY i.category
            )
            SELECT COALESCE(m.category, o.category, c.category) AS category,
                   COALESCE(o.val,0)           AS opening,
                   COALESCE(m.purchases,0)     AS purchases,
                   COALESCE(m.transfers_in,0)  AS transfers_in,
                   COALESCE(m.transfers_out,0) AS transfers_out,
                   COALESCE(m.consumption,0)   AS consumption,
                   COALESCE(m.wastage,0)       AS wastage,
                   COALESCE(c.val,0)           AS closing
            FROM moves m
            FULL OUTER JOIN opening o ON o.category = m.category
            FULL OUTER JOIN closing c ON c.category = COALESCE(m.category, o.category)
            ORDER BY 1`,
          params: [start.toISOString(), end.toISOString()],
        }),
      }).then(r => r.json());

      const rows = (res.ok && res.rows) ? res.rows : [];
      const real: ClosingData[] = rows.map((r: any) => {
        const opening = Number(r.opening) || 0;
        const purchases = Number(r.purchases) || 0;
        const tin = Number(r.transfers_in) || 0;
        const tout = Number(r.transfers_out) || 0;
        const consumption = Number(r.consumption) || 0;
        const wastage = Number(r.wastage) || 0;
        const closing = Number(r.closing) || 0;
        const expectedClosing = opening + purchases + tin - tout - consumption - wastage;
        const variance = closing - expectedClosing; // real unreconciled adjustment value
        const base = opening + purchases;
        return {
          category: r.category || 'Uncategorised',
          opening_inventory: opening,
          purchases_received: purchases,
          transfers_in: tin,
          transfers_out: tout,
          sales_consumption: consumption,
          wastage_loss: wastage,
          closing_inventory: closing,
          variance,
          variance_percentage: base > 0 ? (variance / base) * 100 : 0,
        };
      });
      setClosingData(real);

      const summary = real.reduce((s, c) => ({
        totalOpening: s.totalOpening + c.opening_inventory,
        totalPurchases: s.totalPurchases + c.purchases_received,
        totalConsumption: s.totalConsumption + c.sales_consumption,
        totalClosing: s.totalClosing + c.closing_inventory,
        totalVariance: s.totalVariance + c.variance,
        variancePercentage: 0,
      }), { totalOpening: 0, totalPurchases: 0, totalConsumption: 0, totalClosing: 0, totalVariance: 0, variancePercentage: 0 });
      const base = summary.totalOpening + summary.totalPurchases;
      summary.variancePercentage = base > 0 ? (summary.totalVariance / base) * 100 : 0;
      setMonthSummary(summary);
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
          <Button onClick={exportToCSV} variant="outline" className="gap-2" disabled={closingData.length === 0}>
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
          <Button
            onClick={() => printReportHtml({
              title: 'Month-End Closing',
              subtitle: 'Period-end inventory reconciliation (at cost value)',
              meta: `Period: ${periods.find(p => p.id === period)?.name || period}`,
              columns: [
                { header: 'Category', key: 'category' },
                { header: 'Opening', key: (r) => formatCurrency(r.opening_inventory), align: 'right' },
                { header: 'Purchases', key: (r) => formatCurrency(r.purchases_received), align: 'right' },
                { header: 'Transfers In', key: (r) => formatCurrency(r.transfers_in), align: 'right' },
                { header: 'Transfers Out', key: (r) => formatCurrency(r.transfers_out), align: 'right' },
                { header: 'Consumption', key: (r) => formatCurrency(r.sales_consumption), align: 'right' },
                { header: 'Wastage', key: (r) => formatCurrency(r.wastage_loss), align: 'right' },
                { header: 'Closing', key: (r) => formatCurrency(r.closing_inventory), align: 'right' },
                { header: 'Variance', key: (r) => formatCurrency(r.variance), align: 'right' },
              ],
              rows: closingData,
              summary: [
                `Total Opening: ${formatCurrency(monthSummary.totalOpening)}`,
                `Total Purchases: ${formatCurrency(monthSummary.totalPurchases)}`,
                `Total Closing: ${formatCurrency(monthSummary.totalClosing)}`,
                `Total Variance: ${formatCurrency(monthSummary.totalVariance)} (${monthSummary.variancePercentage.toFixed(1)}%)`,
              ],
            })}
            variant="outline" className="gap-2" disabled={closingData.length === 0}>
            <Printer className="h-4 w-4" /> Print
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
            <p className="text-center text-muted-foreground">No closing data available.</p>
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