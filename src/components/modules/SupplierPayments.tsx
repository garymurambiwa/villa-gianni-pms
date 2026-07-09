import React, { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { getHotelName } from '@/lib/brand';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface Balance { supplier_name: string; grn_count: number; payable: string | number; paid: string | number; balance: string | number; }
interface Payment { id: string; supplier_name: string; amount: string | number; method: string; gl_cash_account: string; reference: string | null; journal_id: string | null; paid_at: string; created_by: string | null; grn_number?: string | null; }
interface SupplierGrn { id: string; grn_number: string; receipt_date: string | null; supplier_invoice_number: string | null; posted_at: string | null; grn_total: string | number; paid: string | number; balance: string | number; line_count: string | number; }

// Supplier Payments — clear supplier (AP) balances against cash or bank.
// Drill into a supplier to verify and settle each GRN document individually,
// or pay at supplier level. Each payment books Dr 2100 AP / Cr 1000|1100.
export const SupplierPayments: React.FC = () => {
  const [balances, setBalances] = useState<Balance[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(false);
  const [paying, setPaying] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [grns, setGrns] = useState<SupplierGrn[]>([]);
  const [unallocated, setUnallocated] = useState(0);
  const [grnsLoading, setGrnsLoading] = useState(false);
  const [form, setForm] = useState({
    supplier_name: '', amount: '', method: 'cash' as 'cash' | 'bank', reference: '',
    date: new Date().toISOString().slice(0, 10),
    grn: null as null | { id: string; number: string; balance: number },
  });
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

  const loadGrns = React.useCallback(async (supplier: string) => {
    setGrnsLoading(true);
    try {
      const r = await fetch(`/api/ap/supplier-grns?supplier_name=${encodeURIComponent(supplier)}`).then(r => r.json());
      if (r.ok) { setGrns(r.rows || []); setUnallocated(Number(r.unallocated || 0)); }
      else toast({ title: 'GRN load failed', description: r.error });
    } catch (e: any) {
      toast({ title: 'GRN load failed', description: String(e?.message || e) });
    } finally { setGrnsLoading(false); }
  }, [toast]);

  const toggleDrill = (supplier: string) => {
    if (expanded === supplier) { setExpanded(null); setGrns([]); return; }
    setExpanded(supplier); setGrns([]); loadGrns(supplier);
  };

  const settleGrn = (supplier: string, g: SupplierGrn) => {
    setForm(f => ({
      ...f, supplier_name: supplier,
      amount: Number(g.balance).toFixed(2),
      reference: g.supplier_invoice_number || g.grn_number,
      grn: { id: g.id, number: g.grn_number, balance: Number(g.balance) },
    }));
    try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch { /* noop */ }
  };

  const selected = balances.find(b => b.supplier_name === form.supplier_name);
  const outstanding = form.grn ? form.grn.balance : (selected ? Number(selected.balance) : 0);
  const amt = Number(form.amount || 0);
  const overpay = amt > outstanding + 0.005 && (form.grn != null || selected != null);

  const pay = async () => {
    if (!form.supplier_name || !(amt > 0)) { toast({ title: 'Payment invalid', description: 'Pick a supplier and enter a positive amount.' }); return; }
    const target = form.grn ? `GRN ${form.grn.number}` : `${form.supplier_name} (on account)`;
    if (!window.confirm(`Pay $ ${amt.toFixed(2)} to ${form.supplier_name} — ${target} — from ${form.method === 'cash' ? 'Cash (1000)' : 'Bank (1100)'}?\nPosts: Dr 2100 Accounts Payable / Cr ${form.method === 'cash' ? '1000' : '1100'}.`)) return;
    setPaying(true);
    try {
      const r = await fetch('/api/ap/supplier-payments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supplier_name: form.supplier_name, amount: amt, method: form.method,
          reference: form.reference, date: form.date,
          grn_id: form.grn?.id || null, grn_number: form.grn?.number || null,
          created_by: user?.username || 'system',
        }),
      }).then(r => r.json());
      if (!r.ok) throw new Error(r.error || 'Payment failed');
      toast({ title: 'Payment recorded', description: `$ ${amt.toFixed(2)} — ${target} — journal ${r.journal_id}.` });
      setForm(f => ({ ...f, amount: '', reference: '', grn: null }));
      await load();
      if (expanded) await loadGrns(expanded);
    } catch (e: any) {
      toast({ title: 'Payment failed', description: String(e?.message || e) });
    } finally { setPaying(false); }
  };

  // ── Print & Export ──────────────────────────────────────────────────────────
  const esc = (s: any) => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));
  const d10 = (s: any) => (s ? String(s).slice(0, 10) : '—');

  const exportCSV = () => {
    const rows: any[][] = [
      [`${getHotelName()} — Supplier Payments`, `Generated ${new Date().toLocaleString()}`],
      [],
      ['SUPPLIER BALANCES'],
      ['Supplier', 'GRNs', 'Payable', 'Paid', 'Balance Owed'],
      ...balances.map(b => [b.supplier_name, b.grn_count, Number(b.payable).toFixed(2), Number(b.paid).toFixed(2), Number(b.balance).toFixed(2)]),
    ];
    if (expanded && grns.length) {
      rows.push([], [`GRN DETAIL — ${expanded}`],
        ['GRN #', 'Date', 'Supplier Invoice', 'Lines', 'Total', 'Paid', 'Balance'],
        ...grns.map(g => [g.grn_number, d10(g.receipt_date), g.supplier_invoice_number || '', g.line_count, Number(g.grn_total).toFixed(2), Number(g.paid).toFixed(2), Number(g.balance).toFixed(2)]));
      if (unallocated > 0) rows.push(['(On-account payments not allocated to a GRN)', '', '', '', '', unallocated.toFixed(2), '']);
    }
    rows.push([], ['PAYMENT HISTORY'],
      ['Date', 'Supplier', 'GRN #', 'Amount', 'From', 'Reference', 'Journal', 'By'],
      ...payments.map(p => [d10(p.paid_at), p.supplier_name, p.grn_number || '', Number(p.amount).toFixed(2), p.method === 'cash' ? 'Cash (1000)' : 'Bank (1100)', p.reference || '', p.journal_id || '', p.created_by || '']));
    const csv = rows.map(r => r.map(x => `"${String(x ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = `supplier_payments_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  const print = () => {
    const balHtml = balances.map(b =>
      `<tr><td>${esc(b.supplier_name)}</td><td class="r">${esc(b.grn_count)}</td><td class="r">$${Number(b.payable).toFixed(2)}</td><td class="r">$${Number(b.paid).toFixed(2)}</td><td class="r"><b>$${Number(b.balance).toFixed(2)}</b></td></tr>`).join('');
    const grnHtml = (expanded && grns.length)
      ? `<h2>GRN Detail — ${esc(expanded)}</h2>
         <table><thead><tr><th>GRN #</th><th>Date</th><th>Supplier Invoice</th><th class="r">Lines</th><th class="r">Total</th><th class="r">Paid</th><th class="r">Balance</th></tr></thead><tbody>
         ${grns.map(g => `<tr><td>${esc(g.grn_number)}</td><td>${esc(d10(g.receipt_date))}</td><td>${esc(g.supplier_invoice_number || '—')}</td><td class="r">${esc(g.line_count)}</td><td class="r">$${Number(g.grn_total).toFixed(2)}</td><td class="r">$${Number(g.paid).toFixed(2)}</td><td class="r"><b>$${Number(g.balance).toFixed(2)}</b></td></tr>`).join('')}
         ${unallocated > 0 ? `<tr><td colspan="5" style="color:#666">On-account payments not allocated to a GRN</td><td class="r">$${unallocated.toFixed(2)}</td><td></td></tr>` : ''}
         </tbody></table>` : '';
    const payHtml = payments.slice(0, 100).map(p =>
      `<tr><td>${esc(d10(p.paid_at))}</td><td>${esc(p.supplier_name)}</td><td>${esc(p.grn_number || '—')}</td><td class="r">$${Number(p.amount).toFixed(2)}</td><td>${p.method === 'cash' ? 'Cash (1000)' : 'Bank (1100)'}</td><td>${esc(p.reference || '—')}</td></tr>`).join('');
    const html = `<!doctype html><html><head><title>Supplier Payments — ${esc(getHotelName())}</title><style>
      body{font-family:system-ui,-apple-system,sans-serif;padding:24px;color:#111}
      h1{font-size:20px;margin:0 0 2px} h2{font-size:14px;margin:20px 0 4px} .sub{color:#666;font-size:12px;margin-bottom:12px}
      table{width:100%;border-collapse:collapse;font-size:12px;margin-top:4px}
      th,td{border-bottom:1px solid #ddd;padding:5px 8px;text-align:left}
      th{background:#f5f5f7;font-size:10px;text-transform:uppercase;color:#555}
      .r{text-align:right}
    </style></head><body>
      <h1>${esc(getHotelName())} — Supplier Payments</h1>
      <div class="sub">Accounts payable settlement statement · Printed ${new Date().toLocaleString()}</div>
      <h2>Supplier Balances</h2>
      <table><thead><tr><th>Supplier</th><th class="r">GRNs</th><th class="r">Payable</th><th class="r">Paid</th><th class="r">Balance Owed</th></tr></thead><tbody>${balHtml}</tbody></table>
      ${grnHtml}
      <h2>Payment History</h2>
      <table><thead><tr><th>Date</th><th>Supplier</th><th>GRN #</th><th class="r">Amount</th><th>From</th><th>Reference</th></tr></thead><tbody>${payHtml}</tbody></table>
    </body></html>`;
    const w = window.open('', '_blank');
    if (w) { w.document.write(html); w.document.close(); w.focus(); setTimeout(() => w.print(), 300); }
  };

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">Supplier Payments</h2>
          <div className="text-xs text-gray-500">Drill into a supplier (▶) to verify and settle each GRN individually, or pay on account. Each payment posts Dr 2100 Accounts Payable / Cr 1000 Cash or 1100 Bank.</div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="ds-button-compact" onClick={exportCSV} disabled={balances.length === 0}>Export CSV</Button>
          <Button variant="outline" className="ds-button-compact" onClick={print} disabled={balances.length === 0}>🖨 Print</Button>
        </div>
      </div>

      {/* Payment form */}
      <div className="border rounded p-4 bg-gray-50">
        <div className="font-semibold text-sm mb-2">Record Payment</div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="text-xs block">Supplier</label>
            <select className="border rounded px-2 py-1.5 text-sm min-w-[220px]" value={form.supplier_name}
              onChange={e => setForm(f => ({ ...f, supplier_name: e.target.value, grn: null }))}>
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
          {selected && !form.grn && (
            <Button variant="outline" className="ds-button-compact" disabled={Number(selected.balance) <= 0}
              onClick={() => setForm(f => ({ ...f, amount: Number(selected.balance).toFixed(2) }))}>Pay Full Balance</Button>
          )}
        </div>
        {form.grn && (
          <div className="mt-2 inline-flex items-center gap-2 px-2 py-1 rounded bg-indigo-100 text-indigo-800 text-xs">
            Settling <span className="font-mono font-semibold">{form.grn.number}</span> (outstanding $ {form.grn.balance.toFixed(2)})
            <button onClick={() => setForm(f => ({ ...f, grn: null }))} className="font-bold hover:text-red-600" title="Clear GRN allocation — pay on account instead">✕</button>
          </div>
        )}
        {overpay && <div className="text-xs text-amber-700 mt-2">⚠ Amount exceeds the outstanding {form.grn ? `balance of ${form.grn.number}` : 'supplier balance'} ($ {outstanding.toFixed(2)}){form.grn ? ' — the server will reject over-settling a document.' : ' — this will leave the supplier in credit.'}</div>}
      </div>

      {/* Balances with GRN drill-down */}
      <div className="border rounded overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="bg-gray-50 text-gray-600">
            <th className="p-2 w-8"></th>
            <th className="p-2 text-left">Supplier</th><th className="p-2 text-right">GRNs</th>
            <th className="p-2 text-right">Payable</th><th className="p-2 text-right">Paid</th>
            <th className="p-2 text-right">Balance Owed</th><th className="p-2"></th>
          </tr></thead>
          <tbody>
            {balances.map(b => (
              <React.Fragment key={b.supplier_name}>
                <tr className="border-t">
                  <td className="p-2 text-center">
                    <button onClick={() => toggleDrill(b.supplier_name)} title="Verify each GRN"
                      className="text-indigo-600 font-semibold">{expanded === b.supplier_name ? '▼' : '▶'}</button>
                  </td>
                  <td className="p-2 font-medium">{b.supplier_name}</td>
                  <td className="p-2 text-right">{b.grn_count}</td>
                  <td className="p-2 text-right font-mono">$ {Number(b.payable).toFixed(2)}</td>
                  <td className="p-2 text-right font-mono text-green-700">$ {Number(b.paid).toFixed(2)}</td>
                  <td className={`p-2 text-right font-mono font-semibold ${Number(b.balance) > 0 ? 'text-red-700' : 'text-green-700'}`}>$ {Number(b.balance).toFixed(2)}</td>
                  <td className="p-2">
                    {Number(b.balance) > 0 && (
                      <button className="text-indigo-600 text-xs font-semibold"
                        onClick={() => setForm(f => ({ ...f, supplier_name: b.supplier_name, amount: Number(b.balance).toFixed(2), grn: null }))}>
                        Settle All →
                      </button>
                    )}
                  </td>
                </tr>
                {expanded === b.supplier_name && (
                  <tr className="bg-indigo-50/40">
                    <td></td>
                    <td colSpan={6} className="p-3">
                      {grnsLoading ? <div className="text-xs text-gray-500">Loading GRNs…</div> : (
                        <>
                          <div className="text-xs font-semibold text-gray-600 mb-1">Posted GRNs — verify and settle each document</div>
                          <table className="w-full text-xs">
                            <thead><tr className="text-gray-500">
                              <th className="p-1.5 text-left">GRN #</th><th className="p-1.5 text-left">Date</th>
                              <th className="p-1.5 text-left">Supplier Invoice</th><th className="p-1.5 text-right">Lines</th>
                              <th className="p-1.5 text-right">Total</th><th className="p-1.5 text-right">Paid</th>
                              <th className="p-1.5 text-right">Balance</th><th className="p-1.5 text-center">Action</th>
                            </tr></thead>
                            <tbody>
                              {grns.map(g => {
                                const bal = Number(g.balance);
                                return (
                                  <tr key={g.id} className="border-t border-indigo-100">
                                    <td className="p-1.5 font-mono">{g.grn_number}</td>
                                    <td className="p-1.5">{d10(g.receipt_date)}</td>
                                    <td className="p-1.5 text-gray-600">{g.supplier_invoice_number || '—'}</td>
                                    <td className="p-1.5 text-right">{g.line_count}</td>
                                    <td className="p-1.5 text-right font-mono">$ {Number(g.grn_total).toFixed(2)}</td>
                                    <td className="p-1.5 text-right font-mono text-green-700">$ {Number(g.paid).toFixed(2)}</td>
                                    <td className={`p-1.5 text-right font-mono font-semibold ${bal > 0.005 ? 'text-red-700' : 'text-green-700'}`}>$ {bal.toFixed(2)}</td>
                                    <td className="p-1.5 text-center">
                                      {bal > 0.005
                                        ? <button className="text-indigo-600 font-semibold" onClick={() => settleGrn(b.supplier_name, g)}>Settle this GRN →</button>
                                        : <span className="text-green-700 text-[10px] font-semibold">✓ SETTLED</span>}
                                    </td>
                                  </tr>
                                );
                              })}
                              {grns.length === 0 && <tr><td colSpan={8} className="p-2 text-center text-gray-400">No posted GRNs for this supplier.</td></tr>}
                            </tbody>
                          </table>
                          {unallocated > 0 && (
                            <div className="text-[11px] text-amber-700 mt-2">
                              ⚠ $ {unallocated.toFixed(2)} of earlier payments were made on account (not allocated to a specific GRN) — GRN balances above don't reflect them.
                            </div>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
            {balances.length === 0 && !loading && <tr><td colSpan={7} className="p-4 text-center text-gray-500">No posted GRNs or payments yet.</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Payment history */}
      <div className="border rounded overflow-x-auto">
        <div className="px-3 py-2 font-semibold text-sm bg-gray-50 border-b">Payment History</div>
        <table className="w-full text-xs">
          <thead><tr className="text-gray-500">
            <th className="p-2 text-left">Date</th><th className="p-2 text-left">Supplier</th>
            <th className="p-2 text-left">GRN #</th>
            <th className="p-2 text-right">Amount</th><th className="p-2 text-left">From</th>
            <th className="p-2 text-left">Reference</th><th className="p-2 text-left">Journal</th><th className="p-2 text-left">By</th>
          </tr></thead>
          <tbody>
            {payments.map(p => (
              <tr key={p.id} className="border-t">
                <td className="p-2">{d10(p.paid_at)}</td>
                <td className="p-2">{p.supplier_name}</td>
                <td className="p-2 font-mono">{p.grn_number || <span className="text-gray-400">on account</span>}</td>
                <td className="p-2 text-right font-mono">$ {Number(p.amount).toFixed(2)}</td>
                <td className="p-2">{p.method === 'cash' ? 'Cash (1000)' : 'Bank (1100)'}</td>
                <td className="p-2 text-gray-600">{p.reference || '—'}</td>
                <td className="p-2 font-mono text-[10px]">{p.journal_id || '—'}</td>
                <td className="p-2 text-gray-600">{p.created_by || '—'}</td>
              </tr>
            ))}
            {payments.length === 0 && <tr><td colSpan={8} className="p-4 text-center text-gray-500">No payments recorded yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default SupplierPayments;
