export type TemplateType = 'receipt' | 'bill' | 'statement';

export interface TemplateDesign {
  id: string;
  name: string;
  type: TemplateType;
  headerHTML: string; // may include inline branding placeholders
  footerHTML: string;
  showFields: {
    date: boolean;
    transactionId: boolean;
    items: boolean;
    totals: boolean;
    tax: boolean;
  };
  branding: {
    useGlobalBranding: boolean;
    logo_url?: string;
  };
}

export interface RenderData {
  date: string;
  transactionId: string;
  items: Array<{ description: string; quantity?: number; amount: number }>;
  subtotal: number;
  tax: number;
  total: number;
  // Optional personalized fields
  customerName?: string;
  accountNumber?: string;
  servicePeriod?: string;
}

const K_TEMPLATES = 'corepms_fo_templates';
const K_TYPE_MAP = 'corepms_fo_template_map';
const K_COUNTER = 'corepms_fo_counter';
const K_TPL_VERS = 'corepms_fo_template_versions';

const readJSON = <T>(key: string, fallback: T): T => { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; } };
const writeJSON = (key: string, value: any) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };

export const defaultTemplates: TemplateDesign[] = [
  {
    id: 'classic-receipt',
    name: 'Classic Receipt',
    type: 'receipt',
    headerHTML: '<div class="center bold">{{company_name}}</div>',
    footerHTML: '<div class="center text-xs">Thank you for your business</div>',
    showFields: { date: true, transactionId: true, items: true, totals: true, tax: true },
    branding: { useGlobalBranding: true },
  },
  {
    id: 'compact-bill',
    name: 'Compact Bill',
    type: 'bill',
    headerHTML: '<div class="center">{{company_name}}</div>',
    footerHTML: '<div class="center text-xs">Please settle within 24 hours</div>',
    showFields: { date: true, transactionId: true, items: true, totals: true, tax: false },
    branding: { useGlobalBranding: true },
  },
  {
    id: 'detailed-statement',
    name: 'Detailed Statement',
    type: 'statement',
    headerHTML: '<div class="center bold">{{company_name}} — Account Statement</div>',
    footerHTML: '<div class="center text-xs">Powered By Coredigita</div>',
    showFields: { date: true, transactionId: true, items: true, totals: true, tax: true },
    branding: { useGlobalBranding: true },
  },
];

export const listTemplates = (): TemplateDesign[] => {
  const saved = readJSON<TemplateDesign[]>(K_TEMPLATES, []);
  // ensure defaults present without duplicating
  const ids = new Set(saved.map(t => t.id));
  const merged = [...saved];
  defaultTemplates.forEach(d => { if (!ids.has(d.id)) merged.push(d); });
  return merged;
};

export const saveTemplate = (tpl: TemplateDesign) => {
  const list = listTemplates();
  const idx = list.findIndex(t => t.id === tpl.id);
  const next = [...list];
  if (idx >= 0) next[idx] = tpl; else next.push(tpl);
  writeJSON(K_TEMPLATES, next);
  try {
    const raw = readJSON<Record<string, Array<{ ts: string; value: TemplateDesign }>>>(K_TPL_VERS, {});
    const history = raw[tpl.id] || [];
    raw[tpl.id] = [{ ts: new Date().toISOString(), value: tpl }, ...history].slice(0, 50);
    writeJSON(K_TPL_VERS, raw);
  } catch {}
  return tpl;
};

export const deleteTemplate = (id: string) => {
  const list = listTemplates().filter(t => t.id !== id);
  writeJSON(K_TEMPLATES, list);
};

export const getTemplateById = (id?: string): TemplateDesign | undefined => listTemplates().find(t => t.id === id);

export const setTemplateForType = (type: TemplateType, templateId: string) => {
  const map = readJSON<Record<TemplateType, string>>(K_TYPE_MAP, { receipt: 'classic-receipt', bill: 'compact-bill', statement: 'detailed-statement' });
  map[type] = templateId;
  writeJSON(K_TYPE_MAP, map);
};

export const getTemplateForType = (type: TemplateType): TemplateDesign => {
  const map = readJSON<Record<TemplateType, string>>(K_TYPE_MAP, { receipt: 'classic-receipt', bill: 'compact-bill', statement: 'detailed-statement' });
  const tpl = getTemplateById(map[type]) || defaultTemplates.find(t => t.type === type) || defaultTemplates[0];
  return tpl!;
};

export const listTemplateVersions = (id: string): Array<{ ts: string; value: TemplateDesign }> => {
  const raw = readJSON<Record<string, Array<{ ts: string; value: TemplateDesign }>>>(K_TPL_VERS, {});
  return raw[id] || [];
};

export const rollbackTemplateVersion = (id: string, ts: string): TemplateDesign | null => {
  const versions = listTemplateVersions(id);
  const target = versions.find(v => v.ts === ts);
  if (!target) return null;
  const list = listTemplates();
  const idx = list.findIndex(t => t.id === id);
  const next = [...list];
  if (idx >= 0) next[idx] = target.value; else next.push(target.value);
  writeJSON(K_TEMPLATES, next);
  return target.value;
};

export const incrementCounter = (type: TemplateType): string => {
  const counters = readJSON<Record<string, number>>(K_COUNTER, {});
  counters[type] = (counters[type] || 0) + 1;
  writeJSON(K_COUNTER, counters);
  const prefix = type === 'receipt' ? 'RCPT' : type === 'bill' ? 'BILL' : 'STMT';
  return `${prefix}-${String(counters[type]).padStart(5, '0')}`;
};

import { readReceiptBranding } from './printSettings';

export const renderTemplateHTML = (tpl: TemplateDesign, data: RenderData): string => {
  const brand = readReceiptBranding();
  const company = brand.restaurant_name || 'Company';
  let header = tpl.headerHTML.replace(/\{\{company_name\}\}/g, company);
  // Replace optional metadata placeholders in header/footer if present
  header = header
    .replace(/\{\{customer_name\}\}/g, data.customerName || '')
    .replace(/\{\{account_number\}\}/g, data.accountNumber || '')
    .replace(/\{\{service_period\}\}/g, data.servicePeriod || '');
  const logo = (tpl.branding.useGlobalBranding && brand.show_logo && brand.logo_url) ? `<div class="center"><img src="${brand.logo_url}" alt="Logo" style="max-height:70px"/></div>` : '';

  const fields: string[] = [];
  if (tpl.showFields.date) fields.push(`<div><strong>Date:</strong> ${data.date}</div>`);
  if (tpl.showFields.transactionId) fields.push(`<div><strong>Transaction ID:</strong> ${data.transactionId}</div>`);
  if (data.customerName) fields.push(`<div><strong>Customer:</strong> ${data.customerName}</div>`);
  if (data.accountNumber) fields.push(`<div><strong>Account #:</strong> ${data.accountNumber}</div>`);
  if (data.servicePeriod) fields.push(`<div><strong>Service Period:</strong> ${data.servicePeriod}</div>`);

  const rows = tpl.showFields.items ? data.items.map(i => `<tr><td>${i.description}</td><td class="right">${Number(i.amount).toFixed(2)}</td></tr>`).join('') : '';
  const taxRow = tpl.showFields.tax ? `<tr><td class="bold">Tax</td><td class="right">${Number(data.tax).toFixed(2)}</td></tr>` : '';
  const totals = tpl.showFields.totals ? `
    <table style="width:100%">
      <tr><td class="bold">Subtotal</td><td class="right">${Number(data.subtotal).toFixed(2)}</td></tr>
      ${taxRow}
      <tr><td class="bold">Total</td><td class="right bold">${Number(data.total).toFixed(2)}</td></tr>
    </table>
  ` : '';

  return `
    <!DOCTYPE html><html><head><meta charset="utf-8" />
    <title>${tpl.name}</title>
    <style>
      body { font-family: Arial, sans-serif; font-size: 12px; color:#222; }
      .center { text-align: center; }
      .right { text-align: right; }
      .bold { font-weight: bold; }
      table { width: 100%; border-collapse: collapse; }
      th, td { border: 1px solid #ddd; padding: 6px; }
      th { background: #f5f5f5; text-align: left; }
      .section { margin-top: 10px; }
      .header { border-bottom: 2px solid #000; padding-bottom:8px; margin-bottom:10px; }
    </style></head><body>
      <div class="header">${logo}<div class="center">${header}</div></div>
      <div class="section">${fields.join('')}</div>
      ${tpl.showFields.items ? `<div class="section"><table><thead><tr><th>Description</th><th class="right">Amount</th></tr></thead><tbody>${rows}</tbody></table></div>` : ''}
      <div class="section">${totals}</div>
      <div class="section">${tpl.footerHTML}</div>
      <!-- ReceiptBrandingApplied -->
    </body></html>
  `;
};
