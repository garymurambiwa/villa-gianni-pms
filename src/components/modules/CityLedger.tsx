import React, { useState } from 'react';
import BackToAccountingButton from '@/components/modules/common/BackToAccountingButton';
import { useData } from '../../context/DataContext';
import { downloadBlob } from '../../lib/documentUtils';
import { useAuth } from '../../context/AuthContext';
import { printDocument, generateCityLedgerReceiptHTML } from '../../lib/posIntegration';
import { usePagination } from '@/hooks/usePagination';
import PaginationBar from '@/components/shared/PaginationBar';
import { HOTEL_NAME } from '../../lib/brand';

export const CityLedger: React.FC = () => {
  const { 
    cityLedger, guests, reservations, addCityLedgerAccount, updateCityLedgerAccount, 
    addCityLedgerTransaction, addCityLedgerNote, deleteCityLedgerTransaction, voidCityLedgerTransaction,
    transferCityLedgerToGuest 
  } = useData();
  const { user } = useAuth();
  const canExport = !!user && (user.role === 'admin' || user.role === 'auditor');
  const [showNewForm, setShowNewForm] = useState(false);
  const [newAccName, setNewAccName] = useState('');
  const [newAccType, setNewAccType] = useState('Corporate');
  const [newAccCreditLimit, setNewAccCreditLimit] = useState('');
  const [newAccPaymentTerms, setNewAccPaymentTerms] = useState('Net 30');
  const [newAccTaxId, setNewAccTaxId] = useState('');
  const [newAccBillingEmail, setNewAccBillingEmail] = useState('');
  // Transaction form state
  const [activeTxnAccount, setActiveTxnAccount] = useState<string | null>(null);
  const [txnType, setTxnType] = useState<'debit' | 'credit'>('debit');
  const [txnForm, setTxnForm] = useState<{ date: string; reference: string; description: string; amount: string }>({
    date: new Date().toISOString().slice(0, 10),
    reference: '',
    description: '',
    amount: ''
  });
  // Notes form state
  const [activeNoteAccount, setActiveNoteAccount] = useState<string | null>(null);
  const [noteText, setNoteText] = useState<string>('');
  // Edit account details state
  const [editAccountId, setEditAccountId] = useState<string | null>(null);
  const [detailsForm, setDetailsForm] = useState({
    status: 'Active',
    contactName: '',
    contactPhone: '',
    contactEmail: '',
    address: '',
    billingCycle: 'Monthly',
    paymentTerms: '',
    creditLimit: ''
  });
  // Transfer State
  const [transferTxn, setTransferTxn] = useState<{accountId: string, txnId: string} | null>(null);
  const [targetGuestId, setTargetGuestId] = useState<string>('');
  const [targetType, setTargetType] = useState<'guest' | 'account'>('guest');
  const [closeAccountAfterTransfer, setCloseAccountAfterTransfer] = useState(false);
  // Collapsible accounts state
  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(new Set());

  // Pagination for the main accounts list and the AR Aging Report table
  const accountsPg = usePagination<any>(cityLedger || []);
  const agingPg = usePagination<any>(cityLedger || []);

  const resetTxnForm = () => setTxnForm({ date: new Date().toISOString().slice(0, 10), reference: '', description: '', amount: '' });
  const computeAging = (account: any) => {
    if (!account) return { current: 0, d30: 0, d60: 0, d90: 0, total: 0 };
    // If no transactions, treat entire balance as current
    if (!account.transactions || account.transactions.length === 0) {
      const bal = Number(account.balance || 0);
      return { current: bal, d30: 0, d60: 0, d90: 0, total: bal };
    }

    // Build charges (debits) and payments (credits)
    type Entry = { date: string; amount: number };
    const charges: Entry[] = account.transactions
      .filter((t: any) => t.debit && t.debit > 0)
      .map((t: any) => ({ date: t.date, amount: Number(t.debit) }))
      .sort((a: Entry, b: Entry) => new Date(a.date).getTime() - new Date(b.date).getTime());

    const payments: Entry[] = account.transactions
      .filter((t: any) => t.credit && t.credit > 0)
      .map((t: any) => ({ date: t.date, amount: Number(t.credit) }))
      .sort((a: Entry, b: Entry) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // Apply payments FIFO against earliest charges
    let ci = 0; // charge index
    for (const p of payments) {
      let remaining = p.amount;
      while (remaining > 0 && ci < charges.length) {
        const apply = Math.min(remaining, charges[ci].amount);
        charges[ci].amount -= apply;
        remaining -= apply;
        if (charges[ci].amount <= 0) ci++;
      }
      // excess payments beyond total charges are ignored (zero outstanding)
    }

    // Bucket remaining (outstanding) charge amounts by age
    const nowMs = new Date().getTime();
    let current = 0, d30 = 0, d60 = 0, d90 = 0;
    for (const c of charges) {
      const amt = c.amount;
      if (amt <= 0) continue;
      try {
        const chargeDate = new Date(c.date);
        if (isNaN(chargeDate.getTime())) continue; // Skip invalid dates
        const days = Math.floor((nowMs - chargeDate.getTime()) / (1000 * 60 * 60 * 24));
        if (days < 30) current += amt;
        else if (days < 60) d30 += amt;
        else if (days < 90) d60 += amt;
        else d90 += amt;
      } catch {
        // If date parsing fails, treat as current
        current += amt;
      }
    }

    const total = current + d30 + d60 + d90;
    return { current, d30, d60, d90, total };
  };

  // --- Export / Print helpers ---
  const exportAccountCSV = (account: any) => {
    const headers = [
      'Account ID','Name','Type','Credit Limit','Balance',
      'Payment Terms','Status','Activated On','Contact Name',
      'Contact Phone','Contact Email','Address','Billing Cycle'
    ];
    const meta = [
      account.id,
      account.name,
      account.type,
      String(account.creditLimit ?? ''),
      String(account.balance ?? ''),
      account.paymentTerms ?? '',
      account.status ?? '',
      account.activatedOn ?? '',
      account.contactName ?? '',
      account.contactPhone ?? '',
      account.contactEmail ?? '',
      (account.address ?? '').replace(/\n/g, ' '),
      account.billingCycle ?? ''
    ];

    const lines: string[] = [];
    lines.push(headers.join(','));
    lines.push(meta.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
    lines.push('');
    lines.push('Date,Reference,Description,Debit,Credit');

    const txns = (account.transactions || [])
      .slice()
      .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());

    for (const t of txns) {
      const row = [
        t.date,
        t.reference || '',
        (t.description || '').replace(/\n/g, ' '),
        t.debit != null ? String(t.debit) : '',
        t.credit != null ? String(t.credit) : ''
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
      lines.push(row);
    }

    const csv = lines.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    downloadBlob(blob, `city_ledger_${account.name}_${account.id}.csv`);
  };

  const printAccount = (account: any) => {
    const aging = computeAging(account);

    const txRows = (account.transactions || [])
      .slice()
      .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .map((t: any) => `<tr><td>${t.date}</td><td>${t.reference || '-'}</td><td>${t.description || ''}</td><td style="text-align:right">${t.debit != null ? `$${Number(t.debit).toFixed(2)}` : '-'}</td><td style="text-align:right">${t.credit != null ? `$${Number(t.credit).toFixed(2)}` : '-'}</td></tr>`)
      .join('');

    const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${HOTEL_NAME} - City Ledger Statement</title>
<style>
  body { font-family: Arial, sans-serif; padding: 24px; color: #333; }
  .header { text-align: center; border-bottom: 2px solid #2563eb; padding-bottom: 16px; margin-bottom: 24px; }
  .logo { font-size: 28px; font-weight: bold; color: #2563eb; margin-bottom: 8px; }
  .subtitle { font-size: 16px; color: #666; }
  h1 { margin: 0 0 8px; font-size: 24px; color: #1f2937; }
  .meta { margin-bottom: 16px; font-size: 12px; color: #444; background: #f8fafc; padding: 12px; border-radius: 6px; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; }
  th, td { border: 1px solid #e5e7eb; padding: 8px; font-size: 12px; }
  th { background: #f9fafb; text-align: left; font-weight: 600; color: #374151; }
  .summary { margin-top: 24px; }
  .summary h3 { color: #1f2937; border-bottom: 1px solid #e5e7eb; padding-bottom: 8px; }
  .footer { margin-top: 32px; text-align: center; font-size: 10px; color: #9ca3af; border-top: 1px solid #e5e7eb; padding-top: 16px; }
</style>
</head>
<body>
<div class="header">
  <div class="logo">${HOTEL_NAME}</div>
  <div class="subtitle">Hospitality Management System</div>
</div>
<h1>City Ledger Statement</h1>
<div class="meta">
  <strong>Account:</strong> ${account.account_name || account.name} (${account.id})<br/>
  <strong>Type:</strong> ${account.type} | <strong>Status:</strong> ${account.status || 'Active'} | <strong>Payment Terms:</strong> ${account.paymentTerms}<br/>
  <strong>Credit Limit:</strong> $${Number(account.creditLimit || 0).toLocaleString()} | <strong>Current Balance:</strong> $${Number(account.balance || 0).toLocaleString()}
</div>
<h2>Transaction History</h2>
<table>
  <thead>
    <tr><th>Date</th><th>Reference</th><th>Description</th><th style="text-align:right">Debit</th><th style="text-align:right">Credit</th></tr>
  </thead>
  <tbody>${txRows}</tbody>
</table>
<div class="summary">
  <h3>Accounts Receivable Aging Summary</h3>
  <table>
    <tr><th>Current (&lt;30 days)</th><th>1-30 Days</th><th>31-60 Days</th><th>60+ Days</th><th>Total Outstanding</th></tr>
    <tr>
      <td>$${Number(aging.current).toFixed(2)}</td>
      <td>$${Number(aging.d30).toFixed(2)}</td>
      <td>$${Number(aging.d60).toFixed(2)}</td>
      <td>$${Number(aging.d90).toFixed(2)}</td>
      <td><b>$${Number(aging.total).toFixed(2)}</b></td>
    </tr>
  </table>
</div>
<div class="footer">
  ${HOTEL_NAME} | Confidential Business Document | Generated on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}
</div>
<script>window.onload = function(){ window.print(); }</script>
</body>
</html>`;

    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.focus();
  };

  const printAccountReceipt = (account: any) => {
    try {
      const today = new Date().toISOString().slice(0,10);
      const recent = (account.transactions || [])
        .filter((t: any) => t.debit && t.debit > 0)
        .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime())
        .slice(-10);
      const receiptNo = `CL-${Date.now()}`;
      const html = generateCityLedgerReceiptHTML({ id: account.id, name: account.name }, receiptNo, recent, undefined);
      printDocument(html, `CityLedgerReceipt-${account.id}`);
    } catch (e) {
      console.error('Print receipt error', e);
    }
  };

  const exportAgingCSV = () => {
    const lines: string[] = [];
    lines.push('Account ID,Account Name,Current,1-30,31-60,60+,Total');

    for (const acc of cityLedger) {
      const a = computeAging(acc);
      const row = [
        acc.id, acc.name,
        Number(a.current).toFixed(2),
        Number(a.d30).toFixed(2),
        Number(a.d60).toFixed(2),
        Number(a.d90).toFixed(2),
        Number(a.total).toFixed(2)
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
      lines.push(row);
    }

    const csv = lines.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    downloadBlob(blob, `ar_aging_${new Date().toISOString().slice(0,10)}.csv`);
  };

  // Compute additional reports
  const computeAccountSummary = () => {
    const active = cityLedger.filter(acc => acc.status !== 'Closed').length;
    const totalBalance = cityLedger.reduce((sum, acc) => sum + Number(acc.balance || 0), 0);
    const totalCreditLimit = cityLedger.reduce((sum, acc) => sum + Number(acc.creditLimit || 0), 0);
    const overdue = cityLedger.filter(acc => {
      const aging = computeAging(acc);
      return aging.d30 > 0 || aging.d60 > 0 || aging.d90 > 0;
    }).length;

    return { active, totalBalance, totalCreditLimit, overdue };
  };

  const computeTopDebtors = () => {
    return cityLedger
      .filter(acc => Number(acc.balance || 0) > 0)
      .sort((a, b) => Number(b.balance || 0) - Number(a.balance || 0))
      .slice(0, 5);
  };
  // --- End helpers ---

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto p-6">
        <BackToAccountingButton />
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-4xl font-bold text-gray-900">City Ledger</h1>
            <p className="text-gray-600 mt-2">Accounts Receivable Management</p>
          </div>
          <button
            onClick={() => setShowNewForm(!showNewForm)}
            className="bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700 shadow-sm transition-colors duration-200"
          >
            + New Account
          </button>
        </div>

      {showNewForm && (
        <div className="bg-white rounded-xl shadow-lg p-8 mb-8 border border-gray-200">
          <h3 className="text-2xl font-bold text-gray-900 mb-6">Create New City Ledger Account</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Account Name *</label>
              <input
                type="text"
                placeholder="Enter account name"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
                value={newAccName}
                onChange={(e) => setNewAccName(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Account Type</label>
              <select
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
                value={newAccType}
                onChange={(e) => setNewAccType(e.target.value)}
              >
                <option>Corporate</option>
                <option>Travel Agent</option>
                <option>Group Master</option>
                <option>Wholesale</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Credit Limit *</label>
              <input
                type="number"
                placeholder="0.00"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
                value={newAccCreditLimit}
                onChange={(e) => setNewAccCreditLimit(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Payment Terms</label>
              <select
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
                value={newAccPaymentTerms}
                onChange={(e) => setNewAccPaymentTerms(e.target.value)}
              >
                <option>Net 30</option>
                <option>Net 60</option>
                <option>Due Upon Receipt</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Tax ID / VAT</label>
              <input
                type="text"
                placeholder="Enter tax ID"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
                value={newAccTaxId}
                onChange={(e) => setNewAccTaxId(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Billing Email</label>
              <input
                type="email"
                placeholder="billing@company.com"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
                value={newAccBillingEmail}
                onChange={(e) => setNewAccBillingEmail(e.target.value)}
              />
            </div>
          </div>
          <div className="flex gap-4 mt-8">
            <button
              className="bg-green-600 text-white px-8 py-3 rounded-lg hover:bg-green-700 font-semibold shadow-sm transition-colors duration-200"
              onClick={() => {
                if (!newAccName.trim() || !newAccCreditLimit) return;
                const ok = addCityLedgerAccount({
                  name: newAccName.trim(),
                  type: newAccType,
                  creditLimit: Number(newAccCreditLimit),
                  paymentTerms: newAccPaymentTerms,
                  contactEmail: newAccBillingEmail || undefined,
                  status: 'Active',
                  activatedOn: new Date().toISOString().slice(0, 10),
                });
                if (ok) {
                  setNewAccName('');
                  setNewAccType('Corporate');
                  setNewAccCreditLimit('');
                  setNewAccPaymentTerms('Net 30');
                  setNewAccTaxId('');
                  setNewAccBillingEmail('');
                  setShowNewForm(false);
                }
              }}
            >
              Create Account
            </button>
            <button
              onClick={() => {
                setNewAccName('');
                setNewAccType('Corporate');
                setNewAccCreditLimit('');
                setNewAccPaymentTerms('Net 30');
                setNewAccTaxId('');
                setNewAccBillingEmail('');
                setShowNewForm(false);
              }}
              className="bg-gray-100 text-gray-700 px-8 py-3 rounded-lg hover:bg-gray-200 font-semibold transition-colors duration-200"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {accountsPg.pageItems.map(account => {
          const isClosed = account.status === 'Closed';
          const accountStatus = account.status || 'Active';
          const statusColor = isClosed ? 'bg-gray-50 border-l-gray-400' : accountStatus === 'On Hold' ? 'bg-white border-l-yellow-500' : 'bg-white border-l-blue-500';

          return (
          <div key={account.id} className={`${statusColor} rounded-xl shadow-lg p-6 border-l-4 border border-gray-200 ${isClosed ? 'opacity-75' : ''} hover:shadow-xl transition-shadow duration-200`}>
            <div className="flex justify-between items-start mb-4">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <button
                    onClick={() => {
                      const newExpanded = new Set(expandedAccounts);
                      if (newExpanded.has(account.id)) {
                        newExpanded.delete(account.id);
                      } else {
                        newExpanded.add(account.id);
                      }
                      setExpandedAccounts(newExpanded);
                    }}
                    className="text-gray-500 hover:text-gray-700 p-1"
                    title={expandedAccounts.has(account.id) ? 'Collapse' : 'Expand'}
                  >
                    <svg className={`w-5 h-5 transform transition-transform ${expandedAccounts.has(account.id) ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                  <div>
                    <h3 className="text-xl font-bold text-gray-800">{account.account_name || account.name}</h3>
                    <p className="text-sm text-gray-600">{account.type}</p>
                    <p className="text-xs text-gray-500 mt-1">Payment Terms: {account.paymentTerms}</p>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-col">
                <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                  isClosed
                    ? 'bg-gray-300 text-gray-700'
                    : accountStatus === 'On Hold'
                    ? 'bg-yellow-100 text-yellow-700'
                    : 'bg-green-100 text-green-700'
                }`}>
                  {accountStatus}
                </span>
                <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-semibold">
                  {account.id}
                </span>
                {canExport && (
                  <div className="flex gap-1 mt-2">
                    <button className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs hover:bg-gray-200" onClick={() => exportAccountCSV(account)}>
                      CSV
                    </button>
                    <button className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs hover:bg-gray-200" onClick={() => printAccount(account)}>
                      Print
                    </button>
                    <button className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs hover:bg-gray-200" onClick={() => printAccountReceipt(account)}>
                      Receipt
                    </button>
                  </div>
                )}
              </div>
            </div>
            
            {expandedAccounts.has(account.id) && (
              <>
                {(() => {
                  // Live balance: sum all non-voided debits minus credits from this account's transactions.
                  // This is the single source of truth — never rely on the stored `balance` column in DB
                  // which can drift out of sync. BUG FIX: was always showing $0 due to wrong column names.
                  const liveBalance = (account.transactions || []).reduce((sum: number, txn: any) => {
                    if (txn.is_voided) return sum;
                    const d = Number(txn.debit  || txn.debit_amount  || 0);
                    const c = Number(txn.credit || txn.credit_amount || 0);
                    return sum + d - c;
                  }, 0);
                  const isOverdue = liveBalance > 0;
                  return (
                    <div className="grid grid-cols-2 gap-4 mb-4">
                      <div className="bg-gray-50 p-3 rounded-lg">
                        <p className="text-xs text-gray-600 mb-1">Credit Limit</p>
                        <p className="text-lg font-bold text-gray-800">${Number(account.creditLimit || 0).toLocaleString()}</p>
                      </div>
                      <div className={`p-3 rounded-lg ${isOverdue ? 'bg-red-50' : 'bg-green-50'}`}>
                        <p className="text-xs text-gray-600 mb-1">Current Balance (live)</p>
                        <p className={`text-lg font-bold ${isOverdue ? 'text-red-600' : 'text-green-600'}`}>
                          ${liveBalance.toFixed(2)}
                        </p>
                        {liveBalance === 0 && (account.transactions || []).length === 0 && (
                          <p className="text-[10px] text-gray-400 mt-0.5">No transactions yet</p>
                        )}
                      </div>
                    </div>
                  );
                })()}

                <div className="flex gap-2 mb-3">
                  <button
                    className="flex-1 bg-blue-500 text-white py-2 rounded-lg text-sm hover:bg-blue-600"
                    onClick={() => { setActiveTxnAccount(account.id); setTxnType('debit'); resetTxnForm(); }}
                  >
                    Post Charge
                  </button>
                  <button
                    className="flex-1 bg-green-500 text-white py-2 rounded-lg text-sm hover:bg-green-600"
                    onClick={() => { setActiveTxnAccount(account.id); setTxnType('credit'); resetTxnForm(); }}
                  >
                    Record Payment
                  </button>
                  <button
                    className="flex-1 bg-purple-500 text-white py-2 rounded-lg text-sm hover:bg-purple-600"
                    onClick={() => {
                      const togglingOn = editAccountId !== account.id;
                      setEditAccountId(togglingOn ? account.id : null);
                      if (togglingOn) {
                        setDetailsForm({
                          status: String(account.status || 'Active'),
                          contactName: String(account.contactName || ''),
                          contactPhone: String(account.contactPhone || ''),
                          contactEmail: String(account.contactEmail || ''),
                          address: String(account.address || ''),
                          billingCycle: String(account.billingCycle || 'Monthly'),
                          paymentTerms: String(account.paymentTerms || ''),
                          creditLimit: String(Number(account.creditLimit || 0))
                        });
                      }
                    }}
                  >
                    Edit Details
                  </button>
                </div>
              </>
            )}

            {expandedAccounts.has(account.id) && (
              <>
                {editAccountId === account.id && (
                  <div className="bg-gray-50 p-4 rounded-lg mb-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <select className="px-3 py-2 border rounded" value={detailsForm.status} onChange={e => setDetailsForm({ ...detailsForm, status: e.target.value })}>
                        <option>Active</option>
                        <option>Closed</option>
                        <option>On Hold</option>
                      </select>
                      <input className="px-3 py-2 border rounded" placeholder="Contact Name" value={detailsForm.contactName} onChange={e => setDetailsForm({ ...detailsForm, contactName: e.target.value })} />
                      <input className="px-3 py-2 border rounded" placeholder="Contact Phone" value={detailsForm.contactPhone} onChange={e => setDetailsForm({ ...detailsForm, contactPhone: e.target.value })} />
                      <input className="px-3 py-2 border rounded" placeholder="Contact Email" value={detailsForm.contactEmail} onChange={e => setDetailsForm({ ...detailsForm, contactEmail: e.target.value })} />
                      <input className="px-3 py-2 border rounded col-span-1 md:col-span-2" placeholder="Address" value={detailsForm.address} onChange={e => setDetailsForm({ ...detailsForm, address: e.target.value })} />
                      <select className="px-3 py-2 border rounded" value={detailsForm.billingCycle} onChange={e => setDetailsForm({ ...detailsForm, billingCycle: e.target.value })}>
                        <option>Monthly</option>
                        <option>Weekly</option>
                        <option>Upon Checkout</option>
                      </select>
                      <input className="px-3 py-2 border rounded" placeholder="Payment Terms" value={detailsForm.paymentTerms} onChange={e => setDetailsForm({ ...detailsForm, paymentTerms: e.target.value })} />
                      <input type="number" className="px-3 py-2 border rounded" placeholder="Credit Limit" value={detailsForm.creditLimit} onChange={e => setDetailsForm({ ...detailsForm, creditLimit: e.target.value })} />
                    </div>
                    <div className="flex gap-2 mt-3">
                      <button className="bg-blue-600 text-white px-4 py-2 rounded" onClick={() => {
                        updateCityLedgerAccount(account.id, {
                          status: detailsForm.status as any,
                          contactName: detailsForm.contactName,
                          contactPhone: detailsForm.contactPhone,
                          contactEmail: detailsForm.contactEmail,
                          address: detailsForm.address,
                          billingCycle: detailsForm.billingCycle as any,
                          paymentTerms: detailsForm.paymentTerms || account.paymentTerms,
                          creditLimit: detailsForm.creditLimit ? Number(detailsForm.creditLimit) : account.creditLimit
                        });
                        setEditAccountId(null);
                      }}>Save</button>
                      <button className="bg-gray-300 text-gray-800 px-4 py-2 rounded" onClick={() => setEditAccountId(null)}>Cancel</button>
                    </div>
                  </div>
                )}

                {activeTxnAccount === account.id && (
                  <div className="bg-gray-50 p-4 rounded-lg mb-4">
                    <h4 className="text-sm font-semibold mb-2">{txnType === 'debit' ? 'Post Charge' : 'Record Payment'}</h4>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                      <input type="date" className="px-3 py-2 border rounded" value={txnForm.date} onChange={e => setTxnForm({ ...txnForm, date: e.target.value })} />
                      <input className="px-3 py-2 border rounded" placeholder="Reference" value={txnForm.reference} onChange={e => setTxnForm({ ...txnForm, reference: e.target.value })} />
                      <input className="px-3 py-2 border rounded col-span-1 md:col-span-2" placeholder="Description" value={txnForm.description} onChange={e => setTxnForm({ ...txnForm, description: e.target.value })} />
                      <input type="number" className="px-3 py-2 border rounded" placeholder="Amount" value={txnForm.amount} onChange={e => setTxnForm({ ...txnForm, amount: e.target.value })} />
                    </div>
                    <div className="flex gap-2 mt-3">
                      <button className="bg-blue-600 text-white px-4 py-2 rounded" onClick={() => {
                        const amountNum = Number(txnForm.amount || 0);
                        if (!amountNum || !txnForm.description) return;
                        addCityLedgerTransaction(account.id, {
                          date: txnForm.date,
                          reference: txnForm.reference,
                          description: txnForm.description,
                          debit: txnType === 'debit' ? amountNum : undefined,
                          credit: txnType === 'credit' ? amountNum : undefined,
                        });
                        setActiveTxnAccount(null);
                        resetTxnForm();
                      }}>Add</button>
                      <button className="bg-gray-300 text-gray-800 px-4 py-2 rounded" onClick={() => { setActiveTxnAccount(null); resetTxnForm(); }}>Cancel</button>
                    </div>
                  </div>
                )}

                {account.transactions && account.transactions.length > 0 && (
                  <div className="mt-4">
                    <h4 className="text-sm font-semibold mb-2">Activity Log</h4>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-100">
                          <tr>
                            <th className="px-2 py-2 text-left">Date</th>
                            <th className="px-2 py-2 text-left">Reference</th>
                            <th className="px-2 py-2 text-left">Description</th>
                            <th className="px-2 py-2 text-right">Debit</th>
                            <th className="px-2 py-2 text-right">Credit</th>
                            <th className="px-2 py-2 text-center">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {(account.transactions || []).map((t, idx) => {
                            // Shorten reference and resolve names
                            const rawRef = String(t.reference || '-');
                            const displayRef = rawRef.length > 4 ? `bill #${rawRef.slice(-4)}` : rawRef;

                            let resolvedName = '';
                            if (rawRef.toLowerCase().includes('folio-')) {
                              const gid = rawRef.split('folio-')[1];
                              const g = guests.find((x: any) => x.id === gid);
                              if (g) resolvedName = ` (${g.name || g.full_name})`;
                            }

                            // Source badges — distinguish POS room charges from manual entries
                            const source: string = t.source || 'manual';
                            const sourceBadge: Record<string, { label: string; cls: string }> = {
                              pos_room_charge: { label: '🏷 POS · Room Charge', cls: 'bg-orange-100 text-orange-700 border border-orange-300' },
                              pos_direct:      { label: '🛒 POS · Direct',      cls: 'bg-blue-100   text-blue-700   border border-blue-300'   },
                              folio_transfer:  { label: '↗ Folio Transfer',     cls: 'bg-purple-100 text-purple-700 border border-purple-300' },
                              manual:          { label: '',                      cls: ''                                                       },
                            };
                            const badge = sourceBadge[source] || { label: '', cls: '' };

                            return (
                              <tr key={idx} className={t.is_voided ? 'opacity-40 line-through bg-gray-50' : ''}>
                                <td className="px-2 py-2 whitespace-nowrap text-xs">
                                  {typeof t.date === 'object' && t.date instanceof Date
                                    ? t.date.toISOString().split('T')[0]
                                    : (String(t.date || '')).replace('T00:00:00.000Z', '').slice(0, 10) || '—'}
                                </td>
                                <td className="px-2 py-2 font-mono text-xs" title={rawRef}>
                                  <div>{displayRef}{resolvedName}</div>
                                  {badge.label && (
                                    <span className={`inline-block mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold ${badge.cls}`}>
                                      {badge.label}
                                    </span>
                                  )}
                                </td>
                                <td className="px-2 py-2">{t.description}</td>
                                <td className="px-2 py-2 text-right">{t.debit != null && t.debit !== '' ? `$${Number(t.debit).toFixed(2)}` : '-'}</td>
                                <td className="px-2 py-2 text-right">{t.credit != null && t.credit !== '' ? `$${Number(t.credit).toFixed(2)}` : '-'}</td>
                                <td className="px-2 py-2 text-center">
                                  <div className="flex justify-center gap-1 flex-wrap">
                                    {!t.is_voided && (
                                      <button
                                        className="text-amber-600 hover:text-amber-800 hover:bg-amber-50 px-1 py-0.5 rounded text-xs font-medium"
                                        title="Void Transaction"
                                        onClick={() => {
                                          if (confirm('Void this transaction? It will be zeroed out but remain in history.')) {
                                            voidCityLedgerTransaction?.(account.id, t.id || idx);
                                          }
                                        }}
                                      >
                                        Void
                                      </button>
                                    )}
                                    {!t.is_voided && (
                                      <button
                                        className="text-blue-600 hover:text-blue-800 hover:bg-blue-50 px-1 py-0.5 rounded text-xs font-medium"
                                        title="Transfer to Guest Folio"
                                        onClick={() => {
                                          setTransferTxn({ accountId: account.id, txnId: t.id });
                                        }}
                                      >
                                        Transfer
                                      </button>
                                    )}
                                    <button
                                      className="text-red-600 hover:text-red-800 hover:bg-red-50 px-1 py-0.5 rounded text-xs font-medium text-xs"
                                      title="Delete Permanently"
                                      onClick={() => {
                                        if (confirm('Permanently delete this transaction log? This cannot be undone.')) {
                                          deleteCityLedgerTransaction?.(account.id, t.id || idx);
                                        }
                                      }}
                                    >
                                      Delete
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                <div className="mt-4">
                  <div className="flex justify-between items-center mb-2">
                    <h4 className="text-sm font-semibold">Notes & History</h4>
                    <button className="text-blue-600 text-sm" onClick={() => setActiveNoteAccount(activeNoteAccount === account.id ? null : account.id)}>
                      {activeNoteAccount === account.id ? 'Close' : 'Add Note'}
                    </button>
                  </div>
                  {activeNoteAccount === account.id && (
                    <div className="bg-gray-50 p-3 rounded mb-3">
                      <textarea className="w-full px-3 py-2 border rounded" rows={3} placeholder="Enter note..." value={noteText} onChange={e => setNoteText(e.target.value)} />
                      <div className="flex gap-2 mt-2">
                        <button className="bg-blue-600 text-white px-4 py-2 rounded" onClick={() => {
                          if (!noteText.trim()) return;
                          addCityLedgerNote(account.id, { date: new Date().toISOString().slice(0, 10), author: 'Front Desk', text: noteText.trim() });
                          setNoteText('');
                          setActiveNoteAccount(null);
                        }}>Save Note</button>
                        <button className="bg-gray-300 text-gray-800 px-4 py-2 rounded" onClick={() => { setNoteText(''); setActiveNoteAccount(null); }}>Cancel</button>
                      </div>
                    </div>
                  )}
                  {account.notes && account.notes.length > 0 ? (
                    <ul className="space-y-2 text-sm">
                      {(account.notes || []).map((n, i) => (
                        <li key={i} className="bg-gray-50 p-2 rounded">
                          <div className="text-xs text-gray-500">{typeof n.date === 'object' && n.date instanceof Date ? n.date.toISOString().split('T')[0] : n.date} • {n.author || 'Staff'}</div>
                          <div className="text-gray-800">{n.text}</div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-gray-500">No notes yet.</p>
                  )}
                </div>
              </>
            )}
          </div>
          );
        })}
      </div>
      <PaginationBar {...accountsPg} itemLabel="accounts" />

      {/* Transfer to Guest/Account Modal */}
      {transferTxn && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md">
            <h3 className="text-lg font-bold mb-4">Transfer Charge</h3>
            <p className="text-sm text-gray-600 mb-4">
              Select an in-house guest or active AR account to transfer this charge to.
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Transfer Type</label>
                <select 
                  className="w-full px-3 py-2 border rounded"
                  value={targetType}
                  onChange={(e) => {
                    setTargetType(e.target.value as 'guest' | 'account');
                    setTargetGuestId('');
                    setCloseAccountAfterTransfer(false);
                  }}
                >
                  <option value="guest">In-House Guest</option>
                  <option value="account">Active AR Account</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">
                  {targetType === 'guest' ? 'Select Guest' : 'Select AR Account'}
                </label>
                <select 
                  className="w-full px-3 py-2 border rounded"
                  value={targetGuestId}
                  title={targetType === 'guest' ? 'Select Guest' : 'Select AR Account'}
                  onChange={(e) => setTargetGuestId(e.target.value)}
                >
                  <option value="">-- Select {targetType === 'guest' ? 'Guest' : 'Account'} --</option>
                  {targetType === 'guest' ? (
                    // Show in-house guests
                    reservations
                      .filter((r: any) => r.status === 'in_house' || r.status === 'Checked In')
                      .map((r: any) => (
                        <option key={r.id} value={r.guest_id || r.id}>
                          {r.roomNumber || r.room_id} - {r.guestName}
                        </option>
                      ))
                  ) : (
                    // Show active AR accounts
                    (cityLedger || [])
                      .filter((a: any) => a.status === 'Active' || !a.status)
                      .map((a: any) => (
                        <option key={a.id} value={a.id}>
                          {a.account_name || a.name} ({a.type || 'Account'})
                        </option>
                      ))
                  )}
                </select>
              </div>

              {targetType === 'account' && (
                <div className="flex items-center gap-2 bg-amber-50 p-3 rounded border border-amber-200">
                  <input
                    type="checkbox"
                    id="closeAccount"
                    checked={closeAccountAfterTransfer}
                    onChange={(e) => setCloseAccountAfterTransfer(e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300"
                  />
                  <label htmlFor="closeAccount" className="text-sm text-gray-700">
                    Close AR account after transfer (mark as settled)
                  </label>
                </div>
              )}

              <div className="flex gap-2 justify-end mt-6">
                <button 
                  className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded" 
                  onClick={() => { 
                    setTransferTxn(null); 
                    setTargetGuestId('');
                    setTargetType('guest');
                    setCloseAccountAfterTransfer(false);
                  }}
                >
                  Cancel
                </button>
                <button 
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                  disabled={!targetGuestId}
                  onClick={async () => {
                    if (!targetGuestId || !transferTxn) return;
                    try {
                      const success = await transferCityLedgerToGuest?.(transferTxn.accountId, transferTxn.txnId, targetGuestId);
                      if (success) {
                        // If closing AR account, update its status
                        if (targetType === 'account' && closeAccountAfterTransfer) {
                          await updateCityLedgerAccount(transferTxn.accountId, { status: 'Closed' });
                        }
                        setTransferTxn(null);
                        setTargetGuestId('');
                        setTargetType('guest');
                        setCloseAccountAfterTransfer(false);
                      } else {
                        alert('Transfer failed. Please check if the target exists.');
                      }
                    } catch (error) {
                      alert(`Transfer failed: ${error}`);
                    }
                  }}
                >
                  Confirm Transfer
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

        <div className="bg-white rounded-xl shadow-lg p-8 border border-gray-200">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-2xl font-bold text-gray-900">Accounts Receivable Aging Report</h3>
            <button
              onClick={exportAgingCSV}
              className="bg-blue-600 text-white px-6 py-3 rounded-lg text-sm hover:bg-blue-700 font-semibold shadow-sm transition-colors duration-200"
            >
              Export CSV
            </button>
          </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-full">
            <thead className="bg-gray-100">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Account</th>
                <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700">Current</th>
                <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700">1-30 Days</th>
                <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700">31-60 Days</th>
                <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700">60+ Days</th>
                <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {agingPg.pageItems.map(account => {
                const aging = computeAging(account);
                return (
                  <tr key={account.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm text-gray-800">{account.account_name || account.name || account.id}</td>
                    <td className="px-4 py-3 text-sm text-right text-gray-600">${Number(aging.current).toFixed(2)}</td>
                    <td className="px-4 py-3 text-sm text-right text-gray-600">${Number(aging.d30).toFixed(2)}</td>
                    <td className="px-4 py-3 text-sm text-right text-gray-600">${Number(aging.d60).toFixed(2)}</td>
                    <td className="px-4 py-3 text-right text-red-600">${Number(aging.d90).toFixed(2)}</td>
                    <td className="px-4 py-3 text-sm text-right font-bold text-gray-800">${Number(aging.total).toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <PaginationBar {...agingPg} itemLabel="accounts" />
      </div>

        {/* Additional Reports Section */}
        <div className="mt-12 space-y-8">
          <div className="text-center">
            <h3 className="text-3xl font-bold text-gray-900 mb-2">Financial Reports & Analytics</h3>
            <p className="text-gray-600">Comprehensive insights into your accounts receivable</p>
          </div>

          {/* Account Summary Report */}
          <div className="bg-white rounded-xl shadow-lg p-8 border border-gray-200">
            <h4 className="text-xl font-bold text-gray-900 mb-6">Account Summary Overview</h4>
          {(() => {
            const summary = computeAccountSummary();
            return (
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-blue-50 p-4 rounded-lg">
                  <p className="text-sm text-gray-600">Active Accounts</p>
                  <p className="text-2xl font-bold text-blue-600">{summary.active}</p>
                </div>
                <div className="bg-green-50 p-4 rounded-lg">
                  <p className="text-sm text-gray-600">Total Credit Limit</p>
                  <p className="text-2xl font-bold text-green-600">${summary.totalCreditLimit.toLocaleString()}</p>
                </div>
                <div className="bg-red-50 p-4 rounded-lg">
                  <p className="text-sm text-gray-600">Total Outstanding</p>
                  <p className="text-2xl font-bold text-red-600">${summary.totalBalance.toLocaleString()}</p>
                </div>
                <div className="bg-yellow-50 p-4 rounded-lg">
                  <p className="text-sm text-gray-600">Accounts with Overdue</p>
                  <p className="text-2xl font-bold text-yellow-600">{summary.overdue}</p>
                </div>
              </div>
            );
          })()}
        </div>

          {/* Top Debtors Report */}
          <div className="bg-white rounded-xl shadow-lg p-8 border border-gray-200">
            <h4 className="text-xl font-bold text-gray-900 mb-6">Top Debtors Analysis</h4>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-100">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Account</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Type</th>
                  <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700">Balance</th>
                  <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700">Credit Limit</th>
                  <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700">Utilization</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {computeTopDebtors().map(account => {
                  const balance = Number(account.balance || 0);
                  const creditLimit = Number(account.creditLimit || 0);
                  const utilization = creditLimit > 0 ? (balance / creditLimit * 100).toFixed(1) : 'N/A';
                  return (
                    <tr key={account.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm text-gray-800">{account.account_name || account.name}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{account.type}</td>
                      <td className="px-4 py-3 text-sm text-right text-red-600">${balance.toLocaleString()}</td>
                      <td className="px-4 py-3 text-sm text-right text-gray-600">${creditLimit.toLocaleString()}</td>
                      <td className="px-4 py-3 text-sm text-right text-gray-600">{utilization}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

          {/* Aging Summary */}
          <div className="bg-white rounded-xl shadow-lg p-8 border border-gray-200">
            <h4 className="text-xl font-bold text-gray-900 mb-6">AR Aging Summary</h4>
          {(() => {
            const totalCurrent = cityLedger.reduce((sum, acc) => sum + computeAging(acc).current, 0);
            const total30 = cityLedger.reduce((sum, acc) => sum + computeAging(acc).d30, 0);
            const total60 = cityLedger.reduce((sum, acc) => sum + computeAging(acc).d60, 0);
            const total90 = cityLedger.reduce((sum, acc) => sum + computeAging(acc).d90, 0);
            const grandTotal = totalCurrent + total30 + total60 + total90;

            return (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                  <div className="text-center">
                    <p className="text-sm text-gray-600 mb-1">Current</p>
                    <p className="text-xl font-bold text-green-600">${totalCurrent.toLocaleString()}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-sm text-gray-600 mb-1">1-30 Days</p>
                    <p className="text-xl font-bold text-yellow-600">${total30.toLocaleString()}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-sm text-gray-600 mb-1">31-60 Days</p>
                    <p className="text-xl font-bold text-orange-600">${total60.toLocaleString()}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-sm text-gray-600 mb-1">60+ Days</p>
                    <p className="text-xl font-bold text-red-600">${total90.toLocaleString()}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-sm text-gray-600 mb-1">Total AR</p>
                    <p className="text-2xl font-bold text-gray-800">${grandTotal.toLocaleString()}</p>
                  </div>
                </div>
                <div className="mt-4 p-4 bg-gray-50 rounded-lg">
                  <p className="text-sm text-gray-600">
                    <strong>Collection Priority:</strong> Focus on the ${total90.toLocaleString()} in 60+ days aging first,
                    followed by ${total60.toLocaleString()} in 31-60 days.
                  </p>
                </div>
              </div>
            );
          })()}
          </div>
        </div>
      </div>
    </div>
  );
};
  // Render
  // Place back button at the top for consistent navigation back to Accounting
