import React, { useCallback, useMemo, useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
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
import AuthPortal from '@/components/modules/AuthPortal';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { readReceiptBranding } from '@/lib/printSettings';
import { db } from '@/lib/db';
import { offlineCache } from '@/lib/offlineCache';
import { offlineSync } from '@/lib/offlineSync';
import { networkStatus, NetworkInfo } from '@/lib/networkStatus';
import { toast, useToast } from '@/hooks/use-toast';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

export const POSFrontOffice: React.FC = () => {
  const { guests, recordFolioCharge, removeFolioCharge, loading, posOrders, savePosOrder, closePosOrder } = useData();
  const { activeShift, startShift, endShift, getTotals, addTransaction } = useShift();
  const { user, costCentre, shiftId, isLocked, setIsLocked, verifyPosPin } = useAuth();

  // 90-second inactivity timeout — locks the station without losing table state.
  // Saves current page to localStorage so session recovery restores operational context.
  useInactivityTimeout({
    timeoutMs: 90000,
    onTimeout: () => {
      if (activeShift && costCentre) {
        // Persist last active context so the unlock PIN modal can restore it
        try {
          localStorage.setItem('corepms_pos_last_context', JSON.stringify({
            module: 'pos',
            costCentre,
            lockedAt: new Date().toISOString(),
          }));
        } catch { /* non-fatal */ }
        setIsLocked(true);
      }
    },
    enabled: !!activeShift && !!costCentre && !isLocked
  });

  const [mountLoading, setMountLoading] = useState<boolean>(false);
  const [tables, setTables] = useState<Array<{ id: string; number: number; status: 'available' | 'occupied' | 'suspended'; currentBill?: any; cost_center?: string }>>(
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
  const [offlineMenuItems, setOfflineMenuItems] = useState<Array<any>>([]);
  const [isOffline, setIsOffline] = useState<boolean>(false);
  const [syncStatus, setSyncStatus] = useState<{ pending: number; syncing: boolean }>({ pending: 0, syncing: false });
  const [networkStatusDetail, setNetworkStatusDetail] = useState<NetworkInfo>({
    status: 'online',
    isOnline: true,
    lastChecked: Date.now(),
    latency: null,
    connectionType: null
  });

  // Initialize offline capabilities
  useEffect(() => {
    const initializeOffline = async () => {
      try {
        await offlineCache.init();
        
        // Load cached menu items if available
        const cachedItems = localStorage.getItem('corepms_offline_menu');
        if (cachedItems) {
          setOfflineMenuItems(JSON.parse(cachedItems));
        }
        
        // Start network monitoring
        networkStatus.startMonitoring();
        
        // Subscribe to network status changes
        const unsubscribe = networkStatus.subscribe((status) => {
          setIsOffline(status === 'offline' || status === 'unstable');
          if (status === 'online') {
            // Attempt to sync when coming online
            syncPendingOperations();
          }
          
          // Update detailed network status
          networkStatus.checkConnection().then((info) => {
            setNetworkStatusDetail(info);
          });
        });
        
        // Initial sync check
        syncPendingOperations();
        
        // Also set up periodic network status updates
        const networkStatusInterval = setInterval(() => {
          networkStatus.checkConnection().then((info) => {
            setNetworkStatusDetail(info);
          }).catch((error) => {
            console.error('Failed to check network status:', error);
            // Update status to indicate checking failed
            setNetworkStatusDetail(prev => ({
              ...prev,
              status: 'offline',
              isOnline: false,
              lastChecked: Date.now()
            }));
          });
        }, 10000); // Update every 10 seconds
        
        return unsubscribe;
      } catch (error) {
        console.error('Failed to initialize offline capabilities:', error);
      }
    };
    
    const unsubscribe = initializeOffline();
    
    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
      networkStatus.stopMonitoring();
      // Clear the network status interval would be handled by stopping monitoring
    };
  }, []);
  
  // Sync pending operations periodically
  useEffect(() => {
    if (!isOffline) {
      const interval = setInterval(() => {
        syncPendingOperations();
      }, 30000); // Sync every 30 seconds when online
      
      return () => clearInterval(interval);
    }
  }, [isOffline]);
  
  // Load menu items with offline fallback
  const loadMenuItems = useCallback(async () => {
    try {
      if (!isOffline) {
        // Try to get fresh data from database
        const list = await getMenuItems(costCentre || undefined);
        const safeList = Array.isArray(list) ? list : [];
        
        // Cache the results for offline use
        localStorage.setItem('corepms_offline_menu', JSON.stringify(safeList));
        setOfflineMenuItems(safeList);
        
        console.log("[POS Items Debug - Retrieved]", safeList.length, "items for cost centre:", costCentre);
        if (safeList.length > 0) {
          // Log example item but exclude image data to prevent AI model errors
          const exampleItem = { ...safeList[0] };
          if (exampleItem.image) {
            exampleItem.image = `[IMAGE DATA TRUNCATED - ${typeof exampleItem.image}]`;
          }
          console.log("[POS Items Debug - Example]", exampleItem);
          const barItems = safeList.filter((i: any) => i.category === 'bar');
          console.log("[POS Items Debug - Bar Count]", barItems.length);
          console.log("[POS Items Debug - Sample Bar Items]", barItems.slice(0, 5));
        }
        
        setMenuItems(safeList.map((item: any) => ({ ...item, image: item.image || '' })));
      } else {
        // Use cached data when offline
        console.log("[POS Items] Using cached menu items (offline mode)");
        // Map items but exclude image data from logging to prevent AI model errors
        const mappedItems = offlineMenuItems.map((item: any) => ({ ...item, image: item.image || '' }));
        setMenuItems(mappedItems);
      }
    } catch (err) {
      console.error('Menu refresh failed', err);
      // Fallback to cached data on error
      if (offlineMenuItems.length > 0) {
        // Log fallback without image data to prevent AI model errors
        console.log("[POS Items] Falling back to cached data due to error");
        setMenuItems(offlineMenuItems.map((item: any) => ({ ...item, image: item.image || '' })));
      } else {
        // If no cache available, keep existing items or show empty
        console.log("[POS Items] No cache available, keeping current items");
      }
    }
  }, [costCentre, isOffline, offlineMenuItems]);
  
  // Sync pending operations when coming online
  const syncPendingOperations = useCallback(async () => {
    try {
      setSyncStatus(prev => ({ ...prev, syncing: true }));
      
      // Get pending count from offline cache
      const pendingCount = await offlineCache.getOperationCount();
      setSyncStatus(prev => ({ ...prev, pending: pendingCount }));
      
      if (pendingCount > 0) {
        console.log(`[POS Sync] Starting sync of ${pendingCount} pending operations`);
        const result = await offlineSync.triggerSync();
        console.log(`[POS Sync] Sync completed: ${result.success} success, ${result.failed} failed`);
        
        if (result.failed > 0) {
          toast({
            title: 'Sync Completed with Errors',
            description: `${result.success} operations synced, ${result.failed} failed`,
            variant: 'destructive'
          });
        } else if (result.success > 0) {
          toast({
            title: 'Sync Successful',
            description: `${result.success} operations synchronized`,
            variant: 'default'
          });
        }
      } else {
        setSyncStatus(prev => ({ ...prev, pending: 0, syncing: false }));
      }
    } catch (error) {
      console.error('Error during sync operation:', error);
      toast({
        title: 'Sync Failed',
        description: 'Failed to synchronize pending operations',
        variant: 'destructive'
      });
    } finally {
      setSyncStatus(prev => ({ ...prev, syncing: false }));
    }
  }, []);
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

   // Fetch menu items using TanStack Query for automatic cross-browser consistency
   const { data: menuItemsFromQuery, isLoading, isError, refetch } = useQuery({
     queryKey: ['menuItems', costCentre],
     queryFn: async () => {
       if (isOffline) {
         // When offline, return cached data
         return offlineMenuItems;
       }
       // When online, fetch from database
       const list = await getMenuItems(costCentre || undefined);
       return Array.isArray(list) ? list : [];
     },
     // Consider data fresh for 30 seconds, then background refetch
     staleTime: 30_000,
     // Refetch every 60 seconds in background
     refetchInterval: 60_000,
     // Don't refetch when window refocuses (we have interval)
     refetchOnWindowFocus: false,
     // Retry failed requests
     retry: 2,
   });
   
   // Process the data for UI consumption
   const menuItems = React.useMemo(() => {
     if (!menuItemsFromQuery) return [];
     return menuItemsFromQuery.map((item: any) => ({ 
       ...item, 
       image: item.image || '' 
     }));
   }, [menuItemsFromQuery]);

  // Load tables dynamically from DB, auto-create table_status rows if missing
  useEffect(() => {
    console.log('[POS] Front Office Mounted');
    const loadTablesFromDB = async () => {
      try {
        // Ensure table_status table exists
        await db.query(`
          CREATE TABLE IF NOT EXISTS table_status (
            table_id   TEXT PRIMARY KEY,
            status     TEXT NOT NULL DEFAULT 'open',
            last_update TIMESTAMPTZ DEFAULT NOW(),
            cost_center TEXT
          )
        `);

        // Pull existing rows
        const res = await db.query(
          `SELECT table_id, status, cost_center FROM table_status ORDER BY table_id`
        );
        if (!('rows' in res) || !Array.isArray(res.rows) || res.rows.length === 0) {
          // No tables in DB yet — seed from current state (12 default)
          const defaultTables = Array.from({ length: 12 }, (_, i) => `t${i + 1}`);
          for (const tid of defaultTables) {
            await db.query(
              `INSERT INTO table_status (table_id, status, cost_center) VALUES ($1, 'open', $2) ON CONFLICT DO NOTHING`,
              [tid, cc || 'Main Restaurant']
            );
          }
          return; // table state will be picked up by localStorage restore below
        }

        setTables(res.rows.map((r: any) => ({
          id:          String(r.table_id),
          number:      parseInt(String(r.table_id).replace(/\D/g, ''), 10) || 0,
          status:      r.status === 'occupied' ? 'occupied' : 'available',
          cost_center: r.cost_center || undefined,
        })));
      } catch (err) {
        console.warn('[POS] Could not load tables from DB, using defaults:', err);
      }
    };
    loadTablesFromDB();
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

  // Connect posOrders to table currentBill - this makes tables persistent across restarts
  useEffect(() => {
    if (!Array.isArray(posOrders) || posOrders.length === 0) return;

    setTables(prev => {
      const safePrev = Array.isArray(prev) ? prev : [];
      return safePrev.map(table => {
        // Find any open order for this table — skip orders from other shifts
        // (orphans from crashed/unclosed previous sessions)
        const tableOrder = posOrders.find(order =>
          order.table_number === table.id &&
          String(order.status).toLowerCase() === 'open' &&
          (!activeShift?.id || order.shift_id === activeShift.id)
        );

        if (tableOrder && !paidTablesRef.current.has(table.id)) {
          // Convert database order format to frontend bill format
          const currentBill = {
            id: tableOrder.id,
            tableId: tableOrder.table_number,
            items: Array.isArray(tableOrder.items) ? tableOrder.items.map((item: any) => {
              const menuItem = item.menuItem || {};
              return {
                id: menuItem.id || item.id,
                menuItem: {
                  id: menuItem.id || item.id,
                  name: menuItem.name || item.name || 'Unknown Item',
                  price: menuItem.price || item.price || 0,
                  category: menuItem.category || item.category
                },
                quantity: item.quantity,
                price: menuItem.price || item.price || 0,
                subtotal: item.subtotal || (item.quantity * (menuItem.price || item.price || 0))
              };
            }) : [],
            total: tableOrder.total_amount || 0,
            customerName: tableOrder.customer_name,
            roomNumber: tableOrder.room_number,
            createdAt: tableOrder.created_at || new Date().toISOString()
          };

          return { ...table, status: 'occupied', currentBill };
        }

        // No order found — reset to available unless suspended
        return table.status === 'suspended' ? table : { ...table, status: 'available', currentBill: undefined };
      });
    });
  }, [posOrders, activeShift]);

  // Tables that had payment processed — prevent posOrders effect from re-occupying them
  // during the race window between optimistic state clear and DB UPDATE completing.
  const paidTablesRef = React.useRef<Set<string>>(new Set());

  // One-time cleanup: on shift activation, close any open orders from previous sessions
  // (shift_id mismatch or null = orphan from crash/unclean shutdown)
  const staleOrderCleanupDone = React.useRef(false);
  useEffect(() => {
    if (!activeShift?.id || staleOrderCleanupDone.current) return;
    staleOrderCleanupDone.current = true;
    db.query(
      `UPDATE pos_orders SET status='closed' WHERE status='open' AND (shift_id IS NULL OR shift_id != $1)`,
      [activeShift.id]
    ).catch(() => { /* non-fatal */ });
  }, [activeShift?.id]);

  // Track how long since mount so GUARD 1 doesn't fire before shift is restored from storage
  const mountTimeRef = React.useRef<number>(Date.now());
  const SHIFT_RESTORE_GRACE_MS = 8000; // 8s — time to allow ShiftContext to reload from localStorage

  // Persist and restore table states (run after database init)
  useEffect(() => {
    if (typeof mountLoading !== 'undefined' && mountLoading) return;

    try {
      const raw = localStorage.getItem('corepms_pos_table_states');
      const savedStates = raw ? JSON.parse(raw) : {};
      const msSinceMount = Date.now() - mountTimeRef.current;

      setTables(prev => {
        const safePrev = Array.isArray(prev) ? prev : [];
        return safePrev.map(table => {
          const saved = savedStates[table.id];
          let nextTable = { ...table };

          if (saved) {
            // GUARD 1 — No active shift → occupied tables are orphans, wipe them.
            // EXCEPTION: within 8s of mount, skip this guard to let ShiftContext
            // restore the shift from localStorage first. Without this delay, a page
            // refresh clears all occupied tables before the shift is re-loaded,
            // causing "table disappears on refresh" symptom.
            const shiftRestoreComplete = msSinceMount > SHIFT_RESTORE_GRACE_MS;
            if (!activeShift && saved.status === 'occupied' && shiftRestoreComplete) {
              nextTable = { ...table, status: 'available', currentBill: undefined };
              updateTableStatus(table.id, 'available');
              return nextTable;
            }

            // GUARD 2 — Staleness: bills older than 12 hours are stale.
            const billCreatedAt = saved.currentBill?.createdAt;
            const billAgeHours = billCreatedAt
              ? (Date.now() - new Date(billCreatedAt).getTime()) / 3_600_000
              : 0;
            const isFreshBill = billAgeHours < 12;

            const shouldRestore = saved.status === 'available' ||
              (saved.status === 'occupied' && saved.currentBill && isFreshBill);

            if (shouldRestore) {
              nextTable = {
                ...table,
                status: saved.status || table.status,
                currentBill: saved.currentBill || undefined
              };
            } else if (saved.status === 'occupied' && !isFreshBill) {
              console.warn(`[POS] Stale bill on ${table.id} (${billAgeHours.toFixed(1)}h) — reset`);
              nextTable = { ...table, status: 'available', currentBill: undefined };
              updateTableStatus(table.id, 'available');
            }
          }

          // GUARD 3 — Occupied with no bill is always an anomaly.
          if (nextTable.status === 'occupied' && !nextTable.currentBill) {
            nextTable.status = 'available';
            updateTableStatus(table.id, 'available');
          }

          return nextTable;
        });
      });
    } catch { }
  }, [mountLoading, activeShift]);

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

  // Determine outlet from bill items (bar vs restaurant/food).
  // Falls back to the cost centre name if items lack classification fields.
  const getOutletFromBill = (bill: any): string => {
    // Cost-centre override: if the station name contains 'bar', everything sold
    // from here counts as a bar sale regardless of item flags.
    if (costCentre && String(costCentre).toLowerCase().includes('bar')) {
      return 'Bar POS';
    }
    if (!bill || !Array.isArray(bill.items) || !bill.items.length) {
      return 'Restaurant POS';
    }
    const isBarItem = (i: any) => {
      const m = i.menuItem || i;
      const dept = String(m.department || m.type || '').toLowerCase();
      const cat = String(m.category || '').toLowerCase();
      const subId = String(m.sub_id || '').toLowerCase();
      const categoryId = String(m.category_id || '').toLowerCase();
      const invCat = String(m.inventoryCategory || '').toLowerCase();
      const cc = String(m.costCenter || '').toLowerCase();
      return dept.includes('bar') ||
             m.bar_visibility === true ||
             cat === 'bar' || cat.includes('bar') ||
             subId.includes('bar') ||
             categoryId.includes('bar') ||
             invCat === 'cellar' ||
             cc.includes('bar');
    };
    const barCount = bill.items.filter(isBarItem).length;
    // Debug log so we can diagnose if classification still misses
    console.log('[Outlet classification]', {
      costCentre,
      itemCount: bill.items.length,
      barCount,
      sampleItem: bill.items[0]?.menuItem || bill.items[0]
    });
    return barCount > (bill.items.length / 2) ? 'Bar POS' : 'Restaurant POS';
  };
  const posIsLoading = loading || !Array.isArray(posOrders);
  const [connError, setConnError] = useState<string | null>(null);
  const debouncedTimerRef = useRef<any>(null);
  const pendingBillRef = useRef<any>(null);

  const fetchTablesForCostCentre = useCallback(async (cc: string) => {
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
      const res = await db.query(`SELECT table_id, status FROM table_status WHERE cost_center = $1`, [cc || 'Main Restaurant']);
      if ('rows' in res) {
        const statusMap: Record<string, 'available' | 'occupied' | 'suspended'> = {};
        const safeRows = Array.isArray(res.rows) ? res.rows : [];
        safeRows.forEach((r: any) => {
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
            const status = statusMap[t.id] || 'available';
            return { ...t, status, cost_center: cc || 'Main Restaurant', currentBill: statusMap[t.id] === 'occupied' ? t.currentBill : undefined };
          });
        });
      }
    } catch (e: any) {
      setConnError(e?.message || 'Failed to fetch table status');
    } finally {
      setMountLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!costCentre) return;
    fetchTablesForCostCentre(costCentre);
  }, [costCentre, fetchTablesForCostCentre]);

  const updateTableStatus = useCallback(async (tableId: string, status: 'available' | 'occupied' | 'suspended') => {
    const mapped = status === 'suspended' ? 'closed' : (status === 'available' ? 'open' : status);
    try {
      await db.query(
        `
          INSERT INTO table_status (table_id, status, cost_center, last_update)
          VALUES ($1, $2, $3, NOW())
          ON CONFLICT (table_id) DO UPDATE SET status = EXCLUDED.status, cost_center = EXCLUDED.cost_center, last_update = NOW()
        `,
        [tableId, mapped, costCentre || 'Main Restaurant']
      );
    } catch { }
  }, []);

  const handleTableClick = useCallback((tableId: string) => {
    const safeTables = Array.isArray(tables) ? tables : [];
    const table = safeTables.find(t => t.id === tableId);
    if (!table) return;
    // Always open order modal - allows adding items to existing orders
    // Payment can be accessed from the order modal
    setOrderModal({ tableId, open: true });
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
    const resetTable = () => {
      setTables(prev => {
        const safePrev = Array.isArray(prev) ? prev : [];
        return safePrev.map(t =>
          t.id === tableId ? { ...t, currentBill: undefined, status: 'available' as const } : t
        );
      });
      // FIX: also wipe localStorage entry so the persist-restore effect
      // doesn't re-inflate the table back to 'occupied' on next render.
      try {
        const raw = localStorage.getItem('corepms_pos_table_states');
        const saved = raw ? JSON.parse(raw) : {};
        saved[tableId] = { status: 'available', currentBill: undefined };
        localStorage.setItem('corepms_pos_table_states', JSON.stringify(saved));
      } catch { }
    };

    try {
      // Close ALL open orders for this table in DB (both with and without cost-centre filter)
      if (closePosOrder) {
        await closePosOrder(tableId, costCentre || undefined);
        await closePosOrder(tableId, undefined);
      }
      // Also directly mark closed any lingering open orders via raw DB update
      try {
        const { db: dbMod } = await import('@/lib/db');
        await dbMod.query(
          `UPDATE pos_orders SET status='closed' WHERE (table_number=$1 OR table_number=$2) AND status='open'`,
          [tableId, tableId.replace('t','')]
        );
      } catch { /* non-fatal */ }

      resetTable();
      updateTableStatus(tableId, 'available');

      const entry = createAuditEntry('CLEAR_BILL', 'TABLE', tableId, 'server-1');
      try {
        const raw = localStorage.getItem('corepms_pos_audit');
        const list = raw ? JSON.parse(raw) : [];
        localStorage.setItem('corepms_pos_audit', JSON.stringify([entry, ...list].slice(0, 50)));
      } catch { }
    } catch (error) {
      console.error(`Failed to clear table ${tableId}:`, error);
      resetTable(); // always reset UI even on error
    }
  }, [closePosOrder, costCentre, updateTableStatus]);

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
    // No shift → no active table (Current Bill panel must be empty before/after shift)
    if (!activeShift) return undefined;
    const safeTables = Array.isArray(tables) ? tables : [];
    if (selectedIds.length) {
      const id = selectedIds.find(id => !!safeTables.find(t => t.id === id && t.currentBill));
      if (id) return id;
    }
    const occupiedWithBill = safeTables.find(t => t.currentBill);
    return occupiedWithBill ? occupiedWithBill.id : undefined;
  }, [tables, selectedIds, activeShift]);

  const currentBill = useMemo(() => {
    // No shift → no current bill, regardless of stale table state
    if (!activeShift) return null;
    const safeTables = Array.isArray(tables) ? tables : [];
    const t = safeTables.find(t => t.id === activeTableId);
    return t && t.currentBill ? t.currentBill : null;
  }, [tables, activeTableId, activeShift]);

  // When the shift ends (or no shift is active), wipe all currentBills from
  // in-memory table state so nothing lingers into the next shift.
  useEffect(() => {
    if (activeShift) return;
    setTables(prev => {
      const safePrev = Array.isArray(prev) ? prev : [];
      const hasAny = safePrev.some(t => t.currentBill || t.status === 'occupied');
      if (!hasAny) return prev;
      return safePrev.map(t => ({ ...t, status: 'available' as const, currentBill: undefined }));
    });
  }, [activeShift]);

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
    console.log('[POSFrontOffice] saveOrder called with bill:', bill);
    // User is explicitly creating a new bill for this table — clear any paid guard
    paidTablesRef.current.delete(bill.tableId);
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
      console.log('[POSFrontOffice] Saving order to database:', current);
      const ok = await (typeof savePosOrder === 'function'
        ? savePosOrder({
            table: current.tableId,
            items: current.items,
            total: current.total,
            cost_center: costCentre || 'Main Restaurant',
            shift_id: activeShift?.id || shiftId
          })
        : Promise.resolve(true));
      if (!ok) {
        console.log('[POSFrontOffice] Order save failed');
        setTables(prev);
        alert('Database Write Failed: POS order could not be saved');
      } else {
        console.log('[POSFrontOffice] Order saved successfully');
        updateTableStatus(current.tableId, 'occupied');
      }
    }, 400);
  };

  const processPayment = async (paymentData: any) => {
    // PaymentModal calls onPaymentComplete inside a setTimeout(200ms), after onClose() already
    // sets paymentModal.bill = null (at 100ms). Use paymentData.bill as fallback so we still
    // have the bill reference when processPayment executes.
    const bill = paymentModal.bill || paymentData?.bill;
    if (!bill) return;
    const total = bill.total;

    // Folio charge recording (fire-and-forget)
    if (paymentData.paymentMethod === 'room-charge') {
      const guest = guests.find(g => g.roomNumber === paymentData.roomNumber);
      if (!guest) {
        alert('No checked-in guest found for this room number.');
        logPaymentError('authorization', new Error('Guest not found for room charge'), { roomNumber: paymentData.roomNumber });
      } else {
        if (recordFolioCharge) {
          recordFolioCharge({
            guestId: guest.id,
            amount: Number(total.toFixed(2)),
            description: `${getOutletFromBill(bill)} - bill-${formatBillNumber(bill.id)}`,
            date: new Date().toISOString().split('T')[0]
          }).then((chargeId) => {
            if (chargeId) {
              console.log('Folio charge posted successfully:', chargeId);
            } else {
              console.warn('Folio charge recording failed');
            }
          }).catch((err) => {
            logPaymentError('folio_post', err, { guestId: guest.id, billId: bill.id });
          });
        }
      }
    }

    try {
      const outlet = getOutletFromBill(bill) === 'Bar POS' ? 'bar' : 'restaurant';
      addTransaction(paymentData.paymentMethod, Number(total.toFixed(2)), bill.id, outlet);
    } catch (err) {
      console.warn('Shift logging failed:', err);
      logPaymentError('shift_log', err, { method: paymentData.paymentMethod, amount: total, billId: bill.id });
    }

    // Auto-deplete inventory for sold items (fire-and-forget)
    const soldItems = (bill.items || []).map((i: any) => ({
      id: i.menuItem?.id || i.id,
      name: i.menuItem?.name || i.name,
      quantity: Number(i.quantity || 0)
    }));
    decrementInventory(soldItems, costCentre || 'Main Restaurant', shiftId || 'unknown')
      .catch(err => {
        console.warn('Inventory depletion failed:', err);
        logPaymentError('inventory', err, { billId: bill.id });
      });

    // Mark table as paid — prevents posOrders effect from re-occupying it during
    // any race window. Stays in set until the user explicitly opens a new order
    // for this table (cleared in saveOrder) or for 60s as a safety fallback.
    paidTablesRef.current.add(bill.tableId);
    setTimeout(() => paidTablesRef.current.delete(bill.tableId), 60000);

    // Cancel ANY pending debounced save (regardless of tableId) — if a save fires
    // after closePosOrder it could re-insert an open order into the DB, leaving
    // the last paid table stuck on next re-fetch. We're processing a payment, so
    // no pending saves should run.
    if (debouncedTimerRef.current) {
      clearTimeout(debouncedTimerRef.current);
      debouncedTimerRef.current = null;
      pendingBillRef.current = null;
    }

    // Close POS order in DB. We close twice — the second close (1s later) catches
    // any racing INSERT from a savePosOrder that managed to fire between our
    // optimistic state clear and the first UPDATE landing in the DB. This is the
    // root cause of the "last paid table stays occupied" symptom.
    if (closePosOrder) {
      const doClose = () => closePosOrder(bill.tableId, costCentre || undefined);
      doClose()
        .then(() => {
          console.log('POS order closed (first pass)');
          // Second pass to catch any racing INSERT
          setTimeout(() => {
            doClose().catch(() => {});
          }, 1000);
        })
        .catch(err => {
          console.warn('POS order close failed:', err);
          paidTablesRef.current.delete(bill.tableId);
        });
    }

    // Force-resync table state from DB shortly after payment — this catches any
    // case where the in-memory tables state got stuck on 'occupied' but the DB
    // table_status is already 'open'. This is what makes refresh fix it; doing
    // it explicitly here gives the same effect without needing a refresh.
    setTimeout(() => {
      if (costCentre) fetchTablesForCostCentre(costCentre);
    }, 1500);

    // Update UI state immediately
    setTables(prev => prev.map(t =>
      t.id === bill.tableId ? { ...t, status: 'available', currentBill: undefined } : t
    ));

    // Update database status (legacy fallback, fire-and-forget)
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

    return { ok: true, method: paymentData.paymentMethod, billId: bill.id, folioPosted: true, folioChargeId: null };
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />

      {/* When no cost centre selected, show transition message and AuthPortal to handle station selection */}
      {!costCentre && (
        <div className="flex flex-col items-center justify-center py-20">
          <div className="text-center mb-8">
            <div className="text-6xl mb-4">🍽️</div>
            <h2 className="text-2xl font-bold text-gray-800 mb-2">Switching Station</h2>
            <p className="text-gray-500">Please select your new cost centre below.</p>
          </div>
          <div className="w-full">
            <AuthPortal />
          </div>
        </div>
      )}

      {/* PIN Lock Overlay */}
      <PINModal
        isOpen={isLocked}
        onClose={() => {}} // User cannot close without PIN
        onSuccess={() => {
          setIsLocked(false);
          // Session recovery: clear lock context, stay on current view (Table Management).
          // No "Start Shift" redirect — operational continuity is maintained.
          try {
            const ctx = JSON.parse(localStorage.getItem('corepms_pos_last_context') || '{}');
            localStorage.removeItem('corepms_pos_last_context');
            if (ctx.lockedAt) {
              const lockDuration = Math.round((Date.now() - new Date(ctx.lockedAt).getTime()) / 60000);
              toast({ title: '🔓 Session resumed', description: `Locked for ${lockDuration} min — returning to Table Management.` });
            }
          } catch { /* non-fatal */ }
        }}
        title="POS Session Locked — Enter PIN to Resume"
        verifyPin={verifyPosPin}
      />

      {costCentre && (
      <div className="p-6">
{(posIsLoading || mountLoading) && (
           <div className="bg-white rounded-xl shadow p-6 text-center">
             <LoadingSpinner label="Loading…" size="lg" />
           </div>
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
             {activeShift ? (
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
             ) : (
               <div className="text-center py-12">
                 <p className="text-lg font-medium text-gray-600 mb-4">
                   Please start a shift to access table management
                 </p>
                 <div className="flex items-center space-x-4">
                   <div className="text-sm text-gray-500">
                     Tables will be available once your shift begins
                   </div>
                 </div>
               </div>
             )}
           </div>

          <div className="bg-white rounded-xl shadow-lg p-6">
            <h3 className="text-xl font-bold text-gray-800 mb-4">Current Bill</h3>
            {currentBill ? (
              <div className="mb-4">
                <BillSummary
                  bill={{
                    id: currentBill.id,
                    items: Array.isArray(currentBill.items)
                      ? currentBill.items.map((i: any) => ({
                          name: i.menuItem?.name || i.name || 'Unknown Item',
                          quantity: i.quantity,
                          price: i.menuItem?.price ?? i.price ?? 0,
                          subtotal: i.subtotal
                        }))
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
                        ? currentBill.items.map((i: any) => ({
                            name: i.menuItem?.name || 'Unknown Item',
                            quantity: i.quantity,
                            price: i.menuItem?.price || 0,
                            subtotal: i.subtotal
                          }))
                        : [];
                       const html = generateReceiptHTML({
                       id: currentBill.id,
                       items,
                       total: currentBill.total,
                       customerName: currentBill.customerName,
                       roomNumber: currentBill.roomNumber,
                       tableId: activeTableId || currentBill.tableId,
                       paymentMethod: currentBill.paymentMethod
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
                        ? currentBill.items.map((i: any) => ({
                            name: i.menuItem?.name || 'Unknown Item',
                            quantity: i.quantity,
                            price: i.menuItem?.price || 0,
                            subtotal: i.subtotal
                          }))
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
      )}

      {orderModal?.open && (
        <OrderModal
          tableNumber={Number(orderModal.tableId.replace('t', ''))}
          bill={(() => {
            const table = tables.find(t => t.id === orderModal.tableId);
            return table?.currentBill || null;
          })()}
          onClose={() => setOrderModal(null)}
          onSave={saveOrder}
          onPayment={(bill) => {
            setOrderModal(null); // Close order modal
            setPaymentModal({ bill, open: true }); // Open payment modal
          }}
          menuItems={menuItems as any}
        />
      )}

      {paymentModal.open && paymentModal.bill && (
        <PaymentModal
          bill={{
            id: paymentModal.bill.id,
            items: Array.isArray(paymentModal.bill.items)
              ? paymentModal.bill.items.map((i: any) => ({
                  name: i.menuItem?.name || i.name || 'Unknown Item',
                  quantity: i.quantity,
                  price: i.menuItem?.price ?? i.price ?? 0
                }))
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
