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

import { Plus, Trash2, ChevronLeft, Check } from 'lucide-react';
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

// Auto-suggest text input component for item selection
interface ItemAutoSuggestProps {
  value: string;
  onSelect: (item: InventoryItem) => void;
  onChange: (value: string) => void;
  items: InventoryItem[];
  placeholder?: string;
}

const ItemAutoSuggest: React.FC<ItemAutoSuggestProps> = ({
  value,
  onSelect,
  onChange,
  items,
  placeholder = "Type to search items..."
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);

  // Filter items based on current input
  const filteredItems = items.filter(item =>
    item.name.toLowerCase().includes(value.toLowerCase()) ||
    (item.sku && item.sku.toLowerCase().includes(value.toLowerCase()))
  ).slice(0, 8); // Limit to 8 suggestions

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    onChange(newValue);
    setIsOpen(newValue.length > 0 && filteredItems.length > 0);
    setSelectedIndex(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen || filteredItems.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(prev => Math.min(prev + 1, filteredItems.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev => Math.max(prev - 1, -1));
        break;
      case 'Enter':
        e.preventDefault();
        if (selectedIndex >= 0 && selectedIndex < filteredItems.length) {
          handleItemSelect(filteredItems[selectedIndex]);
        }
        break;
      case 'Escape':
        setIsOpen(false);
        setSelectedIndex(-1);
        break;
    }
  };

  const handleItemSelect = (item: InventoryItem) => {
    onSelect(item);
    setIsOpen(false);
    setSelectedIndex(-1);
  };

  const handleFocus = () => {
    if (value.length > 0 && filteredItems.length > 0) {
      setIsOpen(true);
    }
  };

  const handleBlur = () => {
    // Delay closing to allow click events on suggestions
    setTimeout(() => {
      setIsOpen(false);
      setSelectedIndex(-1);
    }, 150);
  };

  return (
    <div className="relative">
      <Input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        onBlur={handleBlur}
        className="text-xs"
        autoComplete="off"
      />

      {isOpen && filteredItems.length > 0 && (
        <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-64 overflow-y-auto">
          {filteredItems.map((item, index) => (
            <div
              key={item.id}
              className={`px-3 py-2 cursor-pointer hover:bg-gray-100 text-xs ${
                index === selectedIndex ? 'bg-blue-50' : ''
              }`}
              onMouseDown={(e) => {
                e.preventDefault();
                handleItemSelect(item);
              }}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              <div className="font-medium">{item.name}</div>
              <div className="text-gray-500 text-xs">
                {item.sku && `SKU: ${item.sku}`} • {item.category} • {item.base_uom_symbol}
              </div>
            </div>
          ))}
        </div>
      )}

      {value.length > 0 && filteredItems.length === 0 && (
        <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg p-3 text-xs text-gray-500">
          No matching items found. Only existing inventory items are allowed.
        </div>
      )}
    </div>
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

  const handleItemNameChange = (lineId: string, value: string) => {
    updateLine(lineId, 'item_name', value);
    // Clear item_id if name is cleared or changed manually
    if (!value.trim()) {
      updateLine(lineId, 'item_id', '');
    }
  };

  const removeLine = (id: string) => {
    setLines(lines.filter(line => line.id !== id));
  };

  const updateLine = (id: string, field: keyof GRNLineItem, value: GRNLineItem[keyof GRNLineItem]) => {
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
      if (!line.item_name || line.qty_received <= 0 || line.unit_cost < 0) {
        toast({
          title: 'Invalid Line Item',
          description: `All line items must have: Valid item name (from inventory), Quantity > 0, and Unit Cost ≥ 0`,
          variant: 'destructive',
        });
        return;
      }

      // Validate that item_name matches a valid inventory item
      const validItem = inventoryItems.find(item => item.name === line.item_name.trim());
      if (!validItem) {
        toast({
          title: 'Invalid Item Name',
          description: `"${line.item_name}" is not a valid inventory item. Please select from the auto-suggestions.`,
          variant: 'destructive',
        });
        return;
      }

      // Ensure item_id is set correctly
      if (!line.item_id || line.item_id !== validItem.id) {
        updateLine(line.id, 'item_id', validItem.id);
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
    } catch (error: unknown) {
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
          {itemsLoading ? 'Loading items...' : `${inventoryItems.length} items available for selection`}
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
                        <ItemAutoSuggest
                          value={line.item_name}
                          onSelect={(item) => selectItem(line.id, item)}
                          onChange={(value) => handleItemNameChange(line.id, value)}
                          items={inventoryItems}
                          placeholder="Type item name..."
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
