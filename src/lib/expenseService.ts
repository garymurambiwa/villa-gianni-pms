import { User } from '@/types';
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

const EXPENSES_KEY = 'corepms_expenses';
const APPROVAL_THRESHOLD = 500; // configurable

const readJSON = <T>(key: string, fallback: T): T => {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; }
};
const writeJSON = (key: string, value: any) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };

export const listExpenses = (): ExpenseTxn[] => readJSON<ExpenseTxn[]>(EXPENSES_KEY, []);
export const setExpenses = (rows: ExpenseTxn[]) => writeJSON(EXPENSES_KEY, rows);

export const findByInvoice = (invoiceRef: string): ExpenseTxn | undefined => listExpenses().find(e => e.invoiceRef.toLowerCase() === String(invoiceRef||'').toLowerCase());

export const addExpense = (payload: Omit<ExpenseTxn,'id'|'status'|'approvedBy'|'approvedAt'|'postedAt'>, user?: User | null): { ok: boolean; error?: string; expense?: ExpenseTxn } => {
  const { date, vendorId, invoiceRef, paymentMethod, amount, glAccountId, costCenter } = payload;
  if (!date || !vendorId || !invoiceRef || !paymentMethod || !amount || !glAccountId || !costCenter) return { ok:false, error:'Missing required fields' };
  if (findByInvoice(invoiceRef)) return { ok:false, error:'Duplicate invoice reference' };
  const status: ExpenseTxn['status'] = amount >= APPROVAL_THRESHOLD && !isManager(user?.role) ? 'pending_approval' : 'approved';
  const now = new Date().toISOString();
  const row: ExpenseTxn = { id: `EXP${Date.now()}`, status, date, vendorId, invoiceRef, paymentMethod, amount: Number(amount), currency: payload.currency, glAccountId, costCenter, description: payload.description, attachmentName: payload.attachmentName, attachmentDataURL: payload.attachmentDataURL, createdBy: user?.username };
  if (status === 'approved') { row.approvedBy = user?.username; row.approvedAt = now; }
  const next = [row, ...listExpenses()]; setExpenses(next);
  return { ok:true, expense: row };
};

export const approveExpense = (id: string, user?: User | null): { ok:boolean; error?: string } => {
  if (!isManager(user?.role)) return { ok:false, error:'Unauthorized' };
  const rows = listExpenses(); const idx = rows.findIndex(r=> r.id===id);
  if (idx === -1) return { ok:false, error:'Not found' };
  rows[idx].status = 'approved'; rows[idx].approvedBy = user?.username || 'manager'; rows[idx].approvedAt = new Date().toISOString();
  setExpenses(rows); return { ok:true };
};

export const addComment = (id: string, author: string | undefined, text: string): { ok:boolean; error?: string } => {
  const rows = listExpenses(); const idx = rows.findIndex(r=> r.id===id);
  if (idx === -1) return { ok:false, error:'Not found' };
  const comment: ExpenseComment = { id:`CM${Date.now()}`, author, text, timestamp:new Date().toISOString() };
  rows[idx].comments = rows[idx].comments ? [comment, ...rows[idx].comments] : [comment];
  setExpenses(rows); return { ok:true };
};

export const postExpenseToGL = (id: string, user?: User | null): { ok:boolean; error?: string } => {
  const rows = listExpenses(); const idx = rows.findIndex(r=> r.id===id);
  if (idx === -1) return { ok:false, error:'Not found' };
  const exp = rows[idx];
  if (exp.status !== 'approved') return { ok:false, error:'Expense must be approved before posting' };
  // Build GL entry: debit expense account, credit payment method clearing/cash
  const creditAccountId = (()=>{
    if (exp.paymentMethod === 'Cash') return gl.getMappings().CASH || '1000';
    if (exp.paymentMethod === 'BankTransfer') return gl.getMappings().BANK || '1100';
    // Prefer CARD_CLEARING mapping else merchant clearing (1300)
    return gl.getMappings().CARD_CLEARING || gl.getMappings().CARD || '1300';
  })();
  const lines = [
    { accountId: exp.glAccountId, description: `Expense ${exp.invoiceRef} ${exp.vendorId}`, debit: exp.amount, credit: 0 },
    { accountId: creditAccountId, description: `Payment ${exp.invoiceRef}`, debit: 0, credit: exp.amount },
  ];
  if (!gl.isBalanced(lines)) return { ok:false, error:'GL lines not balanced' };
  gl.appendLedger({ id:`GL_EXP_${exp.id}`, date: exp.date, lines, reference:`Expense ${exp.invoiceRef}` });
  rows[idx].status = 'posted'; rows[idx].postedAt = new Date().toISOString(); setExpenses(rows);
  return { ok:true };
};

export interface ExpenseFilter { from?: string; to?: string; glAccountId?: string; costCenter?: string; }
export const filterExpenses = (f: ExpenseFilter): ExpenseTxn[] => {
  const rows = listExpenses();
  return rows.filter(r => {
    const inFrom = !f.from || r.date >= f.from; const inTo = !f.to || r.date <= f.to;
    const glOk = !f.glAccountId || r.glAccountId === f.glAccountId;
    const ccOk = !f.costCenter || r.costCenter.toLowerCase() === f.costCenter.toLowerCase();
    return inFrom && inTo && glOk && ccOk;
  });
};

export const exportCSV = (rows: ExpenseTxn[]): Blob => {
  const header = 'id,date,vendorId,invoiceRef,paymentMethod,amount,currency,glAccountId,costCenter,description,status';
  const csvRows = rows.map(r => [r.id,r.date,r.vendorId,r.invoiceRef,r.paymentMethod,r.amount,r.currency||'',r.glAccountId,r.costCenter,r.description||'',r.status].map(x=>`"${String(x??'').replace(/"/g,'"')}"`).join(','));
  const csv = [header, ...csvRows].join('\n');
  return new Blob([csv], { type: 'text/csv' });
};

// Daily cash flow (simplified): sum revenue credits from ledger and expense outflows for a date
export const getDailyCashFlow = (date: string): { inflows: number; outflows: number; net: number } => {
  const ledger = gl.getLedger();
  const inflows = ledger.filter(e => e.date === date).flatMap(e => e.lines).filter(l => {
    const acc = gl.getAccounts().find(a=> a.id === l.accountId); return acc?.category === 'Revenue';
  }).reduce((s,l)=> s + l.credit, 0);
  const outflows = listExpenses().filter(e=> e.date === date && (e.status === 'approved' || e.status === 'posted')).reduce((s,e)=> s + e.amount, 0);
  const net = Number((inflows - outflows).toFixed(2));
  return { inflows: Number(inflows.toFixed(2)), outflows: Number(outflows.toFixed(2)), net };
};

// AP Aging based on invoice date vs today (unposted or pending approval considered AP)
export const getAPAging = (todayISO: string = new Date().toISOString().slice(0,10)) => {
  const today = new Date(todayISO);
  const diffDays = (d: string) => Math.floor((today.getTime() - new Date(d).getTime()) / (1000*60*60*24));
  const buckets = { current: [] as ExpenseTxn[], d1_30: [] as ExpenseTxn[], d31_60: [] as ExpenseTxn[], d61_90: [] as ExpenseTxn[], over90: [] as ExpenseTxn[] };
  listExpenses().filter(e=> e.status !== 'posted').forEach(e => {
    const days = diffDays(e.date);
    if (days <= 0) buckets.current.push(e);
    else if (days <= 30) buckets.d1_30.push(e);
    else if (days <= 60) buckets.d31_60.push(e);
    else if (days <= 90) buckets.d61_90.push(e);
    else buckets.over90.push(e);
  });
  return buckets;
};

export const listPendingApproval = (): ExpenseTxn[] => listExpenses().filter(e=> e.status === 'pending_approval');

export const departmentalBreakdown = (from: string, to: string): { costCenter: string; total: number }[] => {
  const rows = filterExpenses({ from, to });
  const totals: Record<string, number> = {};
  rows.forEach(r => { totals[r.costCenter] = (totals[r.costCenter]||0) + r.amount; });
  return Object.entries(totals).map(([costCenter,total])=> ({ costCenter, total: Number(total.toFixed(2)) }));
};

export const getUSALIIncomeStatement = (from: string, to: string, budgets?: { month?: string } | undefined) => {
  // Departments considered: Rooms, F&B
  const depts = ['Rooms','F&B'];
  const undistributed = ['Administration','Sales & Marketing'];
  // Revenue from GL ledger
  const tb = gl.getTrialBalance(from, to);
  const accs = gl.getAccounts();
  const cat = (id: string) => accs.find(a=> a.id === id)?.category;
  const revenue = tb.filter(a=> cat(a.accountId) === 'Revenue').reduce((s,a)=> s + (-a.balance), 0);
  // Expenses by GL accounts with department flags
  const ledger = gl.getLedger().filter(e => e.date >= from && e.date <= to);
  const getDept = (accId: string) => accs.find(a=> a.id === accId)?.department;
  const expenseLines = ledger.flatMap(e => e.lines).filter(l => accs.find(a=> a.id === l.accountId)?.category === 'Expense');
  const deptExp: Record<string, number> = {};
  const undExp: Record<string, number> = {};
  expenseLines.forEach(l => {
    const d = getDept(l.accountId) || 'Undistributed';
    const amt = l.debit - l.credit; // expense posted as debit
    if (depts.includes(d)) deptExp[d] = (deptExp[d]||0) + amt; else if (undistributed.includes(d)) undExp[d] = (undExp[d]||0) + amt; else undExp['Administration'] = (undExp['Administration']||0) + amt;
  });
  const deptExpenseTotal = Object.values(deptExp).reduce((s,v)=> s + v, 0);
  const deptProfit = revenue - deptExpenseTotal;
  const undTotal = Object.values(undExp).reduce((s,v)=> s + v, 0);
  const GOP = deptProfit - undTotal;
  // Budget comparisons
  const month = to.slice(0,7);
  const bud = budgetSvc.getBudget(month);
  const ytdActualFrom = `${to.slice(0,4)}-01-01`;
  const ytdRevenue = gl.getTrialBalance(ytdActualFrom, to).filter(a=> cat(a.accountId)==='Revenue').reduce((s,a)=> s + (-a.balance), 0);
  const ytdExpRows = filterExpenses({ from: ytdActualFrom, to });
  const ytdDeptExpTotal = ytdExpRows.filter(r=> depts.includes(r.costCenter)).reduce((s,r)=> s + r.amount, 0);
  const ytdUndTotal = ytdExpRows.filter(r=> undistributed.includes(r.costCenter)).reduce((s,r)=> s + r.amount, 0);
  const ytdDeptProfit = ytdRevenue - ytdDeptExpTotal;
  const ytdGOP = ytdDeptProfit - ytdUndTotal;
  // Prior year YTD
  const prevYear = String(Number(to.slice(0,4)) - 1);
  const prevTo = `${prevYear}${to.slice(4)}`;
  const ytdPrevRevenue = gl.getTrialBalance(`${prevYear}-01-01`, prevTo).filter(a=> cat(a.accountId)==='Revenue').reduce((s,a)=> s + (-a.balance), 0);
  const ytdPrevExpRows = filterExpenses({ from: `${prevYear}-01-01`, to: prevTo });
  const ytdPrevDeptExpTotal = ytdPrevExpRows.filter(r=> depts.includes(r.costCenter)).reduce((s,r)=> s + r.amount, 0);
  const ytdPrevUndTotal = ytdPrevExpRows.filter(r=> undistributed.includes(r.costCenter)).reduce((s,r)=> s + r.amount, 0);
  const ytdPrevDeptProfit = ytdPrevRevenue - ytdPrevDeptExpTotal;
  const ytdPrevGOP = ytdPrevDeptProfit - ytdPrevUndTotal;
  const result = {
    month,
    revenue: Number(revenue.toFixed(2)),
    departmentalExpenses: depts.map(cc=> ({ costCenter: cc, amount: Number((deptExp[cc]||0).toFixed(2)) })),
    departmentalProfit: Number(deptProfit.toFixed(2)),
    undistributedExpenses: undistributed.map(cc=> ({ costCenter: cc, amount: Number((undExp[cc]||0).toFixed(2)) })),
    GOP: Number(GOP.toFixed(2)),
    budget: bud ? { revenue: bud.revenue, costCenters: bud.costCenters } : undefined,
    ytd: { revenue: Number(ytdRevenue.toFixed(2)), deptExpenses: Number(ytdDeptExpTotal.toFixed(2)), undistributed: Number(ytdUndTotal.toFixed(2)), deptProfit: Number(ytdDeptProfit.toFixed(2)), GOP: Number(ytdGOP.toFixed(2)) },
    ytdPrior: { revenue: Number(ytdPrevRevenue.toFixed(2)), deptExpenses: Number(ytdPrevDeptExpTotal.toFixed(2)), undistributed: Number(ytdPrevUndTotal.toFixed(2)), deptProfit: Number(ytdPrevDeptProfit.toFixed(2)), GOP: Number(ytdPrevGOP.toFixed(2)) },
  };
  return result;
};

// Department trend over last N months up to a date
export const getDepartmentMonthlyTrend = (dept: string, months: number = 6, toISO: string = new Date().toISOString().slice(0,10)): Array<{ month: string; expense: number; revenue: number; pct: number }> => {
  const accounts = gl.getAccounts();
  const ledger = gl.getLedger();
  const end = new Date(toISO.slice(0,7) + '-01'); // beginning of month
  const data: Array<{ month: string; expense: number; revenue: number; pct: number }> = [];
  for (let i = months-1; i >= 0; i--) {
    const d = new Date(end); d.setMonth(d.getMonth() - i);
    const ym = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    const from = `${ym}-01`; const to = `${ym}-31`;
    const monthEntries = ledger.filter(e => e.date >= from && e.date <= to);
    const lines = monthEntries.flatMap(e=> e.lines);
    const expense = lines.filter(l => accounts.find(a=> a.id===l.accountId)?.category==='Expense' && accounts.find(a=> a.id===l.accountId)?.department===dept).reduce((s,l)=> s + (l.debit - l.credit), 0);
    const revenue = gl.getTrialBalance(from, to).filter(a=> accounts.find(x=> x.id===a.accountId)?.category==='Revenue').reduce((s,a)=> s + (-a.balance), 0);
    const pct = revenue>0 ? (expense / revenue) * 100 : 0;
    data.push({ month: ym, expense: Number(expense.toFixed(2)), revenue: Number(revenue.toFixed(2)), pct: Number(pct.toFixed(2)) });
  }
  return data;
};

export const getDepartmentAccountsDrilldown = (from: string, to: string, dept: string): { accountId: string; total: number; lines: Array<{ entryId: string; date: string; reference?: string; amount: number; description?: string }> }[] => {
  const accounts = gl.getAccounts();
  const ledger = gl.getLedger().filter(e=> e.date >= from && e.date <= to);
  const map: Record<string, { total: number; lines: Array<{ entryId: string; date: string; reference?: string; amount: number; description?: string }> }> = {};
  ledger.forEach(e => e.lines.forEach(l => {
    const acc = accounts.find(a=> a.id === l.accountId);
    if (acc?.category==='Expense' && acc?.department===dept) {
      const amt = l.debit - l.credit;
      if (!map[l.accountId]) map[l.accountId] = { total: 0, lines: [] };
      map[l.accountId].total += amt;
      map[l.accountId].lines.push({ entryId: e.id, date: e.date, reference: e.reference, amount: amt, description: l.description });
    }
  }));
  return Object.entries(map).map(([accountId, v])=> ({ accountId, total: Number(v.total.toFixed(2)), lines: v.lines }));
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
