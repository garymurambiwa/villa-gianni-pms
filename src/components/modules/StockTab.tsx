import React from 'react';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { canEditStockItem, canFixStockItem, canDeleteStockItem } from '@/lib/permissions';

type StockItem = any;

interface StockTabProps {
  items?: StockItem[];
  userRole?: string | null;
  onEditItem?: (item: StockItem) => void;
  onFixItem?: (item: StockItem) => void;
  onDeleteItem?: (id: string) => void;
  // Optional bulk callbacks; if not provided, component applies updates locally
  onBulkDelete?: (ids: string[]) => void;
  onBulkSetVisibility?: (ids: string[], updates: { bar?: boolean; restaurant?: boolean }) => void;
}

/**
 * StockTab: Dedicated tab component for stock listing with search, filters, pagination, and accessibility.
 * - Persists view state in localStorage (search, filters, page, pageSize)
 * - Provides loading indicator during filter changes
 * - ARIA-friendly table with keyboard focus on rows
 */
const LS_KEY = 'corepms_pos_stocktab_state';

export const StockTab: React.FC<StockTabProps> = ({ items, userRole, onEditItem, onFixItem, onDeleteItem }) => {
  const [allItems, setAllItems] = React.useState<StockItem[]>(() => {
    if (Array.isArray(items)) return items;
    try { const raw = localStorage.getItem('corepms_pos_items'); return raw ? JSON.parse(raw) : []; } catch { return []; }
  });

  // Sync state when props change
  React.useEffect(() => {
    if (Array.isArray(items)) setAllItems(items);
  }, [items]);
  const [search, setSearch] = React.useState<string>('');
  const [center, setCenter] = React.useState<'all' | 'bar' | 'restaurant'>('all');
  const [attentionOnly, setAttentionOnly] = React.useState<boolean>(false);
  const [severity, setSeverity] = React.useState<'all' | 'low' | 'medium' | 'high'>('all');
  const [page, setPage] = React.useState<number>(1);
  const [pageSize, setPageSize] = React.useState<number>(25);
  const [loading, setLoading] = React.useState<boolean>(false);
  const [virtualize, setVirtualize] = React.useState<boolean>(true);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = React.useState<number>(0);
  const [viewportHeight, setViewportHeight] = React.useState<number>(480);
  const rowHeight = 44; // px per row (approx)
  const overscan = 8;

  // Cache filtered sets in-memory for snappier transitions
  const cacheRef = React.useRef<Map<string, StockItem[]>>(new Map());

  // ── Live stock balances from inventory-v11 (keyed by item name lowercased) ──
  // Polled every 30s so users can see incoming GRNs / depletion without a page refresh.
  const [stockMap, setStockMap] = React.useState<Record<string, number>>({});
  React.useEffect(() => {
    let cancelled = false;
    const fetchBalances = async () => {
      try {
        const res = await fetch('/api/v1/inventory/balances').then(r => r.json());
        if (cancelled) return;
        if (res?.ok && Array.isArray(res.data)) {
          const map: Record<string, number> = {};
          for (const row of res.data) {
            const key = String(row.name || row.item_name || '').toLowerCase().trim();
            if (key) map[key] = Number(row.current_balance || 0);
          }
          setStockMap(map);
        }
      } catch { /* non-fatal — leave map empty, column shows — */ }
    };
    fetchBalances();
    const t = setInterval(fetchBalances, 30000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  const getStockQty = (it: any): number | null => {
    const key = String(it.name || '').toLowerCase().trim();
    if (!key) return null;
    if (key in stockMap) return stockMap[key];
    // Fallback: item may carry its own qty field
    const inline = it.current_balance ?? it.stock_qty ?? it.quantity_on_hand;
    return inline != null ? Number(inline) : null;
  };

  // Restore persisted state
  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (s.search) setSearch(s.search);
      if (['all', 'bar', 'restaurant'].includes(s.center)) setCenter(s.center);
      if (typeof s.attentionOnly === 'boolean') setAttentionOnly(s.attentionOnly);
      if (['all', 'low', 'medium', 'high'].includes(s.severity)) setSeverity(s.severity);
      if (Number.isFinite(s.page)) setPage(s.page);
      if (Number.isFinite(s.pageSize)) setPageSize(s.pageSize);
    } catch { }
  }, []);

  // Persist state on changes
  React.useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ search, center, attentionOnly, severity, page, pageSize })); } catch { }
  }, [search, center, attentionOnly, severity, page, pageSize]);

  // Manage loading indicator on filter changes
  React.useEffect(() => {
    setLoading(true);
    const t = setTimeout(() => setLoading(false), 80);
    return () => clearTimeout(t);
  }, [allItems, search, center, attentionOnly, severity]);

  // Filtered items (with caching)
  const filtered = React.useMemo(() => {
    const nameMatch = (it: any) => !search.trim() || String(it.name || '').toLowerCase().includes(search.trim().toLowerCase());
    const centerMatch = (it: any) => center === 'all' || String(it.costCenter || '').toLowerCase() === center;
    const issues = (it: any) => {
      const arr: string[] = [];
      if (!it.category_id) arr.push('Missing category');
      if (Number(it.sellingPrice || 0) <= 0) arr.push('Zero price');
      return arr;
    };
    const severityFor = (it: any) => {
      const cnt = issues(it).length;
      return cnt === 0 ? 'low' : (cnt === 1 ? 'medium' : 'high');
    };
    const attentionMatch = (it: any) => !attentionOnly || issues(it).length > 0;
    const severityMatch = (it: any) => severity === 'all' || severityFor(it) === severity;
    const key = JSON.stringify({ search, center, attentionOnly, severity });
    const cached = cacheRef.current.get(key);
    if (cached) return cached;
    const result = allItems.filter(it => nameMatch(it) && centerMatch(it) && attentionMatch(it) && severityMatch(it));
    cacheRef.current.set(key, result);
    // Limit cache size
    if (cacheRef.current.size > 12) {
      const firstKey = cacheRef.current.keys().next().value as string | undefined;
      if (firstKey) cacheRef.current.delete(firstKey);
    }
    return result;
  }, [allItems, search, center, attentionOnly, severity]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  React.useEffect(() => { if (page > totalPages) setPage(totalPages); }, [totalPages, page]);
  const pageItems = React.useMemo(() => filtered.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize), [filtered, page, pageSize]);

  // Virtualization calculations
  React.useEffect(() => {
    const el = listRef.current; if (!el) return;
    const resize = () => setViewportHeight(el.clientHeight || 480);
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const endIndex = Math.min(filtered.length, Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan);
  const visibleItems = virtualize ? filtered.slice(startIndex, endIndex) : pageItems;
  const topPad = virtualize ? startIndex * rowHeight : 0;
  const bottomPad = virtualize ? Math.max(0, (filtered.length - endIndex) * rowHeight) : 0;

  const canEdit = canEditStockItem(userRole || undefined);
  const canFix = canFixStockItem(userRole || undefined);
  const canDelete = canDeleteStockItem(userRole || undefined);

  return (
    <div className="space-y-3" aria-labelledby="stock-tab-title">
      <div id="stock-tab-title" className="ds-subheader">Stock List</div>
      <div className="ds-toolbar" role="toolbar" aria-label="Stock filters">
        <div className="flex flex-wrap gap-2 w-full">
          <Input aria-label="Search by name" placeholder="Search name" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="ds-input-compact w-full sm:w-48" />
          <Select value={center} onValueChange={(v) => { setCenter(v as any); setPage(1); }}>
            <SelectTrigger className="ds-select-compact w-full sm:w-36"><SelectValue placeholder="Center" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="bar">Bar</SelectItem>
              <SelectItem value="restaurant">Restaurant</SelectItem>
            </SelectContent>
          </Select>
          <Select value={severity} onValueChange={(v) => { setSeverity(v as any); setPage(1); }}>
            <SelectTrigger className="ds-select-compact w-full sm:w-40"><SelectValue placeholder="Severity" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All severity</SelectItem>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="high">High</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center gap-4 w-full sm:w-auto">
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" aria-label="Attention only" checked={attentionOnly} onChange={(e) => { setAttentionOnly(e.target.checked); setPage(1); }} />
              Attention
            </label>
            <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}>
              <SelectTrigger className="ds-select-compact w-24"><SelectValue placeholder="Page size" /></SelectTrigger>
              <SelectContent>
                {[25, 50, 100].map(n => (<SelectItem key={n} value={String(n)}>{n}/page</SelectItem>))}
              </SelectContent>
            </Select>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={virtualize} onChange={(e) => setVirtualize(e.target.checked)} aria-label="Enable virtualization" />
              Virtualize
            </label>
          </div>
        </div>
      </div>

      {/* Bulk actions */}
      <div className="ds-toolbar text-xs overflow-x-auto pb-1 flex flex-wrap gap-1">
        <Button variant="outline" className="ds-button-compact" onClick={() => {
          const ids = Array.from(selectedIds);
          if (!ids.length) return;
          if (confirm(`Are you sure you want to delete ${ids.length} item(s)? This cannot be undone.`)) {
            if (onBulkDelete) {
              onBulkDelete(ids);
            } else {
              ids.forEach(id => onDeleteItem?.(id));
            }
            setSelectedIds(new Set());
            setAllItems(prev => prev.filter((it: any) => !ids.includes(it.id)));
          }
        }}>Delete Selected</Button>

        {/* Bar visibility controls */}
        <Button variant="outline" className="ds-button-compact" onClick={() => {
          const ids = Array.from(selectedIds); if (!ids.length) return;
          const updates = { bar: true };
          const next = allItems.map((it: any) => ids.includes(it.id)
            ? { ...it, visibility: { ...(it.visibility || {}), bar: true }, bar_visibility: true }
            : it);
          setAllItems(next);
          if (onBulkSetVisibility) onBulkSetVisibility(ids, updates);
          else {
            // Persist locally and to DB via dbSync
            import('@/lib/dbSync').then(({ fixItemVisibility }) => {
              ids.forEach(id => {
                const item = allItems.find((it: any) => it.id === id);
                if (item) {
                  const vis = { bar: true, restaurant: item.visibility?.restaurant !== false };
                  fixItemVisibility(id, item.costCenter || 'restaurant', vis);
                }
              });
            });
          }
          // Persist to localStorage
          const storedItems = JSON.parse(localStorage.getItem('corepms_pos_items') || '[]');
          const updated = storedItems.map((it: any) => ids.includes(it.id)
            ? { ...it, visibility: { ...(it.visibility || {}), bar: true } } : it);
          localStorage.setItem('corepms_pos_items', JSON.stringify(updated));
        }}>✓ Bar Visible</Button>

        <Button variant="outline" className="ds-button-compact" onClick={() => {
          const ids = Array.from(selectedIds); if (!ids.length) return;
          const updates = { bar: false };
          const next = allItems.map((it: any) => ids.includes(it.id)
            ? { ...it, visibility: { ...(it.visibility || {}), bar: false }, bar_visibility: false }
            : it);
          setAllItems(next);
          if (onBulkSetVisibility) onBulkSetVisibility(ids, updates);
          else {
            import('@/lib/dbSync').then(({ fixItemVisibility }) => {
              ids.forEach(id => {
                const item = allItems.find((it: any) => it.id === id);
                if (item) {
                  const vis = { bar: false, restaurant: item.visibility?.restaurant !== false };
                  fixItemVisibility(id, item.costCenter || 'restaurant', vis);
                }
              });
            });
          }
          const storedItems = JSON.parse(localStorage.getItem('corepms_pos_items') || '[]');
          const updated = storedItems.map((it: any) => ids.includes(it.id)
            ? { ...it, visibility: { ...(it.visibility || {}), bar: false } } : it);
          localStorage.setItem('corepms_pos_items', JSON.stringify(updated));
        }}>✗ Bar Hidden</Button>

        {/* Restaurant visibility controls */}
        <Button variant="outline" className="ds-button-compact" onClick={() => {
          const ids = Array.from(selectedIds); if (!ids.length) return;
          const updates = { restaurant: true };
          const next = allItems.map((it: any) => ids.includes(it.id)
            ? { ...it, visibility: { ...(it.visibility || {}), restaurant: true }, restaurant_visibility: true }
            : it);
          setAllItems(next);
          if (onBulkSetVisibility) onBulkSetVisibility(ids, updates);
          else {
            import('@/lib/dbSync').then(({ fixItemVisibility }) => {
              ids.forEach(id => {
                const item = allItems.find((it: any) => it.id === id);
                if (item) {
                  const vis = { bar: item.visibility?.bar !== false, restaurant: true };
                  fixItemVisibility(id, item.costCenter || 'restaurant', vis);
                }
              });
            });
          }
          const storedItems = JSON.parse(localStorage.getItem('corepms_pos_items') || '[]');
          const updated = storedItems.map((it: any) => ids.includes(it.id)
            ? { ...it, visibility: { ...(it.visibility || {}), restaurant: true } } : it);
          localStorage.setItem('corepms_pos_items', JSON.stringify(updated));
        }}>✓ Restaurant Visible</Button>

        <Button variant="outline" className="ds-button-compact" onClick={() => {
          const ids = Array.from(selectedIds); if (!ids.length) return;
          const updates = { restaurant: false };
          const next = allItems.map((it: any) => ids.includes(it.id)
            ? { ...it, visibility: { ...(it.visibility || {}), restaurant: false }, restaurant_visibility: false }
            : it);
          setAllItems(next);
          if (onBulkSetVisibility) onBulkSetVisibility(ids, updates);
          else {
            import('@/lib/dbSync').then(({ fixItemVisibility }) => {
              ids.forEach(id => {
                const item = allItems.find((it: any) => it.id === id);
                if (item) {
                  const vis = { bar: item.visibility?.bar !== false, restaurant: false };
                  fixItemVisibility(id, item.costCenter || 'restaurant', vis);
                }
              });
            });
          }
          const storedItems = JSON.parse(localStorage.getItem('corepms_pos_items') || '[]');
          const updated = storedItems.map((it: any) => ids.includes(it.id)
            ? { ...it, visibility: { ...(it.visibility || {}), restaurant: false } } : it);
          localStorage.setItem('corepms_pos_items', JSON.stringify(updated));
        }}>✗ Restaurant Hidden</Button>

        <div className="text-xs text-gray-500 ml-2 whitespace-nowrap self-center">
          {selectedIds.size > 0 ? `${selectedIds.size} selected` : 'Select items to bulk-edit'}
        </div>
      </div>

      {loading && (<div role="status" aria-live="polite" className="text-xs text-gray-600">Filtering…</div>)}

      <div className="ds-table-container" role="region" aria-label="Stock table">
        <table className="ds-table" role="table" aria-label="Stock items">
          <thead>
            <tr>
              <th scope="col"><input type="checkbox" aria-label="Select all" onChange={(e) => {
                if (e.target.checked) setSelectedIds(new Set((virtualize ? filtered : pageItems).map((it: any) => it.id)));
                else setSelectedIds(new Set());
              }} /></th>
              <th scope="col" className="text-left">Name</th>
              <th scope="col" className="hide-on-mobile">Center</th>
              <th scope="col" className="text-right">Price</th>
              <th scope="col" className="text-right">Stock Qty</th>
              <th scope="col" className="text-right hide-on-mobile">GP%</th>
              <th scope="col">Issues</th>
              <th scope="col" className="hide-on-mobile">Visibility</th>
              <th scope="col" className="text-center">Actions</th>
            </tr>
          </thead>
          <tbody>
            {virtualize && topPad > 0 && (<tr style={{ height: topPad }} aria-hidden="true"><td colSpan={9} /></tr>)}
            {(visibleItems).map((it: any) => {
              const issues: string[] = [];
              if (!it.category_id) issues.push('Missing category');
              if (Number(it.sellingPrice || 0) <= 0) issues.push('Zero price');
              const gp = Number(it.gpPercent || 0).toFixed(2);
              return (
                <tr key={it.id} tabIndex={0} className="hover:bg-blue-50 focus:bg-blue-50" style={virtualize ? { height: rowHeight } : undefined}>
                  <td><input type="checkbox" checked={selectedIds.has(it.id)} onChange={(e) => {
                    const next = new Set(selectedIds);
                    if (e.target.checked) next.add(it.id); else next.delete(it.id);
                    setSelectedIds(next);
                  }} aria-label={`Select ${it.name}`} /></td>
                  <td className="text-left font-medium max-w-[120px] sm:max-w-none truncate">{it.name}</td>
                  <td className="capitalize hide-on-mobile">{it.costCenter || '—'}</td>
                  <td className="text-right font-mono">${Number(it.sellingPrice || 0).toFixed(2)}</td>
                  <td className="text-right font-mono">
                    {(() => {
                      const qty = getStockQty(it);
                      if (qty === null) return <span className="text-gray-400">—</span>;
                      const low = qty <= 5;
                      const out = qty <= 0;
                      return (
                        <span className={out ? 'text-red-700 font-bold' : low ? 'text-amber-600 font-semibold' : 'text-gray-800'}>
                          {qty.toFixed(qty % 1 === 0 ? 0 : 2)}
                        </span>
                      );
                    })()}
                  </td>
                  <td className="text-right font-mono hide-on-mobile">{gp}%</td>
                  <td>
                    {issues.length ? (
                      <span className="inline-flex items-center gap-1 text-[10px] sm:text-xs text-red-700 bg-red-100 px-2 py-0.5 rounded" aria-label={`${issues.length} issues`}>{issues.length}</span>
                    ) : (
                      <span className="text-[10px] sm:text-xs text-green-700 bg-green-100 px-2 py-0.5 rounded" aria-label="OK">OK</span>
                    )}
                  </td>
                  <td className="hide-on-mobile">
                    <div className="flex gap-1 flex-wrap">
                      {/* Bar visibility toggle */}
                      <button
                        onClick={() => {
                          const newBarVis = !((it.visibility?.bar !== false) && it.bar_visibility !== false);
                          const next = allItems.map((item: any) => item.id === it.id
                            ? { ...item, visibility: { ...(item.visibility || {}), bar: newBarVis }, bar_visibility: newBarVis }
                            : item);
                          setAllItems(next);
                          cacheRef.current.clear();
                          // Persist to DB and localStorage
                          import('@/lib/dbSync').then(({ fixItemVisibility }) => {
                            const vis = { bar: newBarVis, restaurant: it.visibility?.restaurant !== false };
                            fixItemVisibility(it.id, it.costCenter || 'restaurant', vis);
                          });
                          const stored = JSON.parse(localStorage.getItem('corepms_pos_items') || '[]');
                          localStorage.setItem('corepms_pos_items', JSON.stringify(
                            stored.map((s: any) => s.id === it.id ? { ...s, visibility: { ...(s.visibility || {}), bar: newBarVis } } : s)
                          ));
                        }}
                        title={`Toggle Bar visibility (currently ${it.visibility?.bar !== false ? 'visible' : 'hidden'})`}
                        className={`text-[9px] px-1.5 py-0.5 rounded font-medium border transition-colors ${
                          it.visibility?.bar !== false && it.bar_visibility !== false
                            ? 'bg-blue-100 text-blue-700 border-blue-300'
                            : 'bg-gray-100 text-gray-400 border-gray-300 line-through'
                        }`}
                      >
                        Bar
                      </button>
                      {/* Restaurant visibility toggle */}
                      <button
                        onClick={() => {
                          const newRestVis = !((it.visibility?.restaurant !== false) && it.restaurant_visibility !== false);
                          const next = allItems.map((item: any) => item.id === it.id
                            ? { ...item, visibility: { ...(item.visibility || {}), restaurant: newRestVis }, restaurant_visibility: newRestVis }
                            : item);
                          setAllItems(next);
                          cacheRef.current.clear();
                          import('@/lib/dbSync').then(({ fixItemVisibility }) => {
                            const vis = { bar: it.visibility?.bar !== false, restaurant: newRestVis };
                            fixItemVisibility(it.id, it.costCenter || 'restaurant', vis);
                          });
                          const stored = JSON.parse(localStorage.getItem('corepms_pos_items') || '[]');
                          localStorage.setItem('corepms_pos_items', JSON.stringify(
                            stored.map((s: any) => s.id === it.id ? { ...s, visibility: { ...(s.visibility || {}), restaurant: newRestVis } } : s)
                          ));
                        }}
                        title={`Toggle Restaurant visibility (currently ${it.visibility?.restaurant !== false ? 'visible' : 'hidden'})`}
                        className={`text-[9px] px-1.5 py-0.5 rounded font-medium border transition-colors ${
                          it.visibility?.restaurant !== false && it.restaurant_visibility !== false
                            ? 'bg-green-100 text-green-700 border-green-300'
                            : 'bg-gray-100 text-gray-400 border-gray-300 line-through'
                        }`}
                      >
                        Rest
                      </button>
                    </div>
                  </td>
                  <td>
                    <div className="flex gap-1 justify-center flex-wrap min-w-[100px] sm:min-w-0">
                      {canEdit && (<Button variant="outline" className="ds-button-compact px-2" onClick={() => onEditItem?.(it)} aria-label={`Edit ${it.name}`}>Edit</Button>)}
                      {canFix && (<Button variant="secondary" className="ds-button-compact px-2" onClick={() => onFixItem?.(it)} aria-label={`Fix ${it.name}`}>Fix</Button>)}
                      {canDelete && (<Button variant="destructive" className="ds-button-compact px-2" onClick={() => onDeleteItem?.(it.id)} aria-label={`Delete ${it.name}`}>Del</Button>)}
                    </div>
                  </td>
                </tr>
              );
            })}
            {virtualize && bottomPad > 0 && (<tr style={{ height: bottomPad }} aria-hidden="true"><td colSpan={9} /></tr>)}
            {!pageItems.length && (
              <tr><td colSpan={9} className="py-2 text-gray-500 text-center">No items match current filters</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {!virtualize && (
        <div className="flex items-center justify-between mt-2" role="navigation" aria-label="Pagination">
          <div className="text-xs text-gray-600">Page {page} / {totalPages} · {filtered.length} items</div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setPage(1)} disabled={page === 1} aria-label="First page">« First</Button>
            <Button variant="outline" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} aria-label="Previous page">‹ Prev</Button>
            <Button variant="outline" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} aria-label="Next page">Next ›</Button>
            <Button variant="outline" onClick={() => setPage(totalPages)} disabled={page === totalPages} aria-label="Last page">Last »</Button>
          </div>
        </div>
      )}

      {virtualize && (
        <div ref={listRef} className="h-[480px] overflow-auto" onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)} aria-label="Virtualized viewport" />
      )}
    </div>
  );
};

export default StockTab;
