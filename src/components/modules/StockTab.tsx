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
        <Input aria-label="Search by name" placeholder="Search name" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="w-48" />
        <Select value={center} onValueChange={(v) => { setCenter(v as any); setPage(1); }}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Center" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="bar">Bar</SelectItem>
            <SelectItem value="restaurant">Restaurant</SelectItem>
          </SelectContent>
        </Select>
        <Select value={severity} onValueChange={(v) => { setSeverity(v as any); setPage(1); }}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Severity" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All severity</SelectItem>
            <SelectItem value="low">Low</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="high">High</SelectItem>
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" aria-label="Attention only" checked={attentionOnly} onChange={(e) => { setAttentionOnly(e.target.checked); setPage(1); }} />
          Attention only
        </label>
        <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}>
          <SelectTrigger className="w-28"><SelectValue placeholder="Page size" /></SelectTrigger>
          <SelectContent>
            {[25, 50, 100].map(n => (<SelectItem key={n} value={String(n)}>{n}/page</SelectItem>))}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={virtualize} onChange={(e) => setVirtualize(e.target.checked)} aria-label="Enable virtualization" />
          Virtualize
        </label>
      </div>

      {/* Bulk actions */}
      <div className="ds-toolbar text-sm">
        <Button variant="outline" onClick={() => {
          const ids = Array.from(selectedIds);
          if (!ids.length) return;
          // Delete selected locally
          const next = allItems.filter((it: any) => !ids.includes(it.id));
          setAllItems(next);
          setSelectedIds(new Set());
        }}>Delete Selected</Button>
        <Button variant="outline" onClick={() => {
          const ids = Array.from(selectedIds); if (!ids.length) return;
          const next = allItems.map((it: any) => ids.includes(it.id) ? { ...it, visibility: { ...(it.visibility || {}), bar: true } } : it);
          setAllItems(next);
        }}>Set Bar Visible</Button>
        <Button variant="outline" onClick={() => {
          const ids = Array.from(selectedIds); if (!ids.length) return;
          const next = allItems.map((it: any) => ids.includes(it.id) ? { ...it, visibility: { ...(it.visibility || {}), restaurant: true } } : it);
          setAllItems(next);
        }}>Set Restaurant Visible</Button>
        <div className="text-xs text-gray-600 ml-2">Selected: {selectedIds.size}</div>
      </div>

      {loading && (<div role="status" aria-live="polite" className="text-xs text-gray-600">Filtering…</div>)}

      <div className="overflow-x-auto" role="region" aria-label="Stock table">
        <table className="ds-table" role="table" aria-label="Stock items">
          <thead>
            <tr>
              <th scope="col"><input type="checkbox" aria-label="Select all" onChange={(e) => {
                if (e.target.checked) setSelectedIds(new Set((virtualize ? filtered : pageItems).map((it: any) => it.id)));
                else setSelectedIds(new Set());
              }} /></th>
              <th scope="col" className="text-left">Name</th>
              <th scope="col">Center</th>
              <th scope="col" className="text-right">Price</th>
              <th scope="col" className="text-right">GP%</th>
              <th scope="col">Issues</th>
              <th scope="col">Visibility</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {virtualize && topPad > 0 && (<tr style={{ height: topPad }} aria-hidden="true"><td colSpan={8} /></tr>)}
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
                  <td className="text-left">{it.name}</td>
                  <td className="capitalize">{it.costCenter || '—'}</td>
                  <td className="text-right">${Number(it.sellingPrice || 0).toFixed(2)}</td>
                  <td className="text-right">{gp}%</td>
                  <td>
                    {issues.length ? (
                      <span className="inline-flex items-center gap-1 text-xs text-red-700 bg-red-100 px-2 py-1 rounded" aria-label={`${issues.length} issues`}>{issues.length} issues</span>
                    ) : (
                      <span className="text-xs text-green-700 bg-green-100 px-2 py-1 rounded" aria-label="OK">OK</span>
                    )}
                  </td>
                  <td>
                    <span className="text-xs bg-gray-200 rounded px-2 py-1 mr-1">Bar: {it.visibility?.bar ? 'Yes' : 'No'}</span>
                    <span className="text-xs bg-gray-200 rounded px-2 py-1">Restaurant: {it.visibility?.restaurant ? 'Yes' : 'No'}</span>
                  </td>
                  <td>
                    <div className="flex gap-2">
                      {canEdit && (<Button variant="outline" onClick={() => onEditItem?.(it)} aria-label={`Edit ${it.name}`}>Edit</Button>)}
                      {canFix && (<Button variant="secondary" onClick={() => onFixItem?.(it)} aria-label={`Fix ${it.name}`}>Fix</Button>)}
                      {canDelete && (<Button variant="destructive" onClick={() => onDeleteItem?.(it.id)} aria-label={`Delete ${it.name}`}>Delete</Button>)}
                    </div>
                  </td>
                </tr>
              );
            })}
            {virtualize && bottomPad > 0 && (<tr style={{ height: bottomPad }} aria-hidden="true"><td colSpan={8} /></tr>)}
            {!pageItems.length && (
              <tr><td colSpan={7} className="py-2 text-gray-500">No items match current filters</td></tr>
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
