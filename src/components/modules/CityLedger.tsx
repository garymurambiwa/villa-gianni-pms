import React, { useState } from 'react';
import BackToAccountingButton from '@/components/modules/common/BackToAccountingButton';
import { useData } from '../../context/DataContext';
import { downloadBlob } from '../../lib/documentUtils';
import { useAuth } from '../../context/AuthContext';
import { printDocument, generateCityLedgerReceiptHTML } from '../../lib/posIntegration';

export const CityLedger: React.FC = () => {
  const { cityLedger, addCityLedgerAccount, updateCityLedgerAccount, addCityLedgerTransaction, addCityLedgerNote } = useData();
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
      const days = Math.floor((nowMs - new Date(c.date).getTime()) / (1000 * 60 * 60 * 24));
      if (days < 30) current += amt;
      else if (days < 60) d30 += amt;
      else if (days < 90) d60 += amt;
      else d90 += amt;
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
<title>City Ledger Statement</title>
<style>
  body { font-family: Arial, sans-serif; padding: 24px; }
  h1 { margin: 0 0 8px; }
  .meta { margin-bottom: 16px; font-size: 12px; color: #444; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #ddd; padding: 6px; font-size: 12px; }
  th { background: #f5f5f5; text-align: left; }
  .summary { margin-top: 16px; }
</style>
</head>
<body>
<h1>${account.name} (${account.id})</h1>
<div class="meta">
  Type: ${account.type} | Status: ${account.status || 'Active'} | Terms: ${account.paymentTerms}
  | Credit Limit: $${Number(account.creditLimit || 0).toLocaleString()}
  | Balance: $${Number(account.balance || 0).toLocaleString()}
</div>
<h2>Transactions</h2>
<table>
  <thead>
    <tr><th>Date</th><th>Reference</th><th>Description</th><th style="text-align:right">Debit</th><th style="text-align:right">Credit</th></tr>
  </thead>
  <tbody>${txRows}</tbody>
</table>
<div class="summary">
  <h3>AR Aging</h3>
  <table>
    <tr><th>Current</th><th>1-30</th><th>31-60</th><th>60+</th><th>Total</th></tr>
    <tr>
      <td>$${Number(aging.current).toFixed(2)}</td>
      <td>$${Number(aging.d30).toFixed(2)}</td>
      <td>$${Number(aging.d60).toFixed(2)}</td>
      <td>$${Number(aging.d90).toFixed(2)}</td>
      <td><b>$${Number(aging.total).toFixed(2)}</b></td>
    </tr>
  </table>
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
  // --- End helpers ---

  return (
    <div className="p-6">
      <BackToAccountingButton />
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-3xl font-bold text-gray-800">City Ledger (AR)</h2>
        <button
          onClick={() => setShowNewForm(!showNewForm)}
          className="bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700"
        >
          + New Account
        </button>
      </div>

      {showNewForm && (
        <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
          <h3 className="text-xl font-bold text-gray-800 mb-4">Create City Ledger Account</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <input
              type="text"
              placeholder="Account Name"
              className="px-4 py-2 border rounded-lg"
              value={newAccName}
              onChange={(e) => setNewAccName(e.target.value)}
            />
            <select
              className="px-4 py-2 border rounded-lg"
              value={newAccType}
              onChange={(e) => setNewAccType(e.target.value)}
            >
              <option>Corporate</option>
              <option>Travel Agent</option>
              <option>Group Master</option>
              <option>Wholesale</option>
            </select>
            <input
              type="number"
              placeholder="Credit Limit"
              className="px-4 py-2 border rounded-lg"
              value={newAccCreditLimit}
              onChange={(e) => setNewAccCreditLimit(e.target.value)}
            />
            <select
              className="px-4 py-2 border rounded-lg"
              value={newAccPaymentTerms}
              onChange={(e) => setNewAccPaymentTerms(e.target.value)}
            >
              <option>Net 30</option>
              <option>Net 60</option>
              <option>Due Upon Receipt</option>
            </select>
            <input
              type="text"
              placeholder="Tax ID / VAT"
              className="px-4 py-2 border rounded-lg"
              value={newAccTaxId}
              onChange={(e) => setNewAccTaxId(e.target.value)}
            />
            <input
              type="email"
              placeholder="Billing Email"
              className="px-4 py-2 border rounded-lg"
              value={newAccBillingEmail}
              onChange={(e) => setNewAccBillingEmail(e.target.value)}
            />
          </div>
          <div className="flex gap-3 mt-4">
            <button
              className="bg-green-600 text-white px-6 py-2 rounded-lg hover:bg-green-700"
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
              className="bg-gray-300 text-gray-700 px-6 py-2 rounded-lg hover:bg-gray-400"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {(cityLedger || []).map(account => (
          <div key={account.id} className="bg-white rounded-xl shadow-lg p-6 border-l-4 border-blue-500">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-xl font-bold text-gray-800">{account.name}</h3>
                <p className="text-sm text-gray-600">{account.type}</p>
                <p className="text-xs text-gray-500 mt-1">Payment Terms: {account.paymentTerms}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-semibold">
                  {account.id}
                </span>
                {canExport && (
                  <>
                    <button className="px-3 py-1 bg-gray-100 text-gray-700 rounded text-xs hover:bg-gray-200" onClick={() => exportAccountCSV(account)}>
                      Export CSV
                    </button>
                    <button className="px-3 py-1 bg-gray-100 text-gray-700 rounded text-xs hover:bg-gray-200" onClick={() => printAccount(account)}>
                      Print Statement
                    </button>
                    <button className="px-3 py-1 bg-gray-100 text-gray-700 rounded text-xs hover:bg-gray-200" onClick={() => printAccountReceipt(account)}>
                      Print Receipt
                    </button>
                  </>
                )}
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="bg-gray-50 p-3 rounded-lg">
                <p className="text-xs text-gray-600 mb-1">Credit Limit</p>
                <p className="text-lg font-bold text-gray-800">${Number(account.creditLimit || 0).toLocaleString()}</p>
              </div>
              <div className="bg-red-50 p-3 rounded-lg">
                <p className="text-xs text-gray-600 mb-1">Current Balance</p>
                <p className="text-lg font-bold text-red-600">${Number(account.balance || 0).toLocaleString()}</p>
              </div>
            </div>
            
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
                <table className="w-full text-sm">
                  <thead className="bg-gray-100">
                    <tr>
                      <th className="px-2 py-2 text-left">Date</th>
                      <th className="px-2 py-2 text-left">Reference</th>
                      <th className="px-2 py-2 text-left">Description</th>
                      <th className="px-2 py-2 text-right">Debit</th>
                      <th className="px-2 py-2 text-right">Credit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {(account.transactions || []).map((t, idx) => (
                      <tr key={idx}>
                        <td className="px-2 py-2">{typeof t.date === 'object' && t.date instanceof Date ? t.date.toISOString().split('T')[0] : t.date}</td>
                        <td className="px-2 py-2">{t.reference || '-'}</td>
                        <td className="px-2 py-2">{t.description}</td>
                        <td className="px-2 py-2 text-right">{t.debit != null && t.debit !== '' ? `$${Number(t.debit).toFixed(2)}` : '-'}</td>
                        <td className="px-2 py-2 text-right">{t.credit != null && t.credit !== '' ? `$${Number(t.credit).toFixed(2)}` : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl shadow-lg p-6">
        <h3 className="text-xl font-bold text-gray-800 mb-4">AR Aging Report</h3>
        <table className="w-full">
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
            {(cityLedger || []).map(account => {
              const aging = computeAging(account);
              return (
                <tr key={account.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm text-gray-800">{account.name}</td>
                  <td className="px-4 py-3 text-sm text-right text-gray-600">${Number(aging.current).toFixed(2)}</td>
                  <td className="px-4 py-3 text-sm text-right text-gray-600">${Number(aging.d30).toFixed(2)}</td>
                  <td className="px-4 py-3 text-sm text-right text-gray-600">${Number(aging.d60).toFixed(2)}</td>
                  <td className="px-4 py-3 text-sm text-right text-red-600">${Number(aging.d90).toFixed(2)}</td>
                  <td className="px-4 py-3 text-sm text-right font-bold text-gray-800">${Number(aging.total).toFixed(2)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
  // Render
  // Place back button at the top for consistent navigation back to Accounting
