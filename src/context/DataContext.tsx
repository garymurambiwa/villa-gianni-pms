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

// Hardcoded prices for Baradzanwa instance only
const baradzanwaPrices: Record<string, { sellingPrice: number; costPrice?: number }> = {
  "1/4 Chicken": { sellingPrice: 4.00, costPrice: 1.52 },
  "1/4 Chicken & Chips": { sellingPrice: 6.00, costPrice: 2.30 },
  "Absolate Vodka": { sellingPrice: 3.00, costPrice: 1.19 },
  "Amarula": { sellingPrice: 2.00, costPrice: 0.89 },
  "Amstel Lager": { sellingPrice: 2.00, costPrice: 1.12 },
  "Barcardi Dark Rum": { sellingPrice: 2.00, costPrice: 0.80 },
  "Barcardi Gold Rum": { sellingPrice: 2.00, costPrice: 0.80 },
  "Beef Burger": { sellingPrice: 8.00, costPrice: 2.50 },
  "Belgravia Dry lemon": { sellingPrice: 2.50, costPrice: 1.15 },
  "Belgravia Dry Lemon": { sellingPrice: 2.50, costPrice: 0.89 },
  "Black Label Bottle": { sellingPrice: 2.00, costPrice: 1.00 },
  "Bon Courage Cabernet Savignon": { sellingPrice: 25.00, costPrice: 8.95 },
  "Braai ( Pork Chop & Tbone)": { sellingPrice: 5.00, costPrice: 2.41 },
  "Braai (Chicken & Pork Chops)": { sellingPrice: 5.00, costPrice: 2.41 },
  "Braai (Tbone and Sausage)": { sellingPrice: 5.00, costPrice: 2.41 },
  "Bream Cutlets": { sellingPrice: 6.00, costPrice: 2.53 },
  "Brutal Fruit Can": { sellingPrice: 2.50, costPrice: 0.97 },
  "Captain Morgan Spiced Rum": { sellingPrice: 2.00, costPrice: 0.80 },
  "Castle Lager": { sellingPrice: 2.00, costPrice: 1.00 },
  "Castle Lite Can": { sellingPrice: 2.00, costPrice: 0.65 },
  "Castle Pint": { sellingPrice: 2.00, costPrice: 0.56 },
  "Coke": { sellingPrice: 1.00, costPrice: 0.43 },
  "Coke Can": { sellingPrice: 1.00, costPrice: 0.46 },
  "Coke Zero": { sellingPrice: 1.00, costPrice: 0.46 },
  "Corona Extra": { sellingPrice: 3.00, costPrice: 1.12 },
  "Creamsoda Can": { sellingPrice: 1.00, costPrice: 0.43 },
  "Diemersfontein Shiraz": { sellingPrice: 30.00, costPrice: 9.47 },
  "Fanta": { sellingPrice: 1.00, costPrice: 0.43 },
  "Fanta can": { sellingPrice: 1.00, costPrice: 0.43 },
  "Fanta Grape Can": { sellingPrice: 1.00, costPrice: 0.46 },
  "Flyfish": { sellingPrice: 2.00, costPrice: 1.30 },
  "Four Cousins Natuarl Sweet Rose": { sellingPrice: 20.00, costPrice: 5.60 },
  "Four Cousins Rose": { sellingPrice: 20.00, costPrice: 5.60 },
  "Four Cousins Sweet Red": { sellingPrice: 20.00, costPrice: 5.60 },
  "Gango": { sellingPrice: 6.00, costPrice: 2.10 },
  "Ginger Ale": { sellingPrice: 1.00, costPrice: 0.49 },
  "Glen Carlou Pinot Noir": { sellingPrice: 40.00, costPrice: 14.24 },
  "Glenfidich 12 yrs": { sellingPrice: 5.00, costPrice: 1.90 },
  "Goat Meat": { sellingPrice: 6.00, costPrice: 2.38 },
  "Golden Pilsner": { sellingPrice: 2.00, costPrice: 0.65 },
  "Gordons Gin": { sellingPrice: 2.00, costPrice: 0.33 },
  "Grants Whiskey": { sellingPrice: 2.00, costPrice: 0.52 },
  "Hake Fillet": { sellingPrice: 10.00, costPrice: 3.00 },
  "Hansa Pilsner": { sellingPrice: 2.00, costPrice: 1.30 },
  "Heinken Origional": { sellingPrice: 3.00, costPrice: 1.15 },
  "Heinken Silver": { sellingPrice: 3.00, costPrice: 1.35 },
  "Hunters Dry": { sellingPrice: 2.00, costPrice: 0.90 },
  "Hunters Gold": { sellingPrice: 2.00, costPrice: 0.90 },
  "Inkara Merlot": { sellingPrice: 40.00, costPrice: 16.06 },
  "Jagermeister": { sellingPrice: 2.00, costPrice: 0.95 },
  "Jameson Irish Whiskey": { sellingPrice: 3.00, costPrice: 0.87 },
  "JC Le Roux Le Domain": { sellingPrice: 25.00, costPrice: 5.42 },
  "John Walker Black": { sellingPrice: 3.00, costPrice: 1.32 },
  "John Walker Red": { sellingPrice: 2.00, costPrice: 0.64 },
  "Juices": { sellingPrice: 5.00, costPrice: 1.96 },
  "Klipdrft": { sellingPrice: 2.00, costPrice: 0.36 },
  "Lemonade": { sellingPrice: 1.00, costPrice: 0.49 },
  "Maguru NeMatumbu": { sellingPrice: 6.00, costPrice: 2.30 },
  "Mapfunde (Sadza)": { sellingPrice: 3.00, costPrice: 0.30 },
  "Mapfura Wine": { sellingPrice: 10.00, costPrice: 5.00 },
  "Mazondo": { sellingPrice: 6.00, costPrice: 2.30 },
  "Mhunga (Sadza)": { sellingPrice: 3.00, costPrice: 0.30 },
  "Mineral Water  Bonaqua": { sellingPrice: 1.00, costPrice: 0.17 },
  "Mineral Water Aquaclear": { sellingPrice: 1.00, costPrice: 0.13 },
  "Minute Maid": { sellingPrice: 2.00, costPrice: 0.73 },
  "Moet & Chandon Brut": { sellingPrice: 200.00, costPrice: 62.34 },
  "Mupunga Une Dovi": { sellingPrice: 3.00, costPrice: 0.50 },
  "Musoro Wemombe": { sellingPrice: 5.00, costPrice: 1.96 },
  "Nederburg Cabernet Sauvignon": { sellingPrice: 25.00, costPrice: 5.46 },
  "Nederburg Chadonnay": { sellingPrice: 20.00, costPrice: 5.92 },
  "Nederburg Rose": { sellingPrice: 20.00, costPrice: 3.40 },
  "Oxtail": { sellingPrice: 6.00, costPrice: 2.78 },
  "Pinut Can": { sellingPrice: 1.00, costPrice: 0.46 },
  "Plain Chips": { sellingPrice: 3.00, costPrice: 0.30 },
  "Plain Rice": { sellingPrice: 1.00, costPrice: 0.20 },
  "Pork Head": { sellingPrice: 5.00, costPrice: 1.20 },
  "Potato Crispies Small": { sellingPrice: 1.00, costPrice: 0.43 },
  "Roadrunner": { sellingPrice: 7.00, costPrice: 2.20 },
  "Roasted Nuts - Tub 50g": { sellingPrice: 1.00, costPrice: 0.15 },
  "Robertson Sweet Red": { sellingPrice: 20.00, costPrice: 5.50 },
  "Sadza Plain White": { sellingPrice: 1.00, costPrice: 0.20 },
  "Savanna Angry Lemon": { sellingPrice: 2.50, costPrice: 1.50 },
  "Savanna Dry": { sellingPrice: 2.50, costPrice: 0.94 },
  "Simonsig Pinotage": { sellingPrice: 30.00, costPrice: 10.28 },
  "Sminorff Vodka": { sellingPrice: 2.00, costPrice: 0.26 },
  "Soda Water": { sellingPrice: 1.00, costPrice: 0.57 },
  "Southern Comfort Original": { sellingPrice: 2.00, costPrice: 0.58 },
  "Sprite": { sellingPrice: 1.00, costPrice: 0.30 },
  "Sprite Can": { sellingPrice: 1.00, costPrice: 0.46 },
  "Stoney Ginger Beer": { sellingPrice: 1.00, costPrice: 0.46 },
  "Strawbery Lips": { sellingPrice: 2.00, costPrice: 0.58 },
  "Tanqueray Gin": { sellingPrice: 3.00, costPrice: 0.73 },
  "The Game Reserve Melort": { sellingPrice: 50.00, costPrice: 7.13 },
  "Tonic Water": { sellingPrice: 1.00, costPrice: 0.49 },
  "Trotters": { sellingPrice: 6.00, costPrice: 2.21 },
  "Tsuro": { sellingPrice: 6.00, costPrice: 2.10 },
  "Veuve Clicquot": { sellingPrice: 200.00, costPrice: 69.00 },
  "Viceroy": { sellingPrice: 2.00, costPrice: 0.30 },
  "Wellington Brandy": { sellingPrice: 1.00, costPrice: 0.30 },
  "Whitestone Gin": { sellingPrice: 2.00, costPrice: 1.24 },
  "Whole Bream": { sellingPrice: 8.00, costPrice: 2.53 },
  "Windhoek Draught": { sellingPrice: 3.00, costPrice: 1.56 },
  "Windhoek Lager": { sellingPrice: 3.00, costPrice: 1.34 },
  "Zambezi Can": { sellingPrice: 2.00, costPrice: 0.65 },
  "Zinyenze": { sellingPrice: 6.00, costPrice: 2.25 },
  "Zviyo (Sadza)": { sellingPrice: 3.00, costPrice: 0.30 }
};

const DataContext = createContext<any>(null);

export const DataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [rooms, setRooms] = useState([]);
  const [guests, setGuests] = useState([]);
  const [reservations, setReservations] = useState([]);
  const [posOrders, setPosOrders] = useState([]);
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

  // Initialize WebSocket connection for real-time price sync
  const initializePriceSync = React.useCallback(() => {
    try {
      const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/api/v1/prices/sync`;
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('[PriceSync] Connected to real-time price sync');
        setPriceSyncWs(ws);
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);

          if (message.type === 'PRICE_UPDATE') {
            const update = message.data;
            console.log('[PriceSync] Received price update:', update);

            // Update inventory in state
            setInventory(prev => prev.map(item =>
              item.id === update.itemId
                ? {
                    ...item,
                    selling_price: update.newPrice,
                    sellingPrice: update.newPrice,
                    costPrice: update.newCostPrice,
                    price: update.newPrice,
                    cost_price: update.newCostPrice
                  }
                : item
            ));

            // Update localStorage cache
            const cached = localStorage.getItem('corepms_pos_items');
            if (cached) {
              try {
                const items = JSON.parse(cached);
                const updatedItems = items.map((item: any) =>
                  item.id === update.itemId
                    ? {
                        ...item,
                        selling_price: update.newPrice,
                        sellingPrice: update.newPrice,
                        costPrice: update.newCostPrice,
                        price: update.newPrice,
                        cost_price: update.newCostPrice
                      }
                    : item
                );
                localStorage.setItem('corepms_pos_items', JSON.stringify(updatedItems));
                window.dispatchEvent(new Event('storage'));
              } catch (e) {
                console.warn('[PriceSync] Failed to update localStorage cache:', e);
              }
            }

            // Show notification
            toast({
              title: "Price Updated",
              description: `${update.itemName} price changed to €${update.newPrice.toFixed(2)}`,
            });

          } else if (message.type === 'CACHE_INVALIDATE') {
            console.log('[PriceSync] Cache invalidation requested, reloading data');
            // Reload all data to ensure consistency
            loadAllData();
          }
        } catch (error) {
          console.error('[PriceSync] Failed to process message:', error);
        }
      };

      ws.onclose = () => {
        console.log('[PriceSync] Disconnected from real-time price sync');
        setPriceSyncWs(null);
        // Attempt to reconnect after 5 seconds
        setTimeout(() => initializePriceSync(), 5000);
      };

      ws.onerror = (error) => {
        console.error('[PriceSync] WebSocket error:', error);
      };

    } catch (error) {
      console.error('[PriceSync] Failed to initialize:', error);
    }
  }, []);

  // Cleanup WebSocket on unmount
  useEffect(() => {
    return () => {
      if (priceSyncWs) {
        priceSyncWs.close();
      }
    };
  }, [priceSyncWs]);

  const loadAllData = React.useCallback(async () => {
    setLoading(true);
    try {
      // Load PMS Data
      // Load rooms, filtering out soft-deleted ones.
      // Fallback to unfiltered query if is_active column doesn't exist yet on older DBs.
      let roomRes: any;
      try {
        roomRes = await db.query('SELECT * FROM rooms WHERE is_active IS DISTINCT FROM false ORDER BY number');
        // Also ensure the column exists for future queries (safe ALTER IF NOT EXISTS)
        db.query('ALTER TABLE rooms ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true').catch(() => { });
        db.query('ALTER TABLE rooms ADD COLUMN IF NOT EXISTS floor INTEGER NOT NULL DEFAULT 1').catch(() => { });
      } catch (_colErr) {
        // Column doesn't exist yet — fall back to all rooms and add the column
        roomRes = await db.query('SELECT * FROM rooms ORDER BY number');
        db.query('ALTER TABLE rooms ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true').catch(() => { });
        db.query('ALTER TABLE rooms ADD COLUMN IF NOT EXISTS floor INTEGER NOT NULL DEFAULT 1').catch(() => { });
      }
      if ('rows' in roomRes) {
        const normalized = (roomRes.rows || []).map((r: any) => {
          const s = String(r.status || '').toLowerCase();
          const status = (s === 'vacant' || s === 'available') ? 'VC'
            : (s === 'occupied') ? 'OCC'
              : String(r.status || 'VC').toUpperCase();
          return {
            ...r,
            number: String(r.number || ''),
            type: String(r.type || ''),
            status
          };
        });
        setRooms(normalized);

        // Prime the roomService cache
        await refreshRooms();
        await refreshRateConfig();
      }


      // Load reservations with guest info and room info joined
      const resRes = await db.query(`
        SELECT r.*, g.full_name as guest_name, g.email as guest_email, g.phone as guest_phone,
  rm.number as room_number
        FROM reservations r
        LEFT JOIN guests g ON r.guest_id = g.id
        LEFT JOIN rooms rm ON r.room_id = rm.id
  `);
      let normalizedReservations: any[] = [];
      if ('rows' in resRes) {
        // Normalize reservation data for UI compatibility
        normalizedReservations = (resRes.rows || []).map((r: any) => {
          // Normalize check-in date from database
          let checkIn = '';
          const rawCheckIn = r.check_in_date || r.checkIn;
          if (rawCheckIn) {
            // PostgreSQL DATE type returns 'YYYY-MM-DD' format
            // Handle both string and Date object formats
            if (typeof rawCheckIn === 'string') {
              // If it's an ISO string with time, extract just the date part
              // Hande both 'T' separated (ISO) and space separated (MySQL/PG)
              if (rawCheckIn.includes('T')) {
                checkIn = rawCheckIn.split('T')[0];
              } else if (rawCheckIn.includes(' ')) {
                checkIn = rawCheckIn.split(' ')[0];
              } else {
                checkIn = rawCheckIn;
              }
            } else if (rawCheckIn instanceof Date) {
              // Format Date object to YYYY-MM-DD
              const year = rawCheckIn.getFullYear();
              const month = String(rawCheckIn.getMonth() + 1).padStart(2, '0');
              const day = String(rawCheckIn.getDate()).padStart(2, '0');
              checkIn = `${year}-${month}-${day}`;
            } else {
              checkIn = String(rawCheckIn);
            }
          }

          // Normalize check-out date from database
          let checkOut = '';
          const rawCheckOut = r.check_out_date || r.checkOut;
          if (rawCheckOut) {
            if (typeof rawCheckOut === 'string') {
              if (rawCheckOut.includes('T')) {
                checkOut = rawCheckOut.split('T')[0];
              } else if (rawCheckOut.includes(' ')) {
                checkOut = rawCheckOut.split(' ')[0];
              } else {
                checkOut = rawCheckOut;
              }
            } else if (rawCheckOut instanceof Date) {
              const year = rawCheckOut.getFullYear();
              const month = String(rawCheckOut.getMonth() + 1).padStart(2, '0');
              const day = String(rawCheckOut.getDate()).padStart(2, '0');
              checkOut = `${year}-${month}-${day}`;
            } else {
              checkOut = String(rawCheckOut);
            }
          }

          return {
            ...r,
            // Map database fields to UI expected fields
            guestName: r.guest_name || r.guestName || 'Unknown Guest',
            checkIn,
            checkOut,
            // Also keep the raw fields for compatibility
            check_in_date: checkIn,
            check_out_date: checkOut,
            roomType: r.room_type || r.roomType || 'Standard',
            roomNumber: r.room_number || null,
            rate: Number(r.rate || 0),
            adults: Number(r.adults || 1),
            children: Number(r.children || 0),
            status: r.status || 'confirmed',
            idDocumentType: r.id_document_type || 'Passport',
            nationalityCode: r.nationality_code || '',
            nationalityName: r.nationality_name || '',
            bookingSource: r.booking_source || '',
            // Map source to originRegion for Dashboard revenue reporting
            originRegion: r.source || r.booking_source || '',
            partnerCode: r.partner_code || '',
            utmSource: r.utm_source || '',
            utmMedium: r.utm_medium || '',
            utmCampaign: r.utm_campaign || '',
            utmTerm: r.utm_term || '',
            utmContent: r.utm_content || '',
            paymentInfoSource: r.payment_info_source || '',
            paymentVerified: !!r.payment_verified,
            termsAccepted: !!r.terms_accepted,
            packageCode: r.package_code || 'RO'
          };
        });

        console.log('[DataContext] Loaded', normalizedReservations.length, 'reservations');
        if (normalizedReservations.length > 0) {
          console.log('[DataContext] Sample reservation:', {
            id: normalizedReservations[0].id,
            status: normalizedReservations[0].status,
            checkIn: normalizedReservations[0].checkIn,
            guestName: normalizedReservations[0].guestName
          });
        }

        setReservations(normalizedReservations);
      }

      // Load folio charges from database instead of just localStorage
      let loadedFolioCharges: any[] = [];
      try {
        const result = await loadFolioChargesFromDb();
        if (result.success && result.charges) {
          loadedFolioCharges = result.charges;
          // Synchronize down to local storage for offline cases
          localStorage.setItem('corepms_folioCharges', JSON.stringify(result.charges));
        } else {
          // Fallback to local storage
          const rawCharges = localStorage.getItem('corepms_folioCharges');
          loadedFolioCharges = rawCharges ? JSON.parse(rawCharges) : [];
        }
      } catch {
        const rawCharges = localStorage.getItem('corepms_folioCharges');
        loadedFolioCharges = rawCharges ? JSON.parse(rawCharges) : [];
      }
      setFolioCharges(loadedFolioCharges);

      const guestRes = await db.query('SELECT * FROM guests');
      if ('rows' in guestRes) {
        // Normalize guest data - map full_name to name for UI compatibility
        // Also enrich with room info and dates from reservations
        const normalizedGuests = (guestRes.rows || []).map((g: any) => {
          // Find the most relevant reservation for this guest
          // Priority 1: Currently checked-in
          const checkedInRes = normalizedReservations.find(
            (r: any) => r.guest_id === g.id && String(r.status || '').toLowerCase() === 'checked-in'
          );

          // Priority 2: Latest reservation (any status) to ensure we always have dates from the "booking form"
          const allGuestRes = normalizedReservations
            .filter((r: any) => r.guest_id === g.id)
            .sort((a: any, b: any) => new Date(b.check_in_date || b.checkIn).getTime() - new Date(a.check_in_date || a.checkIn).getTime());
          
          const latestRes = checkedInRes || allGuestRes[0] || null;

          // Calculate folio balance from actual folio charges
          // Balance = sum of charges - sum of payments (excluding voided)
          const guestCharges = loadedFolioCharges.filter((c: any) => c.guestId === g.id && !c.is_voided);
          const totalCharges = guestCharges
            .filter((c: any) => c.type === 'charge' || !c.type) // Default to charge if type not specified
            .reduce((sum: number, c: any) => sum + Number(c.amount || 0), 0);
          const totalPayments = guestCharges
            .filter((c: any) => c.type === 'payment')
            .reduce((sum: number, c: any) => sum + Math.abs(Number(c.amount || 0)), 0);
          
          // Compute true accounting balance
          const computedBalance = Number((totalCharges - totalPayments).toFixed(2));

          return {
            ...g,
            name: g.full_name || g.name || '',
            full_name: g.full_name || g.name || '',
            // Add room info from checked-in reservation
            roomNumber: checkedInRes?.roomNumber || null,
            reservationId: latestRes?.id || null,
            // Use compute balance if any transactions exist, otherwise use rate as starting point for new check-ins
            folioBalance: (guestCharges.length > 0) ? computedBalance : (latestRes?.rate || 0),
            // Standardize field names for statement compatibility
            checkIn: latestRes?.checkIn || null,
            checkOut: latestRes?.checkOut || null,
            checkInDate: latestRes?.checkIn || null,
            checkOutDate: latestRes?.checkOut || null,
            dailyRate: latestRes?.rate || 0
          };
        });
        setGuests(normalizedGuests);
      }

      // Load POS Categories
      try {
        const { categories, subcategories } = await loadCategoriesFromDb();
        if (categories.length > 0) {
          menuCats.setCategories(categories as any);
        }
        if (subcategories.length > 0) {
          menuCats.setSubcategories(subcategories as any);
        }
      } catch (err) {
        console.warn('[DataContext] Failed to load POS categories from DB', err);
      }

      // Load POS & Inventory Data
      const posRes = await db.query('SELECT * FROM pos_orders WHERE LOWER(status::text) = LOWER(?::text)', ['open']);
      if ('rows' in posRes) {
        const normalized = (posRes.rows || []).map((o: any) => {
          let itemsArr: any[] = [];
          try {
            itemsArr = Array.isArray(o.items) ? o.items : JSON.parse(o.items || '[]');
          } catch { itemsArr = []; }
          const s = String(o.status || '').toLowerCase();
          const status = s === 'open' ? 'OPEN' : s === 'closed' ? 'CLOSED' : String(o.status || '').toUpperCase();
          return { ...o, items: itemsArr, status };
        });
        setPosOrders(normalized);
      }

      const productsRes = await db.query('SELECT * FROM products ORDER BY name ASC');
      let mergedInventory: any[] = [];


      if ('rows' in productsRes && Array.isArray(productsRes.rows)) {
        mergedInventory = productsRes.rows.map((p: any) => {
          // Parse visibility if stored as string JSON
          let vis = p.visibility;
          if (typeof vis === 'string') {
            try { vis = JSON.parse(vis); } catch { vis = {}; }
          }

          // Derive category_id from department/category for POS filtering
          // The Order Modal filters by category_id, so we must assign default categories
          const rawCat = String(p.department || p.category || '').toLowerCase();
          const costCenter = String(p.department || p.category || '').toLowerCase();
          const isBar = costCenter.includes('bar') ||
            rawCat.includes('bar') ||
            rawCat.includes('beverage') ||
            rawCat.includes('cocktail') ||
            rawCat.includes('beer') ||
            rawCat.includes('wine') ||
            rawCat.includes('cider') ||
            rawCat.includes('liquor') ||
            rawCat.includes('spirit') ||
            rawCat.includes('drink') ||
            rawCat.includes('alcohol');

          // CRITICAL: Preserve explicitly assigned category_id from database
          // Only derive default category if category_id is null/undefined/empty
          let derivedCategoryId = p.category_id;

          // Only derive category if none explicitly set - preserve user assignments
          if (!derivedCategoryId || derivedCategoryId === '' || derivedCategoryId === null) {
            if (isBar) {
              if (rawCat.includes('beverage') || rawCat.includes('cocktail') || rawCat.includes('drink') || rawCat.includes('water') || rawCat.includes('juice')) {
                derivedCategoryId = 'CAT_BAR_BEV';
              } else {
                derivedCategoryId = 'CAT_BAR_GEN';
              }
            } else {
              if (rawCat.includes('main') || rawCat.includes('entree') || rawCat.includes('mains')) {
                derivedCategoryId = 'CAT_REST_MAIN';
              } else if (rawCat.includes('dessert') || rawCat.includes('sweet') || rawCat.includes('pudding')) {
                derivedCategoryId = 'CAT_REST_DESSERT';
              } else {
                // Default to General, not Mains — items without a category
                // should not be assumed to be main courses
                derivedCategoryId = 'CAT_REST_GEN';
              }
            }
          }

            // Check if this is Baradzanwa instance and override prices if needed
            const isBaradzanwa = typeof window !== 'undefined' ? window.location.hostname.includes('baradzanwa') : false;
            let sellingPriceValue = Number(p.price || 0);
            let costPriceValue = undefined;

            if (isBaradzanwa && baradzanwaPrices[p.name]) {
              sellingPriceValue = baradzanwaPrices[p.name].sellingPrice;
              costPriceValue = baradzanwaPrices[p.name].costPrice;
            }
           
            return {
              ...p,
              // Map unified fields to legacy frontend expected fields
              // Use only selling price
              selling_price: sellingPriceValue,
              sellingPrice: sellingPriceValue,
              qtyInStock: Number(p.stock_level || 0),
              // 'type' is used for filtering (bar/restaurant/etc)
              type: p.department || p.category || 'restaurant',
              costCenter: isBar ? 'bar' : 'restaurant', // Normalized cost center
              // CRITICAL: category must match OrderModal's activeCategory type: 'food' | 'bar'
              // OrderModal sets activeCategory='food' for Restaurant tab, 'bar' for Bar tab
              // Then filters: m.category === activeCategory
             category: isBar ? 'bar' : 'food',
             subCategory: p.category || p.department || '', // For Order Modal filtering
             active: p.active !== false,
             visibility: vis,
             isStockItem: p.is_stock_item,
             // Map new extended fields (snake_case from DB -> camelCase for frontend)
             category_id: derivedCategoryId,
             sub_id: p.sub_id,
             parent_sub_id: p.parent_sub_id,
             notes: p.notes,
             barcodes: p.barcodes ? (typeof p.barcodes === 'string' ? JSON.parse(p.barcodes) : p.barcodes) : [],
             cosPercent: Number(p.cos_percent || 0),
             gpPercent: Number(p.gp_percent || 0),
             gpAmount: Number(p.gp_amount || 0),
             qtyReceived: Number(p.qty_received || 0),
             imageBgColor: p.image_bg_color,
             pictureData: p.picture_data
           };
        });

        console.log(`[DataContext] Loaded ${mergedInventory.length} products`);
        setInventory(mergedInventory);
      } else {
        setInventory([]);
      }

      // Sync inventory to localStorage for POS offline usage
      if (mergedInventory.length > 0) {
        try {
          localStorage.setItem('corepms_pos_items', JSON.stringify(mergedInventory));
          window.dispatchEvent(new Event('storage')); // Notify listeners
        } catch (e) {
          console.warn('Failed to sync inventory to localStorage', e);
        }
      }

      // Load Folios metadata (payment methods etc)
      try {
        const folioRes = await db.query('SELECT * FROM folios');
        if ('rows' in folioRes) {
          setFolios(folioRes.rows || []);
        }
      } catch (err) {
        console.warn('[DataContext] Failed to load folios metadata from DB', err);
      }

      setLastUpdateTs(Date.now());
      setDataError(null);

      // Initialize real-time price sync for POS
      initializePriceSync();

    } catch (error: any) {
      console.error("Failed to load data from MySQL:", error);
      setDataError(error.message || "Failed to load database content");
    } finally {
      setLoading(false);
    }
  }, []);

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
          const guestSql = "INSERT INTO guests (id, full_name, email, phone) VALUES (?, ?, ?, ?)";
          const guestParams = [newGuestId, guestName, guestEmail, guestPhone];
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
      const idDocumentEnc = resData.idDocumentNumber
        ? String(resData.idDocumentNumber)
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
        status: 'OPEN',
        cost_center: orderData.cost_center,
        shift_id: orderData.shift_id
      };
      
      setPosOrders((prev: any[]) => {
        const idx = prev.findIndex((p: any) => 
          String(p.table_number) === provisional.table_number && 
          String(p.status) === 'OPEN' &&
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
      
      // Try to update existing order for this table AND cost center
      const updateSql = "UPDATE pos_orders SET items = ?::jsonb, total_amount = ?, status = ?, shift_id = ? WHERE table_number = ? AND status = 'open' AND cost_center = ? RETURNING id";
      const updateParams = [
        JSON.stringify(provisional.items), 
        provisional.total_amount, 
        'open', 
        provisional.shift_id,
        provisional.table_number,
        provisional.cost_center
      ];
      const updateResult = await db.query(updateSql, updateParams);

      // If no rows updated, insert new order
      if (!('error' in updateResult) && 'rows' in updateResult && (updateResult as any).rows.length === 0) {
        const insertSql = "INSERT INTO pos_orders (id, table_number, items, total_amount, status, cost_center, shift_id) VALUES (?, ?, ?::jsonb, ?, 'open', ?, ?)";
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
            !(String(p.table_number) === provisional.table_number && String(p.status) === 'OPEN' && p.cost_center === provisional.cost_center)
          ));
          toast({ title: 'Database Write Failed', description: `POS order insert failed: ${dbError}`, variant: 'destructive' });
          return false;
        }
      } else if ('error' in updateResult) {
        console.error('POS order update details:', { params: updateParams, error: (updateResult as any).error });
        const dbError = (updateResult as any).error?.message || (updateResult as any).error || 'Unknown DB Error';
        setPosOrders((prev: any[]) => prev.filter((p: any) => 
          !(String(p.table_number) === provisional.table_number && String(p.status) === 'OPEN' && p.cost_center === provisional.cost_center)
        ));
        toast({ title: 'Database Write Failed', description: `POS order update failed: ${dbError}`, variant: 'destructive' });
        return false;
      }

      return true;
    } catch (e: any) {
      console.error('Save POS order error:', e?.message || e);
      toast({ title: 'Database Write Failed', description: 'POS order could not be saved', variant: 'destructive' });
      return false;
    }
  };

  const closePosOrder = async (tableNumber: string, costCentre?: string): Promise<boolean> => {
    try {
      // 1. Close the order in pos_orders
      const query = costCentre 
        ? "UPDATE pos_orders SET status = 'closed' WHERE table_number = ? AND status = 'open' AND cost_center = ?"
        : "UPDATE pos_orders SET status = 'closed' WHERE table_number = ? AND status = 'open'";
      const params = costCentre ? [tableNumber, costCentre] : [tableNumber];
      const result = await db.query(query, params);

      // 2. Update table_status to 'open' (available)
      const tableSql = costCentre
        ? "INSERT INTO table_status (table_id, status, cost_center, last_update) VALUES (?, 'open', ?, NOW()) ON CONFLICT (table_id, cost_center) DO UPDATE SET status = 'open', last_update = NOW()"
        : "INSERT INTO table_status (table_id, status, last_update) VALUES (?, 'open', NOW()) ON CONFLICT (table_id) DO UPDATE SET status = 'open', last_update = NOW()";
      const tableParams = costCentre ? [tableNumber, costCentre] : [tableNumber];
      await db.query(tableSql, tableParams);

      if ('error' in result) {
        console.error('Close POS order failed:', (result as any).error);
        return false;
      }

      // Update local state
      setPosOrders((prev: any[]) => prev.filter((p: any) => 
        !(String(p.table_number) === tableNumber && String(p.status) === 'OPEN' && (!costCentre || p.cost_center === costCentre))
      ));

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
      // Update reservation status to checked-in and assign room
      const resSql = `UPDATE reservations SET
status = 'checked-in',
  room_id = ?,
  rate = COALESCE(?, rate),
  package_code = COALESCE(?, package_code)
      WHERE id = ? `;
      const resParams = [
        roomId,
        options.rateOverride || null,
        options.packageCode || null,
        reservationId
      ];
      const resResult = await db.query(resSql, resParams);
      if ('error' in resResult) {
        console.error('Check-in reservation update failed:', (resResult as any).error);
        toast({ title: 'Check-in Failed', description: 'Could not update reservation', variant: 'destructive' });
        return false;
      }

      // Update room status to occupied
      const roomSql = "UPDATE rooms SET status = 'OCC' WHERE id = ?";
      const roomResult = await db.query(roomSql, [roomId]);
      if ('error' in roomResult) {
        console.error('Room status update failed:', (roomResult as any).error);
      }

      await loadAllData();
      return true;
    } catch (e: any) {
      console.error('Check-in error:', e?.message || e);
      toast({ title: 'Check-in Failed', description: 'An error occurred during check-in', variant: 'destructive' });
      return false;
    }
  };

  // FRONT OFFICE - Check-out guest
  const checkOutGuest = async (reservationId: string): Promise<boolean> => {
    try {
      // Get the reservation to find the room
      const getResSql = "SELECT room_id FROM reservations WHERE id = ?";
      const getResResult = await db.query(getResSql, [reservationId]);
      let roomId: string | null = null;
      if ('rows' in getResResult && getResResult.rows.length > 0) {
        roomId = getResResult.rows[0].room_id;
      }

      // Update reservation status to checked-out
      const resSql = "UPDATE reservations SET status = 'checked-out' WHERE id = ?";
      const resResult = await db.query(resSql, [reservationId]);
      if ('error' in resResult) {
        console.error('Check-out reservation update failed:', (resResult as any).error);
        toast({ title: 'Check-out Failed', description: 'Could not update reservation', variant: 'destructive' });
        return false;
      }

      // Update room status to vacant
      if (roomId) {
        const roomSql = "UPDATE rooms SET status = 'VD' WHERE id = ?";
        await db.query(roomSql, [roomId]);
      }

      await loadAllData();
      return true;
    } catch (e: any) {
      console.error('Check-out error:', e?.message || e);
      toast({ title: 'Check-out Failed', description: 'An error occurred during check-out', variant: 'destructive' });
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
      if (txn.debit) {
        return balance + Number(txn.debit);
      } else if (txn.credit) {
        return balance - Number(txn.credit);
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

      // Create the foreign key constraint if it doesn't exist
      try {
        await db.query(`ALTER TABLE city_ledger_transactions ADD CONSTRAINT IF NOT EXISTS fk_transaction_account 
                       FOREIGN KEY(account_id) REFERENCES city_ledger_accounts(id); `);
      } catch (e) {
        // Constraint may already exist, which is fine
      }

      // Create city_ledger_notes table if it doesn't exist
      try {
        await db.query(`CREATE TABLE IF NOT EXISTS city_ledger_notes(
        id TEXT PRIMARY KEY,
        account_id TEXT,
        date_field DATE NOT NULL, --Changed from 'date' to 'date_field' to avoid conflict with reserved keyword
          author TEXT,
  text TEXT NOT NULL,
    note_type TEXT DEFAULT 'general', --Added note_type column with default
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

      // Create the foreign key constraint if it doesn't exist
      try {
        await db.query(`ALTER TABLE city_ledger_notes ADD CONSTRAINT IF NOT EXISTS fk_note_account 
                       FOREIGN KEY(account_id) REFERENCES city_ledger_accounts(id); `);
      } catch (e) {
        // Constraint may already exist, which is fine
      }

      // Load all city ledger accounts
      const accountsRes = await db.query('SELECT * FROM city_ledger_accounts ORDER BY account_name');
      if ('rows' in accountsRes) {
        const accounts = (accountsRes.rows || []).map((acc: any) => ({
          ...acc,
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
  const ensureUserTables = async () => {
    try {
      // Create users table
      await db.query(`CREATE TABLE IF NOT EXISTS users(
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    email TEXT UNIQUE,
    role TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

      // Add email column if it doesn't exist
      try {
        await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT; `);
      } catch (e) {
        // Column may already exist, which is fine
      }

      // Add updated_at column if it doesn't exist
      try {
        await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP; `);
      } catch (e) {
        // Column may already exist, which is fine
      }

      console.log('User tables created/verified successfully');
    } catch (e: any) {
      console.error('Error creating user tables:', e?.message || e);
      toast({ title: 'Database Error', description: 'Failed to create user tables', variant: 'destructive' });
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

    loadAllData();
    loadCityLedger();
    loadVendors();
    loadVendorExpenses();
    loadVendorPayments();
    loadLogs();

    // Perform initial sync of localStorage data to database
    // This ensures any items created while offline are synced
    (async () => {
      try {
        await ensureTablesExist();
        const result = await performFullSync();
        if (result.synced && result.synced > 0) {
          console.log(`[DataContext] Initial sync completed: ${result.synced} items synced to database`);
        }
      } catch (err) {
        console.warn('[DataContext] Initial sync failed:', err);
      }
    })();

    // Initialize and start real-time sync service
    const syncService = initializeRealTimeSync();
    if (syncService) {
      syncService.start();
      setIsRealTimeSyncActive(true);
    }
  }, [user, loadAllData, loadCityLedger, loadVendors, loadVendorExpenses, loadVendorPayments, loadLogs, initializeRealTimeSync]);

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
