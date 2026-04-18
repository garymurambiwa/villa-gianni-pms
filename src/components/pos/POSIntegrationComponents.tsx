/**
 * POS Integration Components
 * 
 * This file contains React components extracted from the POS system that can be
 * integrated into the main PMS system. Each component is documented with its
 * purpose, props, and integration notes.
 */

import React, { useState, useEffect } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Tabs, TabsList, TabsTrigger } from '../ui/tabs';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { readReceiptBranding, subscribeReceiptBranding } from '@/lib/printSettings';
import db from '@/lib/db';
import { calculateTaxBreakdown } from '@/utils/billingUtils';
import { 
  validateRoomChargePayment, 
  generateReceiptHTML, 
  printDocument,
  formatCurrency,
  formatReceiptDate,
  sendReceiptEmail,
  createAuditEntry,
  generateCityLedgerReceiptHTML,
  processCardPayment,
  logPaymentEvent,
  validatePaymentAmount,
  validateEmail
} from '../../lib/posIntegration';
import { useData } from '../../context/DataContext';
import { useToast } from '@/hooks/use-toast';

// ============================================================================
// PAYMENT MODAL COMPONENT
// ============================================================================

interface PaymentModalProps {
  /** Bill/folio data to process payment for */
  bill: {
    id: string;
    total: number;
    items: Array<{
      name: string;
      quantity: number;
      price: number;
      subtotal: number;
    }>;
    tableId?: string;
    customerName?: string;
    roomNumber?: string;
  };
  /** Whether modal is open */
  isOpen: boolean;
  /** Function to close modal */
  onClose: () => void;
  /** Function called when payment is processed */
  onPaymentComplete: (paymentData: any) => void;
  /** Current user/staff member */
  currentUser?: {
    name: string;
    id: string;
    role?: string;
  };
  /** Receipt settings for printing */
  receiptSettings?: {
    restaurant_name: string;
    address?: string;
    phone?: string;
    email?: string;
    tax_rate: number;
    show_tax_breakdown: boolean;
    paper_size: '58mm' | '80mm';
    logo_url?: string;
    header_text?: string;
    footer_text?: string;
    promotional_message?: string;
  };
  voidContext?: {
    reason: string;
    managerId: string;
  };
}

/**
 * Payment Modal Component
 * 
 * Handles payment processing for bills/folios with support for:
 * - Cash payments
 * - Card payments  
 * - Room charge postings
 * - Receipt printing
 * 
 * Integration Notes:
 * - Adapt for folio charge posting in PMS
 * - Use for room service orders, restaurant charges, etc.
 * - Integrate with existing payment processing system
 * - Customize receipt template for hotel branding
 */
export const PaymentModal: React.FC<PaymentModalProps> = ({
  bill,
  isOpen,
  onClose,
  onPaymentComplete,
  currentUser,
  receiptSettings,
  voidContext
}) => {
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | 'room-charge' | 'city-ledger'>(() => {
    try {
      const m = localStorage.getItem('corepms_pos_last_payment_method');
      if (m === 'cash' || m === 'card' || m === 'room-charge' || m === 'city-ledger') return m as any;
    } catch {}
    return 'cash';
  });
  const [customerName, setCustomerName] = useState(bill.customerName || '');
  const [roomNumber, setRoomNumber] = useState(bill.roomNumber || '');
  const [isProcessing, setIsProcessing] = useState(false);
  const [emailReceipt, setEmailReceipt] = useState('');
  const [activePreTab, setActivePreTab] = useState<'none'|'split'|'transfer'|'discount'|'void'>('none');
  const [splits, setSplits] = useState<Array<{ label: string; amount: number }>>([]);
  const [destTable, setDestTable] = useState<string>('');
  const [transferItemsAll, setTransferItemsAll] = useState<boolean>(true);
  const [discountMode, setDiscountMode] = useState<'percent'|'amount'>('percent');
  const [discountValue, setDiscountValue] = useState<number>(0);
  const [voidMode, setVoidMode] = useState<'item'|'bill'>('item');
  const [selectedVoidIndex, setSelectedVoidIndex] = useState<number>(-1);
  const [confirmVoidOpen, setConfirmVoidOpen] = useState(false);
  const [pinModalOpen, setPinModalOpen] = useState(false);
  const [pinRole, setPinRole] = useState<'manager'|''>('manager');
  const [pinCode, setPinCode] = useState('');
  const [pinError, setPinError] = useState('');
  const [pinBusy, setPinBusy] = useState(false);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [locked, setLocked] = useState(false);
  const [timeoutId, setTimeoutId] = useState<any>(null);
  const [approvedBy, setApprovedBy] = useState<string | undefined>(undefined);
  const [voidReason, setVoidReason] = useState<string>(voidContext?.reason || '');
  const [managerIdInput, setManagerIdInput] = useState<string>(voidContext?.managerId || '');
  const hashPin = async (pin: string, salt: string) => { try { const data = new TextEncoder().encode(salt + pin); const dig = await (window.crypto||crypto).subtle.digest('SHA-256', data); const bytes = Array.from(new Uint8Array(dig)); return bytes.map(b=>b.toString(16).padStart(2,'0')).join(''); } catch { return '' } };

  // City Ledger lookup/posting state
  const { cityLedger, addCityLedgerTransaction, removeFolioCharge } = useData();
  const { toast } = useToast();
  const [clSearch, setClSearch] = useState('');
  const [selectedAccountId, setSelectedAccountId] = useState<string | undefined>(undefined);
  const selectedAccount: any = (cityLedger || []).find((a: any) => a.id === selectedAccountId);
  const filteredAccounts: any[] = (cityLedger || []).filter((a: any) => {
    const q = clSearch.trim().toLowerCase();
    if (!q) return true;
    return String(a.name || '').toLowerCase().includes(q) || String(a.id || '').toLowerCase().includes(q);
  }).slice(0, 12);

  // Suggested accounts (most-used based on audit CITY_LEDGER_POST)
  const suggestedAccounts: any[] = React.useMemo(() => {
    try {
      const raw = localStorage.getItem('corepms_pos_audit');
      const list: any[] = raw ? JSON.parse(raw) : [];
      const freq = new Map<string, number>();
      list.filter(e => e.action === 'CITY_LEDGER_POST').forEach(e => {
        const accId = e.details?.cityLedgerAccountId || e.details?.meta?.cityLedgerAccountId || e.entity || '';
        if (accId) freq.set(accId, (freq.get(accId) || 0) + 1);
      });
      const sorted = Array.from(freq.entries()).sort((a,b)=> b[1]-a[1]).map(([id]) => (cityLedger||[]).find((a:any)=>a.id===id)).filter(Boolean);
      return sorted.slice(0, 5) as any[];
    } catch { return []; }
  }, [cityLedger]);

  // Manager override for blocked postings
  const [managerOverride, setManagerOverride] = useState<boolean>(false);
  const canManagerOverride = (currentUser?.role === 'manager' || currentUser?.role === 'admin');

  // Department-based restriction heuristic: infer from items' category
  const deptHeuristic: 'Bar' | 'Restaurant' | 'F&B' = React.useMemo(() => {
    const cats = (bill.items || []).map(i => String(i.category || '').toLowerCase());
    const barCats = ['spirits','wines','beers','cocktails','bar','cellar'];
    const isBar = cats.some(c => barCats.includes(c));
    return isBar ? 'Bar' : cats.length ? 'Restaurant' : 'F&B';
  }, [bill.items]);

  const isAccountTypeAllowedForDept = (acc: any): boolean => {
    const t = String(acc?.type || '').toLowerCase();
    // Disallow credit card companies for direct city ledger postings by default
    if (t.includes('credit card')) return false;
    // Allow typical direct-bill types
    const allowed = ['corporate','travel agent','group master','wholesale','direct bill','banquet','event'];
    return allowed.some(a => t.includes(a));
  };

  // Initialize form when modal opens; do not overwrite typed values while open
  const initializedRef = React.useRef<boolean>(false);
  useEffect(() => {
    if (isOpen) {
      if (!initializedRef.current) {
        setCustomerName((prev) => prev || bill.customerName || '');
        setRoomNumber((prev) => prev || bill.roomNumber || '');
        initializedRef.current = true;
      }
      try {
        const m = localStorage.getItem('corepms_pos_last_payment_method');
        if (m === 'cash' || m === 'card' || m === 'room-charge' || m === 'city-ledger') {
          setPaymentMethod(m as any);
        }
      } catch {}
      setEmailReceipt('');
      setActivePreTab('none');
      setSplits([]);
      setDestTable('');
      setTransferItemsAll(true);
      setDiscountMode('percent');
      setDiscountValue(0);
      setApprovedBy(undefined);
      setClSearch('');
      setSelectedAccountId(undefined);
    } else {
      initializedRef.current = false;
    }
  }, [isOpen]);

  const selectPaymentMethod = (method: 'cash' | 'card' | 'room-charge' | 'city-ledger') => {
    if (isProcessing) return;
    if (paymentMethod === method) return;
    try {
      const prev = paymentMethod;
      setPaymentMethod(method);
      localStorage.setItem('corepms_pos_last_payment_method', method);
      const logRaw = localStorage.getItem('corepms_pos_payment_logs');
      const list = logRaw ? JSON.parse(logRaw) : [];
      const entry = { billId: bill.id, prev, next: method, at: new Date().toISOString() };
      localStorage.setItem('corepms_pos_payment_logs', JSON.stringify([entry, ...list].slice(0, 200)));
      console.log('[POS] Payment method changed', entry);
    } catch {}
  };

  const mapBrand = () => {
    const b = readReceiptBranding();
    return {
      restaurant_name: b.restaurant_name || 'Company',
      address: b.address || '',
      phone: b.phone || '',
      email: b.email || '',
      tax_rate: Number(b.tax_rate ?? 0),
      show_tax_breakdown: true,
      paper_size: (b.paper_size as any) || '80mm',
      logo_url: b.logo_url || '',
      header_text: b.header_text || '',
      footer_text: b.footer_text || '',
      promotional_message: b.promotional_message || '',
    } as any;
  };
  const [effectiveSettings, setEffectiveSettings] = useState<any>(receiptSettings || mapBrand());
  useEffect(() => {
    const unsub = subscribeReceiptBranding(() => { setEffectiveSettings(receiptSettings || mapBrand()); });
    return () => { try { unsub(); } catch {} };
  }, [receiptSettings]);

  const handlePrintBill = async () => {
    if (!effectiveSettings) return;
    const itemsSafe = Array.isArray(bill.items) ? bill.items : [];
    const sub = itemsSafe.reduce((s, i) => s + Number(i.subtotal || 0), 0)
    let taxLines: Array<{ name: string; amount: number }> = []
    let total = Number(bill.total || 0)
    try {
      const calc = await calculateTaxBreakdown(sub)
      taxLines = calc.lines.map(l => ({ name: l.name, amount: l.amount }))
      total = calc.total
    } catch {}
    const receiptHTML = generateReceiptHTML(
      {
        ...bill,
        items: itemsSafe,
        customerName: customerName || bill.customerName,
        roomNumber: roomNumber || bill.roomNumber,
        total
      },
      effectiveSettings,
      'receipt',
      {
        includeSignature: false,
        showTaxBreakdown: effectiveSettings.show_tax_breakdown,
        serverName: currentUser?.name,
        taxLines,
        subtotalOverride: sub,
        totalOverride: total
      }
    );
    printDocument(receiptHTML, `Bill-${bill.id}`);
  };

  const handlePayment = async () => {
    const nameTrim = (customerName || '').trim();
    const roomTrim = (roomNumber || '').trim();
    if (!validateRoomChargePayment(paymentMethod as any, nameTrim, roomTrim)) {
      alert('Please provide customer name and room number for room charges.');
      return;
    }

    if (paymentMethod === 'city-ledger') {
      if (!selectedAccount) { alert('Select a City Ledger account to post this bill.'); return; }
      if (selectedAccount.status && selectedAccount.status !== 'Active') { alert(`Account status is ${selectedAccount.status}. Cannot post.`); return; }
      const projectedBalance = Number(selectedAccount.balance || 0) + Number(bill.total || 0);
      const limit = Number(selectedAccount.creditLimit || 0);
      if (limit > 0 && projectedBalance > limit) {
        if (!managerOverride || !canManagerOverride) { alert('Posting would exceed credit limit. Select a different account or record a payment.'); return; }
      }
      if (!isAccountTypeAllowedForDept(selectedAccount)) {
        if (!managerOverride || !canManagerOverride) { alert(`Account type '${selectedAccount.type}' is restricted for ${deptHeuristic}. Manager override required.`); return; }
      }
    }

    setIsProcessing(true);

    const discountAmt = discountMode === 'percent' ? Number((bill.total * (discountValue/100)).toFixed(2)) : Number(discountValue.toFixed(2));
    const discountedTotal = Math.max(0, bill.total - (discountValue>0 ? discountAmt : 0));
    if (discountMode === 'percent' && discountValue > 15 && !approvedBy) { alert('Manager approval required for discounts above 15%.'); setIsProcessing(false); return; }

    // Allow zero payment amounts for clearing bills (POS Management)
    if (!validatePaymentAmount(discountedTotal) && discountedTotal !== 0) { alert('Invalid payment amount.'); setIsProcessing(false); return; }

    const paymentData = {
      billId: bill.id,
      amount: discountedTotal,
      paymentMethod,
      customerName: paymentMethod === 'room-charge' ? nameTrim : undefined,
      roomNumber: paymentMethod === 'room-charge' ? roomTrim : undefined,
      cityLedgerAccountId: paymentMethod === 'city-ledger' ? selectedAccount?.id : undefined,
      emailReceipt: emailReceipt || undefined,
      processedBy: currentUser?.name,
      processedAt: new Date().toISOString(),
      items: bill.items,
      meta: {
        splits: splits.length ? splits : undefined,
        discount: discountValue>0 ? { mode: discountMode, value: discountValue, approvedBy } : undefined,
      }
    };

    const processAsync = async () => {
      try {
      if (paymentMethod === 'card') {
        const gw = await processCardPayment({ amount: discountedTotal, currency: 'USD', token: undefined, meta: paymentData.meta });
        if (gw.status === 'declined') {
          logPaymentEvent({ type: 'payment_declined', data: { billId: bill.id, amount: discountedTotal } });
          alert('Card declined. Please try another payment method.');
          return;
        }
        if (gw.status === 'timeout') {
          logPaymentEvent({ type: 'payment_timeout', data: { billId: bill.id, amount: discountedTotal } });
          alert('Payment timeout. Please retry.');
          return;
        }
        paymentData.meta = { ...(paymentData.meta || {}), gatewayAuth: gw.authCode, gatewayRef: gw.reference };
      }
      const result: any = await onPaymentComplete(paymentData);
      if (result && result.ok === false) {
        alert('Payment could not be completed. Please try again.');
        if (paymentMethod === 'room-charge' && result && result.folioChargeId && removeFolioCharge) {
          try { removeFolioCharge(result.folioChargeId); logPaymentEvent({ type: 'rollback', data: { billId: bill.id, folioChargeId: result.folioChargeId } }); } catch {}
        }
        return;
      }
      if (paymentMethod === 'room-charge' && result && result.folioPosted !== true) {
        toast({ title: 'Folio update not confirmed', description: 'Charge posted status could not be verified.', variant: 'destructive' });
      }
      logPaymentEvent({ type: 'payment_success', data: { billId: bill.id, amount: discountedTotal, method: paymentMethod } });
    } catch (error) {
      console.error('Payment processing failed:', error);
      alert('Payment processing failed. Please try again.');
      logPaymentEvent({ type: 'payment_error', data: { billId: bill.id, error: String((error as any)?.message || error) } });
      try {
        const raw = localStorage.getItem('corepms_payment_logs');
        const list = raw ? JSON.parse(raw) : [];
        const recent = list.filter((e: any) => e.type && String(e.type).includes('payment_') && Date.now() - new Date(e.ts).getTime() < 10*60*1000);
        const failures = recent.filter((e: any) => e.type === 'payment_error' || e.type === 'payment_declined' || e.type === 'payment_timeout');
        if (failures.length >= 3) {
          toast({ title: 'Multiple payment failures detected', description: 'Please check gateway/network connectivity.', variant: 'destructive' });
        }
      } catch {}
      return;
    }

    if (paymentMethod === 'city-ledger' && selectedAccount) {
      try {
        addCityLedgerTransaction(selectedAccount.id, {
          date: new Date().toISOString().slice(0,10),
          reference: bill.id,
          description: 'Direct Bill Posting',
          debit: discountedTotal,
        });
        toast({ title: 'Posted to City Ledger', description: `${selectedAccount.name} (${selectedAccount.id}) • ${formatCurrency(discountedTotal)}` });
      } catch (e) {
        console.error('City Ledger post failed', e);
        toast({ title: 'City Ledger posting failed', description: 'Please try again or check account status.', variant: 'destructive' });
      }
    }

    try {
      if (effectiveSettings) {
        const subMain = Array.isArray(bill.items) ? bill.items.reduce((s, i) => s + Number(i.subtotal || 0), 0) : 0
        let taxLinesMain: Array<{ name: string; amount: number }> = []
        let totalMain = Number(bill.total || 0)
        try {
          const calcMain = await calculateTaxBreakdown(subMain)
          taxLinesMain = calcMain.lines.map(l => ({ name: l.name, amount: l.amount }))
          totalMain = calcMain.total
        } catch {}
        const receiptHTML = generateReceiptHTML(
          { ...bill, customerName: paymentMethod === 'room-charge' ? customerName : undefined, roomNumber: paymentMethod === 'room-charge' ? roomNumber : undefined, total: totalMain },
          effectiveSettings,
          paymentMethod === 'room-charge' ? 'folio' : 'receipt',
          { includeSignature: paymentMethod === 'room-charge', showTaxBreakdown: effectiveSettings.show_tax_breakdown, serverName: currentUser?.name, taxLines: taxLinesMain, subtotalOverride: subMain, totalOverride: totalMain }
        );
        printDocument(receiptHTML, `Receipt-${bill.id}`);
        if (splits.length) {
          for (let idx = 0; idx < splits.length; idx++) {
            const s = splits[idx];
            const subSplit = Array.isArray(bill.items) ? bill.items.reduce((sum, i) => sum + Number(i.subtotal || 0), 0) * (s.amount / Number(bill.total || 1)) : s.amount
            let taxLinesSplit: Array<{ name: string; amount: number }> = []
            try {
              const calcSplit = await calculateTaxBreakdown(subSplit)
              taxLinesSplit = calcSplit.lines.map(l => ({ name: l.name, amount: l.amount }))
            } catch {}
            const html = generateReceiptHTML({ ...bill, total: s.amount }, effectiveSettings, 'receipt', { showTaxBreakdown: effectiveSettings.show_tax_breakdown, serverName: currentUser?.name, taxLines: taxLinesSplit, subtotalOverride: subSplit, totalOverride: s.amount });
            printDocument(html, `Split-${idx+1}-${bill.id}`);
          }
        }
        if (emailReceipt && validateEmail(emailReceipt)) {
          const subject = `Receipt ${bill.id} - ${effectiveSettings.restaurant_name}`;
          const itemsSafe = Array.isArray(bill.items) ? bill.items : [];
          const bodyLines = [
            `${effectiveSettings.restaurant_name}`,
            `Bill: ${bill.id}`,
            `Total: ${formatCurrency(discountedTotal)}`,
            '',
            'Items:',
            ...itemsSafe.map(i => `- ${i.name} x${i.quantity} = ${formatCurrency(i.subtotal)}`),
            '',
            'Thank you for your patronage.'
          ];
          sendReceiptEmail(emailReceipt, subject, bodyLines.join('\n'));
        }
      }
    } catch (e) {
      console.warn('Post-processing failed', e as any);
    }

    try {
      const entry = createAuditEntry(
        paymentMethod === 'city-ledger' ? 'CITY_LEDGER_POST' : 'PAYMENT_COMPLETE',
        'BILL',
        bill.id,
        currentUser?.id || 'unknown',
        {
          ...paymentData,
          postingUser: currentUser?.name,
          postingUserId: currentUser?.id,
          workstation: window.location.hostname,
          userAgent: navigator.userAgent,
          department: deptHeuristic,
          managerOverrideApplied: paymentMethod==='city-ledger' ? (managerOverride && canManagerOverride) : false,
        }
      );
      const raw = localStorage.getItem('corepms_pos_audit');
      const list = raw ? JSON.parse(raw) : [];
      localStorage.setItem('corepms_pos_audit', JSON.stringify([entry, ...list].slice(0,500)));
    } catch {}
    }
    // Optimistic UI: close now, process in background
    onClose();
    setTimeout(() => { processAsync() }, 0)
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <Card className="w-full max-w-md mx-4">
        <CardHeader>
          <CardTitle className="text-2xl font-bold bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
            {`Payment${bill.tableId ? ` - Table ${bill.tableId.replace('t','')}` : ''}`}
          </CardTitle>
          <div className="text-sm text-gray-600">
            Bill: {bill.id} | Total: {formatCurrency(bill.total)}
          </div>
        </CardHeader>
        <CardContent className="space-y-4 max-h-[75vh] overflow-y-auto">
          {/* Print Bill for Guest */}
          <div>
            <Button variant="outline" onClick={handlePrintBill} className="w-full transition-all hover:shadow-md">
              Print Bill for Guest
            </Button>
          </div>

          {/* Payment Method Selection */}
          <div>
            <Label>Payment Method</Label>
            <div className="grid grid-cols-4 gap-3 mt-2">
              {(['cash', 'card', 'room-charge', 'city-ledger'] as const).map(method => {
                const base = 'pay-btn ' + (method==='cash' ? 'pay-btn-cash' : method==='card' ? 'pay-btn-card' : method==='room-charge' ? 'pay-btn-room' : 'pay-btn-city');
                const state = paymentMethod === method ? ' pay-btn-active' : ' pay-btn-inactive';
                return (
                  <button
                    key={method}
                    onClick={() => selectPaymentMethod(method)}
                    className={base + state}
                  >
                    {method==='city-ledger' ? 'City Ledger' : method === 'room-charge' ? 'Room Charge' : method.charAt(0).toUpperCase() + method.slice(1)}
                  </button>
                );
              })}
            </div>
          </div>

          {/* City Ledger account selection */}
          {paymentMethod === 'city-ledger' && (
            <div className="space-y-2">
              <Label>City Ledger Account</Label>
              {suggestedAccounts.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-1">
                  {suggestedAccounts.map((a:any) => (
                    <button key={a.id} className="px-2 py-1 text-xs rounded border hover:bg-gray-100" onClick={()=> setSelectedAccountId(a.id)} title={`Balance ${formatCurrency(Number(a.balance||0))} / Limit ${formatCurrency(Number(a.creditLimit||0))}`}>
                      {a.name} • {a.id}
                    </button>
                  ))}
                </div>
              )}
              <Input placeholder="Search account by name or ID" value={clSearch} onChange={(e)=> setClSearch(e.target.value)} />
              <Select value={selectedAccountId} onValueChange={(v)=> setSelectedAccountId(v)}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Select account"/></SelectTrigger>
                <SelectContent>
                  {filteredAccounts.map((a: any) => {
                    const bal = Number(a.balance||0);
                    const lim = Number(a.creditLimit||0);
                    const projected = bal + Number(bill.total||0);
                    const warn = lim>0 && projected>lim;
                    const label = `${a.name} — ${a.id} ${lim>0 ? `(${formatCurrency(bal)} / Limit ${formatCurrency(lim)})` : `(${formatCurrency(bal)})`}${warn?' ⚠️':''}`;
                    return (<SelectItem key={a.id} value={a.id}>{label}</SelectItem>);
                  })}
                </SelectContent>
              </Select>
              {selectedAccount && (
                <div className="grid grid-cols-3 gap-2 text-sm bg-gray-50 rounded p-2">
                  <div><span className="text-gray-600">Account #</span><br/><span className="font-medium">{selectedAccount.id}</span></div>
                  <div><span className="text-gray-600">Name</span><br/><span className="font-medium">{selectedAccount.name}</span></div>
                  <div><span className="text-gray-600">Balance</span><br/><span className="font-medium">{formatCurrency(Number(selectedAccount.balance||0))}</span></div>
                  {Number(selectedAccount.creditLimit||0)>0 && (
                    <div className="col-span-3 text-xs text-gray-700">Credit Limit: {formatCurrency(Number(selectedAccount.creditLimit||0))} • After Posting: {formatCurrency(Number(selectedAccount.balance||0)+Number(bill.total||0))} { (Number(selectedAccount.creditLimit||0)>0 && (Number(selectedAccount.balance||0)+Number(bill.total||0) > Number(selectedAccount.creditLimit||0))) ? '• ⚠️ Exceeds limit' : '' }</div>
                  )}
                </div>
              )}
              {!selectedAccount && (<div className="text-xs text-gray-600">Select an account to enable posting.</div>)}
              <div className="flex items-center gap-2 mt-2">
                <input type="checkbox" id="managerOverride" checked={managerOverride} onChange={(e)=> setManagerOverride(e.target.checked)} disabled={!canManagerOverride} />
                <Label htmlFor="managerOverride">Manager override</Label>
                {!canManagerOverride && (<span className="text-xs text-gray-500">(Manager/Admin required)</span>)}
              </div>
              <div className="text-xs text-gray-600">Dept: {deptHeuristic}</div>
              <div className="mt-2">
                <Button
                  variant="outline"
                  disabled={!selectedAccount || !canManagerOverride || !managerOverride}
                  onClick={() => {
                    if (!selectedAccount) return;
                    if (!canManagerOverride || !managerOverride) { alert('Manager authorization required to reprint.'); return; }
                    try {
                      const txns = (bill.items || []).map(it => ({ date: new Date().toISOString().slice(0,10), description: it.name, debit: Number(it.subtotal || (it.price*it.quantity) || 0) }));
                      const receiptNo = `CL-${bill.id}`;
                      const taxRate = receiptSettings?.tax_rate;
                      const html = generateCityLedgerReceiptHTML({ id: selectedAccount.id, name: selectedAccount.name }, receiptNo, txns, taxRate);
                      printDocument(html, `CityLedgerReceipt-${selectedAccount.id}`);
                    } catch (e) {
                      console.error('Reprint posting receipt failed', e);
                      alert('Failed to generate receipt.');
                    }
                  }}
                  className="w-full"
                >
                  Print Receipt for this Posting (Manager)
                </Button>
              </div>
            </div>
          )}

          {/* Room Charge Fields */}
          {paymentMethod === 'room-charge' && (
            <>
              <div>
                <Label htmlFor="customerName">Guest Name *</Label>
                <Input
                  id="customerName"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Enter guest name"
                  required
                  className="mt-1 border-2 focus:border-purple-600"
                />
              </div>
              <div>
                <Label htmlFor="roomNumber">Room Number *</Label>
                <Input
                  id="roomNumber"
                  value={roomNumber}
                  onChange={(e) => {
                    const v = e.target.value;
                    setRoomNumber(v);
                    try {
                      const logRaw = localStorage.getItem('corepms_pos_payment_logs');
                      const list = logRaw ? JSON.parse(logRaw) : [];
                      const entry = { billId: bill.id, field: 'roomNumber', value: v, at: new Date().toISOString() };
                      localStorage.setItem('corepms_pos_payment_logs', JSON.stringify([entry, ...list].slice(0, 200)));
                    } catch {}
                  }}
                  placeholder="Enter room number"
                  required
                  className="mt-1 border-2 focus:border-purple-600"
                />
              </div>
            </>
          )}

          {/* Email Receipt */}
          <div>
            <Label htmlFor="emailReceipt">Email Receipt (Optional)</Label>
            <Input
              id="emailReceipt"
              type="email"
              value={emailReceipt}
              onChange={(e) => setEmailReceipt(e.target.value)}
              placeholder="customer@email.com"
              className="mt-1 border-2 focus:border-purple-600"
            />
          </div>

          {/* Pre-Payment Tabs */}
          <div>
            <Label>Pre-Payment Options</Label>
            <Tabs value={activePreTab} onValueChange={(v)=> setActivePreTab(v as any)}>
              <TabsList className="mt-1">
                <TabsTrigger value="none">None</TabsTrigger>
                <TabsTrigger value="split">Split Bill</TabsTrigger>
                <TabsTrigger value="transfer">Transfer</TabsTrigger>
                <TabsTrigger value="discount">Apply Discount</TabsTrigger>
                <TabsTrigger value="void">Void Transaction</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {activePreTab === 'split' && (
            <div className="preopt preopt-split space-y-2">
              <div className="text-xs text-gray-600">Specify amounts or percentages for each split. Ensure total equals {formatCurrency(bill.total)}.</div>
              <div className="ds-toolbar">
                <Button variant="outline" onClick={()=> setSplits(s=> [...s, { label: `Split ${s.length+1}`, amount: Number((bill.total/(s.length+1)).toFixed(2)) }])}>Add Split</Button>
                <Button variant="outline" onClick={()=> setSplits([])}>Clear Splits</Button>
              </div>
              <div className="space-y-2">
                {splits.map((s, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <Input className="ds-control" value={s.label} onChange={(e)=> setSplits(prev => prev.map((x,i)=> i===idx? { ...x, label: e.target.value }: x))} />
                    <Input className="ds-control" type="number" step="0.01" value={s.amount} onChange={(e)=> setSplits(prev => prev.map((x,i)=> i===idx? { ...x, amount: Number(e.target.value) }: x))} />
                  </div>
                ))}
              </div>
              <div className="text-xs">Sum: {formatCurrency(splits.reduce((t,s)=> t+s.amount, 0))}</div>
              <div className="ds-toolbar">
                <Button variant="outline" onClick={()=>{
                  const sum = splits.reduce((t,s)=> t+s.amount, 0);
                  if (Number(sum.toFixed(2)) !== Number(bill.total.toFixed(2))) { alert('Split total must equal bill total.'); return; }
                  try {
                    const entry = createAuditEntry('SPLIT_BILL', 'BILL', bill.id, currentUser?.id || 'unknown', { splits });
                    const raw = localStorage.getItem('corepms_pos_audit'); const list = raw ? JSON.parse(raw) : [];
                    localStorage.setItem('corepms_pos_audit', JSON.stringify([entry, ...list].slice(0,500)));
                  } catch {}
                  // Print receipts for splits handled in handlePayment as well
                  alert('Split prepared. Proceed to payment or print using Process Payment.');
                }}>Prepare Split</Button>
              </div>
            </div>
          )}

          {activePreTab === 'transfer' && (
            <div className="preopt preopt-transfer space-y-2">
              <div className="text-xs text-gray-600">Move entire bill or selected items to another table.</div>
              <div className="ds-toolbar">
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={transferItemsAll} onChange={(e)=> setTransferItemsAll(e.target.checked)} /> Transfer all items</label>
                <Input className="ds-control" placeholder="Destination table (e.g., t5)" value={destTable} onChange={(e)=> setDestTable(e.target.value)} />
                <Button variant="outline" onClick={()=>{
                  if (!destTable) { alert('Enter destination table id (e.g., t5)'); return; }
                  try {
                    const req = { from: bill.tableId, to: destTable, billId: bill.id, items: transferItemsAll ? 'all' : 'selected', at: new Date().toISOString() };
                    const raw = localStorage.getItem('corepms_pos_transfers'); const list = raw ? JSON.parse(raw) : [];
                    localStorage.setItem('corepms_pos_transfers', JSON.stringify([req, ...list].slice(0,200)));
                    const entry = createAuditEntry('TRANSFER_REQUEST', 'TABLE', bill.tableId || 'unknown', currentUser?.id || 'unknown', req);
                    const aRaw = localStorage.getItem('corepms_pos_audit'); const aList = aRaw ? JSON.parse(aRaw) : [];
                    localStorage.setItem('corepms_pos_audit', JSON.stringify([entry, ...aList].slice(0,500)));
                    window.dispatchEvent(new CustomEvent('pos:transfer', { detail: req }));
                    alert('Transfer requested. Other terminals will update in real time.');
                  } catch {}
                }}>Request Transfer</Button>
              </div>
            </div>
          )}

          {activePreTab === 'discount' && (
            <div className="preopt preopt-discount space-y-2">
              <div className="ds-toolbar">
                <label className="flex items-center gap-2 text-sm"><input type="radio" checked={discountMode==='percent'} onChange={()=> setDiscountMode('percent')} /> % Percent</label>
                <label className="flex items-center gap-2 text-sm"><input type="radio" checked={discountMode==='amount'} onChange={()=> setDiscountMode('amount')} /> $ Amount</label>
                <Input className="ds-control" type="number" step="0.01" value={discountValue} onChange={(e)=> setDiscountValue(Number(e.target.value)||0)} />
              </div>
              {discountMode==='percent' && discountValue>15 && (
                <div className="text-xs text-red-700">Discount above 15% requires manager approval.</div>
              )}
              <div className="ds-toolbar">
                <Input className="ds-control" placeholder="Manager approval name (if required)" value={approvedBy || ''} onChange={(e)=> setApprovedBy(e.target.value||undefined)} />
                <div className="text-sm">New total: {formatCurrency(discountMode==='percent' ? Math.max(0, bill.total - (bill.total*(discountValue/100))) : Math.max(0, bill.total - discountValue))}</div>
              </div>
            </div>
          )}

          {activePreTab === 'void' && (
            <div className="preopt preopt-void space-y-3">
              <div className="text-sm font-medium">Select scope</div>
              <div className="ds-toolbar">
                <label className="flex items-center gap-2 text-sm"><input type="radio" checked={voidMode==='item'} onChange={()=> setVoidMode('item')} /> Single Item</label>
                <label className="flex items-center gap-2 text-sm"><input type="radio" checked={voidMode==='bill'} onChange={()=> setVoidMode('bill')} /> Entire Bill</label>
              </div>
              {voidMode==='item' && (
                <div className="space-y-2">
                  <div className="text-xs text-gray-600">Click an item to mark for void</div>
                  <div className="space-y-1">
                    {(bill.items||[]).map((item, idx) => (
                      <button
                        key={idx}
                        onClick={()=> setSelectedVoidIndex(idx)}
                        className={`w-full text-left px-3 py-2 rounded border ${selectedVoidIndex===idx ? 'border-red-600 bg-red-50' : 'border-transparent hover:bg-muted/50'}`}
                        aria-label={`Select ${item.name} x${item.quantity} for void`}
                      >
                        <div className="flex justify-between">
                          <span className="font-medium">{item.name} x{item.quantity}</span>
                          <span>{formatCurrency(item.subtotal)}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                  <div className="ds-toolbar">
                    <Button
                      variant="destructive"
                      className="bg-red-600 text-white hover:bg-red-700"
                      disabled={selectedVoidIndex<0}
                      onClick={()=> setConfirmVoidOpen(true)}
                    >
                      Void Selected Item
                    </Button>
                  </div>
                </div>
              )}
              {voidMode==='bill' && (
                <div className="space-y-2">
                  <div className="text-xs text-gray-700">Review full transaction before void</div>
                  <div className="rounded border">
                    <div className="p-3 space-y-1 text-sm">
                      {(bill.items||[]).map((item, idx) => (
                        <div key={idx} className="flex justify-between">
                          <span>{item.name} x{item.quantity}</span>
                          <span>{formatCurrency(item.subtotal)}</span>
                        </div>
                      ))}
                      <div className="border-t pt-2 font-semibold flex justify-between">
                        <span>Total:</span>
                        <span>{formatCurrency(bill.total)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="ds-toolbar">
                    <Button
                      variant="destructive"
                      className="bg-yellow-500 text-white hover:bg-yellow-600"
                      onClick={()=> setConfirmVoidOpen(true)}
                    >
                      Void Entire Bill
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

           {/* Bill Summary */}
           <div className="border-t pt-4">
             <div className="text-sm space-y-1">
               {bill.items.map((item, index) => (
                 <div key={index} className="flex justify-between">
                   <span>{item.name} x{item.quantity}</span>
                   <span>
                     {formatCurrency(Number.isNaN(Number(item.subtotal)) ? 0 : Number(item.subtotal))}
                     <br />
                     <span className="text-xs text-gray-500">
                       @ {formatCurrency(Number.isNaN(Number(item.price)) ? 0 : Number(item.price))}
                     </span>
                   </span>
                 </div>
               ))}
               <div className="border-t pt-2 font-semibold flex justify-between">
                 <span>Total:</span>
                 <span>{formatCurrency(Number.isNaN(Number(discountMode==='percent' ? Math.max(0, bill.total - (bill.total*(discountValue/100))) : Math.max(0, bill.total - discountValue))) ? 0 : Number(discountMode==='percent' ? Math.max(0, bill.total - (bill.total*(discountValue/100))) : Math.max(0, bill.total - discountValue))}</span>
               </div>
             </div>
           </div>

          {/* Action Buttons */}
          <div className="flex gap-2 pt-4">
            <Button
              variant="outline"
              onClick={onClose}
              className="flex-1 transition-all hover:shadow-md"
              disabled={isProcessing}
            >
              Cancel
            </Button>
            <Button
              onClick={handlePayment}
              className="flex-1 transition-all hover:shadow-md"
              disabled={isProcessing}
            >
              {isProcessing ? 'Processing...' : 'Process Payment'}
            </Button>
          </div>

          <Dialog open={confirmVoidOpen} onOpenChange={(v)=> setConfirmVoidOpen(v)}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Confirm Void</DialogTitle>
                <DialogDescription>
                  {voidMode==='item' ? 'You are about to void the selected item. This action requires authorization.' : 'You are about to void the entire bill. This action requires authorization.'}
                </DialogDescription>
              </DialogHeader>
              <div className="text-sm">
                 {voidMode==='item' && selectedVoidIndex>=0 && (
                   <div className="flex justify-between p-2 rounded bg-red-50 border border-red-200">
                     <span>{bill.items[selectedVoidIndex].name} x{bill.items[selectedVoidIndex].quantity}</span>
                     <span>{formatCurrency(Number.isNaN(Number(bill.items[selectedVoidIndex].subtotal)) ? 0 : Number(bill.items[selectedVoidIndex].subtotal))}</span>
                   </div>
                 )}
                {voidMode==='bill' && (
                  <div className="mt-2 text-xs text-gray-700">Bill: {bill.id} • Items: {(bill.items||[]).length} • Total: {formatCurrency(bill.total)}</div>
                )}
                <div className="mt-3">
                  <Label>Reason</Label>
                  <Select value={voidReason} onValueChange={(v)=> setVoidReason(v)}>
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Select a reason" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="error_entered">Error entered</SelectItem>
                      <SelectItem value="customer_returned">Customer returned</SelectItem>
                      <SelectItem value="payment_reversal">Payment reversal</SelectItem>
                      <SelectItem value="duplicate_charge">Duplicate charge</SelectItem>
                      <SelectItem value="fraud_suspected">Fraud suspected</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={()=> setConfirmVoidOpen(false)}>Cancel</Button>
                <Button className="bg-red-600 text-white hover:bg-red-700" onClick={()=> { if (!voidReason) { setPinError('Select a reason'); return; } setConfirmVoidOpen(false); setPinModalOpen(true); setPinError(''); setPinCode(''); setFailedAttempts(0); setLocked(false); if (timeoutId) clearTimeout(timeoutId); const id = setTimeout(()=> { setPinModalOpen(false); }, 120000); setTimeoutId(id); }}>Continue</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={pinModalOpen} onOpenChange={(v)=> { setPinModalOpen(v); if (!v && timeoutId) { clearTimeout(timeoutId); setTimeoutId(null); } }}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Authorization Required</DialogTitle>
                <DialogDescription>Enter a 6-digit manager PIN to proceed.</DialogDescription>
              </DialogHeader>
              <div className="space-y-2" aria-live="polite">
                <div className="flex items-center gap-2"><Button variant={pinRole==='manager' ? 'default' : 'outline'} onClick={()=> setPinRole('manager')}>Manager on Duty PIN</Button></div>
                <Label>Manager ID</Label>
                <Input value={managerIdInput} onChange={(e)=> setManagerIdInput(e.target.value)} placeholder="e.g., MGR-001" />
                <Label>PIN Code</Label>
                <Input
                  type="password"
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  value={pinCode}
                  onChange={(e)=> { setPinCode(e.target.value.replace(/[^0-9]/g,'')); setPinError(''); if (timeoutId) { clearTimeout(timeoutId); const id = setTimeout(()=> setPinModalOpen(false), 120000); setTimeoutId(id); } }}
                  placeholder="Enter 6 digits"
                  aria-label="Authorization PIN"
                />
                {pinError && (<div className="text-sm text-red-600" role="alert">{pinError}</div>)}
                {locked && (<div className="text-sm text-red-700" role="alert">Locked after 3 failed attempts. Close and retry later.</div>)}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={()=> setPinModalOpen(false)} disabled={pinBusy}>Cancel</Button>
                <Button onClick={async ()=> {
                  if (locked) return;
                  if (!pinRole) { setPinError('Select authorization level'); return; }
                  if (!managerIdInput.trim()) { setPinError('Enter manager ID'); return; }
                  if (!voidReason) { setPinError('Select a reason'); return; }
                  if (!/^\d{6}$/.test(pinCode)) { setPinError('Enter a valid 6-digit PIN'); return; }
                  setPinBusy(true); setPinError('');
                  try {
                    const configured = await db.isConfigured();
                    if (!configured) { setPinError('Authorization service unavailable'); setPinBusy(false); return; }
                    const res = await db.query<{ role: string; staff_id?: string }>(`SELECT role, staff_id FROM staff_pins WHERE pin_code = ? LIMIT 1`, [pinCode]);
                    if ('error' in res || !res.rows || res.rows.length === 0) {
                      const alt = await db.query<{ role: string; staff_id?: string }>(`SELECT role, staff_id FROM pos_pins WHERE pin_code = ? LIMIT 1`, [pinCode]);
                      let ok = false; let r = '';
                      let sid = '';
                      if (!('error' in alt) && alt.rows && alt.rows[0]) { ok = true; r = String(alt.rows[0].role||''); sid = String(alt.rows[0].staff_id||''); }
                      if (!ok) {
                        const row = await db.query<{ role: string; pin_hash: string; salt: string; scope: string; staff_id?: string }>(`SELECT role, pin_hash, salt, scope, staff_id FROM pos_pins WHERE role = ? AND scope = 'void' ORDER BY updated_at DESC LIMIT 1`, [pinRole]);
                        if (!('error' in row) && row.rows && row.rows[0]) {
                          const rec = row.rows[0]; const h = await hashPin(pinCode, String(rec.salt||'')); if (h && h === String(rec.pin_hash||'')) { ok = true; r = String(rec.role||''); sid = String(rec.staff_id||''); }
                        }
                      }
                      if (!ok) { throw new Error('INVALID_PIN'); }
                      if (r.toLowerCase()!=='manager') { throw new Error('UNAUTHORIZED_LEVEL'); }
                      if (sid && managerIdInput && sid !== managerIdInput) { throw new Error('MISMATCH_MANAGER_ID'); }
                    } else {
                      const r = String(res.rows[0].role||'');
                      const sid = String(res.rows[0].staff_id||'');
                      if (r.toLowerCase()!=='manager') { throw new Error('UNAUTHORIZED_LEVEL'); }
                      if (sid && managerIdInput && sid !== managerIdInput) { throw new Error('MISMATCH_MANAGER_ID'); }
                    }
                    setPinBusy(false); setPinModalOpen(false);
                    if (timeoutId) { clearTimeout(timeoutId); setTimeoutId(null); }
                    const detail = { mode: voidMode, billId: bill.id, itemIndex: selectedVoidIndex, total: bill.total, at: new Date().toISOString(), reason: voidReason, managerId: managerIdInput };
                    try {
                      const rawReg = localStorage.getItem('corepms_void_registry'); const reg = rawReg ? JSON.parse(rawReg) : [];
                      const dup = reg.find((r: any)=> r.billId===bill.id && (Date.now() - new Date(r.at).getTime()) < 24*60*60*1000);
                      if (dup) { throw new Error('DUPLICATE_VOID'); }
                    } catch (e) { const code = String((e as any)?.message||e); if (code==='DUPLICATE_VOID') { setPinError('Duplicate void detected'); return; } }
                    try {
                      const entry = createAuditEntry(voidMode==='item'?'VOID_ITEM':'VOID_BILL', 'BILL', bill.id, currentUser?.id || 'unknown', { ...detail, auth: pinRole });
                      const raw = localStorage.getItem('corepms_pos_audit'); const list = raw ? JSON.parse(raw) : [];
                      localStorage.setItem('corepms_pos_audit', JSON.stringify([entry, ...list].slice(0,500)));
                      await db.query(`INSERT INTO audit_log (event, user_id, level, detail, ts) VALUES (?, ?, ?, ?, now())`, [voidMode==='item'?'VOID_ITEM':'VOID_BILL', currentUser?.id || 'unknown', pinRole, JSON.stringify(detail)]).catch(()=>{});
                      const regItem = { billId: bill.id, at: new Date().toISOString(), managerId: managerIdInput, reason: voidReason, total: bill.total, items: (bill.items||[]) };
                      const rawReg = localStorage.getItem('corepms_void_registry'); const reg = rawReg ? JSON.parse(rawReg) : [];
                      localStorage.setItem('corepms_void_registry', JSON.stringify([regItem, ...reg].slice(0,500)));
                    } catch {}
                    try {
                      const brand = (await import('@/lib/printSettings')).readReceiptBranding();
                      const printHTML = generateReceiptHTML({ id: bill.id, items: bill.items as any, total: bill.total, customerName: bill.customerName, roomNumber: bill.roomNumber, tableId: bill.tableId }, { ...brand, header_text: 'Void Confirmation' }, 'confirmation', { includeSignature: false, showTaxBreakdown: !!brand.show_tax_breakdown, serverName: currentUser?.name });
                      printDocument(printHTML, `Void-${bill.id}`);
                    } catch {}
                    if (voidMode==='item' && selectedVoidIndex>=0) {
                      const idx = selectedVoidIndex;
                      const nextItems = (bill.items||[]).filter((_,i)=> i!==idx);
                      const nextTotal = Math.max(0, nextItems.reduce((t, it)=> t + Number(it.subtotal||0), 0));
                      const nextBill = { ...bill, items: nextItems, total: nextTotal } as any;
                      try { onPaymentComplete({ type: 'void_item', bill: nextBill }); } catch {}
                    } else {
                      try { onPaymentComplete({ type: 'void_bill', bill }); } catch {}
                      onClose();
                    }
                  } catch (e: any) {
                    setPinBusy(false);
                    const code = String(e?.message || e);
                    if (code==='INVALID_PIN') setPinError('Invalid PIN');
                    else if (code==='UNAUTHORIZED_LEVEL') setPinError('PIN does not match required authorization level');
                    else if (code==='MISMATCH_MANAGER_ID') setPinError('Manager ID does not match PIN');
                    else if (code==='DUPLICATE_VOID') setPinError('Duplicate void detected');
                    else setPinError('Authorization failed');
                    const next = failedAttempts + 1; setFailedAttempts(next); if (next>=3) setLocked(true);
                  }
                }} disabled={pinBusy || locked} className="bg-red-600 text-white hover:bg-red-700">{pinBusy ? 'Authorizing…' : 'Authorize'}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================================
// TABLE/ROOM CARD COMPONENT
// ============================================================================

interface EntityCardProps {
  /** Entity data (table, room, etc.) */
  entity: {
    id: string;
    name: string;
    status: 'available' | 'occupied' | 'cleaning' | 'maintenance' | 'reserved';
    currentBill?: {
      total: number;
      itemCount: number;
    };
    guestName?: string;
    checkIn?: string;
    checkOut?: string;
  };
  /** Function called when entity is clicked */
  onClick: (entityId: string) => void;
  /** Type of entity for display purposes */
  entityType?: 'table' | 'room';
}

/**
 * Entity Card Component
 * 
 * Displays table/room status with visual indicators for:
 * - Availability status
 * - Current charges/bills
 * - Guest information
 * - Check-in/out times
 * 
 * Integration Notes:
 * - Use for room status display in PMS
 * - Adapt for different entity types (rooms, tables, etc.)
 * - Customize status colors and labels for hotel operations
 * - Add housekeeping status integration
 */
export const EntityCard: React.FC<EntityCardProps> = ({
  entity,
  onClick,
  entityType = 'table'
}) => {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'available': return 'bg-green-100 text-green-800 border-green-200';
      case 'occupied': return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'cleaning': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'maintenance': return 'bg-red-100 text-red-800 border-red-200';
      case 'reserved': return 'bg-purple-100 text-purple-800 border-purple-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'available': return entityType === 'room' ? 'Available' : 'Open';
      case 'occupied': return entityType === 'room' ? 'Occupied' : 'In Use';
      case 'cleaning': return 'Cleaning';
      case 'maintenance': return 'Maintenance';
      case 'reserved': return 'Reserved';
      default: return status;
    }
  };

  return (
    <Card 
      className={`cursor-pointer transition-all hover:shadow-md ${getStatusColor(entity.status)} border-2`}
      onClick={() => onClick(entity.id)}
    >
      <CardContent className="p-4">
        <div className="flex justify-between items-start mb-2">
          <div>
            <h3 className="font-semibold text-lg">{entity.name}</h3>
            <Badge variant="secondary" className="text-xs">
              {getStatusLabel(entity.status)}
            </Badge>
          </div>
          {entity.currentBill && (
            <div className="text-right text-sm">
              <div className="font-semibold">{formatCurrency(entity.currentBill.total)}</div>
              <div className="text-gray-600">{entity.currentBill.itemCount} items</div>
            </div>
          )}
        </div>

        {/* Guest Information for Rooms */}
        {entityType === 'room' && entity.guestName && (
          <div className="text-sm space-y-1">
            <div className="font-medium">{entity.guestName}</div>
            {entity.checkIn && (
              <div className="text-gray-600">
                In: {formatReceiptDate(new Date(entity.checkIn), false)}
              </div>
            )}
            {entity.checkOut && (
              <div className="text-gray-600">
                Out: {formatReceiptDate(new Date(entity.checkOut), false)}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

// ============================================================================
// BILL/FOLIO SUMMARY COMPONENT
// ============================================================================

interface BillSummaryProps {
  /** Bill/folio data */
  bill: {
    id: string;
    items: Array<{
      name: string;
      quantity: number;
      price: number;
      subtotal: number;
      category?: string;
    }>;
    subtotal: number;
    tax: number;
    total: number;
    createdAt: string;
    customerName?: string;
    roomNumber?: string;
  };
  /** Whether to show detailed breakdown */
  showDetails?: boolean;
  /** Function to handle item removal */
  onRemoveItem?: (itemIndex: number) => void;
  /** Whether items can be edited */
  editable?: boolean;
}

/**
 * Bill/Folio Summary Component
 * 
 * Displays itemized bill/folio with:
 * - Line items with quantities and prices
 * - Tax breakdown
 * - Total calculations
 * - Optional editing capabilities
 * 
 * Integration Notes:
 * - Use for folio display in PMS
 * - Adapt for different charge types (room, F&B, misc)
 * - Add category grouping for better organization
 * - Integrate with charge posting system
 */
export const BillSummary: React.FC<BillSummaryProps> = ({
  bill,
  showDetails = true,
  onRemoveItem,
  editable = false
}) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex justify-between items-center">
          <span>Bill Summary</span>
          <span className="text-sm font-normal text-gray-600">
            {formatReceiptDate(new Date(bill.createdAt))}
          </span>
        </CardTitle>
        {(bill.customerName || bill.roomNumber) && (
          <div className="text-sm text-gray-600">
            {bill.customerName && <div>Guest: {bill.customerName}</div>}
            {bill.roomNumber && <div>Room: {bill.roomNumber}</div>}
          </div>
        )}
      </CardHeader>
      <CardContent>
        {showDetails && (
          <div className="space-y-2 mb-4">
            {bill.items.map((item, index) => (
              <div key={index} className="flex justify-between items-center py-2 border-b">
                <div className="flex-1">
                  <div className="font-medium">{item.name}</div>
                  {('preparation_level' in item || 'manual_notes' in item) && (
                    <div className="text-xs italic text-gray-500">
                      {String((item as any).preparation_level || '')}{(item as any).preparation_level && (item as any).manual_notes ? ' • ' : ''}{String((item as any).manual_notes || '')}
                    </div>
                  )}
                  {item.category && (
                    <div className="text-xs text-gray-500">{item.category}</div>
                  )}
                </div>
                <div className="text-center px-4">
                  <span className="text-sm">x{item.quantity}</span>
                </div>
                <div className="text-right">
                  <div>{formatCurrency(item.subtotal)}</div>
                  <div className="text-xs text-gray-500">
                    @ {formatCurrency(item.price)}
                  </div>
                </div>
                {editable && onRemoveItem && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onRemoveItem(index)}
                    className="ml-2 text-red-600 hover:text-red-800"
                  >
                    ×
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}

         {/* Totals */}
         <div className="space-y-2 pt-4 border-t">
           <div className="flex justify-between">
             <span>Subtotal:</span>
             <span>{formatCurrency(Number.isNaN(Number(bill.subtotal)) ? 0 : Number(bill.subtotal))}</span>
           </div>
           <div className="flex justify-between">
             <span>Tax:</span>
             <span>{formatCurrency(Number.isNaN(Number(bill.tax)) ? 0 : Number(bill.tax))}</span>
           </div>
           <div className="flex justify-between font-semibold text-lg">
             <span>Total:</span>
             <span>{formatCurrency(Number.isNaN(Number(bill.total)) ? 0 : Number(bill.total))}</span>
           </div>
         </div>
      </CardContent>
    </Card>
  );
};

// ============================================================================
// QUICK ACTIONS COMPONENT
// ============================================================================

interface QuickActionsProps {
  /** Available actions */
  actions: Array<{
    id: string;
    label: string;
    icon?: React.ReactNode;
    color?: 'default' | 'destructive' | 'outline' | 'secondary';
    onClick: () => void;
    disabled?: boolean;
  }>;
  /** Layout orientation */
  orientation?: 'horizontal' | 'vertical';
}

/**
 * Quick Actions Component
 * 
 * Provides quick access buttons for common operations:
 * - Payment processing
 * - Receipt printing
 * - Order modifications
 * - Status updates
 * 
 * Integration Notes:
 * - Use for folio operations (post charge, print, etc.)
 * - Adapt for room operations (check-in, check-out, etc.)
 * - Customize actions based on user permissions
 * - Add confirmation dialogs for destructive actions
 */
export const QuickActions: React.FC<QuickActionsProps> = ({
  actions,
  orientation = 'horizontal'
}) => {
  const containerClass = orientation === 'horizontal' 
    ? 'flex gap-2 flex-wrap' 
    : 'flex flex-col gap-2';

  return (
    <div className={containerClass}>
      {actions.map((action) => (
        <Button
          key={action.id}
          variant={action.color || 'default'}
          onClick={action.onClick}
          disabled={action.disabled}
          className="flex items-center gap-2"
        >
          {action.icon}
          {action.label}
        </Button>
      ))}
    </div>
  );
};

// ============================================================================
// EXPORT ALL COMPONENTS
// ============================================================================

export default {
  PaymentModal,
  EntityCard,
  BillSummary,
  QuickActions
};
