import { readReceiptBranding } from '@/lib/printSettings';

export interface ReportColumn {
  header: string;
  /** key into the row object, or a function returning the cell value */
  key: string | ((row: any) => string | number);
  align?: 'left' | 'right' | 'center';
}

/**
 * Print any tabular report with the CURRENT property's branding.
 *
 * Branding (name / logo / address / phone) is read from readReceiptBranding(),
 * which on startup is hydrated from the per-property `system_configs` rows in
 * the DB. This is why a printed report on Baradzanwa shows Baradzanwa's header
 * and a printed report on Villa Gianni shows Villa Gianni's — there is no
 * hardcoded company name anywhere in this path.
 */
export function printReportHtml(opts: {
  title: string;
  subtitle?: string;
  columns: ReportColumn[];
  rows: any[];
  /** optional summary lines rendered under the table, e.g. ['Total Value: $123.45'] */
  summary?: string[];
  /** extra meta line, e.g. 'Location: Main Cellar' */
  meta?: string;
}) {
  const brand = readReceiptBranding();
  const company = brand.restaurant_name || 'Company';
  const logo = brand.show_logo && brand.logo_url ? brand.logo_url : '';
  const addr = [brand.address, brand.phone].filter(Boolean).join(' · ');

  const cell = (row: any, col: ReportColumn) => {
    const v = typeof col.key === 'function' ? col.key(row) : row[col.key];
    return v == null ? '' : String(v);
  };

  const thead = opts.columns
    .map(c => `<th style="text-align:${c.align || 'left'}">${c.header}</th>`)
    .join('');

  const tbody = opts.rows
    .map(
      r =>
        `<tr>${opts.columns
          .map(c => `<td style="text-align:${c.align || 'left'}">${cell(r, c)}</td>`)
          .join('')}</tr>`
    )
    .join('');

  const summaryHtml = (opts.summary || [])
    .map(s => `<div class="summary-line">${s}</div>`)
    .join('');

  const html = `<!doctype html><html><head><meta charset="utf-8"/>
<title>${opts.title}</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; color:#1f2937; padding:24px; }
  .head { text-align:center; border-bottom:2px solid #0073e6; padding-bottom:12px; margin-bottom:16px; }
  .logo { max-height:64px; margin-bottom:6px; }
  .company { font-size:22px; font-weight:bold; color:#0073e6; }
  .addr { font-size:11px; color:#6b7280; }
  h1 { font-size:18px; margin:4px 0; }
  .sub { font-size:12px; color:#6b7280; margin-bottom:8px; }
  .meta { font-size:12px; color:#374151; margin-bottom:8px; }
  table { width:100%; border-collapse:collapse; margin-top:8px; }
  th,td { border:1px solid #e5e7eb; padding:6px 8px; font-size:12px; }
  th { background:#f9fafb; }
  .summary { margin-top:16px; }
  .summary-line { font-size:13px; font-weight:600; text-align:right; }
  .foot { margin-top:24px; text-align:center; font-size:10px; color:#9ca3af; border-top:1px solid #e5e7eb; padding-top:10px; }
</style></head><body>
  <div class="head">
    ${logo ? `<img src="${logo}" class="logo"/><br/>` : ''}
    <div class="company">${company}</div>
    ${addr ? `<div class="addr">${addr}</div>` : ''}
  </div>
  <h1>${opts.title}</h1>
  ${opts.subtitle ? `<div class="sub">${opts.subtitle}</div>` : ''}
  ${opts.meta ? `<div class="meta">${opts.meta}</div>` : ''}
  <table><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table>
  <div class="summary">${summaryHtml}</div>
  <div class="foot">${company} · Generated ${new Date().toLocaleString()}</div>
  <script>window.onload=function(){window.print();}</script>
</body></html>`;

  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(html);
  w.document.close();
  w.focus();
}
