// ============================================================================
// USALI Profit & Loss mapping + builder
// ============================================================================
// Maps the system's chart-of-accounts (by account id, with department/category
// fallback) onto the Uniform System of Accounts for the Lodging Industry (USALI)
// Summary Operating Statement structure, then builds the full hierarchy:
//
//   OPERATING REVENUE (by outlet)
//   − DEPARTMENTAL EXPENSES (direct cost of sales, by outlet)
//   = TOTAL DEPARTMENTAL PROFIT
//   − UNDISTRIBUTED OPERATING EXPENSES (overhead)
//   = GROSS OPERATING PROFIT (GOP)
//   − NON-OPERATING EXPENSES
//   = EBITDA / NET OPERATING INCOME
//   − Interest, Depreciation & Amortisation, Income Taxes
//   = NET INCOME
//
// Source data is the per-account net produced by /api/reports/pl (one row per
// Revenue/Expense account with {category, department, accountId, name, amount}).
// The mapping is intentionally id-driven (ids are stable) with safe defaults so
// no account is ever dropped from the statement.

export type PLAccountRow = { category: string; department?: string; accountId: string; name: string; amount: number };

export type UsaliLineDetail = { accountId: string; name: string; amount: number };
export type UsaliLine = { line: string; amount: number; pct: number; detail: UsaliLineDetail[] };
export type UsaliSection = {
  key: string;
  title: string;
  kind: 'revenue' | 'expense';
  lines: UsaliLine[];
  total: number;
  pct: number;
};
export type UsaliStatement = {
  sections: UsaliSection[];      // ordered: revenue, departmental exp, undistributed, non-operating, fixed
  totals: {
    totalRevenue: number;
    totalDepartmentalExpenses: number;
    totalDepartmentalProfit: number;
    totalUndistributed: number;
    gop: number;
    totalNonOperating: number;
    ebitda: number;
    totalFixed: number;          // interest + D&A + income tax
    netIncome: number;
  };
};

// account id → USALI line label. Buckets are grouped into sections below.
const LINE_BY_ID: Record<string, string> = {
  // ── Operating revenue ──
  '4000': 'Rooms Revenue', '4010': 'Rooms Revenue',
  '4100': 'Food & Beverage (F&B) Revenue', '4200': 'Food & Beverage (F&B) Revenue',
  '4300': 'Other Operated Departments', '4400': 'Other Operated Departments', '4500': 'Other Operated Departments',
  '4600': 'Miscellaneous Income', '4999': 'Miscellaneous Income',
  // ── Departmental (direct) expenses ──
  '5000': 'Rooms — Direct Expenses',
  '5100': 'F&B — Cost of Goods Sold (COGS)', '5252-01': 'F&B — Cost of Goods Sold (COGS)',
  '5200': 'F&B — Payroll & Related', '5297-01': 'F&B — Other Operating Expenses', '5350': 'F&B — Other Operating Expenses',
  // ── Undistributed operating expenses ──
  '5300': 'Administrative & General (A&G)', '7600': 'Administrative & General (A&G)',
  '5700': 'Information & Telecommunications Systems',
  '5400': 'Sales & Marketing',
  '5500': 'Property Operations & Maintenance',
  '5600': 'Utilities', '7100': 'Utilities',
  // ── Non-operating expenses ──
  '6000': 'Management Fees',
  '5900': 'Property & Liability Insurance',
  '6300': 'Other Fixed Charges',
  // ── Interest, D&A, Taxes (below EBITDA) ──
  '6100': 'Interest Expense',
  '5800': 'Depreciation & Amortisation',
  '6200': 'Income Taxes',
};

// Which section each USALI line belongs to, and section order.
const SECTION_OF_LINE: Record<string, string> = {
  'Rooms Revenue': 'revenue', 'Food & Beverage (F&B) Revenue': 'revenue',
  'Other Operated Departments': 'revenue', 'Miscellaneous Income': 'revenue',
  'Rooms — Direct Expenses': 'departmental', 'F&B — Cost of Goods Sold (COGS)': 'departmental',
  'F&B — Payroll & Related': 'departmental', 'F&B — Other Operating Expenses': 'departmental',
  'Other Operated Departments — Direct Costs': 'departmental',
  'Administrative & General (A&G)': 'undistributed', 'Information & Telecommunications Systems': 'undistributed',
  'Sales & Marketing': 'undistributed', 'Property Operations & Maintenance': 'undistributed', 'Utilities': 'undistributed',
  'Management Fees': 'nonoperating', 'Rent / Building Lease': 'nonoperating',
  'Property & Liability Insurance': 'nonoperating', 'Real Estate & Property Taxes': 'nonoperating', 'Other Fixed Charges': 'nonoperating',
  'Interest Expense': 'fixed', 'Depreciation & Amortisation': 'fixed', 'Income Taxes': 'fixed',
};

const SECTION_META: Record<string, { title: string; kind: 'revenue' | 'expense'; order: number }> = {
  revenue:      { title: 'OPERATING REVENUE', kind: 'revenue', order: 1 },
  departmental: { title: 'DEPARTMENTAL EXPENSES (Direct Cost of Sales)', kind: 'expense', order: 2 },
  undistributed:{ title: 'UNDISTRIBUTED OPERATING EXPENSES (Overhead)', kind: 'expense', order: 3 },
  nonoperating: { title: 'NON-OPERATING INCOME / (EXPENSES)', kind: 'expense', order: 4 },
  fixed:        { title: 'INTEREST, TAXES, DEPRECIATION & AMORTISATION', kind: 'expense', order: 5 },
};

// Classify an account into its USALI line. Unmapped accounts fall back by
// category/department so nothing is ever lost from the statement.
export const usaliLineFor = (row: PLAccountRow): string => {
  if (LINE_BY_ID[row.accountId]) return LINE_BY_ID[row.accountId];
  const dept = (row.department || '').toLowerCase();
  if (row.category === 'Revenue') {
    if (dept.includes('room')) return 'Rooms Revenue';
    if (dept.includes('f&b') || dept.includes('food') || dept.includes('bev')) return 'Food & Beverage (F&B) Revenue';
    return 'Miscellaneous Income';
  }
  // Expense fallback → Undistributed A&G (overhead) unless dept points to an outlet
  if (dept.includes('room')) return 'Rooms — Direct Expenses';
  if (dept.includes('f&b') || dept.includes('food') || dept.includes('bev')) return 'F&B — Other Operating Expenses';
  return 'Administrative & General (A&G)';
};

const sectionKeyOf = (line: string): string => SECTION_OF_LINE[line] || 'undistributed';

export const buildUsaliStatement = (rows: PLAccountRow[]): UsaliStatement => {
  // line label → { amount, detail[] }
  const lineMap = new Map<string, { amount: number; detail: UsaliLineDetail[] }>();
  for (const r of rows) {
    const line = usaliLineFor(r);
    const cur = lineMap.get(line) || { amount: 0, detail: [] };
    cur.amount += Number(r.amount || 0);
    cur.detail.push({ accountId: r.accountId, name: r.name, amount: Number(r.amount || 0) });
    lineMap.set(line, cur);
  }

  const totalRevenue = rows.filter(r => r.category === 'Revenue').reduce((s, r) => s + Number(r.amount || 0), 0);
  const pctOf = (n: number) => (totalRevenue ? (n / totalRevenue) * 100 : 0);

  // assemble sections in canonical order
  const sectionKeys = ['revenue', 'departmental', 'undistributed', 'nonoperating', 'fixed'];
  const sections: UsaliSection[] = sectionKeys.map(key => {
    const lines: UsaliLine[] = Array.from(lineMap.entries())
      .filter(([line]) => sectionKeyOf(line) === key)
      .map(([line, v]) => ({
        line,
        amount: v.amount,
        pct: pctOf(v.amount),
        detail: v.detail.sort((a, b) => b.amount - a.amount),
      }))
      .sort((a, b) => b.amount - a.amount);
    const total = lines.reduce((s, l) => s + l.amount, 0);
    return { key, title: SECTION_META[key].title, kind: SECTION_META[key].kind, lines, total, pct: pctOf(total) };
  }).filter(s => s.lines.length > 0 || s.key === 'revenue');

  const sec = (k: string) => sections.find(s => s.key === k)?.total || 0;
  const totalDepartmentalExpenses = sec('departmental');
  const totalUndistributed = sec('undistributed');
  const totalNonOperating = sec('nonoperating');
  const totalFixed = sec('fixed');
  const totalDepartmentalProfit = totalRevenue - totalDepartmentalExpenses;
  const gop = totalDepartmentalProfit - totalUndistributed;
  const ebitda = gop - totalNonOperating;
  const netIncome = ebitda - totalFixed;

  return {
    sections,
    totals: {
      totalRevenue, totalDepartmentalExpenses, totalDepartmentalProfit,
      totalUndistributed, gop, totalNonOperating, ebitda, totalFixed, netIncome,
    },
  };
};
