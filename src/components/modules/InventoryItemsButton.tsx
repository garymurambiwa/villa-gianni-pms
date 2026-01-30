import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatCurrency } from '@/lib/posIntegration';
import { useHotkeys } from '@/contexts/HotkeysContext';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

const SummaryBar: React.FC<{ items: any[]; searchTerm: string; centerFilter: 'all'|'bar'|'restaurant'; barFilter: boolean; restaurantFilter: boolean; quickFilter: 'all'|'low'|'bar'|'restaurant'; lowStockThreshold: number }>
= ({ items, searchTerm, centerFilter, barFilter, restaurantFilter, quickFilter, lowStockThreshold }) => {
  const filtered = items.filter((it) => {
    const nameOk = !searchTerm.trim() || String(it.name || '').toLowerCase().includes(searchTerm.trim().toLowerCase());
    const centerOk = centerFilter === 'all' || it.costCenter === centerFilter;
    const barOk = !barFilter || !!it.visibility?.bar;
    const restOk = !restaurantFilter || !!it.visibility?.restaurant;
    const quickOk = quickFilter === 'all'
      ? true
      : quickFilter === 'low'
        ? Number(it.qtyInStock || 0) <= lowStockThreshold
        : quickFilter === 'bar'
          ? (String((it as any).inventoryCategory||'') === 'cellar' || it.costCenter === 'bar')
          : (String((it as any).inventoryCategory||'') === 'kitchen' || it.costCenter === 'restaurant');
    return nameOk && centerOk && barOk && restOk && quickOk;
  });
  const count = filtered.length;
  const prices = filtered.map((it) => Number(it.sellingPrice || 0));
  const gpPercents = filtered.map((it) => Number(it.gpPercent || 0));
  const avgGp = count ? (gpPercents.reduce((a,b)=>a+b,0)/count) : 0;
  const minPrice = count ? Math.min(...prices) : 0;
  const maxPrice = count ? Math.max(...prices) : 0;
  const totalValue = filtered.reduce((acc, it) => acc + Number(it.sellingPrice || 0) * Number(it.qtyInStock || 0), 0);
  const totalCost = filtered.reduce((acc, it) => acc + Number(it.costPrice || 0) * Number(it.qtyInStock || 0), 0);
  const margin = totalValue - totalCost;
  const marginPct = totalValue > 0 ? (margin / totalValue) * 100 : 0;
  return (
    <div className="text-xs text-gray-600 mb-2">
      {`Items: ${count} • Avg GP: ${avgGp.toFixed(2)}% • Min: ${formatCurrency(minPrice)} • Max: ${formatCurrency(maxPrice)} • Total Value: ${formatCurrency(totalValue)} • Total Cost: ${formatCurrency(totalCost)} • Margin: ${formatCurrency(margin)} (${marginPct.toFixed(2)}%)`}
    </div>
  );
};

const InventoryItemsButton: React.FC = () => {
  const [open, setOpen] = React.useState(false);
  const hk = useHotkeys();
  const openTip = hk.getTooltip('Shift+I') || 'Open Inventory Items Viewer';
  const [items, setItems] = React.useState<any[]>([]);
  const [searchTerm, setSearchTerm] = React.useState('');
  const [centerFilter, setCenterFilter] = React.useState<'all'|'bar'|'restaurant'>('all');
  const [barFilter, setBarFilter] = React.useState(false);
  const [restaurantFilter, setRestaurantFilter] = React.useState(false);
  const [attentionOnly, setAttentionOnly] = React.useState(false);
  const [severityFilter, setSeverityFilter] = React.useState<'all'|'critical'|'minor'>('all');
  const [sortKey, setSortKey] = React.useState<'name'|'price'|'gp'>('name');
  const [sortDir, setSortDir] = React.useState<'asc'|'desc'>('asc');
  const [quickFilter, setQuickFilter] = React.useState<'all'|'low'|'bar'|'restaurant'>('all');
  const [lowStockThreshold, setLowStockThreshold] = React.useState<number>(() => {
    try {
      const raw = localStorage.getItem('corepms_inventory_threshold');
      const n = raw ? Number(raw) : 5;
      return Number.isFinite(n) && n >= 0 ? n : 5;
    } catch { return 5; }
  });

  const getItemIssues = React.useCallback((it: any): string[] => {
    const issues: string[] = [];
    if (!String(it.name || '').trim()) issues.push('Missing name');
    if (!it.costCenter) issues.push('No center');
    if (Number(it.costPrice || 0) <= 0) issues.push('Cost ≤ 0');
    if (Number(it.sellingPrice || 0) <= 0) issues.push('Price ≤ 0');
    if (Number(it.cosPercent || 0) < 0 || Number(it.cosPercent || 0) > 100) issues.push('COS out of range');
    return issues;
  }, []);

  const getItemSeverity = React.useCallback((it: any): 'critical' | 'minor' | 'none' => {
    if (!String(it.name || '').trim()) return 'critical';
    if (!it.costCenter) return 'critical';
    if (Number(it.costPrice || 0) <= 0) return 'critical';
    if (Number(it.sellingPrice || 0) <= 0) return 'critical';
    if (Number(it.cosPercent || 0) < 0 || Number(it.cosPercent || 0) > 100) return 'minor';
    return 'none';
  }, []);

  React.useEffect(() => {
    try {
      const raw = localStorage.getItem('corepms_pos_items');
      setItems(raw ? JSON.parse(raw) : []);
    } catch {
      setItems([]);
    }
  }, [open]);

  React.useEffect(() => {
    const onOpenViewer = () => setOpen(true);
    window.addEventListener('openInventoryViewer', onOpenViewer as any);
    return () => window.removeEventListener('openInventoryViewer', onOpenViewer as any);
  }, []);

  React.useEffect(() => {
    try {
      const raw = localStorage.getItem('corepms_inventory_viewer_controls');
      if (raw) {
        const c = JSON.parse(raw);
        if (typeof c.searchTerm === 'string') setSearchTerm(c.searchTerm);
        if (c.centerFilter) setCenterFilter(c.centerFilter);
        if (typeof c.barFilter !== 'undefined') setBarFilter(!!c.barFilter);
        if (typeof c.restaurantFilter !== 'undefined') setRestaurantFilter(!!c.restaurantFilter);
        if (typeof c.attentionOnly !== 'undefined') setAttentionOnly(!!c.attentionOnly);
        if (c.severityFilter) setSeverityFilter(c.severityFilter);
        if (c.sortKey) setSortKey(c.sortKey);
        if (c.sortDir) setSortDir(c.sortDir);
        if (c.quickFilter) setQuickFilter(c.quickFilter);
      }
    } catch {}
  }, []);

  React.useEffect(() => {
    try {
      const payload = { searchTerm, centerFilter, barFilter, restaurantFilter, attentionOnly, severityFilter, sortKey, sortDir, quickFilter };
      localStorage.setItem('corepms_inventory_viewer_controls', JSON.stringify(payload));
    } catch {}
  }, [searchTerm, centerFilter, barFilter, restaurantFilter, attentionOnly, severityFilter, sortKey, sortDir, quickFilter]);

  React.useEffect(() => {
    const onThreshold = () => {
      try {
        const raw = localStorage.getItem('corepms_inventory_threshold');
        const n = raw ? Number(raw) : 5;
        setLowStockThreshold(Number.isFinite(n) && n >= 0 ? n : 5);
      } catch {}
    };
    window.addEventListener('inventory:threshold:update', onThreshold);
    return () => window.removeEventListener('inventory:threshold:update', onThreshold);
  }, []);

  return (
    <>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button className="bg-purple-600 text-white hover:bg-purple-700 rounded-full px-5 py-2 shadow-sm" onClick={() => setOpen(true)}>
              <span className="mr-2">📦</span>
              View Inventory Items
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <span>{openTip} (Shift+I)</span>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <div className="text-[12px] text-gray-500 mt-1 underline">Quick access to inventory list</div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Inventory Items Viewer</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {/* Relocated filter pills container */}
            <div className="bg-white rounded-xl shadow-lg p-6 mb-3">
              <div className="flex flex-wrap gap-3">
                <button className={quickFilter==='all'?"px-4 py-2 rounded-lg font-medium bg-blue-600 text-white":"px-4 py-2 rounded-lg font-medium bg-gray-200 text-gray-700"} onClick={()=>setQuickFilter('all')}>All Items</button>
                <button className={quickFilter==='low'?"px-4 py-2 rounded-lg font-medium bg-blue-600 text-white":"px-4 py-2 rounded-lg font-medium bg-gray-200 text-gray-700"} onClick={()=>setQuickFilter('low')}>Low Stock</button>
                <button className={quickFilter==='bar'?"px-4 py-2 rounded-lg font-medium bg-blue-600 text-white":"px-4 py-2 rounded-lg font-medium bg-gray-200 text-gray-700"} onClick={()=>setQuickFilter('bar')}>Cellar</button>
                <button className={quickFilter==='restaurant'?"px-4 py-2 rounded-lg font-medium bg-blue-600 text-white":"px-4 py-2 rounded-lg font-medium bg-gray-200 text-gray-700"} onClick={()=>setQuickFilter('restaurant')}>Kitchen</button>
              </div>
            </div>

            {/* Controls */}
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div className="flex items-center gap-3">
                <Button variant="outline" onClick={() => {
                  try {
                    const filtered = items
                      .filter((it) => {
                        const nameOk = !searchTerm.trim() || String(it.name || '').toLowerCase().includes(searchTerm.trim().toLowerCase());
                        const centerOk = centerFilter === 'all' || it.costCenter === centerFilter;
                        const barOk = !barFilter || !!it.visibility?.bar;
                        const restOk = !restaurantFilter || !!it.visibility?.restaurant;
                        const issues = getItemIssues(it);
                        const attentionOk = !attentionOnly || issues.length > 0;
                        const severity = getItemSeverity(it);
                        const severityOk = severityFilter === 'all' || severityFilter === severity;
                        const quickOk = quickFilter === 'all'
                          ? true
                          : quickFilter === 'low'
                            ? Number(it.qtyInStock || 0) <= lowStockThreshold
                            : quickFilter === 'bar'
                              ? (String((it as any).inventoryCategory||'') === 'cellar' || it.costCenter === 'bar')
                              : (String((it as any).inventoryCategory||'') === 'kitchen' || it.costCenter === 'restaurant');
                        return nameOk && centerOk && barOk && restOk && attentionOk && severityOk && quickOk;
                      })
                      .slice()
                      .sort((a, b) => {
                        let cmp = 0;
                        if (sortKey === 'name') cmp = String(a.name || '').localeCompare(String(b.name || ''));
                        else if (sortKey === 'price') cmp = Number(a.sellingPrice || 0) - Number(b.sellingPrice || 0);
                        else cmp = Number(a.gpPercent || 0) - Number(b.gpPercent || 0);
                        return sortDir === 'asc' ? cmp : -cmp;
                      });
                    const headers = ['Name','Center','Price','GP%','Qty','Bar','Restaurant'];
                    const rows = filtered.map((it: any) => [
                      it.name || '',
                      it.costCenter || '',
                      Number(it.sellingPrice || 0).toFixed(2),
                      Number(it.gpPercent || 0).toFixed(2),
                      Number(it.qtyInStock || 0),
                      it.visibility?.bar ? 'Yes' : 'No',
                      it.visibility?.restaurant ? 'Yes' : 'No'
                    ].map(v => `"${String(v).replace(/\"/g,'""')}"`).join(',')).join('\n');
                    const csv = [headers.join(','), rows].join('\n');
                    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `inventory_view_${new Date().toISOString().slice(0,10)}.csv`;
                    a.click();
                    URL.revokeObjectURL(url);
                  } catch (err) {
                    alert('Failed to export viewer CSV');
                  }
                }}>Export CSV</Button>
                <Input placeholder="Search name" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="max-w-xs" />
                <Select value={centerFilter} onValueChange={(v) => setCenterFilter(v as any)}>
                  <SelectTrigger className="w-36">
                    <SelectValue placeholder="Center" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="bar">Bar</SelectItem>
                    <SelectItem value="restaurant">Restaurant</SelectItem>
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-2">
                  <Checkbox checked={barFilter} onCheckedChange={(v) => setBarFilter(!!v)} />
                  <span className="text-sm">Bar only</span>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox checked={restaurantFilter} onCheckedChange={(v) => setRestaurantFilter(!!v)} />
                  <span className="text-sm">Restaurant only</span>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox checked={attentionOnly} onCheckedChange={(v) => setAttentionOnly(!!v)} />
                  <span className="text-sm">Attention only</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Select value={sortKey} onValueChange={(v) => setSortKey(v as any)}>
                  <SelectTrigger className="w-36">
                    <SelectValue placeholder="Sort by" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="name">Name</SelectItem>
                    <SelectItem value="price">Price</SelectItem>
                    <SelectItem value="gp">GP %</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={severityFilter} onValueChange={(v) => setSeverityFilter(v as any)}>
                  <SelectTrigger className="w-40">
                    <SelectValue placeholder="Severity" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All severity</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                    <SelectItem value="minor">Minor</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant="outline" onClick={() => setSortDir(sortDir === 'asc' ? 'desc' : 'asc')}>{sortDir === 'asc' ? 'Asc' : 'Desc'}</Button>
              </div>
            </div>

            {/* Summary */}
            <SummaryBar items={items} searchTerm={searchTerm} centerFilter={centerFilter} barFilter={barFilter} restaurantFilter={restaurantFilter} quickFilter={quickFilter} lowStockThreshold={lowStockThreshold} />

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b">
                    <th className="py-2 pr-4">Name</th>
                    <th className="py-2 pr-4">Center</th>
                    <th className="py-2 pr-4">Price</th>
                    <th className="py-2 pr-4">GP%</th>
                    <th className="py-2 pr-4">Issues</th>
                    <th className="py-2 pr-4">Visible</th>
                  </tr>
                </thead>
                <tbody>
                  {items
                    .filter((it) => {
                      const nameOk = !searchTerm.trim() || String(it.name || '').toLowerCase().includes(searchTerm.trim().toLowerCase());
                      const centerOk = centerFilter === 'all' || it.costCenter === centerFilter;
                      const barOk = !barFilter || !!it.visibility?.bar;
                      const restOk = !restaurantFilter || !!it.visibility?.restaurant;
                      const issues = getItemIssues(it);
                      const attentionOk = !attentionOnly || issues.length > 0;
                      const severity = getItemSeverity(it);
                      const severityOk = severityFilter === 'all' || severityFilter === severity;
                      const quickOk = quickFilter === 'all'
                        ? true
                        : quickFilter === 'low'
                          ? Number(it.qtyInStock || 0) <= lowStockThreshold
                          : quickFilter === 'bar'
                            ? (String((it as any).inventoryCategory||'') === 'cellar' || it.costCenter === 'bar')
                            : (String((it as any).inventoryCategory||'') === 'kitchen' || it.costCenter === 'restaurant');
                      return nameOk && centerOk && barOk && restOk && attentionOk && severityOk && quickOk;
                    })
                    .slice()
                    .sort((a, b) => {
                      let cmp = 0;
                      if (sortKey === 'name') cmp = String(a.name || '').localeCompare(String(b.name || ''));
                      else if (sortKey === 'price') cmp = Number(a.sellingPrice || 0) - Number(b.sellingPrice || 0);
                      else cmp = Number(a.gpPercent || 0) - Number(b.gpPercent || 0);
                      return sortDir === 'asc' ? cmp : -cmp;
                    })
                    .map((it) => {
                      const issues = getItemIssues(it);
                      return (
                        <tr key={it.id} className="border-b">
                          <td className="py-2 pr-4">{it.name}</td>
                          <td className="py-2 pr-4 capitalize">{it.costCenter}</td>
                          <td className="py-2 pr-4">{formatCurrency(Number(it.sellingPrice || 0))}</td>
                          <td className="py-2 pr-4">{Number(it.gpPercent || 0).toFixed(2)}%</td>
                          <td className="py-2 pr-4">
                            {issues.length > 0 ? (
                              <span className="inline-flex items-center gap-1 text-xs text-red-700 bg-red-100 px-2 py-1 rounded">
                                <span className="font-semibold">{issues.length}</span>
                                <span>issue{issues.length > 1 ? 's' : ''}</span>
                              </span>
                            ) : (
                              <span className="text-xs text-green-700 bg-green-100 px-2 py-1 rounded">OK</span>
                            )}
                            {issues.length > 0 && (
                              <div className="mt-1 text-[11px] text-red-700">{issues.join(', ')}</div>
                            )}
                          </td>
                          <td className="py-2 pr-4">
                            <span className="text-xs bg-gray-200 rounded px-2 py-1 mr-1">Bar: {it.visibility?.bar ? 'Yes' : 'No'}</span>
                            <span className="text-xs bg-gray-200 rounded px-2 py-1">Restaurant: {it.visibility?.restaurant ? 'Yes' : 'No'}</span>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default InventoryItemsButton;
