/**
 * COREPMS v11 - Recipe Builder & Bill of Materials
 * Location: src/components/modules/InventoryV11RecipeBuilder.tsx
 */

import React, { useState, useEffect } from 'react';
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
import { Plus, Trash2, Save, ChevronLeft } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface RecipeLine {
  id: string;
  item_id: string;
  qty_required: number;
  prep_uom_id: string;
  wastage_pct: number;
  item_name?: string;
  cost?: number;
}

export const InventoryV11RecipeBuilder: React.FC = () => {
  const { toast } = useToast();
  const [menuItemId, setMenuItemId] = useState('');
  const [lines, setLines] = useState<RecipeLine[]>([]);
  const [totalCost, setTotalCost] = useState(0);
  const [loading, setLoading] = useState(false);

  const navigateTo = (module: string) => {
    window.dispatchEvent(new CustomEvent('navigateToModule', { detail: { module } }));
  };

  const uoms = [
    { id: 'uom_gram', code: 'GRAM' },
    { id: 'uom_ml', code: 'ML' },
    { id: 'uom_tot', code: 'TOT' },
    { id: 'uom_unit', code: 'UNIT' },
  ];

  const addLine = () => {
    setLines([
      ...lines,
      {
        id: Math.random().toString(),
        item_id: '',
        qty_required: 0,
        prep_uom_id: 'uom_gram',
        wastage_pct: 0,
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

  useEffect(() => {
    // Calculate total theoretical cost
    const total = lines.reduce((sum, line) => {
      const cost = line.cost || 0;
      const qty = line.qty_required;
      const wastage = 1 + (line.wastage_pct || 0) / 100;
      return sum + cost * qty * wastage;
    }, 0);
    setTotalCost(total);
  }, [lines]);

  const handleSubmit = async () => {
    if (!menuItemId || lines.length === 0) {
      toast({
        title: 'Validation Error',
        description: 'Please select a menu item and add ingredients',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/v1/inventory/recipe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          menu_item_id: menuItemId,
          created_by: 'current-user',
          lines: lines.map(line => ({
            item_id: line.item_id,
            qty_required: line.qty_required,
            prep_uom_id: line.prep_uom_id,
            wastage_pct: line.wastage_pct,
          })),
        }),
      });

      const result = await response.json();

      if (result.ok) {
        toast({
          title: 'Success',
          description: 'Recipe saved successfully',
        });

        setMenuItemId('');
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
          <CardTitle>Recipe Builder</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Menu Item Selection */}
          <div className="max-w-md">
            <Label htmlFor="menuItem">Menu Item *</Label>
            <Input
              id="menuItem"
              placeholder="Menu Item ID or name"
              value={menuItemId}
              onChange={(e) => setMenuItemId(e.target.value)}
              className="mt-1.5"
            />
          </div>

          {/* Ingredients */}
          <div>
            <div className="flex justify-between items-center mb-3">
              <Label className="font-semibold">Ingredients</Label>
              <Button size="sm" variant="outline" onClick={addLine}>
                <Plus className="w-4 h-4 mr-1" />
                Add Ingredient
              </Button>
            </div>

            <div className="border rounded-lg overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Item ID</th>
                    <th className="px-4 py-2 text-left font-medium">Item Name</th>
                    <th className="px-4 py-2 text-left font-medium">Qty</th>
                    <th className="px-4 py-2 text-left font-medium">UOM</th>
                    <th className="px-4 py-2 text-left font-medium">Wastage %</th>
                    <th className="px-4 py-2 text-right font-medium">Cost</th>
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
                      <td className="px-4 py-2 text-gray-600">{line.item_name || '-'}</td>
                      <td className="px-4 py-2">
                        <Input
                          type="number"
                          placeholder="0.00"
                          value={line.qty_required}
                          onChange={(e) => updateLine(line.id, 'qty_required', parseFloat(e.target.value))}
                          className="text-xs"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <Select value={line.prep_uom_id} onValueChange={(val) => updateLine(line.id, 'prep_uom_id', val)}>
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
                      <td className="px-4 py-2">
                        <Input
                          type="number"
                          placeholder="0"
                          value={line.wastage_pct}
                          onChange={(e) => updateLine(line.id, 'wastage_pct', parseFloat(e.target.value))}
                          className="text-xs"
                        />
                      </td>
                      <td className="px-4 py-2 text-right font-medium">${((line.cost || 0) * line.qty_required).toFixed(2)}</td>
                      <td className="px-4 py-2 text-center">
                        <Button size="sm" variant="ghost" onClick={() => removeLine(line.id)}>
                          <Trash2 className="w-4 h-4 text-red-500" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {lines.length === 0 && (
              <p className="text-center text-sm text-gray-500 py-4">No ingredients added. Click "Add Ingredient" to begin.</p>
            )}
          </div>

          {/* Total Cost */}
          {lines.length > 0 && (
            <div className="flex justify-end">
              <Card>
                <CardContent className="pt-6 w-64">
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>Ingredient Cost</span>
                      <span>${totalCost.toFixed(2)}</span>
                    </div>
                    <div className="pt-2 border-t border-gray-200">
                      <div className="flex justify-between font-semibold">
                        <span>Theoretical Cost per Unit</span>
                        <span style={{ color: '#1D9E75' }}>${totalCost.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button variant="outline">Cancel</Button>
            <Button
              onClick={handleSubmit}
              disabled={loading || lines.length === 0}
              style={{ backgroundColor: '#1D9E75' }}
              className="text-white hover:opacity-90"
            >
              <Save className="w-4 h-4 mr-1" />
              {loading ? 'Saving...' : 'Save Recipe'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default InventoryV11RecipeBuilder;
