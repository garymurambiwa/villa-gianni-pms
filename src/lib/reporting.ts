import gl from '@/lib/glAccounting';
import { readReceiptBranding } from './printSettings';
import roomSvc from '@/lib/roomService';
import expenseSvc from '@/lib/expenseService';
import { syncNightAuditRunToLocalStorage } from './dbSync';
import { db } from './db';

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
export const buildFlashReport = async (forDate?: string) => {
  // --- PRIMARY SOURCE: DB night_audit_runs table ---
  // Always prefer the database record for the requested date, falling back to localStorage.
  let dbAuditBundle: any = null;
  const targetDate = forDate || getBusinessDate();

  try {
    const auditRes = await db.query<any>(
      `SELECT business_date::date::text as date,
              room_revenue, total_revenue, occupancy_percent as occupancy,
              adr as "avgDailyRate", revpar, rooms_posted,
              reports_snapshot
       FROM night_audit_runs
       WHERE business_date::date <= $1::date
       ORDER BY business_date DESC
       LIMIT 1`,
      [targetDate]
    );
    if ('rows' in auditRes && auditRes.rows.length > 0) {
      const row = auditRes.rows[0];
      const snap = row.reports_snapshot || {};
      dbAuditBundle = {
        date: row.date,
        roomRevenue: Number(row.room_revenue || 0),
        fbRevenue: Number(snap.fbRevenue || (Number(row.total_revenue || 0) - Number(row.room_revenue || 0))),
        totalRevenue: Number(row.total_revenue || 0),
        occupancy: Number(row.occupancy || 0),
        avgDailyRate: Number(row.avgDailyRate || 0),
        revPAR: Number(row.revpar || 0),
      };
      // Also hydrate localStorage so other consumers get up-to-date data
      try {
        const lsKey = `corepms_nightAudit_reports_${row.date}`;
        if (!localStorage.getItem(lsKey)) {
          localStorage.setItem(lsKey, JSON.stringify(dbAuditBundle));
        }
        if (!localStorage.getItem('corepms_nightAudit_lastReports')) {
          localStorage.setItem('corepms_nightAudit_lastReports', JSON.stringify(dbAuditBundle));
        }
      } catch { /* non-fatal */ }
    }
  } catch (err) {
    console.warn('[Reporting] DB audit bundle query failed, using localStorage:', err);
  }

  const b = dbAuditBundle || getLastNightAuditBundle();
  const date = forDate || b?.date || targetDate;

  // ── REAL-TIME room revenue for current business day (no audit yet) ──
  // If there's no completed audit for this date, pull live room revenue from folio_charges
  let realtimeRoomRevenue: number | null = null;
  try {
    const todayAuditRes = await db.query<any>(
      `SELECT room_revenue FROM night_audit_runs WHERE business_date::date = $1 AND status='completed' LIMIT 1`,
      [date]
    );
    if ('rows' in todayAuditRes && todayAuditRes.rows.length > 0) {
      // Audit ran for this exact date — authoritative
      realtimeRoomRevenue = Number(todayAuditRes.rows[0].room_revenue || 0);
    } else {
      // No audit yet — sum today's room charges live from DB
      const liveRoomRes = await db.query<any>(
        `SELECT COALESCE(SUM(amount),0) as total FROM folio_charges
         WHERE LOWER(category) IN ('room','accommodation','room charge','room rate')
           AND is_voided = false AND business_date::date = $1`,
        [date]
      );
      if ('rows' in liveRoomRes && liveRoomRes.rows.length > 0) {
        realtimeRoomRevenue = Number(liveRoomRes.rows[0].total || 0);
      }
    }
  } catch (_) { /* non-fatal — fall back to bundle */ }

  // Use real-time room revenue if available, otherwise use last audit bundle
  const effectiveRoomRevenue = realtimeRoomRevenue !== null
    ? realtimeRoomRevenue
    : Number(b?.roomRevenue || 0);

  // ── REAL-TIME shift cash/card totals from DB ──
  let cashCard = readJSON<Record<string, number>>('corepms_shift_totals', { cash: 0, card: 0 });
  try {
    const shiftTotalsRes = await db.query<any>(
      `SELECT COALESCE(SUM(total_cash),0) as cash, COALESCE(SUM(total_card),0) as card
       FROM pos_shifts WHERE business_date::date = $1`,
      [date]
    );
    if ('rows' in shiftTotalsRes && shiftTotalsRes.rows.length > 0) {
      const row = shiftTotalsRes.rows[0];
      const dbCash = Number(row.cash || 0);
      const dbCard = Number(row.card || 0);
      if (dbCash > 0 || dbCard > 0) {
        cashCard = { cash: dbCash, card: dbCard };
      }
    }
  } catch (_) { /* non-fatal */ }

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
  // FIXED: use `date` (last audit date) not `getBusinessDate()` (already rolled forward)
  const businessDate = date;

  // Filter charges for the last completed business date
  const todaysCharges = folioCharges.filter((c: any) =>
    c.date === businessDate ||
    (c.business_date && c.business_date === businessDate)
  );

  // Separate Food and Bar revenue based on POS categories and descriptions
  // NEW: Try to get detailed breakdown from database if possible
  let dbFoodRevenue = 0;
  let dbBarRevenue = 0;
  let dbPosTotal = 0;

  try {
    const posRes = await db.query<any>(
      `SELECT items, total_amount FROM pos_orders WHERE status='closed' AND created_at::date = $1`,
      [date]
    );
    const posOrders = 'rows' in posRes ? (posRes.rows || []) : [];
    
    posOrders.forEach((order: any) => {
      const total = Number(order.total_amount || 0);
      dbPosTotal += total;

      const items = typeof order.items === 'string' ? JSON.parse(order.items) : (order.items || []);
      if (Array.isArray(items)) {
        items.forEach((item: any) => {
          const itemPrice = Number(item.price || item.menuItem?.price || 0);
          const itemQty = Number(item.quantity || 1);
          const itemAmt = itemPrice * itemQty;
          
          const name = String(item.name || item.menuItem?.name || '').toLowerCase();
          const cat = String(item.category || item.menuItem?.category || '').toLowerCase();
          
          const isBar = cat.includes('bar') || cat.includes('beverage') || cat.includes('liquor') || 
                        name.includes('beer') || name.includes('wine') || name.includes('spirit') || 
                        name.includes('cocktail') || name.includes('drink');
          
          if (isBar) dbBarRevenue += itemAmt;
          else dbFoodRevenue += itemAmt;
        });
      } else {
        dbFoodRevenue += total;
      }
    });
  } catch (err) {
    console.warn('[Reporting] Database POS breakdown failed, falling back to heuristics:', err);
  }

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
        desc.includes('room service meal');

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

  // Combine DB values with folio charge values (ensuring no double count if possible, 
  // but DB is usually more accurate for today's POS)
  const finalFoodRevenue = dbPosTotal > 0 ? dbFoodRevenue : (foodRevenue + remainingFbRevenue);
  const finalBarRevenue = dbPosTotal > 0 ? dbBarRevenue : barRevenue;

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

  // Calculate last year's departmental expenses from GL ledger for that date
  // No hardcoded heuristics — return 0 if no real data found for last year
  const lastYearDeptExpenses = (() => {
    if (!lastYearBundle) return 0;
    try {
      const lastYearLedger = gl.getLedger().filter(e => e.date === lastYearDate);
      const accs = gl.getAccounts();
      const expTotal = lastYearLedger
        .flatMap(e => e.lines)
        .filter(l => { const acc = accs.find(a => a.id === l.accountId); return acc?.category === 'Expense'; })
        .reduce((s, l) => s + (l.debit || 0), 0);
      if (expTotal > 0) return expTotal;
    } catch { /* fall through */ }
    // Fallback: check dated expense cache in localStorage
    try {
      const storedYoy = readJSON<number>(`corepms_dept_expenses_total_${lastYearDate}`, 0);
      if (storedYoy > 0) return storedYoy;
    } catch { /* ignore */ }
    return 0; // Unknown — report as 0, not a fabricated estimate
  })();

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

    // No hardcoded heuristics — return 0 if no real data found
    return 0;
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

  // Calculate totals for current period — use real-time room revenue
  const currentTotalRevenue = effectiveRoomRevenue + calculatedFbTotal;

  // Calculate totals for last year
  const lastYearTotalFbRevenue = finalLastYearFoodRevenue + finalLastYearBarRevenue;
  const lastYearTotalRevenue = lastYearBundle ?
    (Number(lastYearBundle.roomRevenue || 0) + lastYearTotalFbRevenue) : 0;

  // Get last year's cash/card data — try DB first
  let lastYearCashCard = lastYearBundle ?
    readJSON<Record<string, number>>(`corepms_shift_totals_${lastYearDate}`, { cash: 0, card: 0 }) :
    { cash: 0, card: 0 };
  try {
    const lyShiftRes = await db.query<any>(
      `SELECT COALESCE(SUM(total_cash),0) as cash, COALESCE(SUM(total_card),0) as card
       FROM pos_shifts WHERE business_date::date = $1`,
      [lastYearDate]
    );
    if ('rows' in lyShiftRes && lyShiftRes.rows.length > 0) {
      const lyRow = lyShiftRes.rows[0];
      if (Number(lyRow.cash) > 0 || Number(lyRow.card) > 0) {
        lastYearCashCard = { cash: Number(lyRow.cash || 0), card: Number(lyRow.card || 0) };
      }
    }
  } catch { /* non-fatal */ }

  const rows = [
    // Room Revenue with YoY comparison — uses real-time effectiveRoomRevenue
    {
      metric: 'Room Revenue',
      today: Number(effectiveRoomRevenue.toFixed(2)),
      lastYear: Number(lastYearBundle?.roomRevenue || 0),
      difference: Number(effectiveRoomRevenue.toFixed(2)) - Number(lastYearBundle?.roomRevenue || 0)
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
export const buildPosReconciliation = async (forDate?: string) => {
  const date = forDate || getBusinessDate();
  
  try {
    const { db } = await import('@/lib/db');
    // Fetch shifts for the given date
    const shiftRes = await db.query<any>(
      `SELECT s.*, 
       (SELECT SUM(total_amount) FROM pos_orders WHERE shift_id = s.id AND status = 'closed') as total_sales,
       (SELECT SUM(total_amount) FROM pos_orders WHERE shift_id = s.id AND status = 'closed' AND items::text ILIKE '%"method":"cash"%') as cash_sales,
       (SELECT SUM(total_amount) FROM pos_orders WHERE shift_id = s.id AND status = 'closed' AND items::text ILIKE '%"method":"card"%') as card_sales
       FROM pos_shifts s 
       WHERE s.opened_at::date = $1`,
      [date]
    );

    if ('rows' in shiftRes && shiftRes.rows.length > 0) {
      const rows = shiftRes.rows.map((s: any) => {
        const metadata = typeof s.metadata === 'string' ? JSON.parse(s.metadata) : (s.metadata || {});
        return {
          cashier: s.opened_by || s.id,
          outlet: metadata.department || 'POS',
          sales: Number(s.total_sales || 0),
          cash: Number(s.cash_sales || 0),
          card: Number(s.card_sales || 0),
          overShort: Number(s.actual_cash || 0) - (Number(s.starting_cash || 0) + Number(s.cash_sales || 0))
        };
      });
      return { title: `POS Sales & Cashier Reconciliation — ${date}`, columns: ['Cashier', 'Outlet', 'Sales', 'Cash', 'Card', 'Over/Short'], rows };
    }
  } catch (err) {
    console.warn('[Reporting] buildPosReconciliation DB query failed:', err);
  }

  // Fallback to localStorage
  const ended = readJSON<any[]>('corepms_endedShifts', []);
  const rows = ended.map(s => ({ 
    cashier: s.openedBy || s.id, 
    outlet: s.department || 'POS', 
    sales: Number(s.totals?.total || s.totalSales || 0), 
    cash: Number(s.totals?.cash || s.cashPayments || 0), 
    card: Number(s.totals?.card || s.cardPayments || 0), 
    overShort: Number((s.report_data?.cashDifference || 0)) 
  }));
  return { title: `POS Sales & Cashier Reconciliation — ${date}`, columns: ['Cashier', 'Outlet', 'Sales', 'Cash', 'Card', 'Over/Short'], rows };
};

// Daily Purchase & Receiving Log (simple placeholder using expenses and vendors if present)
export const buildPurchaseReceivingLog = async (forDate?: string) => {
  const purchases = readJSON<any[]>('corepms_purchases', []);
  const date = forDate || getBusinessDate();
  const rows = purchases.filter(p => p.date === date).map(p => ({ item: p.itemName || p.item || 'Item', vendor: p.vendorName || p.vendorId || 'Vendor', po: p.poId || p.po || '-', unitCost: Number(p.unitCost || 0), qty: Number(p.quantity || 0), total: Number((Number(p.unitCost || 0) * Number(p.quantity || 0)).toFixed(2)) }));
  return { title: `Daily Purchase & Receiving — ${date}`, columns: ['Item', 'Vendor', 'PO', 'Unit Cost', 'Qty', 'Total Value'], rows };
};

// Housekeeping Status (daily snapshot from room service)
export const buildHousekeepingStatus = async () => {
  const rooms = roomSvc.getRooms();
  const byStatus: Record<string, number> = {};
  rooms.forEach(r => { byStatus[r.status] = (byStatus[r.status] || 0) + 1; });
  const rows = Object.entries(byStatus).map(([status, count]) => ({ status, count }));
  const date = new Date().toISOString().slice(0, 10);
  return { title: `Housekeeping Status — ${date}`, columns: ['Status', 'Count'], rows };
};

// Daily Tax Report (sum of TAX account for date from GL)
export const buildDailyTax = async (forDate?: string) => {
  const date = forDate || new Date().toISOString().slice(0, 10);
  const ledger = gl.getLedger().filter(e => e.date === date);
  const taxAcc = gl.getMappings().TAX || 'TAX';
  const totalTax = ledger.flatMap(e => e.lines).filter(l => l.accountId === taxAcc).reduce((s, l) => s + (l.debit || 0) + (l.credit || 0), 0);
  const rows = [{ metric: 'Tax Collected', value: Number(totalTax.toFixed(2)) }];
  return { title: `Daily Tax Report — ${date}`, columns: ['Metric', 'Value'], rows };
};

// Cash & Bank Deposits (daily totals for CASH/BANK accounts)
export const buildCashBankDeposits = async (forDate?: string) => {
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
export const buildTrialBalance = async (monthISO: string) => {
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

// Arrivals / Departures (daily) — DB-driven
export const buildArrivalsDepartures = async (forDate?: string) => {
  const date = forDate || getBusinessDate();

  try {
    const { db: dbMod } = await import('@/lib/db');
    const res = await dbMod.query<any>(
      `SELECT r.status,
              COALESCE(g.full_name, r.booking_name, 'Unknown') as guest_name,
              ro.number as room_number,
              r.room_type,
              r.check_in_date::text as check_in,
              r.check_out_date::text as check_out
       FROM reservations r
       LEFT JOIN guests g ON r.guest_id = g.id
       LEFT JOIN rooms ro ON r.room_id = ro.id
       WHERE r.check_in_date::date = $1 OR r.check_out_date::date = $1
       ORDER BY r.status, g.full_name`,
      [date]
    );

    if ('rows' in res && res.rows.length > 0) {
      const rows = res.rows.map((r: any) => ({
        type: r.check_in === date ? 'Arrival' : 'Departure',
        guest: r.guest_name || '—',
        room: r.room_number || r.room_type || '—',
        status: r.status || '—',
        date: r.check_in === date ? r.check_in : r.check_out
      }));
      return { title: `Arrivals & Departures — ${date}`, columns: ['Type', 'Guest', 'Room', 'Status', 'Date'], rows };
    }
  } catch (err) {
    console.warn('[Reporting] buildArrivalsDepartures DB query failed, using localStorage:', err);
  }

  // Fallback to localStorage
  const reservations = readJSON<any[]>('corepms_reservations', []);
  const arrivals = reservations.filter(r => (r.checkIn || r.check_in_date || '').slice(0, 10) === date);
  const departures = reservations.filter(r => (r.checkOut || r.check_out_date || '').slice(0, 10) === date);
  const rows = [
    ...arrivals.map(r => ({ type: 'Arrival', guest: r.guestName || r.bookingName || '—', room: r.roomType || r.roomNumber || '—', status: r.status || '—', date })),
    ...departures.map(r => ({ type: 'Departure', guest: r.guestName || r.bookingName || '—', room: r.roomType || r.roomNumber || '—', status: r.status || '—', date }))
  ];
  return { title: `Arrivals & Departures — ${date}`, columns: ['Type', 'Guest', 'Room', 'Status', 'Date'], rows };
};

// High Balance (daily) — DB-driven from folios + city_ledger_accounts
export const buildHighBalance = async (threshold?: number, forDate?: string) => {
  const date = forDate || getBusinessDate();
  const th = typeof threshold === 'number' ? threshold : readJSON<number>('corepms_high_balance_threshold', 500);

  try {
    const { db: dbMod } = await import('@/lib/db');

    // Query open folios with high balance from DB
    const folioRes = await dbMod.query<any>(
      `SELECT f.id, f.balance, f.room_number,
              COALESCE(g.full_name, r.booking_name, 'Unknown') as guest_name
       FROM folios f
       LEFT JOIN guests g ON f.guest_id = g.id
       LEFT JOIN reservations r ON f.reservation_id = r.id
       WHERE f.status = 'open' AND f.balance >= $1
       ORDER BY f.balance DESC`,
      [th]
    );

    // Query city ledger accounts with high balance
    const ledgerRes = await dbMod.query<any>(
      `SELECT account_name, current_balance FROM city_ledger_accounts
       WHERE current_balance >= $1 AND status = 'Active'
       ORDER BY current_balance DESC`,
      [th]
    );

    const folioRows = ('rows' in folioRes ? folioRes.rows : []).map((f: any) => ({
      source: 'Folio',
      id: f.id || '—',
      name: f.guest_name || '—',
      room: f.room_number || '—',
      balance: Number(Number(f.balance || 0).toFixed(2))
    }));

    const ledgerRows = ('rows' in ledgerRes ? ledgerRes.rows : []).map((l: any) => ({
      source: 'City Ledger',
      id: l.account_name,
      name: l.account_name,
      room: '—',
      balance: Number(Number(l.current_balance || 0).toFixed(2))
    }));

    const rows = [...folioRows, ...ledgerRows];
    return { title: `High Balance — ${date} (Threshold: $${th})`, columns: ['Source', 'ID', 'Name', 'Room', 'Balance'], rows };
  } catch (err) {
    console.warn('[Reporting] buildHighBalance DB query failed:', err);
  }

  // Fallback to localStorage
  const folios = readJSON<any[]>('corepms_folios', []);
  const cityLedger = readJSON<any[]>('corepms_city_ledger', []);
  const folioRows = folios.filter(f => Number(f.balance || f.folioBalance || 0) >= th).map(f => ({ source: 'Folio', id: f.id || '—', name: f.guestName || f.name || '—', room: '—', balance: Number(Number(f.balance || f.folioBalance || 0).toFixed(2)) }));
  const ledgerAgg: Record<string, number> = {};
  cityLedger.forEach(tx => { const key = tx.guestId || tx.accountName || 'unknown'; ledgerAgg[key] = (ledgerAgg[key] || 0) + Number(tx.amount || 0); });
  const ledgerRows = Object.entries(ledgerAgg).filter(([_, amt]) => amt >= th).map(([key, amt]) => ({ source: 'City Ledger', id: key, name: key, room: '—', balance: Number(amt.toFixed(2)) }));
  return { title: `High Balance — ${date} (Threshold: $${th})`, columns: ['Source', 'ID', 'Name', 'Room', 'Balance'], rows: [...folioRows, ...ledgerRows] };
};

// Procurement Variance (monthly) using AP invoices vs Purchase Orders
export const buildProcurementVariance = async (monthISO: string) => {
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
export const buildFixedAssetRecon = async (monthISO: string) => {
  const assets = readJSON<any[]>('corepms_fixed_assets', []);
  const rows = assets.length === 0 ? [{ assetId: '—', name: 'Dataset not available', status: 'N/A' }] : assets.map(a => ({ assetId: a.id || a.asset_id || '—', name: a.name || 'Asset', status: 'OK' }));
  return { title: `Fixed Asset Register Reconciliation — ${monthISO}`, columns: ['Asset ID', 'Name', 'Status'], rows };
};

// Monthly Profit & Loss (USALI-style summary using GL trial balance)
export const buildMonthlyPL = async (monthISO: string) => {
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
export const buildAgedAR = async (asOf?: string) => {
  const date = asOf || getBusinessDate();
  const ledger = readJSON<any[]>('corepms_city_ledger', []);
  const now = new Date(date);
  const ageDays = (d: string) => Math.floor((now.getTime() - new Date(d).getTime()) / (1000 * 60 * 60 * 24));
  const rows = ledger.map(t => ({ account: t.guestName || t.accountName || 'Account', reference: t.reason || t.reference || '', date: t.date, amount: Number(t.amount || 0), bucket: (() => { const a = ageDays(t.date || date); return a <= 30 ? '0-30' : a <= 60 ? '31-60' : a <= 90 ? '61-90' : '90+'; })() }));
  return { title: `Aged Accounts Receivable — ${date}`, columns: ['Account', 'Reference', 'Date', 'Amount', 'Aging'], rows };
};

// Inventory & COGS — DB-driven using inventory_periods and transactions
export const buildInventoryCOGS = async (monthISO: string) => {
  try {
    const { db: dbMod } = await import('@/lib/db');
    const [year, month] = monthISO.split('-');

    // Get period for this month
    const periodRes = await dbMod.query<any>(
      `SELECT id, period_name, opening_stock_value, closing_stock_value,
              received_value, cogs_value, kitchen_cogs, cellar_cogs, status
       FROM inventory_periods
       WHERE period_year = $1 AND period_month = $2
       LIMIT 1`,
      [Number(year), Number(month)]
    );

    if ('rows' in periodRes && periodRes.rows.length > 0) {
      const p = periodRes.rows[0];
      const opening = Number(p.opening_stock_value || 0);
      const purchases = Number(p.received_value || 0);
      const ending = Number(p.closing_stock_value || 0);
      const cogs = p.cogs_value ? Number(p.cogs_value) : Number((opening + purchases - ending).toFixed(2));

      const rows = [
        { metric: 'Period', value: p.period_name || monthISO },
        { metric: 'Status', value: p.status || 'unknown' },
        { metric: 'Opening Inventory', value: opening },
        { metric: 'Purchases (Received)', value: purchases },
        { metric: 'Ending Inventory', value: ending },
        { metric: 'COGS', value: cogs },
        { metric: 'Kitchen COGS', value: Number(p.kitchen_cogs || 0) },
        { metric: 'Cellar COGS', value: Number(p.cellar_cogs || 0) },
      ];
      return { title: `Inventory & COGS — ${monthISO}`, columns: ['Metric', 'Value'], rows };
    }
  } catch (err) {
    console.warn('[Reporting] buildInventoryCOGS DB query failed:', err);
  }

  // Fallback to localStorage
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
export const buildOpenBills = async () => {
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
export const buildAgedPayables = async (asOfISO: string = new Date().toISOString().slice(0, 10)) => {
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
export const buildPurchaseOrderHistory = async (from: string, to: string) => {
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
export const buildPaymentHistory = async (from: string, to: string) => {
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
export const buildVendorPaymentSummary = async (from: string, to: string) => {
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
      totalPaid: Number(data.total || 0).toFixed(2),
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
export const buildExpensesByDepartment = async (from: string, to: string) => {
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
        total: Number(data.total || 0).toFixed(2),
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
export const buildExpenseSummary = async (period: 'daily' | 'monthly', from: string, to: string) => {
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
export const buildDetailedLineItemExport = async (from: string, to: string) => {
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

export const exportMonthlyWorkbookXLS = async (monthISO: string, filename?: string) => {
  const pl = await buildMonthlyPL(monthISO);
  const ar = await buildAgedAR(`${monthISO}-01`); // use first day as as-of
  const inv = await buildInventoryCOGS(monthISO);
  const tb = await buildTrialBalance(monthISO);
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
        @page { size: A4; margin: 10mm; }
        body { font-family: sans-serif; padding: 0; margin: 0; color: #333; line-height: 1.4; font-size: 10pt; }
        .header { text-align: center; border-bottom: 1.5px solid #333; padding-bottom: 10px; margin-bottom: 15px; }
        .header h1 { margin: 0; font-size: 16pt; text-transform: uppercase; letter-spacing: 1px; }
        .header p { margin: 2px 0; font-size: 9pt; color: #555; }
        .header h2 { margin: 8px 0 0; font-size: 12pt; color: #444; text-transform: uppercase; }
        
        .section { margin-bottom: 12px; border: 1px solid #ccc; padding: 12px; border-radius: 4px; }
        .section-title { font-weight: bold; text-transform: uppercase; font-size: 8.5pt; margin-bottom: 10px; border-bottom: 1px solid #eee; padding-bottom: 3px; color: #222; }
        
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .field { margin-bottom: 8px; }
        .label { display: block; font-size: 7.5pt; color: #666; margin-bottom: 2px; text-transform: uppercase; }
        .input-line { border-bottom: 1px solid #aaa; height: 18px; }
        .full-width { grid-column: span 2; }
        
        .terms { font-size: 7pt; color: #555; margin-top: 5px; line-height: 1.3; }
        
        .signature-area { margin-top: 25px; display: grid; grid-template-columns: 1fr 1fr; gap: 40px; }
        .signature-box { text-align: center; }
        .sig-line { border-top: 1px solid #333; margin-top: 30px; padding-top: 4px; font-size: 7.5pt; text-transform: uppercase; color: #444; }
        
        .company-logo { max-height: 50px; width: auto; margin-bottom: 5px; }
        .footer { text-align: center; font-size: 6.5pt; color: #999; margin-top: 20px; }
        
        @media print {
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .section { border: 1px solid #000; }
        }
      </style>
    </head>
    <body>
      <div class="header">
        ${brand.show_logo && brand.logo_url ? `<img src="${brand.logo_url}" alt="Logo" class="company-logo" />` : ''}
        <h1>${brand.restaurant_name || 'Villa Gianni PMS'}</h1>
        <p>${brand.address || ''} ${brand.phone ? `| Tel: ${brand.phone}` : ''}</p>
        <h2>GUEST REGISTRATION CARD</h2>
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
          <div class="field"><span class="label">Vehicle Registration No.</span><div class="input-line"></div></div>
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
        <div class="terms">
          I agree that my liability for this bill is not waived and agree to be held personally liable in the event that the indicated person, company or association fails to pay for any part or the full amount of these charges. I also agree to the house rules regarding smoking, noise, and property damage.
        </div>
      </div>

      <div class="signature-area">
        <div class="signature-box">
          <div class="sig-line">Guest Signature</div>
        </div>
        <div class="signature-box">
          <div class="sig-line">Receptionist Signature / Date</div>
        </div>
      </div>

      <div class="footer">
        Printed on ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()} | Powered by Core DPMS
      </div>
    </body>
    </html>
  `;
};
