/**
 * ExpenseInvoiceView – Invoice-grouped parent/child expense table
 *
 * Features:
 *  • Groups expenses by reference_number (invoice)
 *  • Expand/collapse child line items
 *  • Credit note modal (negative transaction linked to original)
 *  • 2-step delete (type "DELETE" to confirm)
 *  • Column sorting, status filtering, date range, and text search
 */

import React, { useState, useMemo, useCallback } from 'react';
import { useData } from '@/context/DataContext';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Label } from '@/components/ui/label';
import { ALL_DEPARTMENTS } from '@/lib/usaliCategories';
import { formatDateForCSV, toDisplayId, escapeCSV } from '@/lib/csvUtils';

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
    is_credit_note?: boolean;
    parent_expense_id?: string;
    is_batch_parent?: boolean;
    batch_details?: string;
    created_at: string;
    updated_at: string;
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

type SortField = 'date' | 'vendor' | 'amount' | 'reference' | 'department';
type SortDir = 'asc' | 'desc';

/* -------------------------------------------------------------------------- */
/*  Component                                                                 */
/* -------------------------------------------------------------------------- */

interface Props {
    expenses: VendorExpense[];
    onDeleteExpense?: (id: string) => Promise<void>;
    onAddCreditNote?: (expense: VendorExpense, creditData: Partial<VendorExpense>) => Promise<void>;
    onRecordBill?: () => void;
    onMarkPaid?: (referenceNumber: string) => Promise<void>;
}

export const ExpenseInvoiceView: React.FC<Props> = ({ expenses, onDeleteExpense, onAddCreditNote, onRecordBill }) => {
    const { toast } = useToast();

    // UI state
    const [expandedInvoices, setExpandedInvoices] = useState<Set<string>>(new Set());
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<string>('all');
    const [departmentFilter, setDepartmentFilter] = useState<string>('all');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [sortField, setSortField] = useState<SortField>('date');
    const [sortDir, setSortDir] = useState<SortDir>('desc');

    // Delete confirmation modal
    const [deleteTarget, setDeleteTarget] = useState<VendorExpense | null>(null);
    const [deleteConfirmText, setDeleteConfirmText] = useState('');

    // Credit note modal
    const [creditTarget, setCreditTarget] = useState<VendorExpense | null>(null);
    const [creditForm, setCreditForm] = useState({ description: '', amount: 0 });

    /* ---------------------------------------------------------------------- */
    /*  Group expenses by invoice reference                                    */
    /* ---------------------------------------------------------------------- */
    const invoiceGroups = useMemo(() => {
        const byRef = new Map<string, InvoiceGroup>();

        const list = expenses || [];
        list.forEach(exp => {
            const ref = exp.reference_number || exp.id;  // fallback to ID if no ref
            const isCreditNote = exp.is_credit_note || exp.total_cost < 0;

            if (!byRef.has(ref) && !isCreditNote) {
                byRef.set(ref, {
                    referenceNumber: ref,
                    vendorName: exp.vendor_name,
                    department: exp.department,
                    totalAmount: 0,
                    netAmount: 0,
                    date: String(exp.expense_date || ''),
                    status: exp.status,
                    lines: [],
                    creditNotes: [],
                });
            }

            // Ensure the group exists (may already be set by a parent)
            if (!byRef.has(ref)) {
                const parentRef = exp.parent_expense_id || ref;
                if (!byRef.has(parentRef)) {
                    byRef.set(parentRef, {
                        referenceNumber: parentRef,
                        vendorName: exp.vendor_name,
                        department: exp.department,
                        totalAmount: 0,
                        netAmount: 0,
                        date: String(exp.expense_date || ''),
                        status: exp.status,
                        lines: [],
                        creditNotes: [],
                    });
                }
                const group = byRef.get(parentRef)!;
                group.creditNotes.push(exp);
                group.netAmount += exp.total_cost;
                return;
            }

            const group = byRef.get(ref)!;
            if (isCreditNote) {
                group.creditNotes.push(exp);
            } else {
                group.lines.push(exp);
                group.totalAmount += exp.total_cost;
            }
            group.netAmount += exp.total_cost;
        });

        return Array.from(byRef.values());
    }, [expenses]);

    /* ---------------------------------------------------------------------- */
    /*  Filter + Sort                                                          */
    /* ---------------------------------------------------------------------- */
    const filteredGroups = useMemo(() => {
        let result = invoiceGroups;

        // Status filter
        if (statusFilter !== 'all') {
            result = result.filter(g => g.status === statusFilter);
        }

        // Department filter
        if (departmentFilter !== 'all') {
            result = result.filter(g => g.department === departmentFilter);
        }

        // Date range
        if (dateFrom) result = result.filter(g => String(g.date || '') >= dateFrom);
        if (dateTo) result = result.filter(g => String(g.date || '') <= dateTo);

        // Text search
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            result = result.filter(g =>
                String(g.vendorName || '').toLowerCase().includes(q) ||
                String(g.referenceNumber || '').toLowerCase().includes(q) ||
                String(g.department || '').toLowerCase().includes(q) ||
                g.lines.some(l => String(l.description || '').toLowerCase().includes(q))
            );
        }

        // Sort
        result.sort((a, b) => {
            let cmp = 0;
            switch (sortField) {
                case 'date': cmp = String(a.date || '').localeCompare(String(b.date || '')); break;
                case 'vendor': cmp = String(a.vendorName || '').localeCompare(String(b.vendorName || '')); break;
                case 'amount': cmp = a.netAmount - b.netAmount; break;
                case 'reference': cmp = String(a.referenceNumber || '').localeCompare(String(b.referenceNumber || '')); break;
                case 'department': cmp = String(a.department || '').localeCompare(String(b.department || '')); break;
            }
            return sortDir === 'asc' ? cmp : -cmp;
        });

        return result;
    }, [invoiceGroups, statusFilter, departmentFilter, dateFrom, dateTo, searchQuery, sortField, sortDir]);

    /* ---------------------------------------------------------------------- */
    /*  Handlers                                                               */
    /* ---------------------------------------------------------------------- */
    const toggleExpand = useCallback((ref: string) => {
        setExpandedInvoices(prev => {
            const next = new Set(prev);
            if (next.has(ref)) next.delete(ref); else next.add(ref);
            return next;
        });
    }, []);

    const handleSort = useCallback((field: SortField) => {
        if (sortField === field) {
            setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        } else {
            setSortField(field);
            setSortDir('asc');
        }
    }, [sortField]);

    const handleDeleteConfirm = async () => {
        if (!deleteTarget || deleteConfirmText !== 'DELETE') return;
        try {
            await onDeleteExpense?.(deleteTarget.id);
            toast({ title: 'Deleted', description: `Expense ${deleteTarget.reference_number || deleteTarget.id} removed.` });
        } catch (err: any) {
            toast({ title: 'Error', description: err.message || 'Delete failed', variant: 'destructive' });
        }
        setDeleteTarget(null);
        setDeleteConfirmText('');
    };

    const handleCreditNoteSubmit = async () => {
        if (!creditTarget || creditForm.amount <= 0) return;
        try {
            await onAddCreditNote?.(creditTarget, {
                description: creditForm.description || `Credit note for ${creditTarget.reference_number}`,
                total_cost: -Math.abs(creditForm.amount),
                is_credit_note: true,
                parent_expense_id: creditTarget.id,
            });
            toast({ title: 'Credit Note Created', description: `$${creditForm.amount.toFixed(2)} credited against ${creditTarget.reference_number}` });
        } catch (err: any) {
            toast({ title: 'Error', description: err.message || 'Failed to create credit note', variant: 'destructive' });
        }
        setCreditTarget(null);
        setCreditForm({ description: '', amount: 0 });
    };

    const formatCurrency = (val: number) => `$${Math.abs(val).toFixed(2)}`;

    const formatDateShort = (dateStr: string) => {
        try {
            const d = new Date(dateStr);
            if (isNaN(d.getTime())) return dateStr;
            const yy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            const hh = String(d.getHours()).padStart(2, '0');
            const min = String(d.getMinutes()).padStart(2, '0');
            return `${dd}/${mm}/${yy} ${hh}:${min}`;
        } catch {
            return dateStr;
        }
    };

    const sortIndicator = (field: SortField) => sortField === field ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';

    const totalFiltered = filteredGroups.reduce((s, g) => s + g.netAmount, 0);

    /* ---------------------------------------------------------------------- */
    /*  Render                                                                 */
    /* ---------------------------------------------------------------------- */
    return (
        <div className="space-y-4">
            {/* Filters row */}
            <div className="flex flex-wrap items-end gap-3 justify-between">
                <div className="flex flex-wrap items-end gap-3 flex-1">
                    <div className="flex-1 min-w-[200px]">
                        <Label className="text-xs text-gray-500 mb-1 block">Search</Label>
                        <div className="relative">
                            <Input
                                placeholder="Search vendor, invoice, description…"
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                className="pl-9"
                            />
                            <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                        </div>
                    </div>
                    <div>
                        <Label className="text-xs text-gray-500 mb-1 block">Status</Label>
                        <Select value={statusFilter} onValueChange={setStatusFilter}>
                            <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All</SelectItem>
                                <SelectItem value="pending">Pending</SelectItem>
                                <SelectItem value="approved">Approved</SelectItem>
                                <SelectItem value="paid">Paid</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div>
                        <Label className="text-xs text-gray-500 mb-1 block">Department</Label>
                        <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
                            <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Departments</SelectItem>
                                {ALL_DEPARTMENTS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                    <div>
                        <Label className="text-xs text-gray-500 mb-1 block">From</Label>
                        <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-[150px]" />
                    </div>
                    <div>
                        <Label className="text-xs text-gray-500 mb-1 block">To</Label>
                        <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-[150px]" />
                    </div>
                </div>
                {onRecordBill && (
                    <div className="flex items-end pb-1">
                        <Button onClick={onRecordBill} className="bg-blue-600 hover:bg-blue-700 text-white font-medium shadow-sm">
                            + Record Vendor Bill
                        </Button>
                    </div>
                )}
            </div>

            {/* List Header */}
            <div className="flex justify-between items-center text-sm text-gray-500 bg-gray-50 p-2 rounded-md">
                <span>{filteredGroups.length} invoice{filteredGroups.length !== 1 ? 's' : ''} shown</span>
                <span className="font-semibold">Net Total: {formatCurrency(totalFiltered)}</span>
            </div>

            {/* Invoice Table */}
            <div className="bg-white rounded-xl shadow-lg overflow-hidden">
                <Table>
                    <TableHeader>
                        <TableRow className="bg-gray-50">
                            <TableHead className="w-8"></TableHead>
                            <TableHead className="cursor-pointer select-none" onClick={() => handleSort('reference')}>Invoice Ref{sortIndicator('reference')}</TableHead>
                            <TableHead className="cursor-pointer select-none" onClick={() => handleSort('vendor')}>Vendor{sortIndicator('vendor')}</TableHead>
                            <TableHead className="cursor-pointer select-none" onClick={() => handleSort('department')}>Department{sortIndicator('department')}</TableHead>
                            <TableHead className="cursor-pointer select-none" onClick={() => handleSort('date')}>Date{sortIndicator('date')}</TableHead>
                            <TableHead className="cursor-pointer select-none text-right" onClick={() => handleSort('amount')}>Amount{sortIndicator('amount')}</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filteredGroups.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={8} className="text-center py-12 text-gray-400">
                                    No expenses match your filters.
                                </TableCell>
                            </TableRow>
                        )}
                        {filteredGroups.map((group, idx) => {
                            const isExpanded = expandedInvoices.has(group.referenceNumber);
                            const hasChildren = group.lines.length > 1 || group.creditNotes.length > 0;

                            return (
                                <React.Fragment key={group.referenceNumber}>
                                    {/* Parent invoice row */}
                                    <TableRow
                                        className={`cursor-pointer hover:bg-gray-50 ${isExpanded ? 'bg-blue-50/50' : ''}`}
                                        onClick={() => hasChildren && toggleExpand(group.referenceNumber)}
                                    >
                                        <TableCell className="text-center">
                                            {hasChildren && (
                                                <span className="text-gray-400 text-sm">{isExpanded ? '▼' : '▶'}</span>
                                            )}
                                        </TableCell>
                                        <TableCell className="font-mono text-sm">{toDisplayId(idx + 1, 'INV')}</TableCell>
                                        <TableCell className="font-medium">{group.vendorName}</TableCell>
                                        <TableCell className="text-sm text-gray-600">{group.department}</TableCell>
                                        <TableCell className="text-sm">{formatDateShort(group.date)}</TableCell>
                                        <TableCell className="text-right font-semibold">
                                            {formatCurrency(group.netAmount)}
                                            {group.creditNotes.length > 0 && (
                                                <span className="block text-xs text-red-500">
                                                    ({formatCurrency(group.creditNotes.reduce((s, c) => s + c.total_cost, 0))} credited)
                                                </span>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${group.status === 'paid' ? 'bg-green-100 text-green-700' :
                                                group.status === 'approved' ? 'bg-blue-100 text-blue-700' :
                                                    'bg-yellow-100 text-yellow-700'
                                                }`}>
                                                {String(group.status || '').charAt(0).toUpperCase() + String(group.status || '').slice(1)}
                                            </span>
                                        </TableCell>
                                        <TableCell onClick={e => e.stopPropagation()}>
                                            <div className="flex gap-1">
                                                {group.status !== 'paid' && onMarkPaid && (
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        className="text-xs bg-green-50 text-green-600 border-green-200 hover:bg-green-100 font-medium"
                                                        onClick={() => onMarkPaid(group.referenceNumber)}
                                                    >
                                                        Mark Paid
                                                    </Button>
                                                )}
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    className="text-xs"
                                                    onClick={() => {
                                                        setCreditTarget(group.lines[0]);
                                                        setCreditForm({ description: '', amount: 0 });
                                                    }}
                                                >
                                                    Credit Note
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    variant="destructive"
                                                    className="text-xs"
                                                    onClick={() => {
                                                        setDeleteTarget(group.lines[0]);
                                                        setDeleteConfirmText('');
                                                    }}
                                                >
                                                    Delete
                                                </Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>

                                    {/* Expanded child rows */}
                                    {isExpanded && group.lines.map(line => (
                                        <TableRow key={line.id} className="bg-gray-50/50">
                                            <TableCell></TableCell>
                                            <TableCell className="text-xs text-gray-400 pl-6">└ {line.id.slice(0, 8)}</TableCell>
                                            <TableCell colSpan={2} className="text-sm">{line.description}</TableCell>
                                            <TableCell className="text-sm text-gray-600">
                                                {line.quantity} × ${line.unit_cost.toFixed(2)}
                                            </TableCell>
                                            <TableCell className="text-right text-sm">{formatCurrency(line.total_cost)}</TableCell>
                                            <TableCell className="text-xs text-gray-500">{line.category}</TableCell>
                                            <TableCell></TableCell>
                                        </TableRow>
                                    ))}

                                    {/* Credit notes */}
                                    {isExpanded && group.creditNotes.map(cn => (
                                        <TableRow key={cn.id} className="bg-red-50/30">
                                            <TableCell></TableCell>
                                            <TableCell className="text-xs text-red-400 pl-6">└ Credit</TableCell>
                                            <TableCell colSpan={2} className="text-sm text-red-600">{cn.description}</TableCell>
                                            <TableCell></TableCell>
                                            <TableCell className="text-right text-sm text-red-600 font-medium">
                                                -{formatCurrency(Math.abs(cn.total_cost))}
                                            </TableCell>
                                            <TableCell></TableCell>
                                            <TableCell>
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    className="text-xs text-red-500"
                                                    onClick={() => { setDeleteTarget(cn); setDeleteConfirmText(''); }}
                                                >
                                                    Remove
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </React.Fragment>
                            );
                        })}
                    </TableBody>
                </Table>
            </div>

            {/* 2-Step Delete Confirmation Dialog */}
            <Dialog open={!!deleteTarget} onOpenChange={() => { setDeleteTarget(null); setDeleteConfirmText(''); }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="text-red-600">Delete Expense</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                        <p className="text-sm text-gray-600">
                            This will permanently remove the expense
                            <strong> {deleteTarget?.reference_number || deleteTarget?.id}</strong>
                            {deleteTarget?.vendor_name ? ` from ${deleteTarget.vendor_name}` : ''}.
                        </p>
                        <p className="text-sm text-gray-600">
                            Type <code className="bg-gray-100 px-2 py-0.5 rounded font-mono text-red-600">DELETE</code> to confirm.
                        </p>
                        <Input
                            value={deleteConfirmText}
                            onChange={e => setDeleteConfirmText(e.target.value)}
                            placeholder="Type DELETE to confirm"
                            className={deleteConfirmText === 'DELETE' ? 'border-red-500' : ''}
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => { setDeleteTarget(null); setDeleteConfirmText(''); }}>
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            disabled={deleteConfirmText !== 'DELETE'}
                            onClick={handleDeleteConfirm}
                        >
                            Permanently Delete
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Credit Note Dialog */}
            <Dialog open={!!creditTarget} onOpenChange={() => setCreditTarget(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Issue Credit Note</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                        <p className="text-sm text-gray-600">
                            Creating a credit note against invoice <strong>{creditTarget?.reference_number}</strong>
                            ({creditTarget?.vendor_name}) — original amount: {creditTarget ? formatCurrency(creditTarget.total_cost) : ''}.
                        </p>
                        <div>
                            <Label>Description</Label>
                            <Input
                                value={creditForm.description}
                                onChange={e => setCreditForm(prev => ({ ...prev, description: e.target.value }))}
                                placeholder={`Credit note for ${creditTarget?.reference_number || ''}`}
                            />
                        </div>
                        <div>
                            <Label>Credit Amount ($)</Label>
                            <Input
                                type="number"
                                min={0}
                                max={creditTarget?.total_cost || 0}
                                value={creditForm.amount || ''}
                                onChange={e => setCreditForm(prev => ({ ...prev, amount: Number(e.target.value) }))}
                            />
                            <p className="text-xs text-gray-500 mt-1">
                                Max: {creditTarget ? formatCurrency(creditTarget.total_cost) : ''}
                            </p>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setCreditTarget(null)}>Cancel</Button>
                        <Button
                            disabled={creditForm.amount <= 0}
                            onClick={handleCreditNoteSubmit}
                        >
                            Issue Credit Note
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default ExpenseInvoiceView;
