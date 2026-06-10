import React, { useState, useEffect, useMemo } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, Save, X } from 'lucide-react';
import { useData } from '@/context/DataContext';
import { useToast } from '@/hooks/use-toast';
import gl, { GLAccount } from '@/lib/glAccounting';
import { ALL_DEPARTMENTS, getLineItemsForDepartment } from '@/lib/usaliCategories';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";

interface LineItem {
  id: string;
  description: string;
  quantity: number;
  unit_cost: number;
  department: string;
  category: string;
}

export const RecordVendorBill: React.FC<{ onCancel: () => void; onSuccess?: () => void }> = ({ onCancel, onSuccess }) => {
  const { vendors, addVendorExpense } = useData();
  const { toast } = useToast();

  const [vendorId, setVendorId] = useState('');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().split('T')[0]);
  
  const [applyVat, setApplyVat] = useState(false);
  const vatRate = 0.155; // 15.5%

  const [lines, setLines] = useState<LineItem[]>([
    { id: Date.now().toString(), description: '', quantity: 1, unit_cost: 0, department: '', category: '' }
  ]);

  const [isSubmitting, setIsSubmitting] = useState(false);

  // Quick Add State
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [quickAddType, setQuickAddType] = useState<'Department' | 'Category'>('Category');
  const [quickAddDept, setQuickAddDept] = useState('');
  const [quickAddName, setQuickAddName] = useState('');
  const [dynamicAccounts, setDynamicAccounts] = useState<GLAccount[]>([]);

  // Refresh dynamic accounts on load
  useEffect(() => {
    setDynamicAccounts(gl.getAccounts());
  }, []);

  // Real-time Math
  const subtotal = useMemo(() => {
    return lines.reduce((sum, line) => sum + (line.quantity * line.unit_cost), 0);
  }, [lines]);

  const vatAmount = useMemo(() => {
    return applyVat ? subtotal * vatRate : 0;
  }, [applyVat, subtotal, vatRate]);

  const grandTotal = subtotal + vatAmount;

  // React to VAT Toggle changes
  useEffect(() => {
    if (applyVat) {
      toast({ title: "VAT Applied", description: "All line items are now calculated with 15.5% VAT." });
    } else {
      toast({ title: "VAT Removed", description: "Total will now equal Subtotal." });
    }
  }, [applyVat, toast]);

  const handleAddLine = () => {
    setLines([...lines, { id: Date.now().toString(), description: '', quantity: 1, unit_cost: 0, department: '', category: '' }]);
  };

  const handleRemoveLine = (id: string) => {
    if (lines.length === 1) return;
    setLines(lines.filter(l => l.id !== id));
  };

  const handleChangeLine = (id: string, field: keyof LineItem, value: any) => {
    setLines(lines.map(l => l.id === id ? { ...l, [field]: value } : l));
  };

  const handleDeptSelect = (id: string, value: string) => {
    // When department changes, clear category selection
    setLines(prev => prev.map(l => l.id === id ? { ...l, department: value, category: '' } : l));
  };

  // Get departments (merge static USALI with dynamic from GL)
  const availableDepartments = useMemo(() => {
    const staticDepts = [...ALL_DEPARTMENTS];
    const dynDepts = dynamicAccounts.filter(a => a.category === 'Expense' && a.department).map(a => a.department!);
    return Array.from(new Set([...staticDepts, ...dynDepts]));
  }, [dynamicAccounts]);

  // Get categories for a department
  // Categories are GL-mapped: each option carries the GL account id so the
  // expense posts to exactly the account the user picked (no name guessing).
  const getCategoriesForDept = (dept: string): { value: string; label: string; glAccountId?: string }[] => {
    if (!dept) return [];
    const glForDept = dynamicAccounts.filter(a => a.category === 'Expense' && a.department === dept);
    const glOptions = glForDept.map(a => ({ value: a.name, label: `${a.id} — ${a.name}`, glAccountId: a.id }));
    const glNames = new Set(glForDept.map(a => a.name));
    const staticOptions = getLineItemsForDepartment(dept)
      .map(c => c.label)
      .filter(lbl => !glNames.has(lbl))
      .map(lbl => {
        // Match static labels against any expense account by name for a GL id
        const acc = dynamicAccounts.find(a => a.category === 'Expense' && a.name === lbl);
        return { value: lbl, label: acc ? `${acc.id} — ${lbl}` : lbl, glAccountId: acc?.id };
      });
    const seen = new Set<string>();
    return [...glOptions, ...staticOptions].filter(o => seen.has(o.value) ? false : (seen.add(o.value), true));
  };

  const handleQuickAdd = () => {
    if (!quickAddName.trim()) {
      toast({ title: 'Validation Required', description: 'Name cannot be empty', variant: 'destructive' });
      return;
    }
    
    if (quickAddType === 'Category' && !quickAddDept) {
      toast({ title: 'Validation Required', description: 'Please select a parent department', variant: 'destructive' });
      return;
    }

    // Silent Scaffolding: Create GL Account
    const currentAccounts = gl.getAccounts();
    const newId = `5${Date.now().toString().slice(-3)}-01`;
    
    const newAccount: GLAccount = {
      id: newId,
      name: quickAddName,
      category: 'Expense',
      usali: 'Operating',
      department: quickAddType === 'Department' ? quickAddName : quickAddDept
    };

    const updated = [...currentAccounts, newAccount];
    gl.setAccounts(updated);
    setDynamicAccounts(updated);
    
    toast({ title: 'Success', description: `${quickAddType} "${quickAddName}" added and linked to General Ledger.` });
    
    setShowQuickAdd(false);
    setQuickAddName('');
  };

  const handleSubmit = async () => {
    if (!vendorId) {
      toast({ title: 'Validation Error', description: 'Please select a vendor', variant: 'destructive' });
      return;
    }

    setIsSubmitting(true);
    let allSuccess = true;

    for (const [index, line] of lines.entries()) {
      if (!line.description || !line.department || !line.category || line.unit_cost <= 0) {
        toast({ title: 'Validation Error', description: `Please complete all required fields for line item ${(index + 1)}`, variant: 'destructive' });
        allSuccess = false;
        break;
      }

      const totalLineCost = line.quantity * line.unit_cost;
      let lineTax = 0;
      if (applyVat) {
        // Pro-rate tax amount to each line
        lineTax = totalLineCost * vatRate;
      }

      // Resolve the GL account the chosen category maps to
      const glAccountId = getCategoriesForDept(line.department)
        .find(c => c.value === line.category)?.glAccountId || null;

      const payload = {
        vendor_id: vendorId,
        reference_number: referenceNumber,
        expense_date: expenseDate,
        description: line.description,
        quantity: line.quantity,
        unit_cost: line.unit_cost,
        tax_inclusive: true, // UI logic sits on top
        tax_rate: applyVat ? vatRate * 100 : 0,
        tax_amount: lineTax,
        department: line.department,
        category: line.category,
        gl_account_id: glAccountId,
        status: 'pending'
      };

      const success = await addVendorExpense(payload);
      if (!success) {
        allSuccess = false;
        break;
      }
    }

    setIsSubmitting(false);

    if (allSuccess) {
      toast({ title: 'Success', description: `Vendor bill fully recorded.` });
      if (onSuccess) onSuccess();
      else onCancel();
    }
  };

  return (
    <div className="space-y-6 bg-white p-6 rounded-lg shadow-sm border border-gray-100">
      <div className="flex justify-between items-center border-b pb-4">
        <h2 className="text-2xl font-bold text-gray-800">Record Vendor Bill / Invoice</h2>
        <Button variant="ghost" onClick={onCancel}><X className="h-4 w-4 mr-2"/> Cancel</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4">
        <div className="space-y-2">
          <Label>Vendor</Label>
          <Select value={vendorId} onValueChange={setVendorId}>
            <SelectTrigger><SelectValue placeholder="Select Vendor" /></SelectTrigger>
            <SelectContent>
              {vendors.map((v: any) => (
                <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Bill / Invoice #</Label>
          <Input value={referenceNumber} onChange={e => setReferenceNumber(e.target.value)} placeholder="e.g. INV-1004" />
        </div>
        <div className="space-y-2">
          <Label>Date</Label>
          <Input type="date" value={expenseDate} onChange={e => setExpenseDate(e.target.value)} />
        </div>
      </div>

      <div className="flex items-center space-x-2 pt-2 border-t mt-4">
        <Switch checked={applyVat} onCheckedChange={setApplyVat} />
        <Label className="font-semibold text-gray-700">Apply VAT (15.5%)</Label>
      </div>

      <div className="mt-8">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold text-gray-800">Line Items</h3>
          <Dialog open={showQuickAdd} onOpenChange={setShowQuickAdd}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="text-blue-600 border-blue-200 hover:bg-blue-50">
                + Quick Add Cost Center
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Custom Cost Center</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-4">
                <div className="space-y-2">
                  <Label>Type</Label>
                  <Select value={quickAddType} onValueChange={(v: any) => setQuickAddType(v)}>
                    <SelectTrigger><SelectValue/></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Department">New Department</SelectItem>
                      <SelectItem value="Category">New Category (under existing Dept)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {quickAddType === 'Category' && (
                  <div className="space-y-2">
                    <Label>Parent Department</Label>
                    <Select value={quickAddDept} onValueChange={setQuickAddDept}>
                      <SelectTrigger><SelectValue placeholder="Select Department"/></SelectTrigger>
                      <SelectContent>
                        {availableDepartments.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="space-y-2">
                  <Label>Name</Label>
                  <Input value={quickAddName} onChange={e => setQuickAddName(e.target.value)} placeholder="e.g. Maintenance Supplies" />
                </div>
                <Button className="w-full" onClick={handleQuickAdd}>Save & Publish to GL</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <div className="border rounded-md overflow-hidden">
          <Table>
            <TableHeader className="bg-gray-50">
              <TableRow>
                <TableHead className="w-[30%]">Description</TableHead>
                <TableHead className="w-[10%] text-center">Qty</TableHead>
                <TableHead className="w-[15%] text-right">Unit Cost</TableHead>
                <TableHead className="w-[20%]">Department</TableHead>
                <TableHead className="w-[20%]">Category</TableHead>
                <TableHead className="w-[5%]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line, idx) => (
                <TableRow key={line.id}>
                  <TableCell>
                    <Input 
                      placeholder="Item description" 
                      value={line.description} 
                      onChange={e => handleChangeLine(line.id, 'description', e.target.value)}
                    />
                  </TableCell>
                  <TableCell>
                    <Input 
                      type="number" 
                      min="1"
                      className="text-center"
                      value={line.quantity || ''} 
                      onChange={e => handleChangeLine(line.id, 'quantity', parseInt(e.target.value) || 0)}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="relative">
                      <span className="absolute left-3 top-2.5 text-gray-500">$</span>
                      <Input 
                        type="number" 
                        min="0"
                        step="0.01"
                        className="text-right pl-7"
                        value={line.unit_cost || ''} 
                        onChange={e => handleChangeLine(line.id, 'unit_cost', parseFloat(e.target.value) || 0)}
                      />
                    </div>
                  </TableCell>
                  <TableCell>
                    <Select value={line.department} onValueChange={(v) => handleDeptSelect(line.id, v)}>
                      <SelectTrigger><SelectValue placeholder="Select Dept" /></SelectTrigger>
                      <SelectContent>
                        {availableDepartments.map(d => (
                          <SelectItem key={d} value={d}>{d}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Select disabled={!line.department} value={line.category} onValueChange={(v) => handleChangeLine(line.id, 'category', v)}>
                      <SelectTrigger><SelectValue placeholder={line.department ? "Select Category" : "Select Dept First"} /></SelectTrigger>
                      <SelectContent>
                        {getCategoriesForDept(line.department).map(c => (
                          <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="text-red-500 hover:text-red-700" 
                      onClick={() => handleRemoveLine(line.id)}
                      disabled={lines.length === 1}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        
        <div className="mt-4 flex justify-start">
          <Button variant="outline" onClick={handleAddLine} className="text-sm">
            <Plus className="h-4 w-4 mr-2" /> Add Line Item
          </Button>
        </div>
      </div>

      {/* FOOTER TOTALS */}
      <div className="mt-8 flex justify-end">
        <div className="w-full md:w-1/3 space-y-3 bg-gray-50 p-6 rounded-lg border">
          <div className="flex justify-between text-gray-600">
            <span>Subtotal:</span>
            <span>${subtotal.toFixed(2)}</span>
          </div>
          {applyVat && (
             <div className="flex justify-between text-gray-600">
               <span>VAT (15.5%):</span>
               <span>${vatAmount.toFixed(2)}</span>
             </div>
          )}
          {!applyVat && (
             <div className="flex justify-between text-gray-400 text-sm italic">
               <span>VAT:</span>
               <span>$0.00 (Exclusive)</span>
             </div>
          )}
          <div className="flex justify-between text-xl font-bold text-gray-800 border-t pt-2">
            <span>Grand Total:</span>
            <span>${grandTotal.toFixed(2)}</span>
          </div>
        </div>
      </div>

      <div className="flex justify-end pt-4 border-t gap-4">
        <Button variant="outline" size="lg" onClick={onCancel}>Cancel</Button>
        <Button size="lg" className="bg-blue-600 hover:bg-blue-700 text-white" onClick={handleSubmit} disabled={isSubmitting}>
          {isSubmitting ? 'Saving...' : <><Save className="h-4 w-4 mr-2" /> Record Bill</>}
        </Button>
      </div>
    </div>
  );
};

export default RecordVendorBill;
