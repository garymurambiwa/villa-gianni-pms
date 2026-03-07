export type PaperSize = 'A4' | 'Letter' | 'Legal';
export type Orientation = 'portrait' | 'landscape';
export type PrintQuality = 'draft' | 'normal' | 'high';

export interface PrintSettings {
  margins: { top: number; right: number; bottom: number; left: number };
  paperSize: PaperSize;
  orientation: Orientation;
  headerText: string;
  footerText: string;
  quality: PrintQuality;
}

const KEY = 'corepms_print_settings';

export const defaultPrintSettings: PrintSettings = {
  margins: { top: 10, right: 10, bottom: 12, left: 10 },
  paperSize: 'A4',
  orientation: 'portrait',
  headerText: '',
  footerText: '',
  quality: 'normal',
};

export const readPrintSettings = (): PrintSettings => {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultPrintSettings;
    const obj = JSON.parse(raw);
    return {
      ...defaultPrintSettings,
      ...obj,
      margins: { ...defaultPrintSettings.margins, ...(obj?.margins || {}) },
    };
  } catch {
    return defaultPrintSettings;
  }
};

export const writePrintSettings = (settings: Partial<PrintSettings>): PrintSettings => {
  const next = { ...readPrintSettings(), ...settings, margins: { ...readPrintSettings().margins, ...(settings.margins || {}) } };
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { }
  return next;
};

export type ReceiptBranding = {
  restaurant_name: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  logo_url?: string;
  show_logo?: boolean;
  tax_rate?: number;
  paper_size?: '58mm' | '80mm';
  header_text?: string;
  footer_text?: string;
  promotional_message?: string;
};

const K_RECEIPT = 'corepms_receipt_settings';
const K_RECEIPT_VERS = 'corepms_receipt_settings_versions';

let __brandCache: { value: ReceiptBranding; version: number } | null = null;
let __brandListeners: Array<(b: ReceiptBranding) => void> = [];
let __htmlChromeCache: { key: string; headerBrand: string; headerUser: string; footerUser: string; poweredBy: string } | null = null;

export const readReceiptBranding = (): ReceiptBranding => {
  if (__brandCache) return __brandCache.value;

  const defaults: ReceiptBranding = {
    restaurant_name: import.meta.env.VITE_HOTEL_NAME || 'Company Name',
    address: import.meta.env.VITE_HOTEL_ADDRESS || '',
    phone: import.meta.env.VITE_HOTEL_PHONE || '',
    logo_url: import.meta.env.VITE_HOTEL_LOGO_URL || '/logo.png',
    show_logo: true,
    footer_text: import.meta.env.VITE_HOTEL_RECEIPT_FOOTER || '',
    tax_rate: 14.5,
    paper_size: '80mm'
  };

  try {
    const raw = localStorage.getItem(K_RECEIPT);
    const value = raw ? JSON.parse(raw) : null;

    // Use defaults if nothing stored, or if stored name is generic placeholders
    if (!value || !value.restaurant_name || value.restaurant_name === 'POS' || value.restaurant_name === 'Company Name') {
      const merged = { ...defaults, ...value, restaurant_name: defaults.restaurant_name }; // valid merge
      __brandCache = { value: merged, version: Date.now() };
      return merged;
    }

    __brandCache = { value, version: Date.now() };
    return value;
  } catch {
    __brandCache = { value: defaults, version: Date.now() };
    return defaults;
  }
};

export const validateReceiptBranding = (b: Partial<ReceiptBranding>, requireName: boolean = false): { ok: boolean; errors?: Record<string, string> } => {
  const errors: Record<string, string> = {};

  // Validate restaurant_name - required if explicitly set or if requireName is true
  const name = b.restaurant_name;
  if (requireName && (!name || String(name).trim().length === 0)) {
    errors.restaurant_name = 'Company name is required';
  } else if (name !== undefined && String(name).trim().length === 0) {
    errors.restaurant_name = 'Company name cannot be empty';
  }

  // Validate tax_rate
  if (b.tax_rate !== undefined) {
    const rate = Number(b.tax_rate);
    if (isNaN(rate) || rate < 0 || rate > 100) {
      errors.tax_rate = 'Tax rate must be between 0 and 100';
    }
  }

  // Validate logo_url - allow empty, http(s) URLs, and base64 data URLs
  if (b.logo_url !== undefined) {
    const u = String(b.logo_url || '').trim();
    if (u && !/^(https?:\/\/|data:image\/)/i.test(u)) {
      errors.logo_url = 'Logo must be a valid URL or uploaded image';
    }
  }

  // Validate email format if provided
  if (b.email !== undefined) {
    const email = String(b.email || '').trim();
    if (email && !/.+@.+\..+/.test(email)) {
      errors.email = 'Invalid email format';
    }
  }

  // Validate website URL if provided
  if (b.website !== undefined) {
    const url = String(b.website || '').trim();
    if (url && !/^https?:\/\//i.test(url)) {
      errors.website = 'Website must start with http:// or https://';
    }
  }

  // Validate phone format if provided (basic check)
  if (b.phone !== undefined) {
    const phone = String(b.phone || '').trim();
    if (phone && !/^[+\d][\d\s()\-]{5,}$/.test(phone)) {
      errors.phone = 'Invalid phone number format';
    }
  }

  return { ok: Object.keys(errors).length === 0, errors: Object.keys(errors).length ? errors : undefined };
};

export const writeReceiptBranding = (patch: Partial<ReceiptBranding>): ReceiptBranding => {
  const current = readReceiptBranding();
  const next: ReceiptBranding = { ...current, ...patch };

  // Validate the merged result, requiring restaurant_name for the final object
  const val = validateReceiptBranding(next, true);
  if (!val.ok) {
    const errorMessages = val.errors ? Object.values(val.errors).join('; ') : 'Invalid settings';
    throw new Error(`Failed to save settings: ${errorMessages}`);
  }

  try {
    const raw = localStorage.getItem(K_RECEIPT_VERS);
    const hist = raw ? JSON.parse(raw) as Array<{ ts: string; value: ReceiptBranding }> : [];
    hist.unshift({ ts: new Date().toISOString(), value: current });
    localStorage.setItem(K_RECEIPT_VERS, JSON.stringify(hist.slice(0, 50)));
    localStorage.setItem(K_RECEIPT, JSON.stringify(next));
  } catch (e) {
    console.error('Failed to save to localStorage:', e);
    throw new Error('Failed to save settings to storage');
  }

  __brandCache = { value: next, version: Date.now() };
  try { __brandListeners.forEach(fn => { try { fn(next); } catch { } }); } catch { }
  return next;
};

export const subscribeReceiptBranding = (fn: (b: ReceiptBranding) => void) => {
  __brandListeners.push(fn);
  return () => { __brandListeners = __brandListeners.filter(x => x !== fn); };
};

export const listReceiptBrandingVersions = (): Array<{ ts: string; value: ReceiptBranding }> => {
  try { const raw = localStorage.getItem(K_RECEIPT_VERS); return raw ? JSON.parse(raw) : []; } catch { return []; }
};

export const rollbackReceiptBranding = (ts: string): ReceiptBranding | null => {
  try {
    const versions = listReceiptBrandingVersions();
    const target = versions.find(v => v.ts === ts);
    if (!target) return null;
    localStorage.setItem(K_RECEIPT, JSON.stringify(target.value));
    __brandCache = { value: target.value, version: Date.now() };
    __brandListeners.forEach(fn => { try { fn(target.value); } catch { } });
    return target.value;
  } catch { return null; }
};

export const applySettingsToHTML = (title: string, bodyHTML: string): string => {
  const s = readPrintSettings();
  const mm = (px: number) => `${px}mm`;
  const sizeMap: Record<PaperSize, string> = { A4: '210mm 297mm', Letter: '8.5in 11in', Legal: '8.5in 14in' };
  const brand = readReceiptBranding();
  const brandVersion = (__brandCache && __brandCache.version) || Date.now();
  const cacheKey = `${brandVersion}:${s.headerText}:${s.footerText}`;
  if (!__htmlChromeCache || __htmlChromeCache.key !== cacheKey) {
    const headerBrand = `${brand.show_logo && brand.logo_url ? `<div style=\"text-align:center\"><img src=\"${brand.logo_url}\" alt=\"Logo\" style=\"max-width:120px\"/></div>` : ''}<div style=\"text-align:center;font-weight:bold;color:#0073e6\">${brand.restaurant_name}</div>`;
    const headerUser = s.headerText ? `<div style=\"text-align:center\">${s.headerText}</div>` : '';
    const footerUser = s.footerText ? `<div style=\"text-align:center\">${s.footerText}</div>` : '';
    const poweredBy = `<div style=\"text-align:center;margin-top:8px;font-size:10px;color:#555\">Powered By Coredigita</div>`;
    __htmlChromeCache = { key: cacheKey, headerBrand, headerUser, footerUser, poweredBy };
  }
  const alreadyBranded = bodyHTML.includes('<!-- ReceiptBrandingApplied -->');
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>${title}</title>
      <style>
        :root { --brand-color: #0073e6; }
        @media print {
          @page { size: ${sizeMap[s.paperSize]}; margin: ${mm(s.margins.top)} ${mm(s.margins.right)} ${mm(s.margins.bottom)} ${mm(s.margins.left)}; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          /* Ensure preview container is fully visible in print */
          .preview { display: block !important; visibility: visible !important; opacity: 1 !important; }
          /* Hide non-print UI if any */
          .no-print { display: none !important; }
          table.report, table.stmt { width: 100%; border-collapse: collapse; }
          table.report th, table.report td, table.stmt th, table.stmt td { padding: 4px; }
          table.report thead th, table.stmt thead th { border-bottom: 1px solid var(--brand-color); }
        }
        @media screen {
          .preview { background: white; }
        }
        body { font-family: system-ui, sans-serif; }
        .preview { max-width: 900px; margin: 0 auto; }
        .brand { color: var(--brand-color); }
      </style>
    </head>
    <body>
      <div class=\"preview\">
        ${alreadyBranded ? '' : __htmlChromeCache!.headerBrand}
        ${alreadyBranded ? '' : __htmlChromeCache!.headerUser}
        ${bodyHTML}
        ${alreadyBranded ? '' : __htmlChromeCache!.footerUser}
        ${alreadyBranded ? '' : __htmlChromeCache!.poweredBy}
      </div>
      <script>try { if ('${s.orientation}'==='landscape') { const css = document.createElement('style'); css.innerHTML = '@page { size: landscape; }'; document.head.appendChild(css);} } catch(e) {}</script>
    </body>
    </html>
  `;
};
