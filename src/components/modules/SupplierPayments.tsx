import React, { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface Balance { supplier_name: string; grn_count: number; payable: string | number; paid: string | number; balance: string | number; }
interface Payment { id: string; supplier_name: string; amount: string | number; method: string; gl_cash_account: string; reference: string | null; journal_id: string | null; paid_at: string; created_by: string | null; }

// Supplier Payments — clear supplier (AP) balances against cash or bank.
// Payable = posted GRN totals per supplier; each payment books
// Dr 2100 Accounts Payable / Cr 1000 Cash or 1100 Bank as a posted journal.
export const SupplierPayments: React.FC = () => {
  const [balances, setBalances] = useState<Balance[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(false);
  const [paying, setPaying] = useState(false);
  const [form, setForm] = useState({ supplier_name: '', amount: '', method: 'cash' as 'cash' | 'bank', reference: '', date: new Date().toISOString().slice(0, 10) });
  const { user } = useAuth();
  const { toast } = useToast();

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const [b, p] = await Promise.all([
        fetch('/api/ap/supplier-balances').then(r => r.json()),
        fetch('/api/ap/supplier-payments').then(r => r.json()),
      ]);
      if (b.ok) setBalances(b.rows || []);
      if (p.ok) setPayments(p.rows || []);
      if (!b.ok) toast({ title: 'Load failed', description: b.error });
    } catch (e: any) {
      toast({ title: 'Load failed', description: String(e?.message || e) });
    } finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const selected = balances.find(b => b.supplier_name === form.supplier_name);
  const outstanding = selected ? Number(selected.balance) : 0;
  const amt = Number(form.amount || 0);
  const overpay = selected != null && amt > outstanding + 0.005;

  const pay = async () => {
    if (!form.supplier_name || !(amt > 0)) { toast({ title: 'Payment invalid', description: 'Pick a supplier and enter a positive amount.' }); return; }
    if (!window.confirm(`Pay $ ${amt.toFixed(2)} to ${form.supplier_name} from ${form.method === 'cash' ? 'Cash (1000)' : 'Bank (1100)'}?\nThis posts: Dr 2100 Accounts Payable / Cr ${form.method === 'cash' ? '1000' : '1100'}.`)) return;
    setPaying(true);
    try {
      const r = await fetch('/api/ap/supplier-payments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, amount: amt, created_by: user?.username || 'system' }),
      }).then(r => r.json());
      if (!r.ok) throw new Error(r.error || 'Payment failed');
      toast({ title: 'Payment recorded', description: `$ ${amt.toFixed(2)} to ${form.supplier_name} — journal ${r.journal_id}.` });
      setForm(f => ({ ...f, amount: '', reference: '' }));
      await load();
    } catch (e: any) {
      toast({ title: 'Payment failed', description: String(e?.message || e) });
    } finally { setPaying(false); }
  };

  return (
    <div className="p-6 space-y-5">
      <div>
        <h2 className="text-xl font-bold">Supplier Payments</h2>
        <div className="text-xs text-gray-500">Clear supplier accounts against cash or bank. Payable comes from posted GRNs; each payment posts Dr 2100 Accounts Payable / Cr 1000 Cash or 1100 Bank.</div>
      </div>

      {/* Payment form */}
      <div className="border rounded p-4 bg-gray-50">
        <div className="font-semibold text-sm mb-2">Record Payment</div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="text-xs block">Supplier</label>
            <select className="border rounded px-2 py-1.5 text-sm min-w-[220px]" value={form.supplier_name}
              onChange={e => setForm(f => ({ ...f, supplier_name: e.target.value }))}>
              <option value="">Select supplier…</option>
              {balances.map(b => <option key={b.supplier_name} value={b.supplier_name}>{b.supplier_name} (owed $ {Number(b.balance).toFixed(2)})</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs block">Amount</label>
            <Input type="number" step="0.01" min="0.01" className="ds-input-compact w-32" value={form.amount}
              onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
          </div>
          <div>
            <label className="text-xs block">Pay From</label>
            <select className="border rounded px-2 py-1.5 text-sm" value={form.method}
              onChange={e => setForm(f => ({ ...f, method: e.target.value as 'cash' | 'bank' }))}>
              <option value="cash">Cash (1000)</option>
              <option value="bank">Bank (1100)</option>
            </select>
          </div>
          <div>
            <label className="text-xs block">Date</label>
            <Input type="date" className="ds-input-compact" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
          </div>
          <div>
            <label className="text-xs block">Reference</label>
            <Input className="ds-input-compact w-40" placeholder="Invoice / receipt #" value={form.reference}
              onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} />
          </div>
          <Button className="ds-button-compact bg-green-600 text-white" disabled={paying || !form.supplier_name || !(amt > 0)} onClick={pay}>
            {paying ? 'Posting…' : 'Pay Supplier'}
          </Button>
          {selected && (
            <Button variant="outline" className="ds-button-compact" disabled={outstanding <= 0}
              onClick={() => setForm(f => ({ ...f, amount: outstanding.toFixed(2) }))}>Pay Full Balance</Button>
          )}
        </div>
        {overpay && <div className="text-xs text-amber-700 mt-2">⚠ Amount exceeds the outstanding balance of $ {outstanding.toFixed(2)} — this will leave the supplier in credit.</div>}
      </div>

      {/* Balances */}
      <div className="border rounded overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="bg-gray-50 text-gray-600">
            <th className="p-2 text-left">Supplier</th><th className="p-2 text-right">GRNs</th>
            <th className="p-2 text-right">Payable</th><th className="p-2 text-right">Paid</th>
            <th className="p-2 text-right">Balance Owed</th><th className="p-2"></th>
          </tr></thead>
          <tbody>
            {balances.map(b => (
              <tr key={b.supplier_name} className="border-t">
                <td className="p-2 font-medium">{b.supplier_name}</td>
                <td className="p-2 text-right">{b.grn_count}</td>
                <td className="p-2 text-right font-mono">$ {Number(b.payable).toFixed(2)}</td>
                <td className="p-2 text-right font-mono text-green-700">$ {Number(b.paid).toFixed(2)}</td>
                <td className={`p-2 text-right font-mono font-semibold ${Number(b.balance) > 0 ? 'text-red-700' : 'text-green-700'}`}>$ {Number(b.balance).toFixed(2)}</td>
                <td className="p-2">
                  {Number(b.balance) > 0 && (
                    <button className="text-indigo-600 text-xs font-semibold"
                      onClick={() => setForm(f => ({ ...f, supplier_name: b.supplier_name, amount: Number(b.balance).toFixed(2) }))}>
                      Settle →
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {balances.length === 0 && !loading && <tr><td colSpan={6} className="p-4 text-center text-gray-500">No posted GRNs or payments yet.</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Payment history */}
      <div className="border rounded overflow-x-auto">
        <div className="px-3 py-2 font-semibold text-sm bg-gray-50 border-b">Payment History</div>
        <table className="w-full text-xs">
          <thead><tr className="text-gray-500">
            <th className="p-2 text-left">Date</th><th className="p-2 text-left">Supplier</th>
            <th className="p-2 text-right">Amount</th><th className="p-2 text-left">From</th>
            <th className="p-2 text-left">Reference</th><th className="p-2 text-left">Journal</th><th className="p-2 text-left">By</th>
          </tr></thead>
          <tbody>
            {payments.map(p => (
              <tr key={p.id} className="border-t">
                <td className="p-2">{String(p.paid_at).slice(0, 10)}</td>
                <td className="p-2">{p.supplier_name}</td>
                <td className="p-2 text-right font-mono">$ {Number(p.amount).toFixed(2)}</td>
                <td className="p-2">{p.method === 'cash' ? 'Cash (1000)' : 'Bank (1100)'}</td>
                <td className="p-2 text-gray-600">{p.reference || '—'}</td>
                <td className="p-2 font-mono text-[10px]">{p.journal_id || '—'}</td>
                <td className="p-2 text-gray-600">{p.created_by || '—'}</td>
              </tr>
            ))}
            {payments.length === 0 && <tr><td colSpan={7} className="p-4 text-center text-gray-500">No payments recorded yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default SupplierPayments;
