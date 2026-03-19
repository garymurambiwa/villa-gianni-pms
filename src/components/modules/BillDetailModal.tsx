/**
 * BillDetailModal – Full invoice detail view with Void and Delete actions
 *
 * Void rules:
 *   - Only if void_status === 'ACTIVE' AND status ∈ ['pending', 'approved']
 *   - Requires a reason (textarea) + explicit "Confirm Void" click
 *
 * Delete rules:
 *   - Only if status === 'pending' AND void_status !== 'VOIDED'
 *   - Requires typing "DELETE" to confirm (same UX as ExpenseInvoiceView)
 */

import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

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
  void_status?: string;
  voided_at?: string;
  voided_reason?: string;
  is_credit_note?: boolean;
  created_at: string;
}

interface InvoiceGroup {
  referenceNumber: string;
  vendorName: string;
  department: string;
  totalAmount: number;
  netAmount: number;
  date: string;
  status: string;
  lines: VendorExpense[];
  creditNotes: VendorExpense[];
}

interface Props {
  group: InvoiceGroup | null;
  open: boolean;
  onClose: () => void;
  onVoidExpense?: (expenseId: string, reason: string) => Promise<boolean>;
  onDeleteExpense?: (expenseId: string) => Promise<void>;
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                 */
/* -------------------------------------------------------------------------- */

export const BillDetailModal: React.FC<Props> = ({ group, open, onClose, onVoidExpense, onDeleteExpense }) => {
  const { toast } = useToast();

  // Void workflow state
  const [showVoidConfirm, setShowVoidConfirm] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [isVoiding, setIsVoiding] = useState(false);

  // Delete workflow state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  if (!group) return null;

  /* ---- Derived flags ---- */
  const primaryExpense = group.lines[0];
  const voidStatus = primaryExpense?.void_status ?? 'ACTIVE';
  const canVoid =
    voidStatus === 'ACTIVE' &&
    ['pending', 'approved'].includes(group.status);
  const canDelete =
    group.status === 'pending' &&
    voidStatus !== 'VOIDED';

  const formatCurrency = (val: number) => `R${Math.abs(val).toFixed(2)}`;
  const formatDate = (d: string) => d ? new Date(d).toLocaleDateString('en-ZA') : '—';

  /* ---- Status badge ---- */
  const statusColors: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-700',
    approved: 'bg-blue-100 text-blue-700',
    paid: 'bg-green-100 text-green-700',
    voided: 'bg-red-100 text-red-700',
    cleared: 'bg-gray-100 text-gray-600',
  };
  const badgeClass = statusColors[group.status] ?? 'bg-gray-100 text-gray-600';
  const displayStatus = (group.status || '').charAt(0).toUpperCase() + (group.status || '').slice(1);
  const isVoided = voidStatus === 'VOIDED';

  /* ---- Handlers ---- */
  const handleReset = () => {
    setShowVoidConfirm(false);
    setVoidReason('');
    setShowDeleteConfirm(false);
    setDeleteConfirmText('');
  };

  const handleClose = () => {
    handleReset();
    onClose();
  };

  const handleVoidConfirm = async () => {
    if (!voidReason.trim()) {
      toast({ title: 'Reason Required', description: 'Please enter a reason for voiding this invoice', variant: 'destructive' });
      return;
    }
    if (!primaryExpense) return;
    setIsVoiding(true);
    const ok = await onVoidExpense?.(primaryExpense.id, voidReason.trim());
    setIsVoiding(false);
    if (ok) {
      toast({ title: 'Invoice Voided', description: `Invoice ${group.referenceNumber} has been voided and kept for audit trail.` });
      handleClose();
    }
  };

  const handleDeleteConfirm = async () => {
    if (deleteConfirmText !== 'DELETE') return;
    if (!primaryExpense) return;
    setIsDeleting(true);
    try {
      await onDeleteExpense?.(primaryExpense.id);
      toast({ title: 'Deleted', description: `Invoice ${group.referenceNumber} permanently deleted.` });
      handleClose();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message || 'Delete failed', variant: 'destructive' });
    }
    setIsDeleting(false);
  };

  const handlePrint = () => window.print();

  /* ---- Tax summary ---- */
  const taxTotal = group.lines.reduce((s, l) => s + (l.tax_amount || 0), 0);
  const creditTotal = group.creditNotes.reduce((s, c) => s + c.total_cost, 0);
  const netAfterCredits = group.netAmount;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between pr-6">
            <span>Invoice: <span className="font-mono text-blue-600">{group.referenceNumber}</span></span>
            <span className={`px-3 py-1 rounded-full text-xs font-semibold ${badgeClass}`}>
              {isVoided ? 'VOIDED' : displayStatus}
            </span>
          </DialogTitle>
        </DialogHeader>

        {/* Voided banner */}
        {isVoided && primaryExpense?.voided_reason && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
            <strong>Voided:</strong> {primaryExpense.voided_reason}
            {primaryExpense.voided_at && (
              <span className="text-red-400 text-xs ml-2">on {formatDate(primaryExpense.voided_at)}</span>
            )}
          </div>
        )}

        {/* Header info */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm bg-gray-50 p-4 rounded-lg">
          <div>
            <p className="text-gray-500 text-xs font-medium uppercase tracking-wide">Vendor</p>
            <p className="font-semibold mt-0.5">{group.vendorName}</p>
          </div>
          <div>
            <p className="text-gray-500 text-xs font-medium uppercase tracking-wide">Department</p>
            <p className="font-semibold mt-0.5">{group.department || '—'}</p>
          </div>
          <div>
            <p className="text-gray-500 text-xs font-medium uppercase tracking-wide">Date</p>
            <p className="font-semibold mt-0.5">{formatDate(group.date)}</p>
          </div>
          <div>
            <p className="text-gray-500 text-xs font-medium uppercase tracking-wide">Invoice Ref</p>
            <p className="font-mono font-semibold mt-0.5">{group.referenceNumber}</p>
          </div>
        </div>

        {/* Line items */}
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Line Items</h3>
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-gray-600">Description</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-600">Category</th>
                  <th className="text-center px-3 py-2 font-medium text-gray-600">Qty</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-600">Unit Cost</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-600">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {group.lines.map((line) => (
                  <tr key={line.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2">{line.description}</td>
                    <td className="px-3 py-2 text-gray-500">{line.category}</td>
                    <td className="px-3 py-2 text-center">{line.quantity}</td>
                    <td className="px-3 py-2 text-right">{formatCurrency(line.unit_cost)}</td>
                    <td className="px-3 py-2 text-right font-medium">{formatCurrency(line.total_cost)}</td>
                  </tr>
                ))}
                {group.lines.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-4 text-center text-gray-400">No line items</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Credit notes */}
        {group.creditNotes.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-red-600 mb-2">Credit Notes</h3>
            <div className="border border-red-100 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-red-50">
                  {group.creditNotes.map((cn) => (
                    <tr key={cn.id} className="bg-red-50/30">
                      <td className="px-3 py-2 text-red-700">{cn.description}</td>
                      <td className="px-3 py-2 text-right text-red-700 font-medium">
                        -{formatCurrency(Math.abs(cn.total_cost))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Totals */}
        <div className="flex justify-end">
          <div className="w-64 bg-gray-50 border rounded-lg p-4 space-y-2 text-sm">
            <div className="flex justify-between text-gray-600">
              <span>Subtotal</span>
              <span>{formatCurrency(group.totalAmount)}</span>
            </div>
            {taxTotal > 0 && (
              <div className="flex justify-between text-gray-600">
                <span>VAT ({group.lines[0]?.tax_rate?.toFixed(1)}%)</span>
                <span>{formatCurrency(taxTotal)}</span>
              </div>
            )}
            {group.creditNotes.length > 0 && (
              <div className="flex justify-between text-red-600">
                <span>Credits</span>
                <span>-{formatCurrency(Math.abs(creditTotal))}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-gray-800 border-t pt-2">
              <span>Net Total</span>
              <span>{formatCurrency(netAfterCredits)}</span>
            </div>
          </div>
        </div>

        {/* Void confirmation panel */}
        {showVoidConfirm && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-3">
            <p className="text-sm font-semibold text-amber-800">Void Invoice {group.referenceNumber}</p>
            <p className="text-xs text-amber-700">
              This invoice will be marked as <strong>VOIDED</strong> and kept for audit trail.
              The record will NOT be deleted.
            </p>
            <div>
              <Label className="text-xs text-amber-700">Reason for voiding <span className="text-red-500">*</span></Label>
              <textarea
                className="mt-1 w-full border border-amber-300 rounded-md p-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
                rows={3}
                placeholder="e.g. Duplicate invoice, incorrect amounts..."
                value={voidReason}
                onChange={e => setVoidReason(e.target.value)}
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => { setShowVoidConfirm(false); setVoidReason(''); }}>
                Cancel
              </Button>
              <Button
                size="sm"
                className="bg-amber-600 hover:bg-amber-700 text-white"
                disabled={!voidReason.trim() || isVoiding}
                onClick={handleVoidConfirm}
              >
                {isVoiding ? 'Voiding…' : 'Confirm Void'}
              </Button>
            </div>
          </div>
        )}

        {/* Delete confirmation panel */}
        {showDeleteConfirm && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 space-y-3">
            <p className="text-sm font-semibold text-red-700">Permanently Delete Invoice</p>
            <p className="text-xs text-red-600">
              This will <strong>permanently remove</strong> invoice {group.referenceNumber} and all its line items.
              This cannot be undone.
            </p>
            <div>
              <Label className="text-xs text-red-600">
                Type <code className="bg-red-100 px-1 py-0.5 rounded font-mono">DELETE</code> to confirm
              </Label>
              <Input
                className="mt-1 border-red-300 focus:ring-red-400"
                placeholder="Type DELETE to confirm"
                value={deleteConfirmText}
                onChange={e => setDeleteConfirmText(e.target.value)}
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => { setShowDeleteConfirm(false); setDeleteConfirmText(''); }}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={deleteConfirmText !== 'DELETE' || isDeleting}
                onClick={handleDeleteConfirm}
              >
                {isDeleting ? 'Deleting…' : 'Permanently Delete'}
              </Button>
            </div>
          </div>
        )}

        <DialogFooter className="flex-wrap gap-2 pt-2 border-t">
          <Button variant="outline" size="sm" onClick={handlePrint}>
            🖨️ Print
          </Button>
          {canVoid && !showVoidConfirm && !showDeleteConfirm && (
            <Button
              size="sm"
              variant="outline"
              className="text-amber-600 border-amber-300 hover:bg-amber-50"
              onClick={() => setShowVoidConfirm(true)}
            >
              Void Invoice
            </Button>
          )}
          {canDelete && !showDeleteConfirm && !showVoidConfirm && (
            <Button
              size="sm"
              variant="destructive"
              className="text-xs"
              onClick={() => setShowDeleteConfirm(true)}
            >
              Delete
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={handleClose} className="ml-auto">
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default BillDetailModal;
