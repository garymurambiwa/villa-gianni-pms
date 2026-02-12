import React, { useState, useEffect, useCallback, useRef } from 'react';
import db from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { readReceiptBranding } from '@/lib/printSettings';
import { syncInventoryItemToDb } from '@/lib/dbSync';

interface InventoryItem {
  id: string;
  name: string;
  category: string;
  quantity: number;
  unit: string;
  reorderLevel: number;
  cost: number;
}

// POS Item interface to match the actual data structure
interface POSItem {
  id: string;
  name: string;
  price: number;
  category: 'food' | 'bar';
  subCategory: string;
  image: string;
  qtyInStock?: number;
  cost?: number;
  unit?: string;
  reorderLevel?: number;
  inventoryCategory?: 'kitchen' | 'cellar';
}

// Convert POS items to inventory format
const convertPOSItemsToInventory = (posItems: POSItem[]): InventoryItem[] => {
  return posItems.map(item => ({
    id: item.id,
    name: item.name,
    category: (item.inventoryCategory === 'cellar') ? 'Cellar' : (item.inventoryCategory === 'kitchen') ? 'Kitchen' : (item.category === 'bar' ? 'Cellar' : 'Kitchen'),
    quantity: item.qtyInStock || 0,
    unit: item.unit || 'units',
    reorderLevel: item.reorderLevel || 10,
    cost: Number(item.cost || item.price || 0)
  }));
};

const loadInventoryFromPOS = async (): Promise<{ items: InventoryItem[]; source: 'db' | 'local' }> => {
  try {
    const isConfigured = await db.isConfigured();
    if (isConfigured) {
      const res = await db.query<{ id: string; name: string; category: string; stock_level: number; cost_price: number }>(
        `SELECT id, name, category, stock_level, cost_price FROM products WHERE is_stock_item = true`
      );
      if ('rows' in res && Array.isArray(res.rows) && res.rows.length > 0) {
        return {
          items: res.rows.map((r: any) => ({
            id: String(r.id),
            name: String(r.name),
            category: String(r.category || ''),
            quantity: Number(r.stock_level || 0),
            unit: 'units',
            reorderLevel: 10,
            cost: Number(r.cost_price || 0)
          })),
          source: 'db'
        };
      }
    }
    const raw = localStorage.getItem('corepms_pos_items');
    if (!raw) return { items: [], source: 'local' };
    const posItems: POSItem[] = JSON.parse(raw);
    return { items: convertPOSItemsToInventory(posItems), source: 'local' };
  } catch (error) {
    console.error('Failed to load inventory from persistent store:', error);
    return { items: [], source: 'local' };
  }
};

const saveInventoryToPOS = async (inventory: InventoryItem[]) => {
  try {
    const isConfigured = await db.isConfigured();
    if (isConfigured) {
      // Use UPSERT pattern for proper persistence
      for (const item of inventory) {
        await syncInventoryItemToDb({
          id: item.id,
          name: item.name,
          category: item.category,
          stock_level: item.quantity,
          price: item.cost
        });
      }
    }
    // Always update localStorage as cache
    const raw = localStorage.getItem('corepms_pos_items');
    const existingPOSItems: POSItem[] = raw ? JSON.parse(raw) : [];
    const updatedPOSItems = existingPOSItems.map(posItem => {
      const inventoryItem = inventory.find(inv => inv.id === posItem.id);
      if (inventoryItem) {
        return {
          ...posItem,
          qtyInStock: inventoryItem.quantity,
          cost: inventoryItem.cost,
          unit: inventoryItem.unit,
          reorderLevel: inventoryItem.reorderLevel
        };
      }
      return posItem;
    });
    localStorage.setItem('corepms_pos_items', JSON.stringify(updatedPOSItems));
  } catch (error) {
    console.error('Failed to save inventory to persistent store:', error);
  }
};

// Create audit entry for stock adjustments
const createAuditEntry = (action: string, itemName: string, oldQty: number, newQty: number, delta: number) => {
  try {
    const audit = {
      id: `AUD_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      action: action,
      entity: 'INVENTORY',
      entityId: itemName,
      timestamp: new Date().toISOString(),
      details: {
        itemName,
        oldQuantity: oldQty,
        newQuantity: newQty,
        adjustment: delta,
        adjustmentType: delta > 0 ? 'INCREASE' : 'DECREASE'
      }
    };

    const existingAudit = localStorage.getItem('corepms_pos_audit');
    const auditList = existingAudit ? JSON.parse(existingAudit) : [];
    auditList.unshift(audit);

    // Keep only the last 500 audit entries
    localStorage.setItem('corepms_pos_audit', JSON.stringify(auditList.slice(0, 500)));

    return audit;
  } catch (error) {
    console.error('Failed to create audit entry:', error);
  }
};

export const Inventory: React.FC = () => {
  const { toast } = useToast();
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const [isScrolling, setIsScrolling] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 50 });
  const ITEM_HEIGHT = 73; // Approximate height of each table row
  const VISIBLE_ITEMS = 50; // Number of items to render at once

  // Touch gesture handling
  const touchStartRef = useRef<{ y: number; time: number } | null>(null);
  const lastScrollTimeRef = useRef<number>(0);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const getXLSX = useCallback(async (): Promise<any | null> => {
    try {
      const w = window as any;
      if (w.XLSX) return w.XLSX;
      await new Promise<void>((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
        s.onload = () => resolve();
        s.onerror = () => reject(new Error('XLSX load failed'));
        document.head.appendChild(s);
      });
      return (window as any).XLSX || null;
    } catch { return null; }
  }, []);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [dataSource, setDataSource] = useState<'db' | 'local'>('db');
  const [isSyncing, setIsSyncing] = useState(false);
  const [filter, setFilter] = useState<string>('all');
  const [supplierFilter, setSupplierFilter] = useState<string>('all');
  const [locationFilter, setLocationFilter] = useState<'all' | 'Kitchen' | 'Cellar'>('all');

  // Load inventory from POS data store on component mount
  useEffect(() => {
    loadInventoryFromPOS().then(res => {
      setInventory(res.items);
      setDataSource(res.source);
    });
  }, []);

  const handlePushToCloud = async () => {
    try {
      setIsSyncing(true);
      toast({ title: 'Syncing to Cloud...', description: 'Pushing local inventory to database...' });

      const { performFullSync } = await import('@/lib/dbSync');
      const result = await performFullSync();

      if (result.success) {
        toast({ title: 'Sync Complete', description: `Synced ${result.synced} items to cloud.` });
        setDataSource('db');
      } else {
        toast({ title: 'Sync Failed', description: result.error, variant: 'destructive' });
      }
    } catch (err) {
      toast({ title: 'Sync Error', description: String(err), variant: 'destructive' });
    } finally {
      setIsSyncing(false);
    }
  };

  // Virtual scrolling and performance optimization
  const updateVisibleRange = useCallback(() => {
    if (!tableContainerRef.current) return;

    const container = tableContainerRef.current;
    const scrollTop = container.scrollTop;
    const containerHeight = container.clientHeight;

    const startIndex = Math.floor(scrollTop / ITEM_HEIGHT);
    const getCount = () => {
      let base = filter === 'all' ? inventory : filter === 'low' ? inventory.filter(i => i.quantity <= i.reorderLevel) : inventory.filter(i => i.category === filter);
      if (locationFilter !== 'all') base = base.filter(i => i.category === locationFilter);
      if (supplierFilter !== 'all') {
        try {
          const vr = localStorage.getItem('corepms_goods_received');
          const vs = vr ? JSON.parse(vr) : [];
          const ids = new Set<string>();
          (Array.isArray(vs) ? vs : []).forEach((v: any) => { if (String(v.supplier || '') === supplierFilter) { (v.items || []).forEach((it: any) => ids.add(String(it.itemId))) } });
          base = base.filter(i => ids.has(String(i.id)));
        } catch { }
      }
      return base.length;
    };
    const endIndex = Math.min(
      startIndex + Math.ceil(containerHeight / ITEM_HEIGHT) + 5,
      getCount()
    );

    setVisibleRange({ start: Math.max(0, startIndex - 2), end: endIndex + 2 });

    // Update scroll progress
    const maxScroll = container.scrollHeight - containerHeight;
    const progress = maxScroll > 0 ? (scrollTop / maxScroll) * 100 : 0;
    setScrollProgress(progress);
  }, [inventory, filter, supplierFilter, locationFilter]);

  // Handle scroll events with throttling
  const handleScroll = useCallback(() => {
    const now = Date.now();
    if (now - lastScrollTimeRef.current < 16) return; // ~60fps
    lastScrollTimeRef.current = now;

    setIsScrolling(true);
    updateVisibleRange();

    // Clear existing timeout
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }

    // Hide scroll indicator after scrolling stops
    scrollTimeoutRef.current = setTimeout(() => {
      setIsScrolling(false);
    }, 1000);
  }, [updateVisibleRange]);

  // Touch gesture handling
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    touchStartRef.current = { y: touch.clientY, time: Date.now() };
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!touchStartRef.current || !tableContainerRef.current) return;

    const touch = e.touches[0];
    const deltaY = touch.clientY - touchStartRef.current.y;
    const deltaTime = Date.now() - touchStartRef.current.time;

    // Implement smooth touch scrolling
    if (Math.abs(deltaY) > 5 && deltaTime < 200) {
      const container = tableContainerRef.current;
      const scrollAmount = deltaY * 2; // Multiplier for more responsive scrolling
      container.scrollTop -= scrollAmount;
      touchStartRef.current = { y: touch.clientY, time: Date.now() };
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    touchStartRef.current = null;
  }, []);

  // Initialize scroll handling
  useEffect(() => {
    const container = tableContainerRef.current;
    if (!container) return;

    container.addEventListener('scroll', handleScroll, { passive: true });
    updateVisibleRange();

    return () => {
      container.removeEventListener('scroll', handleScroll);
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, [handleScroll, updateVisibleRange]);
  const [adjustOpen, setAdjustOpen] = useState<boolean>(false);
  const [adjustItemId, setAdjustItemId] = useState<string>('');
  const [adjustDelta, setAdjustDelta] = useState<number>(0);
  const [grvOpen, setGrvOpen] = useState<boolean>(false);
  const [suppliersOpen, setSuppliersOpen] = useState<boolean>(false);

  // Print current filtered list by category
  const handlePrintByCategory = () => {
    const rows = filteredItems.map(i => `<tr><td>${i.name}</td><td class=\"right\">${i.quantity}</td><td>${i.unit}</td><td class=\"right\">${Number(i.cost).toFixed(2)}</td><td class=\"right\">${(i.quantity * Number(i.cost)).toFixed(2)}</td></tr>`).join('');
    const brand = readReceiptBranding();
    const header = `
      ${brand.show_logo && brand.logo_url ? `<div style=\"text-align:center\"><img src=\"${brand.logo_url}\" alt=\"Logo\" style=\"max-width:120px\"/></div>` : ''}
      <div style=\"text-align:center;font-weight:bold\">${brand.restaurant_name}</div>
    `;
    const html = `
      <html><head><title>Inventory — ${filter}</title>
        <style>
          body{font-family: Arial, sans-serif;}
          table{width:100%;border-collapse:collapse}
          th,td{border:1px solid #ddd;padding:6px}
          th{background:#f3f4f6;text-align:left}
          .right{text-align:right}
        </style>
      </head>
      <body>
        ${header}
        <h2 style=\"text-align:center\">Inventory (${filter})</h2>
        <table>
          <thead><tr><th>Item</th><th class=\"right\">Qty</th><th>Unit</th><th class=\"right\">Unit Cost</th><th class=\"right\">Total Value</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div style=\"text-align:center;margin-top:12px;font-size:11px;color:#555\">Powered By Coredigita</div>
      </body></html>`;
    const w = window.open('', '_blank');
    if (!w) { toast({ title: 'Popup blocked', description: 'Allow popups to print.', variant: 'destructive' }); return; }
    w.document.write(html);
    w.document.close();
    try { w.focus(); w.print(); } catch { }
  };

  // Export current filtered list by category (CSV)
  const handleExportByCategory = () => {
    const headers = ['Item', 'Qty', 'Unit', 'UnitCost', 'TotalValue'];
    const rows = filteredItems.map(i => [i.name, String(i.quantity), i.unit, Number(i.cost).toFixed(2), (i.quantity * Number(i.cost)).toFixed(2)]);
    const csv = [headers.join(','), ...rows.map(r => r.map(v => `\"${String(v).replace(/\"/g, '\"\"')}\"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `inventory_${filter}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  // Supplier list for filter dropdown
  const suppliersFromStore: string[] = (() => { try { const raw = localStorage.getItem('corepms_suppliers'); const list = raw ? JSON.parse(raw) : []; return Array.isArray(list) && list.length ? list.map((s: any) => String(s.name || s)) : ['Default Supplier']; } catch { return ['Default Supplier']; } })();
  // Map supplier -> set of itemIds from GRV vouchers
  const itemsBySupplier = (() => { try { const vr = localStorage.getItem('corepms_goods_received'); const vs = vr ? JSON.parse(vr) : []; const map = new Map<string, Set<string>>(); (Array.isArray(vs) ? vs : []).forEach((v: any) => { const s = String(v.supplier || ''); if (!map.has(s)) map.set(s, new Set<string>()); (v.items || []).forEach((it: any) => map.get(s)!.add(String(it.itemId))); }); return map; } catch { return new Map<string, Set<string>>(); } })();

  const filteredItems = (() => {
    let base = filter === 'all' ? inventory : filter === 'low' ? inventory.filter(i => i.quantity <= i.reorderLevel) : inventory.filter(i => i.category === filter);
    if (locationFilter !== 'all') base = base.filter(i => i.category === locationFilter);
    if (supplierFilter !== 'all') {
      const ids = itemsBySupplier.get(supplierFilter) || new Set<string>();
      base = base.filter(i => ids.has(String(i.id)));
    }
    return base;
  })();

  const totalValue = inventory.reduce((sum, item) => sum + (item.quantity * item.cost), 0);

  return (
    <div className="p-6">
      <div className="sticky top-0 z-40 bg-white/90 backdrop-blur border-b shadow-sm px-6 -mx-6 py-3 mb-4">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold">Inventory Management</h2>
          <div className="ds-toolbar">
            {dataSource === 'local' && inventory.length > 0 && (
              <button
                onClick={handlePushToCloud}
                disabled={isSyncing}
                className="ds-control px-3 py-2 rounded bg-amber-500 hover:bg-amber-600 text-white animate-pulse font-bold flex items-center gap-2"
              >
                {isSyncing ? (
                  <>
                    <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                    Syncing...
                  </>
                ) : '⚠️ Unsynced - Push to Cloud'}
              </button>
            )}
            <button className="ds-control px-3 py-2 rounded bg-indigo-600 text-white hover:bg-indigo-700" onClick={() => setAdjustOpen(true)}>Adjust Stock</button>
            <button className="ds-control px-3 py-2 rounded bg-teal-600 text-white hover:bg-teal-700" onClick={handlePrintByCategory}>Print Stock (by Category)</button>
            <button className="ds-control px-3 py-2 rounded bg-blue-600 text-white hover:bg-blue-700" onClick={handleExportByCategory}>Export CSV (by Category)</button>
            <button className="ds-control px-3 py-2 rounded bg-blue-700 text-white hover:bg-blue-800" onClick={async () => { const XLSX = await getXLSX(); if (!XLSX) { handleExportByCategory(); return; } const data = filteredItems.map(i => ({ Item: i.name, Qty: i.quantity, Unit: i.unit, UnitCost: i.cost, TotalValue: Number((i.quantity * i.cost).toFixed(2)) })); const ws = XLSX.utils.json_to_sheet(data); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Inventory'); XLSX.writeFile(wb, `inventory_${filter}.xlsx`); }}>Export Excel (XLSX)</button>
            <button className="ds-control px-3 py-2 rounded bg-green-600 text-white hover:bg-green-700" onClick={() => setGrvOpen(true)}>Receive Stock</button>
            <button className="ds-control px-3 py-2 rounded bg-gray-700 text-white hover:bg-gray-800" onClick={() => setSuppliersOpen(true)}>Manage Suppliers</button>
          </div>
        </div>
      </div>


      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
        <div className="bg-white rounded-xl shadow-lg p-6 border-l-4 border-blue-500">
          <p className="text-gray-600 text-sm font-medium mb-2">Total Items</p>
          <p className="text-3xl font-bold text-gray-800">{inventory.length}</p>
        </div>
        <div className="bg-white rounded-xl shadow-lg p-6 border-l-4 border-green-500">
          <p className="text-gray-600 text-sm font-medium mb-2">Total Value</p>
          <p className="text-3xl font-bold text-gray-800">${totalValue.toFixed(2)}</p>
        </div>
        <div className="bg-white rounded-xl shadow-lg p-6 border-l-4 border-red-500">
          <p className="text-gray-600 text-sm font-medium mb-2">Low Stock Items</p>
          <p className="text-3xl font-bold text-gray-800">
            {inventory.filter(i => i.quantity <= i.reorderLevel).length}
          </p>
        </div>
        <div className="bg-white rounded-xl shadow-lg p-6 border-l-4 border-purple-500">
          <p className="text-gray-600 text-sm font-medium mb-2">Categories</p>
          <p className="text-3xl font-bold text-gray-800">2</p>
        </div>
      </div>

      {grvOpen && (
        <GRVModal
          inventory={inventory}
          onClose={() => setGrvOpen(false)}
          onSaved={() => { setGrvOpen(false); loadInventoryFromPOS().then(setInventory); }}
        />
      )}
      {suppliersOpen && (
        <SuppliersModal onClose={() => setSuppliersOpen(false)} onSaved={() => setSuppliersOpen(false)} />
      )}

      <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => setFilter('all')}
            className={`px-4 py-2 rounded-lg font-medium ${filter === 'all' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}
          >
            All Items
          </button>
          <button
            onClick={() => setFilter('low')}
            className={`px-4 py-2 rounded-lg font-medium ${filter === 'low' ? 'bg-red-600 text-white' : 'bg-gray-200 text-gray-700'}`}
          >
            Low Stock
          </button>
          <button
            onClick={() => setFilter('Cellar')}
            className={`px-4 py-2 rounded-lg font-medium ${filter === 'Cellar' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}
          >
            Cellar
          </button>
          <button
            onClick={() => setFilter('Kitchen')}
            className={`px-4 py-2 rounded-lg font-medium ${filter === 'Kitchen' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}
          >
            Kitchen
          </button>
          <select className="px-4 py-2 rounded-lg border" value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)}>
            <option value="all">All Suppliers</option>
            {suppliersFromStore.map((s, idx) => (<option key={idx} value={s}>{s}</option>))}
          </select>
          <select className="px-4 py-2 rounded-lg border" value={locationFilter} onChange={(e) => setLocationFilter(e.target.value as any)}>
            <option value="all">All Locations</option>
            <option value="Kitchen">Kitchen</option>
            <option value="Cellar">Cellar</option>
          </select>
        </div>
      </div>

      {adjustOpen && (
        <div className="fixed inset-0 bg-black/40 z-[9998]" onClick={() => setAdjustOpen(false)}>
          <div className="fixed z-[9999] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-xl shadow-lg p-6 w-[90%] max-w-md" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-3">Adjust Stock</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium">Item</label>
                <select className="w-full border rounded p-2" value={adjustItemId} onChange={(e) => setAdjustItemId(e.target.value)}>
                  <option value="">Select item</option>
                  {inventory.map((it) => (
                    <option key={it.id} value={it.id}>{it.name}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-medium">Current</label>
                  <input className="w-full border rounded p-2" readOnly value={String(inventory.find((x) => x.id === adjustItemId)?.quantity ?? 0)} />
                </div>
                <div>
                  <label className="text-xs font-medium">Adjustment (±)</label>
                  <input type="number" className="w-full border rounded p-2" value={adjustDelta} onChange={(e) => setAdjustDelta(Number(e.target.value || 0))} />
                </div>
                <div>
                  <label className="text-xs font-medium">New</label>
                  <input className="w-full border rounded p-2" readOnly value={(() => {
                    const cur = inventory.find((x) => x.id === adjustItemId);
                    const curQty = Number(cur?.quantity || 0);
                    const nextQty = curQty + Number(adjustDelta || 0);
                    return nextQty < 0 ? 'Invalid' : String(nextQty);
                  })()} />
                </div>
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <button className="px-4 py-2 rounded bg-indigo-600 text-white hover:bg-indigo-700" onClick={() => {
                  const cur = inventory.find((x) => x.id === adjustItemId);
                  if (!cur) { toast({ title: 'No item selected', description: 'Select an item to adjust.', variant: 'destructive' }); return; }
                  const current = Number(cur.quantity || 0);
                  const delta = Number(adjustDelta || 0);
                  const next = current + delta;
                  if (next < 0) { toast({ title: 'Invalid adjustment', description: 'Adjustment would set stock below zero.', variant: 'destructive' }); return; }

                  // Update inventory state
                  const updatedInventory = inventory.map((it) => (it.id === adjustItemId ? { ...it, quantity: next } : it));
                  setInventory(updatedInventory);

                  // Save to POS data store
                  saveInventoryToPOS(updatedInventory);

                  // Create audit entry
                  createAuditEntry('STOCK_ADJUSTMENT', cur.name, current, next, delta);

                  // Show success message
                  toast({ title: 'Stock adjusted', description: `${cur.name}: ${current} → ${next} (${delta > 0 ? '+' : ''}${delta})` });

                  // Reset form
                  setAdjustItemId('');
                  setAdjustDelta(0);
                  setAdjustOpen(false);
                }}>Save</button>
                <button className="px-4 py-2 rounded border" onClick={() => { setAdjustItemId(''); setAdjustDelta(0); setAdjustOpen(false); }}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Scroll Progress Indicator */}
      {isScrolling && (
        <div className="fixed top-0 left-0 right-0 h-1 bg-gray-200 z-50">
          <div
            className="h-full bg-blue-600 transition-all duration-150 ease-out"
            style={{ width: `${scrollProgress}%` }}
          />
        </div>
      )}

      {/* Scrollable Table Container */}
      <div
        ref={tableContainerRef}
        className="bg-white rounded-xl shadow-lg overflow-auto relative"
        style={{
          height: 'calc(100vh - 400px)', // Dynamic height based on viewport
          maxHeight: '600px',
          minHeight: '300px',
          scrollBehavior: 'smooth',
          WebkitOverflowScrolling: 'touch', // Smooth scrolling on iOS
          overscrollBehavior: 'contain' // Prevent parent scrolling
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <table className="w-full">
          <thead className="bg-gray-100 sticky top-0 z-10 shadow-sm">
            <tr>
              <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Item Name</th>
              <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Category</th>
              <th className="px-6 py-4 text-right text-sm font-semibold text-gray-700">Quantity</th>
              <th className="px-6 py-4 text-right text-sm font-semibold text-gray-700">Reorder Level</th>
              <th className="px-6 py-4 text-right text-sm font-semibold text-gray-700">Unit Cost</th>
              <th className="px-6 py-4 text-right text-sm font-semibold text-gray-700">Total Value</th>
              <th className="px-6 py-4 text-center text-sm font-semibold text-gray-700">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {/* Virtual scrolling: only render visible items */}
            {filteredItems.slice(visibleRange.start, visibleRange.end).map((item, index) => {
              const actualIndex = visibleRange.start + index;
              return (
                <tr
                  key={item.id}
                  className="hover:bg-gray-50 transition-colors duration-150"
                  style={{
                    transform: 'translateZ(0)', // Hardware acceleration
                    willChange: 'transform'
                  }}
                >
                  <td className="px-6 py-4 text-sm font-medium text-gray-800">{item.name}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">{item.category}</td>
                  <td className="px-6 py-4 text-sm text-right text-gray-800">
                    {item.quantity} {item.unit}
                  </td>
                  <td className="px-6 py-4 text-sm text-right text-gray-600">
                    {item.reorderLevel} {item.unit}
                  </td>
                  <td className="px-6 py-4 text-sm text-right text-gray-800">${Number(item.cost).toFixed(2)}</td>
                  <td className="px-6 py-4 text-sm text-right font-semibold text-gray-800">
                    ${(item.quantity * Number(item.cost)).toFixed(2)}
                  </td>
                  <td className="px-6 py-4 text-center">
                    {item.quantity <= item.reorderLevel ? (
                      <span className="px-3 py-1 bg-red-100 text-red-700 rounded-full text-xs font-semibold">
                        Low Stock
                      </span>
                    ) : (
                      <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-xs font-semibold">
                        In Stock
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            {/* Spacer elements to maintain scroll height */}
            {visibleRange.start > 0 && (
              <tr style={{ height: `${visibleRange.start * ITEM_HEIGHT}px` }} />
            )}
            {visibleRange.end < filteredItems.length && (
              <tr style={{ height: `${(filteredItems.length - visibleRange.end) * ITEM_HEIGHT}px` }} />
            )}
          </tbody>
        </table>

        {/* Loading indicator for large datasets */}
        {filteredItems.length === 0 && (
          <div className="flex items-center justify-center py-12 text-gray-500">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2"></div>
              <p>No items found</p>
            </div>
          </div>
        )}

        {/* Scroll hint for better UX */}
        {filteredItems.length > 10 && (
          <div className="absolute bottom-2 right-2 bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-xs font-medium opacity-70">
            {filteredItems.length} items • Scroll to view more
          </div>
        )}
      </div>
    </div>
  );
};

/** Helper component binds events to the injected debug button */
const EventBinder: React.FC<{ onOpen: () => void }> = ({ onOpen }) => {
  useEffect(() => {
    const btn = document.getElementById('adjustStockBtn');
    if (!btn) return;
    const click = (e: Event) => {
      e.preventDefault();
      onOpen();
    };
    const enter = () => {
      try {
        btn.style.transform = 'scale(1.05)';
        btn.style.filter = 'brightness(0.9)';
      } catch { }
    };
    const leave = () => {
      try {
        btn.style.transform = 'scale(1.0)';
        btn.style.filter = 'none';
      } catch { }
    };
    const down = () => {
      try {
        btn.style.transform = 'scale(0.98)';
      } catch { }
    };
    const up = () => {
      try {
        btn.style.transform = 'scale(1.05)';
      } catch { }
    };

    btn.addEventListener('click', click);
    btn.addEventListener('mouseenter', enter);
    btn.addEventListener('mouseleave', leave);
    btn.addEventListener('mousedown', down);
    btn.addEventListener('mouseup', up);
    btn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      down();
      click(e);
    });
    btn.addEventListener('touchend', (e) => {
      e.preventDefault();
      up();
    });
    return () => {
      btn.removeEventListener('click', click);
      btn.removeEventListener('mouseenter', enter);
      btn.removeEventListener('mouseleave', leave);
      btn.removeEventListener('mousedown', down);
      btn.removeEventListener('mouseup', up);
    };
  }, [onOpen]);
  return null;
};

interface GRVModalProps {
  inventory: InventoryItem[];
  onClose: () => void;
  onSaved: () => void;
}

const GRVModal: React.FC<GRVModalProps> = ({ inventory, onClose, onSaved }) => {
  const today = new Date().toISOString().slice(0, 10);
  const [dateReceived, setDateReceived] = useState<string>(today);
  const [supplier, setSupplier] = useState<string>('');
  const [reference, setReference] = useState<string>('');
  const [location, setLocation] = useState<'Kitchen' | 'Cellar' | ''>('');
  const [rows, setRows] = useState<Array<{ itemId: string; qty: number; totalCost: number }>>([
    { itemId: '', qty: 0, totalCost: 0 }
  ]);
  const suppliers: string[] = (() => { try { const raw = localStorage.getItem('corepms_suppliers'); const list = raw ? JSON.parse(raw) : []; return Array.isArray(list) && list.length ? list.map((s: any) => String(s.name || s)) : ['Default Supplier']; } catch { return ['Default Supplier']; } })();

  const addRow = () => setRows(prev => [...prev, { itemId: '', qty: 0, totalCost: 0 }]);
  const removeRow = (idx: number) => setRows(prev => prev.filter((_, i) => i !== idx));
  const updateRow = (idx: number, patch: Partial<{ itemId: string; qty: number; totalCost: number }>) => setRows(prev => prev.map((r, i) => i === idx ? { ...r, ...patch } : r));

  const validate = (): string[] => {
    const errs: string[] = [];
    if (!dateReceived) errs.push('Date received is required');
    if (!supplier.trim()) errs.push('Supplier is required');
    if (!location) errs.push('Stock location is required');
    const validRows = rows.filter(r => r.itemId && r.qty > 0 && r.totalCost > 0);
    if (!validRows.length) errs.push('Add at least one item with qty and total cost');
    return errs;
  };

  const handleSave = () => {
    const errs = validate();
    if (errs.length) { toast({ title: 'Validation errors', description: errs.join(' • '), variant: 'destructive' }); return; }
    try {
      (async () => {
        try {
          const configured = await db.isConfigured();
          if (configured) {
            for (const r of rows) {
              if (!r.itemId || r.qty <= 0 || r.totalCost <= 0) continue;
              const curRes = await db.query<{ stock_level: number; cost_price: number }>(`SELECT stock_level, cost_price FROM products WHERE id = ?`, [r.itemId]);
              if ('rows' in curRes && curRes.rows && curRes.rows.length > 0) {
                const curQty = Number(curRes.rows[0].stock_level || 0);
                const curCost = Number(curRes.rows[0].cost_price || 0);
                const newQty = curQty + Number(r.qty);
                const newAvgCost = newQty > 0 ? ((curQty * curCost) + Number(r.totalCost)) / newQty : curCost;
                await db.query(`UPDATE products SET stock_level = ?, cost_price = ? WHERE id = ?`, [newQty, Number(newAvgCost.toFixed(2)), r.itemId]);
                await db.query(
                  `INSERT INTO inventory_movements (id, item_id, delta, reason, user_id) VALUES (?, ?, ?, ?, ?)`,
                  [`mov_${Date.now()}_${Math.random().toString(36).slice(2)}`, r.itemId, Number(r.qty), 'GRV', null]
                );
              }
            }
          }
        } catch { }
      })();
      // Load POS items
      const raw = localStorage.getItem('corepms_pos_items');
      const list: any[] = raw ? JSON.parse(raw) : [];
      const map = new Map<string, any>(list.map(it => [String(it.id), it]));
      // Update stock and average cost
      rows.forEach(r => {
        if (!r.itemId || r.qty <= 0 || r.totalCost <= 0) return;
        const pos = map.get(String(r.itemId)) || list.find(it => String(it.name).toLowerCase() === String(inventory.find(i => i.id === r.itemId)?.name || '').toLowerCase());
        if (!pos) return;
        const curQty = Number(pos.qtyInStock || 0);
        const curCost = Number(pos.cost || 0);
        const newQty = curQty + Number(r.qty);
        const newAvgCost = newQty > 0 ? ((curQty * curCost) + Number(r.totalCost)) / newQty : curCost;
        pos.qtyInStock = newQty;
        pos.cost = Number(newAvgCost.toFixed(2));
        // Store location for audit context (optional)
        pos.inventoryCategory = location === 'Cellar' ? 'cellar' : location === 'Kitchen' ? 'kitchen' : (pos.inventoryCategory || null);
      });
      localStorage.setItem('corepms_pos_items', JSON.stringify(Array.from(map.values())));
      // Save voucher
      const voucher = {
        id: `GRV_${Date.now()}`,
        dateReceived,
        supplier,
        reference,
        location,
        items: rows.filter(r => r.itemId && r.qty > 0 && r.totalCost > 0).map(r => ({ itemId: r.itemId, qty: r.qty, totalCost: r.totalCost }))
      };
      try {
        const vr = localStorage.getItem('corepms_goods_received');
        const vs = vr ? JSON.parse(vr) : [];
        vs.unshift(voucher);
        localStorage.setItem('corepms_goods_received', JSON.stringify(vs.slice(0, 500)));
      } catch { }
      // Audit entries: GRV_CREATE and per-item INVENTORY_RECEIPT
      try {
        const rawAudit = localStorage.getItem('corepms_pos_audit');
        const auditList = rawAudit ? JSON.parse(rawAudit) : [];
        const base = {
          timestamp: new Date().toISOString(),
          entity: 'STOCK',
          entityId: voucher.id
        };
        const header = { id: `AUD_${Date.now()}`, action: 'GRV_CREATE', ...base, details: { supplier, dateReceived, reference, location, items: voucher.items.length } };
        const itemEntries = voucher.items.map((it, idx) => ({ id: `AUD_${Date.now()}_${idx}`, action: 'INVENTORY_RECEIPT', entity: 'STOCK', entityId: it.itemId, timestamp: base.timestamp, details: { qty: it.qty, totalCost: it.totalCost, location } }));
        const nextAudit = [header, ...itemEntries, ...auditList].slice(0, 500);
        localStorage.setItem('corepms_pos_audit', JSON.stringify(nextAudit));
      } catch { }
      onSaved();
      toast({ title: 'Goods received', description: 'Voucher saved and stock updated.' });
    } catch (err) {
      console.error(err);
      toast({ title: 'Save failed', description: 'Failed to record goods received.', variant: 'destructive' });
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-[9998]" onClick={onClose}>
      <div className="fixed z-[9999] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-xl shadow-lg p-6 w-[95%] max-w-3xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold mb-3">Goods Received Voucher (GRV)</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
          <div>
            <label className="text-xs font-medium">Date Received *</label>
            <input type="date" className="w-full border rounded p-2" value={dateReceived} onChange={(e) => setDateReceived(e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-medium">Supplier/Vendor *</label>
            <select className="w-full border rounded p-2" value={supplier} onChange={(e) => setSupplier(e.target.value)}>
              <option value="">Select supplier</option>
              {suppliers.map((s, idx) => (<option key={idx} value={s}>{s}</option>))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium">Invoice / Reference No.</label>
            <input className="w-full border rounded p-2" value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-medium">Stock Location *</label>
            <div className="flex items-center gap-4 p-2">
              <label className="flex items-center gap-2"><input type="radio" name="grv-location" checked={location === 'Kitchen'} onChange={() => setLocation('Kitchen')} /> Kitchen</label>
              <label className="flex items-center gap-2"><input type="radio" name="grv-location" checked={location === 'Cellar'} onChange={() => setLocation('Cellar')} /> Cellar</label>
            </div>
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-semibold">Received Items</div>
            <button className="px-3 py-2 rounded bg-gray-200" onClick={addRow}>Add Row</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><th className="text-left p-2">Item *</th><th className="text-right p-2">Qty *</th><th className="text-right p-2">Unit Cost (Total) *</th><th className="text-center p-2">Actions</th></tr></thead>
              <tbody>
                {rows.map((r, idx) => (
                  <tr key={idx} className="border-t">
                    <td className="p-2">
                      <select className="w-full border rounded p-2" value={r.itemId} onChange={(e) => updateRow(idx, { itemId: e.target.value })}>
                        <option value="">Select item</option>
                        {inventory.map(it => (<option key={it.id} value={it.id}>{it.name}</option>))}
                      </select>
                    </td>
                    <td className="p-2 text-right">
                      <input type="number" className="w-full border rounded p-2" value={r.qty} onChange={(e) => updateRow(idx, { qty: Number(e.target.value || 0) })} />
                    </td>
                    <td className="p-2 text-right">
                      <input type="number" step="0.01" className="w-full border rounded p-2" value={r.totalCost} onChange={(e) => updateRow(idx, { totalCost: Number(e.target.value || 0) })} />
                    </td>
                    <td className="p-2 text-center">
                      <button className="px-2 py-1 rounded bg-red-100 text-red-700" onClick={() => removeRow(idx)}>Remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="flex gap-2 justify-end mt-4">
          <button className="px-4 py-2 rounded border" onClick={onClose}>Cancel</button>
          <button className="px-4 py-2 rounded bg-green-600 text-white hover:bg-green-700" onClick={handleSave}>Save / Receive Goods</button>
        </div>
      </div>
    </div>
  );
};

interface SuppliersModalProps {
  onClose: () => void;
  onSaved: () => void;
}

const SuppliersModal: React.FC<SuppliersModalProps> = ({ onClose, onSaved }) => {
  const readSuppliers = (): Array<{ id: string; name: string }> => {
    try {
      const raw = localStorage.getItem('corepms_suppliers');
      const list = raw ? JSON.parse(raw) : [];
      return (Array.isArray(list) ? list : []).map((s: any) => ({ id: s.id || `SUP_${Math.random().toString(36).slice(2)}`, name: String(s.name || s), contact: String(s.contact || ''), phone: String(s.phone || ''), address: String(s.address || '') }));
    } catch { return []; }
  };
  const [suppliers, setSuppliers] = useState<Array<{ id: string; name: string; contact?: string; phone?: string; address?: string }>>(readSuppliers());
  const [newName, setNewName] = useState('');
  const [newContact, setNewContact] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newAddress, setNewAddress] = useState('');

  const saveAll = () => {
    try { localStorage.setItem('corepms_suppliers', JSON.stringify(suppliers)); } catch { }
  };
  const addSupplier = () => {
    const name = newName.trim(); if (!name) return;
    setSuppliers(prev => [{ id: `SUP_${Date.now()}`, name, contact: newContact.trim(), phone: newPhone.trim(), address: newAddress.trim() }, ...prev].slice(0, 500));
    setNewName(''); setNewContact(''); setNewPhone(''); setNewAddress('');
  };
  const delSupplier = (id: string) => {
    setSuppliers(prev => prev.filter(s => s.id !== id));
  };
  const patchSupplier = (id: string, patch: Partial<{ name: string; contact: string; phone: string; address: string }>) => {
    setSuppliers(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-[9998]" onClick={onClose}>
      <div className="fixed z-[9999] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-xl shadow-lg p-6 w-[95%] max-w-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold mb-3">Suppliers</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mb-3">
          <input className="border rounded p-2" placeholder="Supplier name" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <input className="border rounded p-2" placeholder="Contact person" value={newContact} onChange={(e) => setNewContact(e.target.value)} />
          <input className="border rounded p-2" placeholder="Phone" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />
          <input className="border rounded p-2" placeholder="Address" value={newAddress} onChange={(e) => setNewAddress(e.target.value)} />
          <div className="md:col-span-4 flex items-center justify-end">
            <button className="px-3 py-2 rounded bg-gray-200" onClick={addSupplier}>Add Supplier</button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr><th className="text-left p-2">Name</th><th className="text-left p-2">Contact</th><th className="text-left p-2">Phone</th><th className="text-left p-2">Address</th><th className="p-2 text-center">Actions</th></tr></thead>
            <tbody>
              {suppliers.map(s => (
                <tr key={s.id} className="border-t">
                  <td className="p-2"><input className="w-full border rounded p-2" value={s.name} onChange={(e) => patchSupplier(s.id, { name: e.target.value })} /></td>
                  <td className="p-2"><input className="w-full border rounded p-2" value={s.contact || ''} onChange={(e) => patchSupplier(s.id, { contact: e.target.value })} /></td>
                  <td className="p-2"><input className="w-full border rounded p-2" value={s.phone || ''} onChange={(e) => patchSupplier(s.id, { phone: e.target.value })} /></td>
                  <td className="p-2"><input className="w-full border rounded p-2" value={s.address || ''} onChange={(e) => patchSupplier(s.id, { address: e.target.value })} /></td>
                  <td className="p-2 text-center"><button className="px-2 py-1 rounded bg-red-100 text-red-700" onClick={() => delSupplier(s.id)}>Delete</button></td>
                </tr>
              ))}
              {!suppliers.length && (<tr><td className="p-2" colSpan={5}>No suppliers yet. Add one above.</td></tr>)}
            </tbody>
          </table>
        </div>
        <div className="flex gap-2 justify-end mt-4">
          <button className="px-4 py-2 rounded border" onClick={onClose}>Close</button>
          <button className="px-4 py-2 rounded bg-gray-700 text-white hover:bg-gray-800" onClick={() => { saveAll(); onSaved(); }}>Save</button>
        </div>
      </div>
    </div>
  );
};
