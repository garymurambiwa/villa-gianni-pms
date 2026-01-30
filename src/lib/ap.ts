// Accounts Payable (AP) & Expense Management service (localStorage-backed)
import gl from '@/lib/glAccounting';

export type PaymentMethodAP = 'ACH' | 'CHECK';
export type APStatus = 'PENDING' | 'APPROVED' | 'PAID' | 'REJECTED';

export interface Vendor {
  vendor_id: string;
  vendor_name: string;
  contact_info?: string;
  tax_id?: string;
  default_gl_account_id?: string;
  payment_terms?: string; // e.g., NET30
  is_active: boolean;
}

export interface InvoiceHeader {
  invoice_id: string;
  vendor_id: string;
  invoice_number: string;
  invoice_date: string; // ISO date
  due_date: string; // ISO date
  total_amount: number;
  status: APStatus;
  approver_user_id?: string;
  purchase_order_id?: string;
  rejection_reason?: string;
}

export interface InvoiceLineItem {
  line_item_id: string;
  invoice_id: string;
  gl_account_code: string;
  cost_center_id: string;
  line_amount: number;
  description?: string;
  is_capital?: boolean;
}

export interface PaymentBatch {
  batch_id: string;
  batch_date: string;
  payment_method: PaymentMethodAP;
  total_amount: number;
  status: 'PROCESSING' | 'COMPLETED';
  invoice_ids: string[];
  bank_account_id?: string;
}

const K_VENDORS = 'corepms_ap_vendors';
const K_INVOICES = 'corepms_ap_invoices';
const K_LINES = 'corepms_ap_line_items';
const K_BATCHES = 'corepms_ap_batches';

const readJSON = <T>(key: string, fallback: T): T => { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; } };
const writeJSON = (key: string, value: any) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };

export const listVendors = (): Vendor[] => readJSON<Vendor[]>(K_VENDORS, []);
export const setVendors = (rows: Vendor[]) => writeJSON(K_VENDORS, rows);
export const upsertVendor = (v: Omit<Vendor,'vendor_id'> & { vendor_id?: string }): Vendor => {
  const id = v.vendor_id || `V${Date.now()}`;
  const next: Vendor = { vendor_id: id, vendor_name: v.vendor_name, contact_info: v.contact_info, tax_id: v.tax_id, default_gl_account_id: v.default_gl_account_id, payment_terms: v.payment_terms || 'NET30', is_active: v.is_active ?? true };
  const list = listVendors();
  const idx = list.findIndex(x => x.vendor_id === id);
  if (idx >= 0) list[idx] = next; else list.unshift(next);
  setVendors(list);
  return next;
};

export const listInvoices = (): InvoiceHeader[] => readJSON<InvoiceHeader[]>(K_INVOICES, []);
export const setInvoices = (rows: InvoiceHeader[]) => writeJSON(K_INVOICES, rows);
export const listLineItems = (): InvoiceLineItem[] => readJSON<InvoiceLineItem[]>(K_LINES, []);
export const setLineItems = (rows: InvoiceLineItem[]) => writeJSON(K_LINES, rows);
export const listBatches = (): PaymentBatch[] => readJSON<PaymentBatch[]>(K_BATCHES, []);
export const setBatches = (rows: PaymentBatch[]) => writeJSON(K_BATCHES, rows);

export const createInvoice = (header: Omit<InvoiceHeader,'invoice_id'|'status'>, items: Omit<InvoiceLineItem,'line_item_id'|'invoice_id'>[]): { ok: boolean; error?: string; invoice?: InvoiceHeader } => {
  // Validation: totals match
  const total = Number(header.total_amount || 0);
  const sum = items.reduce((s, i) => s + Number(i.line_amount || 0), 0);
  if (Number(total.toFixed(2)) !== Number(sum.toFixed(2))) return { ok:false, error:'Allocated total must equal invoice total' };
  // Duplicate check
  if (listInvoices().some(inv => inv.invoice_number.trim().toLowerCase() === header.invoice_number.trim().toLowerCase())) return { ok:false, error:'Duplicate invoice number' };
  const id = `INV${Date.now()}`;
  const status: APStatus = 'PENDING';
  const inv: InvoiceHeader = { invoice_id: id, vendor_id: header.vendor_id, invoice_number: header.invoice_number, invoice_date: header.invoice_date, due_date: header.due_date, total_amount: total, status, approver_user_id: header.approver_user_id, purchase_order_id: header.purchase_order_id };
  setInvoices([inv, ...listInvoices()].slice(0, 2000));
  const li: InvoiceLineItem[] = items.map(i => ({ line_item_id: `LI${id}_${Math.random().toString(36).slice(2,8)}`, invoice_id: id, gl_account_code: i.gl_account_code, cost_center_id: i.cost_center_id, line_amount: Number(i.line_amount || 0), description: i.description, is_capital: i.is_capital }));
  setLineItems([ ...li, ...listLineItems() ].slice(0, 5000));
  return { ok:true, invoice: inv };
};

export const getInvoiceItems = (invoice_id: string): InvoiceLineItem[] => listLineItems().filter(l => l.invoice_id === invoice_id);

export const approveInvoice = (invoice_id: string, userRole: string, userId: string): { ok: boolean; error?: string } => {
  const rows = listInvoices();
  const idx = rows.findIndex(r => r.invoice_id === invoice_id);
  if (idx === -1) return { ok:false, error:'Invoice not found' };
  const inv = rows[idx];
  // Approval rule: over 1000 requires Controller
  const needsController = inv.total_amount > 1000;
  const normalized = String(userRole || '').toLowerCase();
  if (needsController && normalized !== 'controller' && normalized !== 'admin') return { ok:false, error:'Controller approval required' };
  inv.status = 'APPROVED'; inv.approver_user_id = userId; rows[idx] = inv; setInvoices(rows);
  // GL entry: Debit expense accounts, Credit AP Control (2100)
  const items = getInvoiceItems(inv.invoice_id);
  const lines = items.map(it => ({ accountId: it.gl_account_code, description: `Invoice ${inv.invoice_number} ${inv.vendor_id}`, debit: Number(it.line_amount || 0), credit: 0 }));
  const apControl = gl.getMappings().AP_CONTROL || '2100';
  lines.push({ accountId: apControl, description: `AP Control ${inv.invoice_number}`, debit: 0, credit: Number(inv.total_amount) });
  if (gl.isBalanced(lines)) {
    gl.appendLedger({ id: `GL_AP_${inv.invoice_id}`, date: inv.invoice_date, lines, reference: `AP Approved ${inv.invoice_number}`, attachments: { businessDate: inv.invoice_date } });
  }
  return { ok:true };
};

export const rejectInvoice = (invoice_id: string, reason: string): { ok:boolean; error?: string } => {
  const rows = listInvoices(); const idx = rows.findIndex(r => r.invoice_id === invoice_id);
  if (idx === -1) return { ok:false, error:'Invoice not found' };
  rows[idx].status = 'REJECTED'; rows[idx].rejection_reason = reason; setInvoices(rows); return { ok:true };
};

export const createPaymentBatch = (invoice_ids: string[], method: PaymentMethodAP, bankAccountId?: string): { ok: boolean; error?: string; batch?: PaymentBatch } => {
  const invs = listInvoices().filter(i => invoice_ids.includes(i.invoice_id) && i.status === 'APPROVED');
  if (invs.length === 0) return { ok:false, error:'No approved invoices selected' };
  const total = invs.reduce((s,i)=> s + Number(i.total_amount||0), 0);
  const batch: PaymentBatch = { batch_id: `PB${Date.now()}`, batch_date: new Date().toISOString().slice(0,10), payment_method: method, total_amount: Number(total.toFixed(2)), status: 'PROCESSING', invoice_ids, bank_account_id: bankAccountId };
  setBatches([batch, ...listBatches()].slice(0, 500));
  // GL entry: Debit AP Control (2100), Credit Cash/Bank (1100)
  const apControl = gl.getMappings().AP_CONTROL || '2100';
  const bank = bankAccountId || gl.getMappings().BANK || '1100';
  const lines = [ { accountId: apControl, description: `AP Payment Batch ${batch.batch_id}`, debit: Number(total), credit: 0 }, { accountId: bank, description: `Cash/Bank ${batch.batch_id}`, debit: 0, credit: Number(total) } ];
  if (gl.isBalanced(lines)) {
    gl.appendLedger({ id: `GL_PB_${batch.batch_id}`, date: batch.batch_date, lines, reference: `AP Payment Batch ${batch.batch_id}`, attachments: { businessDate: batch.batch_date } });
  }
  // Mark invoices as PAID
  const rows = listInvoices(); invs.forEach(i => { const idx = rows.findIndex(r=> r.invoice_id===i.invoice_id); if (idx>=0) rows[idx].status='PAID'; }); setInvoices(rows);
  batch.status = 'COMPLETED'; setBatches([batch, ...listBatches().filter(b=> b.batch_id!==batch.batch_id)]);
  return { ok:true, batch };
};

export const validatePurchaseOrderVariance = (invoice_id: string, purchaseOrderAmount: number): { ok: boolean; variancePct: number; requiresController: boolean } => {
  const inv = listInvoices().find(i=> i.invoice_id===invoice_id); if (!inv) return { ok:false, variancePct: 0, requiresController: false };
  const invAmt = Number(inv.total_amount || 0);
  const variancePct = purchaseOrderAmount ? Number((((invAmt - purchaseOrderAmount) / purchaseOrderAmount) * 100).toFixed(2)) : 0;
  const requiresController = Math.abs(variancePct) > 10;
  return { ok:true, variancePct, requiresController };
};

export default {
  listVendors,
  upsertVendor,
  listInvoices,
  listLineItems,
  listBatches,
  createInvoice,
  getInvoiceItems,
  approveInvoice,
  rejectInvoice,
  createPaymentBatch,
  validatePurchaseOrderVariance,
};

