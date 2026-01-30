/**
 * GL Accounting Service
 * - Manages Chart of Accounts (CoA), code mappings, ledger postings
 * - Produces Trial Balance, Balance Sheet, and P&L (USALI-style categories)
 * - Integrates with Night Audit to auto-post daily journals
 */

export type GLCategory = 'Asset' | 'Liability' | 'Equity' | 'Revenue' | 'Expense';

export interface GLAccount {
  id: string; // account number e.g. 1100-01
  name: string;
  category: GLCategory;
  usali?: string; // USALI category name or code
  department?: string; // Rooms, F&B, Administration, Sales & Marketing
  active?: boolean;
}

export interface GLPostingLine {
  accountId: string;
  description?: string;
  debit: number; // positive values only
  credit: number; // positive values only
}

export interface GLJournalEntry {
  id: string; // e.g. GLJE_2025-11-01
  date: string; // business date
  lines: GLPostingLine[];
  reference?: string; // e.g. NightAudit 2025-11-01
  attachments?: { 
    reportsKey?: string; 
    reconciliationKey?: string;
    businessDate?: string;
    auditSnapshotKey?: string;
    shiftId?: string;
    userId?: string;
    userName?: string;
  };
}

const K_ACCOUNTS = 'corepms_gl_accounts';
const K_MAPPINGS = 'corepms_gl_mappings';
const K_LEDGER = 'corepms_gl_ledger';

const readJSON = <T>(key: string, fallback: T): T => { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; } };
const writeJSON = (key: string, value: any) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };

export const getAccounts = (): GLAccount[] => readJSON<GLAccount[]>(K_ACCOUNTS, []);
export const setAccounts = (list: GLAccount[]) => writeJSON(K_ACCOUNTS, list);

// Required PMS codes to map (can be extended)
export const REQUIRED_CODES = [
  'ROOM_REVENUE',
  'FB_REVENUE',
  'TAX',
  'CASH',
  'CARD',
  'ROOM_CHARGE',
  'CITY_LEDGER'
];

export type GLMappings = Record<string, string>; // code -> accountId

export const getMappings = (): GLMappings => readJSON<GLMappings>(K_MAPPINGS, {});
export const setMappings = (m: GLMappings) => writeJSON(K_MAPPINGS, m);

// Suggest GL account for a PMS code using heuristics (USALI-aligned)
export const suggestAccountForPMSCode = (
  codeName: string,
  context?: { costCenter?: string; type?: 'charge' | 'payment' | 'tax' }
): { accountId: string; reason: string } => {
  const name = String(codeName || '').toLowerCase();
  const centre = String(context?.costCenter || '').toLowerCase();
  const type = context?.type || 'charge';
  const accs = getAccounts();
  const findByCategory = (cat: GLCategory, fallbackId: string) => {
    const found = accs.find(a => a.category === cat && name.includes(String(a.name || '').toLowerCase().split(' ')[0]));
    return found?.id || fallbackId;
  };
  if (type === 'tax' || name.includes('tax') || name.includes('vat')) {
    return { accountId: accs.find(a => a.category === 'Liability' && a.name.toLowerCase().includes('tax'))?.id || '2000', reason: 'USALI: Taxes to liabilities (Taxes Payable)' };
  }
  if (type === 'payment') {
    if (name.includes('cash')) return { accountId: accs.find(a => a.category === 'Asset' && a.name.toLowerCase().includes('cash'))?.id || '1000', reason: 'Payment: Cash to Cash asset' };
    if (name.includes('visa') || name.includes('card') || name.includes('master') || name.includes('amex')) return { accountId: accs.find(a => a.id === '1300')?.id || '1300', reason: 'Payment: Card receipts to merchant clearing' };
    if (name.includes('ar') || name.includes('city')) return { accountId: '1100', reason: 'Payment: A/R (City Ledger)' };
  }
  // Revenue mapping by cost center / keywords
  if (centre === 'restaurant' || name.includes('food') || name.includes('restaurant') || name.includes('meal')) {
    const dept = accs.find(a => a.id === '4100-02')?.id;
    return { accountId: dept || '4100', reason: dept ? 'USALI: Departmental restaurant revenue' : 'USALI: Food & Beverage revenue' };
  }
  if (centre === 'bar' || name.includes('bar') || name.includes('drink') || name.includes('beverage') || name.includes('alcohol')) {
    const dept = accs.find(a => a.id === '4100-01')?.id;
    return { accountId: dept || '4100', reason: dept ? 'USALI: Departmental bar revenue' : 'USALI: Beverage revenue' };
  }
  if (name.includes('room') || name.includes('accommodation') || name.includes('package')) {
    return { accountId: '4000', reason: 'USALI: Rooms revenue' };
  }
  // Fallback to rooms revenue
  return { accountId: '4000', reason: 'Fallback: Map to Rooms revenue' };
};

export const suggestRequiredCodeMappings = (): Array<{ code: string; accountId: string; reason: string }> => {
  const accs = getAccounts();
  const findByName = (category: GLCategory | undefined, includes: string[]): string | undefined => {
    const found = accs.find(a => (!category || a.category === category) && includes.some(s => String(a.name || '').toLowerCase().includes(s)));
    return found?.id;
  };
  const picks: Array<{ code: string; accountId: string; reason: string }> = [];
  const add = (code: string, id: string | undefined, reason: string) => picks.push({ code, accountId: id || '', reason });
  add('ROOM_REVENUE', findByName('Revenue', ['room','accommodation']) || '4000', 'Map to Rooms Revenue account');
  add('FB_REVENUE', findByName('Revenue', ['food','beverage','f&b']) || '4100', 'Map to Food & Beverage Revenue');
  add('TAX', findByName('Liability', ['tax','vat']) || '2000', 'Taxes to liabilities (Taxes Payable)');
  add('CASH', findByName('Asset', ['cash']) || '1000', 'Cash receipts to Cash');
  add('CARD', findByName('Asset', ['merchant','clearing']) || '1300', 'Card receipts to merchant clearing');
  add('CITY_LEDGER', findByName('Asset', ['receivable']) || '1100', 'City Ledger (Accounts Receivable)');
  add('ROOM_CHARGE', findByName('Revenue', ['room']) || '4000', 'Room charges to Rooms Revenue');
  if ((REQUIRED_CODES as string[]).includes('CARD_CLEARING')) {
    add('CARD_CLEARING', findByName('Asset', ['merchant','clearing']) || '1300', 'Card settlement clearing');
  }
  return picks;
};

export const ensureUSALIBaseAccounts = () => {
  const existing = getAccounts();
  if (existing.length) return existing;
  const seed: GLAccount[] = [
    { id: '1000', name: 'Cash', category: 'Asset', usali: 'Cash' },
    { id: '1100', name: 'Accounts Receivable', category: 'Asset', usali: 'A/R' },
    { id: '2000', name: 'Taxes Payable', category: 'Liability', usali: 'Taxes Payable' },
    { id: '3000', name: 'Equity', category: 'Equity', usali: 'Equity' },
    { id: '4000', name: 'Rooms Revenue', category: 'Revenue', usali: 'Rooms', department: 'Rooms' },
    { id: '4100', name: 'Food & Beverage Revenue', category: 'Revenue', usali: 'F&B', department: 'F&B' },
    { id: '5200', name: 'Rooms Supplies Expense', category: 'Expense', usali: 'Operating', department: 'Rooms' },
    { id: '5300', name: 'F&B Kitchen Expense', category: 'Expense', usali: 'Operating', department: 'F&B' },
    { id: '5400', name: 'Administration Expense', category: 'Expense', usali: 'Operating', department: 'Administration' },
    { id: '5500', name: 'Sales & Marketing Expense', category: 'Expense', usali: 'Operating', department: 'Sales & Marketing' },
  ];
  setAccounts(seed);
  return seed;
};

export const validateMappingsComplete = (): { ok: boolean; missing: string[] } => {
  const m = getMappings();
  const missing: string[] = REQUIRED_CODES.filter(code => !m[code]);
  return { ok: missing.length === 0, missing };
};

export const getLedger = (): GLJournalEntry[] => readJSON<GLJournalEntry[]>(K_LEDGER, []);
export const appendLedger = (entry: GLJournalEntry) => {
  const ledger = getLedger();
  writeJSON(K_LEDGER, [entry, ...ledger].slice(0, 5000));
};

export const isBalanced = (lines: GLPostingLine[]): boolean => {
  const sumDebit = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
  const sumCredit = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
  return Math.abs(sumDebit - sumCredit) < 0.005;
};

// Build a simple daily JE from Night Audit bundle
export const createDailyJournalFromNightAudit = (businessDate: string, bundle: any): GLJournalEntry => {
  ensureUSALIBaseAccounts();
  const mappings = getMappings();
  const lines: GLPostingLine[] = [];
  const revRooms = Number(bundle?.roomRevenue || 0);
  const revFB = Number(bundle?.fbRevenue || 0);
  const taxEstimate = 0; // tax postings may be computed separately; use mappings['TAX'] when available
  const cash = Number(readJSON<any>('corepms_shift_totals', { cash: 0 }).cash || 0);
  const card = Number(readJSON<any>('corepms_shift_totals', { card: 0 }).card || 0);
  const ar = Number(readJSON<any[]>('corepms_city_ledger', []).reduce((s, t: any) => s + Number(t.amount || 0), 0));

  // Revenue credits
  if (revRooms > 0) lines.push({ accountId: mappings['ROOM_REVENUE'] || '4000', description: 'Rooms Revenue', debit: 0, credit: revRooms });
  if (revFB > 0) lines.push({ accountId: mappings['FB_REVENUE'] || '4100', description: 'F&B Revenue', debit: 0, credit: revFB });
  if (taxEstimate > 0) lines.push({ accountId: mappings['TAX'] || '2000', description: 'Tax Payable', debit: 0, credit: taxEstimate });

  // Receipts debits
  if (cash > 0) lines.push({ accountId: mappings['CASH'] || '1000', description: 'Cash Receipts', debit: cash, credit: 0 });
  if (card > 0) lines.push({ accountId: mappings['CARD_CLEARING'] || mappings['CARD'] || '1300', description: 'Card Receipts', debit: card, credit: 0 });
  if (ar > 0) lines.push({ accountId: mappings['CITY_LEDGER'] || '1100', description: 'City Ledger Transfers', debit: ar, credit: 0 });

  // If not balanced due to tax, add balancing line to equity (temporary)
  if (!isBalanced(lines)) {
    const sumDebit = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
    const sumCredit = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
    const diff = Number((sumCredit - sumDebit).toFixed(2));
    if (diff > 0) {
      // Need more debits
      lines.push({ accountId: '3000', description: 'Balancing Entry', debit: diff, credit: 0 });
    } else if (diff < 0) {
      lines.push({ accountId: '3000', description: 'Balancing Entry', debit: 0, credit: Math.abs(diff) });
    }
  }

  const entry: GLJournalEntry = {
    id: `GLJE_${businessDate}`,
    date: businessDate,
    lines,
    reference: `NightAudit ${businessDate}`,
    attachments: {
      reportsKey: 'corepms_nightAudit_lastReports',
      reconciliationKey: 'corepms_reconciliation_last'
    }
  };
  return entry;
};

export const postDailyJournalFromNightAudit = (businessDate: string, bundle: any): { ok: boolean; error?: string; entry?: GLJournalEntry } => {
  const mappingsOk = validateMappingsComplete();
  if (!mappingsOk.ok) return { ok: false, error: `Missing GL mappings: ${mappingsOk.missing.join(', ')}` };
  const entry = createDailyJournalFromNightAudit(businessDate, bundle);
  // Extend attachments with context
  try {
    const backup = readJSON<any>('corepms_backup_last', null);
    entry.attachments = {
      ...(entry.attachments || {}),
      reportsKey: 'corepms_nightAudit_lastReports',
      reconciliationKey: 'corepms_reconciliation_last',
      businessDate,
      auditSnapshotKey: backup?.key
    };
  } catch {}
  if (!isBalanced(entry.lines)) return { ok: false, error: 'Journal is not balanced' };
  appendLedger(entry);
  return { ok: true, entry };
};

// Reporting utilities
export const getTrialBalance = (from: string, to: string): Array<{ accountId: string; name: string; debit: number; credit: number; balance: number }> => {
  const accs = getAccounts();
  const ledger = getLedger().filter(e => e.date >= from && e.date <= to);
  const map: Record<string, { name: string; debit: number; credit: number }> = {};
  accs.forEach(a => { map[a.id] = { name: a.name, debit: 0, credit: 0 }; });
  ledger.forEach(e => e.lines.forEach(l => {
    if (!map[l.accountId]) map[l.accountId] = { name: l.accountId, debit: 0, credit: 0 };
    map[l.accountId].debit += Number(l.debit || 0);
    map[l.accountId].credit += Number(l.credit || 0);
  }));
  return Object.entries(map).map(([id, v]) => ({ accountId: id, name: v.name, debit: Number(v.debit.toFixed(2)), credit: Number(v.credit.toFixed(2)), balance: Number((v.debit - v.credit).toFixed(2)) }));
};

export const getPLStatement = (from: string, to: string): { revenue: number; expense: number; netIncome: number } => {
  const tb = getTrialBalance(from, to);
  const accs = getAccounts();
  const cat = (id: string): GLCategory | undefined => accs.find(a => a.id === id)?.category;
  const revenue = tb.filter(a => cat(a.accountId) === 'Revenue').reduce((s, a) => s + (-a.balance), 0); // credits increase revenue
  const expense = tb.filter(a => cat(a.accountId) === 'Expense').reduce((s, a) => s + a.balance, 0); // debits increase expense
  const netIncome = Number((revenue - expense).toFixed(2));
  return { revenue: Number(revenue.toFixed(2)), expense: Number(expense.toFixed(2)), netIncome };
};

export const getBalanceSheet = (from: string, to: string): { assets: number; liabilities: number; equity: number } => {
  const tb = getTrialBalance(from, to);
  const accs = getAccounts();
  const cat = (id: string): GLCategory | undefined => accs.find(a => a.id === id)?.category;
  const assets = tb.filter(a => cat(a.accountId) === 'Asset').reduce((s, a) => s + a.balance, 0);
  const liabilities = tb.filter(a => cat(a.accountId) === 'Liability').reduce((s, a) => s + (-a.balance), 0);
  const equity = tb.filter(a => cat(a.accountId) === 'Equity').reduce((s, a) => s + (-a.balance), 0);
  return { assets: Number(assets.toFixed(2)), liabilities: Number(liabilities.toFixed(2)), equity: Number(equity.toFixed(2)) };
};

export default {
  getAccounts,
  setAccounts,
  ensureUSALIBaseAccounts,
  getMappings,
  setMappings,
  validateMappingsComplete,
  suggestAccountForPMSCode,
  createDailyJournalFromNightAudit,
  postDailyJournalFromNightAudit,
  getLedger,
  getTrialBalance,
  getPLStatement,
  getBalanceSheet,
  isBalanced,
  appendLedger,
  suggestRequiredCodeMappings,
};
