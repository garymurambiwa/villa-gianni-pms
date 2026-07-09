import React, { useEffect, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { getHotelName } from '@/lib/brand';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface StmtRow {
  tx_type: 'GRN' | 'PAYMENT';
  id: string;
  doc_number: string;
  tx_date: string;
  reference: string | null;
  charge: string | number;
  payment: string | number;
  method: string | null;
  journal_id: string | null;
  balance: number;
}

const firstOfMonth = () => new Date().toISOString().slice(0, 8) + '01';
const today = () => new Date().toISOString().slice(0, 10);
const d10 = (s: any) => (s ? String(s).slice(0, 10) : '—');

// Supplier Statement — every transaction (GRN charges & payments) by date with a
// running balance. Rows are editable (payment date/reference; GRN invoice #),
// printable and exportable.
export const SupplierStatement: React.FC = () => {
  const [suppliers, setSuppliers] = useState<string[]>([]);
  const [supplier, setSupplier] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [rows, setRows] = useState<StmtRow[]>([]);
  const [totals, setTotals] = useState({ charges: 0, payments: 0, closing: 0 });
  const [loading, setLoading] = useState(false);
  // inline edit: which row + draft values
  const [editRow, setEditRow] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ reference: string; date: string }>({ reference: '', date: '' });
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    fetch('/api/ap/supplier-balances').then(r => r.json()).then(d => {
      if (d.ok) setSuppliers((d.rows || []).map((b: any) => b.supplier_name));
    }).catch(() => {});
  }, []);

  const load = React.useCallback(async () => {
    if (!supplier) { setRows([]); return; }
    setLoading(true);
    try {
      const qs = new URLSearchParams({ supplier_name: supplier });
      if (from) qs.set('from', from);
      if (to) qs.set('to', to);
      const r = await fetch(`/api/ap/supplier-statement?${qs}`).then(r => r.json());
      if (!r.ok) throw new Error(r.error || 'Load failed');
      setRows(r.rows || []);
      setTotals({ charges: r.totalCharges || 0, payments: r.totalPayments || 0, closing: r.closingBalance || 0 });
    } catch (e: any) {
      toast({ title: 'Load failed', description: String(e?.message || e) });
    } finally { setLoading(false); }
  }, [supplier, from, to, toast]);

  useEffect(() => { load(); }, [load]);

  const startEdit = (r: StmtRow) => {
    setEditRow(`${r.tx_type}_${r.id}`);
    setEditDraft({ reference: r.reference || '', date: d10(r.tx_date) });
  };

  const saveEdit = async (r: StmtRow) => {
    setSaving(true);
    try {
      const url = r.tx_type === 'PAYMENT'
        ? `/api/ap/supplier-payments/${encodeURIComponent(r.id)}`
        : `/api/ap/grn-invoice/${encodeURIComponent(r.id)}`;
      const body = r.tx_type === 'PAYMENT'
        ? { reference: editDraft.reference, paid_at: editDraft.date }
        : { supplier_invoice_number: editDraft.reference };
      const res = await fetch(url, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }).then(x => x.json());
      if (!res.ok) throw new Error(res.error || 'Save failed');
      toast({ title: 'Updated', description: `${r.doc_number} statement details saved.` });
      setEditRow(null);
      await load();
    } catch (e: any) {
      toast({ title: 'Save failed', description: String(e?.message || e) });
    } finally { setSaving(false); }
  };

  const esc = (s: any) => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));

  const exportCSV = () => {
    const data = [
      [`${getHotelName()} — Supplier Statement`, supplier],
      [`Period`, `${from || 'start'} → ${to || today()}`, `Generated ${new Date().toLocaleString()}`],
      [],
      ['Date', 'Type', 'Document', 'Reference', 'Charges', 'Payments', 'Balance'],
      ...rows.map(r => [d10(r.tx_date), r.tx_type, r.doc_number, r.reference || '',
        Number(r.charge) ? Number(r.charge).toFixed(2) : '', Number(r.payment) ? Number(r.payment).toFixed(2) : '', r.balance.toFixed(2)]),
      [],
      ['Totals', '', '', '', totals.charges.toFixed(2), totals.payments.toFixed(2), totals.closing.toFixed(2)],
    ];
    const csv = data.map(r => r.map(x => `"${String(x ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = `supplier_statement_${supplier.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}_${today()}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  const print = () => {
    const body = rows.map(r =>
      `<tr><td>${esc(d10(r.tx_date))}</td><td>${r.tx_type === 'GRN' ? 'Goods Received' : `Payment (${esc(r.method || '')})`}</td><td>${esc(r.doc_number)}</td><td>${esc(r.reference || '—')}</td><td class="r">${Number(r.charge) ? '$' + Number(r.charge).toFixed(2) : ''}</td><td class="r">${Number(r.payment) ? '$' + Number(r.payment).toFixed(2) : ''}</td><td class="r"><b>$${r.balance.toFixed(2)}</b></td></tr>`).join('');
    const html = `<!doctype html><html><head><title>Supplier Statement — ${esc(supplier)}</title><style>
      body{font-family:system-ui,-apple-system,sans-serif;padding:24px;color:#111}
      h1{font-size:20px;margin:0 0 2px} .sub{color:#666;font-size:12px;margin-bottom:14px}
      table{width:100%;border-collapse:collapse;font-size:12px}
      th,td{border-bottom:1px solid #ddd;padding:5px 8px;text-align:left}
      th{background:#f5f5f7;font-size:10px;text-transform:uppercase;color:#555}
      .r{text-align:right} .totals{margin-top:14px;font-size:13px} .totals b{font-size:16px}
    </style></head><body>
      <h1>${esc(getHotelName())} — Supplier Statement</h1>
      <div class="sub"><b>${esc(supplier)}</b> · Period ${esc(from || 'start')} → ${esc(to || today())} · Printed ${new Date().toLocaleString()}</div>
      <table><thead><tr><th>Date</th><th>Type</th><th>Document</th><th>Reference</th><th class="r">Charges</th><th class="r">Payments</th><th class="r">Balance</th></tr></thead>
      <tbody>${body}</tbody></table>
      <div class="totals">Charges: <b>$${totals.charges.toFixed(2)}</b> &nbsp;·&nbsp; Payments: <b>$${totals.payments.toFixed(2)}</b> &nbsp;·&nbsp; Closing balance: <b>$${totals.closing.toFixed(2)}</b></div>
    </body></html>`;
    const w = window.open('', '_blank');
    if (w) { w.document.write(html); w.document.close(); w.focus(); setTimeout(() => w.print(), 300); }
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">Supplier Statement</h2>
          <div className="text-xs text-gray-500">All transactions by date — goods received, amounts paid and running balance. Click ✎ to correct a reference or payment date.</div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="ds-button-compact" onClick={exportCSV} disabled={rows.length === 0}>Export CSV</Button>
          <Button variant="outline" className="ds-button-compact" onClick={print} disabled={rows.length === 0}>🖨 Print</Button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="text-xs block">Supplier</label>
          <select className="border rounded px-2 py-1.5 text-sm min-w-[240px]" value={supplier} onChange={e => setSupplier(e.target.value)}>
            <option value="">Select supplier…</option>
            {suppliers.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div><label className="text-xs block">From</label><Input type="date" className="ds-input-compact" value={from} onChange={e => setFrom(e.target.value)} /></div>
        <div><label className="text-xs block">To</label><Input type="date" className="ds-input-compact" value={to} onChange={e => setTo(e.target.value)} /></div>
        <Button variant="outline" className="ds-button-compact" onClick={load} disabled={loading || !supplier}>{loading ? 'Loading…' : 'Refresh'}</Button>
        {rows.length > 0 && (
          <div className="text-xs text-gray-600 ml-auto">
            Charges <span className="font-mono font-semibold">$ {totals.charges.toFixed(2)}</span> ·
            Payments <span className="font-mono font-semibold text-green-700"> $ {totals.payments.toFixed(2)}</span> ·
            Closing <span className={`font-mono font-semibold ${totals.closing > 0 ? 'text-red-700' : 'text-green-700'}`}> $ {totals.closing.toFixed(2)}</span>
          </div>
        )}
      </div>

      {!supplier ? (
        <div className="text-sm text-gray-500 border rounded p-6 bg-gray-50 text-center">Select a supplier to view their statement.</div>
      ) : (
        <div className="border rounded overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="bg-gray-50 text-gray-600">
              <th className="p-2 text-left">Date</th><th className="p-2 text-left">Type</th>
              <th className="p-2 text-left">Document</th><th className="p-2 text-left">Reference</th>
              <th className="p-2 text-right">Charges</th><th className="p-2 text-right">Payments</th>
              <th className="p-2 text-right">Balance</th><th className="p-2 text-center">Edit</th>
            </tr></thead>
            <tbody>
              {rows.map(r => {
                const key = `${r.tx_type}_${r.id}`;
                const isEdit = editRow === key;
                return (
                  <React.Fragment key={key}>
                    <tr className={`border-t ${r.tx_type === 'PAYMENT' ? 'bg-green-50/40' : ''}`}>
                      <td className="p-2 whitespace-nowrap">{d10(r.tx_date)}</td>
                      <td className="p-2">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${r.tx_type === 'GRN' ? 'bg-indigo-100 text-indigo-700' : 'bg-green-100 text-green-700'}`}>
                          {r.tx_type === 'GRN' ? 'GOODS RECEIVED' : `PAYMENT · ${(r.method || '').toUpperCase()}`}
                        </span>
                      </td>
                      <td className="p-2 font-mono">{r.doc_number}</td>
                      <td className="p-2 text-gray-600">{r.reference || '—'}</td>
                      <td className="p-2 text-right font-mono">{Number(r.charge) ? `$ ${Number(r.charge).toFixed(2)}` : ''}</td>
                      <td className="p-2 text-right font-mono text-green-700">{Number(r.payment) ? `$ ${Number(r.payment).toFixed(2)}` : ''}</td>
                      <td className={`p-2 text-right font-mono font-semibold ${r.balance > 0 ? '' : 'text-green-700'}`}>$ {r.balance.toFixed(2)}</td>
                      <td className="p-2 text-center">
                        <button className="text-amber-700 font-semibold" onClick={() => (isEdit ? setEditRow(null) : startEdit(r))}
                          title={r.tx_type === 'PAYMENT' ? 'Edit payment date / reference' : 'Edit supplier invoice number'}>
                          {isEdit ? 'Close' : '✎ Edit'}
                        </button>
                      </td>
                    </tr>
                    {isEdit && (
                      <tr className="bg-amber-50/70">
                        <td colSpan={8} className="p-2">
                          <div className="flex flex-wrap items-end gap-2">
                            {r.tx_type === 'PAYMENT' && (
                              <div><label className="text-[10px] block">Payment date</label>
                                <Input type="date" className="ds-input-compact" value={editDraft.date} onChange={e => setEditDraft(d => ({ ...d, date: e.target.value }))} /></div>
                            )}
                            <div><label className="text-[10px] block">{r.tx_type === 'PAYMENT' ? 'Reference' : 'Supplier invoice number'}</label>
                              <Input className="ds-input-compact w-56" value={editDraft.reference} onChange={e => setEditDraft(d => ({ ...d, reference: e.target.value }))} /></div>
                            <Button className="ds-button-compact bg-amber-600 text-white" disabled={saving} onClick={() => saveEdit(r)}>{saving ? 'Saving…' : 'Save'}</Button>
                            <Button variant="outline" className="ds-button-compact" onClick={() => setEditRow(null)}>Cancel</Button>
                            <span className="text-[10px] text-gray-500">Amounts are posted GL facts — use a reclass or new payment to change values.</span>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
              {rows.length === 0 && !loading && <tr><td colSpan={8} className="p-4 text-center text-gray-500">No transactions in range.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default SupplierStatement;
