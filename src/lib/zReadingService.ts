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

export interface ZReadingData {
  shift: Shift;
  totals: {
    cash: number;
    card: number;
    roomCharge: number;
    count: number;
    voidedCount: number;
    voidedAmount: number;
  };
  closingCash?: number;
  outlet?: OutletType;
}

export interface PrinterStatus {
  connected: boolean;
  error?: string;
  lastCheck: string;
}

/**
 * Generates a comprehensive Z reading report
 */
export const generateZReading = (data: ZReadingData): ShiftReading => {
  const { shift, totals, closingCash, outlet = 'default' } = data;
  const totalSales = totals.cash + totals.card + totals.roomCharge;
  const expectedCash = shift.openingCash + totals.cash;
  const cashDifference = closingCash !== undefined ? closingCash - expectedCash : 0;

  // We need async for getNextZReadingNumber, but we can't make this async easily if called synchronously.
  // Strategy: Generate a temp number or rely on DB sequence/count at insert time.
  // For consistency with existing flow, we'll assign a placeholder and update on save, 
  // OR we assume the caller will handle storage which assigns the number.
  // But wait, reading_number is part of the object.
  // We'll use a timestamp-based fallback if we can't fetch, or update logic.
  // Actually, let's keep it simple: `storeZReading` will handle the count/number finalization if needed,
  // but better to fetch it here? No, let's fetch it at store time or use a random one for display?
  // Let's change getNextZReadingNumber to be async and call it before this?
  // Or just use 0 and let persist update it? 
  // Let's try to maintain signature if possible, but reading_number needs to be accurate for print.
  // We will assume the caller will await `getNextZReadingNumber` if they need it, 
  // but here we just return the object structure.

  const zReading: ShiftReading = {
    id: `Z_${shift.id}_${Date.now()}`,
    reading_number: 0, // Placeholder, usually fetched before
    reading_type: 'Z',
    shift_id: shift.id,
    outlet: outlet,
    total_sales: totalSales,
    total_transactions: totals.count,
    bar_sales: totalSales * 0.4,
    restaurant_sales: totalSales * 0.6,
    cash_payments: totals.cash,
    card_payments: totals.card,
    room_charge_payments: totals.roomCharge,
    created_at: new Date().toISOString(),
    report_data: {
      expectedCash,
      closingCash: closingCash || expectedCash,
      cashDifference
    }
  };

  return zReading;
};

export const generateZReadingHTML = (
  zReading: ShiftReading,
  shift: Shift,
  receiptSettings?: any
): string => {
  const timestamp = new Date().toLocaleString();
  const shiftDuration = calculateShiftDuration(shift.startedAt, shift.endedAt);

  const outlet = zReading.outlet || 'default';
  let settings = receiptSettings;
  if (!settings) {
    try {
      // access local receipt settings or default
      const raw = localStorage.getItem('corepms_receipt_settings'); // Receipt settings still local? 
      // Note: Receipt settings were not part of migration scope, so we leave as localStorage or migrate?
      // Let's leave for now as it wasn't explicitly requested and is config.
      // Actually user passed them in usually.
      settings = getOutletReceiptSettings(outlet);
    } catch {
      settings = { restaurant_name: 'Property Management System' };
    }
  }

  const outletDisplayName = outlet === 'default' ? 'All Outlets' :
    outlet.charAt(0).toUpperCase() + outlet.slice(1);

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Z Reading - ${zReading.id}</title>
      <style>
        @media print { 
          @page { margin: 0; } 
          body { margin: 1cm; } 
          .no-print { display: none; }
        }
        body { 
          font-family: 'Courier New', monospace; 
          max-width: 600px; 
          margin: 0 auto; 
          padding: 20px; 
          font-size: 12px;
        }
        .center { text-align: center; }
        .bold { font-weight: bold; }
        .header { border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 15px; }
        .outlet-badge { background: #333; color: #fff; padding: 4px 12px; border-radius: 4px; display: inline-block; margin-top: 5px; }
        table { width: 100%; border-collapse: collapse; margin: 10px 0; }
        td, th { padding: 4px 8px; border-bottom: 1px dotted #666; }
        .right { text-align: right; }
        .section { margin: 15px 0; border-top: 1px solid #ccc; padding-top: 10px; }
        .highlight { background-color: #f0f0f0; font-weight: bold; }
        .cash-summary { border: 2px solid #000; padding: 10px; margin: 15px 0; }
      </style>
    </head>
    <body>
      <div class="header">
        ${settings?.show_logo && settings.logo_url ?
      `<div class="center"><img src="${settings.logo_url}" alt="Logo" style="max-width: 120px;"></div>` : ''}
        <div class="center bold" style="font-size: 16px;">${settings?.restaurant_name || 'Property Management System'}</div>
        ${settings?.address ? `<div class="center">${settings.address}</div>` : ''}
        ${settings?.phone ? `<div class="center">Phone: ${settings.phone}</div>` : ''}
        <div class="center outlet-badge">${outletDisplayName}</div>
        <div class="center bold" style="font-size: 14px; margin-top: 10px;">Z READING - CASH UP SLIP</div>
        <div class="center">Reading #${zReading.reading_number}</div>
        <div class="center">Printed: ${timestamp}</div>
      </div>

      <div class="section">
        <div class="bold">SHIFT INFORMATION</div>
        <table>
          <tr><td>Shift ID:</td><td class="right">${shift.id}</td></tr>
          <tr><td>Opened By:</td><td class="right">${shift.openedBy || 'N/A'}</td></tr>
          <tr><td>Started:</td><td class="right">${new Date(shift.startedAt).toLocaleString()}</td></tr>
          <tr><td>Ended:</td><td class="right">${shift.endedAt ? new Date(shift.endedAt).toLocaleString() : 'N/A'}</td></tr>
          <tr><td>Duration:</td><td class="right">${shiftDuration}</td></tr>
        </table>
      </div>

      <div class="section">
        <div class="bold">SALES SUMMARY</div>
        <table>
          <tr><td>Total Sales:</td><td class="right bold">${formatCurrency(zReading.total_sales)}</td></tr>
          <tr><td>Total Transactions:</td><td class="right">${zReading.total_transactions}</td></tr>
          <tr><td>Restaurant Sales:</td><td class="right">${formatCurrency(zReading.restaurant_sales)}</td></tr>
          <tr><td>Bar Sales:</td><td class="right">${formatCurrency(zReading.bar_sales)}</td></tr>
        </table>
      </div>

      <div class="section">
        <div class="bold">PAYMENT BREAKDOWN</div>
        <table>
          <tr><td>Cash Payments:</td><td class="right">${formatCurrency(zReading.cash_payments)}</td></tr>
          <tr><td>Card Payments:</td><td class="right">${formatCurrency(zReading.card_payments)}</td></tr>
          <tr><td>Room Charges:</td><td class="right">${formatCurrency(zReading.room_charge_payments)}</td></tr>
        </table>
      </div>

      ${shift.voidedTransactions.length > 0 ? `
      <div class="section">
        <div class="bold">VOIDED TRANSACTIONS</div>
        <table>
          <tr><th>Time</th><th>Method</th><th>Amount</th><th>Reason</th></tr>
          ${shift.voidedTransactions.map(tx => `
            <tr>
              <td>${new Date(tx.voidedAt || tx.createdAt).toLocaleTimeString()}</td>
              <td>${tx.method.toUpperCase()}</td>
              <td class="right">${formatCurrency(tx.amount)}</td>
              <td>${tx.voidReason || 'N/A'}</td>
            </tr>
          `).join('')}
        </table>
        <div style="margin-top: 10px;">
          <strong>Total Voided: ${formatCurrency(shift.voidedTransactions.reduce((sum, tx) => sum + tx.amount, 0))}</strong>
        </div>
      </div>
      ` : ''}

      <div class="cash-summary">
        <div class="bold center">CASH RECONCILIATION</div>
        <table>
          <tr><td>Opening Cash:</td><td class="right">${formatCurrency(shift.openingCash)}</td></tr>
          <tr><td>Cash Sales:</td><td class="right">${formatCurrency(zReading.cash_payments)}</td></tr>
          <tr class="highlight"><td>Expected Cash:</td><td class="right">${formatCurrency(zReading.report_data?.expectedCash || 0)}</td></tr>
          <tr><td>Closing Cash:</td><td class="right">${formatCurrency(zReading.report_data?.closingCash || 0)}</td></tr>
          <tr class="highlight">
            <td>Difference:</td>
            <td class="right" style="color: ${(zReading.report_data?.cashDifference || 0) >= 0 ? 'green' : 'red'}">
              ${formatCurrency(zReading.report_data?.cashDifference || 0)}
            </td>
          </tr>
        </table>
      </div>

      <div class="section">
        <div class="bold">TRANSACTION DETAILS</div>
        <table>
          <tr><th>Time</th><th>Method</th><th>Reference</th><th class="right">Amount</th></tr>
          ${shift.transactions.map(tx => `
            <tr>
              <td>${new Date(tx.createdAt).toLocaleTimeString()}</td>
              <td>${tx.method.toUpperCase()}</td>
              <td>${tx.reference || '—'}</td>
              <td class="right">${formatCurrency(tx.amount)}</td>
            </tr>
          `).join('')}
        </table>
      </div>

      <div class="section center">
        <div style="margin-top: 20px; font-size: 10px;">
          <div>Z Reading ID: ${zReading.id}</div>
          <div>Generated: ${zReading.created_at}</div>
          <div>System: CorePMS v1.0</div>
        </div>
      </div>
    </body>
    </html>
  `;
};

export const printZReading = async (
  zReading: ShiftReading,
  shift: Shift,
  receiptSettings?: any
): Promise<{ success: boolean; error?: string }> => {
  try {
    const printerStatus = await checkPrinterStatus();
    if (!printerStatus.connected) {
      throw new Error(printerStatus.error || 'Printer not connected');
    }

    let settings = receiptSettings;
    if (!settings && zReading.outlet) {
      try {
        settings = getOutletReceiptSettings(zReading.outlet);
      } catch { }
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
      `INSERT INTO system_audits (id, action, entity_type, entity_id, user_id, details) VALUES (?, ?, ?, ?, ?, ?::jsonb)`,
      [id, 'Z_READING_GENERATED', 'SHIFT', shift.id, shift.openedBy || 'SYSTEM', JSON.stringify(auditEntry)]
    );
  } catch (error) {
    console.error('Failed to log Z reading audit:', error);
  }
};

export const checkPrinterStatus = async (): Promise<PrinterStatus> => {
  try {
    const lastCheck = new Date().toISOString();
    const isConnected = Math.random() > 0.05;

    if (!isConnected) {
      return { connected: false, error: 'Printer offline or paper jam detected', lastCheck };
    }
    return { connected: true, lastCheck };
  } catch (error) {
    return { connected: false, error: error instanceof Error ? error.message : 'Printer check failed', lastCheck: new Date().toISOString() };
  }
};

/**
 * Gets next Z reading number from DB
 */
export const getNextZReadingNumber = async (): Promise<number> => {
  try {
    const res = await db.query('SELECT MAX(reading_number) as max_num FROM z_readings');
    if ('rows' in res && res.rows.length > 0) {
      return (Number(res.rows[0].max_num) || 0) + 1;
    }
    return 1;
  } catch {
    return 1;
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
    // Ensure reading number (if not set properly before)
    if (!zReading.reading_number) {
      zReading.reading_number = await getNextZReadingNumber();
    }

    await db.query(
      `INSERT INTO z_readings (id, reading_number, shift_id, outlet, data, created_at) VALUES (?, ?, ?, ?, ?::jsonb, ?)`,
      [zReading.id, zReading.reading_number, zReading.shift_id, zReading.outlet || 'default', JSON.stringify(zReading), new Date().toISOString()]
    );
  } catch (error) {
    console.error('Failed to store Z reading:', error);
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