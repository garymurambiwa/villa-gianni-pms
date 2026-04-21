/**
 * COREPMS v11 - GRN (Goods Received Note) Form Screen
 * Location: src/components/modules/InventoryV11GRNForm.tsx
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
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Plus, Trash2, Check, ChevronLeft, ChevronsUpDown } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface InventoryItem {
  id: string;
  name: string;
  category: string;
  sku: string;
  barcode: string;
  base_uom_symbol: string;
  weighted_avg_cost: number;
}

interface GRNLineItem {
  id: string;
  item_id: string;
  item_name: string;
  qty_received: number;
  received_uom_id: string;
  unit_cost: number;
}

// Item selector combobox component
interface ItemSelectorProps {
  value: string;
  onSelect: (item: InventoryItem) => void;
  items: InventoryItem[];
  placeholder?: string;
}

const ItemSelector: React.FC<ItemSelectorProps> = ({ value, onSelect, items, placeholder = "Select item..." }) => {
  const [open, setOpen] = useState(false);

  console.log('🎯 ItemSelector rendered with', items.length, 'items, value:', value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between text-xs h-8"
        >
          {value || placeholder}
          <ChevronsUpDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-0">
        <Command>
          <CommandInput placeholder="Search items..." className="text-xs" />
          <CommandEmpty>No items found.</CommandEmpty>
          <CommandGroup className="max-h-64 overflow-auto">
            {items.map((item) => (
              <CommandItem
                key={item.id}
                value={item.name}
                onSelect={() => {
                  onSelect(item);
                  setOpen(false);
                }}
                className="text-xs"
              >
                <Check
                  className={`mr-2 h-3 w-3 ${
                    value === item.name ? "opacity-100" : "opacity-0"
                  }`}
                />
                <div className="flex flex-col">
                  <span className="font-medium">{item.name}</span>
                  <span className="text-xs text-gray-500">
                    {item.sku && `SKU: ${item.sku}`} • {item.category} • {item.base_uom_symbol}
                  </span>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

export const InventoryV11GRNForm: React.FC = () => {
  const { toast } = useToast();
  const [supplierName, setSupplierName] = useState('');
  const [destinationLocation, setDestinationLocation] = useState('loc_main_cellar');
  const [lines, setLines] = useState<GRNLineItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);

  const navigateTo = (module: string) => {
    window.dispatchEvent(new CustomEvent('navigateToModule', { detail: { module } }));
  };

  // Fetch inventory items on component mount
  useEffect(() => {
    fetchInventoryItems();
  }, []);

  const fetchInventoryItems = async () => {
    setItemsLoading(true);
    try {
      console.log('🔍 Fetching inventory items from /api/v1/inventory/items?limit=1000');
      const response = await fetch('/api/v1/inventory/items?limit=1000');
      console.log('📡 Response status:', response.status);

      if (!response.ok) {
        console.error('❌ Response not OK:', response.status, response.statusText);
        return;
      }

      const result = await response.json();
      console.log('📦 API result:', result);

      if (result.ok && result.data) {
        console.log('✅ Setting', result.data.length, 'inventory items');
        setInventoryItems(result.data);
      } else {
        console.error('❌ API returned error:', result.error);
      }
    } catch (error) {
      console.error('💥 Error fetching inventory items:', error);
    } finally {
      setItemsLoading(false);
    }
  };

  const locations = [
    { id: 'loc_main_cellar', name: 'Main Cellar' },
    { id: 'loc_dry_goods', name: 'Dry Goods Store' },
    { id: 'loc_freezer', name: 'Freezer / Perishables' },
  ];

  const uoms = [
    { id: 'uom_case', code: 'CASE' },
    { id: 'uom_bottle', code: 'BOTTLE' },
    { id: 'uom_ml', code: 'ML' },
    { id: 'uom_gram', code: 'GRAM' },
    { id: 'uom_kg', code: 'KG' },
    { id: 'uom_crate', code: 'CRATE' },
  ];

  const addLine = () => {
    setLines([
      ...lines,
      {
        id: Math.random().toString(),
        item_id: '',
        item_name: '',
        qty_received: 0,
        received_uom_id: 'uom_case',
        unit_cost: 0,
      },
    ]);
  };

  const selectItem = (lineId: string, item: InventoryItem) => {
    updateLine(lineId, 'item_id', item.id);
    updateLine(lineId, 'item_name', item.name);
    // Auto-set UOM to item's base UOM if available
    if (item.base_uom_symbol) {
      const uomMapping: { [key: string]: string } = {
        'CASE': 'uom_case',
        'BOTTLE': 'uom_bottle',
        'ML': 'uom_ml',
        'GRAM': 'uom_gram',
        'KG': 'uom_kg',
        'UNIT': 'uom_unit',
      };
      const uomId = uomMapping[item.base_uom_symbol] || 'uom_case';
      updateLine(lineId, 'received_uom_id', uomId);
    }
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

  const calculateTotal = () => {
    return lines.reduce((sum, line) => sum + line.qty_received * line.unit_cost, 0).toFixed(2);
  };

  const handleSubmit = async () => {
    if (!supplierName || !destinationLocation || lines.length === 0) {
      toast({
        title: 'Validation Error',
        description: 'Please fill all required fields and add at least one line item',
        variant: 'destructive',
      });
      return;
    }

    // Validate all lines have required data
    for (const line of lines) {
      if (!line.item_id || !line.item_name || line.qty_received <= 0 || line.unit_cost < 0) {
        toast({
          title: 'Invalid Line Item',
          description: `All line items must have: Item name, Quantity > 0, and Unit Cost ≥ 0`,
          variant: 'destructive',
        });
        return;
      }
    }

    setLoading(true);
    try {
      const response = await fetch('/api/v1/inventory/grn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supplier_name: supplierName,
          destination_location_id: destinationLocation,
          created_by: 'current-user',
          lines: lines,
        }),
      });

      const result = await response.json();

      if (result.ok) {
        toast({
          title: 'Success',
          description: `GRN created: ${result.data.grn_number}`,
        });

        // Reset form
        setSupplierName('');
        setDestinationLocation('loc_main_cellar');
        setLines([]);
      } else {
        throw new Error(result.error || 'Failed to create GRN');
      }
    } catch (error: any) {
      console.error('GRN submission error:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to create GRN. Please try again.',
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
        <span className="text-xs text-gray-500">
          {itemsLoading ? 'Loading items...' : `${inventoryItems.length} items available`}
        </span>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Create Goods Received Note</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Header Information */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="supplier">Supplier Name *</Label>
              <Input
                id="supplier"
                placeholder="e.g., Premium Beverages Ltd"
                value={supplierName}
                onChange={(e) => setSupplierName(e.target.value)}
                className="mt-1.5"
              />
            </div>

            <div>
              <Label htmlFor="location">Destination Location *</Label>
              <Select value={destinationLocation} onValueChange={setDestinationLocation}>
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
          </div>

          {/* Line Items Table */}
          <div>
            <div className="flex justify-between items-center mb-3">
              <Label className="font-semibold">Line Items</Label>
              <Button size="sm" variant="outline" onClick={addLine}>
                <Plus className="w-4 h-4 mr-1" />
                Add Line
              </Button>
            </div>

            <div className="border rounded-lg overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Item Name</th>
                    <th className="px-4 py-2 text-left font-medium">Qty Received</th>
                    <th className="px-4 py-2 text-left font-medium">UOM</th>
                    <th className="px-4 py-2 text-left font-medium">Unit Cost</th>
                    <th className="px-4 py-2 text-right font-medium">Line Total</th>
                    <th className="px-4 py-2 text-center font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, idx) => (
                    <tr key={line.id} className="border-b hover:bg-gray-50">
                      <td className="px-4 py-2">
                        <ItemSelector
                          value={line.item_name}
                          onSelect={(item) => selectItem(line.id, item)}
                          items={inventoryItems}
                          placeholder="Select item..."
                        />
                      </td>
                      <td className="px-4 py-2">
                        <Input
                          type="number"
                          placeholder="0.00"
                          value={line.qty_received}
                          onChange={(e) => updateLine(line.id, 'qty_received', parseFloat(e.target.value))}
                          className="text-xs"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <Select value={line.received_uom_id} onValueChange={(val) => updateLine(line.id, 'received_uom_id', val)}>
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
                          placeholder="0.00"
                          value={line.unit_cost}
                          onChange={(e) => updateLine(line.id, 'unit_cost', parseFloat(e.target.value))}
                          className="text-xs"
                        />
                      </td>
                      <td className="px-4 py-2 text-right font-medium">
                        ${(line.qty_received * line.unit_cost).toFixed(2)}
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
              <p className="text-center text-sm text-gray-500 py-4">No line items added. Click "Add Line" to begin.</p>
            )}
          </div>

          {/* Total Summary */}
          {lines.length > 0 && (
            <div className="flex justify-end">
              <Card className="w-full md:w-64">
                <CardContent className="pt-6">
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>Subtotal:</span>
                      <span>${calculateTotal()}</span>
                    </div>
                    <div className="pt-2 border-t border-gray-200">
                      <div className="flex justify-between font-semibold">
                        <span>Total GRN Value:</span>
                        <span className="text-lg" style={{ color: '#1D9E75' }}>${calculateTotal()}</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Submit Buttons */}
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button variant="outline">Cancel</Button>
            <Button
              onClick={handleSubmit}
              disabled={loading || lines.length === 0}
              style={{ backgroundColor: '#1D9E75' }}
              className="text-white hover:opacity-90"
            >
              <Check className="w-4 h-4 mr-1" />
              {loading ? 'Creating...' : 'Create GRN'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default InventoryV11GRNForm;
