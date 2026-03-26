import React, { useCallback, useMemo, useState, useEffect, useRef } from 'react';
import { useData } from '@/context/DataContext';
import { useAuth } from '@/context/AuthContext';
import { useShift } from '@/contexts/ShiftContext';
import { formatCurrency, generateShiftXReadingHTML, printDocument, createAuditEntry, decrementInventory } from '@/lib/posIntegration';
import { Header } from '@/components/posimport/Header';
import { TableCard } from '@/components/posimport/TableCard';
import { OrderModal } from '@/components/posimport/OrderModal';
import { PaymentModal } from '@/components/pos/POSIntegrationComponents';
import { BillSummary, QuickActions } from '@/components/pos/POSIntegrationComponents';
import { getMenuItems } from '@/lib/posIntegration';
import { useInactivityTimeout } from '@/hooks/useInactivityTimeout';
import { PINModal } from '@/components/pos/PINModal';
import { generateReceiptHTML } from '@/lib/posIntegration';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { readReceiptBranding } from '@/lib/printSettings';
import { db } from '@/lib/db';

export const POSFrontOffice: React.FC = () => {
  const { guests, recordFolioCharge, removeFolioCharge, loading, posOrders, savePosOrder, closePosOrder } = useData();
  const { activeShift, startShift, endShift, getTotals, addTransaction } = useShift();
  const { user, costCentre, shiftId, isLocked, setIsLocked, verifyPosPin } = useAuth();

  // 90-second inactivity timeout
  useInactivityTimeout(90000, () => {
    if (activeShift && costCentre) {
      setIsLocked(true);
    }
  }, !!activeShift && !!costCentre && !isLocked);

  const [mountLoading, setMountLoading] = useState<boolean>(false);
  const [tables, setTables] = useState<Array<{ id: string; number: number; status: 'available' | 'occupied' | 'suspended'; currentBill?: any }>>(
    Array.from({ length: 12 }).map((_, idx) => ({ id: `t${idx + 1}`, number: idx + 1, status: 'available' }))
  );
  const [orderModal, setOrderModal] = useState<{ tableId: string; open: boolean } | null>(null);
  const [paymentModal, setPaymentModal] = useState<{ bill: any | null; open: boolean }>({ bill: null, open: false });
  const [voidOpen, setVoidOpen] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [kitchenOpen, setKitchenOpen] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [splitCount, setSplitCount] = useState<number>(2);
  const [destTableId, setDestTableId] = useState<string>('');
  const [voidReason, setVoidReason] = useState<string>('');
  const [managerId, setManagerId] = useState<string>('');
  const [pendingVoid, setPendingVoid] = useState<{ reason: string; managerId: string } | null>(null);

  // Table management controls
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'available' | 'occupied' | 'suspended'>('all');
  const [sortKey, setSortKey] = useState<'number' | 'status'>('number');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [pageSize, setPageSize] = useState<number>(12);
  const [page, setPage] = useState<number>(1);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const logPaymentError = (step: string, error: any, ctx?: any) => {
    try {
      const entry = { step, error: String((error && (error.message || error)) || 'Unknown'), ctx, at: new Date().toISOString() };
      const raw = localStorage.getItem('corepms_payment_errors');
      const list = raw ? JSON.parse(raw) : [];
      localStorage.setItem('corepms_payment_errors', JSON.stringify([entry, ...list].slice(0, 500)));
    } catch { }
  };

  const [menuItems, setMenuItems] = useState<Array<{ id: string; name: string; price: number; category: 'food' | 'bar'; image?: string }>>([]);
  useEffect(() => {
    const refresh = async () => {
      try {
        const list = await getMenuItems(costCentre || undefined);
        // Add empty image property to ensure type compatibility
        const safeList = Array.isArray(list) ? list : [];
        console.log("[POS Items Debug - Retrieved]", safeList.length, "items");
        if (safeList.length > 0) {
          console.log("[POS Items Debug - Example]", safeList[0]);
          const barItems = safeList.filter((i: any) => i.category === 'bar');
          console.log("[POS Items Debug - Bar Count]", barItems.length);
          console.log("[POS Items Debug - Sample Bar Items]", barItems.slice(0, 5));
        }
        const listWithImages = safeList.map((item: any) => ({ ...item, image: item.image || '' }));
        setMenuItems(listWithImages);
      } catch (err) { console.error('Menu refresh failed', err); }
    };
    // Initial and periodic refresh (every 60s) to meet 5-minute SLA comfortably
    refresh();
    const iv = setInterval(refresh, 60_000);
    const onStorage = (e: StorageEvent) => { if (e.key === 'corepms_pos_items') refresh(); };
    window.addEventListener('storage', onStorage);
    return () => { clearInterval(iv); window.removeEventListener('storage', onStorage); };
  }, []);

  useEffect(() => {
    // Clear potentially stale localStorage on mount to ensure clean slate if needed
    // But we need to keep 'corepms_pos_table_states' until we process it.
    // Instead, let's just log.
    console.log('[POS] Front Office Mounted');
  }, []);

  // Persist and restore controls
  useEffect(() => {
    try {
      const raw = localStorage.getItem('corepms_pos_table_controls');
      if (raw) {
        const s = JSON.parse(raw);
        if (typeof s.search === 'string') setSearch(s.search);
        if (s.statusFilter) setStatusFilter(s.statusFilter);
        if (s.sortKey) setSortKey(s.sortKey);
        if (s.sortDir) setSortDir(s.sortDir);
        if (s.pageSize) setPageSize(s.pageSize);
      }
    } catch { }
  }, []);

  useEffect(() => {
    try {
      const payload = { search, statusFilter, sortKey, sortDir, pageSize };
      localStorage.setItem('corepms_pos_table_controls', JSON.stringify(payload));
    } catch { }
  }, [search, statusFilter, sortKey, sortDir, pageSize]);

  // Persist and restore table states (run after database init)
  useEffect(() => {
    // Only restore if we're not still loading from database
    if (typeof mountLoading !== 'undefined' && mountLoading) return;

    try {
      const raw = localStorage.getItem('corepms_pos_table_states');
      const savedStates = raw ? JSON.parse(raw) : {};

      setTables(prev => {
        const safePrev = Array.isArray(prev) ? prev : [];
        return safePrev.map(table => {
          const saved = savedStates[table.id];
          let nextTable = { ...table };

          if (saved) {
            // Only restore if the saved state is more recent or if database didn't set it to occupied
            // This prevents database initialization from overriding manually cleared tables
            const shouldRestore = saved.status === 'available' ||
              (saved.status === 'occupied' && saved.currentBill);

            if (shouldRestore) {
              nextTable = {
                ...table,
                status: saved.status || table.status,
                currentBill: saved.currentBill || undefined
              };
            }
          }

          // Fix for Table State Anomaly:
          // If table is occupied but has no active bill, reset to available.
          if (nextTable.status === 'occupied' && !nextTable.currentBill) {
            console.log(`[POS] Fixing anomaly for table ${table.id}: Occupied but no bill -> Setting Available`);
            nextTable.status = 'available';
            // Ensure DB is consistent
            updateTableStatus(table.id, 'available');
          }

          return nextTable;
        });
      });
    } catch { }
  }, [mountLoading]);

  // Persist table states whenever they change
  useEffect(() => {
    try {
      const safeTables = Array.isArray(tables) ? tables : [];
      const tableStates = safeTables.reduce((acc, table) => {
        acc[table.id] = {
          status: table.status,
          currentBill: table.currentBill
        };
        return acc;
      }, {} as Record<string, any>);
      localStorage.setItem('corepms_pos_table_states', JSON.stringify(tableStates));
    } catch { }
  }, [tables]);

  const receiptSettings = readReceiptBranding();

  // Format bill ID to 4 digits for display
  const formatBillNumber = (billId: string): string => {
    const numericPart = billId.replace(/\D/g, '');
    return numericPart.slice(-4).padStart(4, '0');
  };

  // Determine outlet from bill items (bar vs restaurant/food)
  const getOutletFromBill = (bill: any): string => {
    if (!bill || !Array.isArray(bill.items) || !bill.items.length) {
      return 'Restaurant POS'; // Default to restaurant
    }
    // Count bar vs food items
    const barCount = bill.items.filter((i: any) => i.menuItem?.category === 'bar').length;
    const foodCount = bill.items.filter((i: any) => i.menuItem?.category === 'food').length;
    // If majority are bar items, it's a Bar POS transaction
    return barCount > foodCount ? 'Bar POS' : 'Restaurant POS';
  };
  const isLoading = loading || !Array.isArray(posOrders);
  const [connError, setConnError] = useState<string | null>(null);
  const debouncedTimerRef = useRef<any>(null);
  const pendingBillRef = useRef<any>(null);

  useEffect(() => {
    const run = async () => {
      setMountLoading(true);
      try {
        const ready = await db.waitForReady();
        if (!ready) {
          setConnError('Database initialization timed out after 90s');
          setMountLoading(false);
          return;
        }
        const cfg = await db.getConnectionConfig();
        if (cfg && cfg.host && cfg.host !== '0.0.0.0') {
          setConnError('Database not bound to 0.0.0.0');
        } else {
          setConnError(null);
        }
        const res = await db.query(`SELECT table_id, status FROM table_status WHERE cost_center = $1`, [costCentre || 'Main Restaurant']);
        if ('rows' in res) {
          const statusMap: Record<string, 'available' | 'occupied' | 'suspended'> = {};
          const safeRows = Array.isArray(res.rows) ? res.rows : [];
          safeRows.forEach((r: any) => {
            // Map database status to frontend status
            if (r.status === 'open') {
              statusMap[r.table_id] = 'available';
            } else if (r.status === 'occupied') {
              statusMap[r.table_id] = 'occupied';
            } else if (r.status === 'closed') {
              statusMap[r.table_id] = 'suspended';
            }
          });

          setTables(prev => {
            const safePrev = Array.isArray(prev) ? prev : [];
            return safePrev.map(t => {
              const status = statusMap[t.id] || t.status;
              return { ...t, status, cost_center: costCentre || 'Main Restaurant' };
            });
          });
        }
      } catch (e: any) {
        setConnError(e?.message || 'Failed to fetch table status');
      } finally {
        setMountLoading(false);
      }
    };
    run();
  }, []);

  const updateTableStatus = useCallback(async (tableId: string, status: 'available' | 'occupied' | 'suspended') => {
    const mapped = status === 'suspended' ? 'closed' : (status === 'available' ? 'open' : status);
    try {
      await db.query(
        `
          INSERT INTO table_status (table_id, status, cost_center, last_update)
          VALUES ($1, $2, $3, NOW())
          ON CONFLICT (table_id, cost_center) DO UPDATE SET status = EXCLUDED.status, last_update = NOW()
        `,
        [tableId, mapped, costCentre || 'Main Restaurant']
      );
    } catch { }
  }, []);

  const handleTableClick = useCallback((tableId: string) => {
    const safeTables = Array.isArray(tables) ? tables : [];
    const table = safeTables.find(t => t.id === tableId);
    if (!table) return;
    if (table.currentBill) {
      setPaymentModal({ bill: table.currentBill, open: true });
    } else {
      setOrderModal({ tableId, open: true });
    }
  }, [tables]);

  const toggleSuspend = useCallback((tableId: string) => {
    const safeTables = Array.isArray(tables) ? tables : [];
    const table = safeTables.find(t => t.id === tableId);
    if (!table) return;
    setTables(prev => {
      const safePrev = Array.isArray(prev) ? prev : [];
      return safePrev.map(t => {
        if (t.id !== tableId) return t;
        const nextStatus = t.status === 'suspended' ? 'available' : 'suspended';
        return { ...t, status: nextStatus };
      });
    });
    updateTableStatus(tableId, 'suspended');
  }, []);

  const clearBill = useCallback(async (tableId: string) => {
    if (closePosOrder) await closePosOrder(tableId, costCentre || undefined);
    setTables(prev => {
      const safePrev = Array.isArray(prev) ? prev : [];
      return safePrev.map(t => t.id === tableId ? { ...t, currentBill: undefined, status: 'available' } : t);
    });
    // Audit
    const entry = createAuditEntry('CLEAR_BILL', 'TABLE', tableId, 'server-1');
    try { const raw = localStorage.getItem('corepms_pos_audit'); const list = raw ? JSON.parse(raw) : []; localStorage.setItem('corepms_pos_audit', JSON.stringify([entry, ...list].slice(0, 50))); } catch { }
    updateTableStatus(tableId, 'available');
  }, [closePosOrder, updateTableStatus]);

  const visibleTables = useMemo(() => {
    const safeTables = Array.isArray(tables) ? tables : [];
    let list = safeTables;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(t => String(t.number).includes(q));
    }
    if (statusFilter !== 'all') {
      list = list.filter(t => t.status === statusFilter);
    }
    list = list.slice().sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'number') cmp = a.number - b.number;
      else cmp = a.status.localeCompare(b.status);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    return list.slice(start, end);
  }, [tables, search, statusFilter, sortKey, sortDir, page, pageSize]);

  const activeTableId = useMemo(() => {
    const safeTables = Array.isArray(tables) ? tables : [];
    if (selectedIds.length) {
      const id = selectedIds.find(id => !!safeTables.find(t => t.id === id && t.currentBill));
      if (id) return id;
    }
    const occupiedWithBill = safeTables.find(t => t.currentBill);
    return occupiedWithBill ? occupiedWithBill.id : undefined;
  }, [tables, selectedIds]);

  const currentBill = useMemo(() => {
    const safeTables = Array.isArray(tables) ? tables : [];
    const t = safeTables.find(t => t.id === activeTableId);
    return t && t.currentBill ? t.currentBill : null;
  }, [tables, activeTableId]);

  const actions = useMemo(() => {
    return [
      {
        id: 'quick-settle',
        label: 'Quick Settle',
        onClick: () => { if (currentBill) setPaymentModal({ bill: currentBill, open: true }); },
        disabled: !currentBill
      },
      {
        id: 'void',
        label: 'Void',
        color: 'destructive' as const,
        onClick: () => setVoidOpen(true),
        disabled: !currentBill
      },
      {
        id: 'send-kitchen',
        label: 'Send to Kitchen',
        onClick: () => setKitchenOpen(true),
        disabled: !currentBill
      },
      {
        id: 'print',
        label: 'Print',
        onClick: () => setPrintOpen(true),
        disabled: !currentBill
      },
      {
        id: 'split',
        label: 'Split',
        color: 'secondary' as const,
        onClick: () => setSplitOpen(true),
        disabled: !currentBill
      },
      {
        id: 'transfer',
        label: 'Transfer',
        color: 'outline' as const,
        onClick: () => setTransferOpen(true),
        disabled: !currentBill
      }
    ];
  }, [currentBill]);

  const transferBillTo = useCallback((sourceId: string, destId: string) => {
    setTables(prev => {
      const safePrev = Array.isArray(prev) ? prev : [];
      const source = safePrev.find(t => t.id === sourceId);
      const dest = safePrev.find(t => t.id === destId);
      if (!source || !source.currentBill || !dest || sourceId === destId) return prev;
      if (dest.currentBill) return prev;
      return safePrev.map(t => {
        if (t.id === sourceId) return { ...t, currentBill: undefined, status: 'available' };
        if (t.id === destId) return { ...t, currentBill: { ...source.currentBill, tableId: destId }, status: 'occupied' };
        return t;
      });
    });
    try {
      const entry = createAuditEntry('TRANSFER_BILL', 'TABLE', sourceId, 'server-1', { to: destId });
      const raw = localStorage.getItem('corepms_pos_audit'); const list = raw ? JSON.parse(raw) : []; localStorage.setItem('corepms_pos_audit', JSON.stringify([entry, ...list].slice(0, 50)));
    } catch { }
    updateTableStatus(sourceId, 'available');
    updateTableStatus(destId, 'occupied');
  }, []);

  const toggleSelect = useCallback((tableId: string) => {
    setSelectedIds(prev => prev.includes(tableId) ? prev.filter(id => id !== tableId) : [...prev, tableId]);
  }, []);

  const selectAllVisible = useCallback(() => {
    setSelectedIds((visibleTables || []).map(t => t.id));
  }, [visibleTables]);

  const deselectAll = useCallback(() => setSelectedIds([]), []);

  const bulkSuspend = useCallback(() => {
    setTables(prev => {
      const safePrev = Array.isArray(prev) ? prev : [];
      return safePrev.map(t => selectedIds.includes(t.id) ? { ...t, status: 'suspended' } : t);
    });
    const entries = selectedIds.map(id => createAuditEntry('SUSPEND_TABLE', 'TABLE', id, 'server-1'));
    try { const raw = localStorage.getItem('corepms_pos_audit'); const list = raw ? JSON.parse(raw) : []; localStorage.setItem('corepms_pos_audit', JSON.stringify([...entries, ...list].slice(0, 50))); } catch { }
    setSelectedIds([]);
  }, [selectedIds]);

  const bulkResume = useCallback(() => {
    setTables(prev => {
      const safePrev = Array.isArray(prev) ? prev : [];
      return safePrev.map(t => selectedIds.includes(t.id) ? { ...t, status: 'available' } : t);
    });
    const entries = selectedIds.map(id => createAuditEntry('RESUME_TABLE', 'TABLE', id, 'server-1'));
    try { const raw = localStorage.getItem('corepms_pos_audit'); const list = raw ? JSON.parse(raw) : []; localStorage.setItem('corepms_pos_audit', JSON.stringify([...entries, ...list].slice(0, 50))); } catch { }
    setSelectedIds([]);
  }, [selectedIds]);

  const bulkClear = useCallback(() => {
    setTables(prev => {
      const safePrev = Array.isArray(prev) ? prev : [];
      return safePrev.map(t => selectedIds.includes(t.id) ? { ...t, currentBill: undefined, status: 'available' } : t);
    });
    const entries = selectedIds.map(id => createAuditEntry('CLEAR_BILL', 'TABLE', id, 'server-1'));
    try { const raw = localStorage.getItem('corepms_pos_audit'); const list = raw ? JSON.parse(raw) : []; localStorage.setItem('corepms_pos_audit', JSON.stringify([...entries, ...list].slice(0, 50))); } catch { }
    setSelectedIds([]);
  }, [selectedIds]);

  const totalFiltered = useMemo(() => {
    const safeTables = Array.isArray(tables) ? tables : [];
    let list = safeTables;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(t => String(t.number).includes(q));
    }
    if (statusFilter !== 'all') {
      list = list.filter(t => t.status === statusFilter);
    }
    return list.length;
  }, [tables, search, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
  if (page > totalPages) {
    // Clamp page if filters changed
    setPage(1);
  }

  const saveOrder = async (bill: any) => {
    const safeTables = Array.isArray(tables) ? tables : [];
    const prev = safeTables;
    const next = safeTables.map(t =>
      t.id === bill.tableId ? { ...t, status: 'occupied' as const, currentBill: bill } : t
    );
    setTables(next);
    pendingBillRef.current = bill;
    if (debouncedTimerRef.current) clearTimeout(debouncedTimerRef.current);
    debouncedTimerRef.current = setTimeout(async () => {
      const current = pendingBillRef.current;
      const ok = await (typeof savePosOrder === 'function'
        ? savePosOrder({ 
            table: current.tableId, 
            items: current.items, 
            total: current.total,
            cost_center: costCentre || 'Main Restaurant',
            shift_id: shiftId
          })
        : Promise.resolve(true));
      if (!ok) {
        setTables(prev);
        alert('Database Write Failed: POS order could not be saved');
      } else {
        updateTableStatus(current.tableId, 'occupied');
      }
    }, 400);
  };

  const processPayment = async (paymentData: any) => {
    const bill = paymentModal.bill;
    if (!bill) return;
    const total = bill.total;

    let folioPosted = false;
    let folioChargeId: string | null = null;
    if (paymentData.paymentMethod === 'room-charge') {
      const guest = guests.find(g => g.roomNumber === paymentData.roomNumber);
      if (!guest) {
        alert('No checked-in guest found for this room number.');
        logPaymentError('authorization', new Error('Guest not found for room charge'), { roomNumber: paymentData.roomNumber });
      } else {
        try {
          // Use outlet-specific description with 4-digit bill number
          const outletName = getOutletFromBill(bill);
          const shortBillNum = formatBillNumber(bill.id);
          folioChargeId = recordFolioCharge ? recordFolioCharge({
            guestId: guest.id,
            amount: Number(total.toFixed(2)),
            description: `${outletName} - bill-${shortBillNum}`,
            date: new Date().toISOString().split('T')[0]
          }) : null;
          folioPosted = !!folioChargeId || true;
        } catch (err) {
          logPaymentError('folio_post', err, { guestId: guest.id, billId: bill.id });
        }
      }
    }

    try {
      addTransaction(paymentData.paymentMethod, Number(total.toFixed(2)), bill.id);
    } catch (err) {
      console.warn('Shift logging failed:', err);
      logPaymentError('shift_log', err, { method: paymentData.paymentMethod, amount: total, billId: bill.id });
    }

    // Auto-deplete inventory for sold items
    try {
      const soldItems = bill.items.map((i: any) => ({ name: i.menuItem.name, quantity: Number(i.quantity || 0) }));
      decrementInventory(soldItems, costCentre || 'Main Restaurant', shiftId || 'unknown');
    } catch (err) {
      console.warn('Inventory depletion failed:', err);
      logPaymentError('inventory', err, { billId: bill.id });
    }

    // Close POS order in DB to prevent reversion to occupied state
    if (closePosOrder) {
      await closePosOrder(bill.tableId, costCentre || undefined);
    }

    setTables(prev => prev.map(t =>
      t.id === bill.tableId ? { ...t, status: 'available', currentBill: undefined } : t
    ));
    // Update database status (legacy fallback)
    updateTableStatus(bill.tableId, 'available');
    setPaymentModal({ bill: null, open: false });

    // Log closed bill for 24h recall
    try {
      const record = { id: bill.id, tableId: bill.tableId, total: paymentData.amount || total, items: bill.items, paymentMethod: paymentData.paymentMethod, closedAt: new Date().toISOString(), processedBy: paymentData.processedBy };
      const raw = localStorage.getItem('corepms_closed_bills'); const list = raw ? JSON.parse(raw) : [];
      localStorage.setItem('corepms_closed_bills', JSON.stringify([record, ...list].filter(r => {
        const age = Date.now() - new Date(r.closedAt).getTime();
        return age < 24 * 60 * 60 * 1000;
      }).slice(0, 500)));
    } catch (err) { logPaymentError('closed_bill_log', err, { billId: bill.id }); }

    return { ok: true, method: paymentData.paymentMethod, billId: bill.id, folioPosted, folioChargeId };
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />

      {/* PIN Lock Overlay */}
      <PINModal
        isOpen={isLocked}
        onClose={() => {}} // User cannot close without PIN
        onSuccess={() => setIsLocked(false)}
        title="POS Session Locked"
        verifyPin={verifyPosPin}
      />

      <div className="p-6">
        {(isLoading || mountLoading) && (
          <div className="bg-white rounded-xl shadow p-6 text-center text-gray-600">Loading...</div>
        )}
        {!!connError && (
          <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 rounded p-3 text-sm mb-4">{connError}</div>
        )}
        {/* Controls */}
        <div className="bg-white rounded-xl shadow p-4 mb-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div className="flex-1 flex items-center gap-3">
              <Input
                placeholder="Search table #"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                className="max-w-xs"
              />
              <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v as any); setPage(1); }}>
                <SelectTrigger className="w-36">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="available">Available</SelectItem>
                  <SelectItem value="occupied">Occupied</SelectItem>
                  <SelectItem value="suspended">Suspended</SelectItem>
                </SelectContent>
              </Select>
              <Select value={sortKey} onValueChange={(v) => setSortKey(v as any)}>
                <SelectTrigger className="w-36">
                  <SelectValue placeholder="Sort" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="number">Table #</SelectItem>
                  <SelectItem value="status">Status</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" onClick={() => setSortDir(sortDir === 'asc' ? 'desc' : 'asc')}>
                {sortDir === 'asc' ? 'Asc' : 'Desc'}
              </Button>
            </div>
            <div className="flex items-center gap-3">
              <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}>
                <SelectTrigger className="w-28">
                  <SelectValue placeholder="Page size" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="6">6</SelectItem>
                  <SelectItem value="12">12</SelectItem>
                  <SelectItem value="18">18</SelectItem>
                  <SelectItem value="24">24</SelectItem>
                </SelectContent>
              </Select>
              <div className="text-sm text-gray-600">Page {page} / {totalPages}</div>
              <div className="flex gap-2">
                <Button variant="outline" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>Prev</Button>
                <Button variant="outline" disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>Next</Button>
              </div>
              {/* Bulk actions */}
              <div className="flex gap-2">
                <Button variant="outline" onClick={selectAllVisible}>Select All</Button>
                <Button variant="outline" onClick={deselectAll}>Deselect</Button>
                <Button variant="secondary" onClick={bulkSuspend} disabled={!selectedIds.length}>Suspend</Button>
                <Button variant="secondary" onClick={bulkResume} disabled={!selectedIds.length}>Resume</Button>
                <Button variant="destructive" onClick={bulkClear} disabled={!selectedIds.length}>Clear</Button>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4 md:gap-6">
              {(visibleTables || []).map(table => (
                <TableCard
                  key={table.id}
                  table={{ ...table, cost_center: costCentre || 'Main Restaurant' } as any}
                  onClick={() => handleTableClick(table.id)}
                  onToggleSuspend={() => toggleSuspend(table.id)}
                  onClearBill={() => clearBill(table.id)}
                />
              ))}
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-lg p-6">
            <h3 className="text-xl font-bold text-gray-800 mb-4">Current Bill</h3>
            {currentBill ? (
              <div className="mb-4">
                <BillSummary
                  bill={{
                    id: currentBill.id,
                    items: Array.isArray(currentBill.items)
                      ? currentBill.items.map((i: any) => ({ name: i.menuItem.name, quantity: i.quantity, price: i.menuItem.price, subtotal: i.subtotal }))
                      : [],
                    subtotal: Array.isArray(currentBill.items)
                      ? currentBill.items.reduce((s: number, i: any) => s + i.subtotal, 0)
                      : 0,
                    tax: 0,
                    total: currentBill.total,
                    createdAt: new Date().toISOString(),
                    customerName: currentBill.customerName,
                    roomNumber: currentBill.roomNumber
                  }}
                />
              </div>
            ) : (
              <div className="text-sm text-gray-500">No bill selected</div>
            )}
            <div className="pt-2">
              <QuickActions actions={actions} />
            </div>

            <Dialog open={voidOpen} onOpenChange={setVoidOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Confirm Void</DialogTitle>
                  <DialogDescription>Void the entire bill for the selected table.</DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  <div className="text-sm">
                    {currentBill && (
                      <div className="flex justify-between p-2 rounded bg-red-50 border border-red-200">
                        <span>Bill {currentBill.id}</span>
                        <span>{formatCurrency(currentBill.total)}</span>
                      </div>
                    )}
                  </div>
                  <div>
                    <Label>Reason</Label>
                    <Select value={voidReason} onValueChange={(v) => setVoidReason(v)}>
                      <SelectTrigger className="mt-1">
                        <SelectValue placeholder="Select a reason" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="error_entered">Error entered</SelectItem>
                        <SelectItem value="customer_returned">Customer returned</SelectItem>
                        <SelectItem value="payment_reversal">Payment reversal</SelectItem>
                        <SelectItem value="duplicate_charge">Duplicate charge</SelectItem>
                        <SelectItem value="fraud_suspected">Fraud suspected</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Manager ID</Label>
                    <Input value={managerId} onChange={(e) => setManagerId(e.target.value)} placeholder="e.g., MGR-001" />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setVoidOpen(false)}>Cancel</Button>
                  <Button variant="destructive" onClick={() => { if (!currentBill) return; if (!voidReason) { alert('Select a reason'); return; } if (!managerId.trim()) { alert('Enter manager ID'); return; } setVoidOpen(false); setPaymentModal({ bill: currentBill, open: true }); setPendingVoid({ reason: voidReason, managerId }); }}>Proceed to Authorization</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Dialog open={printOpen} onOpenChange={setPrintOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Print Bill</DialogTitle>
                  <DialogDescription>Print the current bill.</DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setPrintOpen(false)}>Cancel</Button>
                  <Button onClick={() => {
                    if (!currentBill) return;
                    const items = Array.isArray(currentBill.items)
                      ? currentBill.items.map((i: any) => ({ name: i.menuItem.name, quantity: i.quantity, price: i.menuItem.price, subtotal: i.subtotal }))
                      : [];
                    const html = generateReceiptHTML({
                      id: currentBill.id,
                      items,
                      total: currentBill.total,
                      customerName: currentBill.customerName,
                      roomNumber: currentBill.roomNumber,
                      tableId: activeTableId || currentBill.tableId
                    }, (() => { const b = readReceiptBranding(); return { restaurant_name: b.restaurant_name || 'Property', address: b.address || '', phone: b.phone || '', email: b.email || '', tax_rate: Number(b.tax_rate ?? 0), show_tax_breakdown: true, paper_size: (b.paper_size as any) || '80mm', logo_url: b.logo_url, show_logo: b.show_logo, header_text: b.header_text, footer_text: b.footer_text, promotional_message: b.promotional_message }; })(), 'receipt', { includeSignature: false, showTaxBreakdown: true, serverName: user?.name });
                    printDocument(html, `Bill-${currentBill.id}`);
                    setPrintOpen(false);
                  }}>Print</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Dialog open={kitchenOpen} onOpenChange={setKitchenOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Send to Kitchen</DialogTitle>
                  <DialogDescription>Send the order to the kitchen and print ticket.</DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setKitchenOpen(false)}>Cancel</Button>
                  <Button onClick={() => {
                    if (!currentBill) return;
                    const items = Array.isArray(currentBill.items)
                      ? currentBill.items.map((i: any) => ({ name: i.menuItem.name, quantity: i.quantity, price: i.menuItem.price, subtotal: i.subtotal }))
                      : [];
                    const html = generateReceiptHTML({
                      id: currentBill.id,
                      items,
                      total: currentBill.total,
                      customerName: currentBill.customerName,
                      roomNumber: currentBill.roomNumber,
                      tableId: activeTableId || currentBill.tableId
                    }, (() => { const b = readReceiptBranding(); return { restaurant_name: b.restaurant_name || 'Kitchen Ticket', address: b.address || '', phone: b.phone || '', email: b.email || '', tax_rate: 0, show_tax_breakdown: false, paper_size: (b.paper_size as any) || '80mm', logo_url: b.logo_url, show_logo: b.show_logo, header_text: 'Kitchen Order Ticket', footer_text: b.footer_text, promotional_message: b.promotional_message }; })(), 'confirmation', { includeSignature: false, showTaxBreakdown: false, serverName: user?.name });
                    printDocument(html, `KOT-${currentBill.id}`);
                    setKitchenOpen(false);
                  }}>Send</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Dialog open={splitOpen} onOpenChange={setSplitOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Split Bill</DialogTitle>
                  <DialogDescription>Choose number of splits. Amounts are even.</DialogDescription>
                </DialogHeader>
                <div className="flex items-center gap-3">
                  <Input type="number" min={2} value={splitCount} onChange={(e) => setSplitCount(Math.max(2, Number(e.target.value || 2)))} />
                  <span className="text-sm text-gray-600">Splits</span>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setSplitOpen(false)}>Cancel</Button>
                  <Button onClick={() => {
                    if (!currentBill) return;
                    const amount = Number((currentBill.total / splitCount).toFixed(2));
                    try {
                      const payload = { billId: currentBill.id, splits: Array.from({ length: splitCount }).map((_, i) => ({ label: `Split ${i + 1}`, amount })) };
                      const raw = localStorage.getItem('corepms_pos_splits');
                      const list = raw ? JSON.parse(raw) : [];
                      localStorage.setItem('corepms_pos_splits', JSON.stringify([payload, ...list].slice(0, 50)));
                      const entry = createAuditEntry('SPLIT_BILL_PREP', 'BILL', currentBill.id, user?.id || 'server-1', payload);
                      try { const raw = localStorage.getItem('corepms_pos_audit'); const list = raw ? JSON.parse(raw) : []; localStorage.setItem('corepms_pos_audit', JSON.stringify([entry, ...list].slice(0, 50))); } catch { }
                    } catch { }
                    setSplitOpen(false);
                  }}>Prepare</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Transfer Bill</DialogTitle>
                  <DialogDescription>Enter destination table ID (e.g., t5).</DialogDescription>
                </DialogHeader>
                <Input placeholder="Destination table (e.g., t5)" value={destTableId} onChange={(e) => setDestTableId(e.target.value)} />
                <DialogFooter>
                  <Button variant="outline" onClick={() => setTransferOpen(false)}>Cancel</Button>
                  <Button onClick={() => {
                    if (!activeTableId || !destTableId) return;
                    const safeTables = Array.isArray(tables) ? tables : [];
                    const exists = !!safeTables.find(t => t.id === destTableId);
                    if (!exists) { alert('Destination table not found'); return; }
                    const occupied = !!safeTables.find(t => t.id === destTableId && t.currentBill);
                    if (occupied) { alert('Destination table already has a bill'); return; }
                    transferBillTo(activeTableId, destTableId);
                    setTransferOpen(false);
                    setDestTableId('');
                  }}>Transfer</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </div>

      {orderModal?.open && (
        <OrderModal
          tableNumber={Number(orderModal.tableId.replace('t', ''))}
          bill={null}
          onClose={() => setOrderModal(null)}
          onSave={saveOrder}
          menuItems={menuItems as any}
        />
      )}

      {paymentModal.open && paymentModal.bill && (
        <PaymentModal
          bill={{
            id: paymentModal.bill.id,
            items: Array.isArray(paymentModal.bill.items)
              ? paymentModal.bill.items.map((i: any) => ({ name: i.menuItem.name, quantity: i.quantity, price: i.menuItem.price }))
              : [],
            total: paymentModal.bill.total,
            tableId: paymentModal.bill.tableId,
            customerName: paymentModal.bill.customerName,
            roomNumber: paymentModal.bill.roomNumber
          }}
          isOpen={true}
          onClose={() => setPaymentModal({ bill: null, open: false })}
          onPaymentComplete={processPayment}
          currentUser={{ name: user?.name || 'Server', id: user?.id || 'server-1', role: user?.role }}
          receiptSettings={receiptSettings as any}
          voidContext={pendingVoid || undefined}
        />
      )}
    </div>
  );
};
