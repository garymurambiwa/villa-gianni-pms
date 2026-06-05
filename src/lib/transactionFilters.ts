/**
 * transactionFilters – shared filtering + printing for every transaction-list
 * module (Inventory GRN, Items, Expenses, Bulk Expenses, Sales, Batch
 * Requisitions, …).
 *
 * Goal: ONE source of truth so the date / category / department / status
 * filters and the Print behaviour look and behave identically everywhere.
 *
 * Rules (from the brief):
 *  • If the date filter is not selected, ALL transactions show.
 *  • Filters compose (date AND category AND department AND status AND search).
 *  • Print prints whatever is currently on screen — i.e. print-all when no
 *    filter is active, print-filtered when a period / category is selected.
 */

export interface TransactionFilterValue {
  search: string;
  from: string;       // 'yyyy-mm-dd' or '' (no lower bound)
  to: string;         // 'yyyy-mm-dd' or '' (no upper bound)
  category: string;   // 'all' or a category value
  department: string; // 'all' or a department value
  status: string;     // 'all' or a status value
}

/** A fresh, unfiltered value. Selects use 'all' (Radix forbids empty string). */
export const EMPTY_TRANSACTION_FILTER: TransactionFilterValue = {
  search: '',
  from: '',
  to: '',
  category: 'all',
  department: 'all',
  status: 'all',
};

/** Normalise any date-ish value to a local 'yyyy-mm-dd'. '' when unparseable. */
export function toYMD(v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'string') {
    const m = v.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
  }
  const dt = new Date(v as string | number | Date);
  if (isNaN(dt.getTime())) return '';
  const y = dt.getFullYear();
  const mo = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

/** True when any filter would narrow the list. */
export function isFilterActive(f: TransactionFilterValue): boolean {
  return !!(
    (f.search && f.search.trim()) ||
    f.from ||
    f.to ||
    (f.category && f.category !== 'all') ||
    (f.department && f.department !== 'all') ||
    (f.status && f.status !== 'all')
  );
}

export interface FilterAccessors<T> {
  /** Row date (ISO string, Date, or yyyy-mm-dd). */
  date?: (row: T) => unknown;
  /** Fields the free-text search should match against. */
  search?: (row: T) => Array<string | number | null | undefined>;
  category?: (row: T) => string | null | undefined;
  department?: (row: T) => string | null | undefined;
  status?: (row: T) => string | null | undefined;
}

/**
 * Apply the shared filters to a list. Accessors tell us how to read each field
 * from this module's row shape, so the same logic works for any data.
 *
 * An unparseable / missing row date is KEPT (never silently hidden) so a bad
 * timestamp can't make records vanish.
 */
export function filterRows<T>(
  rows: T[],
  f: TransactionFilterValue,
  get: FilterAccessors<T>,
): T[] {
  if (!Array.isArray(rows)) return [];
  const q = (f.search || '').trim().toLowerCase();

  return rows.filter((row) => {
    // Date range — skipped entirely when neither bound is set.
    if ((f.from || f.to) && get.date) {
      const d = toYMD(get.date(row));
      if (d) {
        if (f.from && d < f.from) return false;
        if (f.to && d > f.to) return false;
      }
    }

    if (f.category && f.category !== 'all' && get.category) {
      if (String(get.category(row) ?? '') !== f.category) return false;
    }

    if (f.department && f.department !== 'all' && get.department) {
      if (String(get.department(row) ?? '') !== f.department) return false;
    }

    if (f.status && f.status !== 'all' && get.status) {
      if (String(get.status(row) ?? '').toLowerCase() !== f.status.toLowerCase()) return false;
    }

    if (q && get.search) {
      const hay = get.search(row).map((x) => String(x ?? '').toLowerCase());
      if (!hay.some((h) => h.includes(q))) return false;
    }

    return true;
  });
}

/* -------------------------------------------------------------------------- */
/*  Printing                                                                  */
/* -------------------------------------------------------------------------- */

export interface PrintColumn<T = unknown> {
  header: string;
  value: (row: T, index: number) => string | number;
  align?: 'left' | 'right' | 'center';
}

export interface PrintOptions<T = unknown> {
  title: string;                 // e.g. "Goods Received Notes"
  subtitle?: string;             // e.g. property / outlet name
  meta?: string;                 // any extra line under the title
  filters?: TransactionFilterValue;
  columns: PrintColumn<T>[];
  rows: T[];
  footer?: Array<{ label: string; value: string | number }>; // totals row(s)
}

function escapeHtml(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}

/** Human-readable summary of the active filters, for the print header. */
export function describeFilters(f?: TransactionFilterValue): string {
  if (!f) return 'All transactions';
  const parts: string[] = [];
  if (f.from || f.to) parts.push(`Period: ${f.from || 'start'} to ${f.to || 'today'}`);
  if (f.category && f.category !== 'all') parts.push(`Category: ${f.category}`);
  if (f.department && f.department !== 'all') parts.push(`Department: ${f.department}`);
  if (f.status && f.status !== 'all') parts.push(`Status: ${f.status}`);
  if (f.search && f.search.trim()) parts.push(`Search: "${f.search.trim()}"`);
  return parts.length ? parts.join('   •   ') : 'All transactions (no filter)';
}

/**
 * Open a clean, print-only window for the supplied rows. Reflects the active
 * filters in the header so a printed "filtered" report is self-describing.
 */
export function printTransactionList<T = unknown>(opts: PrintOptions<T>): void {
  const { title, subtitle, meta, filters, columns, rows, footer } = opts;
  const stamp = new Date().toLocaleString();

  const head = columns
    .map((c) => `<th style="text-align:${c.align || 'left'}">${escapeHtml(c.header)}</th>`)
    .join('');

  const body = rows.length === 0
    ? `<tr><td colspan="${columns.length}" style="text-align:center;padding:24px;color:#888">No transactions match the current filter.</td></tr>`
    : rows
        .map((r, i) => `<tr>${columns
          .map((c) => `<td style="text-align:${c.align || 'left'}">${escapeHtml(c.value(r, i))}</td>`)
          .join('')}</tr>`)
        .join('');

  const foot = footer && footer.length
    ? `<div class="totals">${footer
        .map((t) => `<div><span>${escapeHtml(t.label)}:</span><strong>${escapeHtml(t.value)}</strong></div>`)
        .join('')}</div>`
    : '';

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
  <style>
    *{box-sizing:border-box} body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:24px;font-size:12px}
    h1{font-size:18px;margin:0 0 2px} .sub{color:#555;font-size:12px;margin:0 0 2px}
    .filters{background:#f4f4f5;border:1px solid #e4e4e7;border-radius:6px;padding:6px 10px;margin:10px 0;font-size:11px;color:#333}
    table{width:100%;border-collapse:collapse;margin-top:6px}
    th,td{border-bottom:1px solid #e5e7eb;padding:6px 8px;vertical-align:top}
    th{background:#f9fafb;font-size:10px;text-transform:uppercase;letter-spacing:.03em;color:#555}
    tr:nth-child(even) td{background:#fcfcfd}
    .totals{display:flex;gap:24px;justify-content:flex-end;margin-top:12px;font-size:13px;border-top:2px solid #111;padding-top:8px}
    .totals div{display:flex;gap:8px} .meta{color:#777;font-size:10px;margin-top:18px}
    @media print{ body{margin:8mm} }
  </style></head><body>
    <h1>${escapeHtml(title)}</h1>
    ${subtitle ? `<p class="sub">${escapeHtml(subtitle)}</p>` : ''}
    ${meta ? `<p class="sub">${escapeHtml(meta)}</p>` : ''}
    <div class="filters">${escapeHtml(describeFilters(filters))} &nbsp;|&nbsp; ${rows.length} record${rows.length === 1 ? '' : 's'}</div>
    <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
    ${foot}
    <p class="meta">Generated ${escapeHtml(stamp)}</p>
    <script>window.onload=function(){setTimeout(function(){window.print();},150);};</script>
  </body></html>`;

  const w = window.open('', '_blank', 'width=960,height=720');
  if (!w) {
    // Pop-up blocked — surface a friendly message instead of failing silently.
    alert('Please allow pop-ups for this site to print the transaction list.');
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
}
