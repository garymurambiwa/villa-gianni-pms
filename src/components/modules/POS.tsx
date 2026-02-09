import React, { useMemo, useState, useRef } from 'react';
import { useData } from '@/context/DataContext';
import { PaymentModal, BillSummary, QuickActions } from '../pos/POSIntegrationComponents';
import { formatCurrency, generateShiftXReadingHTML, printDocument } from '@/lib/posIntegration';
import { deductInventoryStock } from '@/lib/dbSync';
import { useShift } from '@/contexts/ShiftContext';
import { getOutletReceiptSettings } from '@/components/modules/ReceiptSettingsModal';
import { useAuth } from '@/context/AuthContext';

interface MenuItem {
  id: string;
  name: string;
  price: number;
  category: 'bar' | 'restaurant';
}

// Hardcoded items removed. Using inventory from DataContext.
// const menuItems: MenuItem[] = [...];

export const POS: React.FC = () => {
  const { user } = useAuth();
  const { guests, recordFolioCharge, removeFolioCharge, inventory } = useData();
  const { activeShift, startShift, endShift, getTotals, addTransaction } = useShift();

  // Transform inventory to POS Menu Items
  const menuItems: MenuItem[] = useMemo(() => {
    return (inventory || [])
      .filter((i: any) => i.selling_price && Number(i.selling_price) > 0)
      .map((i: any) => ({
        id: i.id,
        name: i.name,
        price: Number(i.selling_price),
        category: (i.type === 'bar' || i.type === 'restaurant') ? i.type : 'restaurant' // Default to restaurant if unknown
      }));
  }, [inventory]);

  const [activeCategory, setActiveCategory] = useState<'bar' | 'restaurant'>('restaurant');
  const [cart, setCart] = useState<{ item: MenuItem; qty: number; preparation_level?: string; manual_notes?: string }[]>([]);
  const [roomNumber, setRoomNumber] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const txContainerRef = useRef<HTMLDivElement | null>(null);

  // Persistence for Cart
  React.useEffect(() => {
    try {
      const savedCart = localStorage.getItem('corepms_pos_cart');
      if (savedCart) {
        setCart(JSON.parse(savedCart));
      }
    } catch { }
  }, []);

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

  const subtotal = useMemo(() => cart.reduce((sum, c) => sum + (c.item.price * c.qty), 0), [cart]);
  const taxRate = 0.10;
  const tax = useMemo(() => subtotal * taxRate, [subtotal]);
  const total = useMemo(() => subtotal + tax, [subtotal, tax]);

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
      addTransaction(paymentData.paymentMethod, Number(total.toFixed(2)), bill.id);
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

    return { ok: true, method: paymentData.paymentMethod, billId: bill.id, folioPosted, folioChargeId };
  };

  const actions = [
    { id: 'checkout', label: 'Checkout', onClick: openPayment },
    { id: 'clear', label: 'Clear', color: 'outline' as const, onClick: () => setCart([]), disabled: cart.length === 0 }
  ];

  return (
    <div className="p-6">
      <h2 className="text-3xl font-bold text-gray-800 mb-6">POS System</h2>
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
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {menuItems.filter(m => m.category === activeCategory).map(item => (
              <button
                key={item.id}
                onClick={() => addToCart(item)}
                className="bg-gradient-to-br from-blue-50 to-blue-100 hover:from-blue-100 hover:to-blue-200 p-6 rounded-xl border-2 border-blue-200 transition-all"
              >
                <p className="font-bold text-gray-800 mb-2">{item.name}</p>
                <p className="text-2xl font-bold text-blue-600">{formatCurrency(item.price)}</p>
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
                  <label className="block text-xs text-gray-700 mb-1">Preparation Level</label>
                  <select className="w-full px-2 py-1 border rounded" value={prepLevel} onChange={(e) => setPrepLevel(e.target.value)}>
                    <option value="">Select…</option>
                    <option value="Rare">Rare</option>
                    <option value="Medium">Medium</option>
                    <option value="Medium-Well">Medium-Well</option>
                    <option value="Well Done">Well Done</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-700 mb-1">Quantity</label>
                  <input type="number" min={1} className="w-full px-2 py-1 border rounded" value={cart[editIdx].qty} onChange={(e) => {
                    const q = Math.max(1, Number(e.target.value || 1));
                    const copy = [...cart]; copy[editIdx] = { ...copy[editIdx], qty: q }; setCart(copy);
                  }} />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-700 mb-1">Special Instructions</label>
                <textarea className="w-full px-2 py-1 border rounded" rows={3} value={specialNotes} onChange={(e) => setSpecialNotes(e.target.value)} placeholder="e.g., No salt, extra sauce, allergy notes…" />
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
                className="relative overflow-x-auto overflow-y-auto max-h-64 sm:max-h-80 scroll-smooth"
                onScroll={handleTxScroll}
                style={{
                  WebkitOverflowScrolling: 'touch',
                  touchAction: 'pan-y', // Explicitly allow vertical panning
                  scrollBehavior: isScrolling ? 'auto' : 'smooth' // Use auto during drag, smooth for snap
                }}
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
    </div>
  );
};

const logPaymentError = (step: string, error: any, ctx?: any) => {
  try {
    const entry = { step, error: String((error && (error.message || error)) || 'Unknown'), ctx, at: new Date().toISOString() };
    const raw = localStorage.getItem('corepms_payment_errors');
    const list = raw ? JSON.parse(raw) : [];
    localStorage.setItem('corepms_payment_errors', JSON.stringify([entry, ...list].slice(0, 500)));
  } catch { }
};