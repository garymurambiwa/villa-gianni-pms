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
  paymentMethod?: 'cash' | 'card' | 'room-charge';
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
 */
export const calculateTaxBreakdown = (
  total: number,
  taxRate: number = 0.15 // Default to 15% VAT if not specified (Standard Zim rate)
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
 */
export const processPayment = (
  bill: Bill,
  paymentMethod: 'cash' | 'card' | 'room-charge',
  customerInfo?: { name: string; roomNumber: string },
  serverName?: string
) => {
  if (!validateRoomChargePayment(paymentMethod, customerInfo?.name, customerInfo?.roomNumber)) {
    throw new Error('Invalid payment data for room charge');
  }
  return {
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
};

/**
 * Decrement inventory quantities based on sold items
 */
/**
 * Fetches POS settings from the database
 */
export const getPosSettings = async () => {
  try {
    const isConfigured = await db.isConfigured();
    if (!isConfigured) return { vat_rate: 0.10, service_charge: 0.00, currency_symbol: '$' };
    
    const res = await db.query(`SELECT key, value FROM pos_settings`);
    if ('rows' in res && Array.isArray(res.rows)) {
      const settings: any = {};
      res.rows.forEach((r: any) => {
        settings[r.key] = r.key.includes('rate') || r.key.includes('charge') ? Number(r.value) : r.value;
      });
      return {
        vat_rate: settings.vat_rate ?? 0.10,
        service_charge: settings.service_charge ?? 0.00,
        currency_symbol: settings.currency_symbol ?? '$'
      };
    }
  } catch (err) {
    console.warn('[getPosSettings] Failed to fetch settings:', err);
  }
  return { vat_rate: 0.10, service_charge: 0.00, currency_symbol: '$' };
};

/**
 * Decrement inventory quantities based on sold items
 */
export const decrementInventory = async (soldItems: Array<{ name: string; id?: string; quantity: number }>, costCenter?: string, shiftId?: string) => {
  try {
    // 1. Sync LocalStorage for immediate UI feedback (Legacy/Hybrid Support)
    const raw = localStorage.getItem('corepms_pos_items');
    const list = raw ? JSON.parse(raw) : [];
    const nameMap = new Map<string, number>();
    soldItems.forEach(si => nameMap.set(String(si.name).toLowerCase(), Number(si.quantity || 0)));
    const next = list.map((it: any) => {
      const q = nameMap.get(String(it.name || '').toLowerCase());
      if (!q) return it;
      return { ...it, qtyInStock: Math.max(0, Number(it.qtyInStock || 0) - q) };
    });
    localStorage.setItem('corepms_pos_items', JSON.stringify(next));

    // 2. Local Audit Log
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

    // 3. Database Transactional Update (Multi-Source Sync)
    const isConfigured = await db.isConfigured();
    if (isConfigured) {
      await db.query('BEGIN');
      try {
        for (const si of soldItems) {
          const qty = Number(si.quantity || 0);
          const name = String(si.name || '').toLowerCase();
          const itemId = si.id;

          // A. Update Legacy inventory_items table
          await db.query(
            `UPDATE inventory_items SET stock_level = GREATEST(stock_level - $1, 0) WHERE LOWER(name::text) = $2`, 
            [qty, name]
          );

          // B. Update POS Menu Source (products table)
          if (itemId) {
            await db.query(
              `UPDATE products SET stock_level = GREATEST(stock_level - $1, 0) WHERE id = $2`, 
              [qty, itemId]
            );
          } else {
            await db.query(
              `UPDATE products SET stock_level = GREATEST(stock_level - $1, 0) WHERE LOWER(name) = $2`, 
              [qty, name]
            );
          }

          // C. Log to V11 Stock Ledger for Reporting
          if (itemId) {
             // Fetch base UOM for item if possible
             const uomRes = await db.query(`SELECT category_id FROM products WHERE id = $1`, [itemId]);
             const uom = ('rows' in uomRes && uomRes.rows[0]) ? uomRes.rows[0].category_id : 'pcs';

             await db.query(`
               INSERT INTO inv_stock_ledger (
                 id, item_id, ledger_type, reference_number, quantity_change, base_uom_id, posted_by
               ) VALUES ($1, $2, $3, $4, $5, $6, $7)
             `, [
               `LEDGER_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
               itemId,
               'POS_SALE',
               shiftId || 'POS',
               -qty,
               uom,
               'POS_SYSTEM'
             ]);
          }
        }
        await db.query('COMMIT');
        console.log('[decrementInventory] Transaction committed successfully');
      } catch (txErr) {
        await db.query('ROLLBACK');
        console.error('[decrementInventory] Transaction failed, rolled back:', txErr);
      }
    }
  } catch (err) { 
    console.error('[decrementInventory] Critical failure:', err); 
  }
};

/**
 * Read menu items from POS store
 */
export const getMenuItemsFromPOSStore = (): Array<any> => {
  try {
    const raw = localStorage.getItem('corepms_pos_items');
    const list = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return [];
    return list.map((it: any) => ({
      id: String(it.id ?? it.name ?? `item_${Math.random()}`),
      name: String(it.name ?? 'Item'),
      price: Number(it.sellingPrice ?? it.price ?? 0),
      category: (String(it.costCenter || '').toLowerCase() === 'bar' || String(it.department || '').toLowerCase() === 'bar') ? 'bar' : 'food',
      description: String(it.notes || ''),
      available: true,
      category_id: it.category_id ? String(it.category_id) : undefined,
      subCategory: it.subCategory ? String(it.subCategory) : (it.category ? String(it.category) : undefined),
      sub_id: it.sub_id ? String(it.sub_id) : undefined,
      imageBgColor: it.imageBgColor ? String(it.imageBgColor) : undefined,
      image: it.pictureData ? String(it.pictureData) : undefined,
    }));
  } catch { return []; }
};

export const getMenuItems = async (costCentre?: string): Promise<Array<any>> => {
  try {
    const isConfigured = await db.isConfigured();
    if (isConfigured) {
      // Query the canonical products table — `price` IS the selling price
      const res = await db.query(`
        SELECT
          id, name, department, category,
          price,
          COALESCE(cost_price, 0) AS cost_price,
          category_id, sub_id, parent_sub_id,
          bar_visibility, restaurant_visibility,
          COALESCE(image_bg_color, '') AS image_bg_color,
          COALESCE(picture_data, '') AS picture_data,
          COALESCE(notes, '') AS notes,
          COALESCE(unit, 'pcs') AS unit,
          COALESCE(visibility_stations, '{}') AS visibility_stations
        FROM products
        WHERE active = true
        ORDER BY department, name ASC
      `);

      if ('rows' in res && Array.isArray(res.rows) && res.rows.length > 0) {
        const lowerCC = String(costCentre || '').toLowerCase();
        const isBarCC = ['bar', 'flamehouse_bar', 'conference_bar', 'beverage_cellar'].includes(lowerCC);
        const isRestCC = !isBarCC && lowerCC.length > 0;

        return res.rows
          .filter((r: any) => {
            // Respect per-item visibility flags when a cost centre is active
            if (!costCentre) return true;
            if (isBarCC)  return r.bar_visibility !== false;
            if (isRestCC) return r.restaurant_visibility !== false;
            return true;
          })
          .map((r: any) => {
            const dept = String(r.department || r.category || '').toLowerCase();
            const isBar = dept === 'bar' || r.bar_visibility === true;
            return {
              id:            String(r.id),
              name:          String(r.name),
              // price IS the selling price in the products table
              price:         Number(r.price ?? 0),
              costPrice:     Number(r.cost_price ?? 0),
              category:      isBar ? 'bar' : 'food',
              department:    String(r.department || ''),
              description:   String(r.notes || ''),
              category_id:   r.category_id ? String(r.category_id) : (isBar ? 'CAT_BAR_GEN' : 'CAT_REST_GEN'),
              subCategory:   r.sub_id ? String(r.sub_id) : (r.category_id ? String(r.category_id) : undefined),
              sub_id:        r.sub_id        ? String(r.sub_id)        : undefined,
              parent_sub_id: r.parent_sub_id ? String(r.parent_sub_id): undefined,
              unitOfMeasure: String(r.unit || 'pcs'),
              imageBgColor:  r.image_bg_color || undefined,
              image:         r.picture_data   || undefined,
            };
          });
      }
    }
  } catch (err) {
    console.warn('[getMenuItems] DB query failed, falling back to POS store:', err);
  }
  return getMenuItemsFromPOSStore();
};

// ============================================================================
// RECEIPT & DOCUMENT GENERATION UTILITIES
// ============================================================================

export const generateReceiptHTML = (data, settings, type = 'receipt', options: any = {}) => {
  const safeItems = Array.isArray(data.items) ? data.items : [];
  const subtotal = Number(options.subtotalOverride != null ? options.subtotalOverride : safeItems.reduce((s, it) => s + Number(it.subtotal || (Number(it.quantity || 0) * Number(it.price || 0))), 0));
  const total = Number(options.totalOverride != null ? options.totalOverride : (Number(data.total) > 0 ? data.total : subtotal));
  const isKOT = type === 'confirmation';
  const timestamp = new Date().toLocaleString();
  const receiptNum = String(data.id || '').replace(/[^a-zA-Z0-9\-]/g, '').slice(0, 20);
  const pageSize = settings.paper_size === '58mm' ? '58mm' : '80mm';
  const bodyWidth = settings.paper_size === '58mm' ? '54mm' : '74mm';
  const fontSize = settings.paper_size === '58mm' ? '10px' : '11px';

  const rowsHTML = safeItems.map(item => {
    const qty = Number(item.quantity || 0);
    const price = Number(item.price || 0);
    const sub = Number(item.subtotal != null ? item.subtotal : (qty * price));
    return '<tr><td class="nm">' + item.name + '</td><td class="qt">' + (qty || '') + '</td><td class="pr">' + (isKOT ? '' : formatCurrency(sub)) + '</td></tr>';
  }).join('');

  const totalsHTML = !isKOT ? (
    '<div class="div">--------------------------------</div>' +
    '<table>' +
    (options.showTaxBreakdown && Math.abs(subtotal - total) > 0.01 ? '<tr class="tot"><td>Subtotal</td><td class="r">' + formatCurrency(subtotal) + '</td></tr>' : '') +
    (Array.isArray(options.taxLines) ? options.taxLines.map(tl => '<tr class="tot"><td>' + tl.name + '</td><td class="r">' + formatCurrency(tl.amount) + '</td></tr>').join('') : '') +
    '<tr class="tot grand"><td>TOTAL</td><td class="r">' + formatCurrency(total) + '</td></tr>' +
    '</table>'
  ) : '';

  const sigHTML = options.includeSignature ? '<div class="div">--------------------------------</div><div style="margin-top:8mm"><div>Guest Signature:</div><div style="border-bottom:1px solid #000;height:10mm;margin:2mm 0;"></div><div style="font-size:0.82em">I agree to have this charged to my room folio.</div></div>' : '';
  const logoHTML = (settings.show_logo && settings.logo_url) ? '<div class="logo"><img src="' + settings.logo_url + '" alt=""/></div>' : '';

  return '<!DOCTYPE html><html><head><title>' + (isKOT ? 'KOT' : 'Receipt') + '</title><meta charset="UTF-8"/><style>' +
    '@page { size: ' + pageSize + ' auto; margin: 0; } * { box-sizing: border-box; margin: 0; padding: 0; }' +
    'html, body { width: ' + bodyWidth + '; background: #fff; color: #000; } body { font-family: "Courier New", Courier, monospace; font-size: ' + fontSize + '; padding: 3mm 2mm 8mm; -webkit-print-color-adjust: exact; print-color-adjust: exact; }' +
    '.c { text-align: center; } .r { text-align: right; } .b { font-weight: bold; } .div { text-align: center; margin: 1.5mm 0; } .logo { text-align: center; margin-bottom: 2mm; } .logo img { max-width: 48mm; max-height: 18mm; object-fit: contain; }' +
    '.nm { text-align: left; width: 58%; word-break: break-word; padding: 0.8mm 0; } .qt { text-align: center; width: 10%; padding: 0.8mm 1mm; } .pr { text-align: right; width: 32%; padding: 0.8mm 0; } .tot td { padding: 0.5mm 0; } .tot.grand td { font-weight: bold; font-size: 1.25em; border-top: 1px solid #000; padding-top: 1.5mm; }' +
    '</style></head><body>' + logoHTML + '<div class="center b" style="font-size:1.3em">' + settings.restaurant_name + '</div><div class="c" style="font-size:0.9em">' + (settings.address || '') + '</div>' +
    '<div class="div">================================</div><div class="c b">' + (isKOT ? 'KOT' : 'RECEIPT') + '</div><div class="div">--------------------------------</div>' +
     '<div>Bill: ' + receiptNum + '</div><div>Time: ' + timestamp + '</div>' + (data.paymentMethod ? '<div class="b" style="margin:1mm 0;border:1px solid #000;padding:1mm 2mm;display:inline-block">Payment: ' + ({'cash':'CASH','ecocash':'ECOCASH (MOBILE)','swipe':'CARD / SWIPE','room-charge':'CHARGED TO ROOM FOLIO'}[String(data.paymentMethod)] || String(data.paymentMethod).toUpperCase().replace(/-/g,' ')) + '</div>' : '') + (data.tableId ? '<div>Table: ' + data.tableId + '</div>' : '') + (data.roomNumber ? '<div class="b">Room: ' + data.roomNumber + '</div>' : '') + (data.customerName ? '<div class="b">Guest: ' + data.customerName + '</div>' : '') +
    '<div class="div">--------------------------------</div><table>' + rowsHTML + '</table>' + totalsHTML + sigHTML +
    '<div class="div">--------------------------------</div><div class="c">' + (settings.footer_text || 'Thank you!') + '</div><div class="c" style="font-size:0.8em;margin-top:2mm">Powered By Coredigita</div><!-- ReceiptBrandingApplied --></body></html>';
};

export const printDocument = (htmlContent: string, title: string = 'Document', autoClose: boolean = true) => {
  const printWindow = window.open('', '_blank');
  if (!printWindow) { alert('Please allow popups to print documents'); return; }
  const isThermal = htmlContent.includes('<!-- ReceiptBrandingApplied -->');
  const wrapped = isThermal ? htmlContent : applySettingsToHTML(title, htmlContent);
  try { printWindow.document.open(); printWindow.document.write(wrapped); printWindow.document.close(); } catch {}
  printWindow.focus();
  const trigger = () => { try { printWindow.print(); if (autoClose) printWindow.close(); } catch { setTimeout(() => { try { printWindow.print(); if (autoClose) printWindow.close(); } catch {} }, 500); } };
  try { printWindow.addEventListener('load', trigger); } catch { setTimeout(trigger, 500); }
};

// ============================================================================
// FORMATTING & VALIDATION
// ============================================================================

export const formatCurrency = (amount: any, currency: string = 'USD', locale: string = 'en-US'): string => {
  try {
    const num = Number(amount);
    if (isNaN(num)) {
      console.warn('formatCurrency received non-numeric input:', amount);
      return new Intl.NumberFormat(locale, { style: 'currency', currency: currency }).format(0);
    }
    return new Intl.NumberFormat(locale, { style: 'currency', currency: currency }).format(num);
  } catch (e) {
    console.error('formatCurrency failed:', e);
    return '$0.00';
  }
};

export const formatReceiptDate = (date: Date = new Date(), includeTime: boolean = true): string => {
  const options: Intl.DateTimeFormatOptions = { year: 'numeric', month: '2-digit', day: '2-digit' };
  if (includeTime) { options.hour = '2-digit'; options.minute = '2-digit'; options.second = '2-digit'; }
  return date.toLocaleString('en-US', options);
};

export const validateEmail = (email: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

export const validateRoomNumber = (roomNumber: string): boolean => /^\d{3,4}$/.test(roomNumber);

export const validatePaymentAmount = (amount: number, minAmount: number = 0.01): boolean => amount >= minAmount && Number.isFinite(amount);

// ============================================================================
// AUDIT & MISC
// ============================================================================

export const generateTransactionId = (prefix: string = 'TXN'): string => `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

export const createAuditEntry = (action: string, entityType: string, entityId: string, userId: string, details?: any) => ({
  id: generateTransactionId('AUDIT'), action, entityType, entityId, userId, timestamp: new Date().toISOString(), details: details ? JSON.stringify(details) : null
});

import { getOutletReceiptSettings } from '../components/modules/ReceiptSettingsModal';

export const generateShiftXReadingHTML = (shiftMeta: any, transactions: any[], totals: any, settings?: any, outlet: any = 'default'): string => {
  const brandSettings = settings || (() => { try { return getOutletReceiptSettings(outlet); } catch { return { restaurant_name: 'Property' }; } })();
  const rows = transactions.map(tx => '<tr><td>' + new Date(tx.createdAt).toLocaleTimeString() + '</td><td>' + tx.method + '</td><td class="r">' + formatCurrency(tx.amount) + '</td></tr>').join('');
  
  return '<!DOCTYPE html><html><head><style>@page { size: 80mm auto; margin: 0; } body { font-family: "Courier New", monospace; font-size: 11px; width: 74mm; padding: 4mm; } .r { text-align: right; } .c { text-align: center; } .b { font-weight: bold; } table { width: 100%; border-collapse: collapse; } td, th { padding: 2px 0; }</style></head><body>' +
    '<div class="c b">' + brandSettings.restaurant_name + '</div><div class="c">SHIFT X-READING</div><div class="c" style="font-size:0.8em">' + new Date().toLocaleString() + '</div>' +
    '<hr/><div>Shift: ' + shiftMeta.id + '</div><div>Staff: ' + (shiftMeta.openedBy || 'N/A') + '</div><hr/>' +
    '<table><tr><td>Cash</td><td class="r">' + formatCurrency(totals.cash) + '</td></tr><tr><td>Card</td><td class="r">' + formatCurrency(totals.card) + '</td></tr><tr><td>Room</td><td class="r">' + formatCurrency(totals.roomCharge) + '</td></tr><tr class="b"><td>Total</td><td class="r">' + formatCurrency(totals.cash + totals.card + totals.roomCharge) + '</td></tr></table>' +
    '<hr/><b>Transactions</b><table>' + rows + '</table><hr/><div class="c" style="font-size:0.8em;margin-top:4mm">Powered By Coredigita</div><!-- ReceiptBrandingApplied --></body></html>';
};

export const generateCityLedgerReceiptHTML = (account: any, receiptNo: string, txns: any[], taxRate?: number): string => {
  const brand = (() => { try { return readReceiptBranding(); } catch { return { restaurant_name: 'Property' }; } })();
  const accountName = account.name || account.account_name || 'Unknown Account';
  const accountId = account.id || 'N/A';
  const rows = txns.map(t => '<tr><td>' + (t.date || '') + '</td><td>' + (t.description || '') + '</td><td class="r">' + formatCurrency(Number(t.debit || 0) - Number(t.credit || 0)) + '</td></tr>').join('');
  return '<!DOCTYPE html><html><head><style>body { font-family: Arial, sans-serif; font-size: 12px; padding: 20px; } .r { text-align: right; } .c { text-align: center; } .b { font-weight: bold; } table { width: 100%; border-collapse: collapse; margin-top: 10px; } td, th { border: 1px solid #ddd; padding: 8px; }</style></head><body>' +
    '<div class="c b" style="font-size:1.4em">' + brand.restaurant_name + '</div><div class="c">CITY LEDGER RECEIPT</div><hr/>' +
    '<div>Account: ' + accountName + ' (#' + accountId + ')</div><div>Receipt: ' + receiptNo + '</div><table><thead><tr><th>Date</th><th>Description</th><th class="r">Amount</th></tr></thead><tbody>' + rows + '</tbody></table>' +
    '<div class="c" style="margin-top:20px">Thank you!</div></body></html>';
};

export const sendReceiptEmail = (to: string, subject: string, body: string): void => {
  window.location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
};

export const logPaymentEvent = (event: any) => {
  try {
    const raw = localStorage.getItem('corepms_payment_logs');
    const list = raw ? JSON.parse(raw) : [];
    localStorage.setItem('corepms_payment_logs', JSON.stringify([{ ts: new Date().toISOString(), ...event }, ...list].slice(0, 1000)));
  } catch {}
};

export const processCardPayment = async (req: any): Promise<any> => {
  await new Promise(r => setTimeout(r, 500));
  return { status: 'approved', authCode: 'AUTH' + Math.random().toString(36).slice(2, 8).toUpperCase(), reference: generateTransactionId('PAY') };
};

export const updateEntity = (entities: any[], id: string, updates: any) => entities.map(e => e.id === id ? { ...e, ...updates } : e);
export const calculateBillTotal = (items: any[], rate: number = 0.15) => Number((items.reduce((s, i) => s + (i.subtotal || (i.quantity * i.price)), 0) * (1 + rate)).toFixed(2));

export default {
  validateRoomChargePayment, calculateTaxBreakdown, processPayment, generateReceiptHTML, printDocument,
  formatCurrency, formatReceiptDate, validateEmail, validateRoomNumber, validatePaymentAmount,
  generateTransactionId, createAuditEntry, generateShiftXReadingHTML, generateCityLedgerReceiptHTML,
  sendReceiptEmail, logPaymentEvent, processCardPayment, updateEntity, calculateBillTotal
};
