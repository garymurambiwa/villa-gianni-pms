import gl from '@/lib/glAccounting';
import { readReceiptBranding } from './printSettings';
import roomSvc from '@/lib/roomService';
import expenseSvc from '@/lib/expenseService';

export type ReportType = 'flash' | 'pos-recon' | 'purchase-log' | 'pl' | 'aged-ar' | 'inventory-cogs';

export interface DateRange { start: string; end: string }

const readJSON = <T>(key: string, fallback: T): T => { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; } };

export const getLastNightAuditBundle = () => readJSON<any>('corepms_nightAudit_lastReports', null);
export const getBusinessDate = () => readJSON<string>('corepms_business_date', new Date().toISOString().slice(0,10));

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
  const cashCard = readJSON<Record<string,number>>('corepms_shift_totals', { cash: 0, card: 0 });
  
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
  
  // Calculate total departmental expenses from various sources
  // This includes F&B costs, administrative expenses, maintenance, utilities, etc.
  const deptExpenses = (() => {
    // Try to get from localStorage first (could be set by expense entry system)
    const storedExpenses = readJSON<number>('corepms_dept_expenses_total', 0);
    if (storedExpenses > 0) {
      return storedExpenses;
    }
    
    // Fallback: estimate based on revenue (typical hotel industry ratios)
    // Usually departmental expenses are 30-40% of total revenue
    const totalRevenueEstimate = Number(b?.roomRevenue || 0) + finalFoodRevenue + finalBarRevenue;
    const estimatedExpenses = totalRevenueEstimate * 0.35; // 35% industry average
    
    // Store the estimate for future use
    try {
      localStorage.setItem('corepms_dept_expenses_total', String(estimatedExpenses.toFixed(2)));
    } catch {}
    
    return estimatedExpenses;
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
    readJSON<Record<string,number>>(`corepms_shift_totals_${lastYearDate}`, { cash: 0, card: 0 }) :
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
  return { title: `POS Sales & Cashier Reconciliation — ${date}`, columns: ['Cashier','Outlet','Sales','Cash','Card','Over/Short'], rows };
};

// Daily Purchase & Receiving Log (simple placeholder using expenses and vendors if present)
export const buildPurchaseReceivingLog = (forDate?: string) => {
  const purchases = readJSON<any[]>('corepms_purchases', []);
  const date = forDate || getBusinessDate();
  const rows = purchases.filter(p => p.date === date).map(p => ({ item: p.itemName || p.item || 'Item', vendor: p.vendorName || p.vendorId || 'Vendor', po: p.poId || p.po || '-', unitCost: Number(p.unitCost || 0), qty: Number(p.quantity || 0), total: Number((Number(p.unitCost||0) * Number(p.quantity||0)).toFixed(2)) }));
  return { title: `Daily Purchase & Receiving — ${date}`, columns: ['Item','Vendor','PO','Unit Cost','Qty','Total Value'], rows };
};

// Housekeeping Status (daily snapshot from room service)
export const buildHousekeepingStatus = () => {
  const rooms = roomSvc.getRooms();
  const byStatus: Record<string, number> = {};
  rooms.forEach(r => { byStatus[r.status] = (byStatus[r.status] || 0) + 1; });
  const rows = Object.entries(byStatus).map(([status, count]) => ({ status, count }));
  const date = new Date().toISOString().slice(0,10);
  return { title: `Housekeeping Status — ${date}`, columns: ['Status','Count'], rows };
};

// Daily Tax Report (sum of TAX account for date from GL)
export const buildDailyTax = (forDate?: string) => {
  const date = forDate || new Date().toISOString().slice(0,10);
  const ledger = gl.getLedger().filter(e => e.date === date);
  const taxAcc = gl.getMappings().TAX || 'TAX';
  const totalTax = ledger.flatMap(e => e.lines).filter(l => l.accountId === taxAcc).reduce((s,l)=> s + (l.debit || 0) + (l.credit || 0), 0);
  const rows = [{ metric: 'Tax Collected', value: Number(totalTax.toFixed(2)) }];
  return { title: `Daily Tax Report — ${date}`, columns: ['Metric','Value'], rows };
};

// Cash & Bank Deposits (daily totals for CASH/BANK accounts)
export const buildCashBankDeposits = (forDate?: string) => {
  const date = forDate || new Date().toISOString().slice(0,10);
  const ledger = gl.getLedger().filter(e => e.date === date);
  const cashAcc = gl.getMappings().CASH || '1000';
  const bankAcc = gl.getMappings().BANK || '1100';
  const lines = ledger.flatMap(e => e.lines);
  const cashTotal = lines.filter(l => l.accountId === cashAcc).reduce((s,l)=> s + (l.debit || 0) + (l.credit || 0), 0);
  const bankTotal = lines.filter(l => l.accountId === bankAcc).reduce((s,l)=> s + (l.debit || 0) + (l.credit || 0), 0);
  const rows = [
    { account: 'Cash', total: Number(cashTotal.toFixed(2)) },
    { account: 'Bank', total: Number(bankTotal.toFixed(2)) }
  ];
  return { title: `Cash & Bank Deposits — ${date}`, columns: ['Account','Total'], rows };
};

// Trial Balance (monthly)
export const buildTrialBalance = (monthISO: string) => {
  const [y,m] = monthISO.split('-');
  const start = `${y}-${m}-01`;
  const endDate = new Date(Number(y), Number(m));
  const end = endDate.toISOString().slice(0,10);
  const tb = gl.getTrialBalance(start, end);
  const rows = tb.map(a => ({ accountId: a.accountId, name: a.name, debit: a.debit, credit: a.credit, balance: a.balance }));
  return { title: `Trial Balance — ${monthISO}`, columns: ['Account','Name','Debit','Credit','Balance'], rows };
};

// Monthly Operating Departmental Summary (USALI)
export const buildDepartmentalSummary = (monthISO: string) => {
  const [y,m] = monthISO.split('-');
  const start = `${y}-${m}-01`;
  const endDate = new Date(Number(y), Number(m));
  const end = endDate.toISOString().slice(0,10);
  const usali = expenseSvc.getUSALIIncomeStatement(start, end);
  const rows: Array<any> = [];
  rows.push({ section: 'Revenue', metric: 'Total Revenue', amount: Number(usali.revenue || 0) });
  usali.departmentalExpenses.forEach(d => rows.push({ section: 'Departmental Expenses', metric: d.costCenter, amount: d.amount }));
  rows.push({ section: 'Departmental Profit', metric: 'Dept Profit', amount: Number(usali.departmentalProfit || 0) });
  usali.undistributedExpenses.forEach(d => rows.push({ section: 'Undistributed Expenses', metric: d.costCenter, amount: d.amount }));
  rows.push({ section: 'GOP', metric: 'Gross Operating Profit', amount: Number(usali.GOP || 0) });
  if (usali.budget) {
    rows.push({ section: 'Budget', metric: 'Budget Revenue', amount: Number(usali.budget.revenue || 0) });
  }
  return { title: `Operating Departmental Summary (USALI) — ${monthISO}`, columns: ['Section','Metric','Amount'], rows };
};

// Arrivals / Departures (daily)
export const buildArrivalsDepartures = (forDate?: string) => {
  const date = forDate || getBusinessDate();
  const reservations = readJSON<any[]>('corepms_reservations', []);
  const arrivals = reservations.filter(r => (r.checkIn || '').slice(0,10) === date);
  const departures = reservations.filter(r => (r.checkOut || '').slice(0,10) === date);
  const rows = [
    ...arrivals.map(r => ({ type: 'Arrival', guest: r.guestName || r.bookingName || '—', room: r.roomType || r.roomNumber || '—', time: (r.checkIn || '').slice(11,16) || '—' })),
    ...departures.map(r => ({ type: 'Departure', guest: r.guestName || r.bookingName || '—', room: r.roomType || r.roomNumber || '—', time: (r.checkOut || '').slice(11,16) || '—' }))
  ];
  return { title: `Arrivals & Departures — ${date}`, columns: ['Type','Guest','Room','Time'], rows };
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
  return { title: `High Balance — ${date} (Threshold: $${th})`, columns: ['Source','ID','Name','Balance'], rows };
};

// Procurement Variance (monthly) using AP invoices vs Purchase Orders
export const buildProcurementVariance = (monthISO: string) => {
  const [y,m] = monthISO.split('-');
  const start = `${y}-${m}-01`;
  const endDate = new Date(Number(y), Number(m));
  const end = endDate.toISOString().slice(0,10);
  const invoices = readJSON<any[]>('corepms_ap_invoices', []).filter(i => (i.invoice_date || '').slice(0,10) >= start && (i.invoice_date || '').slice(0,10) <= end);
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
  return { title: `Procurement Variance — ${monthISO}`, columns: ['Invoice','Vendor','PO','Invoice Amount','PO Amount','Variance %','Flagged'], rows };
};

// Fixed Asset Register Reconciliation (monthly stub)
export const buildFixedAssetRecon = (monthISO: string) => {
  const assets = readJSON<any[]>('corepms_fixed_assets', []);
  const rows = assets.length === 0 ? [{ assetId: '—', name: 'Dataset not available', status: 'N/A' }] : assets.map(a => ({ assetId: a.id || a.asset_id || '—', name: a.name || 'Asset', status: 'OK' }));
  return { title: `Fixed Asset Register Reconciliation — ${monthISO}`, columns: ['Asset ID','Name','Status'], rows };
};

// Monthly Profit & Loss (USALI-style summary using GL trial balance)
export const buildMonthlyPL = (monthISO: string) => {
  const [y,m] = monthISO.split('-');
  const start = `${y}-${m}-01`;
  const end = new Date(Number(y), Number(m)).toISOString().slice(0,10); // first day of next month
  const pl = gl.getPLStatement(start, end);
  const rows = [
    { category: 'Revenue', amount: Number(pl.revenue || 0) },
    { category: 'Expense', amount: Number(pl.expense || 0) },
    { category: 'GOP (Revenue - Expense)', amount: Number((pl.revenue - pl.expense).toFixed(2)) },
    { category: 'Net Income', amount: Number(pl.netIncome || 0) }
  ];
  return { title: `Profit & Loss — ${monthISO}`, columns: ['Category','Amount'], rows };
};

// Aged Accounts Receivable (City Ledger Aging)
export const buildAgedAR = (asOf?: string) => {
  const date = asOf || getBusinessDate();
  const ledger = readJSON<any[]>('corepms_city_ledger', []);
  const now = new Date(date);
  const ageDays = (d: string) => Math.floor((now.getTime() - new Date(d).getTime()) / (1000*60*60*24));
  const rows = ledger.map(t => ({ account: t.guestName || t.accountName || 'Account', reference: t.reason || t.reference || '', date: t.date, amount: Number(t.amount || 0), bucket: (() => { const a = ageDays(t.date || date); return a<=30?'0-30':a<=60?'31-60':a<=90?'61-90':'90+'; })() }));
  return { title: `Aged Accounts Receivable — ${date}`, columns: ['Account','Reference','Date','Amount','Aging'], rows };
};

// Inventory & COGS (simple summary using purchases and opening/ending balances if present)
export const buildInventoryCOGS = (monthISO: string) => {
  const opening = readJSON<number>('corepms_inventory_opening', 0);
  const ending = readJSON<number>('corepms_inventory_ending', 0);
  const purchases = readJSON<any[]>('corepms_purchases', []).filter(p => (p.date||'').startsWith(monthISO));
  const purchasesTotal = purchases.reduce((s, p) => s + Number((Number(p.unitCost||0)*Number(p.quantity||0)) || 0), 0);
  const cogs = Number((opening + purchasesTotal - ending).toFixed(2));
  const rows = [
    { metric: 'Opening Inventory', value: Number(opening || 0) },
    { metric: 'Purchases', value: Number(purchasesTotal || 0) },
    { metric: 'Ending Inventory', value: Number(ending || 0) },
    { metric: 'COGS', value: Number(cogs || 0) }
  ];
  return { title: `Inventory & COGS — ${monthISO}`, columns: ['Metric','Value'], rows };
};

// Export helpers
export const exportCSV = (columns: string[], rows: any[], filename: string) => {
  const esc = (v: any) => '"' + String(v ?? '').replace(/"/g,'""') + '"';
  const header = columns.map(esc).join(',');
  const body = rows.map(r => columns.map(c => esc(r[c.toLowerCase()] ?? r[c] ?? '')).join(',')).join('\n');
  const blob = new Blob([header + '\n' + body], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename.endsWith('.csv')?filename:(filename+'.csv'); a.click(); URL.revokeObjectURL(url);
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
  const a = document.createElement('a'); a.href = url; a.download = filename.endsWith('.xls')?filename:(filename+'.xls'); a.click(); URL.revokeObjectURL(url);
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
  const a = document.createElement('a'); a.href = url; a.download = filename.endsWith('.xls')?filename:(filename+'.xls'); a.click(); URL.revokeObjectURL(url);
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
  try { const flag = localStorage.getItem('corepms_reports_use_sql'); if (flag === 'on') return sqlProvider; } catch {}
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
