import React, { useMemo, useState, useRef } from 'react';
import { useData } from '@/context/DataContext';
import { PaymentModal, BillSummary, QuickActions } from '../pos/POSIntegrationComponents';
import { formatCurrency, generateShiftXReadingHTML, printDocument } from '@/lib/posIntegration';
import { deductInventoryStock, syncPosBillToDb } from '@/lib/dbSync';
import { useShift } from '@/contexts/ShiftContext';
import { getOutletReceiptSettings } from '@/components/modules/ReceiptSettingsModal';
import { useAuth } from '@/context/AuthContext';
import menuCats from '@/lib/menuCategories';
import { ShiftClosureModal } from '@/components/pos/ShiftClosureModal';
import { ShiftReportModal } from '@/components/posimport/ShiftReportModal';
import { ShiftReading } from '@/types';

interface MenuItem {
  id: string;
  name: string;
  price: number;
  category: 'bar' | 'restaurant';
  category_id?: string | null;
  sub_id?: string | null;
  qtyInStock?: number;
}

interface InventoryItem {
  id: string;
  name: string;
  selling_price: number | string;
  type?: string;
  category?: string;
  department?: string;
  costCenter?: string;
  category_id?: string | null;
  sub_id?: string | null;
  stock_level?: number;
  qtyInStock?: number;
}

// Hardcoded items removed. Using inventory from DataContext.
// const menuItems: MenuItem[] = [...];

export const POS: React.FC = () => {
  const { user } = useAuth();
  const { guests, recordFolioCharge, removeFolioCharge, inventory } = useData();
  const { activeShift, startShift, endShift, getTotals, addTransaction, generateXReading } = useShift();

  // Transform inventory to POS Menu Items
  const menuItems: MenuItem[] = useMemo(() => {
    console.log('[POS] Inventory raw:', inventory?.length, inventory?.[0]);
    const items = (inventory || [])
      .filter((i: InventoryItem) => i.selling_price && Number(i.selling_price) > 0)
      .map((i: InventoryItem) => {
        // Priority: costCenter is the most reliable field (explicitly set by user)
        const costCenter = String(i.costCenter || '').toLowerCase();
        // Fallback: check category/department/type fields for bar-related keywords
        const rawCat = String(i.category || i.department || i.type || '').toLowerCase();
        const isBar =
          costCenter === 'bar' ||
          costCenter.includes('bar') ||
          rawCat === 'bar' ||
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
        const category: 'bar' | 'restaurant' = isBar ? 'bar' : 'restaurant';
        return {
          id: i.id,
          name: i.name,
          price: Number(i.selling_price),
          category,
          category_id: i.category_id,
          sub_id: i.sub_id,
          qtyInStock: i.qtyInStock ?? i.stock_level ?? 0,
        };
      });
    console.log('[POS] MenuItems processed:', items.length, 'bar:', items.filter(m => m.category === 'bar').length, 'restaurant:', items.filter(m => m.category === 'restaurant').length);
    return items;
  }, [inventory]);

  const [activeCategory, setActiveCategory] = useState<'bar' | 'restaurant'>('restaurant');
  const [activeSubCategoryId, setActiveSubCategoryId] = useState<string>('all');
  const [cart, setCart] = useState<{ item: MenuItem; qty: number; preparation_level?: string; manual_notes?: string }[]>([]);
  const [roomNumber, setRoomNumber] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [isClosureModalOpen, setIsClosureModalOpen] = useState(false);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [currentReading, setCurrentReading] = useState<ShiftReading | null>(null);
  const txContainerRef = useRef<HTMLDivElement | null>(null);

  // Persistence for Cart
  React.useEffect(() => {
    try {
      const savedCart = localStorage.getItem('corepms_pos_cart');
      if (savedCart) {
        setCart(JSON.parse(savedCart));
      }
    } catch (e) {
      console.warn('[POS] Failed to load cart from localStorage', e);
    }
  }, []);

  React.useEffect(() => {
    setActiveSubCategoryId('all');
  }, [activeCategory]);

  React.useEffect(() => {
    localStorage.setItem('corepms_pos_cart', JSON.stringify(cart));
  }, [cart]);

  const [txVisibleRange, setTxVisibleRange] = useState<{ start: number; end: number }>({ start: 0, end: 20 });
  const [txScrollHint, setTxScrollHint] = useState(false);
  const [isScrolling, setIsScrolling] = useState(false);
  const txLastRef = useRef<number>(0);
  const TX_ROW_HEIGHT = 44;

  const handleTxScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const container = e.currentTarget;
    const scrollTop = container.scrollTop;
    const scrollHeight = container.scrollHeight;
    const clientHeight = container.clientHeight;

    // Show hint when user scrolls near bottom
    if (scrollHeight - scrollTop - clientHeight < 200 && activeShift?.transactions.length > 10) {
      setTxScrollHint(true);
      setTimeout(() => setTxScrollHint(false), 2000);
    }
  };

  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [prepLevel, setPrepLevel] = useState<string>('');
  const [specialNotes, setSpecialNotes] = useState<string>('');
  const addToCart = (item: MenuItem) => {
    const existingIndex = cart.findIndex(c => c.item.id === item.id);
    if (existingIndex >= 0) {
      const copy = [...cart];
      copy[existingIndex] = { ...copy[existingIndex], qty: copy[existingIndex].qty + 1 };
      setCart(copy);
    } else {
      const nextIndex = cart.length;
      setCart([...cart, { item, qty: 1 }]);
      setEditIdx(nextIndex);
      setPrepLevel('');
      setSpecialNotes('');
    }
  };

  const removeItem = (index: number) => {
    setCart(prev => prev.filter((_, i) => i !== index));
  };



  // Get outlet-specific receipt settings based on active category
  const receiptSettings = useMemo(() => {
    try {
      const settings = getOutletReceiptSettings(activeCategory);
      return {
        restaurant_name: settings.restaurant_name || 'POS',
        address: settings.address,
        phone: settings.phone,
        email: settings.email,
        tax_rate: settings.tax_rate ?? 10,
        show_tax_breakdown: true,
        paper_size: settings.paper_size || '80mm' as const,
        logo_url: settings.logo_url,
        show_logo: settings.show_logo,
        header_text: settings.header_text,
        footer_text: settings.footer_text,
        promotional_message: undefined
      };
    } catch {
      return {
        restaurant_name: 'POS',
        tax_rate: 10,
        show_tax_breakdown: true,
        paper_size: '80mm' as const
      };
    }
  }, [activeCategory]);
 
  const total = useMemo(() => cart.reduce((sum, c) => sum + (c.item.price * c.qty), 0), [cart]);
  const taxRate = receiptSettings?.tax_rate || 0;
  const tax = useMemo(() => total * (taxRate / (100 + taxRate)), [total, taxRate]);
  const subtotal = useMemo(() => total - tax, [total, tax]);
 
  const bill = useMemo(() => ({
    id: `BILL_${Date.now()}`,
    items: cart.map(c => ({
      id: c.item.id,
      name: c.item.name,
      quantity: c.qty,
      price: c.item.price,
      subtotal: c.item.price * c.qty
    })),
    subtotal,
    tax,
    total,
    createdAt: new Date().toISOString(),
    customerName: customerName || undefined,
    roomNumber: roomNumber || undefined
  }), [cart, subtotal, tax, total, customerName, roomNumber]);

  const openPayment = () => {
    if (cart.length === 0) {
      alert('Cart is empty');
      return;
    }
    setIsPaymentOpen(true);
  };

  // Format bill ID to 4 digits for display
  const formatBillNumber = (billId: string): string => {
    const numericPart = billId.replace(/\D/g, '');
    return numericPart.slice(-4).padStart(4, '0');
  };

  // Get outlet display name based on active category
  const getOutletDisplayName = (): string => {
    return activeCategory === 'bar' ? 'Bar POS' : 'Restaurant POS';
  };

  const handlePaymentComplete = async (paymentData: any) => {
    // If room charge, post to folio
    let folioPosted = false;
    let folioChargeId: string | null = null;
    if (paymentData.paymentMethod === 'room-charge') {
      // Find guest by room number
      const guest = guests.find(g => g.roomNumber === paymentData.roomNumber);
      if (!guest) {
        alert('No checked-in guest found for this room number.');
      } else {
        try {
          // Use outlet-specific description with 4-digit bill number
          const outletName = getOutletDisplayName();
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
          console.error('Folio post error:', err);
        }
      }
    }

    // Log transaction to Shift totals
    try {
      addTransaction(paymentData.paymentMethod, Number(total.toFixed(2)), bill.id, activeCategory);
    } catch (err) {
      console.warn('Shift logging failed:', err);
    }

    // Clear cart and customer info
    setCart([]);
    setRoomNumber('');
    setCustomerName('');


    // Deduct Stock
    try {
      const deductionItems = bill.items.map((item: any) => ({
        id: item.id,
        qty: item.quantity
      }));
      await deductInventoryStock(deductionItems);
    } catch (err) {
      console.error('Failed to deduct stock:', err);
    }

    // Sync POS Bill to DB
    try {
      const dbBill = {
        id: bill.id,
        bill_number: formatBillNumber(bill.id),
        outlet: activeCategory === 'bar' ? 'Bar' : 'Restaurant',
        table_number: null,
        guest_id: paymentData.paymentMethod === 'room-charge' ? (guests.find((g: any) => g.roomNumber === paymentData.roomNumber)?.id || null) : null,
        folio_id: folioChargeId || null,
        room_number: paymentData.roomNumber || null,
        subtotal: bill.subtotal,
        tax_amount: bill.tax,
        discount_amount: 0,
        service_charge: 0,
        total_amount: bill.total,
        items: bill.items,
        payment_method: paymentData.paymentMethod,
        payment_status: paymentData.paymentMethod === 'room-charge' ? 'charged_to_room' : 'paid',
        amount_paid: bill.total,
        change_amount: 0,
        business_date: activeShift?.date || new Date().toISOString().slice(0, 10),
        opened_at: bill.createdAt,
        closed_at: new Date().toISOString(),
        opened_by: user?.username || 'system',
        closed_by: user?.username || 'system',
        is_voided: false,
        shift_id: activeShift?.id || null
      };
      await syncPosBillToDb(dbBill as any);
    } catch (err) {
      console.error('Failed to sync POS bill to DB:', err);
    }

    return { ok: true, method: paymentData.paymentMethod, billId: bill.id, folioPosted, folioChargeId };
  };

  const actions = [
    { id: 'checkout', label: 'Checkout', onClick: openPayment },
    { id: 'clear', label: 'Clear', color: 'outline' as const, onClick: () => setCart([]), disabled: cart.length === 0 }
  ];

  const handleXReading = async () => {
    try {
      const reading = generateXReading();
      setCurrentReading(reading);
      setIsReportModalOpen(true);
    } catch (error) {
      console.error('Failed to generate X-Reading:', error);
    }
  };

  const handleEndShift = () => {
    setIsClosureModalOpen(true);
  };

  const handleShiftClosed = (zReading: ShiftReading) => {
    setCurrentReading(zReading);
    setIsReportModalOpen(true);
    setIsClosureModalOpen(false);
  };

  const totals = getTotals();

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-3xl font-bold text-gray-800">POS System</h2>
        {activeShift && (
          <div className="flex gap-2">
            <button
              onClick={handleXReading}
              className="px-4 py-2 bg-yellow-500 hover:bg-yellow-600 text-white rounded-lg font-medium transition-colors"
            >
              X Reading
            </button>
            <button
              onClick={handleEndShift}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors"
            >
              End Shift
            </button>
          </div>
        )}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-xl shadow-lg p-6">
          <div className="flex gap-4 mb-6">
            <button
              onClick={() => setActiveCategory('restaurant')}
              className={`flex-1 py-3 rounded-lg font-semibold ${activeCategory === 'restaurant' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}
            >
              Restaurant
            </button>
            <button
              onClick={() => setActiveCategory('bar')}
              className={`flex-1 py-3 rounded-lg font-semibold ${activeCategory === 'bar' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}
            >
              Bar
            </button>
          </div>

          {/* Sub-category Tabs */}
          <div className="flex gap-2 mb-6 overflow-x-auto pb-2 no-scrollbar">
            <button
              onClick={() => setActiveSubCategoryId('all')}
              className={`px-4 py-2 rounded-full whitespace-nowrap text-sm font-medium transition-colors ${activeSubCategoryId === 'all' ? 'bg-blue-100 text-blue-700 border-2 border-blue-500' : 'bg-gray-100 text-gray-600 border-2 border-transparent'}`}
            >
              All Items
            </button>
            {menuCats.listCategories(activeCategory === 'bar' ? 'Bar' : 'Restaurant').map(cat => (
              <button
                key={cat.category_id}
                onClick={() => setActiveSubCategoryId(cat.category_id)}
                className={`px-4 py-2 rounded-full whitespace-nowrap text-sm font-medium transition-colors ${activeSubCategoryId === cat.category_id ? 'bg-blue-100 text-blue-700 border-2 border-blue-500' : 'bg-gray-100 text-gray-600 border-2 border-transparent'}`}
              >
                {cat.category_name}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {menuItems
              .filter(m => m.category === activeCategory)
              .filter(m => activeSubCategoryId === 'all' || m.category_id === activeSubCategoryId || m.sub_id === activeSubCategoryId)
              .map(item => (
                <button
                  key={item.id}
                  onClick={() => addToCart(item)}
                  className="bg-white hover:bg-blue-50 p-4 rounded-xl border-2 border-gray-100 hover:border-blue-200 transition-all shadow-sm flex flex-col items-start text-left relative overflow-hidden group"
                >
                  <div className="absolute top-0 right-0 p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <div className="bg-blue-600 text-white p-1 rounded-full">
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                    </div>
                  </div>
                  <p className="font-bold text-gray-800 mb-1 line-clamp-2 leading-tight h-10">{item.name}</p>
                  <div className="flex justify-between items-end w-full mt-auto">
                    <p className="text-lg font-bold text-blue-600">{formatCurrency(item.price)}</p>
                    {item.qtyInStock !== undefined && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${item.qtyInStock <= 5 ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}`}>
                        Qty: {item.qtyInStock}
                      </span>
                    )}
                  </div>
                </button>
              ))}
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-lg p-6">
          <h3 className="text-xl font-bold text-gray-800 mb-4">Current Order</h3>
          <div className="space-y-3 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Guest Name</label>
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                placeholder="Enter guest name (optional)"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Room Number</label>
              <input
                type="text"
                value={roomNumber}
                onChange={(e) => setRoomNumber(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                placeholder="Enter room # (for room charge)"
              />
            </div>
          </div>

          <div className="mb-6 max-h-64 overflow-y-auto">
            <BillSummary
              bill={{
                id: bill.id,
                items: bill.items.map((it, i) => {
                  const c = cart[i];
                  return {
                    ...it,
                    preparation_level: (c as any)?.preparation_level || undefined,
                    manual_notes: (c as any)?.manual_notes || undefined,
                    category: c?.item?.category
                  } as any;
                }),
                subtotal: bill.subtotal,
                tax: bill.tax,
                total: bill.total,
                createdAt: bill.createdAt,
                customerName: bill.customerName,
                roomNumber: bill.roomNumber
              }}
              onRemoveItem={removeItem}
              editable
            />
          </div>
          {editIdx !== null && cart[editIdx] && (
            <div className="border rounded-lg p-3 mb-4 bg-gray-50">
              <div className="font-semibold text-sm mb-2">Item Options: {cart[editIdx].item.name}</div>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <div>
                  <label htmlFor="prep-level" className="block text-xs text-gray-700 mb-1">Preparation Level</label>
                  <select id="prep-level" title="Preparation Level" className="w-full px-2 py-1 border rounded" value={prepLevel} onChange={(e) => setPrepLevel(e.target.value)}>
                    <option value="">Select…</option>
                    <option value="Rare">Rare</option>
                    <option value="Medium">Medium</option>
                    <option value="Medium-Well">Medium-Well</option>
                    <option value="Well Done">Well Done</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="item-qty" className="block text-xs text-gray-700 mb-1">Quantity</label>
                  <input id="item-qty" type="number" min={1} title="Quantity" className="w-full px-2 py-1 border rounded" value={cart[editIdx].qty} onChange={(e) => {
                    const q = Math.max(1, Number(e.target.value || 1));
                    const copy = [...cart]; copy[editIdx] = { ...copy[editIdx], qty: q }; setCart(copy);
                  }} />
                </div>
              </div>
              <div>
                <label htmlFor="special-instr" className="block text-xs text-gray-700 mb-1">Special Instructions</label>
                <textarea id="special-instr" className="w-full px-2 py-1 border rounded" rows={3} value={specialNotes} onChange={(e) => setSpecialNotes(e.target.value)} placeholder="e.g., No salt, extra sauce, allergy notes…" />
              </div>
              <div className="mt-2 flex gap-2">
                <button
                  className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs hover:bg-blue-700"
                  onClick={() => {
                    const copy = [...cart];
                    copy[editIdx!] = { ...copy[editIdx!], preparation_level: prepLevel || undefined, manual_notes: specialNotes || undefined };
                    setCart(copy);
                    setEditIdx(null);
                    setPrepLevel('');
                    setSpecialNotes('');
                  }}
                >
                  Apply
                </button>
                <button
                  className="px-3 py-1.5 border rounded text-xs hover:bg-gray-100"
                  onClick={() => { setEditIdx(null); setPrepLevel(''); setSpecialNotes(''); }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="border-t pt-4 mb-4">
            <div className="flex justify-between items-center">
              <span className="text-xl font-bold text-gray-800">Total:</span>
              <span className="text-3xl font-bold text-blue-600">{formatCurrency(total)}</span>
            </div>
          </div>

          <QuickActions actions={actions} />



          {/* Shift Transactions Table */}
          {activeShift && (
            <div className="mt-6 p-4 border rounded-lg">
              <div className="font-semibold mb-2">Shift Transactions</div>
              <div className="text-xs text-gray-600 mb-2">Recent payments processed during this shift</div>
              <div
                ref={txContainerRef}
                className={`relative overflow-x-auto overflow-y-auto max-h-64 sm:max-h-80 pos-scroll-touch ${isScrolling ? '' : 'scroll-smooth'}`}
                onScroll={handleTxScroll}
                tabIndex={0}
                onKeyDown={(e) => {
                  const el = txContainerRef.current;
                  if (!el) return;
                  // Keyboard navigation with smooth scrolling
                  const scrollOpts: ScrollToOptions = { behavior: 'smooth' };
                  if (e.key === 'ArrowDown') { el.scrollBy({ top: TX_ROW_HEIGHT, ...scrollOpts }); }
                  if (e.key === 'ArrowUp') { el.scrollBy({ top: -TX_ROW_HEIGHT, ...scrollOpts }); }
                  if (e.key === 'PageDown') { el.scrollBy({ top: el.clientHeight, ...scrollOpts }); }
                  if (e.key === 'PageUp') { el.scrollBy({ top: -el.clientHeight, ...scrollOpts }); }
                  if (e.key === 'Home') { el.scrollTo({ top: 0, ...scrollOpts }); }
                  if (e.key === 'End') { el.scrollTo({ top: el.scrollHeight, ...scrollOpts }); }
                }}
              >
                <table className="min-w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-gray-100 shadow-sm">
                    <tr className="text-left border-b">
                      <th className="py-2 pr-4 pl-2">Time</th>
                      <th className="py-2 pr-4">Method</th>
                      <th className="py-2 pr-4">Reference</th>
                      <th className="py-2 pr-4 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeShift.transactions.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-3 text-center text-gray-500">No transactions yet</td>
                      </tr>
                    ) : (
                      (() => {
                        const data = activeShift.transactions.slice().reverse();
                        const rows = data.slice(txVisibleRange.start, txVisibleRange.end).map((tx) => (
                          <tr
                            key={tx.id}
                            className={`border-b transition-colors ${isScrolling ? '' : 'hover:bg-gray-50'}`}
                            style={{ height: TX_ROW_HEIGHT }}
                          >
                            <td className="py-2 pr-4 pl-2">{new Date(tx.createdAt).toLocaleString()}</td>
                            <td className="py-2 pr-4">{tx.method}</td>
                            <td className="py-2 pr-4">{tx.reference || ''}</td>
                            <td className="py-2 pr-4 text-right">{formatCurrency(tx.amount)}</td>
                          </tr>
                        ));
                        // Coordinate calculation fix: Ensure spacer rows have explicit table-cell display structure
                        // to prevent browser collapsing behavior
                        const topHeight = txVisibleRange.start * TX_ROW_HEIGHT;
                        const bottomHeight = Math.max(0, (data.length - txVisibleRange.end) * TX_ROW_HEIGHT);

                        const top = topHeight > 0 ? (
                          <tr style={{ height: topHeight, padding: 0, border: 0 }} aria-hidden="true">
                            <td colSpan={4} style={{ padding: 0, border: 0 }}></td>
                          </tr>
                        ) : null;

                        const bottom = bottomHeight > 0 ? (
                          <tr style={{ height: bottomHeight, padding: 0, border: 0 }} aria-hidden="true">
                            <td colSpan={4} style={{ padding: 0, border: 0 }}></td>
                          </tr>
                        ) : null;

                        return [top, ...rows, bottom];
                      })()
                    )}
                  </tbody>
                </table>
                {activeShift.transactions.length > 10 && txScrollHint && (
                  <div className="absolute bottom-2 right-2 bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-xs font-medium opacity-70">
                    {activeShift.transactions.length} records • Scroll to view more
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <PaymentModal
        bill={bill}
        isOpen={isPaymentOpen}
        onClose={() => setIsPaymentOpen(false)}
        onPaymentComplete={handlePaymentComplete}
        currentUser={{ name: user?.name || 'Server', id: user?.id || 'server-1' }}
        receiptSettings={receiptSettings}
      />

      <ShiftClosureModal
        open={isClosureModalOpen}
        onClose={() => setIsClosureModalOpen(false)}
        onSuccess={handleShiftClosed}
      />

      <ShiftReportModal
        open={isReportModalOpen}
        onClose={() => setIsReportModalOpen(false)}
        reading={currentReading}
      />
    </div>
  );
};

const logPaymentError = (step: string, error: any, ctx?: any) => {
  try {
    const entry = { step, error: String((error && (error.message || error)) || 'Unknown'), ctx, at: new Date().toISOString() };
    const raw = localStorage.getItem('corepms_payment_errors');
    const list = raw ? JSON.parse(raw) : [];
    localStorage.setItem('corepms_payment_errors', JSON.stringify([entry, ...list].slice(0, 500)));
  } catch (e) {
    console.error('[POS] Failed to log payment error', e);
  }
};