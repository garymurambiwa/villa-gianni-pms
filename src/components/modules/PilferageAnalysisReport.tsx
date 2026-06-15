import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertTriangle, Shield, TrendingDown, Calendar, Download, Eye } from 'lucide-react';
import { formatCurrency } from '@/lib/posIntegration';

interface PilferageAnalysisReportProps {}

interface PilferageData {
  item_id: string;
  item_name: string;
  category: string;
  sku: string;
  expected_qty: number;
  actual_qty: number;
  variance_qty: number;
  variance_percentage: number;
  variance_value: number;
  risk_level: 'Low' | 'Medium' | 'High' | 'Critical';
  last_count_date: string;
}

export const PilferageAnalysisReport: React.FC<PilferageAnalysisReportProps> = () => {
  const [period, setPeriod] = useState('30');
  const [location, setLocation] = useState('all');
  const [pilferageData, setPilferageData] = useState<PilferageData[]>([]);
  const [loading, setLoading] = useState(false);

  const periods = [
    { id: '7', name: 'Last 7 days' },
    { id: '30', name: 'Last 30 days' },
    { id: '90', name: 'Last 90 days' },
  ];

  const locations = [
    { id: 'all', name: 'All Locations' },
    { id: 'loc_bar1', name: 'Bar 1' },
    { id: 'loc_restaurant', name: 'Restaurant' },
    { id: 'loc_main_cellar', name: 'Main Cellar' },
  ];

  const fetchPilferageData = async () => {
    setLoading(true);
    try {
      // Pilferage = real expected (theoretical) vs counted (physical) variance.
      // That data is produced by Inventory → Stock Take / Variance Report, which
      // posts genuine variance per item+location. We do NOT fabricate shrinkage
      // figures — surfacing random "theft" numbers in production is dangerous.
      setPilferageData([]);
    } catch (error) {
      console.error('Failed to fetch pilferage data:', error);
      setPilferageData([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPilferageData();
  }, [period, location]);

  const getRiskColor = (risk: string) => {
    switch (risk) {
      case 'Critical': return 'destructive';
      case 'High': return 'destructive';
      case 'Medium': return 'secondary';
      case 'Low': return 'default';
      default: return 'default';
    }
  };

  const getTotalVarianceValue = () => {
    return pilferageData.reduce((sum, item) => sum + item.variance_value, 0);
  };

  const getHighRiskItems = () => {
    return pilferageData.filter(item => item.risk_level === 'Critical' || item.risk_level === 'High').length;
  };

  const exportToCSV = () => {
    const csvData = pilferageData.map(item => ({
      'Item Name': item.item_name,
      'SKU': item.sku,
      'Category': item.category,
      'Expected Qty': item.expected_qty,
      'Actual Qty': item.actual_qty,
      'Variance Qty': item.variance_qty,
      'Variance %': Number(item.variance_percentage || 0).toFixed(2),
      'Variance Value': Number(item.variance_value || 0).toFixed(2),
      'Risk Level': item.risk_level,
      'Last Count Date': item.last_count_date
    }));

    const csvString = [
      Object.keys(csvData[0]).join(','),
      ...csvData.map(row => Object.values(row).join(','))
    ].join('\n');

    const blob = new Blob([csvString], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pilferage_analysis_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Pilferage Analysis Report</h1>
          <p className="text-muted-foreground">Shrinkage and potential theft detection analysis</p>
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
            <CardTitle className="text-sm font-medium">Total Items Analyzed</CardTitle>
            <Eye className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{pilferageData.length}</div>
            <p className="text-xs text-muted-foreground">
              Items in analysis
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Shrinkage Value</CardTitle>
            <TrendingDown className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(getTotalVarianceValue())}</div>
            <p className="text-xs text-muted-foreground">
              Potential loss value
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">High Risk Items</CardTitle>
            <AlertTriangle className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">{getHighRiskItems()}</div>
            <p className="text-xs text-muted-foreground">
              Critical/High risk items
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Analysis Period</CardTitle>
            <Calendar className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{period}</div>
            <p className="text-xs text-muted-foreground">
              Days analyzed
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Pilferage Analysis Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Shrinkage Analysis by Item
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-center text-muted-foreground">Loading pilferage analysis...</p>
          ) : pilferageData.length === 0 ? (
            <div className="text-center py-8 space-y-1">
              <p className="font-medium text-muted-foreground">Not connected to live variance data</p>
              <p className="text-xs text-muted-foreground">Run Inventory → Stock Take to produce real expected-vs-counted variance. This analysis will be enabled once wired to that source — no estimated shrinkage figures are shown.</p>
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item Name</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Expected</TableHead>
                    <TableHead className="text-right">Actual</TableHead>
                    <TableHead className="text-right">Variance</TableHead>
                    <TableHead className="text-right">Variance %</TableHead>
                    <TableHead className="text-right">Loss Value</TableHead>
                    <TableHead>Risk Level</TableHead>
                    <TableHead>Last Count</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pilferageData.map((item, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="font-medium">{String(item.item_name)}</TableCell>
                      <TableCell>{String(item.sku)}</TableCell>
                      <TableCell>{String(item.category)}</TableCell>
                      <TableCell className="text-right">{item.expected_qty}</TableCell>
                      <TableCell className="text-right">{item.actual_qty}</TableCell>
                      <TableCell className="text-right font-medium text-red-600">
                        -{item.variance_qty}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {Number(item.variance_percentage || 0).toFixed(1)}%
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(item.variance_value)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={getRiskColor(item.risk_level) as any}>
                          {String(item.risk_level)}
                        </Badge>
                      </TableCell>
                      <TableCell>{String(item.last_count_date)}</TableCell>
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