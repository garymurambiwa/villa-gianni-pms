// Web Worker for X/Z aggregation
export type XZRequest = {
  items: any[];
  auditLog: any[];
  range: { start: string; end: string };
};

export type XZResponse = {
  categorySummary: { rows: Array<{ name: string; itemsSold: number; grossSales: number; discounts: number; netSales: number; percent: number }>; totalGross: number };
  detailedRowsByCategory: Record<string, Array<{ ts: string; sku: string; desc: string; qty: number; unit: number; total: number }>>;
};

const readJSONSafe = (s: any) => {
  if (Array.isArray(s)) return s;
  try { return JSON.parse(s || '[]'); } catch { return []; }
};

const inRange = (ts: string, startISO: string, endISO: string) => {
  const start = new Date(startISO + 'T00:00:00');
  const end = new Date(endISO + 'T23:59:59');
  const dt = new Date(ts);
  return dt >= start && dt <= end;
};

self.onmessage = (ev: MessageEvent<XZRequest>) => {
  const { items, auditLog, range } = ev.data;
  const itemIdx = new Map<string, any>();
  items.forEach((it: any) => itemIdx.set(String(it.name || '').toLowerCase(), it));

  const depletions = auditLog.filter((a: any) => a.action === 'INVENTORY_DEPLETION' && inRange(a.timestamp, range.start, range.end));

  const categoryMap = new Map<string, { itemsSold: number; grossSales: number; discounts: number; netSales: number }>();
  const detailMap = new Map<string, Array<{ ts: string; sku: string; desc: string; qty: number; unit: number; total: number }>>();

  depletions.forEach((e: any) => {
    const details = readJSONSafe(e.details);
    const ts = e.timestamp;
    details.forEach((d: any) => {
      const nameKey = String(d.name || '').toLowerCase();
      const it = itemIdx.get(nameKey);
      const sku = String(it?.id || it?.name || d.name || '');
      const catId = String(it?.category_id || '') || 'UNCATEGORIZED';
      const catName = catId; // Return catId; client can map to name if needed
      const qty = Number(d.quantity || 0);
      const unit = Number(it?.sellingPrice || 0);
      const total = qty * unit;
      const desc = String(it?.name || d.name || '');

      const agg = categoryMap.get(catName) || { itemsSold: 0, grossSales: 0, discounts: 0, netSales: 0 };
      agg.itemsSold += qty;
      agg.grossSales += total;
      agg.netSales = agg.grossSales - agg.discounts;
      categoryMap.set(catName, agg);

      const arr = detailMap.get(catName) || [];
      arr.push({ ts, sku, desc, qty, unit, total });
      detailMap.set(catName, arr);
    });
  });

  // finalize
  const totalGross = Array.from(categoryMap.values()).reduce((s, r) => s + r.grossSales, 0);
  const rows = Array.from(categoryMap.entries()).map(([name, r]) => ({ name, ...r, percent: totalGross ? (r.grossSales / totalGross) * 100 : 0 }));
  rows.sort((a,b)=> b.grossSales - a.grossSales);

  const detailedObj: Record<string, Array<{ ts: string; sku: string; desc: string; qty: number; unit: number; total: number }>> = {};
  detailMap.forEach((arr, key) => { detailedObj[key] = arr.sort((a,b)=> new Date(a.ts).getTime() - new Date(b.ts).getTime()); });

  const resp: XZResponse = { categorySummary: { rows, totalGross }, detailedRowsByCategory: detailedObj };
  (self as any).postMessage(resp);
};

export {}; // ensure module scope
