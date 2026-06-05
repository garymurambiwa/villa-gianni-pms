/**
 * Z Reading Service (DB-Backed)
 *
 * Handles automated Z reading generation, printing, and audit logging
 * for shift closure operations using PostgreSQL.
 */

import { ShiftReading } from '../types';
import { Shift } from '../contexts/ShiftContext';
import { printDocument, formatCurrency } from './posIntegration';
import { getOutletReceiptSettings } from '../components/modules/ReceiptSettingsModal';
import { db } from './db';

export type OutletType = 'default' | 'restaurant' | 'bar';

// Departmental breakdown per Z-reading
export interface DepartmentalSales {
  department: string;
  sales: number;
  taxCollected: number;
  transactionCount: number;
  percentage: number;
}

export interface ZReadingData {
  shift: Shift;
  totals: {
    cash: number;
    ecocash: number;
    card: number;
    roomCharge: number;
    count: number;
    voidedCount: number;
    voidedAmount: number;
    barSales?: number;
    restaurantSales?: number;
  };
  closingCash?: number;
  outlet?: OutletType;
  /** Optional per-department breakdown for enhanced analytics */
  departmentalBreakdown?: DepartmentalSales[];
  /** Tax rate used for shift (from system config, default 0) */
  taxRate?: number;
}

export interface PrinterStatus {
  connected: boolean;
  error?: string;
  lastCheck: string;
}

/**
 * Generates a comprehensive Z reading report.
 * IMPORTANT: Call getNextZReadingNumber() BEFORE this function so reading_number is accurate on the slip.
 */
export const generateZReading = (data: ZReadingData, readingNumber: number = 0): ShiftReading => {
  const { shift, totals, closingCash, outlet = 'default', departmentalBreakdown = [], taxRate = 0 } = data;
  // Gross sales must count EVERY payment method, including EcoCash. Previously
  // EcoCash was collected and shown in the transaction list but silently
  // omitted from gross, so the Z-reading under-reported revenue.
  const totalSales = totals.cash + (totals.ecocash || 0) + totals.card + totals.roomCharge;
  const expectedCash = shift.openingCash + totals.cash;
  const cashDifference = closingCash !== undefined ? closingCash - expectedCash : 0;

  // Calculate tax from totals if taxRate provided (tax-inclusive calculation)
  const taxCollected = taxRate > 0
    ? parseFloat((totalSales * (taxRate / (100 + taxRate))).toFixed(2))
    : 0;
  const netSales = parseFloat((totalSales - taxCollected).toFixed(2));

  // Build departmental percentage breakdown
  const enrichedDeptBreakdown: DepartmentalSales[] = departmentalBreakdown.map(d => ({
    ...d,
    percentage: totalSales > 0 ? parseFloat(((d.sales / totalSales) * 100).toFixed(1)) : 0
  }));

  // If no explicit breakdown provided but bar/restaurant sales are in totals, synthesise
  if (enrichedDeptBreakdown.length === 0 && ((totals.barSales || 0) + (totals.restaurantSales || 0)) > 0) {
    const bar = totals.barSales || 0;
    const restaurant = totals.restaurantSales || 0;
    if (bar > 0) enrichedDeptBreakdown.push({
      department: 'Bar',
      sales: bar,
      taxCollected: taxRate > 0 ? parseFloat((bar * (taxRate / (100 + taxRate))).toFixed(2)) : 0,
      transactionCount: 0,
      percentage: totalSales > 0 ? parseFloat(((bar / totalSales) * 100).toFixed(1)) : 0
    });
    if (restaurant > 0) enrichedDeptBreakdown.push({
      department: 'Restaurant',
      sales: restaurant,
      taxCollected: taxRate > 0 ? parseFloat((restaurant * (taxRate / (100 + taxRate))).toFixed(2)) : 0,
      transactionCount: 0,
      percentage: totalSales > 0 ? parseFloat(((restaurant / totalSales) * 100).toFixed(1)) : 0
    });
  }

  const zReading: ShiftReading = {
    id: `Z_${shift.id}_${Date.now()}`,
    reading_number: readingNumber, // Must be provided by caller via getNextZReadingNumber()
    reading_type: 'Z',
    shift_id: shift.id,
    outlet: outlet,
    total_sales: totalSales,
    total_transactions: totals.count,
    bar_sales: totals.barSales || 0,
    restaurant_sales: totals.restaurantSales || 0,
    cash_payments: totals.cash,
    ecocash_payments: totals.ecocash || 0,
    card_payments: totals.card,
    room_charge_payments: totals.roomCharge,
    created_at: new Date().toISOString(),
    report_data: {
      expectedCash,
      closingCash: closingCash ?? expectedCash,
      cashDifference,
      taxCollected,
      netSales,
      taxRate,
      departmentalBreakdown: enrichedDeptBreakdown,
      voidedCount: totals.voidedCount,
      voidedAmount: totals.voidedAmount
    }
  };

  return zReading;
};

export const generateZReadingHTML = (
  zReading: ShiftReading,
  shift: Shift,
  receiptSettings?: Record<string, unknown>
): string => {
  const timestamp = new Date().toLocaleString();
  const shiftDuration = calculateShiftDuration(shift.startedAt, shift.endedAt);

  const outlet = zReading.outlet || 'default';
  let settings = receiptSettings;
  if (!settings) {
    try {
      settings = getOutletReceiptSettings(outlet);
    } catch {
      settings = { restaurant_name: 'Property Management System' };
    }
  }

  const outletDisplayName = outlet === 'default' ? 'All Outlets' :
    outlet.charAt(0).toUpperCase() + outlet.slice(1);

  const bodyWidth = '74mm';
  const fontSize = '11px';

  const rd = zReading.report_data || {};
  const taxCollected: number = rd.taxCollected || 0;
  const netSales: number = rd.netSales || zReading.total_sales;
  const taxRate: number = rd.taxRate || 0;
  const deptBreakdown: DepartmentalSales[] = rd.departmentalBreakdown || [];
  const voidedCount: number = rd.voidedCount || 0;
  const voidedAmount: number = rd.voidedAmount || 0;

  // Build departmental rows HTML
  const deptRowsHtml = deptBreakdown.length > 0
    ? deptBreakdown.map(d =>
        `<tr><td>${d.department}</td><td class="r">${formatCurrency(d.sales)}</td><td class="r">${d.percentage}%</td></tr>`
      ).join('')
    : `<tr><td>Restaurant</td><td class="r">${formatCurrency(zReading.restaurant_sales)}</td><td class="r">—</td></tr>
       <tr><td>Bar</td><td class="r">${formatCurrency(zReading.bar_sales)}</td><td class="r">—</td></tr>`;

  return `<!DOCTYPE html>
<html>
<head>
  <title>Z Reading - ${zReading.id}</title>
  <meta charset="UTF-8"/>
  <style>
    @page { size: 80mm auto; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { width: ${bodyWidth}; background: #fff; color: #000; }
    body {
      font-family: 'Courier New', Courier, monospace;
      font-size: ${fontSize};
      padding: 3mm 2mm 8mm;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .c { text-align: center; }
    .r { text-align: right; }
    .b { font-weight: bold; }
    .div { text-align: center; margin: 1.5mm 0; white-space: nowrap; overflow: hidden; }
    .logo { text-align: center; margin-bottom: 2mm; }
    .logo img { max-width: 48mm; max-height: 18mm; object-fit: contain; }
    .biz { font-weight: bold; font-size: 1.3em; text-align: center; }
    .info { text-align: center; font-size: 0.9em; line-height: 1.5; }
    .ttl { font-weight: bold; font-size: 1.1em; text-align: center; text-transform: uppercase; margin: 2mm 0 1mm; }
    .meta { font-size: 0.9em; line-height: 1.6; }
    table { width: 100%; border-collapse: collapse; }
    thead th { font-weight: bold; border-bottom: 1px dashed #000; padding-bottom: 1mm; }
    .nm { text-align: left; width: 40%; word-break: break-word; padding: 0.8mm 0; }
    .qt { text-align: center; width: 20%; padding: 0.8mm 1mm; }
    .pr { text-align: right; width: 40%; padding: 0.8mm 0; }
    .tot td { padding: 0.5mm 0; font-size: 0.95em; }
    .section-title { font-weight: bold; font-size: 0.95em; margin-top: 1mm; }
    .ft { text-align: center; font-size: 0.88em; margin-top: 2mm; line-height: 1.6; }
    .pw { text-align: center; font-size: 0.78em; margin-top: 3mm; color: #444; }
    .highlight { font-weight: bold; }
    .neg { font-weight: bold; }
  </style>
</head>
<body>
  ${settings?.show_logo && settings.logo_url ? `<div class="logo"><img src="${settings.logo_url}" alt=""/></div>` : ''}
  <div class="biz">${settings?.restaurant_name || 'Property Management System'}</div>
  <div class="info">
    ${settings?.address ? `<div>${settings.address}</div>` : ''}
    ${settings?.phone ? `<div>Phone: ${settings.phone}</div>` : ''}
    ${settings?.email ? `<div>${settings.email}</div>` : ''}
  </div>
  <div class="div">================================</div>
  <div class="ttl">Z Reading - Cash Up Slip</div>
  <div class="div">--------------------------------</div>
  <div class="meta">
    <div>Reading #: <b>${zReading.reading_number || '—'}</b></div>
    <div>Outlet: ${outletDisplayName}</div>
    <div>Printed: ${timestamp}</div>
  </div>
  <div class="div">--------------------------------</div>
  <div class="meta">
    <div>Shift ID: ${shift.id}</div>
    <div>Opened By: ${shift.openedBy || 'N/A'}</div>
    <div>Started: ${new Date(shift.startedAt).toLocaleString()}</div>
    <div>Ended: ${shift.endedAt ? new Date(shift.endedAt).toLocaleString() : 'N/A'}</div>
    <div>Duration: ${shiftDuration}</div>
  </div>
  <div class="div">--------------------------------</div>
  <div class="section-title">SALES SUMMARY</div>
  <table>
    <tbody>
      <tr><td>Gross Sales</td><td class="r b">${formatCurrency(zReading.total_sales)}</td></tr>
      ${taxRate > 0 ? `
      <tr><td>Net Sales (ex-tax)</td><td class="r">${formatCurrency(netSales)}</td></tr>
      <tr><td>Tax Collected (${taxRate}%)</td><td class="r">${formatCurrency(taxCollected)}</td></tr>
      ` : ''}
      <tr><td>Transactions</td><td class="r">${zReading.total_transactions}</td></tr>
      ${voidedCount > 0 ? `<tr><td>Voids (${voidedCount})</td><td class="r">${formatCurrency(voidedAmount)}</td></tr>` : ''}
    </tbody>
  </table>
  <div class="div">--------------------------------</div>
  <div class="section-title">DEPARTMENTAL BREAKDOWN</div>
  <table>
    <thead>
      <tr><th class="nm">Department</th><th class="r">Sales</th><th class="r">%</th></tr>
    </thead>
    <tbody>
      ${deptRowsHtml}
    </tbody>
  </table>
  <div class="div">--------------------------------</div>
  <div class="section-title">PAYMENT METHODS</div>
  <table>
    <tbody>
      <tr><td>Cash</td><td class="r">${formatCurrency(zReading.cash_payments)}</td></tr>
      <tr><td>EcoCash</td><td class="r">${formatCurrency(zReading.ecocash_payments || 0)}</td></tr>
      <tr><td>Swipe</td><td class="r">${formatCurrency(zReading.card_payments)}</td></tr>
      <tr><td>Room Charge</td><td class="r">${formatCurrency(zReading.room_charge_payments)}</td></tr>
      <tr><td class="b">Total</td><td class="r b">${formatCurrency(zReading.total_sales)}</td></tr>
    </tbody>
  </table>
  ${shift.voidedTransactions && shift.voidedTransactions.length > 0 ? `
  <div class="div">--------------------------------</div>
  <div class="section-title">VOIDED TRANSACTIONS</div>
  <table>
    <thead>
      <tr>
        <th class="nm">Time</th>
        <th class="qt">Method</th>
        <th class="qt">By</th>
        <th class="pr">Amount</th>
      </tr>
    </thead>
    <tbody>
      ${shift.voidedTransactions.map(tx => `<tr><td class="nm">${new Date(tx.voidedAt || tx.createdAt).toLocaleTimeString()}</td><td class="qt">${tx.method.toUpperCase()}</td><td class="qt">${tx.userName ? tx.userName.substring(0,1).toUpperCase() : '?'}</td><td class="pr">${formatCurrency(tx.amount)}</td></tr>`).join('')}
    </tbody>
  </table>
  <div>Total Voided: ${formatCurrency(shift.voidedTransactions.reduce((sum, tx) => sum + tx.amount, 0))}</div>
  ` : ''}
  <div class="div">--------------------------------</div>
  <div class="b c">CASH RECONCILIATION</div>
  <table>
    <tbody>
      <tr><td>Opening Cash</td><td class="r">${formatCurrency(shift.openingCash)}</td></tr>
      <tr><td>Cash Sales</td><td class="r">${formatCurrency(zReading.cash_payments)}</td></tr>
      <tr><td>Expected In Drawer</td><td class="r b">${formatCurrency(rd.expectedCash || 0)}</td></tr>
      <tr><td>Closing Count</td><td class="r">${formatCurrency(rd.closingCash || 0)}</td></tr>
      <tr><td class="${(rd.cashDifference || 0) < 0 ? 'neg' : 'b'}">Over / (Short)</td><td class="r ${(rd.cashDifference || 0) < 0 ? 'neg' : 'b'}">${formatCurrency(rd.cashDifference || 0)}</td></tr>
    </tbody>
  </table>
  <div class="div">--------------------------------</div>
  <div class="section-title">TRANSACTIONS (Last 20)</div>
  <table>
    <thead>
      <tr>
        <th class="nm">Time</th>
        <th class="qt">Method</th>
        <th class="qt">By</th>
        <th class="pr">Amount</th>
      </tr>
    </thead>
    <tbody>
      ${(shift.transactions || []).slice(0, 20).map(tx => `<tr><td class="nm">${new Date(tx.createdAt).toLocaleTimeString()}</td><td class="qt">${tx.method.toUpperCase()}</td><td class="qt">${tx.userName ? tx.userName.substring(0,1).toUpperCase() : '?'}</td><td class="pr">${formatCurrency(tx.amount)}</td></tr>`).join('')}
    </tbody>
  </table>
  ${(shift.transactions || []).length > 20 ? `<div class="c">... and ${shift.transactions.length - 20} more</div>` : ''}
  <div class="div">================================</div>
  <div class="ft">
    ${settings?.footer_text ? `<div>${settings.footer_text}</div>` : '<div>Thank you!</div>'}
  </div>
  <div class="pw">Powered By Coredigita</div>
  <!-- ReceiptBrandingApplied -->
</body>
</html>`;
};

export const printZReading = async (
  zReading: ShiftReading,
  shift: Shift,
  receiptSettings?: Record<string, unknown>
): Promise<{ success: boolean; error?: string }> => {
  try {
    let settings = receiptSettings;
    if (!settings && zReading.outlet) {
      try {
        settings = getOutletReceiptSettings(zReading.outlet);
      } catch { /* noop — use fallback settings */ }
    }

    const html = generateZReadingHTML(zReading, shift, settings);
    await printDocument(html, `Z-Reading-${zReading.reading_number}`);

    return { success: true };
  } catch (error) {
    console.error('Z Reading print failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown printing error'
    };
  }
};

export const logZReadingAudit = async (zReading: ShiftReading, shift: Shift, printStatus: { success: boolean; error?: string }) => {
  const auditEntry = {
    zReadingId: zReading.id,
    readingNumber: zReading.reading_number,
    totalSales: zReading.total_sales,
    totalTransactions: zReading.total_transactions,
    cashDifference: zReading.report_data?.cashDifference,
    printSuccess: printStatus.success,
    printError: printStatus.error,
    shiftDuration: calculateShiftDuration(shift.startedAt, shift.endedAt)
  };

  try {
    const id = `AUDIT_Z_${Date.now()}`;
    await db.query(
      `INSERT INTO system_audits (id, action, entity_type, entity_id, user_id, details) VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, 'Z_READING_GENERATED', 'SHIFT', shift.id, shift.openedBy || 'SYSTEM', JSON.stringify(auditEntry)]
    );
  } catch (error) {
    console.error('Failed to log Z reading audit:', error);
    // Non-fatal: store in localStorage as fallback
    try {
      const key = 'corepms_zreading_audit_queue';
      const queue = JSON.parse(localStorage.getItem(key) || '[]');
      queue.push({ ...auditEntry, queued_at: new Date().toISOString() });
      localStorage.setItem(key, JSON.stringify(queue.slice(-100))); // keep last 100
    } catch { /* ignore */ }
  }
};

/**
 * Checks printer availability. Uses browser print capability instead of random simulation.
 */
export const checkPrinterStatus = async (): Promise<PrinterStatus> => {
  const lastCheck = new Date().toISOString();
  // Browser-based printing is always "connected" — it opens the print dialog.
  // A real thermal printer check would call /api/printer/status here.
  try {
    const res = await fetch('/api/printer/status', { method: 'GET', signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      const data = await res.json();
      return { connected: data.connected !== false, lastCheck };
    }
  } catch {
    // No printer endpoint — fall back to browser print (always available)
  }
  return { connected: true, lastCheck };
};

/**
 * Gets next Z reading number from DB
 */
export const getNextZReadingNumber = async (): Promise<number> => {
  try {
    const res = await db.query<{ max_num: number | null }>('SELECT MAX(reading_number) as max_num FROM z_readings');
    if ('rows' in res && res.rows.length > 0) {
      return (Number(res.rows[0].max_num) || 0) + 1;
    }
    return 1;
  } catch {
    // Fallback: count from localStorage
    try {
      const stored = JSON.parse(localStorage.getItem('corepms_zReadings') || '[]');
      return (stored.length || 0) + 1;
    } catch {
      return 1;
    }
  }
};

const calculateShiftDuration = (startTime: string, endTime?: string): string => {
  const start = new Date(startTime);
  const end = endTime ? new Date(endTime) : new Date();
  const durationMs = end.getTime() - start.getTime();

  const hours = Math.floor(durationMs / (1000 * 60 * 60));
  const minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));

  return `${hours}h ${minutes}m`;
};

/**
 * Stores Z reading in DB
 */
export const storeZReading = async (zReading: ShiftReading): Promise<void> => {
  try {
    // Ensure reading number is set (should already be set by caller)
    if (!zReading.reading_number) {
      zReading.reading_number = await getNextZReadingNumber();
    }

    await db.query(
      `INSERT INTO z_readings (id, reading_number, shift_id, outlet, data, created_at) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
      [zReading.id, zReading.reading_number, zReading.shift_id, zReading.outlet || 'default', JSON.stringify(zReading), new Date().toISOString()]
    );
  } catch (error) {
    console.error('Failed to store Z reading in DB:', error);
    // Store in localStorage as fallback so data is not lost
    try {
      const key = 'corepms_zreading_db_queue';
      const queue = JSON.parse(localStorage.getItem(key) || '[]');
      queue.push(zReading);
      localStorage.setItem(key, JSON.stringify(queue.slice(-50)));
    } catch { /* ignore */ }
  }
};

export default {
  generateZReading,
  generateZReadingHTML,
  printZReading,
  logZReadingAudit,
  checkPrinterStatus,
  getNextZReadingNumber,
  storeZReading
};
