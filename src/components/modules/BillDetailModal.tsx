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
import { HOTEL_NAME } from '../../lib/brand';

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

  const formatCurrency = (val: number) => `$${Math.abs(val).toFixed(2)}`;
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

  const handlePrint = () => {
    const printWindow = window.open('', '_blank', 'width=800,height=600,scrollbars=yes');
    if (!printWindow) return;

    const taxTotal = group.lines.reduce((s, l) => s + (l.tax_amount || 0), 0);
    const creditTotal = group.creditNotes.reduce((s, c) => s + c.total_cost, 0);
    const statusLabel = (group.status || '').charAt(0).toUpperCase() + (group.status || '').slice(1);
    const fmtDate = (d: string) => d ? new Date(d).toLocaleDateString('en-US') : '—';
    const fmtAmt = (v: number) => `$${Math.abs(v).toFixed(2)}`;

    const lineRows = group.lines.map(l => `
      <tr>
        <td>${l.description}</td>
        <td>${l.category}</td>
        <td class="center">${l.quantity}</td>
        <td class="right">${fmtAmt(l.unit_cost)}</td>
        <td class="right">${fmtAmt(l.total_cost)}</td>
      </tr>`).join('');

    const creditRows = group.creditNotes.length > 0 ? `
      <h3 style="color:#b91c1c;margin-top:20px">Credit Notes</h3>
      <table>
        <tbody>
          ${group.creditNotes.map(cn => `<tr><td>${cn.description}</td><td class="right" style="color:#b91c1c">-${fmtAmt(Math.abs(cn.total_cost))}</td></tr>`).join('')}
        </tbody>
      </table>` : '';

    const voidBanner = (primaryExpense?.void_status === 'VOIDED' && primaryExpense?.voided_reason)
      ? `<div style="background:#fef2f2;border:1px solid #fca5a5;padding:8px 12px;border-radius:4px;margin-bottom:12px;color:#b91c1c;font-size:11pt">
           <strong>VOIDED:</strong> ${primaryExpense.voided_reason}
         </div>` : '';

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Invoice ${group.referenceNumber}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', system-ui, sans-serif; font-size: 11pt; color: #111; background: white; padding: 20mm; }
    h1 { font-size: 18pt; color: #1e3a5f; margin-bottom: 4px; }
    h2 { font-size: 11pt; font-weight: 600; color: #374151; margin: 16px 0 8px; }
    h3 { font-size: 10pt; }
    .badge { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 9pt; font-weight: 600; background: #fef3c7; color: #92400e; margin-left: 10px; }
    .divider { border: none; border-top: 3px solid #0073e6; margin: 12px 0 18px; }
    .meta { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; background: #f8fafc; border-radius: 6px; padding: 12px; margin-bottom: 16px; }
    .meta-label { font-size: 8pt; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.04em; }
    .meta-value { font-size: 11pt; font-weight: 600; margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; font-size: 10pt; }
    thead th { background: #0073e6; color: white; padding: 8px 10px; text-align: left; font-size: 9pt; text-transform: uppercase; letter-spacing: 0.03em; }
    thead th.right { text-align: right; }
    thead th.center { text-align: center; }
    tbody td { padding: 7px 10px; border-bottom: 1px solid #e5e7eb; }
    tbody tr:nth-child(even) { background: #f9fafb; }
    .right { text-align: right; }
    .center { text-align: center; }
    .totals { float: right; width: 260px; margin-top: 16px; border: 1px solid #e5e7eb; border-radius: 6px; padding: 14px; }
    .totals-row { display: flex; justify-content: space-between; padding: 3px 0; font-size: 10pt; color: #4b5563; }
    .totals-row.net { font-weight: 700; font-size: 12pt; color: #111; border-top: 1px solid #d1d5db; padding-top: 8px; margin-top: 6px; }
    .footer { clear: both; margin-top: 30px; text-align: center; font-size: 8pt; color: #9ca3af; border-top: 1px solid #e5e7eb; padding-top: 10px; }
    @media print { body { padding: 10mm; } }
  </style>
</head>
<body>
  <h1>Invoice <span style="color:#2563eb;font-family:monospace">${group.referenceNumber}</span>
    <span class="badge">${statusLabel}</span>
  </h1>
  <hr class="divider" />
  ${voidBanner}
  <div class="meta">
    <div><div class="meta-label">Vendor</div><div class="meta-value">${group.vendorName}</div></div>
    <div><div class="meta-label">Department</div><div class="meta-value">${group.department || '—'}</div></div>
    <div><div class="meta-label">Date</div><div class="meta-value">${fmtDate(group.date)}</div></div>
    <div><div class="meta-label">Invoice Ref</div><div class="meta-value" style="font-family:monospace">${group.referenceNumber}</div></div>
  </div>

  <h2>Line Items</h2>
  <table>
    <thead><tr>
      <th>Description</th><th>Category</th>
      <th class="center">Qty</th>
      <th class="right">Unit Cost</th>
      <th class="right">Total</th>
    </tr></thead>
    <tbody>${lineRows}</tbody>
  </table>

  ${creditRows}

  <div class="totals">
    <div class="totals-row"><span>Subtotal</span><span>${fmtAmt(group.totalAmount)}</span></div>
    ${taxTotal > 0 ? `<div class="totals-row"><span>VAT (${group.lines[0]?.Number(group.lines[0]?.tax_rate || 0).toFixed(1)}%)</span><span>${fmtAmt(taxTotal)}</span></div>` : ''}
    ${group.creditNotes.length > 0 ? `<div class="totals-row" style="color:#b91c1c"><span>Credits</span><span>-${fmtAmt(Math.abs(creditTotal))}</span></div>` : ''}
    <div class="totals-row net"><span>Net Total</span><span>${fmtAmt(group.netAmount)}</span></div>
  </div>

  <div class="footer">Printed ${new Date().toLocaleString('en-US')} &nbsp;|&nbsp; ${HOTEL_NAME} PMS</div>
</body>
</html>`;

    printWindow.document.write(html);
    printWindow.document.close();
    // Allow browser to render before triggering print dialog
    setTimeout(() => {
      printWindow.focus();
      printWindow.print();
      printWindow.close();
    }, 350);
  };

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
                <span>VAT ({group.lines[0]?.Number(group.lines[0]?.tax_rate || 0).toFixed(1)}%)</span>
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
