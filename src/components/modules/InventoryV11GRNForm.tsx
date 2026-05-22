/**
 * COREPMS v11 - GRN (Goods Received Note) Form Screen
 * Location: src/components/modules/InventoryV11GRNForm.tsx
 *
 * Adds per-line VAT tracking. Each row carries a vatType ('15.50' | '0') which
 * drives the Row VAT column. Line Total stays raw (Qty × Unit Cost); the
 * footer aggregates Sub Total, total VAT, and the grand GRN Total.
 */

import React, { useState, useMemo } from 'react';
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
import { Plus, Trash2, ChevronLeft, Check } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

type VatType = '15.50' | '0';

interface GRNLineItem {
  id: string;
  item_id: string;
  item_name: string;
  qty_received: number;
  received_uom_id: string;
  unit_cost: number;
  vat_type: VatType;
  expiry_date: string;
}

const todayISO = () => new Date().toISOString().slice(0, 10);

export const InventoryV11GRNForm: React.FC = () => {
  const { toast } = useToast();
  const [supplierName, setSupplierName] = useState('');
  const [supplierInvoice, setSupplierInvoice] = useState('');
  const [destinationLocation, setDestinationLocation] = useState('loc_main_cellar');
  const [receiptDate, setReceiptDate] = useState(todayISO());
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<GRNLineItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [autoPost, setAutoPost] = useState(true);

  const navigateTo = (module: string) => {
    window.dispatchEvent(new CustomEvent('navigateToModule', { detail: { module } }));
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
    setLines(prev => [
      ...prev,
      {
        id: Math.random().toString(36).slice(2),
        item_id: '',
        item_name: '',
        qty_received: 0,
        received_uom_id: 'uom_case',
        unit_cost: 0,
        vat_type: '15.50',
        expiry_date: '',
      },
    ]);
  };

  const removeLine = (id: string) => {
    setLines(prev => prev.filter(line => line.id !== id));
  };

  const updateLine = <K extends keyof GRNLineItem>(id: string, field: K, value: GRNLineItem[K]) => {
    setLines(prev => prev.map(line => (line.id === id ? { ...line, [field]: value } : line)));
  };

  // Derived per-line + footer totals. useMemo so recalcs happen on every keystroke
  // without re-running on unrelated state changes.
  const computed = useMemo(() => {
    const rows = lines.map(l => {
      const qty = Number(l.qty_received) || 0;
      const cost = Number(l.unit_cost) || 0;
      const rate = parseFloat(l.vat_type) || 0;
      const lineTotal = qty * cost;
      const rowVat = lineTotal * (rate / 100);
      return { id: l.id, lineTotal, rowVat };
    });
    const subTotal = rows.reduce((s, r) => s + r.lineTotal, 0);
    const totalVat = rows.reduce((s, r) => s + r.rowVat, 0);
    return { rows, subTotal, totalVat, grnTotal: subTotal + totalVat };
  }, [lines]);

  const fmt = (n: number) => n.toFixed(2);
  const valueFor = (id: string) => computed.rows.find(r => r.id === id) || { lineTotal: 0, rowVat: 0 };

  const handleSubmit = async () => {
    if (!supplierName || !destinationLocation || lines.length === 0) {
      toast({
        title: 'Validation Error',
        description: 'Please fill all required fields and add at least one line item',
        variant: 'destructive',
      });
      return;
    }

    for (const line of lines) {
      if (!line.item_name.trim() || line.qty_received <= 0 || line.unit_cost < 0) {
        toast({
          title: 'Invalid Line Item',
          description: `All line items must have: Item name, Quantity > 0, and Unit Cost ≥ 0`,
          variant: 'destructive',
        });
        return;
      }
      if (!line.item_id) {
        line.item_id = `item_${line.item_name.replace(/\s+/g, '_').toLowerCase()}_${Date.now()}`;
      }
    }

    setLoading(true);
    try {
      // Send per-line VAT details and the computed totals so the backend can
      // persist them without recomputing. Older endpoints will ignore unknown
      // fields safely.
      const linesWithVat = lines.map(l => {
        const c = valueFor(l.id);
        return {
          ...l,
          vat_rate: parseFloat(l.vat_type) || 0,
          line_total: c.lineTotal,
          row_vat: c.rowVat,
        };
      });

      const response = await fetch('/api/v1/inventory/grn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supplier_name: supplierName,
          supplier_invoice_number: supplierInvoice || null,
          destination_location_id: destinationLocation,
          receipt_date: receiptDate,
          header_notes: notes || null,
          created_by: 'current-user',
          lines: linesWithVat,
          totals: {
            sub_total: computed.subTotal,
            vat_total: computed.totalVat,
            grn_total: computed.grnTotal,
          },
        }),
      });

      const result = await response.json();

      if (response.ok) {
        if (autoPost) {
          toast({ title: 'Posting...', description: 'Officially updating stock levels...' });
          await fetch(`/api/v1/inventory/grn/${result.data.id}/post`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ posted_by: 'current-user' }),
          });
        }
        toast({
          title: 'Success',
          description: `GRN created ${autoPost ? 'and posted' : ''}: ${result.data.grn_number}`,
        });
        setSupplierName('');
        setSupplierInvoice('');
        setDestinationLocation('loc_main_cellar');
        setReceiptDate(todayISO());
        setNotes('');
        setLines([]);
      } else {
        throw new Error(result.error || 'Failed to create GRN');
      }
    } catch (error: any) {
      console.error('GRN submission error:', error);
      toast({
        title: 'Error',
        description: error?.message || 'Failed to create GRN. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 mb-4">
        <Button variant="ghost" size="sm" onClick={() => navigateTo('inventory-v11')} className="gap-2">
          <ChevronLeft className="w-4 h-4" />
          Back to Inventory
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>New Goods Received Note</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Header row 1: Supplier, Invoice #, Destination */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label htmlFor="supplier">Supplier *</Label>
              <Input
                id="supplier"
                placeholder="— Select supplier —"
                value={supplierName}
                onChange={(e) => setSupplierName(e.target.value)}
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="invoice">Supplier Invoice #</Label>
              <Input
                id="invoice"
                placeholder="INV-0001"
                value={supplierInvoice}
                onChange={(e) => setSupplierInvoice(e.target.value)}
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="location">Destination Store</Label>
              <Select value={destinationLocation} onValueChange={setDestinationLocation}>
                <SelectTrigger id="location" className="mt-1.5">
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

          {/* Header row 2: Receipt date + Notes */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label htmlFor="receipt-date">Receipt / Delivery Date</Label>
              <Input
                id="receipt-date"
                type="date"
                value={receiptDate}
                onChange={(e) => setReceiptDate(e.target.value)}
                className="mt-1.5"
              />
            </div>
            <div className="md:col-span-2">
              <Label htmlFor="notes">Notes</Label>
              <Input
                id="notes"
                placeholder="Delivery notes, batch info..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="mt-1.5"
              />
            </div>
          </div>

          {/* Line items */}
          <div>
            <div className="flex justify-between items-center mb-3">
              <Label className="font-semibold text-base">Line Items</Label>
              <Button size="sm" variant="outline" onClick={addLine}>
                <Plus className="w-4 h-4 mr-1" />
                Add Line
              </Button>
            </div>

            <div className="border rounded-lg overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr className="text-gray-700">
                    <th className="px-3 py-2 text-left font-medium min-w-[220px]">Item (SKU or name)</th>
                    <th className="px-3 py-2 text-left font-medium w-20">Qty</th>
                    <th className="px-3 py-2 text-left font-medium w-28">UOM</th>
                    <th className="px-3 py-2 text-right font-medium w-28">Unit Cost</th>
                    <th className="px-3 py-2 text-left font-medium w-36">VAT Tax Option</th>
                    <th className="px-3 py-2 text-right font-medium w-28">Row VAT ($)</th>
                    <th className="px-3 py-2 text-right font-medium w-28">Line Total</th>
                    <th className="px-3 py-2 text-left font-medium w-36">Expiry Date</th>
                    <th className="px-3 py-2 text-center font-medium w-16">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map(line => {
                    const c = valueFor(line.id);
                    return (
                      <tr key={line.id} className="border-b hover:bg-gray-50 align-middle">
                        <td className="px-3 py-2">
                          <Input
                            placeholder="Search by name, SKU..."
                            value={line.item_name}
                            onChange={(e) => updateLine(line.id, 'item_name', e.target.value)}
                            className="text-xs"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            type="number"
                            min="0"
                            step="any"
                            placeholder="0"
                            value={line.qty_received}
                            onChange={(e) => updateLine(line.id, 'qty_received', parseFloat(e.target.value) || 0)}
                            className="text-xs text-right"
                          />
                        </td>
                        <td className="px-3 py-2">
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
                        <td className="px-3 py-2">
                          <Input
                            type="number"
                            min="0"
                            step="any"
                            placeholder="0.00"
                            value={line.unit_cost}
                            onChange={(e) => updateLine(line.id, 'unit_cost', parseFloat(e.target.value) || 0)}
                            className="text-xs text-right"
                          />
                        </td>
                        <td className="px-3 py-2">
                          {/* Inline native select — exactly two options as spec'd */}
                          <select
                            value={line.vat_type}
                            onChange={(e) => updateLine(line.id, 'vat_type', e.target.value as VatType)}
                            className="w-full h-9 px-2 text-xs border border-gray-300 rounded-md bg-white
                                       focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                          >
                            <option value="15.50">15.50%</option>
                            <option value="0">No VAT</option>
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          {/* Read-only computed Row VAT — grayed out */}
                          <input
                            readOnly
                            tabIndex={-1}
                            value={`$${fmt(c.rowVat)}`}
                            className="w-full h-9 px-2 text-xs text-right border border-gray-200
                                       rounded-md bg-gray-100 text-gray-700 cursor-not-allowed"
                          />
                        </td>
                        <td className="px-3 py-2 text-right font-medium text-gray-900">
                          ${fmt(c.lineTotal)}
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            type="date"
                            value={line.expiry_date}
                            onChange={(e) => updateLine(line.id, 'expiry_date', e.target.value)}
                            className="text-xs"
                          />
                        </td>
                        <td className="px-3 py-2 text-center">
                          <Button size="sm" variant="ghost" onClick={() => removeLine(line.id)} aria-label="Remove line">
                            <Trash2 className="w-4 h-4 text-red-500" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {lines.length === 0 && (
              <p className="text-center text-sm text-gray-500 py-4">
                No line items added. Click "Add Line" to begin.
              </p>
            )}
          </div>

          {/* Stacked footer summary */}
          {lines.length > 0 && (
            <div className="flex justify-end">
              <div className="w-full md:w-72 border rounded-lg bg-gray-50/50 px-4 py-3 space-y-1.5">
                <div className="flex justify-between text-sm text-gray-700">
                  <span>Sub Total:</span>
                  <span className="font-mono">${fmt(computed.subTotal)}</span>
                </div>
                <div className="flex justify-between text-sm text-gray-700">
                  <span>VAT:</span>
                  <span className="font-mono">${fmt(computed.totalVat)}</span>
                </div>
                <div className="flex justify-between pt-2 border-t border-gray-300 font-semibold">
                  <span>GRN Total:</span>
                  <span className="font-mono text-base" style={{ color: '#1D9E75' }}>${fmt(computed.grnTotal)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Submit row */}
          <div className="flex justify-end gap-3 pt-4 border-t">
            <div className="flex items-center space-x-2 mr-auto px-1">
              <Checkbox id="auto-post" checked={autoPost} onCheckedChange={(val) => setAutoPost(!!val)} />
              <Label htmlFor="auto-post" className="text-sm cursor-pointer">Auto-post to stock ledger</Label>
            </div>
            <Button variant="outline">Cancel</Button>
            <Button
              onClick={handleSubmit}
              disabled={loading || lines.length === 0}
              style={{ backgroundColor: '#1D9E75' }}
              className="text-white hover:opacity-90"
            >
              <Check className="w-4 h-4 mr-1" />
              {loading ? 'Posting...' : 'Post GRN'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default InventoryV11GRNForm;
