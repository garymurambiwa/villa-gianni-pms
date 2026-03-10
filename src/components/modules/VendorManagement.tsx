import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useData } from '@/context/DataContext';
import { useToast } from '@/hooks/use-toast';
import { formatDateForCSV, toDisplayId, escapeCSV } from '@/lib/csvUtils';
import { ALL_DEPARTMENTS } from '@/lib/usaliCategories';
import { ExpenseInvoiceView } from '@/components/modules/ExpenseInvoiceView';
import { RecordVendorBill } from '@/components/modules/RecordVendorBill';

interface Vendor {
  id: string;
  name: string;
  contact_person: string;
  phone: string;
  email: string;
  address: string;
  tax_id: string;
  payment_terms: string;
  credit_limit: number;
  current_balance: number;
  status: string;
  created_at: string;
  updated_at: string;
}

interface VendorExpense {
  id: string;
  vendor_id: string;
  vendor_name: string;
  description: string;
  quantity: number;
  unit_cost: number;
  total_cost: number;
  tax_amount: number;
  tax_rate: number;
  tax_inclusive: boolean;
  expense_date: string;
  reference_number: string;
  category: string;
  department: string;
  status: string;
  is_batch_parent?: boolean;
  batch_details?: string;
  created_at: string;
  updated_at: string;
}

interface VendorPayment {
  id: string;
  vendor_id: string;
  vendor_name: string;
  expense_ids: string;
  amount_paid: number;
  payment_date: string;
  payment_method: string;
  reference_number: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

const VendorManagement: React.FC = () => {
  const { vendors, vendorExpenses, vendorPayments, addVendor, updateVendor, deleteVendor, addVendorExpense, updateVendorExpense, deleteVendorExpense, payVendor, loadVendorPayments } = useData();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState('vendors');
  const [showAddVendorModal, setShowAddVendorModal] = useState(false);
  const [showAddExpenseModal, setShowAddExpenseModal] = useState(false);
  const [showBatchExpenseModal, setShowBatchExpenseModal] = useState(false);
  const [batchVendorId, setBatchVendorId] = useState('');
  const [batchExpenses, setBatchExpenses] = useState([
    {
      description: '',
      quantity: 1,
      unit_cost: 0,
      department: '',
      category: '',
      expense_date: new Date().toISOString().split('T')[0],
      reference_number: '',
      status: 'pending'
    }
  ]);
  const [batchErrors, setBatchErrors] = useState([]);
  const [batchSubmitError, setBatchSubmitError] = useState('');
  const [expandedBatchRows, setExpandedBatchRows] = useState<string[]>([]);
  const [expenseViewMode, setExpenseViewMode] = useState<'flat' | 'invoice'>('invoice');
  const [isRecordingBill, setIsRecordingBill] = useState(false);

  // Vendor form state
  const [vendorForm, setVendorForm] = useState({
    name: '',
    contact_person: '',
    phone: '',
    email: '',
    address: '',
    tax_id: '',
    payment_terms: 'Net 30',
    credit_limit: 0,
    current_balance: 0,
    status: 'active'
  });

  // Expense form state
  const [expenseForm, setExpenseForm] = useState({
    vendor_id: '',
    description: '',
    quantity: 1,
    unit_cost: 0,
    tax_amount: 0,
    tax_rate: 0,
    tax_inclusive: false,
    expense_date: new Date().toISOString().split('T')[0],
    reference_number: '',
    category: '',
    department: '',
    status: 'pending'
  });

  // Payment form state
  const [paymentForm, setPaymentForm] = useState({
    vendor_id: '',
    amount_paid: 0,
    payment_date: new Date().toISOString().split('T')[0],
    payment_method: 'Cash',
    reference_number: '',
    notes: ''
  });

  // Search and filtering state
  const [searchTerm, setSearchTerm] = useState('');

  // Effects
  useEffect(() => {
    // Load vendor payments when component mounts
    loadVendorPayments();
  }, [loadVendorPayments]);

  const handleAddVendor = async () => {
    if (!vendorForm.name.trim()) {
      toast({ title: 'Validation Error', description: 'Vendor name is required', variant: 'destructive' });
      return;
    }

    const success = await addVendor(vendorForm);
    if (success) {
      toast({ title: 'Success', description: `Vendor "${vendorForm.name}" created successfully` });
      setVendorForm({
        name: '',
        contact_person: '',
        phone: '',
        email: '',
        address: '',
        tax_id: '',
        payment_terms: 'Net 30',
        credit_limit: 0,
        current_balance: 0,
        status: 'active'
      });
      setShowAddVendorModal(false);
    }
  };

  const handleAddExpense = async () => {
    if (!expenseForm.vendor_id || !expenseForm.description.trim() || expenseForm.unit_cost <= 0 || !expenseForm.department.trim()) {
      toast({
        title: 'Validation Error',
        description: 'Please select a vendor, enter description, select department, and unit cost must be greater than 0',
        variant: 'destructive'
      });
      return;
    }

    const expenseData = {
      ...expenseForm,
      total_cost: expenseForm.quantity * expenseForm.unit_cost
    };

    const success = await addVendorExpense(expenseData);
    if (success) {
      toast({ title: 'Success', description: 'Expense added successfully' });
      setExpenseForm({
        vendor_id: '',
        description: '',
        quantity: 1,
        unit_cost: 0,
        tax_amount: 0,
        tax_rate: 0,
        tax_inclusive: false,
        expense_date: new Date().toISOString().split('T')[0],
        reference_number: '',
        category: '',
        department: '',
        status: 'pending'
      });
      setShowAddExpenseModal(false);
    }
  };

  // Handle editing an expense
  const handleEditExpense = async (expense: VendorExpense) => {
    if (expense.status === 'paid' || expense.status === 'cleared') {
      toast({
        title: 'Cannot Edit',
        description: 'Paid and cleared expenses cannot be edited',
        variant: 'destructive'
      });
      return;
    }

    setExpenseForm({
      vendor_id: expense.vendor_id,
      description: expense.description,
      quantity: expense.quantity,
      unit_cost: expense.unit_cost,
      tax_amount: expense.tax_amount,
      tax_rate: expense.tax_rate,
      tax_inclusive: expense.tax_inclusive,
      expense_date: expense.expense_date,
      reference_number: expense.reference_number,
      category: expense.category,
      department: expense.department,
      status: expense.status
    });

    setShowAddExpenseModal(true);
  };

  // Batch expense functions
  const addBatchExpenseLine = () => {
    setBatchExpenses([...batchExpenses, {
      description: '',
      quantity: 1,
      unit_cost: 0,
      department: '',
      category: '',
      expense_date: new Date().toISOString().split('T')[0],
      reference_number: '',
      status: 'pending'
    }]);
    setBatchErrors([...batchErrors, {}]);
  };

  const removeBatchExpense = (index: number) => {
    if (batchExpenses.length <= 1) return;
    const newExpenses = [...batchExpenses];
    const newErrors = [...batchErrors];
    newExpenses.splice(index, 1);
    newErrors.splice(index, 1);
    setBatchExpenses(newExpenses);
    setBatchErrors(newErrors);
  };

  const updateBatchExpense = (index: number, field: string, value: any) => {
    const newExpenses = [...batchExpenses];
    newExpenses[index] = { ...newExpenses[index], [field]: value };
    setBatchExpenses(newExpenses);

    // Clear error for this field if it exists
    if (batchErrors[index] && batchErrors[index][field]) {
      const newErrors = [...batchErrors];
      delete newErrors[index][field];
      setBatchErrors(newErrors);
    }
  };

  const validateBatchExpenses = () => {
    const errors = [];
    let hasErrors = false;

    batchExpenses.forEach((expense, index) => {
      const expenseErrors: any = {};

      if (!expense.description.trim()) {
        expenseErrors.description = 'Description is required';
        hasErrors = true;
      }

      if (expense.unit_cost <= 0) {
        expenseErrors.unit_cost = 'Unit cost must be greater than 0';
        hasErrors = true;
      }

      if (!expense.department.trim()) {
        expenseErrors.department = 'Department is required';
        hasErrors = true;
      }

      if (!expense.category.trim()) {
        expenseErrors.category = 'Category is required';
        hasErrors = true;
      }

      errors[index] = expenseErrors;
    });

    setBatchErrors(errors);
    return !hasErrors;
  };

  const handleBatchExpenseSubmit = async () => {
    if (!batchVendorId) {
      toast({
        title: 'Validation Error',
        description: 'Please select a vendor',
        variant: 'destructive'
      });
      return;
    }

    if (!validateBatchExpenses()) {
      const errorMessages = batchErrors
        .map((errors, index) => {
          const errorTexts = Object.values(errors);
          if (errorTexts.length > 0) {
            return `Expense ${index + 1}: ${errorTexts.join(', ')}`;
          }
          return null;
        })
        .filter(Boolean)
        .join('\n');

      setBatchSubmitError(errorMessages);
      return;
    }

    setBatchSubmitError('');

    // Submit all expenses
    const results = [];
    for (let i = 0; i < batchExpenses.length; i++) {
      const expense = batchExpenses[i];
      const expenseData = {
        vendor_id: batchVendorId,
        description: expense.description,
        quantity: expense.quantity,
        unit_cost: expense.unit_cost,
        tax_amount: 0,
        tax_rate: 0,
        tax_inclusive: false,
        expense_date: expense.expense_date,
        reference_number: expense.reference_number,
        category: expense.category,
        department: expense.department,
        status: expense.status,
        total_cost: expense.quantity * expense.unit_cost
      };

      const success = await addVendorExpense(expenseData);
      results.push({ index: i, success, expense: expense.description });
    }

    // Count successes and failures
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    if (successful > 0) {
      toast({
        title: 'Success',
        description: `${successful} expense${successful !== 1 ? 's' : ''} added successfully`
      });
    }

    if (failed > 0) {
      const failedDetails = results
        .filter(r => !r.success)
        .map(r => `Expense "${r.expense}"`)
        .join(', ');

      toast({
        title: 'Some Expenses Failed',
        description: `${failed} expense${failed !== 1 ? 's' : ''} could not be added: ${failedDetails}`,
        variant: 'destructive'
      });
    }

    // Reset form if all successful
    if (successful === batchExpenses.length) {
      setBatchVendorId('');
      setBatchExpenses([{
        description: '',
        quantity: 1,
        unit_cost: 0,
        department: '',
        category: '',
        expense_date: new Date().toISOString().split('T')[0],
        reference_number: '',
        status: 'pending'
      }]);
      setBatchErrors([]);
      setShowBatchExpenseModal(false);
    }
  };

  // Handle updating an expense
  const handleUpdateExpense = async () => {
    if (!expenseForm.vendor_id || !expenseForm.description.trim() || expenseForm.unit_cost <= 0 || !expenseForm.department.trim()) {
      toast({
        title: 'Validation Error',
        description: 'Please select a vendor, enter description, select department, and unit cost must be greater than 0',
        variant: 'destructive'
      });
      return;
    }

    const expenseData = {
      ...expenseForm,
      total_cost: expenseForm.quantity * expenseForm.unit_cost
    };

    const success = await updateVendorExpense(expenseForm.vendor_id, expenseData);
    if (success) {
      toast({ title: 'Success', description: 'Expense updated successfully' });
      setExpenseForm({
        vendor_id: '',
        description: '',
        quantity: 1,
        unit_cost: 0,
        tax_amount: 0,
        tax_rate: 0,
        tax_inclusive: false,
        expense_date: new Date().toISOString().split('T')[0],
        reference_number: '',
        category: '',
        department: '',
        status: 'pending'
      });
      setShowAddExpenseModal(false);
    }
  };

  // Function to update expense status directly from the table
  const updateExpenseStatus = async (expenseId: string, newStatus: string) => {
    // Find the expense to update
    const expenseToUpdate = vendorExpenses.find(exp => exp.id === expenseId);
    if (!expenseToUpdate) {
      toast({
        title: 'Error',
        description: 'Expense not found',
        variant: 'destructive'
      });
      return;
    }

    // Prepare updated expense data
    const updatedExpenseData = {
      ...expenseToUpdate,
      status: newStatus
    };

    // Update the expense
    const success = await updateVendorExpense(expenseId, updatedExpenseData);
    if (success) {
      toast({ title: 'Success', description: `Expense status updated to ${newStatus}` });

      // If status is changed to 'paid', move the expense to payments
      if (newStatus === 'paid') {
        // Create a payment record for this expense
        const paymentData = {
          vendor_id: expenseToUpdate.vendor_id,
          expense_ids: expenseId, // Single expense ID
          amount_paid: expenseToUpdate.total_cost,
          payment_date: new Date().toISOString().split('T')[0],
          payment_method: 'Bank', // Updated to only allow 'Bank' or 'Cash'
          reference_number: `PAY-${Date.now()}`,
          notes: `Payment for expense ${expenseId}`
        };

        // Add the payment
        const paymentSuccess = await payVendor(paymentData);
        if (paymentSuccess) {
          toast({ title: 'Payment Processed', description: 'Payment record created successfully' });
        } else {
          toast({
            title: 'Payment Error',
            description: 'Payment record could not be created',
            variant: 'destructive'
          });
        }
      }
    } else {
      toast({
        title: 'Update Failed',
        description: 'Expense status could not be updated',
        variant: 'destructive'
      });
    }
  };

  const calculateSubtotal = (expenses: VendorExpense[]) => {
    return expenses.reduce((sum, expense) => sum + expense.total_cost, 0);
  };

  const calculateTaxTotal = (expenses: VendorExpense[]) => {
    return expenses.reduce((sum, expense) => sum + expense.tax_amount, 0);
  };

  const calculateGrandTotal = (expenses: VendorExpense[]) => {
    return calculateSubtotal(expenses) + calculateTaxTotal(expenses);
  };

  // Function to group expenses by department for P&L reporting
  const groupExpensesByDepartment = (expenses: VendorExpense[]) => {
    return expenses.reduce((acc, expense) => {
      if (!acc[expense.department]) {
        acc[expense.department] = [];
      }
      acc[expense.department].push(expense);
      return acc;
    }, {} as Record<string, VendorExpense[]>);
  };

  // Function to group expenses by department and category for USALI P&L reporting
  const groupExpensesByDepartmentAndCategory = (expenses: VendorExpense[]) => {
    const grouped = {} as Record<string, Record<string, number>>;

    expenses.forEach(expense => {
      if (!grouped[expense.department]) {
        grouped[expense.department] = {};
      }

      if (!grouped[expense.department][expense.category]) {
        grouped[expense.department][expense.category] = 0;
      }

      grouped[expense.department][expense.category] += expense.total_cost;
    });

    return grouped;
  };

  // Filter expenses based on search term
  const filteredExpenses = vendorExpenses.filter(expense => {
    const searchTermLower = searchTerm.toLowerCase();
    return (
      expense.vendor_name.toLowerCase().includes(searchTermLower) ||
      expense.description.toLowerCase().includes(searchTermLower) ||
      expense.reference_number?.toLowerCase().includes(searchTermLower) ||
      expense.id.toLowerCase().includes(searchTermLower)
    );
  });

  // Export expenses to CSV
  const exportExpensesToCSV = () => {
    if (filteredExpenses.length === 0) {
      toast({
        title: 'No Data',
        description: 'No expenses to export',
        variant: 'destructive'
      });
      return;
    }

    // Create CSV content with sequential display IDs & DDMMYYYY date formatting
    const headers = [
      'ID', 'Display ID', 'Vendor', 'Description', 'Quantity', 'Unit Cost', 'Total Cost',
      'Tax Amount', 'Expense Date', 'Reference #', 'Category', 'Department', 'Status'
    ];

    const csvContent = [
      headers.join(','),
      ...filteredExpenses.map((expense, idx) => [
        escapeCSV(expense.id),
        toDisplayId(idx + 1, 'EXP'),
        escapeCSV(expense.vendor_name),
        escapeCSV(expense.description),
        expense.quantity,
        expense.unit_cost,
        expense.total_cost,
        expense.tax_amount,
        formatDateForCSV(expense.expense_date),
        expense.reference_number ? escapeCSV(expense.reference_number) : 'N/A',
        expense.category,
        expense.department,
        expense.status
      ].join(','))
    ].join('\n');

    // Create and download file
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `vendor_expenses_${formatDateForCSV(new Date())}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Vendor Management</h1>
        <Dialog open={showAddVendorModal} onOpenChange={setShowAddVendorModal}>
          <DialogTrigger asChild>
            <Button>Add Vendor</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Add New Vendor</DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="name">Vendor Name *</Label>
                <Input
                  id="name"
                  value={vendorForm.name}
                  onChange={(e) => setVendorForm({ ...vendorForm, name: e.target.value })}
                  placeholder="Enter vendor name"
                />
              </div>
              <div>
                <Label htmlFor="contact_person">Contact Person</Label>
                <Input
                  id="contact_person"
                  value={vendorForm.contact_person}
                  onChange={(e) => setVendorForm({ ...vendorForm, contact_person: e.target.value })}
                  placeholder="Contact person"
                />
              </div>
              <div>
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  value={vendorForm.phone}
                  onChange={(e) => setVendorForm({ ...vendorForm, phone: e.target.value })}
                  placeholder="Phone number"
                />
              </div>
              <div>
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={vendorForm.email}
                  onChange={(e) => setVendorForm({ ...vendorForm, email: e.target.value })}
                  placeholder="Email address"
                />
              </div>
              <div>
                <Label htmlFor="address">Address</Label>
                <Input
                  id="address"
                  value={vendorForm.address}
                  onChange={(e) => setVendorForm({ ...vendorForm, address: e.target.value })}
                  placeholder="Address"
                />
              </div>
              <div>
                <Label htmlFor="tax_id">Tax ID</Label>
                <Input
                  id="tax_id"
                  value={vendorForm.tax_id}
                  onChange={(e) => setVendorForm({ ...vendorForm, tax_id: e.target.value })}
                  placeholder="Tax ID"
                />
              </div>
              <div>
                <Label htmlFor="payment_terms">Payment Terms</Label>
                <Select
                  value={vendorForm.payment_terms}
                  onValueChange={(value) => setVendorForm({ ...vendorForm, payment_terms: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Net 30">Net 30</SelectItem>
                    <SelectItem value="Net 60">Net 60</SelectItem>
                    <SelectItem value="Due on Receipt">Due on Receipt</SelectItem>
                    <SelectItem value="COD">COD</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="credit_limit">Credit Limit</Label>
                <Input
                  id="credit_limit"
                  type="number"
                  value={vendorForm.credit_limit}
                  onChange={(e) => setVendorForm({ ...vendorForm, credit_limit: parseFloat(e.target.value) || 0 })}
                  placeholder="Credit limit"
                />
              </div>
              <div>
                <Label htmlFor="status">Status</Label>
                <Select
                  value={vendorForm.status}
                  onValueChange={(value) => setVendorForm({ ...vendorForm, status: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex justify-end space-x-2 pt-4">
              <Button variant="outline" onClick={() => setShowAddVendorModal(false)}>Cancel</Button>
              <Button onClick={handleAddVendor}>Add Vendor</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="vendors">Vendors</TabsTrigger>
          <TabsTrigger value="expenses">Expenses</TabsTrigger>
          <TabsTrigger value="payments">Payments</TabsTrigger>
        </TabsList>

        <TabsContent value="vendors" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Vendor List</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Contact Person</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {vendors.map((vendor: Vendor) => (
                    <TableRow key={vendor.id}>
                      <TableCell>{vendor.name}</TableCell>
                      <TableCell>{vendor.contact_person}</TableCell>
                      <TableCell>{vendor.phone}</TableCell>
                      <TableCell>{vendor.email}</TableCell>
                      <TableCell>{vendor.status}</TableCell>
                      <TableCell>${vendor.current_balance.toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                  {vendors.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-gray-500 py-8">
                        No vendors found. Add a vendor to get started.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="expenses" className="space-y-4">
          {isRecordingBill ? (
            <RecordVendorBill
              onCancel={() => setIsRecordingBill(false)}
              onSuccess={() => { setIsRecordingBill(false); loadVendorPayments(); }}
            />
          ) : (
            <>
              <div className="flex flex-col md:flex-row justify-between gap-4">
                <div className="flex items-center gap-3">
                  <h2 className="text-xl font-semibold">Vendor Expenses</h2>
                  <div className="bg-gray-100 p-1 rounded-lg flex">
                    <button
                      onClick={() => setExpenseViewMode('invoice')}
                      className={`px-3 py-1.5 text-xs rounded-md font-medium transition-colors ${expenseViewMode === 'invoice' ? 'bg-white shadow text-blue-600' : 'text-gray-600 hover:text-gray-900'}`}
                    >
                      Invoice View
                    </button>
                    <button
                      onClick={() => setExpenseViewMode('flat')}
                      className={`px-3 py-1.5 text-xs rounded-md font-medium transition-colors ${expenseViewMode === 'flat' ? 'bg-white shadow text-blue-600' : 'text-gray-600 hover:text-gray-900'}`}
                    >
                      Flat List
                    </button>
                  </div>
                </div>
                <div className="mt-2">
                  <Input
                    placeholder="Search by vendor name, description, reference #, or ID..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="max-w-md"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button onClick={() => window.print()} variant="outline">Print All Expenses</Button>
                <Button onClick={() => exportExpensesToCSV()} variant="outline">Export CSV</Button>
                <Button onClick={() => setIsRecordingBill(true)} className="bg-blue-600 hover:bg-blue-700 text-white">Record Bill</Button>
                <Dialog open={showBatchExpenseModal} onOpenChange={setShowBatchExpenseModal}>
                  <DialogTrigger asChild>
                    <Button variant="secondary">Batch Enter</Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle>Batch Enter Expenses</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-6">
                      <div>
                        <Label htmlFor="batch_vendor_id">Vendor *</Label>
                        <Select
                          value={batchVendorId}
                          onValueChange={(value) => setBatchVendorId(value)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select a vendor for all expenses" />
                          </SelectTrigger>
                          <SelectContent>
                            {vendors.map((vendor: Vendor) => (
                              <SelectItem key={vendor.id} value={vendor.id}>{vendor.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div>
                        <div className="flex justify-between items-center mb-4">
                          <h3 className="text-lg font-medium">Expense Entries ({batchExpenses.length})</h3>
                          <Button onClick={addBatchExpenseLine} size="sm">Add Expense Line</Button>
                        </div>

                        <div className="border rounded-lg overflow-hidden">
                          <table className="w-full">
                            <thead className="bg-gray-50">
                              <tr>
                                <th className="px-4 py-2 text-left text-sm font-medium text-gray-500">Description *</th>
                                <th className="px-4 py-2 text-left text-sm font-medium text-gray-500">Qty</th>
                                <th className="px-4 py-2 text-left text-sm font-medium text-gray-500">Unit Cost *</th>
                                <th className="px-4 py-2 text-left text-sm font-medium text-gray-500">Department *</th>
                                <th className="px-4 py-2 text-left text-sm font-medium text-gray-500">Category *</th>
                                <th className="px-4 py-2 text-left text-sm font-medium text-gray-500">Date</th>
                                <th className="px-4 py-2 text-left text-sm font-medium text-gray-500">Ref #</th>
                                <th className="px-4 py-2 text-left text-sm font-medium text-gray-500">Status</th>
                                <th className="px-4 py-2 text-left text-sm font-medium text-gray-500">Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {batchExpenses.map((expense, index) => (
                                <tr key={index} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                                  <td className="px-4 py-2">
                                    <Input
                                      value={expense.description}
                                      onChange={(e) => updateBatchExpense(index, 'description', e.target.value)}
                                      placeholder="Description"
                                      className={batchErrors[index]?.description ? 'border-red-500' : ''}
                                    />
                                    {batchErrors[index]?.description && (
                                      <p className="text-red-500 text-xs mt-1">{batchErrors[index].description}</p>
                                    )}
                                  </td>
                                  <td className="px-4 py-2">
                                    <Input
                                      type="number"
                                      min="1"
                                      value={expense.quantity}
                                      onChange={(e) => updateBatchExpense(index, 'quantity', parseInt(e.target.value) || 1)}
                                      className="w-24"
                                    />
                                  </td>
                                  <td className="px-4 py-2">
                                    <Input
                                      type="number"
                                      step="0.01"
                                      min="0"
                                      value={expense.unit_cost}
                                      onChange={(e) => updateBatchExpense(index, 'unit_cost', parseFloat(e.target.value) || 0)}
                                      className={`w-32 ${batchErrors[index]?.unit_cost ? 'border-red-500' : ''}`}
                                    />
                                    {batchErrors[index]?.unit_cost && (
                                      <p className="text-red-500 text-xs mt-1">{batchErrors[index].unit_cost}</p>
                                    )}
                                  </td>
                                  <td className="px-4 py-2">
                                    <Select
                                      value={expense.department}
                                      onValueChange={(value) => updateBatchExpense(index, 'department', value)}
                                    >
                                      <SelectTrigger className={batchErrors[index]?.department ? 'border-red-500' : ''}>
                                        <SelectValue placeholder="Select dept" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {ALL_DEPARTMENTS.map(d => (
                                          <SelectItem key={d} value={d}>{d}</SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                    {batchErrors[index]?.department && (
                                      <p className="text-red-500 text-xs mt-1">{batchErrors[index].department}</p>
                                    )}
                                  </td>
                                  <td className="px-4 py-2">
                                    <Select
                                      value={expense.category}
                                      onValueChange={(value) => updateBatchExpense(index, 'category', value)}
                                    >
                                      <SelectTrigger className={batchErrors[index]?.category ? 'border-red-500' : ''}>
                                        <SelectValue placeholder="Select category" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="Cost of Goods Sold">Cost of Goods Sold</SelectItem>
                                        <SelectItem value="Payroll">Payroll</SelectItem>
                                        <SelectItem value="Supplies">Supplies</SelectItem>
                                        <SelectItem value="Utilities">Utilities</SelectItem>
                                        <SelectItem value="Repairs & Maintenance">Repairs & Maintenance</SelectItem>
                                        <SelectItem value="Administrative">Administrative</SelectItem>
                                        <SelectItem value="Marketing">Marketing</SelectItem>
                                        <SelectItem value="Other">Other</SelectItem>
                                      </SelectContent>
                                    </Select>
                                    {batchErrors[index]?.category && (
                                      <p className="text-red-500 text-xs mt-1">{batchErrors[index].category}</p>
                                    )}
                                  </td>
                                  <td className="px-4 py-2">
                                    <Input
                                      type="date"
                                      value={expense.expense_date}
                                      onChange={(e) => updateBatchExpense(index, 'expense_date', e.target.value)}
                                    />
                                  </td>
                                  <td className="px-4 py-2">
                                    <Input
                                      value={expense.reference_number}
                                      onChange={(e) => updateBatchExpense(index, 'reference_number', e.target.value)}
                                      placeholder="Ref #"
                                    />
                                  </td>
                                  <td className="px-4 py-2">
                                    <Select
                                      value={expense.status}
                                      onValueChange={(value) => {
                                        updateBatchExpense(index, 'status', value);
                                        // If status changes to 'paid', move the expense to payments
                                        if (value === 'paid') {
                                          // In a real implementation, we would create a payment record here
                                        }
                                      }}
                                    >
                                      <SelectTrigger>
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="pending">Pending</SelectItem>
                                        <SelectItem value="approved">Approved</SelectItem>
                                        <SelectItem value="paid">Paid</SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </td>
                                  <td className="px-4 py-2">
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => removeBatchExpense(index)}
                                      disabled={batchExpenses.length <= 1}
                                    >
                                      Remove
                                    </Button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {batchSubmitError && (
                        <div className="bg-red-50 border border-red-200 rounded-md p-4">
                          <div className="flex">
                            <div className="flex-shrink-0">
                              <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                              </svg>
                            </div>
                            <div className="ml-3">
                              <h3 className="text-sm font-medium text-red-800">Some expenses failed validation:</h3>
                              <div className="mt-2 text-sm text-red-700">
                                <ul className="list-disc pl-5 space-y-1">
                                  {batchSubmitError.split('\n').map((error, idx) => (
                                    <li key={idx}>{error}</li>
                                  ))}
                                </ul>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      <div className="flex justify-between items-center pt-4 border-t">
                        <div className="text-sm text-gray-500">
                          Total Expenses: {batchExpenses.length} |
                          Estimated Total: ${batchExpenses.reduce((sum, exp) => sum + (exp.quantity * exp.unit_cost), 0).toFixed(2)}
                        </div>
                        <div className="flex space-x-2">
                          <Button variant="outline" onClick={() => setShowBatchExpenseModal(false)}>Cancel</Button>
                          <Button onClick={handleBatchExpenseSubmit} disabled={!batchVendorId || batchExpenses.length === 0}>
                            Add {batchExpenses.length} Expense{batchExpenses.length !== 1 ? 's' : ''}
                          </Button>
                        </div>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
                <Dialog open={showAddExpenseModal} onOpenChange={setShowAddExpenseModal}>
                  <DialogTrigger asChild>
                    <Button>Add Expense</Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle>Add New Expense</DialogTitle>
                    </DialogHeader>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="md:col-span-2">
                        <Label htmlFor="vendor_id">Vendor *</Label>
                        <Select
                          value={expenseForm.vendor_id}
                          onValueChange={(value) => setExpenseForm({ ...expenseForm, vendor_id: value })}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select a vendor" />
                          </SelectTrigger>
                          <SelectContent>
                            {vendors.map((vendor: Vendor) => (
                              <SelectItem key={vendor.id} value={vendor.id}>{vendor.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="md:col-span-2">
                        <Label htmlFor="description">Description *</Label>
                        <Input
                          id="description"
                          value={expenseForm.description}
                          onChange={(e) => setExpenseForm({ ...expenseForm, description: e.target.value })}
                          placeholder="Expense description"
                        />
                      </div>
                      <div>
                        <Label htmlFor="quantity">Quantity</Label>
                        <Input
                          id="quantity"
                          type="number"
                          min="1"
                          value={expenseForm.quantity}
                          onChange={(e) => setExpenseForm({ ...expenseForm, quantity: parseInt(e.target.value) || 1 })}
                        />
                      </div>
                      <div>
                        <Label htmlFor="unit_cost">Unit Cost *</Label>
                        <Input
                          id="unit_cost"
                          type="number"
                          step="0.01"
                          min="0"
                          value={expenseForm.unit_cost}
                          onChange={(e) => setExpenseForm({ ...expenseForm, unit_cost: parseFloat(e.target.value) || 0 })}
                        />
                      </div>
                      <div>
                        <Label htmlFor="expense_date">Expense Date</Label>
                        <Input
                          id="expense_date"
                          type="date"
                          value={expenseForm.expense_date}
                          onChange={(e) => setExpenseForm({ ...expenseForm, expense_date: e.target.value })}
                        />
                      </div>
                      <div>
                        <Label htmlFor="category">Category</Label>
                        <Input
                          id="category"
                          value={expenseForm.category}
                          onChange={(e) => setExpenseForm({ ...expenseForm, category: e.target.value })}
                          placeholder="Expense category"
                        />
                      </div>
                      <div>
                        <Label htmlFor="tax_rate">Tax Rate (%)</Label>
                        <Input
                          id="tax_rate"
                          type="number"
                          step="0.01"
                          min="0"
                          max="100"
                          value={expenseForm.tax_rate}
                          onChange={(e) => setExpenseForm({ ...expenseForm, tax_rate: parseFloat(e.target.value) || 0 })}
                        />
                      </div>
                      <div>
                        <Label htmlFor="tax_inclusive">Tax Type</Label>
                        <Select
                          value={expenseForm.tax_inclusive ? 'inclusive' : 'exclusive'}
                          onValueChange={(value) => setExpenseForm({ ...expenseForm, tax_inclusive: value === 'inclusive' })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="exclusive">Exclusive (Added)</SelectItem>
                            <SelectItem value="inclusive">Inclusive (Included)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label htmlFor="department">Department *</Label>
                        <Select
                          value={expenseForm.department}
                          onValueChange={(value) => setExpenseForm({ ...expenseForm, department: value })}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select department" />
                          </SelectTrigger>
                          <SelectContent>
                            {ALL_DEPARTMENTS.map(d => (
                              <SelectItem key={d} value={d}>{d}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label htmlFor="category">Expense Category *</Label>
                        <Select
                          value={expenseForm.category}
                          onValueChange={(value) => setExpenseForm({ ...expenseForm, category: value })}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select category" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Cost of Goods Sold">Cost of Goods Sold</SelectItem>
                            <SelectItem value="Payroll">Payroll</SelectItem>
                            <SelectItem value="Supplies">Supplies</SelectItem>
                            <SelectItem value="Utilities">Utilities</SelectItem>
                            <SelectItem value="Repairs & Maintenance">Repairs & Maintenance</SelectItem>
                            <SelectItem value="Administrative">Administrative</SelectItem>
                            <SelectItem value="Marketing">Marketing</SelectItem>
                            <SelectItem value="Other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label htmlFor="reference_number">Reference #</Label>
                        <Input
                          id="reference_number"
                          value={expenseForm.reference_number}
                          onChange={(e) => setExpenseForm({ ...expenseForm, reference_number: e.target.value })}
                          placeholder="Reference number"
                        />
                      </div>
                      <div>
                        <Label htmlFor="status">Status</Label>
                        <Select
                          value={expenseForm.status}
                          onValueChange={(value) => setExpenseForm({ ...expenseForm, status: value })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="pending">Pending</SelectItem>
                            <SelectItem value="approved">Approved</SelectItem>
                            <SelectItem value="paid">Paid</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="flex justify-end space-x-2 pt-4">
                      <Button variant="outline" onClick={() => setShowAddExpenseModal(false)}>Cancel</Button>
                      <Button onClick={handleAddExpense}>Add Expense</Button>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>

              {expenseViewMode === 'invoice' && (
                <ExpenseInvoiceView
                  expenses={filteredExpenses}
                  onDeleteExpense={async (id) => {
                    await deleteVendorExpense(id);
                  }}
                  onAddCreditNote={async (expense, creditData) => {
                    await addVendorExpense({
                      vendor_id: expense.vendor_id,
                      description: creditData.description || `Credit note for ${expense.reference_number}`,
                      quantity: 1,
                      unit_cost: Math.abs(creditData.total_cost || 0),
                      tax_amount: 0,
                      tax_rate: 0,
                      tax_inclusive: false,
                      expense_date: new Date().toISOString().split('T')[0],
                      reference_number: expense.reference_number,
                      category: expense.category,
                      department: expense.department,
                      status: 'approved',
                    });
                  }}
                  onRecordBill={() => setIsRecordingBill(true)}
                />
              )}

              {expenseViewMode === 'flat' && (
                <Card>
                  <CardHeader>
                    <CardTitle>Expense List</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>ID</TableHead>
                          <TableHead>Vendor</TableHead>
                          <TableHead>Description</TableHead>
                          <TableHead>Department</TableHead>
                          <TableHead>Category</TableHead>
                          <TableHead>Qty</TableHead>
                          <TableHead>Unit Cost</TableHead>
                          <TableHead>Total Cost</TableHead>
                          <TableHead>Tax Amount</TableHead>
                          <TableHead>Date</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredExpenses.map((expense: VendorExpense) => {
                          // Check if this is a batch parent expense
                          const isBatchParent = expense.is_batch_parent;
                          const batchDetails = expense.batch_details ? JSON.parse(expense.batch_details) : null;

                          return (
                            <React.Fragment key={expense.id}>
                              <TableRow>
                                <TableCell title={expense.id}>{expense.id.slice(0, 8)}...</TableCell>
                                <TableCell>{expense.vendor_name}</TableCell>
                                <TableCell>
                                  {isBatchParent ? (
                                    <div>
                                      <div className="font-medium">{expense.description}</div>
                                      <button
                                        className="text-blue-600 hover:text-blue-800 text-sm underline"
                                        onClick={() => {
                                          const expanded = [...expandedBatchRows];
                                          const index = expanded.indexOf(expense.id);
                                          if (index > -1) {
                                            expanded.splice(index, 1);
                                          } else {
                                            expanded.push(expense.id);
                                          }
                                          setExpandedBatchRows(expanded);
                                        }}
                                      >
                                        {expandedBatchRows.includes(expense.id) ? 'Hide Items' : `View ${batchDetails?.length || 0} Items`}
                                      </button>
                                    </div>
                                  ) : (
                                    expense.description
                                  )}
                                </TableCell>
                                <TableCell>{expense.department}</TableCell>
                                <TableCell>{expense.category}</TableCell>
                                <TableCell>{expense.quantity}</TableCell>
                                <TableCell>${expense.unit_cost.toFixed(2)}</TableCell>
                                <TableCell>${expense.total_cost.toFixed(2)}</TableCell>
                                <TableCell>${expense.tax_amount.toFixed(2)}</TableCell>
                                <TableCell>
                                  {(() => {
                                    try {
                                      const d = new Date(expense.expense_date);
                                      if (isNaN(d.getTime())) return String(expense.expense_date);
                                      const yy = String(d.getFullYear()).slice(-2);
                                      const mm = String(d.getMonth() + 1).padStart(2, '0');
                                      const dd = String(d.getDate()).padStart(2, '0');
                                      const hh = String(d.getHours()).padStart(2, '0');
                                      const min = String(d.getMinutes()).padStart(2, '0');
                                      return `${yy}.${mm}.${dd}:${hh}.${min}`;
                                    } catch {
                                      return String(expense.expense_date);
                                    }
                                  })()}
                                </TableCell>
                                <TableCell>
                                  <Select
                                    value={expense.status}
                                    onValueChange={(value) => updateExpenseStatus(expense.id, value)}
                                  >
                                    <SelectTrigger className="w-32">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="pending">Pending</SelectItem>
                                      <SelectItem value="approved">Approved</SelectItem>
                                      <SelectItem value="paid">Paid</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </TableCell>
                                <TableCell>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handleEditExpense(expense)}
                                    disabled={expense.status === 'paid' || expense.status === 'cleared'}
                                  >
                                    {expense.status === 'paid' || expense.status === 'cleared' ? 'Locked' : 'Edit'}
                                  </Button>
                                </TableCell>
                              </TableRow>

                              {/* Expanded batch details */}
                              {isBatchParent && expandedBatchRows.includes(expense.id) && batchDetails && (
                                <TableRow>
                                  <TableCell colSpan={12} className="bg-gray-50 p-0">
                                    <div className="p-4 border-l-4 border-blue-500 ml-4">
                                      <h4 className="font-medium mb-2">Individual Line Items:</h4>
                                      <table className="w-full">
                                        <thead>
                                          <tr className="bg-gray-100">
                                            <th className="px-2 py-1 text-left text-xs font-medium text-gray-500">Description</th>
                                            <th className="px-2 py-1 text-left text-xs font-medium text-gray-500">Qty</th>
                                            <th className="px-2 py-1 text-left text-xs font-medium text-gray-500">Unit Cost</th>
                                            <th className="px-2 py-1 text-left text-xs font-medium text-gray-500">Total</th>
                                            <th className="px-2 py-1 text-left text-xs font-medium text-gray-500">Department</th>
                                            <th className="px-2 py-1 text-left text-xs font-medium text-gray-500">Category</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {batchDetails.map((item: any, index: number) => (
                                            <tr key={index} className="border-b">
                                              <td className="px-2 py-1 text-sm">{item.description}</td>
                                              <td className="px-2 py-1 text-sm">{item.quantity}</td>
                                              <td className="px-2 py-1 text-sm">${item.unit_cost.toFixed(2)}</td>
                                              <td className="px-2 py-1 text-sm">${(item.quantity * item.unit_cost).toFixed(2)}</td>
                                              <td className="px-2 py-1 text-sm">{item.department}</td>
                                              <td className="px-2 py-1 text-sm">{item.category}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  </TableCell>
                                </TableRow>
                              )}
                            </React.Fragment>
                          );
                        })}
                        {filteredExpenses.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={12} className="text-center text-gray-500 py-8">
                              No expenses found. {searchTerm ? 'Try a different search term.' : 'Add an expense to get started.'}
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>

                    {vendorExpenses.length > 0 && (
                      <div className="mt-4 border-t pt-4">
                        <div className="flex justify-end space-x-8">
                          <div>
                            <p className="text-lg font-semibold">Subtotal: ${calculateSubtotal(filteredExpenses).toFixed(2)}</p>
                            <p className="text-lg font-semibold">Tax Total: ${calculateTaxTotal(filteredExpenses).toFixed(2)}</p>
                            <p className="text-xl font-bold">Grand Total: ${calculateGrandTotal(filteredExpenses).toFixed(2)}</p>
                          </div>
                        </div>

                        {/* P&L Reporting Section - USALI Standard */}
                        <div className="mt-8 border-t pt-4">
                          <h3 className="text-lg font-semibold mb-4">P&L Report by Department and Category (USALI Standard)</h3>
                          <div className="overflow-x-auto">
                            <table className="min-w-full divide-y divide-gray-200">
                              <thead className="bg-gray-50">
                                <tr>
                                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Department</th>
                                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Category</th>
                                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                                </tr>
                              </thead>
                              <tbody className="bg-white divide-y divide-gray-200">
                                {Object.entries(groupExpensesByDepartmentAndCategory(filteredExpenses)).map(([dept, categories]) =>
                                  Object.entries(categories).map(([cat, amount], idx) => (
                                    <tr key={`${dept}-${cat}`} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{dept}</td>
                                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{cat}</td>
                                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-right">${amount.toFixed(2)}</td>
                                    </tr>
                                  ))
                                )}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="payments" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Vendor Payments</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Vendor</TableHead>
                    <TableHead>Amount Paid</TableHead>
                    <TableHead>Payment Date</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead>Reference #</TableHead>
                    <TableHead>Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {vendorPayments.map((payment: VendorPayment) => (
                    <TableRow key={payment.id}>
                      <TableCell>{payment.id}</TableCell>
                      <TableCell>{payment.vendor_name}</TableCell>
                      <TableCell>${payment.amount_paid.toFixed(2)}</TableCell>
                      <TableCell>{typeof payment.payment_date === 'string' ? payment.payment_date : new Date(payment.payment_date).toISOString().split('T')[0]}</TableCell>
                      <TableCell>{payment.payment_method}</TableCell>
                      <TableCell>{payment.reference_number}</TableCell>
                      <TableCell>{payment.notes}</TableCell>
                    </TableRow>
                  ))}
                  {vendorPayments.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-gray-500 py-8">
                        No payments found.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div >
  );
};

export default VendorManagement;