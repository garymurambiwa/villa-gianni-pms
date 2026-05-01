import React from 'react';
import BackToAccountingButton from '@/components/modules/common/BackToAccountingButton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import ap from '@/lib/ap';
import gl from '@/lib/glAccounting';

type LineEdit = { id: string; gl_account_code: string; cost_center_id: string; department: string; category: string; line_amount: number; description?: string; is_capital?: boolean };

const APInvoiceEntry: React.FC = () => {
  const [vendors, setVendors] = React.useState(() => ap.listVendors());
  const [header, setHeader] = React.useState<{ vendor_id: string; invoice_number: string; invoice_date: string; due_date: string; total_amount: number; purchase_order_id?: string }>({ vendor_id: '', invoice_number: '', invoice_date: new Date().toISOString().slice(0,10), due_date: new Date().toISOString().slice(0,10), total_amount: 0, purchase_order_id: '' });
  const [lines, setLines] = React.useState<LineEdit[]>([]);
  const [message, setMessage] = React.useState<{ type: 'success'|'error'; text: string }|null>(null);

  const allocatedTotal = React.useMemo(()=> lines.reduce((s,l)=> s + Number(l.line_amount || 0), 0), [lines]);
  const balanced = Number(Number(header.total_amount || 0).toFixed(2)) === Number(allocatedTotal.toFixed(2));
  const formValid = header.vendor_id && header.invoice_number && balanced && lines.length>0;

  const onHeaderChange: React.ChangeEventHandler<HTMLInputElement | HTMLSelectElement> = (e) => {
    const { name, value } = e.target as any;
    setHeader(prev => ({ ...prev, [name]: name==='total_amount' ? Number(value || 0) : value }));
    if (name === 'vendor_id') {
      const v = vendors.find(x => x.vendor_id === value);
      if (v && lines.length === 0) {
        setLines([{ id: `L${Date.now()}`, gl_account_code: v.default_gl_account_id || '', cost_center_id: 'Administration', department: 'Administration', category: 'Other', line_amount: Number(header.total_amount || 0), description: 'Invoice total allocation' }]);
      }
    }
  };

  const onLineChange = (id: string, field: keyof LineEdit, value: any) => {
    setLines(prev => prev.map(l => l.id===id ? { ...l, [field]: field==='line_amount' ? Number(value || 0) : value } : l));
  };
  const addLine = () => setLines(prev => ([...prev, { id:`L${Date.now()}`, gl_account_code:'', cost_center_id:'', department: 'Administration', category: 'Other', line_amount: Math.max(0, header.total_amount - allocatedTotal), description:'' }]));
  const delLine = (id: string) => setLines(prev => prev.filter(l=> l.id!==id));

  const submit: React.FormEventHandler<HTMLFormElement> = (e) => {
    e.preventDefault(); setMessage(null);
    if (!formValid) { setMessage({ type:'error', text:'Error: The invoice must be fully allocated and required fields must be filled.' }); return; }
    const res = ap.createInvoice({ vendor_id: header.vendor_id, invoice_number: header.invoice_number, invoice_date: header.invoice_date, due_date: header.due_date, total_amount: header.total_amount, purchase_order_id: header.purchase_order_id }, lines.map(l=> ({ gl_account_code: l.gl_account_code, cost_center_id: l.cost_center_id, department: l.department, category: l.category, line_amount: l.line_amount, description: l.description, is_capital: l.is_capital })));
    if (!res.ok) { setMessage({ type:'error', text: res.error || 'Failed to save invoice' }); return; }
    setMessage({ type:'success', text: `Invoice ${header.invoice_number} saved and queued for approval.` });
    setHeader({ vendor_id: '', invoice_number:'', invoice_date: new Date().toISOString().slice(0,10), due_date: new Date().toISOString().slice(0,10), total_amount: 0, purchase_order_id:'' }); setLines([]);
  };

  return (
    <div className="p-6">
      <BackToAccountingButton />
      <h2 className="text-2xl font-bold mb-4">AP: New Invoice Entry</h2>
      {message && (
        <div className={`p-3 mb-4 rounded border ${message.type==='success'?'bg-green-50 text-green-700 border-green-200':'bg-red-50 text-red-700 border-red-200'}`}>{message.text}</div>
      )}
      <form onSubmit={submit} className="space-y-4">
        <div className="bg-white p-4 rounded shadow">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <Label htmlFor="vendor_id">Vendor *</Label>
              <select id="vendor_id" name="vendor_id" value={header.vendor_id} onChange={onHeaderChange} className="mt-1 w-full border rounded p-2" required>
                <option value="">Select Vendor…</option>
                {vendors.map(v => (<option key={v.vendor_id} value={v.vendor_id}>{v.vendor_name} ({v.vendor_id})</option>))}
              </select>
            </div>
            <div>
              <Label htmlFor="invoice_number">Invoice Number *</Label>
              <Input id="invoice_number" name="invoice_number" value={header.invoice_number} onChange={onHeaderChange} required />
            </div>
            <div>
              <Label htmlFor="invoice_date">Invoice Date *</Label>
              <Input id="invoice_date" type="date" name="invoice_date" value={header.invoice_date} onChange={onHeaderChange} required />
            </div>
            <div>
              <Label htmlFor="due_date">Due Date *</Label>
              <Input id="due_date" type="date" name="due_date" value={header.due_date} onChange={onHeaderChange} required />
            </div>
            <div>
              <Label htmlFor="total_amount">Total Amount *</Label>
              <Input id="total_amount" type="number" name="total_amount" value={header.total_amount} onChange={onHeaderChange} min={0.01} step={0.01} required />
            </div>
            <div className="lg:col-span-2">
              <Label htmlFor="purchase_order_id">Related PO (optional)</Label>
              <Input id="purchase_order_id" name="purchase_order_id" value={header.purchase_order_id} onChange={onHeaderChange} placeholder="PO-12345" />
            </div>
          </div>
        </div>

        <div className="bg-white p-4 rounded shadow">
          <h3 className="text-lg font-semibold mb-3">GL & Cost Center Allocation</h3>
          <div className={`p-3 mb-3 rounded flex items-center justify-between ${balanced ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
            <div>Allocation Status: <span className="font-bold">{balanced ? 'BALANCED' : 'UNBALANCED'}</span></div>
            <div className="text-sm">Total: ${Number(header.total_amount || 0).toFixed(2)} · Allocated: ${allocatedTotal.toFixed(2)} · Remaining: ${(header.total_amount - allocatedTotal).toFixed(2)}</div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr><th className="p-2 text-left">GL Account *</th><th className="p-2 text-left">Cost Center *</th><th className="p-2 text-left">Department *</th><th className="p-2 text-left">Category *</th><th className="p-2 text-right">Amount *</th><th className="p-2 text-left">Description</th><th className="p-2">Action</th></tr>
              </thead>
              <tbody>
                {lines.map((l, idx) => (
                  <tr key={l.id}>
                    <td className="p-2">
                      <Input aria-label={`GL Account ${idx+1}`} value={l.gl_account_code} onChange={(e)=> onLineChange(l.id, 'gl_account_code', e.target.value)} placeholder="e.g. 6110" required />
                    </td>
                    <td className="p-2">
                      <Input aria-label={`Cost Center ${idx+1}`} value={l.cost_center_id} onChange={(e)=> onLineChange(l.id, 'cost_center_id', e.target.value)} placeholder="e.g. Rooms" required />
                    </td>
                    <td className="p-2">
                      <select aria-label={`Department ${idx+1}`} value={l.department} onChange={(e)=> onLineChange(l.id, 'department', e.target.value)} required className="w-full border rounded p-2">
                        <option value="Front Office">Front Office</option>
                        <option value="Housekeeping">Housekeeping</option>
                        <option value="Food & Beverage">Food & Beverage</option>
                        <option value="Maintenance">Maintenance</option>
                        <option value="Sales & Marketing">Sales & Marketing</option>
                        <option value="Administration">Administration</option>
                        <option value="Other">Other</option>
                      </select>
                    </td>
                    <td className="p-2">
                      <select aria-label={`Category ${idx+1}`} value={l.category} onChange={(e)=> onLineChange(l.id, 'category', e.target.value)} required className="w-full border rounded p-2">
                        <option value="Cost of Goods Sold">Cost of Goods Sold</option>
                        <option value="Payroll">Payroll</option>
                        <option value="Supplies">Supplies</option>
                        <option value="Utilities">Utilities</option>
                        <option value="Repairs & Maintenance">Repairs & Maintenance</option>
                        <option value="Administrative">Administrative</option>
                        <option value="Marketing">Marketing</option>
                        <option value="Other">Other</option>
                      </select>
                    </td>
                    <td className="p-2 text-right">
                      <Input aria-label={`Amount ${idx+1}`} type="number" value={l.line_amount} onChange={(e)=> onLineChange(l.id, 'line_amount', e.target.value)} min={0.01} step={0.01} required />
                    </td>
                    <td className="p-2">
                      <Input aria-label={`Description ${idx+1}`} value={l.description||''} onChange={(e)=> onLineChange(l.id, 'description', e.target.value)} />
                    </td>
                    <td className="p-2">
                      <Button variant="outline" onClick={()=> delLine(l.id)}>Delete</Button>
                    </td>
                  </tr>
                ))}
                {lines.length === 0 && (<tr><td className="p-2 text-gray-600" colSpan={7}>Click "Add Line" to start allocating.</td></tr>)}
              </tbody>
            </table>
          </div>
          <div className="mt-2">
            <Button variant="outline" onClick={addLine}>Add Line</Button>
          </div>
        </div>

        <div className="flex justify-end">
          <Button type="submit" className="bg-green-600 text-white" disabled={!formValid}>Submit for Approval</Button>
        </div>
      </form>
    </div>
  );
};

export default APInvoiceEntry;
