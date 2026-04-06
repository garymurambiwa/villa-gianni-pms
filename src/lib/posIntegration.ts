import { applySettingsToHTML } from './printSettings';
import db from '@/lib/db';

// Local POS types for integration (kept minimal to avoid cross-module coupling)
export interface BillItem {
  name: string;
  quantity: number;
  price: number;
  subtotal: number;
}

export interface Bill {
  id: string;
  items: BillItem[];
  subtotal?: number;
  tax?: number;
  total: number;
  customerName?: string;
  roomNumber?: string;
  tableId?: string;
}

export interface ReceiptSettings {
  restaurant_name: string;
  address?: string;
  phone?: string;
  email?: string;
  tax_rate: number;
  show_tax_breakdown: boolean;
  paper_size: '58mm' | '80mm';
  logo_url?: string;
  show_logo?: boolean;
  header_text?: string;
  footer_text?: string;
  promotional_message?: string;
}

// ============================================================================
// PAYMENT PROCESSING UTILITIES
// ============================================================================

/**
 * Validates room charge payment requirements
 * 
 * @param paymentMethod - The selected payment method
 * @param customerName - Guest name (required for room charges)
 * @param roomNumber - Room number (required for room charges)
 * @returns boolean indicating if payment data is valid
 * 
 * Integration: Use this for validating folio charge postings
 */
export const validateRoomChargePayment = (
  paymentMethod: 'cash' | 'card' | 'room-charge',
  customerName?: string,
  roomNumber?: string
): boolean => {
  if (paymentMethod === 'room-charge') {
    return !!(customerName && roomNumber);
  }
  return true;
};

/**
 * Calculates tax breakdown for bills/folios
 * 
 * @param total - Total amount including tax
 * @param taxRate - Tax rate (default 0.10 for 10%)
 * @returns object with subtotal, tax amount, and total
 * 
 * Integration: Use for all PMS charge calculations and folio line items
 */
export const calculateTaxBreakdown = (
  total: number,
  taxRate: number = 0.10
): { subtotal: number; tax: number; total: number } => {
  const subtotal = total / (1 + taxRate);
  const tax = total - subtotal;

  return {
    subtotal: Number(subtotal.toFixed(2)),
    tax: Number(tax.toFixed(2)),
    total: Number(total.toFixed(2))
  };
};

/**
 * Processes payment and returns transaction record
 * 
 * @param bill - The bill/order being paid
 * @param paymentMethod - Payment method used
 * @param customerInfo - Customer details for room charges
 * @param serverName - Staff member processing payment
 * @returns transaction record for audit trail
 * 
 * Integration: Adapt for folio charge posting and payment processing
 */
export const processPayment = (
  bill: Bill,
  paymentMethod: 'cash' | 'card' | 'room-charge',
  customerInfo?: { name: string; roomNumber: string },
  serverName?: string
) => {
  // Validate payment data
  if (!validateRoomChargePayment(paymentMethod, customerInfo?.name, customerInfo?.roomNumber)) {
    throw new Error('Invalid payment data for room charge');
  }

  // Create transaction record
  const transaction = {
    id: `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    billId: bill.id,
    amount: bill.total,
    paymentMethod,
    customerName: customerInfo?.name,
    roomNumber: customerInfo?.roomNumber,
    processedBy: serverName,
    processedAt: new Date().toISOString(),
    items: bill.items.map(item => ({
      name: item.name,
      quantity: item.quantity,
      price: item.price,
      subtotal: item.subtotal
    }))
  };

  return transaction;
};

/**
 * Decrement inventory quantities based on sold items
 */
export const decrementInventory = (soldItems: Array<{ name: string; quantity: number }>, costCenter?: string, shiftId?: string) => {
  try {
    const raw = localStorage.getItem('corepms_pos_items');
    const list = raw ? JSON.parse(raw) : [];
    const nameMap = new Map<string, number>();
    soldItems.forEach(si => nameMap.set(String(si.name).toLowerCase(), Number(si.quantity || 0)));
    const next = list.map((it: Record<string, unknown>) => {
      const q = nameMap.get(String(it.name || '').toLowerCase());
      if (!q) return it;
      const current = Number(it.qtyInStock || 0);
      const updated = Math.max(0, current - q);
      return { ...it, qtyInStock: updated };
    });
    localStorage.setItem('corepms_pos_items', JSON.stringify(next));
    const audit = {
      id: `AUD_${Date.now()}`,
      action: 'INVENTORY_DEPLETION',
      entity: 'STOCK',
      timestamp: new Date().toISOString(),
      details: soldItems,
      cost_center: costCenter,
      shift_id: shiftId
    };
    const ar = localStorage.getItem('corepms_pos_audit');
    const al = ar ? JSON.parse(ar) : [];
    localStorage.setItem('corepms_pos_audit', JSON.stringify([audit, ...al].slice(0, 1000)));
  } catch (err) {
    console.error('Failed to decrement inventory', err);
  }
  // Also persist to DB asynchronously if available
  (async () => {
    try {
      const isConfigured = await db.isConfigured();
      if (!isConfigured) return;
      for (const si of soldItems) {
        const qty = Number(si.quantity || 0);
        const name = String(si.name || '').toLowerCase();
        await db.query(
          `UPDATE inventory_items SET stock_level = GREATEST(stock_level - ?, 0) WHERE LOWER(name::text) = LOWER(?::text)`,
          [qty, name]
        );
      }
    } catch { /* noop — DB decrement is best-effort */ }
  })();
};

/**
 * Read menu items from POS store and normalize for frontoffice order UI
 * Returns items categorized as 'food' or 'bar' with availability flags
 */
export const getMenuItemsFromPOSStore = (): Array<{ id: string; name: string; price: number; category: 'food' | 'bar'; description?: string; available: boolean; category_id?: string; subCategory?: string; sub_id?: string; imageBgColor?: string; image?: string }> => {
  try {
    const raw = localStorage.getItem('corepms_pos_items');
    const list = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return [];
    return list.map((it: Record<string, unknown>) => {
      const costCenter = String(it.costCenter || it.type || '').toLowerCase();
      const rawCat = String(it.department || it.category || '').toLowerCase();
      const isBar = costCenter.includes('bar') ||
        rawCat.includes('bar') ||
        rawCat.includes('beverage') ||
        rawCat.includes('cocktail') ||
        rawCat.includes('beer') ||
        rawCat.includes('wine') ||
        rawCat.includes('cider') ||
        rawCat.includes('liquor') ||
        rawCat.includes('spirit') ||
        rawCat.includes('drink') ||
        rawCat.includes('alcohol');

      const category: 'food' | 'bar' = isBar ? 'bar' : 'food';
      const price = Number(it.sellingPrice ?? it.price ?? 0);
      const visibility = it.visibility as { bar?: boolean; restaurant?: boolean } | null | undefined;
      const available = category === 'bar' ? !!visibility?.bar : !!visibility?.restaurant;
      return {
        id: String(it.id ?? it.name ?? `item_${Math.random().toString(36).slice(2)}`),
        name: String(it.name ?? 'Item'),
        price: Number.isFinite(price) ? price : 0,
        category,
        description: String(it.notes || ''),
        available: typeof it.visibility === 'object' ? available : true,
        // New fields for two-tier categorization
        category_id: it.category_id ? String(it.category_id) : undefined,
        subCategory: it.subCategory ? String(it.subCategory) : (it.category ? String(it.category) : undefined),
        sub_id: it.sub_id ? String(it.sub_id) : undefined,
        imageBgColor: it.imageBgColor ? String(it.imageBgColor) : undefined,
        image: it.pictureData ? String(it.pictureData) : undefined,
      };
    }).filter(m => m.available);
  } catch (err) {
    console.error('Failed to read menu items from POS store', err);
    return [];
  }
};

export const getMenuItems = async (costCentre?: string): Promise<Array<{ id: string; name: string; price: number; category: 'food' | 'bar'; description?: string; category_id?: string; subCategory?: string; unitOfMeasure?: string; costPrice?: number; }>> => {
  try {
    const isConfigured = await db.isConfigured();
    if (isConfigured) {
      // Use products table as source of truth
      const res = await db.query(
        `SELECT id, name, price, department, category, active, category_id, sub_id, unit, cost_price, bar_visibility, restaurant_visibility FROM products WHERE active = true`
      );
      if ('rows' in res && Array.isArray(res.rows)) {
        return res.rows
          .map((r: any) => {
            const rawCat = String(r.department || r.category || '').toLowerCase();
            const isBarItem = rawCat.includes('bar') || rawCat.includes('beverage') || rawCat.includes('drink') || !!r.bar_visibility;
            
            const category: 'food' | 'bar' = isBarItem ? 'bar' : 'food';
            const price = Number(r.price || 0);

            if (price <= 0) return null;

            // Filter by cost centre if specified
            if (costCentre) {
              const ccLower = costCentre.toLowerCase();
              const isBarStation = ccLower.includes('bar');
              const isRestaurantStation = ccLower.includes('restaurant') || ccLower.includes('room service');
              
              // If visibility is null/undefined, default to true for backward compatibility
              const barVis = r.bar_visibility !== false;
              const restVis = r.restaurant_visibility !== false;

              if (isBarStation && !barVis) return null;
              if (isRestaurantStation && !restVis) return null;
            }

            let category_id = r.category_id ? String(r.category_id) : undefined;
            if (!category_id || category_id === '') {
              category_id = isBarItem ? 'CAT_BAR_GEN' : 'CAT_REST_GEN';
            }

            return {
              id: String(r.id),
              name: String(r.name),
              price,
              category,
              description: '',
              subCategory: String(r.category || r.department || ''),
              category_id,
              unitOfMeasure: r.unit ? String(r.unit) : undefined,
              costPrice: r.cost_price ? Number(r.cost_price) : undefined
            };
          })
          .filter((item): item is NonNullable<typeof item> => item !== null);
      }
    }
  } catch (e) {
    console.error('Failed to load menu items from DB', e);
  }
  return getMenuItemsFromPOSStore();
};
// ============================================================================
// RECEIPT & DOCUMENT GENERATION UTILITIES
// ============================================================================

/**
 * Generates HTML receipt/document with customizable template
 * 
 * @param data - Bill/folio data
 * @param settings - Receipt settings (branding, layout)
 * @param type - Document type ('receipt', 'folio', 'confirmation')
 * @param options - Additional options (signature lines, etc.)
 * @returns HTML string ready for printing
 * 
 * Integration: Use for folio printing, confirmation letters, receipts
 */
export const generateReceiptHTML = (
  data: Bill,
  settings: ReceiptSettings,
  type: 'receipt' | 'folio' | 'confirmation' = 'receipt',
  options: {
    includeSignature?: boolean;
    showTaxBreakdown?: boolean;
    serverName?: string;
    taxLines?: Array<{ name: string; amount: number }>;
    subtotalOverride?: number;
    totalOverride?: number;
  } = {}
): string => {
  const subtotal = Number(options.subtotalOverride ?? (Array.isArray(data.items) ? data.items.reduce((s, it) => s + Number(it.subtotal || 0), 0) : 0))
  let tax = 0
  const total = Number(options.totalOverride ?? data.total ?? 0)
  const taxLines = Array.isArray(options.taxLines) ? options.taxLines : [{ name: `Tax`, amount: Number(((total - subtotal) || 0).toFixed(2)) }]
  tax = taxLines.reduce((s, t) => s + Number(t.amount || 0), 0)
  const timestamp = new Date().toLocaleString();
  const safeItems = Array.isArray(data.items) ? data.items : [];
  const rowsHTML = safeItems.map(item => {
    const qty = Number(item.quantity ?? 0);
    const price = Number(item.price ?? 0);
    const sub = Number(item.subtotal ?? (qty * price));
    const name = String(item.name ?? 'Item');
    return `
          <tr>
            <td>${name}</td>
            <td style="text-align: center;">${qty || ''}</td>
            <td class="right">$${sub.toFixed(2)}</td>
          </tr>`;
  }).join('');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>${type.charAt(0).toUpperCase() + type.slice(1)} - ${data.id}</title>
      <style>
        @media print {
          @page { margin: 0; }
          body { margin: 1cm; }
        }
        body {
          font-family: Arial, sans-serif;
          font-size: 12px;
          max-width: ${settings.paper_size === '58mm' ? '200px' : '300px'};
          margin: 0 auto;
          padding: 20px;
        }
        .center { text-align: center; }
        .bold { font-weight: bold; }
        .large { font-size: 16px; }
        table { width: 100%; border-collapse: collapse; }
        td, th { padding: 4px; border-bottom: 1px solid #f0f0f0; }
        .right { text-align: right; }
        .border-top { border-top: 1px solid #ccc; }
        .border-bottom { border-bottom: 1px solid #ccc; }
        .signature-line { border-bottom: 1px solid black; height: 40px; margin: 10px 0; }
      </style>
    </head>
    <body>
      <!-- Header with branding -->
      ${settings.show_logo && settings.logo_url ? `<div class="center"><img src="${settings.logo_url}" alt="Logo" style="max-width: 100px;"></div>` : ''}
      <div class="center bold large">${settings.restaurant_name}</div>
      ${settings.address ? `<div class="center">${settings.address}</div>` : ''}
      ${settings.phone ? `<div class="center">Phone: ${settings.phone}</div>` : ''}
      ${settings.email ? `<div class="center">Email: ${settings.email}</div>` : ''}
      ${settings.header_text ? `<div class="center">${settings.header_text}</div>` : ''}
      
      <br>
      
      <!-- Transaction details -->
      <div class="border-top border-bottom" style="padding: 8px 0;">
        <div>${type.toUpperCase()}: ${data.id.slice(0, 8)}</div>
        ${data.roomNumber ? `<div>Room: ${data.roomNumber}</div>` : ''}
        ${options.serverName ? `<div>Staff: ${options.serverName}</div>` : ''}
        <div>${timestamp}</div>
        ${data.customerName ? `<div>Guest: ${data.customerName}</div>` : ''}
        ${data.roomNumber ? `<div>Room: ${data.roomNumber}</div>` : ''}
      </div>
      
      <br>
      
      <!-- Items table -->
      <table>
        <tr class="border-bottom">
          <th style="text-align: left;">Item</th>
          <th>Qty</th>
          <th class="right">Price</th>
        </tr>
        ${rowsHTML}
      </table>
      
      <br>
      
      <!-- Totals section -->
      <div class="border-top" style="padding-top: 8px;">
        ${options.showTaxBreakdown || settings.show_tax_breakdown ? `
          <div>Subtotal: <span class="right">$${subtotal.toFixed(2)}</span></div>
          ${taxLines.map(tl => `<div>${tl.name}: <span class="right">$${tl.amount.toFixed(2)}</span></div>`).join('')}
        ` : ''}
        <div class="bold large">TOTAL: <span class="right">$${total.toFixed(2)}</span></div>
      </div>
      
      <!-- Signature section for room charges -->
      ${options.includeSignature ? `
        <br>
        <div class="border-top" style="padding-top: 12px;">
          <div class="bold">Guest Signature:</div>
          <div class="signature-line"></div>
          <div style="font-size: 12px;">I agree to have this amount charged to my room folio.</div>
        </div>
      ` : ''}
      
      <br>
      
      <!-- Footer -->
      ${settings.promotional_message ? `<div class="center">${settings.promotional_message}</div>` : ''}
      ${settings.footer_text ? `<div class="center">${settings.footer_text}</div>` : ''}
      <div class="center" style="margin-top:12px;font-size:10px;color:#555">Powered By Coredigita</div>
      <div class="center">Thank you!</div>
      <!-- ReceiptBrandingApplied -->
  </body>
  </html>
  `;
};

/**
 * Prints document using browser print dialog
 * 
 * @param htmlContent - HTML content to print
 * @param title - Document title
 * @param autoClose - Whether to auto-close print window
 * 
 * Integration: Use for all PMS document printing (folios, receipts, confirmations)
 */
export const printDocument = (
  htmlContent: string,
  title: string = 'Document',
  autoClose: boolean = true
): void => {
  const printWindow = window.open('', '_blank');
  if (!printWindow) { alert('Please allow popups to print documents'); return; }

  const wrapped = applySettingsToHTML(title, htmlContent);

  try {
    printWindow.document.open();
    printWindow.document.write(wrapped);
    printWindow.document.close();
  } catch { /* noop — document.write may fail cross-origin */ }
  printWindow.focus();

  const trigger = () => {
    try {
      printWindow.print();
      if (autoClose) printWindow.close();
    } catch {
      setTimeout(() => { try { printWindow.print(); if (autoClose) printWindow.close(); } catch { /* noop */ } }, 250);
    }
  };
  try { printWindow.addEventListener('load', trigger); } catch { setTimeout(trigger, 300); }
};

// ============================================================================
// STATE MANAGEMENT UTILITIES
// ============================================================================

/**
 * Generic entity update function (tables, rooms, etc.)
 * 
 * @param entities - Array of entities to update
 * @param entityId - ID of entity to update
 * @param updates - Partial updates to apply
 * @returns Updated entities array
 * 
 * Integration: Use for updating rooms, guests, reservations, etc.
 */
export const updateEntity = <T extends { id: string }>(
  entities: T[],
  entityId: string,
  updates: Partial<T>
): T[] => {
  return entities.map(entity =>
    entity.id === entityId ? { ...entity, ...updates } : entity
  );
};

/**
 * Generates unique transaction ID
 * 
 * @param prefix - Prefix for the ID (e.g., 'TXN', 'FOL', 'RES')
 * @returns Unique ID string
 * 
 * Integration: Use for generating transaction, folio, and reservation IDs
 */
export const generateTransactionId = (prefix: string = 'TXN'): string => {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substr(2, 9);
  return `${prefix}_${timestamp}_${random}`;
};

/**
 * Calculates bill/folio totals with tax
 * 
 * @param items - Array of bill items
 * @param taxRate - Tax rate to apply
 * @returns Total amount including tax
 * 
 * Integration: Use for calculating folio totals, room service orders, etc.
 */
export const calculateBillTotal = (
  items: BillItem[],
  taxRate: number = 0.10
): number => {
  const subtotal = items.reduce((sum, item) => sum + item.subtotal, 0);
  const total = subtotal * (1 + taxRate);
  return Number(total.toFixed(2));
};

// ============================================================================
// VALIDATION UTILITIES
// ============================================================================

/**
 * Validates email format
 * 
 * @param email - Email address to validate
 * @returns boolean indicating if email is valid
 * 
 * Integration: Use for guest email validation, receipt emails, etc.
 */
export const validateEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

/**
 * Validates room number format
 * 
 * @param roomNumber - Room number to validate
 * @returns boolean indicating if room number is valid
 * 
 * Integration: Use for room charge validation, room service orders, etc.
 */
export const validateRoomNumber = (roomNumber: string): boolean => {
  // Assumes room numbers are 3-4 digits (101, 1001, etc.)
  const roomRegex = /^\d{3,4}$/;
  return roomRegex.test(roomNumber);
};

/**
 * Validates payment amount
 * 
 * @param amount - Amount to validate
 * @param minAmount - Minimum allowed amount
 * @returns boolean indicating if amount is valid
 * 
 * Integration: Use for all payment and charge validations
 */
export const validatePaymentAmount = (
  amount: number,
  minAmount: number = 0.01
): boolean => {
  return amount >= minAmount && Number.isFinite(amount);
};

// ============================================================================
// FORMATTING UTILITIES
// ============================================================================

/**
 * Formats currency amount with locale support
 * 
 * @param amount - Amount to format
 * @param currency - Currency code (default USD)
 * @param locale - Locale for formatting (default en-US)
 * @returns Formatted currency string
 * 
 * Integration: Use throughout PMS for consistent currency display
 */
export const formatCurrency = (
  amount: number,
  currency: string = 'USD',
  locale: string = 'en-US'
): string => {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currency
  }).format(amount);
};

/**
 * Formats date/time for receipts and documents
 * 
 * @param date - Date to format
 * @param includeTime - Whether to include time
 * @returns Formatted date string
 * 
 * Integration: Use for all date displays in PMS
 */
export const formatReceiptDate = (
  date: Date = new Date(),
  includeTime: boolean = true
): string => {
  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  };

  if (includeTime) {
    options.hour = '2-digit';
    options.minute = '2-digit';
    options.second = '2-digit';
  }

  return date.toLocaleString('en-US', options);
};

// ============================================================================
// AUDIT TRAIL UTILITIES
// ============================================================================

/**
 * Creates audit log entry for transactions
 * 
 * @param action - Action performed (e.g., 'CHARGE_POSTED', 'PAYMENT_PROCESSED')
 * @param entityType - Type of entity (e.g., 'FOLIO', 'ROOM', 'GUEST')
 * @param entityId - ID of the entity
 * @param userId - ID of user performing action
 * @param details - Additional details about the action
 * @returns Audit log entry
 * 
 * Integration: Use for all PMS operations requiring audit trails
 */
export const createAuditEntry = (
  action: string,
  entityType: string,
  entityId: string,
  userId: string,
  details?: Record<string, unknown> | unknown
) => {
  return {
    id: generateTransactionId('AUDIT'),
    action,
    entityType,
    entityId,
    userId,
    timestamp: new Date().toISOString(),
    details: details ? JSON.stringify(details) : null
  };
};

// ============================================================================
// SHIFT X-READING DOCUMENT GENERATION
// ============================================================================

import { getOutletReceiptSettings } from '../components/modules/ReceiptSettingsModal';

type OutletType = 'default' | 'restaurant' | 'bar';

/**
 * Generates HTML for a simple Shift X-Reading summary
 *
 * @param shiftMeta - Basic shift info (id, openedBy, startedAt, endedAt?)
 * @param transactions - Array of shift transactions (method, amount, createdAt, reference)
 * @param totals - Totals object from getTotals()
 * @param settings - Optional branding settings (reuse ReceiptSettings fields)
 * @param outlet - Outlet type for outlet-specific settings
 */
export const generateShiftXReadingHTML = (
  shiftMeta: { id: string; openedBy?: string; startedAt: string; endedAt?: string },
  transactions: Array<{ method: 'cash' | 'card' | 'room-charge'; amount: number; createdAt: string; reference?: string }>,
  totals: { cash: number; card: number; roomCharge: number; count: number },
  settings?: ReceiptSettings,
  outlet: OutletType = 'default'
): string => {
  const timestamp = new Date().toLocaleString();
  const title = `Shift X-Reading - ${shiftMeta.id}`;

  // Get outlet-specific settings if not provided
  let brandSettings = settings;
  if (!brandSettings) {
    try {
      brandSettings = getOutletReceiptSettings(outlet) as ReceiptSettings;
    } catch {
      brandSettings = { restaurant_name: 'Property', tax_rate: 0, show_tax_breakdown: true, paper_size: '80mm' };
    }
  }

  // Format outlet name for display
  const outletDisplayName = outlet === 'default' ? 'All Outlets' :
    outlet.charAt(0).toUpperCase() + outlet.slice(1);

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>${title}</title>
      <style>
        @media print { @page { margin: 0; } body { margin: 1cm; } }
        body { font-family: Arial, sans-serif; font-size: 12px; max-width: 600px; margin: 0 auto; padding: 20px; }
        .center { text-align: center; }
        .bold { font-weight: bold; }
        .outlet-badge { background: #333; color: #fff; padding: 4px 12px; border-radius: 4px; display: inline-block; margin: 5px 0; }
        table { width: 100%; border-collapse: collapse; }
        td, th { padding: 6px; border-bottom: 1px solid #eee; }
        .right { text-align: right; }
      </style>
    </head>
    <body>
      ${brandSettings?.show_logo && brandSettings.logo_url ? `<div class="center"><img src="${brandSettings.logo_url}" alt="Logo" style="max-width: 120px;"></div>` : ''}
      <div class="center bold">${brandSettings?.restaurant_name || 'Property'}</div>
      ${brandSettings?.address ? `<div class="center">${brandSettings.address}</div>` : ''}
      ${brandSettings?.phone ? `<div class="center">Phone: ${brandSettings.phone}</div>` : ''}
      ${brandSettings?.email ? `<div class="center">Email: ${brandSettings.email}</div>` : ''}
      <div class="center outlet-badge">${outletDisplayName}</div>
      <br/>
      <div class="center bold">${title}</div>
      <div class="center">Printed: ${timestamp}</div>
      <br/>
      <div>Shift ID: ${shiftMeta.id}</div>
      <div>Opened By: ${shiftMeta.openedBy || 'N/A'}</div>
      <div>Started: ${shiftMeta.startedAt}</div>
      <div>Ended: ${shiftMeta.endedAt || '—'}</div>
      <br/>
      <div class="bold">Totals</div>
      <table>
        <tr><td>Cash</td><td class="right">${formatCurrency(totals.cash)}</td></tr>
        <tr><td>Card</td><td class="right">${formatCurrency(totals.card)}</td></tr>
        <tr><td>Room Charge</td><td class="right">${formatCurrency(totals.roomCharge)}</td></tr>
        <tr><td class="bold">Transactions</td><td class="right" class="bold">${totals.count}</td></tr>
      </table>
      <br/>
      <div class="bold">Transactions</div>
      <table>
        <tr><th>Time</th><th>Method</th><th>Reference</th><th class="right">Amount</th></tr>
        ${transactions.map(tx => `
          <tr>
            <td>${new Date(tx.createdAt).toLocaleString()}</td>
            <td>${tx.method}</td>
            <td>${tx.reference || ''}</td>
            <td class="right">${formatCurrency(tx.amount)}</td>
          </tr>
        `).join('')}
      </table>
      <br/>
      ${brandSettings?.footer_text ? `<div class="center">${brandSettings.footer_text}</div>` : ''}
      <div class="center" style="margin-top:12px;font-size:10px;color:#555">Powered By Coredigita</div>
    </body>
    </html>
  `;
};

/**
 * Generates a detailed City Ledger receipt HTML using branding and accounting-friendly layout.
 * Includes company name/logo, itemized charges, tax breakdown, and signature section.
 */
import { readReceiptBranding } from './printSettings';

export const generateCityLedgerReceiptHTML = (
  account: { id: string; name: string },
  receiptNo: string,
  txns: Array<{ date: string; description: string; debit?: number; credit?: number }>,
  taxRate?: number
): string => {
  const brand = (() => { try { return readReceiptBranding(); } catch { return { restaurant_name: 'Property', logo_url: '', show_logo: true, tax_rate: 0, address: '', phone: '', email: '', website: '' }; } })();
  const rate = typeof taxRate === 'number' ? taxRate : Number(brand.tax_rate || 0);
  const timestamp = new Date().toLocaleString();
  const items = txns.map(t => ({ desc: t.description || '', amount: Number(t.debit || 0) - Number(t.credit || 0), date: t.date }));
  const subtotal = items.reduce((s, it) => s + (it.amount > 0 ? it.amount : 0), 0);
  const tax = Number(((subtotal * rate) / 100).toFixed(2));
  const total = Number((subtotal + tax).toFixed(2));

  const rows = items
    .filter(it => it.amount !== 0)
    .map(it => `<tr><td>${it.date}</td><td>${it.desc}</td><td class="right">${formatCurrency(it.amount)}</td></tr>`) // charges are positive, credits negative
    .join('');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8" />
      <title>City Ledger Receipt - ${account.name}</title>
      <style>
        @media print { @page { margin: 0.8cm; } }
        body { font-family: Arial, sans-serif; font-size: 12px; color: #222; }
        .center { text-align: center; }
        .right { text-align: right; }
        .bold { font-weight: bold; }
        .header { border-bottom: 2px solid #000; padding-bottom: 8px; margin-bottom: 12px; }
        table { width: 100%; border-collapse: collapse; }
        th, td { border: 1px solid #ddd; padding: 6px; }
        th { background: #f5f5f5; text-align: left; }
        .meta { margin: 8px 0; font-size: 12px; }
        .section { margin-top: 12px; }
        .signature { margin-top: 24px; }
        .line { border-bottom: 1px solid #000; height: 28px; }
      </style>
    </head>
    <body>
      <div class="header">
        ${brand.show_logo && brand.logo_url ? `<div class="center"><img src="${brand.logo_url}" alt="Logo" style="max-height: 70px;"></div>` : ''}
        <div class="center bold" style="font-size: 16px;">${brand.restaurant_name || 'Company'}</div>
        ${brand.address ? `<div class="center">${brand.address}</div>` : ''}
        ${brand.phone ? `<div class="center">Phone: ${brand.phone}</div>` : ''}
        ${brand.email ? `<div class="center">Email: ${brand.email}</div>` : ''}
        ${brand.website ? `<div class="center">Website: ${brand.website}</div>` : ''}
      </div>

      <div class="meta">
        <div><strong>City Ledger Account:</strong> ${account.name} &nbsp; <span class="bold">#${account.id}</span></div>
        <div><strong>Receipt No:</strong> ${receiptNo} &nbsp; <strong>Date/Time:</strong> ${timestamp}</div>
      </div>

      <div class="section">
        <div class="bold">Itemized Charges</div>
        <table>
          <thead><tr><th>Date</th><th>Description</th><th class="right">Amount</th></tr></thead>
          <tbody>
            ${rows || '<tr><td colspan="3">No charge items</td></tr>'}
          </tbody>
        </table>
      </div>

      <div class="section">
        <table>
          <tr><td class="bold">Subtotal</td><td class="right">${formatCurrency(subtotal)}</td></tr>
          <tr><td class="bold">Tax (${rate.toFixed(2)}%)</td><td class="right">${formatCurrency(tax)}</td></tr>
          <tr><td class="bold">Total Amount Due</td><td class="right bold">${formatCurrency(total)}</td></tr>
        </table>
      </div>

      <div class="signature">
        <div class="bold">Guest Signature</div>
        <div class="line"></div>
        <div style="display:flex; gap:16px; margin-top:8px;">
          <div style="flex:1">
            <div class="bold">Printed Name</div>
            <div class="line"></div>
          </div>
          <div style="flex:1">
            <div class="bold">Date</div>
            <div class="line"></div>
          </div>
        </div>
      </div>

    </body>
    </html>
  `;
};

export type GatewayResult = { status: 'approved' | 'declined' | 'timeout'; authCode?: string; reference?: string; reason?: string };

export const logPaymentEvent = (event: { type: string; data?: Record<string, unknown> }) => {
  try {
    const raw = localStorage.getItem('corepms_payment_logs');
    const list = raw ? JSON.parse(raw) : [];
    const entry = { ts: new Date().toISOString(), ...event };
    localStorage.setItem('corepms_payment_logs', JSON.stringify([entry, ...list].slice(0, 1000)));
  } catch { /* noop — log is best-effort */ }
};

export const processCardPayment = async (req: { amount: number; currency?: string; token?: string; meta?: Record<string, unknown> }): Promise<GatewayResult> => {
  const m = req.meta || {};
  if (m.forceDecline) return Promise.resolve({ status: 'declined' as const, reason: 'forced' });
  if (m.forceTimeout) return new Promise((resolve) => setTimeout(() => resolve({ status: 'timeout' as const }), 1500));
  const approved = Math.random() < 0.9;
  const result: GatewayResult = approved
    ? { status: 'approved' as const, authCode: `AUTH${Math.random().toString(36).slice(2, 8)}`, reference: generateTransactionId('PAY') }
    : { status: 'declined' as const, reason: 'insufficient_funds' };
  logPaymentEvent({ type: 'gateway_result', data: { method: 'card', amount: req.amount, result } });
  return new Promise((resolve) => setTimeout(() => resolve(result), 300));
};

// ============================================================================
// EXPORT ALL UTILITIES
// ============================================================================

export default {
  // Payment utilities
  validateRoomChargePayment,
  calculateTaxBreakdown,
  processPayment,

  // Document utilities
  generateReceiptHTML,
  printDocument,
  generateShiftXReadingHTML,

  // State management utilities
  updateEntity,
  generateTransactionId,
  calculateBillTotal,

  // Validation utilities
  validateEmail,
  validateRoomNumber,
  validatePaymentAmount,

  // Formatting utilities
  formatCurrency,
  formatReceiptDate,

  // Audit utilities
  createAuditEntry
};

/**
 * Sends a receipt via the user's default email client using a mailto link.
 * This is a lightweight integration without server-side email.
 *
 * @param to - Recipient email address
 * @param subject - Email subject
 * @param body - Plain-text email body
 */
export const sendReceiptEmail = (
  to: string,
  subject: string,
  body: string
): void => {
  try {
    const mailtoUrl = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = mailtoUrl;
  } catch (e) {
    console.warn('Failed to launch mail client:', e);
    alert('Could not open your email client. Please send the receipt manually.');
  }
};
