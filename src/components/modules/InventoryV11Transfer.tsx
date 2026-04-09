/**
 * COREPMS v11 - Stock Transfer Screen
 * Location: src/components/modules/InventoryV11Transfer.tsx
 */

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Plus, Trash2, CheckCircle, ChevronLeft } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface TransferLine {
  id: string;
  item_id: string;
  qty_requested: number;
  source_uom_id: string;
  breakdown_flag: boolean;
  destination_uom_id?: string;
  current_source_balance: number;
}

export const InventoryV11Transfer: React.FC = () => {
  const { toast } = useToast();
  const [sourceLocation, setSourceLocation] = useState('loc_main_cellar');
  const [destinationLocation, setDestinationLocation] = useState('loc_bar1');
  const [referenceText, setReferenceText] = useState('');
  const [lines, setLines] = useState<TransferLine[]>([]);
  const [loading, setLoading] = useState(false);

  const navigateTo = (module: string) => {
    window.dispatchEvent(new CustomEvent('navigateToModule', { detail: { module } }));
  };

  const locations = [
    { id: 'loc_main_cellar', name: 'Main Cellar', type: 'Storage' },
    { id: 'loc_dry_goods', name: 'Dry Goods Store', type: 'Storage' },
    { id: 'loc_freezer', name: 'Freezer / Perishables', type: 'Storage' },
    { id: 'loc_bar1', name: 'Bar 1', type: 'Outlet' },
    { id: 'loc_restaurant', name: 'Restaurant', type: 'Outlet' },
  ];

  const storageLocations = locations.filter(l => l.type === 'Storage');
  const outletLocations = locations.filter(l => l.type === 'Outlet');

  const uoms = [
    { id: 'uom_case', code: 'CASE' },
    { id: 'uom_bottle', code: 'BOTTLE' },
    { id: 'uom_tot', code: 'TOT' },
    { id: 'uom_ml', code: 'ML' },
    { id: 'uom_gram', code: 'GRAM' },
  ];

  const addLine = () => {
    setLines([
      ...lines,
      {
        id: Math.random().toString(),
        item_id: '',
        qty_requested: 0,
        source_uom_id: 'uom_bottle',
        breakdown_flag: false,
        current_source_balance: 0,
      },
    ]);
  };

  const removeLine = (id: string) => {
    setLines(lines.filter(line => line.id !== id));
  };

  const updateLine = (id: string, field: string, value: any) => {
    setLines(
      lines.map(line =>
        line.id === id ? { ...line, [field]: value } : line
      )
    );
  };

  const handleSubmit = async () => {
    if (!sourceLocation || !destLocation || lines.length === 0) {
      toast({
        title: 'Validation Error',
        description: 'Please fill all required fields and add at least one line item',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/v1/inventory/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_location_id: sourceLocation,
          destination_location_id: destLocation,
          created_by: 'current-user',
          reference_text: referenceText,
          lines: lines,
        }),
      });

      const result = await response.json();

      if (result.ok) {
        toast({
          title: 'Success',
          description: `Transfer created: ${result.data.transfer_number}`,
        });

        // Reset form
        setReferenceText('');
        setLines([]);
      } else {
        throw new Error(result.error);
      }
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
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

      <Card>
        <CardHeader>
          <CardTitle>Stock Transfer</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Locations */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <div>
              <Label htmlFor="source">Source Location *</Label>
              <Select value={sourceLocation} onValueChange={setSourceLocation}>
                <SelectTrigger className="mt-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {storageLocations.map(loc => (
                    <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex justify-center pb-2">
              <div className="text-2xl font-bold text-gray-400">→</div>
            </div>

            <div>
              <Label htmlFor="dest">Destination Location *</Label>
              <Select value={destLocation} onValueChange={setDestLocation}>
                <SelectTrigger className="mt-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {outletLocations.map(loc => (
                    <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Reference */}
          <div>
            <Label htmlFor="reference">Reference Note</Label>
            <Input
              id="reference"
              placeholder="e.g., Restock Bar 1 - Saturday service"
              value={referenceText}
              onChange={(e) => setReferenceText(e.target.value)}
              className="mt-1.5"
            />
          </div>

          {/* Line Items */}
          <div>
            <div className="flex justify-between items-center mb-3">
              <Label className="font-semibold">Items to Transfer</Label>
              <Button size="sm" variant="outline" onClick={addLine}>
                <Plus className="w-4 h-4 mr-1" />
                Add Item
              </Button>
            </div>

            <div className="border rounded-lg overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Item ID</th>
                    <th className="px-4 py-2 text-left font-medium">Current Balance</th>
                    <th className="px-4 py-2 text-left font-medium">Qty to Transfer</th>
                    <th className="px-4 py-2 text-left font-medium">Source UOM</th>
                    <th className="px-4 py-2 text-center font-medium">Breakdown</th>
                    <th className="px-4 py-2 text-center font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => (
                    <tr key={line.id} className="border-b hover:bg-gray-50">
                      <td className="px-4 py-2">
                        <Input
                          placeholder="Item ID"
                          value={line.item_id}
                          onChange={(e) => updateLine(line.id, 'item_id', e.target.value)}
                          className="text-xs"
                        />
                      </td>
                      <td className="px-4 py-2 font-medium text-green-600">{line.current_source_balance.toFixed(2)}</td>
                      <td className="px-4 py-2">
                        <Input
                          type="number"
                          placeholder="0.00"
                          value={line.qty_requested}
                          onChange={(e) => updateLine(line.id, 'qty_requested', parseFloat(e.target.value))}
                          className="text-xs"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <Select value={line.source_uom_id} onValueChange={(val) => updateLine(line.id, 'source_uom_id', val)}>
                          <SelectTrigger className="text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {uoms.map(uom => (
                              <SelectItem key={uom.id} value={uom.id}>{uom.code}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-4 py-2 text-center">
                        <Checkbox
                          checked={line.breakdown_flag}
                          onCheckedChange={(checked) => updateLine(line.id, 'breakdown_flag', checked)}
                        />
                      </td>
                      <td className="px-4 py-2 text-center">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => removeLine(line.id)}
                        >
                          <Trash2 className="w-4 h-4 text-red-500" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {lines.length === 0 && (
              <p className="text-center text-sm text-gray-500 py-4">No items added. Click "Add Item" to begin.</p>
            )}
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button variant="outline">Cancel</Button>
            <Button
              onClick={handleSubmit}
              disabled={loading || lines.length === 0}
              style={{ backgroundColor: '#1D9E75' }}
              className="text-white hover:opacity-90"
            >
              <CheckCircle className="w-4 h-4 mr-1" />
              {loading ? 'Creating...' : 'Create Transfer'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default InventoryV11Transfer;
