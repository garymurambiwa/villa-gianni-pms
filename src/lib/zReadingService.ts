/**
 * Z Reading Service
 * 
 * Handles automated Z reading generation, printing, and audit logging
 * for shift closure operations.
 */

import { ShiftReading } from '../types';
import { Shift, ShiftTransaction } from '../contexts/ShiftContext';
import { printDocument, formatCurrency } from './posIntegration';
import { getOutletReceiptSettings } from '../components/modules/ReceiptSettingsModal';

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

  const zReading: ShiftReading = {
    id: `Z_${shift.id}_${Date.now()}`,
    reading_number: getNextZReadingNumber(),
    reading_type: 'Z',
    shift_id: shift.id,
    outlet: outlet,
    total_sales: totalSales,
    total_transactions: totals.count,
    bar_sales: totalSales * 0.4, // Mock split - can be enhanced with actual categorization
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

/**
 * Generates HTML for Z reading report
 */
export const generateZReadingHTML = (
  zReading: ShiftReading,
  shift: Shift,
  receiptSettings?: any
): string => {
  const timestamp = new Date().toLocaleString();
  const shiftDuration = calculateShiftDuration(shift.startedAt, shift.endedAt);
  
  // Get outlet-specific settings if outlet is specified
  const outlet = zReading.outlet || 'default';
  let settings = receiptSettings;
  if (!settings) {
    try {
      settings = getOutletReceiptSettings(outlet);
    } catch {
      settings = { restaurant_name: 'Property Management System' };
    }
  }
  
  // Format outlet name for display
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

/**
 * Prints Z reading with error handling
 */
export const printZReading = async (
  zReading: ShiftReading,
  shift: Shift,
  receiptSettings?: any
): Promise<{ success: boolean; error?: string }> => {
  try {
    // Check printer status first
    const printerStatus = await checkPrinterStatus();
    if (!printerStatus.connected) {
      throw new Error(printerStatus.error || 'Printer not connected');
    }

    // Get outlet-specific settings if not provided
    let settings = receiptSettings;
    if (!settings && zReading.outlet) {
      try {
        settings = getOutletReceiptSettings(zReading.outlet);
      } catch {}
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

/**
 * Logs Z reading to audit trail
 */
export const logZReadingAudit = (zReading: ShiftReading, shift: Shift, printStatus: { success: boolean; error?: string }) => {
  const auditEntry = {
    id: `AUDIT_Z_${Date.now()}`,
    timestamp: new Date().toISOString(),
    action: 'Z_READING_GENERATED',
    entityType: 'SHIFT',
    entityId: shift.id,
    userId: shift.openedBy || 'SYSTEM',
    details: {
      zReadingId: zReading.id,
      readingNumber: zReading.reading_number,
      totalSales: zReading.total_sales,
      totalTransactions: zReading.total_transactions,
      cashDifference: zReading.report_data?.cashDifference,
      printSuccess: printStatus.success,
      printError: printStatus.error,
      shiftDuration: calculateShiftDuration(shift.startedAt, shift.endedAt)
    }
  };

  // Store in audit log
  try {
    const existingAudit = JSON.parse(localStorage.getItem('corepms_pos_audit') || '[]');
    existingAudit.unshift(auditEntry);
    // Keep only last 1000 audit entries
    if (existingAudit.length > 1000) {
      existingAudit.splice(1000);
    }
    localStorage.setItem('corepms_pos_audit', JSON.stringify(existingAudit));
  } catch (error) {
    console.error('Failed to log Z reading audit:', error);
  }
};

/**
 * Checks printer connectivity status
 */
export const checkPrinterStatus = async (): Promise<PrinterStatus> => {
  try {
    // In a real implementation, this would check actual printer connectivity
    // For now, we'll simulate a basic check
    const lastCheck = new Date().toISOString();
    
    // Simulate occasional printer issues for testing
    const isConnected = Math.random() > 0.05; // 95% success rate
    
    if (!isConnected) {
      return {
        connected: false,
        error: 'Printer offline or paper jam detected',
        lastCheck
      };
    }

    return {
      connected: true,
      lastCheck
    };
  } catch (error) {
    return {
      connected: false,
      error: error instanceof Error ? error.message : 'Printer check failed',
      lastCheck: new Date().toISOString()
    };
  }
};

/**
 * Gets next Z reading number
 */
const getNextZReadingNumber = (): number => {
  try {
    const readings = JSON.parse(localStorage.getItem('corepms_zReadings') || '[]') as ShiftReading[];
    const maxNumber = readings.reduce((max, reading) => Math.max(max, reading.reading_number), 0);
    return maxNumber + 1;
  } catch {
    return 1;
  }
};

/**
 * Calculates shift duration in human-readable format
 */
const calculateShiftDuration = (startTime: string, endTime?: string): string => {
  const start = new Date(startTime);
  const end = endTime ? new Date(endTime) : new Date();
  const durationMs = end.getTime() - start.getTime();
  
  const hours = Math.floor(durationMs / (1000 * 60 * 60));
  const minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));
  
  return `${hours}h ${minutes}m`;
};

/**
 * Stores Z reading in persistent storage
 */
export const storeZReading = (zReading: ShiftReading): void => {
  try {
    const existingReadings = JSON.parse(localStorage.getItem('corepms_zReadings') || '[]') as ShiftReading[];
    existingReadings.unshift(zReading);
    
    // Keep only last 100 Z readings
    if (existingReadings.length > 100) {
      existingReadings.splice(100);
    }
    
    localStorage.setItem('corepms_zReadings', JSON.stringify(existingReadings));
  } catch (error) {
    console.error('Failed to store Z reading:', error);
  }
};