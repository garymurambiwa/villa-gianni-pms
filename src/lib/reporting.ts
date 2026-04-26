import gl from '@/lib/glAccounting';
import { readReceiptBranding } from './printSettings';
import roomSvc from '@/lib/roomService';
import expenseSvc from '@/lib/expenseService';
import { syncNightAuditRunToLocalStorage } from './dbSync';

export type ReportType = 'flash' | 'pos-recon' | 'purchase-log' | 'pl' | 'aged-ar' | 'inventory-cogs' | 'housekeeping' | 'daily-tax' | 'cash-bank' | 'trial-balance' | 'dept-summary' | 'arrivals-departures' | 'high-balance' | 'proc-variance' | 'fa-recon' | 'open-bills' | 'aged-payables' | 'po-history' | 'payment-history' | 'vendor-payment-summary' | 'expenses-by-dept' | 'expense-summary-daily' | 'expense-summary-monthly' | 'line-item-export';

export interface DateRange { start: string; end: string }

const readJSON = <T>(key: string, fallback: T): T => { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; } };

export const getLastNightAuditBundle = () => readJSON<any>('corepms_nightAudit_lastReports', null);
export const getBusinessDate = () => readJSON<string>('corepms_business_date', new Date().toISOString().slice(0, 10));

// Helper function to get historical night audit data for year-over-year comparison
export const getHistoricalNightAuditBundle = (date: string) => {
  try {
    // Try to get specific date data first
    const specificKey = `corepms_nightAudit_reports_${date}`;
    const specificData = readJSON<any>(specificKey, null);
    if (specificData) return specificData;

    // Fallback to last reports if specific date not found
    return null;
  } catch {
    return null;
  }
};

// Async version that can load from database if not in localStorage
export const loadHistoricalNightAuditData = async (date: string) => {
  const existingData = getHistoricalNightAuditBundle(date);
  if (existingData) return existingData;

  // Try to load from database
  try {
    const result = await syncNightAuditRunToLocalStorage(date);
    if (result.success) {
      return getHistoricalNightAuditBundle(date);
    }
  } catch (err) {
    console.warn('Failed to load historical night audit data:', err);
  }
  return null;
};

// Helper function to calculate same date last year
export const getSameDateLastYear = (dateStr: string): string => {
  const date = new Date(dateStr);
  date.setFullYear(date.getFullYear() - 1);
  return date.toISOString().slice(0, 10);
};

// Daily Manager's Flash Report with Year-over-Year Comparison
export const buildFlashReport = (forDate?: string) => {
  const b = getLastNightAuditBundle();
  const date = forDate || b?.date || getBusinessDate();
  const cashCard = readJSON<Record<string, number>>('corepms_shift_totals', { cash: 0, card: 0 });

  // Get year-over-year comparison data
  const lastYearDate = getSameDateLastYear(date);
  const lastYearBundle = getHistoricalNightAuditBundle(lastYearDate);

  // Get last year's folio charges for F&B breakdown
  const lastYearFolioCharges = lastYearBundle ?
    readJSON<any[]>(`corepms_folioCharges_${lastYearDate}`, []) :
    readJSON<any[]>('corepms_folioCharges', []);

  // Filter last year's charges for the same date
  const lastYearCharges = lastYearFolioCharges.filter((c: any) =>
    c.date === lastYearDate ||
    (c.business_date && c.business_date === lastYearDate)
  );

  // Get detailed F&B breakdown from folio charges
  const folioCharges = readJSON<any[]>('corepms_folioCharges', []);
  const businessDate = forDate || getBusinessDate();

  // Filter charges for the current business date
  const todaysCharges = folioCharges.filter((c: any) =>
    c.date === businessDate ||
    (c.business_date && c.business_date === businessDate)
  );

  // Separate Food and Bar revenue based on POS categories and descriptions
  // This logic ensures no double-counting by processing charges in a specific order

  // First, identify all F&B charges for the business date
  const fbCharges = todaysCharges.filter((c: any) =>
    String(c.category || '').toLowerCase() === 'f&b'
  );

  // Track processed charge IDs to prevent double counting
  const processedChargeIds = new Set<string>();

  // Calculate Food Revenue - explicit food identifiers first
  const foodRevenue = fbCharges
    .filter((c: any) => {
      const desc = String(c.description || '').toLowerCase();
      const chargeId = String(c.id || '');

      // Skip if already processed
      if (processedChargeIds.has(chargeId)) return false;

      // Explicitly food-related keywords
      const isExplicitlyFood =
        desc.includes('restaurant') ||
        desc.includes('dinner') ||
        desc.includes('lunch') ||
        desc.includes('breakfast') ||
        desc.includes('brunch') ||
        desc.includes('meal') ||
        desc.includes('entree') ||
        desc.includes('appetizer') ||
        desc.includes('main course') ||
        desc.includes('dessert') ||
        desc.includes('snack') ||
        desc.includes('buffet') ||
        desc.includes('room service meal'); // More specific room service

      // Explicitly bar-related keywords (to exclude from food)
      const isExplicitlyBar =
        desc.includes('bar') ||
        desc.includes('beer') ||
        desc.includes('wine') ||
        desc.includes('spirit') ||
        desc.includes('liquor') ||
        desc.includes('cocktail') ||
        desc.includes('martini') ||
        desc.includes('margarita') ||
        desc.includes('whiskey') ||
        desc.includes('vodka') ||
        desc.includes('rum') ||
        desc.includes('tequila') ||
        desc.includes('bourbon') ||
        desc.includes('scotch') ||
        desc.includes('gin') ||
        desc.includes('champagne') ||
        desc.includes('alcohol');

      // Mark as processed if it's explicitly food and not bar
      if (isExplicitlyFood && !isExplicitlyBar) {
        processedChargeIds.add(chargeId);
        return true;
      }

      return false;
    })
    .reduce((sum: number, c: any) => sum + Number(c.amount || 0), 0);

  // Calculate Bar Revenue - explicit bar identifiers
  const barRevenue = fbCharges
    .filter((c: any) => {
      const desc = String(c.description || '').toLowerCase();
      const chargeId = String(c.id || '');

      // Skip if already processed
      if (processedChargeIds.has(chargeId)) return false;

      // Explicitly bar-related keywords
      const isExplicitlyBar =
        desc.includes('bar') ||
        desc.includes('beer') ||
        desc.includes('wine') ||
        desc.includes('spirit') ||
        desc.includes('liquor') ||
        desc.includes('cocktail') ||
        desc.includes('martini') ||
        desc.includes('margarita') ||
        desc.includes('whiskey') ||
        desc.includes('vodka') ||
        desc.includes('rum') ||
        desc.includes('tequila') ||
        desc.includes('bourbon') ||
        desc.includes('scotch') ||
        desc.includes('gin') ||
        desc.includes('champagne') ||
        desc.includes('alcohol') ||
        desc.includes('drink') ||
        desc.includes('beverage');

      // Mark as processed
      if (isExplicitlyBar) {
        processedChargeIds.add(chargeId);
        return true;
      }

      return false;
    })
    .reduce((sum: number, c: any) => sum + Number(c.amount || 0), 0);

  // Any remaining unprocessed F&B charges go to Food (fallback)
  const remainingFbRevenue = fbCharges
    .filter((c: any) => {
      const chargeId = String(c.id || '');
      return !processedChargeIds.has(chargeId);
    })
    .reduce((sum: number, c: any) => sum + Number(c.amount || 0), 0);

  // Add remaining revenue to food (conservative approach)
  const finalFoodRevenue = foodRevenue + remainingFbRevenue;

  // Use the already calculated values
  const finalBarRevenue = barRevenue;

  // Calculate last year's F&B breakdown using the same logic
  const lastYearFbCharges = lastYearCharges.filter((c: any) =>
    String(c.category || '').toLowerCase() === 'f&b'
  );

  const lastYearProcessedChargeIds = new Set<string>();

  // Calculate Last Year Food Revenue
  const lastYearFoodRevenue = lastYearFbCharges
    .filter((c: any) => {
      const desc = String(c.description || '').toLowerCase();
      const chargeId = String(c.id || '');

      if (lastYearProcessedChargeIds.has(chargeId)) return false;

      const isExplicitlyFood =
        desc.includes('restaurant') ||
        desc.includes('dinner') ||
        desc.includes('lunch') ||
        desc.includes('breakfast') ||
        desc.includes('brunch') ||
        desc.includes('meal') ||
        desc.includes('entree') ||
        desc.includes('appetizer') ||
        desc.includes('main course') ||
        desc.includes('dessert') ||
        desc.includes('snack') ||
        desc.includes('buffet') ||
        desc.includes('room service meal');

      const isExplicitlyBar =
        desc.includes('bar') ||
        desc.includes('beer') ||
        desc.includes('wine') ||
        desc.includes('spirit') ||
        desc.includes('liquor') ||
        desc.includes('cocktail') ||
        desc.includes('martini') ||
        desc.includes('margarita') ||
        desc.includes('whiskey') ||
        desc.includes('vodka') ||
        desc.includes('rum') ||
        desc.includes('tequila') ||
        desc.includes('bourbon') ||
        desc.includes('scotch') ||
        desc.includes('gin') ||
        desc.includes('champagne') ||
        desc.includes('alcohol');

      if (isExplicitlyFood && !isExplicitlyBar) {
        lastYearProcessedChargeIds.add(chargeId);
        return true;
      }

      return false;
    })
    .reduce((sum: number, c: any) => sum + Number(c.amount || 0), 0);

  // Calculate Last Year Bar Revenue
  const lastYearBarRevenue = lastYearFbCharges
    .filter((c: any) => {
      const desc = String(c.description || '').toLowerCase();
      const chargeId = String(c.id || '');

      if (lastYearProcessedChargeIds.has(chargeId)) return false;

      const isExplicitlyBar =
        desc.includes('bar') ||
        desc.includes('beer') ||
        desc.includes('wine') ||
        desc.includes('spirit') ||
        desc.includes('liquor') ||
        desc.includes('cocktail') ||
        desc.includes('martini') ||
        desc.includes('margarita') ||
        desc.includes('whiskey') ||
        desc.includes('vodka') ||
        desc.includes('rum') ||
        desc.includes('tequila') ||
        desc.includes('bourbon') ||
        desc.includes('scotch') ||
        desc.includes('gin') ||
        desc.includes('champagne') ||
        desc.includes('alcohol') ||
        desc.includes('drink') ||
        desc.includes('beverage');

      if (isExplicitlyBar) {
        lastYearProcessedChargeIds.add(chargeId);
        return true;
      }

      return false;
    })
    .reduce((sum: number, c: any) => sum + Number(c.amount || 0), 0);

  // Remaining last year F&B charges go to Food
  const lastYearRemainingFbRevenue = lastYearFbCharges
    .filter((c: any) => {
      const chargeId = String(c.id || '');
      return !lastYearProcessedChargeIds.has(chargeId);
    })
    .reduce((sum: number, c: any) => sum + Number(c.amount || 0), 0);

  const finalLastYearFoodRevenue = lastYearFoodRevenue + lastYearRemainingFbRevenue;
  const finalLastYearBarRevenue = lastYearBarRevenue;

  // Calculate last year's departmental expenses
  const lastYearDeptExpenses = lastYearBundle ?
    (lastYearBundle.roomRevenue + lastYearBundle.fbRevenue) * 0.35 :
    0;

  // Calculate total departmental expenses from GL ledger
  // These are now populated real-time when vendor expenses are created
  const deptExpenses = (() => {
    // Read from GL ledger — expense accounts for the current date
    try {
      const ledger = gl.getLedger().filter(e => e.date === date);
      const accs = gl.getAccounts();
      const expenseTotal = ledger
        .flatMap(e => e.lines)
        .filter(l => {
          const acc = accs.find(a => a.id === l.accountId);
          return acc?.category === 'Expense';
        })
        .reduce((sum, l) => sum + (l.debit || 0), 0);
      if (expenseTotal > 0) return expenseTotal;
    } catch { }

    // Fallback: check localStorage cache
    const storedExpenses = readJSON<number>('corepms_dept_expenses_total', 0);
    if (storedExpenses > 0) return storedExpenses;

    // Last resort: estimate based on revenue (35% industry average)
    const totalRevenueEstimate = Number(b?.roomRevenue || 0) + finalFoodRevenue + finalBarRevenue;
    return totalRevenueEstimate * 0.35;
  })();

  // Validate that our separated revenues match the original F&B total
  const originalFbRevenue = Number(b?.fbRevenue || 0);
  const calculatedFbTotal = finalFoodRevenue + finalBarRevenue;

  // Log discrepancy warning if significant difference (>5%)
  if (Math.abs(originalFbRevenue - calculatedFbTotal) > (originalFbRevenue * 0.05)) {
    console.warn('F&B Revenue discrepancy detected:', {
      original: originalFbRevenue,
      calculated: calculatedFbTotal,
      difference: Math.abs(originalFbRevenue - calculatedFbTotal),
      food: foodRevenue,
      bar: barRevenue
    });
  }

  // Calculate totals for current period
  const currentTotalRevenue = Number(b?.roomRevenue || 0) + calculatedFbTotal;

  // Calculate totals for last year
  const lastYearTotalFbRevenue = finalLastYearFoodRevenue + finalLastYearBarRevenue;
  const lastYearTotalRevenue = lastYearBundle ?
    (Number(lastYearBundle.roomRevenue || 0) + lastYearTotalFbRevenue) : 0;

  // Get last year's cash/card data
  const lastYearCashCard = lastYearBundle ?
    readJSON<Record<string, number>>(`corepms_shift_totals_${lastYearDate}`, { cash: 0, card: 0 }) :
    { cash: 0, card: 0 };

  const rows = [
    // Room Revenue with YoY comparison
    {
      metric: 'Room Revenue',
      today: Number(b?.roomRevenue || 0),
      lastYear: Number(lastYearBundle?.roomRevenue || 0),
      difference: Number(b?.roomRevenue || 0) - Number(lastYearBundle?.roomRevenue || 0)
    },
    // Food Revenue with YoY comparison
    {
      metric: 'Food Revenue',
      today: Number(finalFoodRevenue.toFixed(2)),
      lastYear: Number(finalLastYearFoodRevenue.toFixed(2)),
      difference: Number(finalFoodRevenue.toFixed(2)) - Number(finalLastYearFoodRevenue.toFixed(2))
    },
    // Bar Revenue with YoY comparison
    {
      metric: 'Bar Revenue',
      today: Number(finalBarRevenue.toFixed(2)),
      lastYear: Number(finalLastYearBarRevenue.toFixed(2)),
      difference: Number(finalBarRevenue.toFixed(2)) - Number(finalLastYearBarRevenue.toFixed(2))
    },
    // Total F&B Revenue with YoY comparison
    {
      metric: 'Total F&B Revenue',
      today: Number(calculatedFbTotal.toFixed(2)),
      lastYear: Number(lastYearTotalFbRevenue.toFixed(2)),
      difference: Number(calculatedFbTotal.toFixed(2)) - Number(lastYearTotalFbRevenue.toFixed(2))
    },
    // Total Revenue with YoY comparison
    {
      metric: 'Total Revenue',
      today: Number(currentTotalRevenue.toFixed(2)),
      lastYear: Number(lastYearTotalRevenue.toFixed(2)),
      difference: Number(currentTotalRevenue.toFixed(2)) - Number(lastYearTotalRevenue.toFixed(2))
    },
    // Total Departmental Expenses with YoY comparison
    {
      metric: 'Total Departmental Expenses',
      today: Number(deptExpenses.toFixed(2)),
      lastYear: Number(lastYearDeptExpenses.toFixed(2)),
      difference: Number(deptExpenses.toFixed(2)) - Number(lastYearDeptExpenses.toFixed(2))
    },
    // Occupancy % with YoY comparison
    {
      metric: 'Occupancy %',
      today: Number(b?.occupancy || 0),
      lastYear: Number(lastYearBundle?.occupancy || 0),
      difference: Number(b?.occupancy || 0) - Number(lastYearBundle?.occupancy || 0)
    },
    // ADR with YoY comparison
    {
      metric: 'ADR',
      today: Number(b?.avgDailyRate || 0),
      lastYear: Number(lastYearBundle?.avgDailyRate || 0),
      difference: Number(b?.avgDailyRate || 0) - Number(lastYearBundle?.avgDailyRate || 0)
    },
    // RevPAR with YoY comparison
    {
      metric: 'RevPAR',
      today: Number(b?.revPAR || 0),
      lastYear: Number(lastYearBundle?.revPAR || 0),
      difference: Number(b?.revPAR || 0) - Number(lastYearBundle?.revPAR || 0)
    },
    // Cash Receipts with YoY comparison
    {
      metric: 'Cash Receipts',
      today: Number(cashCard.cash || 0),
      lastYear: Number(lastYearCashCard.cash || 0),
      difference: Number(cashCard.cash || 0) - Number(lastYearCashCard.cash || 0)
    },
    // Card Receipts with YoY comparison
    {
      metric: 'Card Receipts',
      today: Number(cashCard.card || 0),
      lastYear: Number(lastYearCashCard.card || 0),
      difference: Number(cashCard.card || 0) - Number(lastYearCashCard.card || 0)
    }
  ];

  return {
    title: `Manager's Flash Report — ${date}`,
    subtitle: `Year-over-Year Comparison (vs ${lastYearDate})`,
    columns: ['Metric', 'Today', 'Same Day Last Year', 'Difference'],
    rows,
    metadata: {
      foodRevenue: Number(finalFoodRevenue.toFixed(2)),
      barRevenue: Number(finalBarRevenue.toFixed(2)),
      deptExpenses: Number(deptExpenses.toFixed(2)),
      lastYearDate,
      lastYearAvailable: !!lastYearBundle,
      lastYearData: {
        foodRevenue: Number(finalLastYearFoodRevenue.toFixed(2)),
        barRevenue: Number(finalLastYearBarRevenue.toFixed(2)),
        deptExpenses: Number(lastYearDeptExpenses.toFixed(2)),
        roomRevenue: Number(lastYearBundle?.roomRevenue || 0),
        totalRevenue: Number(lastYearTotalRevenue.toFixed(2)),
        occupancy: Number(lastYearBundle?.occupancy || 0),
        adr: Number(lastYearBundle?.avgDailyRate || 0),
        revpar: Number(lastYearBundle?.revPAR || 0)
      }
    }
  };
};

// POS Sales/Cashier Reconciliation
export const buildPosReconciliation = (forDate?: string) => {
  const ended = readJSON<any[]>('corepms_endedShifts', []);
  const rows = ended.map(s => ({ cashier: s.openedBy || s.id, outlet: s.department || 'POS', sales: Number(s.totals?.total || s.totalSales || 0), cash: Number(s.totals?.cash || s.cashPayments || 0), card: Number(s.totals?.card || s.cardPayments || 0), overShort: Number((s.report_data?.cashDifference || 0)) }));
  const date = forDate || getBusinessDate();
  return { title: `POS Sales & Cashier Reconciliation — ${date}`, columns: ['Cashier', 'Outlet', 'Sales', 'Cash', 'Card', 'Over/Short'], rows };
};

// Daily Purchase & Receiving Log (simple placeholder using expenses and vendors if present)
export const buildPurchaseReceivingLog = (forDate?: string) => {
  const purchases = readJSON<any[]>('corepms_purchases', []);
  const date = forDate || getBusinessDate();
  const rows = purchases.filter(p => p.date === date).map(p => ({ item: p.itemName || p.item || 'Item', vendor: p.vendorName || p.vendorId || 'Vendor', po: p.poId || p.po || '-', unitCost: Number(p.unitCost || 0), qty: Number(p.quantity || 0), total: Number((Number(p.unitCost || 0) * Number(p.quantity || 0)).toFixed(2)) }));
  return { title: `Daily Purchase & Receiving — ${date}`, columns: ['Item', 'Vendor', 'PO', 'Unit Cost', 'Qty', 'Total Value'], rows };
};

// Housekeeping Status (daily snapshot from room service)
export const buildHousekeepingStatus = () => {
  const rooms = roomSvc.getRooms();
  const byStatus: Record<string, number> = {};
  rooms.forEach(r => { byStatus[r.status] = (byStatus[r.status] || 0) + 1; });
  const rows = Object.entries(byStatus).map(([status, count]) => ({ status, count }));
  const date = new Date().toISOString().slice(0, 10);
  return { title: `Housekeeping Status — ${date}`, columns: ['Status', 'Count'], rows };
};

// Daily Tax Report (sum of TAX account for date from GL)
export const buildDailyTax = (forDate?: string) => {
  const date = forDate || new Date().toISOString().slice(0, 10);
  const ledger = gl.getLedger().filter(e => e.date === date);
  const taxAcc = gl.getMappings().TAX || 'TAX';
  const totalTax = ledger.flatMap(e => e.lines).filter(l => l.accountId === taxAcc).reduce((s, l) => s + (l.debit || 0) + (l.credit || 0), 0);
  const rows = [{ metric: 'Tax Collected', value: Number(totalTax.toFixed(2)) }];
  return { title: `Daily Tax Report — ${date}`, columns: ['Metric', 'Value'], rows };
};

// Cash & Bank Deposits (daily totals for CASH/BANK accounts)
export const buildCashBankDeposits = (forDate?: string) => {
  const date = forDate || new Date().toISOString().slice(0, 10);
  const ledger = gl.getLedger().filter(e => e.date === date);
  const cashAcc = gl.getMappings().CASH || '1000';
  const bankAcc = gl.getMappings().BANK || '1100';
  const lines = ledger.flatMap(e => e.lines);
  const cashTotal = lines.filter(l => l.accountId === cashAcc).reduce((s, l) => s + (l.debit || 0) + (l.credit || 0), 0);
  const bankTotal = lines.filter(l => l.accountId === bankAcc).reduce((s, l) => s + (l.debit || 0) + (l.credit || 0), 0);
  const rows = [
    { account: 'Cash', total: Number(cashTotal.toFixed(2)) },
    { account: 'Bank', total: Number(bankTotal.toFixed(2)) }
  ];
  return { title: `Cash & Bank Deposits — ${date}`, columns: ['Account', 'Total'], rows };
};

// Trial Balance (monthly)
export const buildTrialBalance = (monthISO: string) => {
  const [y, m] = monthISO.split('-');
  const start = `${y}-${m}-01`;
  const endDate = new Date(Number(y), Number(m));
  const end = endDate.toISOString().slice(0, 10);
  const tb = gl.getTrialBalance(start, end);
  const rows = tb.map(a => ({ accountId: a.accountId, name: a.name, debit: a.debit, credit: a.credit, balance: a.balance }));
  return { title: `Trial Balance — ${monthISO}`, columns: ['Account', 'Name', 'Debit', 'Credit', 'Balance'], rows };
};

// Monthly Operating Departmental Summary (USALI)
export const buildDepartmentalSummary = async (monthISO: string) => {
  const [y, m] = monthISO.split('-');
  const start = `${y}-${m}-01`;
  const endDate = new Date(Number(y), Number(m));
  const end = endDate.toISOString().slice(0, 10);
  const usali = await expenseSvc.getUSALIIncomeStatement(start, end);
  const rows: Array<any> = [];
  rows.push({ section: 'Revenue', metric: 'Total Revenue', amount: Number(usali.revenue || 0) });
  usali.departmentalExpenses.forEach(d => rows.push({ section: 'Departmental Expenses', metric: d.costCenter, amount: d.amount }));
  rows.push({ section: 'Departmental Profit', metric: 'Dept Profit', amount: Number(usali.departmentalProfit || 0) });
  usali.undistributedExpenses.forEach(d => rows.push({ section: 'Undistributed Expenses', metric: d.costCenter, amount: d.amount }));
  rows.push({ section: 'GOP', metric: 'Gross Operating Profit', amount: Number(usali.GOP || 0) });
  if (usali.budget) {
    rows.push({ section: 'Budget', metric: 'Budget Revenue', amount: Number(usali.budget.revenue || 0) });
  }
  return { title: `Operating Departmental Summary (USALI) — ${monthISO}`, columns: ['Section', 'Metric', 'Amount'], rows };
};

// Arrivals / Departures (daily)
export const buildArrivalsDepartures = (forDate?: string) => {
  const date = forDate || getBusinessDate();
  const reservations = readJSON<any[]>('corepms_reservations', []);
  const arrivals = reservations.filter(r => (r.checkIn || '').slice(0, 10) === date);
  const departures = reservations.filter(r => (r.checkOut || '').slice(0, 10) === date);
  const rows = [
    ...arrivals.map(r => ({ type: 'Arrival', guest: r.guestName || r.bookingName || '—', room: r.roomType || r.roomNumber || '—', time: (r.checkIn || '').slice(11, 16) || '—' })),
    ...departures.map(r => ({ type: 'Departure', guest: r.guestName || r.bookingName || '—', room: r.roomType || r.roomNumber || '—', time: (r.checkOut || '').slice(11, 16) || '—' }))
  ];
  return { title: `Arrivals & Departures — ${date}`, columns: ['Type', 'Guest', 'Room', 'Time'], rows };
};

// High Balance (daily) across folios and city ledger transfers
export const buildHighBalance = (threshold?: number, forDate?: string) => {
  const date = forDate || getBusinessDate();
  const th = typeof threshold === 'number' ? threshold : readJSON<number>('corepms_high_balance_threshold', 500);
  const folios = readJSON<any[]>('corepms_folios', []);
  const cityLedger = readJSON<any[]>('corepms_city_ledger', []);
  const folioRows = folios.filter(f => Number(f.balance || f.folioBalance || 0) >= th).map(f => ({ source: 'Folio', id: f.id || f.guestId || '—', name: f.guestName || f.name || '—', balance: Number((f.balance || f.folioBalance || 0).toFixed?.(2) ?? Number(f.balance || f.folioBalance || 0).toFixed(2)) }));
  const ledgerAgg: Record<string, number> = {};
  cityLedger.forEach(tx => { const key = tx.guestId || tx.accountName || 'unknown'; ledgerAgg[key] = (ledgerAgg[key] || 0) + Number(tx.amount || 0); });
  const ledgerRows = Object.entries(ledgerAgg).filter(([_, amt]) => amt >= th).map(([key, amt]) => ({ source: 'City Ledger', id: key, name: key, balance: Number(amt.toFixed(2)) }));
  const rows = [...folioRows, ...ledgerRows];
  return { title: `High Balance — ${date} (Threshold: $${th})`, columns: ['Source', 'ID', 'Name', 'Balance'], rows };
};

// Procurement Variance (monthly) using AP invoices vs Purchase Orders
export const buildProcurementVariance = (monthISO: string) => {
  const [y, m] = monthISO.split('-');
  const start = `${y}-${m}-01`;
  const endDate = new Date(Number(y), Number(m));
  const end = endDate.toISOString().slice(0, 10);
  const invoices = readJSON<any[]>('corepms_ap_invoices', []).filter(i => (i.invoice_date || '').slice(0, 10) >= start && (i.invoice_date || '').slice(0, 10) <= end);
  const pos = readJSON<any[]>('corepms_purchase_orders', []);
  const poById: Record<string, number> = {}; pos.forEach(p => { const id = p.po_id || p.id; poById[id] = Number(p.amount || p.total_amount || 0); });
  const rows = invoices.map(inv => {
    const poId = inv.purchase_order_id || inv.po_id || inv.poId || '—';
    const invAmt = Number(inv.total_amount || inv.totalAmount || 0);
    const poAmt = Number(poById[poId] || 0);
    const variancePct = poAmt ? Number((((invAmt - poAmt) / poAmt) * 100).toFixed(2)) : 0;
    const flagged = Math.abs(variancePct) > 10;
    return { invoice: inv.invoice_number || inv.invoiceNumber || inv.invoice_id || '—', vendor: inv.vendor_id || inv.vendorId || '—', poId, invoiceAmount: invAmt, poAmount: poAmt, variancePct, flagged };
  });
  return { title: `Procurement Variance — ${monthISO}`, columns: ['Invoice', 'Vendor', 'PO', 'Invoice Amount', 'PO Amount', 'Variance %', 'Flagged'], rows };
};

// Fixed Asset Register Reconciliation (monthly stub)
export const buildFixedAssetRecon = (monthISO: string) => {
  const assets = readJSON<any[]>('corepms_fixed_assets', []);
  const rows = assets.length === 0 ? [{ assetId: '—', name: 'Dataset not available', status: 'N/A' }] : assets.map(a => ({ assetId: a.id || a.asset_id || '—', name: a.name || 'Asset', status: 'OK' }));
  return { title: `Fixed Asset Register Reconciliation — ${monthISO}`, columns: ['Asset ID', 'Name', 'Status'], rows };
};

// Monthly Profit & Loss (USALI-style summary using GL trial balance)
export const buildMonthlyPL = (monthISO: string) => {
  const [y, m] = monthISO.split('-');
  const start = `${y}-${m}-01`;
  const end = new Date(Number(y), Number(m)).toISOString().slice(0, 10); // first day of next month
  const pl = gl.getPLStatement(start, end);
  const rows = [
    { category: 'Revenue', amount: Number(pl.revenue || 0) },
    { category: 'Expense', amount: Number(pl.expense || 0) },
    { category: 'GOP (Revenue - Expense)', amount: Number((pl.revenue - pl.expense).toFixed(2)) },
    { category: 'Net Income', amount: Number(pl.netIncome || 0) }
  ];
  return { title: `Profit & Loss — ${monthISO}`, columns: ['Category', 'Amount'], rows };
};

// Aged Accounts Receivable (City Ledger Aging)
export const buildAgedAR = (asOf?: string) => {
  const date = asOf || getBusinessDate();
  const ledger = readJSON<any[]>('corepms_city_ledger', []);
  const now = new Date(date);
  const ageDays = (d: string) => Math.floor((now.getTime() - new Date(d).getTime()) / (1000 * 60 * 60 * 24));
  const rows = ledger.map(t => ({ account: t.guestName || t.accountName || 'Account', reference: t.reason || t.reference || '', date: t.date, amount: Number(t.amount || 0), bucket: (() => { const a = ageDays(t.date || date); return a <= 30 ? '0-30' : a <= 60 ? '31-60' : a <= 90 ? '61-90' : '90+'; })() }));
  return { title: `Aged Accounts Receivable — ${date}`, columns: ['Account', 'Reference', 'Date', 'Amount', 'Aging'], rows };
};

// Inventory & COGS (simple summary using purchases and opening/ending balances if present)
export const buildInventoryCOGS = (monthISO: string) => {
  const opening = readJSON<number>('corepms_inventory_opening', 0);
  const ending = readJSON<number>('corepms_inventory_ending', 0);
  const purchases = readJSON<any[]>('corepms_purchases', []).filter(p => (p.date || '').startsWith(monthISO));
  const purchasesTotal = purchases.reduce((s, p) => s + Number((Number(p.unitCost || 0) * Number(p.quantity || 0)) || 0), 0);
  const cogs = Number((opening + purchasesTotal - ending).toFixed(2));
  const rows = [
    { metric: 'Opening Inventory', value: Number(opening || 0) },
    { metric: 'Purchases', value: Number(purchasesTotal || 0) },
    { metric: 'Ending Inventory', value: Number(ending || 0) },
    { metric: 'COGS', value: Number(cogs || 0) }
  ];
  return { title: `Inventory & COGS — ${monthISO}`, columns: ['Metric', 'Value'], rows };
};

// ============================================================================
// VENDOR REPORTING SUITE
// ============================================================================

// Open Bills Report — unpaid/partially-paid vendor expenses
export const buildOpenBills = () => {
  const expenses: any[] = readJSON('corepms_vendor_expenses', []);
  const payments: any[] = readJSON('corepms_vendor_payments', []);
  const paymentsByVendor: Record<string, number> = {};
  payments.forEach(p => { paymentsByVendor[p.vendor_id] = (paymentsByVendor[p.vendor_id] || 0) + Number(p.amount_paid || 0); });

  const openBills = expenses
    .filter(e => e.status !== 'paid' && e.status !== 'cleared')
    .map(e => {
      const totalPaid = paymentsByVendor[e.vendor_id] || 0;
      const outstanding = Number(e.total_cost || 0) - totalPaid;
      return { ...e, outstanding: Math.max(0, outstanding) };
    })
    .filter(e => e.outstanding > 0);

  const rows = openBills.map(b => ({
    vendor: b.vendor_name || b.vendor_id,
    reference: b.reference_number || b.id?.slice(0, 8),
    date: b.expense_date,
    description: b.description,
    total: Number(b.total_cost || 0).toFixed(2),
    outstanding: b.outstanding.toFixed(2),
    department: b.department,
    status: b.status,
  }));

  const totalOutstanding = openBills.reduce((s, b) => s + b.outstanding, 0);
  return {
    title: 'Open Bills Report',
    columns: ['Vendor', 'Reference', 'Date', 'Description', 'Total', 'Outstanding', 'Department', 'Status'],
    rows,
    summary: { totalOutstanding: totalOutstanding.toFixed(2), count: openBills.length },
  };
};

// Aged Payables Summary — aging buckets: Current, 1-30, 31-60, 61-90, 90+
export const buildAgedPayables = (asOfISO: string = new Date().toISOString().slice(0, 10)) => {
  const expenses: any[] = readJSON('corepms_vendor_expenses', []);
  const asOf = new Date(asOfISO);
  const diffDays = (d: string) => Math.floor((asOf.getTime() - new Date(d).getTime()) / 86400000);

  const buckets = { current: 0, '1_30': 0, '31_60': 0, '61_90': 0, over90: 0 };
  const vendorBuckets: Record<string, typeof buckets> = {};

  expenses.filter(e => e.status !== 'paid' && e.status !== 'cleared').forEach(e => {
    const days = diffDays(e.expense_date);
    const amt = Number(e.total_cost || 0);
    const vName = e.vendor_name || e.vendor_id;
    if (!vendorBuckets[vName]) vendorBuckets[vName] = { current: 0, '1_30': 0, '31_60': 0, '61_90': 0, over90: 0 };
    const b = vendorBuckets[vName];
    if (days <= 0) { b.current += amt; buckets.current += amt; }
    else if (days <= 30) { b['1_30'] += amt; buckets['1_30'] += amt; }
    else if (days <= 60) { b['31_60'] += amt; buckets['31_60'] += amt; }
    else if (days <= 90) { b['61_90'] += amt; buckets['61_90'] += amt; }
    else { b.over90 += amt; buckets.over90 += amt; }
  });

  const rows = Object.entries(vendorBuckets).map(([vendor, b]) => ({
    vendor,
    current: b.current.toFixed(2),
    '1-30': b['1_30'].toFixed(2),
    '31-60': b['31_60'].toFixed(2),
    '61-90': b['61_90'].toFixed(2),
    '90+': b.over90.toFixed(2),
    total: (b.current + b['1_30'] + b['31_60'] + b['61_90'] + b.over90).toFixed(2),
  }));

  return {
    title: `Aged Payables Summary — as of ${asOfISO}`,
    columns: ['Vendor', 'Current', '1-30', '31-60', '61-90', '90+', 'Total'],
    rows,
    totals: {
      current: buckets.current.toFixed(2), '1-30': buckets['1_30'].toFixed(2),
      '31-60': buckets['31_60'].toFixed(2), '61-90': buckets['61_90'].toFixed(2),
      '90+': buckets.over90.toFixed(2),
      total: (buckets.current + buckets['1_30'] + buckets['31_60'] + buckets['61_90'] + buckets.over90).toFixed(2),
    },
  };
};

// Purchase Order History (uses expense records as purchase proxies)
export const buildPurchaseOrderHistory = (from: string, to: string) => {
  const expenses: any[] = readJSON('corepms_vendor_expenses', []);
  const filtered = expenses.filter(e => e.expense_date >= from && e.expense_date <= to)
    .sort((a, b) => b.expense_date.localeCompare(a.expense_date));

  const rows = filtered.map(e => ({
    date: e.expense_date,
    vendor: e.vendor_name || e.vendor_id,
    reference: e.reference_number || e.id?.slice(0, 8),
    description: e.description,
    quantity: e.quantity || 1,
    unitCost: Number(e.unit_cost || 0).toFixed(2),
    total: Number(e.total_cost || 0).toFixed(2),
    department: e.department,
    category: e.category,
    status: e.status,
  }));

  const grandTotal = filtered.reduce((s, e) => s + Number(e.total_cost || 0), 0);
  return {
    title: `Purchase Order History — ${from} to ${to}`,
    columns: ['Date', 'Vendor', 'Reference', 'Description', 'Qty', 'Unit Cost', 'Total', 'Department', 'Category', 'Status'],
    rows,
    summary: { grandTotal: grandTotal.toFixed(2), count: filtered.length },
  };
};

// Payment History + Check Register
export const buildPaymentHistory = (from: string, to: string) => {
  const payments: any[] = readJSON('corepms_vendor_payments', []);
  const filtered = payments.filter(p => {
    const d = typeof p.payment_date === 'string' ? p.payment_date : new Date(p.payment_date).toISOString().slice(0, 10);
    return d >= from && d <= to;
  }).sort((a, b) => String(b.payment_date).localeCompare(String(a.payment_date)));

  const rows = filtered.map((p, i) => ({
    checkNo: `PAY-${String(i + 1).padStart(4, '0')}`,
    date: typeof p.payment_date === 'string' ? p.payment_date : new Date(p.payment_date).toISOString().slice(0, 10),
    vendor: p.vendor_name || p.vendor_id,
    method: p.payment_method,
    reference: p.reference_number || '',
    amount: Number(p.amount_paid || 0).toFixed(2),
    notes: p.notes || '',
  }));

  const totalPaid = filtered.reduce((s, p) => s + Number(p.amount_paid || 0), 0);
  return {
    title: `Payment History & Check Register — ${from} to ${to}`,
    columns: ['Check No.', 'Date', 'Vendor', 'Method', 'Reference', 'Amount', 'Notes'],
    rows,
    summary: { totalPaid: totalPaid.toFixed(2), count: filtered.length },
  };
};

// Vendor Payment Summary — totals per vendor for a period
export const buildVendorPaymentSummary = (from: string, to: string) => {
  const payments: any[] = readJSON('corepms_vendor_payments', []);
  const filtered = payments.filter(p => {
    const d = typeof p.payment_date === 'string' ? p.payment_date : new Date(p.payment_date).toISOString().slice(0, 10);
    return d >= from && d <= to;
  });

  const byVendor: Record<string, { total: number; count: number; methods: Set<string> }> = {};
  filtered.forEach(p => {
    const v = p.vendor_name || p.vendor_id;
    if (!byVendor[v]) byVendor[v] = { total: 0, count: 0, methods: new Set() };
    byVendor[v].total += Number(p.amount_paid || 0);
    byVendor[v].count += 1;
    byVendor[v].methods.add(p.payment_method || 'Unknown');
  });

  const rows = Object.entries(byVendor)
    .sort((a, b) => b[1].total - a[1].total)
    .map(([vendor, data]) => ({
      vendor,
      payments: data.count,
      methods: Array.from(data.methods).join(', '),
      totalPaid: data.total.toFixed(2),
    }));

  const grandTotal = Object.values(byVendor).reduce((s, d) => s + d.total, 0);
  return {
    title: `Vendor Payment Summary — ${from} to ${to}`,
    columns: ['Vendor', 'Payments', 'Methods Used', 'Total Paid'],
    rows,
    summary: { grandTotal: grandTotal.toFixed(2), vendorCount: rows.length },
  };
};

// Expenses by Department / Date Range
export const buildExpensesByDepartment = (from: string, to: string) => {
  const expenses: any[] = readJSON('corepms_vendor_expenses', []);
  const filtered = expenses.filter(e => e.expense_date >= from && e.expense_date <= to);

  const byDept: Record<string, { total: number; count: number; categories: Record<string, number> }> = {};
  filtered.forEach(e => {
    const d = e.department || 'Unassigned';
    if (!byDept[d]) byDept[d] = { total: 0, count: 0, categories: {} };
    byDept[d].total += Number(e.total_cost || 0);
    byDept[d].count += 1;
    const cat = e.category || 'Other';
    byDept[d].categories[cat] = (byDept[d].categories[cat] || 0) + Number(e.total_cost || 0);
  });

  const grandTotal = filtered.reduce((s, e) => s + Number(e.total_cost || 0), 0);
  const rows = Object.entries(byDept)
    .sort((a, b) => b[1].total - a[1].total)
    .flatMap(([dept, data]) => {
      const deptRow = {
        department: dept,
        category: '— ALL —',
        count: data.count,
        total: data.total.toFixed(2),
        pct: grandTotal > 0 ? ((data.total / grandTotal) * 100).toFixed(1) + '%' : '0%',
      };
      const catRows = Object.entries(data.categories).sort((a, b) => b[1] - a[1]).map(([cat, amt]) => ({
        department: '',
        category: `  └ ${cat}`,
        count: '',
        total: amt.toFixed(2),
        pct: data.total > 0 ? ((amt / data.total) * 100).toFixed(1) + '%' : '0%',
      }));
      return [deptRow, ...catRows];
    });

  return {
    title: `Expenses by Department — ${from} to ${to}`,
    columns: ['Department', 'Category', 'Count', 'Total', '% Share'],
    rows,
    summary: { grandTotal: grandTotal.toFixed(2), departments: Object.keys(byDept).length },
  };
};

// Daily / Monthly Expense Summaries
export const buildExpenseSummary = (period: 'daily' | 'monthly', from: string, to: string) => {
  const expenses: any[] = readJSON('corepms_vendor_expenses', []);
  const filtered = expenses.filter(e => e.expense_date >= from && e.expense_date <= to);

  const byPeriod: Record<string, { total: number; count: number }> = {};
  filtered.forEach(e => {
    const key = period === 'daily' ? e.expense_date : (e.expense_date || '').slice(0, 7);
    if (!byPeriod[key]) byPeriod[key] = { total: 0, count: 0 };
    byPeriod[key].total += Number(e.total_cost || 0);
    byPeriod[key].count += 1;
  });

  const rows = Object.entries(byPeriod)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([p, d]) => ({
      period: p,
      transactions: d.count,
      total: d.total.toFixed(2),
      average: d.count > 0 ? (d.total / d.count).toFixed(2) : '0.00',
    }));

  const grandTotal = filtered.reduce((s, e) => s + Number(e.total_cost || 0), 0);
  return {
    title: `${period === 'daily' ? 'Daily' : 'Monthly'} Expense Summary — ${from} to ${to}`,
    columns: ['Period', 'Transactions', 'Total', 'Avg per Transaction'],
    rows,
    summary: { grandTotal: grandTotal.toFixed(2), periods: rows.length, avgPerPeriod: rows.length > 0 ? (grandTotal / rows.length).toFixed(2) : '0.00' },
  };
};

// Detailed Line-Item Export — every expense row with all fields
export const buildDetailedLineItemExport = (from: string, to: string) => {
  const expenses: any[] = readJSON('corepms_vendor_expenses', []);
  const filtered = expenses.filter(e => e.expense_date >= from && e.expense_date <= to)
    .sort((a, b) => a.expense_date.localeCompare(b.expense_date));

  const rows = filtered.map((e, i) => ({
    id: `EXP-${String(i + 1).padStart(4, '0')}`,
    date: e.expense_date,
    vendor: e.vendor_name || e.vendor_id,
    reference: e.reference_number || '',
    description: e.description,
    department: e.department,
    category: e.category,
    quantity: e.quantity || 1,
    unitCost: Number(e.unit_cost || 0).toFixed(2),
    taxRate: `${Number(e.tax_rate || 0)}%`,
    taxAmount: Number(e.tax_amount || 0).toFixed(2),
    total: Number(e.total_cost || 0).toFixed(2),
    status: e.status,
  }));

  const grandTotal = filtered.reduce((s, e) => s + Number(e.total_cost || 0), 0);
  const totalTax = filtered.reduce((s, e) => s + Number(e.tax_amount || 0), 0);
  return {
    title: `Detailed Line-Item Export — ${from} to ${to}`,
    columns: ['ID', 'Date', 'Vendor', 'Reference', 'Description', 'Department', 'Category', 'Qty', 'Unit Cost', 'Tax Rate', 'Tax', 'Total', 'Status'],
    rows,
    summary: { grandTotal: grandTotal.toFixed(2), totalTax: totalTax.toFixed(2), count: filtered.length },
  };
};

// Export helpers
export const exportCSV = (columns: string[], rows: any[], filename: string) => {
  const esc = (v: any) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  // Auto-format ISO date strings to DDMMYYYY-HHMMSS
  const fmtVal = (v: any) => {
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}(T|\s)/.test(v)) {
      try {
        const d = new Date(v);
        if (!isNaN(d.getTime())) {
          const p = new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(d);
          const g = (t: string) => p.find(x => x.type === t)?.value || '00';
          return `${g('day')}${g('month')}${g('year')}-${g('hour')}${g('minute')}${g('second')}`;
        }
      } catch { }
    }
    return v;
  };
  const header = columns.map(esc).join(',');
  const body = rows.map(r => columns.map(c => esc(fmtVal(r[c.toLowerCase()] ?? r[c] ?? ''))).join(',')).join('\n');
  const blob = new Blob([header + '\n' + body], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename.endsWith('.csv') ? filename : (filename + '.csv'); a.click(); URL.revokeObjectURL(url);
};

// Excel-compatible XML Spreadsheet (.xls)
export const exportXLS = (columns: string[], rows: any[], filename: string) => {
  const xmlHeader = `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Report"><Table>`;
  const xmlFooter = `</Table></Worksheet></Workbook>`;
  const th = `<Row>` + columns.map(c => `<Cell><Data ss:Type="String">${c}</Data></Cell>`).join('') + `</Row>`;
  const tr = rows.map(r => `<Row>` + columns.map(c => { const v = r[c.toLowerCase()] ?? r[c] ?? ''; const type = typeof v === 'number' ? 'Number' : 'String'; return `<Cell><Data ss:Type="${type}">${String(v)}</Data></Cell>`; }).join('') + `</Row>`).join('');
  const content = xmlHeader + th + tr + xmlFooter;
  const blob = new Blob([content], { type: 'application/vnd.ms-excel' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename.endsWith('.xls') ? filename : (filename + '.xls'); a.click(); URL.revokeObjectURL(url);
};

export const exportXLSMulti = (sheets: Array<{ name: string; columns: string[]; rows: any[] }>, filename: string) => {
  const esc = (v: any) => String(v ?? '');
  const xmlHeader = `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">`;
  const xmlFooter = `</Workbook>`;
  const ws = sheets.map(s => {
    const th = `<Row>` + s.columns.map(c => `<Cell><Data ss:Type="String">${c}</Data></Cell>`).join('') + `</Row>`;
    const tr = s.rows.map(r => `<Row>` + s.columns.map(c => { const v = r[c.toLowerCase()] ?? r[c] ?? ''; const type = typeof v === 'number' ? 'Number' : 'String'; return `<Cell><Data ss:Type="${type}">${esc(v)}</Data></Cell>`; }).join('') + `</Row>`).join('');
    return `<Worksheet ss:Name="${s.name}"><Table>${th}${tr}</Table></Worksheet>`;
  }).join('');
  const content = xmlHeader + ws + xmlFooter;
  const blob = new Blob([content], { type: 'application/vnd.ms-excel' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename.endsWith('.xls') ? filename : (filename + '.xls'); a.click(); URL.revokeObjectURL(url);
};

export const exportMonthlyWorkbookXLS = (monthISO: string, filename?: string) => {
  const pl = buildMonthlyPL(monthISO);
  const ar = buildAgedAR(`${monthISO}-01`); // use first day as as-of
  const inv = buildInventoryCOGS(monthISO);
  const tb = buildTrialBalance(monthISO);
  exportXLSMulti([
    { name: 'P&L', columns: pl.columns, rows: pl.rows },
    { name: 'Aged AR', columns: ar.columns, rows: ar.rows },
    { name: 'Inventory & COGS', columns: inv.columns, rows: inv.rows },
    { name: 'Trial Balance', columns: tb.columns, rows: tb.rows }
  ], (filename || `MonthEnd_${monthISO}`));
};

// Optional SQL provider scaffolding
export type ReportsProvider = {
  flash: (date: string) => Promise<{ title: string; columns: string[]; rows: any[] }>;
  posRecon: (date: string) => Promise<{ title: string; columns: string[]; rows: any[] }>;
  purchaseLog: (date: string) => Promise<{ title: string; columns: string[]; rows: any[] }>;
  pl: (monthISO: string) => Promise<{ title: string; columns: string[]; rows: any[] }>;
  agedAR: (asOf: string) => Promise<{ title: string; columns: string[]; rows: any[] }>;
  inventoryCOGS: (monthISO: string) => Promise<{ title: string; columns: string[]; rows: any[] }>;
};

export const localProvider: ReportsProvider = {
  flash: async (d) => buildFlashReport(d),
  posRecon: async (d) => buildPosReconciliation(d),
  purchaseLog: async (d) => buildPurchaseReceivingLog(d),
  pl: async (m) => buildMonthlyPL(m),
  agedAR: async (d) => buildAgedAR(d),
  inventoryCOGS: async (m) => buildInventoryCOGS(m)
};

export const sqlProvider: ReportsProvider = {
  flash: async (d) => (await (await fetch(`/api/reports/flash?date=${encodeURIComponent(d)}`)).json()),
  posRecon: async (d) => (await (await fetch(`/api/reports/pos-recon?date=${encodeURIComponent(d)}`)).json()),
  purchaseLog: async (d) => (await (await fetch(`/api/reports/purchase-log?date=${encodeURIComponent(d)}`)).json()),
  pl: async (m) => (await (await fetch(`/api/reports/pl?month=${encodeURIComponent(m)}`)).json()),
  agedAR: async (d) => (await (await fetch(`/api/reports/aged-ar?date=${encodeURIComponent(d)}`)).json()),
  inventoryCOGS: async (m) => (await (await fetch(`/api/reports/inventory-cogs?month=${encodeURIComponent(m)}`)).json())
};

export const getProvider = (): ReportsProvider => {
  try { const flag = localStorage.getItem('corepms_reports_use_sql'); if (flag === 'on') return sqlProvider; } catch { }
  return localProvider;
};

// ============================================================================
// REPORT LAYOUT STYLES - Matching ReportLayout.tsx patterns
// ============================================================================

export interface ReportMeta {
  label: string;
  value: string;
}

export interface ReportOptions {
  title: string;
  subtitle?: string;
  columns: Array<{ key: string; label: string; align?: 'left' | 'center' | 'right'; width?: string }>;
  rows: any[];
  metaInfo?: ReportMeta[];
  showSignature?: boolean;
  signatureLabels?: { left?: string; right?: string };
  footerSummary?: Array<{ label: string; value: string | number; isTotal?: boolean }>;
  reportType?: 'detailed' | 'summary';
  pageSize?: 'A4' | 'Letter';
}

/**
 * Generate full HTML document for printing reports with consistent branding.
 * Follows the ReportLayout component patterns for accounting-standard compliance.
 */
export const generateReportHTML = (title: string, columns: string[], rows: any[], options?: Partial<ReportOptions>) => {
  const brand = readReceiptBranding();
  const opts = options || {};
  const colDefs = columns.map(c => ({ key: c.toLowerCase(), label: c, align: 'left' as const }));

  return generateDetailedReportHTML({
    title,
    columns: colDefs,
    rows,
    ...opts
  });
};

/**
 * Generate detailed accounting report HTML with full branding and print styles.
 * Complies with accounting standards with comprehensive transaction data.
 */
export const generateDetailedReportHTML = (options: ReportOptions): string => {
  const brand = readReceiptBranding();
  const {
    title,
    subtitle,
    columns,
    rows,
    metaInfo = [],
    showSignature = false,
    signatureLabels = { left: 'Prepared By', right: 'Approved By' },
    footerSummary = [],
    reportType = 'detailed',
    pageSize = 'A4'
  } = options;

  const formatValue = (value: any, align?: string): string => {
    if (value === null || value === undefined) return '-';
    if (typeof value === 'number') {
      return align === 'right' ? value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(value);
    }
    return String(value);
  };

  const tableRows = rows.map((r, idx) => {
    const cells = columns.map(col => {
      const value = r[col.key] ?? r[col.key.toLowerCase()] ?? r[col.label] ?? r[col.label.toLowerCase()] ?? '';
      const align = col.align || 'left';
      return `<td class="${align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : ''}">${formatValue(value, align)}</td>`;
    }).join('');
    return `<tr class="${idx % 2 === 1 ? 'even-row' : ''}">${cells}</tr>`;
  }).join('');

  const headerCells = columns.map(col => {
    const align = col.align || 'left';
    return `<th class="${align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : ''}" ${col.width ? `style="width:${col.width}"` : ''}>${col.label}</th>`;
  }).join('');

  const metaSection = metaInfo.length > 0 ? `
    <div class="report-meta">
      ${metaInfo.map(m => `
        <div class="report-meta-item">
          <span class="report-meta-label">${m.label}</span>
          <span class="report-meta-value">${m.value}</span>
        </div>
      `).join('')}
    </div>
  ` : '';

  const summarySection = footerSummary.length > 0 ? `
    <div class="report-summary">
      ${footerSummary.map(s => `
        <div class="report-summary-row ${s.isTotal ? 'total' : ''}">
          <span class="report-summary-label">${s.label}</span>
          <span class="report-summary-value">${typeof s.value === 'number' ? s.value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : s.value}</span>
        </div>
      `).join('')}
    </div>
  ` : '';

  const signatureSection = showSignature ? `
    <div class="signature-section">
      <div class="signature-block">
        <div class="signature-line"></div>
        <span class="signature-label">${signatureLabels.left}</span>
      </div>
      <div class="signature-block">
        <div class="signature-line"></div>
        <span class="signature-label">${signatureLabels.right}</span>
      </div>
    </div>
  ` : '';

  const reportDate = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>${title} - ${brand.restaurant_name || 'Core DPMS'}</title>
      <style>
        :root {
          --print-brand-primary: #0073e6;
          --print-brand-secondary: #1e3a5f;
          --print-text-primary: #1a1a1a;
          --print-text-secondary: #4a4a4a;
          --print-text-muted: #6b7280;
          --print-border-color: #e5e7eb;
        }

        @page {
          size: ${pageSize === 'Letter' ? '8.5in 11in' : '210mm 297mm'} portrait;
          margin: 15mm;
        }

        * {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }

        body {
          font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
          font-size: 10pt;
          line-height: 1.4;
          color: var(--print-text-primary);
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
          padding: 20px;
        }

        .report-container {
          width: 100%;
          max-width: 100%;
        }

        .report-header {
          text-align: center;
          margin-bottom: 12px;
        }

        .company-logo {
          max-height: 60px;
          max-width: 180px;
          object-fit: contain;
          margin-bottom: 8px;
        }

        .company-name {
          font-size: 16pt;
          font-weight: 700;
          color: var(--print-brand-secondary);
          margin: 0 0 4px 0;
        }

        .company-details {
          font-size: 9pt;
          color: var(--print-text-secondary);
          line-height: 1.5;
        }

        .company-details span::after {
          content: " • ";
          color: var(--print-text-muted);
        }

        .company-details span:last-child::after {
          content: "";
        }

        .report-divider {
          width: 100%;
          height: 4px;
          background: linear-gradient(90deg, #0073e6, #2196f3);
          margin: 12px 0 16px 0;
          border-radius: 2px;
        }

        .report-identity {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          margin-bottom: 16px;
          padding-bottom: 8px;
          border-bottom: 1px solid var(--print-border-color);
        }

        .report-title {
          font-size: 14pt;
          font-weight: 600;
          color: var(--print-brand-primary);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .report-subtitle {
          font-size: 10pt;
          color: var(--print-text-secondary);
          font-weight: 400;
          text-transform: none;
          letter-spacing: normal;
          margin-left: 8px;
        }

        .report-date {
          font-size: 9pt;
          color: var(--print-text-muted);
        }

        .report-type-badge {
          display: inline-block;
          padding: 2px 8px;
          background: ${reportType === 'detailed' ? '#e0f2fe' : '#f0fdf4'};
          color: ${reportType === 'detailed' ? '#0369a1' : '#166534'};
          font-size: 8pt;
          font-weight: 600;
          text-transform: uppercase;
          border-radius: 3px;
          margin-left: 8px;
        }

        .report-meta {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
          gap: 8px 24px;
          margin-bottom: 16px;
          padding: 12px;
          background: #f8fafc;
          border-radius: 4px;
        }

        .report-meta-item {
          display: flex;
          flex-direction: column;
        }

        .report-meta-label {
          font-size: 8pt;
          font-weight: 600;
          color: var(--print-text-muted);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .report-meta-value {
          font-size: 10pt;
          color: var(--print-text-primary);
          font-weight: 500;
        }

        table {
          width: 100%;
          border-collapse: collapse;
          margin: 12px 0;
          font-size: 9pt;
        }

        thead {
          display: table-header-group;
        }

        thead th {
          background: var(--print-brand-primary) !important;
          color: white !important;
          font-weight: 600;
          text-align: left;
          padding: 8px 10px;
          font-size: 9pt;
          text-transform: uppercase;
          letter-spacing: 0.03em;
        }

        thead th.text-right { text-align: right; }
        thead th.text-center { text-align: center; }

        tbody tr {
          page-break-inside: avoid;
        }

        tbody tr.even-row {
          background: #f9fafb;
        }

        tbody td {
          padding: 6px 10px;
          border-bottom: 1px solid var(--print-border-color);
        }

        tbody td.text-right { text-align: right; }
        tbody td.text-center { text-align: center; }
        tbody td.font-bold { font-weight: 600; }

        tfoot tr {
          background: #e5e7eb !important;
          font-weight: 600;
        }

        tfoot td {
          padding: 8px 10px;
          border-top: 2px solid var(--print-brand-primary);
        }

        .report-summary {
          margin-top: 20px;
          border-top: 2px solid var(--print-brand-primary);
          padding-top: 12px;
        }

        .report-summary-row {
          display: flex;
          justify-content: space-between;
          padding: 4px 0;
          font-size: 10pt;
        }

        .report-summary-row.total {
          font-weight: 700;
          font-size: 12pt;
          border-top: 1px solid var(--print-border-color);
          padding-top: 8px;
          margin-top: 8px;
        }

        .report-summary-label {
          color: var(--print-text-secondary);
        }

        .report-summary-value {
          color: var(--print-text-primary);
          font-weight: 600;
        }

        .signature-section {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 60px;
          margin-top: 40px;
          page-break-inside: avoid;
        }

        .signature-block {
          text-align: center;
        }

        .signature-line {
          border-bottom: 1px solid var(--print-text-primary);
          height: 40px;
          margin-bottom: 4px;
        }

        .signature-label {
          font-size: 8pt;
          color: var(--print-text-muted);
          text-transform: uppercase;
        }

        .powered-by {
          text-align: center;
          font-size: 8pt;
          color: var(--print-text-muted);
          margin-top: 24px;
          padding-top: 12px;
          border-top: 1px solid var(--print-border-color);
        }

        .page-break-before { page-break-before: always; }
        .page-break-after { page-break-after: always; }
        .avoid-break { page-break-inside: avoid; }

        @media print {
          body { padding: 0; }
        }
      </style>
    </head>
    <body>
      <div class="report-container">
        <div class="report-header">
          ${brand.show_logo && brand.logo_url ? `<img src="${brand.logo_url}" alt="Logo" class="company-logo" />` : ''}
          <h1 class="company-name">${brand.restaurant_name || 'Core DPMS'}</h1>
          <div class="company-details">
            ${brand.address ? `<span>${brand.address}</span>` : ''}
            ${brand.phone ? `<span>Tel: ${brand.phone}</span>` : ''}
            ${brand.email ? `<span>${brand.email}</span>` : ''}
          </div>
        </div>

        <div class="report-divider"></div>

        <div class="report-identity">
          <h2 class="report-title">
            ${title}
            ${subtitle ? `<span class="report-subtitle">— ${subtitle}</span>` : ''}
            <span class="report-type-badge">${reportType}</span>
          </h2>
          <span class="report-date">${reportDate}</span>
        </div>

        ${metaSection}

        <div class="report-content">
          <table>
            <thead>
              <tr>${headerCells}</tr>
            </thead>
            <tbody>
              ${rows.length === 0 ? `<tr><td colspan="${columns.length}" style="text-align:center;padding:20px;color:#666">No data available for this report</td></tr>` : tableRows}
            </tbody>
          </table>
        </div>

        ${summarySection}
        ${signatureSection}

        <div class="powered-by">
          Powered by Core DPMS • Printed on ${new Date().toLocaleString()}
        </div>
      </div>
      <script>window.print();</script>
    </body>
    </html>
  `;
};

/**
 * Generate summary report HTML - aggregated data for quick overview.
 * Suitable for executive dashboards and high-level reviews.
 */
export const generateSummaryReportHTML = (options: ReportOptions): string => {
  return generateDetailedReportHTML({ ...options, reportType: 'summary' });
};

/**
 * Generate a blank registration card / check-in form for physical use.
 */
export const generateBlankCheckInFormHTML = (): string => {
  const brand = readReceiptBranding();
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>Blank Check-in Form</title>
      <style>
        body { font-family: sans-serif; padding: 40px; color: #333; line-height: 1.6; }
        .header { text-align: center; border-bottom: 2px solid #333; padding-bottom: 20px; margin-bottom: 30px; }
        .header h1 { margin: 0; text-transform: uppercase; letter-spacing: 2px; }
        .section { margin-bottom: 25px; border: 1px solid #ddd; padding: 20px; border-radius: 4px; }
        .section-title { font-weight: bold; text-transform: uppercase; font-size: 0.9em; margin-bottom: 15px; border-bottom: 1px solid #eee; padding-bottom: 5px; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
        .field { margin-bottom: 15px; }
        .label { display: block; font-size: 0.8em; color: #666; margin-bottom: 5px; }
        .input-line { border-bottom: 1px solid #999; height: 25px; }
        .full-width { grid-column: span 2; }
        .signature-area { margin-top: 50px; display: grid; grid-template-columns: 1fr 1fr; gap: 50px; }
        .signature-box { text-align: center; }
        .sig-line { border-top: 1px solid #333; margin-top: 40px; padding-top: 5px; font-size: 0.8em; }
        @media print {
          body { padding: 0; }
          .section { border: 1px solid #000; }
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>${brand.restaurant_name || 'Villa Gianni PMS'}</h1>
        <p>${brand.address || ''} ${brand.phone ? `| Tel: ${brand.phone}` : ''}</p>
        <h2 style="margin-top: 15px; color: #444;">GUEST REGISTRATION CARD</h2>
      </div>

      <div class="section">
        <div class="section-title">Guest Information</div>
        <div class="grid">
          <div class="field"><span class="label">Full Name</span><div class="input-line"></div></div>
          <div class="field"><span class="label">ID / Passport Number</span><div class="input-line"></div></div>
          <div class="field"><span class="label">Nationality</span><div class="input-line"></div></div>
          <div class="field"><span class="label">Company Name (If applicable)</span><div class="input-line"></div></div>
          <div class="field full-width"><span class="label">Residential Address</span><div class="input-line"></div></div>
          <div class="field"><span class="label">Phone Number</span><div class="input-line"></div></div>
          <div class="field"><span class="label">Email Address</span><div class="input-line"></div></div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Stay Details</div>
        <div class="grid">
          <div class="field"><span class="label">Arrival Date</span><div class="input-line"></div></div>
          <div class="field"><span class="label">Departure Date</span><div class="input-line"></div></div>
          <div class="field"><span class="label">Room Number</span><div class="input-line"></div></div>
          <div class="field"><span class="label">Rate per Night</span><div class="input-line"></div></div>
          <div class="field"><span class="label">Number of Adults</span><div class="input-line"></div></div>
          <div class="field"><span class="label">Number of Children</span><div class="input-line"></div></div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Terms & Conditions</div>
        <p style="font-size: 0.75em; color: #555;">
          I agree that my liability for this bill is not waived and agree to be held personally liable in the event that the indicated person, company or association fails to pay for any part or the full amount of these charges. I also agree to the house rules regarding smoking, noise, and property damage.
        </p>
      </div>

      <div class="signature-area">
        <div class="signature-box">
          <div class="sig-line">Guest Signature</div>
        </div>
        <div class="signature-box">
          <div class="sig-line">Receptionist Signature / Date</div>
        </div>
      </div>

      <p style="text-align: center; font-size: 0.7em; color: #999; margin-top: 40px;">
        Printed on ${new Date().toLocaleDateString()} | Powered by Core DPMS
      </p>
    </body>
    </html>
  `;
};
