import React, { createContext, useContext, useState, useEffect } from 'react';
import { db } from '../lib/db';
import { v4 as uuidv4 } from 'uuid';
import { toast } from '@/hooks/use-toast';
import { performFullSync, ensureTablesExist, loadCategoriesFromDb, loadFolioChargesFromDb } from '@/lib/dbSync';
import menuCats from '@/lib/menuCategories';
import { RealTimeSyncService } from '@/lib/realTimeSyncService';
import { refreshRooms } from '@/lib/roomService';
import { refreshConfig as refreshRateConfig } from '@/lib/ratePlanService';
import { useAuth } from './AuthContext';
import gl from '@/lib/glAccounting';

const DataContext = createContext<any>(null);

export const DataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [rooms, setRooms] = useState([]);
  const [guests, setGuests] = useState([]);
  const [reservations, setReservations] = useState([]);
  const [posOrders, setPosOrders] = useState(() => {
    try {
      const cached = localStorage.getItem('corepms_pos_orders_sync');
      if (cached) {
        const parsed = JSON.parse(cached);
        return parsed.data || [];
      }
    } catch (e) {
      console.warn('[DataContext] Failed to load posOrders from cache:', e);
    }
    return [];
  });
  const [inventory, setInventory] = useState([]);
  const [folioCharges, setFolioCharges] = useState([]);
  const [cityLedger, setCityLedger] = useState<Record<string, unknown>[]>([]);
  const [vendors, setVendors] = useState<Record<string, unknown>[]>([]);
  const [vendorExpenses, setVendorExpenses] = useState<Record<string, unknown>[]>([]);
  const [vendorPayments, setVendorPayments] = useState<Record<string, unknown>[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [folios, setFolios] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [realTimeSyncService, setRealTimeSyncService] = useState<RealTimeSyncService | null>(null);
  const [isRealTimeSyncActive, setIsRealTimeSyncActive] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const [lastUpdateTs, setLastUpdateTs] = useState<number | null>(null);
  const [priceSyncWs, setPriceSyncWs] = useState<WebSocket | null>(null);

  // Initialize price sync — WebSocket on Render/local, HTTP polling on Vercel
  // (Vercel serverless functions cannot hold WebSocket connections)
  const initializePriceSync = React.useCallback(() => {
    const host = window.location.host;
    const isVercel = host.includes('vercel.app');
    const isDev = import.meta.env.DEV;

    if (isVercel) {
      // Vercel: no WebSocket support — silently skip, DataContext polling handles refreshes
      console.log('[PriceSync] Vercel detected — WebSocket disabled, using HTTP polling');
      return;
    }

    try {
      const backendHost = isDev ? 'localhost:3001' : host;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${backendHost}/api/v1/prices/sync`;
      const ws = new WebSocket(wsUrl);
      let retryCount = 0;
      const MAX_RETRIES = 5;

      ws.onopen = () => {
        console.log('[PriceSync] Connected to real-time price sync');
        retryCount = 0;
        setPriceSyncWs(ws);
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === 'PRICE_UPDATE') {
            const update = message.data;
            setInventory(prev => prev.map(item =>
              item.id === update.itemId
                ? { ...item, sellingPrice: update.newPrice, costPrice: update.newCostPrice }
                : item
            ));
            loadAllData();
          }
        } catch (error) { console.error('[PriceSync] Failed to process message:', error); }
      };

      ws.onerror = () => {
        // Suppress noisy WebSocket errors — onclose will handle retry logic
      };

      ws.onclose = () => {
        setPriceSyncWs(null);
        retryCount++;
        if (retryCount < MAX_RETRIES) {
          // Exponential backoff: 10s, 20s, 40s, 80s, 160s
          const delay = Math.min(10000 * Math.pow(2, retryCount - 1), 160000);
          setTimeout(() => initializePriceSync(), delay);
        } else {
          console.log('[PriceSync] Max retries reached — WebSocket disabled');
        }
      };
    } catch (error) {
      console.warn('[PriceSync] Failed to initialize WebSocket:', (error as any)?.message);
    }
  }, []);

  useEffect(() => {
    return () => { if (priceSyncWs) priceSyncWs.close(); };
  }, [priceSyncWs]);

  const loadAllData = React.useCallback(async () => {
    setLoading(true);
    try {
      // Load PMS Data — rooms first (critical for dashboard)
      let roomRes = await db.query('SELECT * FROM rooms WHERE is_active IS DISTINCT FROM false ORDER BY number');
      if ('rows' in roomRes && roomRes.rows && roomRes.rows.length > 0) {
        setRooms((roomRes.rows || []).map((r: any) => ({ ...r, status: String(r.status || 'VC').toUpperCase() })));
        await refreshRooms();
        await refreshRateConfig();
      } else if ('error' in (roomRes as any) || !('rows' in roomRes)) {
        // DB unavailable — show empty state rather than loading wrong property's rooms
        // DEFAULT_ROOMS contains Villa Gianni-specific data and MUST NOT be shown on Baradzanwa
        console.warn('[DataContext] Rooms DB query failed — DB connection required for room data:', (roomRes as any).error);
        setRooms([]); // Empty — user must configure DATABASE_URL to see rooms
      }

      const resRes = await db.query('SELECT r.*, g.full_name as guest_name, ro.number as room_number FROM reservations r LEFT JOIN guests g ON r.guest_id = g.id LEFT JOIN rooms ro ON r.room_id = ro.id');
      if ('rows' in resRes) {
        setReservations((resRes.rows || []).map((r: any) => ({
          ...r,
          // Camel-case aliases for snake_case DB columns so all consumers
          // can use a consistent field name without defensive lookups.
          guestName:   r.guest_name  || r.booking_name || 'Unknown',
          checkIn:     r.check_in_date  || r.checkIn     || null,
          checkOut:    r.check_out_date || r.checkOut    || null,
          roomType:    r.room_type      || r.roomType    || null,
          roomNumber:  r.room_number    || r.roomNumber  || null,
          packageCode: r.package_code   || r.packageCode || 'RO',
        })));
      }

      const chargesRes = await loadFolioChargesFromDb();
      if (chargesRes.success) setFolioCharges(chargesRes.charges);

      const guestRes = await db.query('SELECT * FROM guests');
      if ('rows' in guestRes) setGuests(guestRes.rows || []);

      // Load POS orders (open table orders)
      const posOrdersRes = await db.query('SELECT * FROM pos_orders WHERE LOWER(status::text) = LOWER(?::text)', ['open']);
      if ('rows' in posOrdersRes) setPosOrders(posOrdersRes.rows || []);

      // FIX: Load from products table (unified source of truth for POS + Inventory)
      // Map ALL fields correctly including costCenter, category_id, visibility, prices
      const productsRes = await db.query('SELECT * FROM products ORDER BY name ASC');
      let mergedInventory: any[] = [];
      if ('rows' in productsRes && productsRes.rows && productsRes.rows.length > 0) {
        mergedInventory = (productsRes.rows || []).map((p: any) => {
          // Parse visibility — stored as JSONB in DB
          let vis: any = {};
          try { vis = typeof p.visibility === 'string' ? JSON.parse(p.visibility) : (p.visibility || {}); } catch { }

          // Determine costCenter from DB category field (set by syncPosItemToDb: category = item.costCenter)
          // and bar_visibility / department as fallback
          const costCenterFromDb = p.category || p.department || 'restaurant';

          return {
            ...p,
            // ── Price fields (DB snake_case → frontend camelCase) ──────────────
            sellingPrice:      Number(p.price || 0),       // products.price = selling price
            costPrice:         Number(p.cost_price || 0),  // products.cost_price = cost
            // ── Stock ─────────────────────────────────────────────────────────
            qtyInStock:        Number(p.stock_level || 0),
            qtyReceived:       Number(p.qty_received || 0),
            // ── Category / classification ──────────────────────────────────────
            costCenter:        costCenterFromDb,            // CRITICAL: restore costCenter from DB
            inventoryCategory: p.department?.toLowerCase() === 'bar' ? 'cellar' : 'kitchen',
            category_id:       p.category_id || null,
            sub_id:            p.sub_id || null,
            // ── Visibility (bar/restaurant toggles) ────────────────────────────
            visibility:        vis,
            bar_visibility:    p.bar_visibility !== false,
            restaurant_visibility: p.restaurant_visibility !== false,
            // ── Financial metrics ──────────────────────────────────────────────
            cosPercent:        Number(p.cos_percent || 0),
            gpPercent:         Number(p.gp_percent || 0),
            gpAmount:          Number(p.gp_amount || 0),
            // ── Display ───────────────────────────────────────────────────────
            imageBgColor:      p.image_bg_color || null,
            pictureData:       p.picture_data || null,
            notes:             p.notes || '',
            available:         p.active !== false,
            // ── Legacy field for POS.tsx category classification ───────────────
            type:              p.department,  // 'Bar' or 'Restaurant'
            category:          p.department?.toLowerCase().includes('bar') ? 'bar' : 'food',
          };
        });
        setInventory(mergedInventory);

        // Only update localStorage when we have real data — never overwrite with empty array
        // This prevents stale/empty DB responses from wiping user's saved items
        try {
          localStorage.setItem('corepms_pos_items', JSON.stringify(mergedInventory));
          window.dispatchEvent(new Event('storage'));
        } catch { /* storage full — non-fatal */ }
      } else if ('error' in (productsRes as any)) {
        // DB error — keep existing localStorage items, don't overwrite
        console.warn('[DataContext] Products DB query failed, keeping existing localStorage:', (productsRes as any).error);
      } else {
        // Empty products table — only write if localStorage is also empty to avoid wiping seeded data
        const existing = localStorage.getItem('corepms_pos_items');
        if (!existing || existing === '[]') {
          localStorage.setItem('corepms_pos_items', '[]');
        }
      }

      const folioRes = await db.query('SELECT * FROM folios');
      if ('rows' in folioRes) setFolios(folioRes.rows || []);

      setLastUpdateTs(Date.now());
      setDataError(null);
      initializePriceSync();

     } catch (error: any) {
       console.error("Failed to load data:", error);
       setDataError(error.message);
     } finally {
       // Load city ledger data
       try {
         await loadCityLedger();
       } catch (clError) {
         console.warn('Failed to load city ledger data in loadAllData:', clError);
       }
       setLoading(false);
     }
    }, [initializePriceSync]); // loadCityLedger is a useCallback and doesn't need to be in deps

  const loadUsers = React.useCallback(async () => {
    try {
      console.log('[DataContext] loadUsers starting...');
      const pmsAuthDb = (await import('@/lib/pmsAuthDb')).default;
      const allUsers = await pmsAuthDb.listUsers();
      console.log('[DataContext] Total users fetched:', allUsers.length);
      setUsers(allUsers);
    } catch (error) {
      console.error('[DataContext] Failed to load users:', error);
    }
  }, []);

  const loadLogs = React.useCallback(async (filters?: any) => {
    try {
      const pmsAuthDb = (await import('@/lib/pmsAuthDb')).default;
      const allLogs = await pmsAuthDb.listAccessLogs(filters);
      setLogs(allLogs);
    } catch (error) {
      console.error('[DataContext] Failed to load logs:', error);
    }
  }, []);

  // Initialize real-time sync service
  const initializeRealTimeSync = React.useCallback(() => {
    try {
      const syncService = RealTimeSyncService.getInstance({
        interval: 8000, // 8 seconds to meet 5-10 second requirement
        enabledModules: {
          rooms: true,
          reservations: true,
          posOrders: true,
          inventory: true,
          folioCharges: true,
          guests: true,
          cityLedger: true,
          vendors: true,
          vendorExpenses: true,
          vendorPayments: true,
        },
        maxRetries: 3,
        timeoutMs: 5000,
      });

      setRealTimeSyncService(syncService);
      console.log('[DataContext] Real-time sync service initialized');

      return syncService;
    } catch (error) {
      console.error('[DataContext] Failed to initialize real-time sync service:', error);
      return null;
    }
  }, []);

  // Start real-time synchronization
  const startRealTimeSync = () => {
    if (realTimeSyncService) {
      realTimeSyncService.start();
      setIsRealTimeSyncActive(true);
      console.log('[DataContext] Real-time sync started');
    }
  };

  // Stop real-time synchronization
  const stopRealTimeSync = () => {
    if (realTimeSyncService) {
      realTimeSyncService.stop();
      setIsRealTimeSyncActive(false);
      console.log('[DataContext] Real-time sync stopped');
    }
  };

  // Manual sync trigger
  const triggerManualSync = async () => {
    if (realTimeSyncService) {
      await realTimeSyncService.manualSync();
      console.log('[DataContext] Manual sync triggered');
    }
  };

  // Get sync statistics
  const getSyncStats = () => {
    if (realTimeSyncService) {
      return realTimeSyncService.getStats();
    }
    return new Map();
  };



  // Cleanup real-time sync service and other resources on unmount
  useEffect(() => {
    // Handle window close events for proper cleanup
    const handleBeforeUnload = () => {
      console.log('[DataContext] Window closing, cleaning up resources...');
      if (realTimeSyncService) {
        realTimeSyncService.stop();
      }
    };

    // Add event listener for window close
    window.addEventListener('beforeunload', handleBeforeUnload);

    // Cleanup function
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      if (realTimeSyncService) {
        realTimeSyncService.stop();
      }
    };
  }, [realTimeSyncService]);

  // PERSISTENT PMS METHODS
  const addRoom = async (roomData: any): Promise<boolean> => {
    try {
      // Generate unique ID for the room
      const roomId = `R${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      const sql = "INSERT INTO rooms (id, number, type, floor, rate, status) VALUES (?, ?, ?, ?, ?, ?)";
      const params = [roomId, String(roomData.number || ''), String(roomData.type || ''), Number(roomData.floor || 1), Number(roomData.rate || 0), 'VC'];
      const result = await db.query(sql, params);
      if ('error' in result) {
        console.error('Room insert failed:', (result as any).error);
        toast({ title: 'Database Write Failed', description: 'Room could not be saved', variant: 'destructive' });
        return false;
      }
      const verify = await db.query('SELECT id FROM rooms WHERE number = ?', [String(roomData.number || '')]);
      const ok = 'rows' in verify && Array.isArray((verify as any).rows) && (verify as any).rows.length > 0;
      await loadAllData();
      return ok;
    } catch (e: any) {
      console.error('Add room error:', e?.message || e);
      toast({ title: 'Database Write Failed', description: 'Room could not be saved', variant: 'destructive' });
      return false;
    }
  };

  const updateRoom = async (roomId: string, patch: Partial<any>): Promise<any> => {
    try {
      const setClauses: string[] = [];
      const params: any[] = [];

      if (patch.number !== undefined) {
        setClauses.push('number = ?');
        params.push(String(patch.number));
      }
      if (patch.type !== undefined) {
        setClauses.push('type = ?');
        params.push(String(patch.type));
      }
      if (patch.rate !== undefined) {
        setClauses.push('rate = ?');
        params.push(Number(patch.rate || 0));
      }
      if (patch.floor !== undefined) {
        setClauses.push('floor = ?');
        params.push(Number(patch.floor || 1));
      }
      if (patch.status !== undefined) {
        setClauses.push('status = ?');
        params.push(String(patch.status));
      }

      if (setClauses.length === 0) {
        return { error: 'No fields to update' };
      }

      params.push(roomId);
      const sql = `UPDATE rooms SET ${setClauses.join(', ')} WHERE id = ? `;
      const result = await db.query(sql, params);

      if ('error' in result) {
        console.error('Room update failed:', (result as any).error);
        toast({ title: 'Update Failed', description: (result as any).error, variant: 'destructive' });
        return { error: (result as any).error };
      }

      console.log('[DataContext] Room updated:', roomId, patch);
      await loadAllData();
      return { success: true };
    } catch (e: any) {
      console.error('Update room error:', e?.message || e);
      toast({ title: 'Update Failed', description: e?.message || 'Could not update room', variant: 'destructive' });
      return { error: e?.message || 'Unknown error' };
    }
  };

  const deleteRoom = async (roomId: string): Promise<boolean> => {
    try {
      const result = await db.query('DELETE FROM rooms WHERE id = ?', [roomId]);
      if ('error' in result) {
        console.error('Room delete failed:', (result as any).error);
        toast({ title: 'Delete Failed', description: (result as any).error, variant: 'destructive' });
        return false;
      }
      console.log('[DataContext] Room deleted:', roomId);
      await loadAllData();
      return true;
    } catch (e: any) {
      console.error('Delete room error:', e?.message || e);
      toast({ title: 'Delete Failed', description: e?.message || 'Could not delete room', variant: 'destructive' });
      return false;
    }
  };

  const createReservation = async (resData: any): Promise<{ success: boolean; error?: string; reservationId?: string }> => {
    try {
      // Step 1: Create or find guest first
      let guestId = resData.guestId;

      if (!guestId) {
        // Need to create a guest first
        const guestName = resData.guestName || resData.bookingName || 'Guest';
        const guestEmail = resData.email || null;
        const guestPhone = resData.phone || null;

        // Check if guest with same email already exists (if email provided)
        if (guestEmail) {
          const existingGuest = await db.query('SELECT id FROM guests WHERE email = ?', [guestEmail]);
          if ('rows' in existingGuest && existingGuest.rows.length > 0) {
            guestId = existingGuest.rows[0].id;
          }
        }

        // If no existing guest found, create a new one
        if (!guestId) {
          const newGuestId = `G${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
          const guestSql = "INSERT INTO guests (id, full_name, email, phone, id_number) VALUES (?, ?, ?, ?, ?)";
          const guestParams = [newGuestId, guestName, guestEmail, guestPhone, resData.idNumber || resData.passportNumber || null];
          const guestResult = await db.query(guestSql, guestParams);

          if ('error' in guestResult) {
            const errorMsg = (guestResult as any).error || 'Failed to create guest record';
            console.error('Guest insert failed:', errorMsg);
            return { success: false, error: errorMsg };
          }
          guestId = newGuestId;
        }
      }

      // Step 2: Create the reservation with the guest_id
      const reservationId = `RES${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

      // Prepare id_document_enc (required field) - encrypt if provided, use placeholder if not
      const idDocumentEnc = resData.idNumber || resData.passportNumber || resData.idDocumentNumber
        ? String(resData.idNumber || resData.passportNumber || resData.idDocumentNumber)
        : 'NOT_PROVIDED';

      const sql = `INSERT INTO reservations(
    id, guest_id, room_id, check_in_date, check_out_date, status,
    source, id_document_enc, id_document_type, nationality_code, nationality_name,
    booking_source, partner_code, utm_source, utm_medium, utm_campaign, utm_term, utm_content,
    terms_accepted, confirmed_at, signature_encrypted, payment_info_source, payment_verified, package_code,
    room_type, rate, adults, children, room_preference, booking_name, booking_type,
    company_name, payment_method, settle_at_checkout, origin_region, inserted_at
  ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`;

      const params = [
        reservationId,
        guestId,
        resData.roomId || null,
        resData.checkIn,
        resData.checkOut,
        'confirmed',
        resData.originRegion || null,
        idDocumentEnc,
        resData.idDocumentType || 'Passport',
        resData.nationalityCode || null,
        resData.nationalityName || null,
        resData.bookingSource || null,
        resData.partnerCode || null,
        resData.utmSource || null,
        resData.utmMedium || null,
        resData.utmCampaign || null,
        resData.utmTerm || null,
        resData.utmContent || null,
        resData.termsAccepted || false,
        resData.confirmedAt || null,
        resData.signatureDataUrl || null,
        resData.paymentInfoSource || null,
        resData.paymentVerified || false,
        resData.packageCode || 'RO',
        resData.roomType || null,
        resData.rate || 0,
        resData.adults || 1,
        resData.children || 0,
        resData.roomPreference || null,
        resData.bookingName || resData.guestName || null,
        resData.bookingType || 'Individual',
        resData.companyName || null,
        resData.paymentMethod || 'Credit Card',
        resData.settleAtCheckout !== false,
        resData.originRegion || null
      ];

      const result = await db.query(sql, params);
      if ('error' in result) {
        const errorMsg = (result as any).error || 'Database query failed';
        console.error('Reservation insert failed:', errorMsg);
        toast({ title: 'Database Write Failed', description: 'Reservation could not be saved', variant: 'destructive' });
        return { success: false, error: errorMsg };
      }
      await loadAllData();
      return { success: true, reservationId };
    } catch (e: any) {
      const errorMsg = e?.message || String(e) || 'Unknown error occurred';
      console.error('Create reservation error:', errorMsg);
      toast({ title: 'Database Write Failed', description: 'Reservation could not be saved', variant: 'destructive' });
      return { success: false, error: errorMsg };
    }
  };

  const updateReservation = async (reservationId: string, resData: any): Promise<{ success: boolean; error?: string }> => {
    try {
      // Prepare id_document_enc (required field)
      const idDocumentEnc = resData.idDocumentNumber
        ? String(resData.idDocumentNumber)
        : 'NOT_PROVIDED';

      const sql = `UPDATE reservations SET
check_in_date = ?, check_out_date = ?, status = ?,
  id_document_enc = ?, id_document_type = ?, nationality_code = ?, nationality_name = ?,
  booking_source = ?, partner_code = ?, utm_source = ?, utm_medium = ?, utm_campaign = ?, utm_term = ?, utm_content = ?,
  terms_accepted = ?, payment_info_source = ?, payment_verified = ?, package_code = ?,
  room_type = ?, rate = ?, adults = ?, children = ?, room_preference = ?, booking_name = ?, booking_type = ?,
  company_name = ?, payment_method = ?, settle_at_checkout = ?, origin_region = ?
    WHERE id = ? `;

      const params = [
        resData.checkIn,
        resData.checkOut,
        resData.status || 'confirmed',
        idDocumentEnc,
        resData.idDocumentType || 'Passport',
        resData.nationalityCode || null,
        resData.nationalityName || null,
        resData.bookingSource || null,
        resData.partnerCode || null,
        resData.utmSource || null,
        resData.utmMedium || null,
        resData.utmCampaign || null,
        resData.utmTerm || null,
        resData.utmContent || null,
        resData.termsAccepted || false,
        resData.paymentInfoSource || null,
        resData.paymentVerified || false,
        resData.packageCode || 'RO',
        resData.roomType || null,
        resData.rate || 0,
        resData.adults || 1,
        resData.children || 0,
        resData.roomPreference || null,
        resData.bookingName || resData.guestName || null,
        resData.bookingType || 'Individual',
        resData.companyName || null,
        resData.paymentMethod || 'Credit Card',
        resData.settleAtCheckout !== false,
        resData.originRegion || null,
        reservationId
      ];

      const result = await db.query(sql, params);
      if ('error' in result) {
        const errorMsg = (result as any).error || 'Database query failed';
        console.error('Reservation update failed:', errorMsg);
        toast({ title: 'Database Write Failed', description: 'Reservation could not be updated', variant: 'destructive' });
        return { success: false, error: errorMsg };
      }
      await loadAllData();
      return { success: true };
    } catch (e: any) {
      const errorMsg = e?.message || String(e) || 'Unknown error occurred';
      console.error('Update reservation error:', errorMsg);
      toast({ title: 'Database Write Failed', description: 'Reservation could not be updated', variant: 'destructive' });
      return { success: false, error: errorMsg };
    }
  };

  const updateGuest = async (guest: any): Promise<boolean> => {
    try {
      // PostgreSQL schema uses 'full_name', not 'name'
      // Note: room_number is not in guests table schema, removed from update
      const sql = "UPDATE guests SET full_name = ?, email = ?, phone = ? WHERE id = ?";
      const params = [guest.name || guest.full_name, guest.email, guest.phone, guest.id];
      const result = await db.query(sql, params);
      if ('error' in result) {
        console.error('Guest update failed:', (result as any).error);
        toast({ title: 'Database Write Failed', description: 'Guest update failed', variant: 'destructive' });
        return false;
      }
      await loadAllData();
      return true;
    } catch (e: any) {
      console.error('Update guest error:', e?.message || e);
      toast({ title: 'Database Write Failed', description: 'Guest update failed', variant: 'destructive' });
      return false;
    }
  };

  // PERSISTENT POS METHODS
  const savePosOrder = async (orderData: any): Promise<boolean> => {
    try {
      const provisional = {
        table_number: String(orderData.table || ''),
        items: Array.isArray(orderData.items) ? orderData.items : [],
        total_amount: Number(orderData.total || 0),
        status: 'open',  // lowercase — must match the posOrders useEffect check in POSFrontOffice
        cost_center: orderData.cost_center,
        shift_id: orderData.shift_id
      };

      setPosOrders((prev: any[]) => {
        const idx = prev.findIndex((p: any) =>
          String(p.table_number) === provisional.table_number &&
          String(p.status).toLowerCase() === 'open' &&
          p.cost_center === provisional.cost_center
        );
        if (idx >= 0) {
          const copy = prev.slice();
          copy[idx] = { ...prev[idx], ...provisional };
          return copy;
        }
        return [provisional, ...prev];
      });

      // Generate unique ID for the POS order
      const orderId = `POS${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

      // Update existing open order for this table — also match legacy NULL cost_center rows
      // (orders created before the cost_center column was added) to avoid INSERT conflicts
      const updateSql = "UPDATE pos_orders SET items = ?::jsonb, total_amount = ?, status = 'open', shift_id = ?, cost_center = ? WHERE table_number = ? AND status = 'open' AND (LOWER(cost_center) = LOWER(?) OR cost_center IS NULL) RETURNING id";
      const updateParams = [
        JSON.stringify(provisional.items),
        provisional.total_amount,
        provisional.shift_id,
        provisional.cost_center,
        provisional.table_number,
        provisional.cost_center
      ];
      const updateResult = await db.query(updateSql, updateParams);

      // If no rows updated, insert new order
      if (!('error' in updateResult) && 'rows' in updateResult && (updateResult as any).rows.length === 0) {
        // ON CONFLICT handles the rare race where the stale-order cleanup hasn't finished yet
        const insertSql = "INSERT INTO pos_orders (id, table_number, items, total_amount, status, cost_center, shift_id) VALUES (?, ?, ?::jsonb, ?, 'open', ?, ?) ON CONFLICT (table_number, cost_center) WHERE status = 'open' DO UPDATE SET items = EXCLUDED.items, total_amount = EXCLUDED.total_amount, shift_id = EXCLUDED.shift_id";
        const insertParams = [
          orderId,
          provisional.table_number,
          JSON.stringify(provisional.items),
          provisional.total_amount,
          provisional.cost_center,
          provisional.shift_id
        ];
        const insertResult = await db.query(insertSql, insertParams);
        if ('error' in insertResult) {
          console.error('POS order insert details:', { params: insertParams, error: (insertResult as any).error });
          const dbError = (insertResult as any).error?.message || (insertResult as any).error || 'Unknown DB Error';
          setPosOrders((prev: any[]) => prev.filter((p: any) =>
            !(String(p.table_number) === provisional.table_number && String(p.status).toLowerCase() === 'open' && p.cost_center === provisional.cost_center)
          ));
          toast({ title: 'Database Write Failed', description: `POS order insert failed: ${dbError}`, variant: 'destructive' });
          return false;
        }
      } else if ('error' in updateResult) {
        console.error('POS order update details:', { params: updateParams, error: (updateResult as any).error });
        const dbError = (updateResult as any).error?.message || (updateResult as any).error || 'Unknown DB Error';
        setPosOrders((prev: any[]) => prev.filter((p: any) =>
          !(String(p.table_number) === provisional.table_number && String(p.status).toLowerCase() === 'open' && p.cost_center === provisional.cost_center)
        ));
        toast({ title: 'Database Write Failed', description: `POS order update failed: ${dbError}`, variant: 'destructive' });
        return false;
      }

      // Update table status to occupied — conflict on table_id (the actual PK)
      const tableSql = "INSERT INTO table_status (table_id, status, cost_center, last_update) VALUES (?, 'occupied', ?, NOW()) ON CONFLICT (table_id) DO UPDATE SET status = 'occupied', cost_center = EXCLUDED.cost_center, last_update = NOW()";
      const tableParams = [provisional.table_number, provisional.cost_center || 'Main Restaurant'];
      await db.query(tableSql, tableParams);

      return true;
    } catch (e: any) {
      console.error('Save POS order error:', e?.message || e);
      toast({ title: 'Database Write Failed', description: 'POS order could not be saved', variant: 'destructive' });
      return false;
    }
  };

  const closePosOrder = async (tableNumber: string, costCentre?: string): Promise<boolean> => {
    // Optimistic update — remove from local state immediately so posOrders effect
    // never re-occupies the table while the DB update is in-flight.
    // Use case-insensitive comparison for cost_center — DB may store 'conference'
    // while costCentre state holds 'Conference' (or vice versa).
    const ccLower = costCentre ? costCentre.toLowerCase() : null;
    const filterFn = (p: any) => {
      const sameTable = String(p.table_number) === String(tableNumber);
      const isOpen    = String(p.status || '').toLowerCase() === 'open';
      // Match if: no cost_center filter, the order has no cost_center (legacy null rows),
      // or case-insensitive match — any of these means this order should be closed.
      const sameCc    = !ccLower || !p.cost_center || String(p.cost_center).toLowerCase() === ccLower;
      return !(sameTable && isOpen && sameCc);
    };
    setPosOrders((prev: any[]) => prev.filter(filterFn));

    try {
      // 1. Close the order in pos_orders (case-insensitive cost_center match)
      const query = costCentre
        ? "UPDATE pos_orders SET status = 'closed' WHERE table_number = ? AND status = 'open' AND LOWER(cost_center) = LOWER(?)"
        : "UPDATE pos_orders SET status = 'closed' WHERE table_number = ? AND status = 'open'";
      const params = costCentre ? [tableNumber, costCentre] : [tableNumber];
      const result = await db.query(query, params);

      // 2. Update table_status to 'open' (available) — conflict on table_id (the actual PK)
      const tableSql = "INSERT INTO table_status (table_id, status, cost_center, last_update) VALUES (?, 'open', ?, NOW()) ON CONFLICT (table_id) DO UPDATE SET status = 'open', cost_center = EXCLUDED.cost_center, last_update = NOW()";
      const tableParams = [tableNumber, costCentre || 'Main Restaurant'];
      await db.query(tableSql, tableParams);

      if ('error' in result) {
        console.error('Close POS order failed:', (result as any).error);
        return false;
      }

      return true;
    } catch (e: any) {
      console.error('Close POS order error:', e?.message || e);
      return false;
    }
  };

  // INVENTORY
  const updateStock = async (itemId: string, stockLevel: number): Promise<boolean> => {
    try {
      // For now, just update the local state, the sync happens periodically
      const sql = "UPDATE products SET stock_level = ? WHERE id = ?";
      const params = [Number(stockLevel || 0), itemId];
      const result = await db.query(sql, params);
      if ('error' in result) {
        console.error('Stock update failed:', (result as any).error);
        toast({ title: 'Database Write Failed', description: 'Stock update failed', variant: 'destructive' });
        return false;
      }
      await loadAllData();
      return true;
    } catch (e: any) {
      console.error('Update stock error:', e?.message || e);
      toast({ title: 'Database Write Failed', description: 'Stock update failed', variant: 'destructive' });
      return false;
    }
  };

  // FRONT OFFICE - Check-in guest
  const checkInGuest = async (reservationId: string, roomId: string, options: { rateOverride?: number; packageCode?: string; taxInclusive?: boolean } = {}): Promise<boolean> => {
    try {
      // Validate room exists and is available before proceeding
      const roomCheckRes = await db.query(
        `SELECT id, number, type, status FROM rooms WHERE id = $1`,
        [roomId]
      );
      if (!('rows' in roomCheckRes) || !roomCheckRes.rows?.length) {
        toast({ title: 'Check-in Failed', description: 'Selected room not found in database', variant: 'destructive' });
        return false;
      }
      const room = roomCheckRes.rows[0];

      // Atomic transaction: update reservation + room in one operation
      const txResult = await db.transaction([
        {
          // Update reservation: status, room_id, room_type, rate, package
          // NOTE: reservations table has NO updated_at column — do not include it
          sql: `UPDATE reservations SET
                  status = 'checked-in',
                  room_id = $1,
                  room_type = $2,
                  rate = COALESCE($3, rate),
                  package_code = COALESCE($4, package_code)
                WHERE id = $5`,
          params: [
            roomId,
            room.type,
            options.rateOverride || null,
            options.packageCode || null,
            reservationId
          ]
        },
        {
          // Mark room as OC (Occupied Clean)
          sql: `UPDATE rooms SET status = 'OC', updated_at = NOW() WHERE id = $1`,
          params: [roomId]
        },
        {
          // Create or update folio for this guest
          sql: `INSERT INTO folios (id, guest_id, reservation_id, room_number, status, balance, package_code, created_by, inserted_at, updated_at)
                SELECT
                  gen_random_uuid()::text,
                  r.guest_id,
                  r.id,
                  $2,
                  'open',
                  0,
                  COALESCE($3, r.package_code, 'RO'),
                  'check_in',
                  NOW(),
                  NOW()
                FROM reservations r
                WHERE r.id = $1
                ON CONFLICT (reservation_id) DO UPDATE
                  SET room_number = EXCLUDED.room_number,
                      status = 'open',
                      package_code = COALESCE(EXCLUDED.package_code, folios.package_code),
                      updated_at = NOW()`,
          params: [reservationId, room.number, options.packageCode || null]
        }
      ]);

      if (!(txResult as any).ok) {
        console.error('Check-in transaction failed:', (txResult as any).error);
        toast({ title: 'Check-in Failed', description: 'Could not update reservation', variant: 'destructive' });
        return false;
      }

      // Refresh all data so UI reflects the new state immediately
      await loadAllData();
      return true;
    } catch (e: any) {
      console.error('Check-in error:', e?.message || e);
      toast({ title: 'Check-in Failed', description: e?.message || 'An error occurred during check-in', variant: 'destructive' });
      return false;
    }
  };

  // FRONT OFFICE - Check-out guest
  const checkOutGuest = async (reservationId: string): Promise<boolean> => {
    try {
      // Get reservation details including room
      const getResResult = await db.query(
        `SELECT r.room_id, ro.number as room_number FROM reservations r
         LEFT JOIN rooms ro ON ro.id = r.room_id
         WHERE r.id = $1`,
        [reservationId]
      );
      let roomId: string | null = null;
      if ('rows' in getResResult && getResResult.rows.length > 0) {
        roomId = getResResult.rows[0].room_id;
      }

      // Atomic transaction: check-out reservation + release room
      const ops: { sql: string; params: any[] }[] = [
        {
          // NOTE: reservations table has NO updated_at column
          sql: `UPDATE reservations SET status = 'checked-out' WHERE id = $1`,
          params: [reservationId]
        }
      ];

      if (roomId) {
        // Set room to VD (Vacant Dirty) — housekeeping must clean before next check-in
        ops.push({
          sql: `UPDATE rooms SET status = 'VD', updated_at = NOW() WHERE id = $1`,
          params: [roomId]
        });
        // Close any open folios for this reservation
        ops.push({
          sql: `UPDATE folios SET status = 'closed', closed_at = NOW(), closed_by = 'CHECK_OUT', updated_at = NOW()
                WHERE reservation_id = $1 AND status = 'open'`,
          params: [reservationId]
        });
      }

      const txResult = await db.transaction(ops);
      if (!(txResult as any).ok) {
        console.error('Check-out transaction failed:', (txResult as any).error);
        toast({ title: 'Check-out Failed', description: 'Could not process check-out', variant: 'destructive' });
        return false;
      }

      await loadAllData();
      return true;
    } catch (e: any) {
      console.error('Check-out error:', e?.message || e);
      toast({ title: 'Check-out Failed', description: e?.message || 'An error occurred during check-out', variant: 'destructive' });
      return false;
    }
  };

  // FRONT OFFICE - Update room status
  const updateRoomStatus = async (roomId: string, status: string): Promise<boolean> => {
    try {
      const sql = "UPDATE rooms SET status = ? WHERE id = ?";
      const result = await db.query(sql, [status, roomId]);
      if ('error' in result) {
        console.error('Room status update failed:', (result as any).error);
        toast({ title: 'Update Failed', description: 'Could not update room status', variant: 'destructive' });
        return false;
      }
      await loadAllData();
      return true;
    } catch (e: any) {
      console.error('Update room status error:', e?.message || e);
      toast({ title: 'Update Failed', description: 'Could not update room status', variant: 'destructive' });
      return false;
    }
  };

  // FRONT OFFICE - Add folio charge
  const addFolioCharge = async (chargeData: { guestId: string; amount: number; code?: string; description?: string; date: string; category?: string }): Promise<boolean> => {
    try {
      const chargeId = `CHG${Date.now()}_${Math.random().toString(36).substring(2, 9)} `;
      const newCharge = {
        id: chargeId,
        guestId: chargeData.guestId,
        description: chargeData.description || chargeData.code || 'Charge',
        amount: Number(chargeData.amount || 0),
        date: chargeData.date,
        category: chargeData.category || 'Other',
        type: 'charge',
        source: 'front_office'
      };

      // Update state
      setFolioCharges((prev: Record<string, unknown>[]) => {
        const next = [...prev, newCharge];
        // Also persist to localStorage
        try {
          localStorage.setItem('corepms_folioCharges', JSON.stringify(next));
        } catch { /* noop — localStorage is best-effort */ }
        return next;
      });

      // Sync to database
      const { syncFolioChargeToDb } = await import('../lib/dbSync');
      const syncResult = await syncFolioChargeToDb({
        id: newCharge.id,
        guest_id: newCharge.guestId,
        description: newCharge.description,
        amount: newCharge.amount,
        posting_date: newCharge.date,
        category: newCharge.category,
        charge_type: newCharge.type as 'charge',
        source: newCharge.source as 'front_office',
        total_amount: newCharge.amount
      });

      if (!syncResult.success) {
        console.error('Folio charge sync failed:', syncResult.error);
        toast({ title: 'Charge Sync Failed', description: 'Charge saved locally but sync to database failed', variant: 'destructive' });
        return false;
      }

      return true;
    } catch (e: any) {
      console.error('Add folio charge error:', e?.message || e);
      toast({ title: 'Charge Failed', description: 'Could not add folio charge', variant: 'destructive' });
      return false;
    }
  };

  // POS - Record folio charge (returns charge ID)
  const recordFolioCharge = async (chargeData: { guestId: string; amount: number; description: string; date: string; category?: string }): Promise<string | null> => {
    try {
      const chargeId = `CHG${Date.now()}_${Math.random().toString(36).substring(2, 9)} `;
      const newCharge = {
        id: chargeId,
        guestId: chargeData.guestId,
        description: chargeData.description,
        amount: Number(chargeData.amount || 0),
        date: chargeData.date,
        category: chargeData.category || 'F&B',
        type: 'charge',
        source: 'pos'
      };

      setFolioCharges((prev: Record<string, unknown>[]) => {
        const next = [...prev, newCharge];
        // Also persist to localStorage
        try {
          localStorage.setItem('corepms_folioCharges', JSON.stringify(next));
        } catch { /* noop — localStorage is best-effort */ }
        return next;
      });

      // Sync to database
      const { syncFolioChargeToDb } = await import('../lib/dbSync');
      const syncResult = await syncFolioChargeToDb({
        id: newCharge.id,
        guest_id: newCharge.guestId,
        description: newCharge.description,
        amount: newCharge.amount,
        posting_date: newCharge.date,
        category: newCharge.category,
        charge_type: newCharge.type as 'charge',
        source: newCharge.source as 'pos',
        total_amount: newCharge.amount
      });

      if (!syncResult.success) {
        console.error('Folio charge sync failed:', syncResult.error);
        toast({ title: 'Charge Sync Failed', description: 'Charge saved locally but sync to database failed', variant: 'destructive' });
        return null;
      }

      return chargeId;
    } catch (e: any) {
      console.error('Record folio charge error:', e?.message || e);
      return null;
    }
  };

  // FRONT OFFICE - Void folio charge
  const voidFolioCharge = async (chargeId: string, reason: string, actor: string): Promise<boolean> => {
    try {
      const chargeIndex = folioCharges.findIndex((c: any) => c.id === chargeId);
      if (chargeIndex === -1) return false;

      const charge = folioCharges[chargeIndex] as any;
      const now = new Date().toISOString();

      const updatedCharge = {
        ...charge,
        is_voided: true,
        voidedAt: now,
        voidedBy: actor,
        voidReason: reason
      };

      // Update local state
      setFolioCharges((prev: any[]) => prev.map(c => c.id === chargeId ? updatedCharge : c));

      // Sync to database
      const { syncFolioChargeToDb } = await import('../lib/dbSync');
      await syncFolioChargeToDb({
        ...updatedCharge,
        guest_id: charge.guestId || charge.guest_id,
        charge_type: charge.type || charge.charge_type || 'charge',
        is_voided: true,
        voided_at: now,
        voided_by: actor,
        void_reason: reason,
        total_amount: charge.amount
      } as any);

      return true;
    } catch (e) {
      console.error('Void folio charge error:', e);
      return false;
    }
  };

  // FRONT OFFICE - Transfer folio charge
  const transferFolioCharge = async (chargeId: string, targetGuestId: string, actor: string): Promise<boolean> => {
    try {
      const chargeIndex = folioCharges.findIndex((c: any) => c.id === chargeId);
      if (chargeIndex === -1) return false;

      const charge = folioCharges[chargeIndex] as any;
      const sourceGuestId = charge.guestId || charge.guest_id;

      const updatedCharge = {
        ...charge,
        guestId: targetGuestId,
        guest_id: targetGuestId,
        transferredFrom: sourceGuestId,
        transferredBy: actor,
        transferredAt: new Date().toISOString()
      };

      // Update local state
      setFolioCharges((prev: any[]) => prev.map(c => c.id === chargeId ? updatedCharge : c));

      // Sync to database
      const { syncFolioChargeToDb } = await import('../lib/dbSync');
      await syncFolioChargeToDb({
        ...updatedCharge,
        guest_id: targetGuestId,
        charge_type: charge.type || charge.charge_type || 'charge',
        total_amount: charge.amount
      } as any);

      return true;
    } catch (e) {
      console.error('Transfer folio charge error:', e);
      return false;
    }
  };

  // POS - Record folio payment (for settlement)
  const recordFolioPayment = async (paymentData: { guestId: string; amount: number; description: string; date: string; method?: string }): Promise<string | null> => {
    try {
      const paymentId = `PAY${Date.now()}_${Math.random().toString(36).substring(2, 9)} `;
      const newPayment = {
        id: paymentId,
        guestId: paymentData.guestId,
        description: paymentData.description || `Payment - ${paymentData.method || 'Cash'} `,
        amount: -Math.abs(Number(paymentData.amount || 0)), // Negative for payments
        date: paymentData.date,
        category: 'Payment',
        type: 'payment',
        method: paymentData.method || 'Cash',
        source: 'front_office'
      };

      setFolioCharges((prev: Record<string, unknown>[]) => {
        const next = [...prev, newPayment];
        // Also persist to localStorage
        try {
          localStorage.setItem('corepms_folioCharges', JSON.stringify(next));
        } catch { /* noop — localStorage is best-effort */ }
        return next;
      });

      // Sync to database
      const { syncFolioChargeToDb } = await import('../lib/dbSync');
      const syncResult = await syncFolioChargeToDb({
        id: newPayment.id,
        guest_id: newPayment.guestId,
        description: newPayment.description,
        amount: Math.abs(newPayment.amount), // Use positive amount for database
        posting_date: newPayment.date,
        category: newPayment.category,
        charge_type: newPayment.type as 'payment',
        source: newPayment.source as 'front_office',
        total_amount: Math.abs(newPayment.amount)
      });

      if (!syncResult.success) {
        console.error('Folio payment sync failed:', syncResult.error);
        toast({ title: 'Payment Sync Failed', description: 'Payment saved locally but sync to database failed', variant: 'destructive' });
        return null;
      }

      return paymentId;
    } catch (e: any) {
      console.error('Record folio payment error:', e?.message || e);
      return null;
    }
  };

  // POS - Remove folio charge
  const removeFolioCharge = async (chargeId: string): Promise<boolean> => {
    try {
      setFolioCharges((prev: any[]) => {
        const next = prev.filter(c => c.id !== chargeId);
        // Also persist to localStorage
        try {
          localStorage.setItem('corepms_folioCharges', JSON.stringify(next));
        } catch { /* noop — localStorage is best-effort */ }
        return next;
      });

      // In a real implementation, we would mark the charge as voided rather than deleting
      // For now, just return true since we're only removing from UI
      return true;
    } catch (e: any) {
      console.error('Remove folio charge error:', e?.message || e);
      return false;
    }
  };

  // ROOMS - Bulk update room status
  const bulkUpdateRoomStatus = async (roomIds: string[], status: string): Promise<boolean> => {
    try {
      if (!roomIds || roomIds.length === 0) return true;

      const placeholders = roomIds.map(() => '?').join(',');
      const sql = `UPDATE rooms SET status = ? WHERE id IN(${placeholders})`;
      const params = [status, ...roomIds];

      const result = await db.query(sql, params);
      if ('error' in result) {
        console.error('Bulk room status update failed:', (result as any).error);
        toast({ title: 'Update Failed', description: 'Could not update room statuses', variant: 'destructive' });
        return false;
      }

      await loadAllData();
      return true;
    } catch (e: any) {
      console.error('Bulk update room status error:', e?.message || e);
      toast({ title: 'Update Failed', description: 'Could not update room statuses', variant: 'destructive' });
      return false;
    }
  };

  // ROOMS - Bulk delete rooms
  const bulkDeleteRooms = async (roomIds: string[]): Promise<boolean> => {
    try {
      if (!roomIds || roomIds.length === 0) return true;

      const placeholders = roomIds.map(() => '?').join(',');
      const sql = `DELETE FROM rooms WHERE id IN(${placeholders})`;

      const result = await db.query(sql, roomIds);
      if ('error' in result) {
        console.error('Bulk room delete failed:', (result as any).error);
        toast({ title: 'Delete Failed', description: 'Could not delete rooms', variant: 'destructive' });
        return false;
      }

      await loadAllData();
      return true;
    } catch (e: any) {
      console.error('Bulk delete rooms error:', e?.message || e);
      toast({ title: 'Delete Failed', description: 'Could not delete rooms', variant: 'destructive' });
      return false;
    }
  };

  // ROOMS - Get room audit trail
  const getRoomAudit = async (): Promise<any[]> => {
    try {
      // Since there's no dedicated audit table, we'll return an empty array
      // The actual audit trail would need to be implemented with a separate audit table
      return [];
    } catch (e: any) {
      console.error('Get room audit failed:', e?.message || e);
      return [];
    }
  };

  // ROOMS - Revert room change (placeholder)
  const revertRoomChange = async (auditId: string): Promise<boolean> => {
    try {
      // Since there's no audit table implemented, this is a placeholder
      toast({ title: 'Revert Feature', description: 'Audit trail functionality not yet implemented', variant: 'destructive' });
      return false;
    } catch (e: any) {
      console.error('Revert room change failed:', e?.message || e);
      toast({ title: 'Revert Failed', description: 'Could not revert room change', variant: 'destructive' });
      return false;
    }
  };

   // Helper function to calculate account balance
   const calculateAccountBalance = (accountId: string, transactions: any[]) => {
     if (!transactions || transactions.length === 0) return 0;

     return transactions.reduce((balance, txn) => {
       if (txn.debit_amount) {
         return balance + Number(txn.debit_amount);
       } else if (txn.credit_amount) {
         return balance - Number(txn.credit_amount);
       }
       return balance;
     }, 0);
   };

  // Helper function to determine transaction type based on data
  const determineTransactionType = (transactionData: any) => {
    if (transactionData.type) {
      // If transaction type is explicitly provided, validate it
      if (['charge', 'payment', 'adjustment', 'general'].includes(transactionData.type)) {
        return transactionData.type;
      }
    }

    // Determine based on debit/credit values
    if (transactionData.debit && !transactionData.credit) {
      // Debit only - likely a charge
      return 'charge';
    } else if (transactionData.credit && !transactionData.debit) {
      // Credit only - likely a payment
      return 'payment';
    } else if (transactionData.credit && transactionData.debit) {
      // Both debit and credit - likely an adjustment
      return 'adjustment';
    }

    // Default to general if no clear indication
    return 'general';
  };

  // CITY LEDGER - Load city ledger data
  const loadCityLedger = React.useCallback(async () => {
    try {
      // Create or ensure city_ledger table structure
      try {
        // First, try to create the table if it doesn't exist
        await db.query(`CREATE TABLE IF NOT EXISTS city_ledger_accounts(
    id TEXT PRIMARY KEY,
    account_name TEXT NOT NULL,  // Changed from 'name' to 'account_name' to match existing constraint
    type TEXT NOT NULL,
    credit_limit DECIMAL(10, 2),
    payment_terms TEXT,
    status TEXT DEFAULT 'Active',
    activated_on DATE,
    contact_name TEXT,
    contact_phone TEXT,
    contact_email TEXT,
    address TEXT,
    billing_cycle TEXT,
    balance DECIMAL(10, 2) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);
      } catch (createErr) {
        console.warn('Could not create table, may already exist:', createErr);
      }

      // Add columns if they don't exist (PostgreSQL specific)
      try {
        await db.query(`ALTER TABLE city_ledger_accounts ADD COLUMN IF NOT EXISTS account_name TEXT NOT NULL DEFAULT ''; `);
      } catch (e) {
        // Column may already exist, which is fine
      }
      try {
        await db.query(`ALTER TABLE city_ledger_accounts ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'Corporate'; `);
      } catch (e) {
        // Column may already exist, which is fine
      }
      try {
        await db.query(`ALTER TABLE city_ledger_accounts ADD COLUMN IF NOT EXISTS contact_name TEXT; `);
      } catch (e) {
        // Column may already exist, which is fine
      }
      try {
        await db.query(`ALTER TABLE city_ledger_accounts ADD COLUMN IF NOT EXISTS contact_phone TEXT; `);
      } catch (e) {
        // Column may already exist, which is fine
      }
      try {
        await db.query(`ALTER TABLE city_ledger_accounts ADD COLUMN IF NOT EXISTS contact_email TEXT; `);
      } catch (e) {
        // Column may already exist, which is fine
      }
      try {
        await db.query(`ALTER TABLE city_ledger_accounts ADD COLUMN IF NOT EXISTS address TEXT; `);
      } catch (e) {
        // Column may already exist, which is fine
      }
      try {
        await db.query(`ALTER TABLE city_ledger_accounts ADD COLUMN IF NOT EXISTS billing_cycle TEXT; `);
      } catch (e) {
        // Column may already exist, which is fine
      }
      try {
        await db.query(`ALTER TABLE city_ledger_accounts ADD COLUMN IF NOT EXISTS balance DECIMAL(10, 2) DEFAULT 0; `);
      } catch (e) {
        // Column may already exist, which is fine
      }
      try {
        await db.query(`ALTER TABLE city_ledger_accounts ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP; `);
      } catch (e) {
        // Column may already exist, which is fine
      }
      try {
        await db.query(`ALTER TABLE city_ledger_accounts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP; `);
      } catch (e) {
        // Column may already exist, which is fine
      }

      // Create city_ledger_transactions table if it doesn't exist
      try {
        await db.query(`CREATE TABLE IF NOT EXISTS city_ledger_transactions(
    id TEXT PRIMARY KEY,
    account_id TEXT,
    date_field DATE NOT NULL, --Changed from 'date' to 'date_field' to avoid conflict with reserved keyword
          reference TEXT, --Added reference column
          description TEXT NOT NULL,
  debit DECIMAL(10, 2),
    credit DECIMAL(10, 2),
      transaction_type TEXT DEFAULT 'general', --Added transaction_type column with default
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
      } catch (createErr) {
        console.warn('Could not create city_ledger_transactions table, may already exist:', createErr);
      }

      // Add columns if they don't exist for transactions table
      try {
        await db.query(`ALTER TABLE city_ledger_transactions ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP; `);
      } catch (e) {
        // Column may already exist, which is fine
      }

      // Ensure critical columns exist (including date column)
      try {
        await db.query(`ALTER TABLE city_ledger_transactions ADD COLUMN IF NOT EXISTS date_field DATE; `);
      } catch (e) {
        // Column may already exist, which is fine
      }

      // For backward compatibility, also add the 'date' column if it doesn't exist
      try {
        await db.query(`ALTER TABLE city_ledger_transactions ADD COLUMN IF NOT EXISTS date DATE; `);
      } catch (e) {
        // Column may already exist, which is fine
      }

      // Ensure reference column exists
      try {
        await db.query(`ALTER TABLE city_ledger_transactions ADD COLUMN IF NOT EXISTS reference TEXT; `);
      } catch (e) {
        // Column may already exist, which is fine
      }

      // Ensure description column exists
      try {
        await db.query(`ALTER TABLE city_ledger_transactions ADD COLUMN IF NOT EXISTS description TEXT; `);
      } catch (e) {
        // Column may already exist, which is fine
      }

      // Ensure debit column exists
      try {
        await db.query(`ALTER TABLE city_ledger_transactions ADD COLUMN IF NOT EXISTS debit DECIMAL(10, 2); `);
      } catch (e) {
        // Column may already exist, which is fine
      }

      // Ensure credit column exists
      try {
        await db.query(`ALTER TABLE city_ledger_transactions ADD COLUMN IF NOT EXISTS credit DECIMAL(10, 2); `);
      } catch (e) {
        // Column may already exist, which is fine
      }

      // Ensure transaction_type column exists with default value
      try {
        await db.query(`ALTER TABLE city_ledger_transactions ADD COLUMN IF NOT EXISTS transaction_type TEXT DEFAULT 'general'; `);
      } catch (e) {
        // Column may already exist, which is fine
      }

      // Ensure foreign key constraint exists
      try {
        // Add account_id column if missing
        await db.query(`ALTER TABLE city_ledger_transactions ADD COLUMN IF NOT EXISTS account_id TEXT; `);
      } catch (e) {
        // Column may already exist, which is fine
      }

      // Create the foreign key constraint idempotently
      // PostgreSQL does NOT support ADD CONSTRAINT IF NOT EXISTS — use DO block instead
      try {
        await db.query(`
          DO $$ BEGIN
            ALTER TABLE city_ledger_transactions
              ADD CONSTRAINT fk_transaction_account
              FOREIGN KEY(account_id) REFERENCES city_ledger_accounts(id);
          EXCEPTION WHEN duplicate_object THEN NULL;
          END $$;
        `);
      } catch (e) {
        // Constraint already exists, which is fine
      }

      // Create city_ledger_notes table if it doesn't exist
      try {
        await db.query(`CREATE TABLE IF NOT EXISTS city_ledger_notes(
          id TEXT PRIMARY KEY,
          account_id TEXT,
          date_field DATE NOT NULL,
          author TEXT,
          text TEXT NOT NULL,
          note_type TEXT DEFAULT 'general',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
      } catch (createErr) {
        console.warn('Could not create city_ledger_notes table, may already exist:', createErr);
      }

      // Add columns if they don't exist for notes table
      try {
        await db.query(`ALTER TABLE city_ledger_notes ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP; `);
      } catch (e) {
        // Column may already exist, which is fine
      }

      // Ensure critical columns exist (including date column)
      try {
        await db.query(`ALTER TABLE city_ledger_notes ADD COLUMN IF NOT EXISTS date_field DATE; `);
      } catch (e) {
        // Column may already exist, which is fine
      }

      // For backward compatibility, also add the 'date' column if it doesn't exist
      try {
        await db.query(`ALTER TABLE city_ledger_notes ADD COLUMN IF NOT EXISTS date DATE; `);
      } catch (e) {
        // Column may already exist, which is fine
      }

      // Ensure author column exists
      try {
        await db.query(`ALTER TABLE city_ledger_notes ADD COLUMN IF NOT EXISTS author TEXT; `);
      } catch (e) {
        // Column may already exist, which is fine
      }

      // Ensure text column exists
      try {
        await db.query(`ALTER TABLE city_ledger_notes ADD COLUMN IF NOT EXISTS text TEXT; `);
      } catch (e) {
        // Column may already exist, which is fine
      }

      // Ensure note_type column exists with default value
      try {
        await db.query(`ALTER TABLE city_ledger_notes ADD COLUMN IF NOT EXISTS note_type TEXT DEFAULT 'general'; `);
      } catch (e) {
        // Column may already exist, which is fine
      }

      // Ensure foreign key constraint exists
      try {
        // Add account_id column if missing
        await db.query(`ALTER TABLE city_ledger_notes ADD COLUMN IF NOT EXISTS account_id TEXT; `);
      } catch (e) {
        // Column may already exist, which is fine
      }

      // Create the foreign key constraint idempotently
      // PostgreSQL does NOT support ADD CONSTRAINT IF NOT EXISTS — use DO block instead
      try {
        await db.query(`
          DO $$ BEGIN
            ALTER TABLE city_ledger_notes
              ADD CONSTRAINT fk_note_account
              FOREIGN KEY(account_id) REFERENCES city_ledger_accounts(id);
          EXCEPTION WHEN duplicate_object THEN NULL;
          END $$;
        `);
      } catch (e) {
        // Constraint already exists, which is fine
      }

       // Load all city ledger accounts
       const accountsRes = await db.query('SELECT * FROM city_ledger_accounts ORDER BY account_name');
       if ('rows' in accountsRes) {
         const accounts = (accountsRes.rows || []).map((acc: any) => ({
           ...acc,
           // Try to get name from either 'name' or 'account_name' column for compatibility
           name: acc.name || acc.account_name || '',
           // Load transactions for each account
           transactions: [] as any[],
           notes: [] as any[],
         }));

        // Load all transactions
        const transactionsRes = await db.query('SELECT *, COALESCE(date_field, date) as date FROM city_ledger_transactions ORDER BY COALESCE(date_field, date) DESC');
        if ('rows' in transactionsRes) {
          const transactions = transactionsRes.rows || [];

          // Group transactions by account
          const transactionsByAccount = transactions.reduce((acc, txn) => {
            if (!acc[txn.account_id]) acc[txn.account_id] = [];
            acc[txn.account_id].push(txn);
            return acc;
          }, {});

          // Attach transactions to accounts
          const accountsWithTxns = accounts.map(acc => ({
            ...acc,
            transactions: transactionsByAccount[acc.id] || [],
            balance: calculateAccountBalance(acc.id, transactionsByAccount[acc.id] || []),
          }));

          // Load all notes
          const notesRes = await db.query('SELECT *, COALESCE(date_field, date) as date FROM city_ledger_notes ORDER BY COALESCE(date_field, date) DESC');
          if ('rows' in notesRes) {
            const notes = notesRes.rows || [];

            // Group notes by account
            const notesByAccount = notes.reduce((acc, note) => {
              if (!acc[note.account_id]) acc[note.account_id] = [];
              acc[note.account_id].push(note);
              return acc;
            }, {});

            // Attach notes to accounts
            const accountsWithNotes = accountsWithTxns.map(acc => ({
              ...acc,
              notes: notesByAccount[acc.id] || [],
            }));

            setCityLedger(accountsWithNotes);

            // Save to localStorage for reports to access
            try {
              localStorage.setItem('corepms_city_ledger', JSON.stringify(accountsWithNotes));
            } catch (e) {
              console.warn('Failed to save city ledger to localStorage:', e);
            }
          }
        }
      }
    } catch (error) {
      console.error('Failed to load city ledger data:', error);
    }
  }, []);

  // CITY LEDGER - Add a new city ledger account
  const addCityLedgerAccount = async (accountData: any): Promise<boolean> => {
    try {
      // Get current count to generate a 4-digit ID (starting at 1001)
      const countRes = await db.query('SELECT COUNT(*) as count FROM city_ledger_accounts');
      const count = Number((countRes as any).rows?.[0]?.count || 0);
      const accountId = String(1001 + count).padStart(4, '0');

      const sql = `INSERT INTO city_ledger_accounts(
      id, account_name, type, credit_limit, payment_terms, status, activated_on, contact_name,
      contact_phone, contact_email, address, billing_cycle, created_at, updated_at
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`;

      const params = [
        accountId,
        accountData.name || '',
        accountData.type,
        accountData.creditLimit,
        accountData.paymentTerms,
        accountData.status,
        accountData.activatedOn,
        accountData.contactName || null,
        accountData.contactPhone || null,
        accountData.contactEmail || null,
        accountData.address || null,
        accountData.billingCycle || 'Monthly'
      ];

      const result = await db.query(sql, params);
      if ('error' in result) {
        console.error('City ledger account insert failed:', (result as any).error);
        toast({ title: 'Database Write Failed', description: 'City ledger account could not be saved', variant: 'destructive' });
        return false;
      }

      // Reload the city ledger data
      await loadCityLedger();
      return true;
    } catch (e: any) {
      console.error('Add city ledger account error:', e?.message || e);
      toast({ title: 'Database Write Failed', description: 'City ledger account could not be saved', variant: 'destructive' });
      return false;
    }
  };

  // CITY LEDGER - Update a city ledger account
  const updateCityLedgerAccount = async (accountId: string, updateData: any): Promise<boolean> => {
    try {
      // Build dynamic SQL with only provided fields
      const fields = [];
      const values = [];

      Object.keys(updateData).forEach(key => {
        // Map the frontend field names to database column names
        let columnName = key;
        if (key === 'name') {
          columnName = 'account_name';
        }
        fields.push(`${columnName} = ?`);
        values.push(updateData[key]);
      });

      if (fields.length === 0) return true; // Nothing to update

      // Add updated_at to the fields to update
      fields.push('updated_at = NOW()');
      const sql = `UPDATE city_ledger_accounts SET ${fields.join(', ')} WHERE id = ? `;
      values.push(accountId);

      const result = await db.query(sql, values);
      if ('error' in result) {
        console.error('City ledger account update failed:', (result as any).error);
        toast({ title: 'Update Failed', description: 'City ledger account could not be updated', variant: 'destructive' });
        return false;
      }

      // Reload the city ledger data
      await loadCityLedger();
      return true;
    } catch (e: any) {
      console.error('Update city ledger account error:', e?.message || e);
      toast({ title: 'Update Failed', description: 'City ledger account could not be updated', variant: 'destructive' });
      return false;
    }
  };

  // CITY LEDGER - Add a transaction to a city ledger account
  const addCityLedgerTransaction = async (accountId: string, transactionData: any): Promise<boolean> => {
    try {
      const transactionId = `TX${Date.now()}_${Math.random().toString(36).substring(2, 9)} `;

      const sql = `INSERT INTO city_ledger_transactions(
      id, account_id, date_field, reference, description, debit, credit, transaction_type, created_at
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, NOW())`;

      const params = [
        transactionId,
        accountId,
        transactionData.date || new Date().toISOString().split('T')[0],
        transactionData.reference,
        transactionData.description,
        transactionData.debit || null,
        transactionData.credit || null,
        determineTransactionType(transactionData)  // Determine appropriate transaction type
      ];

      const result = await db.query(sql, params);
      if ('error' in result) {
        console.error('City ledger transaction insert failed:', (result as any).error);
        toast({ title: 'Database Write Failed', description: 'City ledger transaction could not be saved', variant: 'destructive' });
        return false;
      }

      // Reload the city ledger data
      await loadCityLedger();
      return true;
    } catch (e: any) {
      console.error('Add city ledger transaction error:', e?.message || e);
      toast({ title: 'Database Write Failed', description: 'City ledger transaction could not be saved', variant: 'destructive' });
      return false;
    }
  };

  // CITY LEDGER - Add a note to a city ledger account
  const addCityLedgerNote = async (accountId: string, noteData: any): Promise<boolean> => {
    try {
      const noteId = `NOTE${Date.now()}_${Math.random().toString(36).substring(2, 9)} `;

      const sql = `INSERT INTO city_ledger_notes(
      id, account_id, date_field, author, text, note_type, created_at
    ) VALUES(?, ?, ?, ?, ?, ?, NOW())`;

      const params = [
        noteId,
        accountId,
        noteData.date || new Date().toISOString().split('T')[0],
        noteData.author,
        noteData.text,
        noteData.noteType || 'general'  // Add note type
      ];

      const result = await db.query(sql, params);
      if ('error' in result) {
        console.error('City ledger note insert failed:', (result as any).error);
        toast({ title: 'Database Write Failed', description: 'City ledger note could not be saved', variant: 'destructive' });
        return false;
      }

      // Reload the city ledger data
      await loadCityLedger();
      return true;
    } catch (e: any) {
      console.error('Add city ledger note error:', e?.message || e);
      toast({ title: 'Database Write Failed', description: 'City ledger note could not be saved', variant: 'destructive' });
      return false;
    }
  };

  // CITY LEDGER - Delete a transaction
  const deleteCityLedgerTransaction = async (accountId: string, transactionId: string | number): Promise<boolean> => {
    try {
      // If it's an ID from the table (TX...), use DELETE
      if (typeof transactionId === 'string' && transactionId.startsWith('TX')) {
        await db.query('DELETE FROM city_ledger_transactions WHERE id = ?', [transactionId]);
      } else {
        // Fallback or handle differently if needed
        console.warn('Delete transaction: expected transaction ID starting with TX');
      }
      await loadCityLedger();
      return true;
    } catch (e) {
      console.error('Delete city ledger txn error:', e);
      return false;
    }
  };

  // CITY LEDGER - Void a transaction (keep record but zero amounts)
  const voidCityLedgerTransaction = async (accountId: string, transactionId: string | number): Promise<boolean> => {
    try {
      if (typeof transactionId === 'string' && transactionId.startsWith('TX')) {
        await db.query(`
          UPDATE city_ledger_transactions 
          SET debit = 0, credit = 0, description = description || ' (VOIDED)', transaction_type = 'voided'
          WHERE id = ?
        `, [transactionId]);
      }
      await loadCityLedger();
      return true;
    } catch (e) {
      console.error('Void city ledger txn error:', e);
      return false;
    }
  };

  // CITY LEDGER - Transfer a transaction to a guest folio
  const transferCityLedgerToGuest = async (accountId: string, transactionId: string, guestId: string): Promise<boolean> => {
    try {
      // 1. Fetch the transaction details
      const txnRes = await db.query('SELECT * FROM city_ledger_transactions WHERE id = ?', [transactionId]);
      if (!('rows' in txnRes) || txnRes.rows.length === 0) return false;
      const txn = txnRes.rows[0];

      // 2. Create the folio charge
      const amount = Number(txn.debit || txn.credit || 0);
      const description = `Transfer from AR: ${txn.description} (${txn.reference || ''})`;
      
      // We use recordFolioCharge if it exists.
      if (typeof recordFolioCharge === 'function') {
        await recordFolioCharge(guestId, {
          amount,
          description,
          code: 'TRANS-AR',
          date: new Date().toISOString()
        });
      }

      // 3. Void the City Ledger transaction
      await voidCityLedgerTransaction(accountId, transactionId);
      
      return true;
    } catch (e) {
      console.error('Transfer City Ledger to Guest error:', e);
      return false;
    }
  };

  // CHECK - Ensure POS tables exist
  const ensurePosTables = async () => {
    try {
      // Create pos_orders table
      await db.query(`
        CREATE TABLE IF NOT EXISTS pos_orders(
      id VARCHAR(36) PRIMARY KEY,
      table_number VARCHAR(20),
      items JSONB,
      total_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
      status VARCHAR(50) NOT NULL DEFAULT 'open',
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
`);

      // Create table_status table if it doesn't exist
      await db.query(`
        CREATE TABLE IF NOT EXISTS table_status(
  table_id VARCHAR(20) PRIMARY KEY,
  status VARCHAR(50) DEFAULT 'open',
  last_update TIMESTAMP DEFAULT NOW()
);
`);

      console.log('POS tables created/verified successfully');
    } catch (e: any) {
      console.error('Error creating POS tables:', e?.message || e);
    }
  };

  // VENDORS - Ensure vendor tables exist
  const ensureVendorTables = async () => {
    try {
      // Create vendors table
      await db.query(`CREATE TABLE IF NOT EXISTS vendors(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  contact_person TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  tax_id TEXT,
  payment_terms TEXT DEFAULT 'Net 30',
  credit_limit REAL DEFAULT 0,
  current_balance REAL DEFAULT 0,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`);

      // Add contact_person column to vendors if it doesn't exist
      try {
        await db.query(`ALTER TABLE vendors ADD COLUMN IF NOT EXISTS contact_person TEXT; `);
      } catch (e) {
        // Column may already exist, which is fine
      }

      // Add phone column to vendors if it doesn't exist
      try {
        await db.query(`ALTER TABLE vendors ADD COLUMN IF NOT EXISTS phone TEXT; `);
      } catch (e) {
        // Column may already exist, which is fine
      }

      // Add email column to vendors if it doesn't exist
      try {
        await db.query(`ALTER TABLE vendors ADD COLUMN IF NOT EXISTS email TEXT; `);
      } catch (e) {
        // Column may already exist, which is fine
      }

      // Add address column to vendors if it doesn't exist
      try {
        await db.query(`ALTER TABLE vendors ADD COLUMN IF NOT EXISTS address TEXT; `);
      } catch (e) {
        // Column may already exist, which is fine
      }

      // Add tax_id column to vendors if it doesn't exist
      try {
        await db.query(`ALTER TABLE vendors ADD COLUMN IF NOT EXISTS tax_id TEXT; `);
      } catch (e) {
        // Column may already exist, which is fine
      }

      // Add payment_terms column to vendors if it doesn't exist
      try {
        await db.query(`ALTER TABLE vendors ADD COLUMN IF NOT EXISTS payment_terms TEXT DEFAULT 'Net 30'; `);
      } catch (e) {
        // Column may already exist, which is fine
      }

      // Add credit_limit column to vendors if it doesn't exist
      try {
        await db.query(`ALTER TABLE vendors ADD COLUMN IF NOT EXISTS credit_limit REAL DEFAULT 0; `);
      } catch (e) {
        // Column may already exist, which is fine
      }

      // Add current_balance column to vendors if it doesn't exist
      try {
        await db.query(`ALTER TABLE vendors ADD COLUMN IF NOT EXISTS current_balance REAL DEFAULT 0; `);
      } catch (e) {
        // Column may already exist, which is fine
      }

      // Add status column to vendors if it doesn't exist
      try {
        await db.query(`ALTER TABLE vendors ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active'; `);
      } catch (e) {
        // Column may already exist, which is fine
      }

      // Add created_at column to vendors if it doesn't exist
      try {
        await db.query(`ALTER TABLE vendors ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP; `);
      } catch (e) {
        // Column may already exist, which is fine
      }

      // Add updated_at column to vendors if it doesn't exist
      try {
        await db.query(`ALTER TABLE vendors ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP; `);
      } catch (e) {
        // Column may already exist, which is fine
      }

      // Create vendor expenses table
      await db.query(`CREATE TABLE IF NOT EXISTS vendor_expenses(
  id TEXT PRIMARY KEY,
  vendor_id TEXT NOT NULL,
  description TEXT NOT NULL,
  quantity INTEGER DEFAULT 1,
  unit_cost REAL NOT NULL,
  total_cost REAL GENERATED ALWAYS AS(quantity * unit_cost) STORED,
  tax_amount REAL DEFAULT 0,
  tax_rate REAL DEFAULT 0,
  tax_inclusive BOOLEAN DEFAULT FALSE,
  expense_date DATE NOT NULL,
  reference_number TEXT,
  category TEXT,
  department TEXT,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(vendor_id) REFERENCES vendors(id) ON DELETE CASCADE
)`);

      // Create vendor payments table
      await db.query(`CREATE TABLE IF NOT EXISTS vendor_payments(
  id TEXT PRIMARY KEY,
  vendor_id TEXT NOT NULL,
  expense_ids TEXT, --Comma - separated expense IDs
        amount_paid REAL NOT NULL,
  payment_date DATE NOT NULL,
  payment_method TEXT,
  reference_number TEXT,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(vendor_id) REFERENCES vendors(id) ON DELETE CASCADE
)`);

      // Add updated_at trigger for vendors table if not exists
      try {
        const vendorTriggerCheck = await db.query(`SELECT * FROM information_schema.triggers WHERE trigger_name = 'vendors_updated_at_trigger'`);
        if (!('error' in vendorTriggerCheck) && 'rows' in vendorTriggerCheck && (vendorTriggerCheck.rows || []).length === 0) {
          await db.query(`CREATE OR REPLACE FUNCTION update_updated_at_column()
            RETURNS TRIGGER AS $$
BEGIN
NEW.updated_at = CURRENT_TIMESTAMP;
              RETURN NEW;
END;
            $$ language 'plpgsql';
          
            CREATE TRIGGER vendors_updated_at_trigger
              BEFORE UPDATE ON vendors
              FOR EACH ROW
              EXECUTE FUNCTION update_updated_at_column(); `);
        }
      } catch (e) {
        // Trigger may already exist, which is fine
      }

      // Add updated_at trigger for vendor_expenses table if not exists
      try {
        const expenseTriggerCheck = await db.query(`SELECT * FROM information_schema.triggers WHERE trigger_name = 'vendor_expenses_updated_at_trigger'`);
        if (!('error' in expenseTriggerCheck) && 'rows' in expenseTriggerCheck && (expenseTriggerCheck.rows || []).length === 0) {
          await db.query(`CREATE TRIGGER vendor_expenses_updated_at_trigger
            BEFORE UPDATE ON vendor_expenses
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column(); `);
        }
      } catch (e) {
        // Trigger may already exist, which is fine
      }

      // Add updated_at trigger for vendor_payments table if not exists
      try {
        const paymentTriggerCheck = await db.query(`SELECT * FROM information_schema.triggers WHERE trigger_name = 'vendor_payments_updated_at_trigger'`);
        if (!('error' in paymentTriggerCheck) && 'rows' in paymentTriggerCheck && (paymentTriggerCheck.rows || []).length === 0) {
          await db.query(`CREATE TRIGGER vendor_payments_updated_at_trigger
            BEFORE UPDATE ON vendor_payments
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column(); `);
        }
      } catch (e) {
        // Trigger may already exist, which is fine
      }

      // Add department column to vendor_expenses if it doesn't exist
      try {
        await db.query(`ALTER TABLE vendor_expenses ADD COLUMN IF NOT EXISTS department TEXT; `);
      } catch (e) {
        // Column may already exist, which is fine
      }

      // Add category column to vendor_expenses if it doesn't exist
      try {
        await db.query(`ALTER TABLE vendor_expenses ADD COLUMN IF NOT EXISTS category TEXT; `);
      } catch (e) {
        // Column may already exist, which is fine
      }

      // Add vendor_id column to vendor_payments if it doesn't exist
      try {
        await db.query(`ALTER TABLE vendor_payments ADD COLUMN IF NOT EXISTS vendor_id TEXT NOT NULL; `);
      } catch (e) {
        // Column may already exist, which is fine
      }

      // Add expense_ids column to vendor_payments if it doesn't exist
      try {
        await db.query(`ALTER TABLE vendor_payments ADD COLUMN IF NOT EXISTS expense_ids TEXT; `);
      } catch (e) {
        // Column may already exist, which is fine
      }

      // Add amount_paid column to vendor_payments if it doesn't exist
      try {
        await db.query(`ALTER TABLE vendor_payments ADD COLUMN IF NOT EXISTS amount_paid REAL NOT NULL; `);
      } catch (e) {
        // Column may already exist, which is fine
      }

      // Add payment_date column to vendor_payments if it doesn't exist
      try {
        await db.query(`ALTER TABLE vendor_payments ADD COLUMN IF NOT EXISTS payment_date DATE NOT NULL; `);
      } catch (e) {
        // Column may already exist, which is fine
      }

      // Add payment_method column to vendor_payments if it doesn't exist
      try {
        await db.query(`ALTER TABLE vendor_payments ADD COLUMN IF NOT EXISTS payment_method TEXT; `);
      } catch (e) {
        // Column may already exist, which is fine
      }

      // Add reference_number column to vendor_payments if it doesn't exist
      try {
        await db.query(`ALTER TABLE vendor_payments ADD COLUMN IF NOT EXISTS reference_number TEXT; `);
      } catch (e) {
        // Column may already exist, which is fine
      }

      // Add notes column to vendor_payments if it doesn't exist
      try {
        await db.query(`ALTER TABLE vendor_payments ADD COLUMN IF NOT EXISTS notes TEXT; `);
      } catch (e) {
        // Column may already exist, which is fine
      }

      // Add created_at column to vendor_expenses if it doesn't exist
      try {
        await db.query(`ALTER TABLE vendor_expenses ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP; `);
      } catch (e) {
        // Column may already exist, which is fine
      }

      // Add updated_at column to vendor_expenses if it doesn't exist
      try {
        await db.query(`ALTER TABLE vendor_expenses ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP; `);
      } catch (e) {
        // Column may already exist, which is fine
      }

      // Add void_status column to vendor_expenses (ACTIVE/VOIDED) — data-safe, defaults all existing rows to ACTIVE
      try {
        await db.query(`ALTER TABLE vendor_expenses ADD COLUMN IF NOT EXISTS void_status TEXT DEFAULT 'ACTIVE'; `);
      } catch (e) {
        // Column may already exist, which is fine
      }

      // Add voided_at column to vendor_expenses (timestamp when voided)
      try {
        await db.query(`ALTER TABLE vendor_expenses ADD COLUMN IF NOT EXISTS voided_at TIMESTAMP DEFAULT NULL; `);
      } catch (e) {
        // Column may already exist, which is fine
      }

      // Add voided_reason column to vendor_expenses (reason text for audit trail)
      try {
        await db.query(`ALTER TABLE vendor_expenses ADD COLUMN IF NOT EXISTS voided_reason TEXT DEFAULT NULL; `);
      } catch (e) {
        // Column may already exist, which is fine
      }

      // Add created_at column to vendor_payments if it doesn't exist
      try {
        await db.query(`ALTER TABLE vendor_payments ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP; `);
      } catch (e) {
        // Column may already exist, which is fine
      }

      // Add updated_at column to vendor_payments if it doesn't exist
      try {
        await db.query(`ALTER TABLE vendor_payments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP; `);
      } catch (e) {
        // Column may already exist, which is fine
      }

      // Make sure foreign key constraint is properly set
      try {
        // Check if foreign key constraint exists, if not create it
        const fkCheck = await db.query(`
          SELECT conname 
          FROM pg_constraint 
          WHERE conrelid = 'vendor_payments':: regclass 
          AND contype = 'f' 
          AND confrelid = 'vendors':: regclass
        `);

        if (('rows' in fkCheck) && (!fkCheck.rows || fkCheck.rows.length === 0)) {
          // Add foreign key constraint if it doesn't exist
          try {
            await db.query(`ALTER TABLE vendor_payments ADD CONSTRAINT fk_vendor_payments_vendor_id FOREIGN KEY(vendor_id) REFERENCES vendors(id) ON DELETE CASCADE; `);
          } catch (e) {
            // Foreign key may already exist, which is fine
          }
        }
      } catch (e) {
        // Just log the error if constraint check fails
        console.log('Foreign key check:', e.message);
      }

      console.log('Vendor tables created/verified successfully');
    } catch (e: any) {
      console.error('Error creating vendor tables:', e?.message || e);
      toast({ title: 'Database Error', description: 'Failed to create vendor tables', variant: 'destructive' });
    }
  };

  // VENDORS - Load all vendors
  const loadVendors = React.useCallback(async () => {
    try {
      const result = await db.query(
        `SELECT id, name, contact_person, phone, email, address, tax_id, payment_terms, credit_limit, current_balance, status, created_at, updated_at 
         FROM vendors 
         ORDER BY name ASC`
      );
      if ('error' in result) {
        console.error('Load vendors failed:', result.error);

        // Race condition fix: Await the full table ensure logic
        await ensureVendorTables();

        // Try loading again
        const retryResult = await db.query(
          `SELECT id, name, contact_person, phone, email, address, tax_id, payment_terms, credit_limit, current_balance, status, created_at, updated_at 
           FROM vendors 
           ORDER BY name ASC`
        );

        if ('error' in retryResult) {
          console.error('Load vendors failed after retry:', retryResult.error);
          const dbError = (retryResult as any).error?.message || (retryResult as any).error || 'Unknown Error';
          toast({ title: 'Database Read Failed', description: `Could not load vendors: ${dbError} `, variant: 'destructive' });
          return;
        }

        setVendors(retryResult.rows || []);
      } else {
        setVendors(result.rows || []);
      }
    } catch (e: any) {
      console.error('Load vendors error:', e?.message || e);
      toast({ title: 'Database Read Failed', description: `Could not load vendors: ${e?.message || e} `, variant: 'destructive' });
    }
  }, []);

  // VENDORS - Load all vendor expenses
  const loadVendorExpenses = React.useCallback(async () => {
    try {
      // First get all vendor expenses
      const expensesResult = await db.query(
        `SELECT ve.id, ve.vendor_id, ve.description, ve.quantity, ve.unit_cost, ve.total_cost, ve.tax_amount, ve.tax_rate, ve.tax_inclusive, ve.expense_date, ve.reference_number, ve.category, ve.department, ve.status, ve.created_at, ve.updated_at 
         FROM vendor_expenses ve
         ORDER BY ve.expense_date DESC, ve.created_at DESC`
      );

      if ('error' in expensesResult) {
        console.error('Load vendor expenses failed:', expensesResult.error);
        toast({ title: 'Database Read Failed', description: 'Could not load vendor expenses', variant: 'destructive' });
        return;
      }

      const expenses = expensesResult.rows || [];

      // If there are expenses, get vendor names separately to avoid expensive JOIN
      if (expenses.length > 0) {
        const vendorIds = [...new Set(expenses.map(expense => expense.vendor_id))];
        if (vendorIds.length > 0) {
          const vendorNamesQuery = `SELECT id, name FROM vendors WHERE id IN(${vendorIds.map(() => '?').join(',')})`;
          const vendorsResult = await db.query(vendorNamesQuery, vendorIds);

          if (!('error' in vendorsResult)) {
            const vendorMap = {};
            (vendorsResult.rows || []).forEach(vendor => {
              vendorMap[vendor.id] = vendor.name;
            });

            // Add vendor names to expenses
            expenses.forEach(expense => {
              expense.vendor_name = vendorMap[expense.vendor_id] || 'Unknown Vendor';
            });
          }
        }
      }

      setVendorExpenses(expenses);
    } catch (e: any) {
      console.error('Load vendor expenses error:', e?.message || e);
      toast({ title: 'Database Read Failed', description: 'Could not load vendor expenses', variant: 'destructive' });
    }
  }, []);

  // VENDORS - Load all vendor payments
  const loadVendorPayments = React.useCallback(async () => {
    try {
      // First get all vendor payments
      const paymentsResult = await db.query(
        `SELECT vp.id, vp.vendor_id, vp.expense_ids, vp.amount_paid, vp.payment_date, vp.payment_method, vp.reference_number, vp.notes, vp.created_at, vp.updated_at 
         FROM vendor_payments vp
         ORDER BY vp.payment_date DESC, vp.created_at DESC`
      );

      if ('error' in paymentsResult) {
        console.error('Load vendor payments failed:', paymentsResult.error);
        toast({ title: 'Database Read Failed', description: 'Could not load vendor payments', variant: 'destructive' });
        return;
      }

      const payments = paymentsResult.rows || [];

      // If there are payments, get vendor names separately to avoid expensive JOIN
      if (payments.length > 0) {
        const vendorIds = [...new Set(payments.map(payment => payment.vendor_id))];
        if (vendorIds.length > 0) {
          // PostgreSQL uses $1, $2, ... placeholders (not MySQL-style ?)
          const placeholders = vendorIds.map((_, i) => `$${i + 1}`).join(',');
          const vendorNamesQuery = `SELECT id, name FROM vendors WHERE id IN(${placeholders})`;
          const vendorsResult = await db.query(vendorNamesQuery, vendorIds);

          if (!('error' in vendorsResult)) {
            const vendorMap = {};
            (vendorsResult.rows || []).forEach(vendor => {
              vendorMap[vendor.id] = vendor.name;
            });

            // Add vendor names to payments
            payments.forEach(payment => {
              payment.vendor_name = vendorMap[payment.vendor_id] || 'Unknown Vendor';
            });
          }
        }
      }

      setVendorPayments(payments);
    } catch (e: any) {
      console.error('Load vendor payments error:', e?.message || e);
      toast({ title: 'Database Read Failed', description: 'Could not load vendor payments', variant: 'destructive' });
    }
  }, []);

  // VENDORS - Add a new vendor
  const addVendor = async (vendorData: any): Promise<boolean> => {
    try {
      const vendorId = `VND${Date.now()}_${Math.random().toString(36).substring(2, 9)} `;

      const sql = `INSERT INTO vendors(
  id, name, contact_person, phone, email, address, tax_id, payment_terms, credit_limit, current_balance, status, created_at, updated_at
) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`;

      const params = [
        vendorId,
        vendorData.name,
        vendorData.contact_person || null,
        vendorData.phone || null,
        vendorData.email || null,
        vendorData.address || null,
        vendorData.tax_id || null,
        vendorData.payment_terms || 'Net 30',
        parseFloat(vendorData.credit_limit) || 0,
        parseFloat(vendorData.current_balance) || 0,
        vendorData.status || 'active'
      ];

      const result = await db.query(sql, params);
      if ('error' in result) {
        console.error('Vendor insert failed:', result.error);
        toast({ title: 'Database Write Failed', description: 'Vendor could not be saved', variant: 'destructive' });
        return false;
      }

      // Reload vendors
      await loadVendors();
      return true;
    } catch (e: any) {
      console.error('Add vendor error:', e?.message || e);
      toast({ title: 'Database Write Failed', description: 'Vendor could not be saved', variant: 'destructive' });
      return false;
    }
  };

  // VENDORS - Update a vendor
  const updateVendor = async (vendorId: string, vendorData: any): Promise<boolean> => {
    try {
      const sql = `UPDATE vendors SET
name = ?, contact_person = ?, phone = ?, email = ?, address = ?, tax_id = ?,
  payment_terms = ?, credit_limit = ?, current_balance = ?, status = ?, updated_at = NOW()
        WHERE id = ? `;

      const params = [
        vendorData.name,
        vendorData.contact_person || null,
        vendorData.phone || null,
        vendorData.email || null,
        vendorData.address || null,
        vendorData.tax_id || null,
        vendorData.payment_terms || 'Net 30',
        parseFloat(vendorData.credit_limit) || 0,
        parseFloat(vendorData.current_balance) || 0,
        vendorData.status || 'active',
        vendorId
      ];

      const result = await db.query(sql, params);
      if ('error' in result) {
        console.error('Vendor update failed:', result.error);
        toast({ title: 'Database Write Failed', description: 'Vendor could not be updated', variant: 'destructive' });
        return false;
      }

      // Reload vendors
      await loadVendors();
      return true;
    } catch (e: any) {
      console.error('Update vendor error:', e?.message || e);
      toast({ title: 'Database Write Failed', description: 'Vendor could not be updated', variant: 'destructive' });
      return false;
    }
  };

  // VENDORS - Delete a vendor
  const deleteVendor = async (vendorId: string): Promise<boolean> => {
    try {
      const sql = `DELETE FROM vendors WHERE id = ? `;
      const result = await db.query(sql, [vendorId]);
      if ('error' in result) {
        console.error('Vendor delete failed:', result.error);
        toast({ title: 'Database Write Failed', description: 'Vendor could not be deleted', variant: 'destructive' });
        return false;
      }

      // Reload vendors
      await loadVendors();
      return true;
    } catch (e: any) {
      console.error('Delete vendor error:', e?.message || e);
      toast({ title: 'Database Write Failed', description: 'Vendor could not be deleted', variant: 'destructive' });
      return false;
    }
  };

  // VENDORS - Add a new expense
  const addVendorExpense = async (expenseData: any): Promise<boolean> => {
    try {
      const expenseId = `EXP${Date.now()}_${Math.random().toString(36).substring(2, 9)} `;

      const sql = `INSERT INTO vendor_expenses(
    id, vendor_id, description, quantity, unit_cost, tax_amount, tax_rate, tax_inclusive, expense_date, reference_number, category, department, status, created_at, updated_at
  ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`;

      const quantity = parseInt(expenseData.quantity) || 1;
      const unitCost = parseFloat(expenseData.unit_cost) || 0;
      const totalCost = quantity * unitCost;

      const params = [
        expenseId,
        expenseData.vendor_id,
        expenseData.description,
        quantity,
        unitCost,
        parseFloat(expenseData.tax_amount) || 0,
        parseFloat(expenseData.tax_rate) || 0,
        expenseData.tax_inclusive || false,
        expenseData.expense_date || new Date().toISOString().split('T')[0],
        expenseData.reference_number || null,
        expenseData.category || null,
        expenseData.department || null,
        expenseData.status || 'pending'
      ];

      const result = await db.query(sql, params);
      if ('error' in result) {
        console.error('Vendor expense insert failed:', result.error);
        toast({ title: 'Database Write Failed', description: 'Vendor expense could not be saved', variant: 'destructive' });
        return false;
      }

      // POST TO GL LEDGER — bridge vendor expenses into the reporting/P&L engine
      try {
        const accs = gl.getAccounts();
        // Find an expense account (USALI: departmental expense or fallback 5000-series)
        const dept = String(expenseData.department || '').toLowerCase();
        const expAccId = accs.find(a => a.category === 'Expense' && a.name.toLowerCase().includes(dept))?.id
          || accs.find(a => a.category === 'Expense')?.id
          || '5000';
        // AP (Accounts Payable) as credit side — liability
        const apAccId = accs.find(a => a.category === 'Liability' && a.name.toLowerCase().includes('payable'))?.id
          || accs.find(a => a.category === 'Liability')?.id
          || '2000';

        gl.appendLedger({
          id: `GL_${expenseId} `,
          date: expenseData.expense_date || new Date().toISOString().split('T')[0],
          reference: `Vendor Expense: ${expenseData.description || ''} `.slice(0, 100),
          lines: [
            { accountId: expAccId, description: expenseData.description || 'Vendor expense', debit: totalCost, credit: 0 },
            { accountId: apAccId, description: `AP - ${expenseData.vendor_id || 'Vendor'} `, debit: 0, credit: totalCost }
          ]
        });
      } catch (glErr) {
        console.warn('[DataContext] GL posting failed (non-blocking):', glErr);
      }

      // Notify report views to refresh
      try { window.dispatchEvent(new CustomEvent('vendor:data:updated')); } catch { /* noop */ }

      // Reload vendor expenses
      await loadVendorExpenses();
      return true;
    } catch (e: any) {
      console.error('Add vendor expense error:', e?.message || e);
      toast({ title: 'Database Write Failed', description: 'Vendor expense could not be saved', variant: 'destructive' });
      return false;
    }
  };

  // VENDORS - Update an expense
  const updateVendorExpense = async (expenseId: string, expenseData: any): Promise<boolean> => {
    try {
      const sql = `UPDATE vendor_expenses SET
vendor_id = ?, description = ?, quantity = ?, unit_cost = ?, tax_amount = ?, tax_rate = ?, tax_inclusive = ?,
  expense_date = ?, reference_number = ?, category = ?, department = ?, status = ?, updated_at = NOW()
        WHERE id = ? `;

      const params = [
        expenseData.vendor_id,
        expenseData.description,
        parseInt(expenseData.quantity) || 1,
        parseFloat(expenseData.unit_cost) || 0,
        parseFloat(expenseData.tax_amount) || 0,
        parseFloat(expenseData.tax_rate) || 0,
        expenseData.tax_inclusive || false,
        expenseData.expense_date || new Date().toISOString().split('T')[0],
        expenseData.reference_number || null,
        expenseData.category || null,
        expenseData.department || null,
        expenseData.status || 'pending',
        expenseId
      ];

      const result = await db.query(sql, params);
      if ('error' in result) {
        console.error('Vendor expense update failed:', result.error);
        toast({ title: 'Database Write Failed', description: 'Vendor expense could not be updated', variant: 'destructive' });
        return false;
      }

      // Notify report views to refresh
      try { window.dispatchEvent(new CustomEvent('vendor:data:updated')); } catch { /* noop */ }

      // Reload vendor expenses
      await loadVendorExpenses();
      return true;
    } catch (e: any) {
      console.error('Update vendor expense error:', e?.message || e);
      toast({ title: 'Database Write Failed', description: 'Vendor expense could not be updated', variant: 'destructive' });
      return false;
    }
  };

  // VENDORS - Delete an expense
  const deleteVendorExpense = async (expenseId: string): Promise<boolean> => {
    try {
      const sql = `DELETE FROM vendor_expenses WHERE id = ? `;
      const result = await db.query(sql, [expenseId]);
      if ('error' in result) {
        console.error('Vendor expense delete failed:', result.error);
        toast({ title: 'Database Write Failed', description: 'Vendor expense could not be deleted', variant: 'destructive' });
        return false;
      }

      // Notify report views to refresh
      try { window.dispatchEvent(new CustomEvent('vendor:data:updated')); } catch { /* noop */ }

      // Reload vendor expenses
      await loadVendorExpenses();
      return true;
    } catch (e: any) {
      console.error('Delete vendor expense error:', e?.message || e);
      toast({ title: 'Database Write Failed', description: 'Vendor expense could not be deleted', variant: 'destructive' });
      return false;
    }
  };

  // VENDORS - Void an expense (soft-void: keeps record for audit trail)
  const voidVendorExpense = async (expenseId: string, reason: string): Promise<boolean> => {
    try {
      // Safety check: fetch current status before voiding
      const checkRes = await db.query(
        `SELECT status, void_status FROM vendor_expenses WHERE id = ?`,
        [expenseId]
      );
      const row = ('rows' in checkRes && checkRes.rows?.length > 0) ? checkRes.rows[0] : null;
      if (!row) {
        toast({ title: 'Not Found', description: 'Expense record not found', variant: 'destructive' });
        return false;
      }
      if (row.void_status === 'VOIDED') {
        toast({ title: 'Already Voided', description: 'This expense has already been voided', variant: 'destructive' });
        return false;
      }
      if (!['pending', 'approved'].includes(row.status)) {
        toast({ title: 'Cannot Void', description: 'Only pending or approved expenses can be voided', variant: 'destructive' });
        return false;
      }

      const sql = `UPDATE vendor_expenses
        SET void_status = 'VOIDED', voided_at = NOW(), voided_reason = ?, status = 'voided', updated_at = NOW()
        WHERE id = ?`;
      const result = await db.query(sql, [reason || 'No reason provided', expenseId]);
      if ('error' in result) {
        console.error('Vendor expense void failed:', result.error);
        toast({ title: 'Database Write Failed', description: 'Vendor expense could not be voided', variant: 'destructive' });
        return false;
      }

      // Notify report views to refresh
      try { window.dispatchEvent(new CustomEvent('vendor:data:updated')); } catch { }

      await loadVendorExpenses();
      return true;
    } catch (e: any) {
      console.error('Void vendor expense error:', e?.message || e);
      toast({ title: 'Database Write Failed', description: 'Vendor expense could not be voided', variant: 'destructive' });
      return false;
    }
  };

  // VENDORS - Process a vendor payment
  const payVendor = async (paymentData: any): Promise<boolean> => {
    try {
      const paymentId = `VPAY${Date.now()}_${Math.random().toString(36).substring(2, 9)} `;

      const sql = `INSERT INTO vendor_payments(
        id, vendor_id, expense_ids, amount_paid, payment_date, payment_method, reference_number, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`;

      const params = [
        paymentId,
        paymentData.vendor_id,
        paymentData.expense_ids || null, // Comma-separated expense IDs
        parseFloat(paymentData.amount_paid) || 0,
        paymentData.payment_date || new Date().toISOString().split('T')[0],
        paymentData.payment_method || null,
        paymentData.reference_number || null,
        paymentData.notes || null
      ];

      const result = await db.query(sql, params);
      if ('error' in result) {
        console.error('Vendor payment insert failed:', (result as any).error);
        toast({ title: 'Database Write Failed', description: 'Vendor payment could not be saved', variant: 'destructive' });
        return false;
      }

      // Also update the expenses status to paid if payment covers them
      if (paymentData.expense_ids) {
        const expenseIds = paymentData.expense_ids.split(',').map((id: string) => id.trim());
        const placeholders = expenseIds.map(() => '?').join(',');
        await db.query(`UPDATE vendor_expenses SET status = 'paid' WHERE id IN (${placeholders})`, expenseIds);
      }

      // Reload vendor payments and expenses
      await loadVendorPayments();
      await loadVendorExpenses();

      return true;
    } catch (e: any) {
      console.error('Process vendor payment error:', e?.message || e);
      toast({ title: 'Database Write Failed', description: 'Vendor payment could not be processed', variant: 'destructive' });
      return false;
    }
  };

  // USER MANAGEMENT - Ensure user tables exist
  // Delegates to pmsAuthDb.init() which owns the canonical app_users schema.
  // Previously this created a redundant 'users' table using db.query() for DDL
  // (which never throws — it returns { ok: false, error } instead), causing the
  // error toast to fire even when the database was healthy.
  const ensureUserTables = async () => {
    try {
      const configured = await db.isConfigured();
      if (!configured) {
        console.log('[DataContext] DB not configured, skipping user table init');
        return;
      }
      // pmsAuthDb.init() uses db.exec() (not db.query()) so it correctly surfaces
      // DDL failures. It is idempotent — CREATE TABLE IF NOT EXISTS + ALTER TABLE
      // ADD COLUMN IF NOT EXISTS on every tables it owns.
      const { pmsAuthDb } = await import('@/lib/pmsAuthDb');
      await pmsAuthDb.init();
      console.log('[DataContext] User tables verified via pmsAuthDb.init()');
    } catch (e: any) {
      // Only log — don't show a blocking toast. The app is still usable
      // even if auth tables fail to init (e.g. read-only DB replica).
      console.error('[DataContext] ensureUserTables error (non-fatal):', e?.message || e);
    }
  };


  // USER MANAGEMENT - Add a new user
  const addUser = async (userData: any): Promise<boolean> => {
    try {
      const pmsAuthDb = (await import('@/lib/pmsAuthDb')).default;
      const res = await pmsAuthDb.registerUser({
        username: userData.username,
        email: userData.email,
        password: userData.password,
        name: userData.username, // Using username as name if not provided
        role: userData.role || 'user'
      });

      if (!res.ok) {
        console.error('User registration failed:', res.error);
        toast({ title: 'Registration Failed', description: res.error || 'User could not be created', variant: 'destructive' });
        return false;
      }

      await loadUsers();
      return true;
    } catch (e: any) {
      console.error('Add user error:', e?.message || e);
      toast({ title: 'Database Error', description: 'User could not be saved', variant: 'destructive' });
      return false;
    }
  };

  // Initialize vendor tables when context loads
  useEffect(() => {
    const initializeData = async () => {
      await ensureVendorTables();
      await ensurePosTables(); // Ensure POS tables
      await ensureUserTables(); // Initialize user tables as well

      // Sync business date from DB → localStorage so backend auto-audit rollover is reflected
      try {
        const bdRes = await db.query(`SELECT value FROM system_configs WHERE key = 'business_date'`);
        if (bdRes.ok && bdRes.rows.length && bdRes.rows[0].value?.date) {
          const dbDate = bdRes.rows[0].value.date as string;
          const localDate = localStorage.getItem('corepms_business_date');
          if (localDate !== dbDate) {
            localStorage.setItem('corepms_business_date', JSON.stringify(dbDate));
            console.log('[DataContext] Business date synced from DB:', dbDate);
          }
        }
      } catch {}

      // CRITICAL: Load all data from database and sync to localStorage
      // This includes products with category_id mapping for POS visibility
      await loadAllData();
      await loadUsers();
      await loadLogs();
    };

    initializeData();
  }, [loadAllData, loadUsers, loadLogs]);

  useEffect(() => {
    if (!user) return; // Don't load data if not logged in

    const startup = async () => {
      try {
        // 0. Load DB-backed branding so each property shows correct name/logo
        try {
          const brandRes = await db.query(
            `SELECT key, value FROM system_configs
             WHERE key IN ('hotel_name','hotel_address','hotel_phone','hotel_email',
                           'hotel_website','hotel_logo_url','hotel_logo_show',
                           'hotel_receipt_footer','hotel_tax_rate','hotel_paper_size')`
          );
          if ('rows' in brandRes && brandRes.rows && brandRes.rows.length > 0) {
            const map: Record<string, unknown> = {};
            for (const row of brandRes.rows) {
              try { map[row.key] = JSON.parse(row.value); } catch { map[row.key] = row.value; }
            }
            if (map['hotel_name']) {
              // Import lazily to avoid circular dependencies
              const { writeReceiptBranding, invalidateReceiptBrandingCache } = await import('../lib/printSettings');
              invalidateReceiptBrandingCache(); // clear stale env-var defaults
              writeReceiptBranding({
                restaurant_name: map['hotel_name'] as string,
                address: map['hotel_address'] as string | undefined,
                phone: map['hotel_phone'] as string | undefined,
                email: map['hotel_email'] as string | undefined,
                website: map['hotel_website'] as string | undefined,
                logo_url: map['hotel_logo_url'] as string | undefined,
                show_logo: map['hotel_logo_show'] as boolean | undefined,
                footer_text: map['hotel_receipt_footer'] as string | undefined,
                tax_rate: map['hotel_tax_rate'] as number | undefined,
                paper_size: map['hotel_paper_size'] as '58mm' | '80mm' | undefined,
              });
            }
          }
        } catch (brandErr) {
          console.warn('[DataContext] Branding load skipped:', brandErr);
        }

        // 1. Reconcile stale room statuses (OC with no active reservation → VD)
        try {
          await db.query(
            `UPDATE rooms r SET status = 'VD', updated_at = NOW()
             WHERE r.status IN ('OC','OD')
               AND NOT EXISTS (
                 SELECT 1 FROM reservations res
                 WHERE res.room_id = r.id AND res.status = 'checked-in'
               )`
          );
        } catch (reconcileErr) {
          console.warn('[DataContext] Room reconcile skipped:', reconcileErr);
        }

        // 2. Sync GL mappings from DB → localStorage so getMappings() returns DB values.
        // This fixes ISSUE 2: mappings set in browser A weren't visible server-side or in browser B.
        try {
          const { syncMappingsFromDB, saveMappingsToDB, GL_USALI_DEFAULTS } = await import('../lib/glAccounting');
          const dbMappings = await syncMappingsFromDB();
          // Auto-seed USALI defaults for any codes not yet mapped (non-destructive)
          const needsSeed = Object.keys(GL_USALI_DEFAULTS).some(k => !dbMappings[k]);
          if (needsSeed) {
            await fetch('/api/gl/mappings/seed', { method: 'POST' });
            await syncMappingsFromDB(); // re-sync after seeding
          }
        } catch (glErr) {
          console.warn('[DataContext] GL mapping sync skipped:', glErr);
        }

        // 3. First load fresh data from DB to clean up localStorage
        console.log('[DataContext] Starting startup sequence...');
        await loadAllData();
        await Promise.all([
          loadCityLedger(),
          loadVendors(),
          loadVendorExpenses(),
          loadVendorPayments(),
          loadLogs()
        ]);

        // 2. ONLY after local state is fresh from DB, perform sync of any new/offline items
        // This prevents re-inserting items that were deleted in the DB but still in local storage
        await ensureTablesExist();
        const result = await performFullSync();
        if (result.synced && result.synced > 0) {
          console.log(`[DataContext] Initial sync completed: ${result.synced} items synced to database`);
          // If sync pushed new items, reload one last time to be safe
          await loadAllData();
        }

        // 3. Start real-time sync service
        const syncService = initializeRealTimeSync();
        if (syncService) {
          syncService.start();
          setIsRealTimeSyncActive(true);
        }
      } catch (err) {
        console.error('[DataContext] Startup sequence failed:', err);
      }
    };

    startup();
  }, [user, loadAllData, loadVendors, loadVendorExpenses, loadVendorPayments, loadLogs, initializeRealTimeSync]); // loadCityLedger is useCallback and stable

  return (
    <DataContext.Provider value={{
      rooms, guests, reservations, posOrders, inventory, folioCharges, folios,
      vendors, vendorExpenses, vendorPayments,
      addRoom, updateRoom, deleteRoom, createReservation, updateReservation, savePosOrder, closePosOrder, updateGuest, updateStock,
      checkInGuest, checkOutGuest, updateRoomStatus, addFolioCharge,
      recordFolioCharge, recordFolioPayment, removeFolioCharge,
      voidFolioCharge, transferFolioCharge,
      bulkUpdateRoomStatus, bulkDeleteRooms, getRoomAudit, revertRoomChange,
      addCityLedgerAccount, updateCityLedgerAccount, addCityLedgerTransaction, addCityLedgerNote, deleteCityLedgerTransaction, voidCityLedgerTransaction, transferCityLedgerToGuest,
      addVendor, updateVendor, deleteVendor, addVendorExpense, updateVendorExpense, deleteVendorExpense, voidVendorExpense, payVendor, loadVendorPayments,
      addUser, // Add user management function
      users, loadUsers,
      logs, loadLogs,
      cityLedger, loading, refreshData: loadAllData,
      // Real-time sync methods
      startRealTimeSync,
      stopRealTimeSync,
      triggerManualSync,
      getSyncStats,
      isRealTimeSyncActive,
      realTimeSyncService,
      dataError,
      lastUpdateTs
    }}>
      {children}
    </DataContext.Provider>
  );
};

export const useData = () => useContext(DataContext);
