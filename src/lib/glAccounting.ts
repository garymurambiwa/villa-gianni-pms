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
  'CONF_REVENUE',
  'TAX',
  'CASH',
  'ECOCASH',   // EcoCash mobile money — now a first-class payment method
  'CARD',      // Swipe / card
  'ROOM_CHARGE',
  'CITY_LEDGER'
];

// The four POS payment methods and their dedicated clearing/control accounts.
// Used to auto-scaffold the Chart of Accounts so cash, EcoCash, swipe and room
// charge each post to a distinct account and never get conflated.
export const PAYMENT_METHOD_ACCOUNTS: Array<{ code: string; id: string; name: string; category: GLCategory }> = [
  { code: 'CASH',        id: '1000', name: 'Cash on Hand',                 category: 'Asset' },
  { code: 'CARD',        id: '1110', name: 'Card / Swipe Clearing',        category: 'Asset' },
  { code: 'ECOCASH',     id: '1180', name: 'EcoCash Mobile Money Clearing', category: 'Asset' },
  { code: 'ROOM_CHARGE', id: '1200', name: 'Guest Ledger (Room Charges)',  category: 'Asset' },
];

// USALI-aligned safe defaults — prevent complete mapping failure when user hasn't configured
// the Chart of Accounts yet. Financial managers can override via Settings → GL Mapping.
export const GL_USALI_DEFAULTS: Record<string, string> = {
  ROOM_REVENUE:  '4000',  // Revenue: Rooms Department (USALI Schedule 1)
  FB_REVENUE:    '4100',  // Revenue: F&B Department (USALI Schedule 2)
  CONF_REVENUE:  '4200',  // Revenue: Catering/Conferences (USALI Schedule 3)
  TAX:           '2300',  // Liability: VAT/Sales Tax Payable
  CASH:          '1000',  // Asset: Cash on Hand
  CARD:          '1110',  // Asset: Card / Swipe Clearing (was 1100 — separated from A/R)
  ECOCASH:       '1180',  // Asset: EcoCash Mobile Money Clearing (separate from swipe)
  ROOM_CHARGE:   '1200',  // Control: In-house Guest Ledger (transient AR)
  CITY_LEDGER:   '1300',  // Control: Accounts Receivable (non-guest/corporate)
  FB_COST:       '5100',  // Expense: F&B Cost of Sales
  BANK:          '1150',  // Asset: Bank Account
  AP_CONTROL:    '2100',  // Liability: Accounts Payable
};

export type GLMappings = Record<string, string>; // code -> accountId

// getMappings merges: DB-synced > localStorage > USALI defaults
// This means the system always resolves required codes even before user configures COA.
export const getMappings = (): GLMappings => {
  const local = readJSON<GLMappings>(K_MAPPINGS, {});
  return { ...GL_USALI_DEFAULTS, ...local };
};

export const setMappings = (m: GLMappings) => {
  writeJSON(K_MAPPINGS, m);
};

// Sync GL mappings FROM the DB into localStorage (call on app startup or after user saves in UI)
export const syncMappingsFromDB = async (): Promise<GLMappings> => {
  try {
    const res = await fetch('/api/gl/mappings');
    const data = await res.json();
    if (data.ok && data.mappings) {
      writeJSON(K_MAPPINGS, data.mappings);
      return data.mappings as GLMappings;
    }
  } catch { /* non-fatal — fall back to localStorage + defaults */ }
  return getMappings();
};

// Persist user-configured mappings to DB AND localStorage
export const saveMappingsToDB = async (m: GLMappings): Promise<boolean> => {
  try {
    writeJSON(K_MAPPINGS, m); // optimistic local write
    const res = await fetch('/api/gl/mappings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mappings: m }),
    });
    const data = await res.json();
    if (data.ok) writeJSON(K_MAPPINGS, data.mappings);
    return data.ok;
  } catch { return false; }
};

// Validate that all required codes are mapped (using merged defaults)
export const validateMappings = (): { ok: boolean; missing: string[] } => {
  const m = getMappings();
  const missing = REQUIRED_CODES.filter(c => !m[c]);
  return { ok: missing.length === 0, missing };
};

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
  add('CONF_REVENUE', findByName('Revenue', ['conference']) || '4200', 'Map to Conference Revenue account');
  add('TAX', findByName('Liability', ['tax','vat']) || '2000', 'Taxes to liabilities (Taxes Payable)');
  add('CASH', findByName('Asset', ['cash']) || '1000', 'Cash receipts to Cash on Hand');
  add('ECOCASH', findByName('Asset', ['ecocash','mobile']) || '1180', 'EcoCash receipts to EcoCash clearing');
  add('CARD', findByName('Asset', ['swipe','card','merchant','clearing']) || '1110', 'Swipe / card receipts to Card / Swipe Clearing');
  add('CITY_LEDGER', findByName('Asset', ['receivable']) || '1100', 'City Ledger (Accounts Receivable)');
  add('ROOM_CHARGE', findByName('Asset', ['guest ledger','guest']) || '1200', 'Room charges to Guest Ledger');
  if ((REQUIRED_CODES as string[]).includes('CARD_CLEARING')) {
    add('CARD_CLEARING', findByName('Asset', ['merchant','clearing']) || '1300', 'Card settlement clearing');
  }
  return picks;
};

// Additively create any missing POS payment clearing/control accounts in the
// Chart of Accounts. Safe to call on every startup — it never renumbers or
// overwrites existing accounts, it only adds the ones that aren't there yet.
export const ensurePaymentAccounts = (): GLAccount[] => {
  const accounts = getAccounts();
  const ids = new Set(accounts.map(a => a.id));
  let changed = false;
  for (const p of PAYMENT_METHOD_ACCOUNTS) {
    if (!ids.has(p.id)) {
      accounts.push({ id: p.id, name: p.name, category: p.category, usali: p.name });
      changed = true;
    }
  }
  if (changed) setAccounts(accounts);
  return accounts;
};

export const ensureUSALIBaseAccounts = () => {
  const existing = getAccounts();
  // Already seeded — still make sure the four payment accounts exist (additive).
  if (existing.length) return ensurePaymentAccounts();
  const seed: GLAccount[] = [
    { id: '1000', name: 'Cash on Hand', category: 'Asset', usali: 'Cash' },
    { id: '1100', name: 'Accounts Receivable', category: 'Asset', usali: 'A/R' },
    { id: '1110', name: 'Card / Swipe Clearing', category: 'Asset', usali: 'Card Clearing' },
    { id: '1180', name: 'EcoCash Mobile Money Clearing', category: 'Asset', usali: 'EcoCash Clearing' },
    { id: '1200', name: 'Guest Ledger (Room Charges)', category: 'Asset', usali: 'Guest Ledger' },
    { id: '2000', name: 'Taxes Payable', category: 'Liability', usali: 'Taxes Payable' },
    { id: '3000', name: 'Equity', category: 'Equity', usali: 'Equity' },
    { id: '4000', name: 'Rooms Revenue', category: 'Revenue', usali: 'Rooms', department: 'Rooms' },
    { id: '4100', name: 'Food & Beverage Revenue', category: 'Revenue', usali: 'F&B', department: 'F&B' },
    { id: '4200', name: 'Conference Revenue', category: 'Revenue', usali: 'Conference', department: 'Conference' },
    { id: '5200', name: 'Rooms Supplies Expense', category: 'Expense', usali: 'Operating', department: 'Rooms' },
    { id: '5300', name: 'F&B Kitchen Expense', category: 'Expense', usali: 'Operating', department: 'F&B' },
    { id: '5350', name: 'Conference Expense', category: 'Expense', usali: 'Operating', department: 'Conference' },
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

// postJournalEntry — public posting API used by ShiftContext.endShift() and night audit.
// Validates the entry is balanced, persists to local ledger, and fire-and-forget posts
// to the DB ledger endpoint so the GL survives a browser-wipe. Returns the entry or
// throws (no silent swallowing — the caller decides what to do on failure).
export const postJournalEntry = (entry: GLJournalEntry): GLJournalEntry => {
  if (!Array.isArray(entry.lines) || entry.lines.length < 2) {
    throw new Error('Journal entry needs at least 2 lines (debit + credit)');
  }
  if (!isBalanced(entry.lines)) {
    const sumD = entry.lines.reduce((s, l) => s + Number(l.debit || 0), 0);
    const sumC = entry.lines.reduce((s, l) => s + Number(l.credit || 0), 0);
    throw new Error(`Journal entry is not balanced — debits=${sumD.toFixed(2)} credits=${sumC.toFixed(2)}`);
  }
  appendLedger(entry);
  // Fire-and-forget DB persistence
  try {
    fetch('/api/gl/journal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entry }),
    }).catch(() => { /* DB write failed but local ledger has it */ });
  } catch {}
  return entry;
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

  // If not balanced, post the difference to a SUSPENSE/CLEARING account — never to
  // Owner's Equity. Plugging equity overstates capital and hides revenue, corrupting
  // the balance sheet. A suspense balance correctly flags an unreconciled amount to
  // investigate (e.g. revenue not captured in the night-audit bundle).
  if (!isBalanced(lines)) {
    const sumDebit = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
    const sumCredit = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
    const diff = Number((sumCredit - sumDebit).toFixed(2));
    const suspense = mappings['SUSPENSE'] || mappings['CLEARING'] || '9999';
    if (diff > 0) {
      lines.push({ accountId: suspense, description: 'Unreconciled — Suspense (review)', debit: diff, credit: 0 });
    } else if (diff < 0) {
      lines.push({ accountId: suspense, description: 'Unreconciled — Suspense (review)', debit: 0, credit: Math.abs(diff) });
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
  // Layer 1: localStorage (fast, offline-capable)
  appendLedger(entry);
  // Layer 2: DB persistence (async, fire-and-forget — localStorage is the fallback if offline)
  // This makes Accounting > Daily Journal the single source of truth for financial data.
  persistJournalEntryToDB(entry, 'night_audit').catch(err =>
    console.warn('[glAccounting] DB journal persist failed (non-fatal):', err?.message)
  );
  return { ok: true, entry };
};

/**
 * Persist a journal entry to the DB gl_journal_entries + gl_journal_lines tables.
 * Called after every appendLedger() to keep the DB in sync.
 * Non-blocking — caller should not await unless strict ACID is required.
 */
export const persistJournalEntryToDB = async (
  entry: GLJournalEntry,
  source: string = 'manual'
): Promise<{ ok: boolean; error?: string }> => {
  try {
    const res = await fetch('/api/gl/journal-entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: entry.id,
        business_date: entry.date,
        reference: entry.reference,
        description: entry.reference || `Journal ${entry.date}`,
        source,
        lines: entry.lines.map(l => ({
          accountId: l.accountId,
          debit: l.debit,
          credit: l.credit,
          description: l.description
        })),
        created_by: (entry.attachments as any)?.userId || 'system'
      })
    });
    const data = await res.json();
    return { ok: data.ok, error: data.error };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// DB UNIFICATION — single source of truth = PostgreSQL gl_accounts / gl_journal_*
//
// Historically this service kept the Chart of Accounts and the ledger in
// localStorage only, while ChartOfAccounts.tsx wrote the SAME accounts to the
// DB gl_accounts table. The two never reconciled → reports built here couldn't
// see DB accounts and vice-versa ("split-brain").
//
// The functions below reconcile the two stores WITHOUT destroying anything:
//   1. migrateLocalAccountsToDB() pushes any localStorage-only account UP to the
//      DB (ON CONFLICT DO NOTHING — never overwrites a DB account).
//   2. syncAccountsFromDB() pulls the DB accounts DOWN into the localStorage
//      cache, DB winning on conflicts but local-only accounts preserved.
//   3. syncLedgerFromDB() pulls DB journal entries into the localStorage ledger
//      cache so getTrialBalance / getPLStatement / getBalanceSheet reflect the
//      authoritative DB ledger.
//   4. initGLFromDB() runs migrate-then-sync; safe + idempotent on every startup.
//
// After init, localStorage is just a fast read-cache + offline write-buffer; the
// DB is authoritative. The synchronous getAccounts()/getLedger() API is unchanged
// so no consuming component needs to be touched.
// ═══════════════════════════════════════════════════════════════════════════

/** Push localStorage-only accounts into the DB so nothing is lost on first sync. */
export const migrateLocalAccountsToDB = async (): Promise<{ migrated: number }> => {
  const local = getAccounts();
  if (!local.length) return { migrated: 0 };
  let migrated = 0;
  for (const a of local) {
    try {
      const res = await fetch('/api/gl/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: a.id, account_number: a.id, name: a.name, category: a.category }),
      });
      const data = await res.json();
      if (data?.ok) migrated++;
    } catch { /* offline — keep local copy, retry next startup */ }
  }
  return { migrated };
};

/** Pull DB accounts into the localStorage cache. DB wins; local-only kept. */
export const syncAccountsFromDB = async (): Promise<GLAccount[]> => {
  try {
    const res = await fetch('/api/gl/accounts');
    const data = await res.json();
    const rows = data?.ok ? (data.rows || data.data || []) : [];
    if (!Array.isArray(rows) || rows.length === 0) return getAccounts();
    const dbAccounts: GLAccount[] = rows.map((r: any) => ({
      id: String(r.id),
      name: r.name,
      category: r.category as GLCategory,
      usali: r.usali_name || r.usali || undefined,
      department: r.department || undefined,
      active: r.is_active !== false,
    }));
    // Merge: DB authoritative, but keep any local-only account not yet in DB.
    const dbIds = new Set(dbAccounts.map(a => a.id));
    const localOnly = getAccounts().filter(a => !dbIds.has(a.id));
    const merged = [...dbAccounts, ...localOnly];
    setAccounts(merged);
    return merged;
  } catch {
    return getAccounts(); // offline — keep cache
  }
};

/** Pull DB journal entries into the localStorage ledger cache (DB wins by id). */
export const syncLedgerFromDB = async (from?: string, to?: string): Promise<GLJournalEntry[]> => {
  try {
    const qs = new URLSearchParams();
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    qs.set('limit', '5000');
    const res = await fetch(`/api/gl/journal-entries?${qs.toString()}`);
    const data = await res.json();
    const rows = data?.ok ? (data.rows || []) : [];
    if (!Array.isArray(rows)) return getLedger();
    const dbEntries: GLJournalEntry[] = rows.map((je: any) => ({
      id: String(je.id),
      date: String(je.business_date || je.entry_date || '').slice(0, 10),
      reference: je.reference || je.description || undefined,
      lines: (Array.isArray(je.lines) ? je.lines : []).map((l: any) => ({
        accountId: String(l.gl_account_id || l.accountId || ''),
        debit: Number(l.debit_amount ?? l.debit ?? 0),
        credit: Number(l.credit_amount ?? l.credit ?? 0),
        description: l.description || undefined,
      })),
    }));
    // Merge by id: DB authoritative, keep local-only entries not yet persisted.
    const dbIds = new Set(dbEntries.map(e => e.id));
    const localOnly = getLedger().filter(e => !dbIds.has(e.id));
    const merged = [...dbEntries, ...localOnly]
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .slice(0, 5000);
    writeJSON(K_LEDGER, merged);
    return merged;
  } catch {
    return getLedger(); // offline — keep cache
  }
};

/**
 * One-shot reconciliation on app startup. Preserves all data:
 * pushes local-only accounts UP, then hydrates accounts + ledger DOWN from DB.
 */
export const initGLFromDB = async (): Promise<void> => {
  try {
    await migrateLocalAccountsToDB(); // preserve local-only accounts first
    await syncAccountsFromDB();        // DB → cache (accounts)
    await syncMappingsFromDB();        // DB → cache (mappings)
    await syncLedgerFromDB();          // DB → cache (ledger)
  } catch (e) {
    console.warn('[glAccounting] initGLFromDB non-fatal:', (e as any)?.message);
  }
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
  ensurePaymentAccounts,
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
  postJournalEntry,
  persistJournalEntryToDB,
  suggestRequiredCodeMappings,
  // DB unification
  migrateLocalAccountsToDB,
  syncAccountsFromDB,
  syncLedgerFromDB,
  initGLFromDB,
};
