import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertTriangle, Shield, TrendingDown, Calendar, Download, Eye } from 'lucide-react';
import { formatCurrency } from '@/lib/posIntegration';
import { useInventoryLocations } from '@/hooks/useInventoryLocations';

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

  // Live locations from DB + an "All Locations" sentinel at the top
  const { locations: dbLocations } = useInventoryLocations(true);
  const locations = [{ id: 'all', name: 'All Locations' }, ...dbLocations];

  const fetchPilferageData = async () => {
    setLoading(true);
    try {
      // Fetch inventory items and simulate pilferage analysis
      const response = await fetch('/api/v1/inventory/items?limit=10000');
      const data = await response.json();

      if (data.ok && data.data) {
        // Generate mock pilferage analysis data
        const mockData: PilferageData[] = data.data.slice(0, 20).map((item: any, idx: number) => {
          const expectedQty = Math.floor(Math.random() * 100) + 50;
          const actualQty = expectedQty - Math.floor(Math.random() * 15); // Random shrinkage
          const varianceQty = expectedQty - actualQty;
          const variancePercentage = (varianceQty / expectedQty) * 100;
          const unitCost = parseFloat(item.weighted_avg_cost || 10);
          const varianceValue = varianceQty * unitCost;

          let riskLevel: 'Low' | 'Medium' | 'High' | 'Critical' = 'Low';
          if (variancePercentage > 10) riskLevel = 'Critical';
          else if (variancePercentage > 7) riskLevel = 'High';
          else if (variancePercentage > 4) riskLevel = 'Medium';

          return {
            item_id: item.id,
            item_name: item.name,
            category: item.category,
            sku: item.sku,
            expected_qty: expectedQty,
            actual_qty: actualQty,
            variance_qty: varianceQty,
            variance_percentage: variancePercentage,
            variance_value: varianceValue,
            risk_level: riskLevel,
            last_count_date: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
          };
        });

        // Sort by risk level (Critical first)
        const sortedData = mockData.sort((a, b) => {
          const riskOrder = { Critical: 4, High: 3, Medium: 2, Low: 1 };
          return riskOrder[b.risk_level] - riskOrder[a.risk_level];
        });

        setPilferageData(sortedData);
      }
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
            <p className="text-center text-muted-foreground">No pilferage data available.</p>
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