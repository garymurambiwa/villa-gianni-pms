/**
 * COREPMS v11 - Variance Report Viewer
 * Location: src/components/modules/InventoryV11VarianceReport.tsx
 */

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CheckCircle, AlertCircle, AlertTriangle, Download, ChevronLeft } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface VarianceLine {
  item_id: string;
  name: string;
  theoretical_qty: number;
  physical_qty: number;
  variance_qty: number;
  variance_percentage: number;
  variance_value: number;
  alert_level: 'OK' | 'WARNING' | 'CRITICAL';
}

interface VarianceReport {
  id: string;
  report_number: string;
  location_id: string;
  period_start: string;
  period_end: string;
  total_items: number;
  ok_count: number;
  warning_count: number;
  critical_count: number;
  total_variance_value?: number;
  lines: VarianceLine[];
}

export const InventoryV11VarianceReport: React.FC = () => {
  const { toast } = useToast();
  const [periodStart, setPeriodStart] = useState(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]);
  const [periodEnd, setPeriodEnd] = useState(new Date().toISOString().split('T')[0]);
  const [location, setLocation] = useState('loc_main_cellar');
  const [report, setReport] = useState<VarianceReport | null>(null);
  const [loading, setLoading] = useState(false);

  const navigateTo = (module: string) => {
    window.dispatchEvent(new CustomEvent('navigateToModule', { detail: { module } }));
  };

  const locations = [
    { id: 'loc_main_cellar', name: 'Main Cellar' },
    { id: 'loc_bar1', name: 'Bar 1' },
    { id: 'loc_restaurant', name: 'Restaurant' },
  ];

  const generateReport = async () => {
    if (!periodStart || !periodEnd) {
      toast({
        title: 'Error',
        description: 'Please select period start and end dates',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/v1/inventory/variance/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          location_id: location,
          period_start: periodStart,
          period_end: periodEnd,
          generated_by: 'current-user',
        }),
      });

      const result = await response.json();

      if (result.ok) {
        // Fetch the generated report details
        const detailRes = await fetch(`/api/v1/inventory/variance/${result.data.id}`);
        const detailData = await detailRes.json();

        if (detailData.ok) {
          const reportData = detailData.data;
          // Calculate total variance value from lines
          const totalVarianceValue = reportData.lines.reduce((sum, line) => sum + parseFloat(line.variance_value || 0), 0);
          setReport({
            ...reportData,
            total_variance_value: totalVarianceValue
          });
          toast({
            title: 'Success',
            description: `Variance report generated: ${result.data.report_number}`,
          });
        }
      } else {
        throw new Error(result.error);
      }
    } catch (error: unknown) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const getAlertIcon = (level: string) => {
    switch (level) {
      case 'OK':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'WARNING':
        return <AlertCircle className="w-4 h-4 text-amber-500" />;
      case 'CRITICAL':
        return <AlertTriangle className="w-4 h-4 text-red-500" />;
      default:
        return null;
    }
  };

  const getAlertColor = (level: string) => {
    switch (level) {
      case 'OK':
        return 'bg-green-50 border-green-200';
      case 'WARNING':
        return 'bg-amber-50 border-amber-200';
      case 'CRITICAL':
        return 'bg-red-50 border-red-200';
      default:
        return '';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 mb-4">
        <Button 
          variant="ghost" 
          size="sm"
          onClick={() => navigateTo('inventory-v11')}
          className="gap-2"
        >
          <ChevronLeft className="w-4 h-4" />
          Back to Inventory
        </Button>
      </div>

      {/* Report Generator */}
      <Card>
        <CardHeader>
          <CardTitle>Generate Variance Report</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <Label htmlFor="location">Location</Label>
              <Select value={location} onValueChange={setLocation}>
                <SelectTrigger className="mt-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {locations.map(loc => (
                    <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="start">Period Start</Label>
              <Input
                id="start"
                type="date"
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
                className="mt-1.5"
              />
            </div>

            <div>
              <Label htmlFor="end">Period End</Label>
              <Input
                id="end"
                type="date"
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
                className="mt-1.5"
              />
            </div>

            <div className="flex items-end">
              <Button
                onClick={generateReport}
                disabled={loading}
                style={{ backgroundColor: '#1D9E75' }}
                className="w-full text-white hover:opacity-90"
              >
                {loading ? 'Generating...' : 'Generate Report'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Report Summary */}
      {report && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-6">
                <div className="text-center">
                  <div className="text-3xl font-bold text-green-600">{report.ok_count}</div>
                  <p className="text-xs text-gray-500 mt-1">{'OK (< 2%)'}</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="text-center">
                  <div className="text-3xl font-bold text-amber-600">{report.warning_count}</div>
                  <p className="text-xs text-gray-500 mt-1">Warning (2-5%)</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="text-center">
                  <div className="text-3xl font-bold text-red-600">{report.critical_count}</div>
                  <p className="text-xs text-gray-500 mt-1">{'Critical (> 5%)'}</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="text-center">
                  <div className="text-3xl font-bold" style={{ color: '#1D9E75' }}>
                    ${report.total_variance_value?.toFixed(2) || '0.00'}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">Total Value</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Detailed Lines */}
          <Card>
            <CardHeader className="flex justify-between items-center">
              <CardTitle>Variance Details</CardTitle>
              <Button size="sm" variant="outline">
                <Download className="w-4 h-4 mr-1" />
                Export PDF
              </Button>
            </CardHeader>
            <CardContent>
              <div className="border rounded-lg overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium">Item</th>
                      <th className="px-4 py-2 text-right font-medium">POS Theoretical</th>
                      <th className="px-4 py-2 text-right font-medium">Physical Count</th>
                      <th className="px-4 py-2 text-right font-medium">Variance Qty</th>
                      <th className="px-4 py-2 text-right font-medium">Variance %</th>
                      <th className="px-4 py-2 text-right font-medium">Variance Value</th>
                      <th className="px-4 py-2 text-center font-medium">Alert</th>
                    </tr>
                  </thead>
                  <tbody>
                     {report.lines.map((line, idx) => (
                       <tr key={idx} className={`border-b ${getAlertColor(line.alert_level)}`}>
                         <td className="px-4 py-2">
                           <div>
                             <div className="font-medium">{line.name}</div>
                             <div className="text-xs text-gray-500">{line.item_id}</div>
                           </div>
                         </td>
                         <td className="px-4 py-2 text-right">{Number(line.theoretical_qty || 0).toFixed(2)}</td>
                         <td className="px-4 py-2 text-right">{Number(line.physical_qty || 0).toFixed(2)}</td>
                         <td className="px-4 py-2 text-right font-medium">{Number(line.variance_qty || 0).toFixed(2)}</td>
                         <td className="px-4 py-2 text-right font-medium">{Number(line.variance_percentage || 0).toFixed(2)}%</td>
                         <td className="px-4 py-2 text-right font-medium">${Number(line.variance_value || 0).toFixed(2)}</td>
                         <td className="px-4 py-2 text-center">{getAlertIcon(line.alert_level)}</td>
                       </tr>
                     ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {!report && !loading && (
        <Card>
          <CardContent className="pt-12 pb-12 text-center">
            <p className="text-gray-500">Generate a report to view variance details</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default InventoryV11VarianceReport;
