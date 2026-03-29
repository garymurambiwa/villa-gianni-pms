import { User } from '@/types';
import { db } from '@/lib/db';
import gl from '@/lib/glAccounting';
import budgetSvc from '@/lib/budgetService';
import { isManager } from '@/lib/permissions';

export type PaymentMethod = 'Cash' | 'BankTransfer' | 'CreditCard';
export interface ExpenseComment { id: string; author?: string; text: string; timestamp: string }
export interface ExpenseTxn {
  id: string;
  date: string; // ISO date
  vendorId: string;
  invoiceRef: string;
  paymentMethod: PaymentMethod;
  amount: number;
  currency?: string;
  glAccountId: string;
  costCenter: string; // Rooms, F&B, Admin, Sales
  description?: string;
  attachmentName?: string;
  attachmentDataURL?: string; // base64 or object URL
  status: 'draft' | 'pending_approval' | 'approved' | 'posted';
  approvedBy?: string;
  approvedAt?: string;
  postedAt?: string;
  createdBy?: string;
  comments?: ExpenseComment[];
}

const APPROVAL_THRESHOLD = 500; // configurable

// HELPER: Map DB row to ExpenseTxn
const mapRow = (r: any): ExpenseTxn => ({
  id: r.id,
  date: typeof r.date === 'string' ? r.date : r.date.toISOString().split('T')[0],
  vendorId: r.vendor_id,
  invoiceRef: r.invoice_ref,
  paymentMethod: r.payment_method as PaymentMethod,
  amount: Number(r.amount),
  currency: r.currency,
  glAccountId: r.gl_account_id,
  costCenter: r.cost_center,
  description: r.description,
  attachmentName: r.attachment_name,
  attachmentDataURL: r.attachment_url,
  status: r.status,
  approvedBy: r.approved_by,
  approvedAt: r.approved_at,
  postedAt: r.posted_at,
  createdBy: r.created_by,
  comments: r.comments ? (typeof r.comments === 'string' ? JSON.parse(r.comments) : r.comments) : []
});

export const listExpenses = async (): Promise<ExpenseTxn[]> => {
  try {
    const res = await db.query('SELECT * FROM expenses ORDER BY date DESC, inserted_at DESC');
    if ('rows' in res) {
      return res.rows.map(mapRow);
    }
    return [];
  } catch (e) {
    console.error('Failed to list expenses:', e);
    return [];
  }
};

export const findByInvoice = async (invoiceRef: string): Promise<ExpenseTxn | undefined> => {
  try {
    const res = await db.query('SELECT * FROM expenses WHERE LOWER(invoice_ref::text) = LOWER(?::text)', [invoiceRef]);
    if ('rows' in res && res.rows.length > 0) {
      return mapRow(res.rows[0]);
    }
  } catch { }
  return undefined;
};

export const addExpense = async (payload: Omit<ExpenseTxn, 'id' | 'status' | 'approvedBy' | 'approvedAt' | 'postedAt'>, user?: User | null): Promise<{ ok: boolean; error?: string; expense?: ExpenseTxn }> => {
  const { date, vendorId, invoiceRef, paymentMethod, amount, glAccountId, costCenter } = payload;
  if (!date || !vendorId || !invoiceRef || !paymentMethod || !amount || !glAccountId || !costCenter) return { ok: false, error: 'Missing required fields' };

  if (await findByInvoice(invoiceRef)) return { ok: false, error: 'Duplicate invoice reference' };

  const status: ExpenseTxn['status'] = amount >= APPROVAL_THRESHOLD && !isManager(user?.role) ? 'pending_approval' : 'approved';
  const now = new Date().toISOString();
  const id = `EXP${Date.now()}`;

  try {
    await db.query(
      `INSERT INTO expenses 
          (id, date, vendor_id, invoice_ref, payment_method, amount, currency, gl_account_id, cost_center, description, attachment_name, attachment_url, status, approved_by, approved_at, created_by, comments)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb)`,
      [
        id,
        date,
        vendorId,
        invoiceRef,
        paymentMethod,
        amount,
        payload.currency || 'USD',
        glAccountId,
        costCenter,
        payload.description || null,
        payload.attachmentName || null,
        payload.attachmentDataURL || null,
        status,
        status === 'approved' ? (user?.username || 'system') : null,
        status === 'approved' ? now : null,
        user?.username || null,
        JSON.stringify(payload.comments || [])
      ]
    );

    const row: ExpenseTxn = {
      id, status, date, vendorId, invoiceRef, paymentMethod, amount: Number(amount), currency: payload.currency, glAccountId, costCenter, description: payload.description, attachmentName: payload.attachmentName, attachmentDataURL: payload.attachmentDataURL, createdBy: user?.username
    };
    if (status === 'approved') { row.approvedBy = user?.username; row.approvedAt = now; }

    return { ok: true, expense: row };
  } catch (e: any) {
    console.error('Failed to add expense:', e);
    return { ok: false, error: e.message || 'Database error' };
  }
};

export const approveExpense = async (id: string, user?: User | null): Promise<{ ok: boolean; error?: string }> => {
  if (!isManager(user?.role)) return { ok: false, error: 'Unauthorized' };
  try {
    const now = new Date().toISOString();
    const res = await db.query(
      "UPDATE expenses SET status = 'approved', approved_by = ?, approved_at = ? WHERE id = ?",
      [user?.username || 'manager', now, id]
    );
    if ('error' in res) return { ok: false, error: (res as any).error };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
};

export const addComment = async (id: string, author: string | undefined, text: string): Promise<{ ok: boolean; error?: string }> => {
  try {
    // Fetch existing comments
    const res = await db.query('SELECT comments FROM expenses WHERE id = ?', [id]);
    if (!('rows' in res) || res.rows.length === 0) return { ok: false, error: 'Not found' };

    let comments: ExpenseComment[] = [];
    const raw = res.rows[0].comments;
    if (raw) comments = typeof raw === 'string' ? JSON.parse(raw) : raw;

    const newComment: ExpenseComment = { id: `CM${Date.now()}`, author, text, timestamp: new Date().toISOString() };
    comments.unshift(newComment);

    await db.query('UPDATE expenses SET comments = ?::jsonb WHERE id = ?', [JSON.stringify(comments), id]);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
};

export const postExpenseToGL = async (id: string, user?: User | null): Promise<{ ok: boolean; error?: string }> => {
  try {
    const res = await db.query('SELECT * FROM expenses WHERE id = ?', [id]);
    if (!('rows' in res) || res.rows.length === 0) return { ok: false, error: 'Not found' };

    const exp = mapRow(res.rows[0]);
    if (exp.status !== 'approved') return { ok: false, error: 'Expense must be approved before posting' };

    // Build GL entry
    const creditAccountId = (() => {
      if (exp.paymentMethod === 'Cash') return gl.getMappings().CASH || '1000';
      if (exp.paymentMethod === 'BankTransfer') return gl.getMappings().BANK || '1100';
      return gl.getMappings().CARD_CLEARING || gl.getMappings().CARD || '1300';
    })();

    const lines = [
      { accountId: exp.glAccountId, description: `Expense ${exp.invoiceRef} ${exp.vendorId}`, debit: exp.amount, credit: 0 },
      { accountId: creditAccountId, description: `Payment ${exp.invoiceRef}`, debit: 0, credit: exp.amount },
    ];

    if (!gl.isBalanced(lines)) return { ok: false, error: 'GL lines not balanced' };

    // Post to GL
    gl.appendLedger({ id: `GL_EXP_${exp.id}`, date: exp.date, lines, reference: `Expense ${exp.invoiceRef}` });

    // Update DB
    await db.query("UPDATE expenses SET status = 'posted', posted_at = NOW() WHERE id = ?", [id]);

    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
};

export interface ExpenseFilter { from?: string; to?: string; glAccountId?: string; costCenter?: string; }
export const filterExpenses = async (f: ExpenseFilter): Promise<ExpenseTxn[]> => {
  let query = 'SELECT * FROM expenses WHERE 1=1';
  const params: any[] = [];

  if (f.from) { query += ' AND date >= ?'; params.push(f.from); }
  if (f.to) { query += ' AND date <= ?'; params.push(f.to); }
  if (f.glAccountId) { query += ' AND gl_account_id = ?'; params.push(f.glAccountId); }
  if (f.costCenter) { query += ' AND LOWER(cost_center::text) = LOWER(?::text)'; params.push(f.costCenter); }

  query += ' ORDER BY date DESC';

  try {
    const res = await db.query(query, params);
    if ('rows' in res) return res.rows.map(mapRow);
  } catch { }
  return [];
};

export const exportCSV = (rows: ExpenseTxn[]): Blob => {
  const header = 'id,date,vendorId,invoiceRef,paymentMethod,amount,currency,glAccountId,costCenter,description,status';
  const csvRows = rows.map(r => [r.id, r.date, r.vendorId, r.invoiceRef, r.paymentMethod, r.amount, r.currency || '', r.glAccountId, r.costCenter, r.description || '', r.status].map(x => `"${String(x ?? '').replace(/"/g, '"')}"`).join(','));
  const csv = [header, ...csvRows].join('\n');
  return new Blob([csv], { type: 'text/csv' });
};

// Daily cash flow (simplified): sum revenue credits from ledger and expense outflows for a date
export const getDailyCashFlow = async (date: string): Promise<{ inflows: number; outflows: number; net: number }> => {
  const ledger = gl.getLedger();
  const inflows = ledger.filter(e => e.date === date).flatMap(e => e.lines).filter(l => {
    const acc = gl.getAccounts().find(a => a.id === l.accountId); return acc?.category === 'Revenue';
  }).reduce((s, l) => s + l.credit, 0);

  // Calculate outflows from DB
  let outflows = 0;
  try {
    const res = await db.query("SELECT SUM(amount) as total FROM expenses WHERE date = ? AND (status = 'approved' OR status = 'posted')", [date]);
    if ('rows' in res && res.rows.length > 0) {
      outflows = Number(res.rows[0].total || 0);
    }
  } catch { }

  const net = Number((inflows - outflows).toFixed(2));
  return { inflows: Number(inflows.toFixed(2)), outflows: Number(outflows.toFixed(2)), net };
};

// AP Aging based on invoice date vs today (unposted or pending approval considered AP)
export const getAPAging = async (todayISO: string = new Date().toISOString().slice(0, 10)) => {
  const today = new Date(todayISO);
  const diffDays = (d: string) => Math.floor((today.getTime() - new Date(d).getTime()) / (1000 * 60 * 60 * 24));
  const buckets = { current: [] as ExpenseTxn[], d1_30: [] as ExpenseTxn[], d31_60: [] as ExpenseTxn[], d61_90: [] as ExpenseTxn[], over90: [] as ExpenseTxn[] };

  try {
    const res = await db.query("SELECT * FROM expenses WHERE status != 'posted'");
    if ('rows' in res) {
      res.rows.map(mapRow).forEach(e => {
        const days = diffDays(e.date);
        if (days <= 0) buckets.current.push(e);
        else if (days <= 30) buckets.d1_30.push(e);
        else if (days <= 60) buckets.d31_60.push(e);
        else if (days <= 90) buckets.d61_90.push(e);
        else buckets.over90.push(e);
      });
    }
  } catch { }

  return buckets;
};

export const listPendingApproval = async (): Promise<ExpenseTxn[]> => {
  try {
    const res = await db.query("SELECT * FROM expenses WHERE status = 'pending_approval'");
    if ('rows' in res) return res.rows.map(mapRow);
  } catch { }
  return [];
};


// Note: For reporting functions like departmentalBreakdown and getUSALIIncomeStatement, 
// strictly speaking they should also be async now. 
// However, rewriting them entirely to aggregation queries is complex.
// For now, we will fetch data using filterExpenses (which is async) and compute in memory.

export const departmentalBreakdown = async (from: string, to: string): Promise<{ costCenter: string; total: number }[]> => {
  const rows = await filterExpenses({ from, to });
  const totals: Record<string, number> = {};
  rows.forEach(r => { totals[r.costCenter] = (totals[r.costCenter] || 0) + r.amount; });
  return Object.entries(totals).map(([costCenter, total]) => ({ costCenter, total: Number(total.toFixed(2)) }));
};

export const getUSALIIncomeStatement = async (from: string, to: string, budgets?: { month?: string } | undefined) => {
  // USALI department definitions
  const opDepts = ['Rooms', 'Food & Beverage', 'Spa', 'Other Operated Departments'];
  const undistributed = ['Administrative & General', 'Sales & Marketing', 'Property Operations & Maintenance', 'Utilities', 'Information & Telecom'];

  // Legacy name normaliser (maps old names like 'F&B' → 'Food & Beverage', 'Administration' → 'Administrative & General')
  const legacyMap: Record<string, string> = {
    'Administration': 'Administrative & General', 'F&B': 'Food & Beverage',
    'Food': 'Food & Beverage', 'Beverage': 'Food & Beverage', 'Sales': 'Sales & Marketing',
    'Marketing': 'Sales & Marketing', 'Maintenance': 'Property Operations & Maintenance',
    'POM': 'Property Operations & Maintenance', 'IT': 'Information & Telecom',
    'Telecom': 'Information & Telecom', 'Other': 'Other Operated Departments',
  };
  const norm = (d: string) => legacyMap[d] || d;

  // Revenue from GL ledger
  const tb = gl.getTrialBalance(from, to);
  const accs = gl.getAccounts();
  const cat = (id: string) => accs.find(a => a.id === id)?.category;
  const revenue = tb.filter(a => cat(a.accountId) === 'Revenue').reduce((s, a) => s + (-a.balance), 0);

  // Expenses by GL accounts
  const ledger = gl.getLedger().filter(e => e.date >= from && e.date <= to);
  const getDept = (accId: string) => norm(accs.find(a => a.id === accId)?.department || 'Administrative & General');
  const expenseLines = ledger.flatMap(e => e.lines).filter(l => accs.find(a => a.id === l.accountId)?.category === 'Expense');

  const deptExp: Record<string, number> = {};
  const undExp: Record<string, number> = {};
  expenseLines.forEach(l => {
    const d = getDept(l.accountId);
    const amt = l.debit - l.credit;
    if (opDepts.includes(d)) deptExp[d] = (deptExp[d] || 0) + amt;
    else if (undistributed.includes(d)) undExp[d] = (undExp[d] || 0) + amt;
    else undExp['Administrative & General'] = (undExp['Administrative & General'] || 0) + amt;
  });

  const deptExpenseTotal = Object.values(deptExp).reduce((s, v) => s + v, 0);
  const deptProfit = revenue - deptExpenseTotal;
  const undTotal = Object.values(undExp).reduce((s, v) => s + v, 0);
  const GOP = deptProfit - undTotal;

  // Budget comparisons
  const month = to.slice(0, 7);
  const bud = budgetSvc.getBudget(month);
  const ytdActualFrom = `${to.slice(0, 4)}-01-01`;
  const ytdRevenue = gl.getTrialBalance(ytdActualFrom, to).filter(a => cat(a.accountId) === 'Revenue').reduce((s, a) => s + (-a.balance), 0);

  const ytdExpRows = await filterExpenses({ from: ytdActualFrom, to });
  const ytdDeptExpTotal = ytdExpRows.filter(r => opDepts.includes(norm(r.costCenter))).reduce((s, r) => s + r.amount, 0);
  const ytdUndTotal = ytdExpRows.filter(r => undistributed.includes(norm(r.costCenter))).reduce((s, r) => s + r.amount, 0);

  const ytdDeptProfit = ytdRevenue - ytdDeptExpTotal;
  const ytdGOP = ytdDeptProfit - ytdUndTotal;

  // Prior year YTD
  const prevYear = String(Number(to.slice(0, 4)) - 1);
  const prevTo = `${prevYear}${to.slice(4)}`;
  const ytdPrevRevenue = gl.getTrialBalance(`${prevYear}-01-01`, prevTo).filter(a => cat(a.accountId) === 'Revenue').reduce((s, a) => s + (-a.balance), 0);
  const ytdPrevExpRows = await filterExpenses({ from: `${prevYear}-01-01`, to: prevTo });
  const ytdPrevDeptExpTotal = ytdPrevExpRows.filter(r => opDepts.includes(norm(r.costCenter))).reduce((s, r) => s + r.amount, 0);
  const ytdPrevUndTotal = ytdPrevExpRows.filter(r => undistributed.includes(norm(r.costCenter))).reduce((s, r) => s + r.amount, 0);
  const ytdPrevDeptProfit = ytdPrevRevenue - ytdPrevDeptExpTotal;
  const ytdPrevGOP = ytdPrevDeptProfit - ytdPrevUndTotal;

  const result = {
    month,
    revenue: Number(revenue.toFixed(2)),
    departmentalExpenses: opDepts.map(cc => ({ costCenter: cc, amount: Number((deptExp[cc] || 0).toFixed(2)) })),
    departmentalProfit: Number(deptProfit.toFixed(2)),
    undistributedExpenses: undistributed.map(cc => ({ costCenter: cc, amount: Number((undExp[cc] || 0).toFixed(2)) })),
    GOP: Number(GOP.toFixed(2)),
    budget: bud ? { revenue: bud.revenue, costCenters: bud.costCenters } : undefined,
    ytd: { revenue: Number(ytdRevenue.toFixed(2)), deptExpenses: Number(ytdDeptExpTotal.toFixed(2)), undistributed: Number(ytdUndTotal.toFixed(2)), deptProfit: Number(ytdDeptProfit.toFixed(2)), GOP: Number(ytdGOP.toFixed(2)) },
    ytdPrior: { revenue: Number(ytdPrevRevenue.toFixed(2)), deptExpenses: Number(ytdPrevDeptExpTotal.toFixed(2)), undistributed: Number(ytdPrevUndTotal.toFixed(2)), deptProfit: Number(ytdPrevDeptProfit.toFixed(2)), GOP: Number(ytdPrevGOP.toFixed(2)) },
  };
  return result;
};

export const getDepartmentMonthlyTrend = (dept: string, months: number = 6, toISO: string = new Date().toISOString().slice(0, 10)): Array<{ month: string; expense: number; revenue: number; pct: number }> => {
  // This uses GL, so synchronous is fine as GL is synchronous (unless we migrate GL logging too, which we haven't)
  const accounts = gl.getAccounts();
  const ledger = gl.getLedger();
  const end = new Date(toISO.slice(0, 7) + '-01'); // beginning of month
  const data: Array<{ month: string; expense: number; revenue: number; pct: number }> = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(end); d.setMonth(d.getMonth() - i);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const from = `${ym}-01`; const to = `${ym}-31`;
    const monthEntries = ledger.filter(e => e.date >= from && e.date <= to);
    const lines = monthEntries.flatMap(e => e.lines);
    const expense = lines.filter(l => accounts.find(a => a.id === l.accountId)?.category === 'Expense' && accounts.find(a => a.id === l.accountId)?.department === dept).reduce((s, l) => s + (l.debit - l.credit), 0);
    const revenue = gl.getTrialBalance(from, to).filter(a => accounts.find(x => x.id === a.accountId)?.category === 'Revenue').reduce((s, a) => s + (-a.balance), 0);
    const pct = revenue > 0 ? (expense / revenue) * 100 : 0;
    data.push({ month: ym, expense: Number(expense.toFixed(2)), revenue: Number(revenue.toFixed(2)), pct: Number(pct.toFixed(2)) });
  }
  return data;
};

export const getDepartmentAccountsDrilldown = (from: string, to: string, dept: string): { accountId: string; total: number; lines: Array<{ entryId: string; date: string; reference?: string; amount: number; description?: string }> }[] => {
  const accounts = gl.getAccounts();
  const ledger = gl.getLedger().filter(e => e.date >= from && e.date <= to);
  const map: Record<string, { total: number; lines: Array<{ entryId: string; date: string; reference?: string; amount: number; description?: string }> }> = {};
  ledger.forEach(e => e.lines.forEach(l => {
    const acc = accounts.find(a => a.id === l.accountId);
    if (acc?.category === 'Expense' && acc?.department === dept) {
      const amt = l.debit - l.credit;
      if (!map[l.accountId]) map[l.accountId] = { total: 0, lines: [] };
      map[l.accountId].total += amt;
      map[l.accountId].lines.push({ entryId: e.id, date: e.date, reference: e.reference, amount: amt, description: l.description });
    }
  }));
  return Object.entries(map).map(([accountId, v]) => ({ accountId, total: Number(v.total.toFixed(2)), lines: v.lines }));
};

export default {
  listExpenses,
  addExpense,
  approveExpense,
  postExpenseToGL,
  filterExpenses,
  exportCSV,
  getDailyCashFlow,
  getAPAging,
  listPendingApproval,
  departmentalBreakdown,
  getUSALIIncomeStatement,
  addComment,
  getDepartmentMonthlyTrend,
  getDepartmentAccountsDrilldown,
};
