import React, { useEffect, useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { formatCurrency, getMenuItems, getPosSettings } from '@/lib/posIntegration';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import pmsAuthDb from '@/lib/pmsAuthDb';
import menuCats, { SubTreeNode, SubCategory } from '@/lib/menuCategories';
import cocktailEng from '@/lib/cocktailEngineering';
import { useToast } from '@/hooks/use-toast';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { useShift } from '@/contexts/ShiftContext';
import { useAuth } from '@/context/AuthContext';
import { canManagePOS } from '@/lib/permissions';

export interface MenuItem {
  id: string;
  name: string;
  price: number;
  category: 'food' | 'bar';
  subCategory?: string;
  category_id?: string;
  image: string;
  description?: string;
}

export interface BillItem {
  menuItem: MenuItem;
  quantity: number;
  subtotal: number;
  preparation_level?: 'rare' | 'medium-rare' | 'medium' | 'medium-well' | 'well-done' | 'n/a';
  manual_notes?: string;
}

export interface Bill {
  id: string;
  tableId: string;
  items: BillItem[];
  status: 'open' | 'suspended' | 'paid';
  createdAt: string;
  total: number;
  shift_id?: string;
  user_id?: string;
  vat_amount?: number;
  service_charge_amount?: number;
}

interface OrderModalProps {
  tableNumber: number;
  bill: Bill | null;
  onClose: () => void;
  onSave: (bill: Bill) => void;
  onPayment?: (bill: Bill) => void;
  menuItems: MenuItem[];
}

export const OrderModal: React.FC<OrderModalProps> = ({ tableNumber, bill, onClose, onSave, onPayment, menuItems }) => {
  const [items, setItems] = useState<BillItem[]>(bill?.items || []);
  const [activeCategory, setActiveCategory] = useState<'food' | 'bar'>('food');
  const [dynamicMenu, setDynamicMenu] = useState<MenuItem[]>([]);
  const [selectedCatId, setSelectedCatId] = useState<string | null>(null);
  const { toast } = useToast();
  const { activeShift } = useShift();
  const { user, verifyPosPin } = useAuth();

  // Track which items have been committed (saved/printed) — these require manager PIN to remove
  const [committedItemIds, setCommittedItemIds] = useState<Set<string>>(() => {
    // Pre-populate from existing bill items so reloaded orders are also protected
    return new Set(bill?.items?.map(i => i.menuItem.id) || []);
  });
  // Manager PIN auth state for item removal
  const [pinModalOpen, setPinModalOpen] = useState(false);
  const [pinValue, setPinValue] = useState('');
  const [pinError, setPinError] = useState('');
  const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null);
  const [subTree, setSubTree] = useState<SubTreeNode[]>([]);
  const [subPath, setSubPath] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [itemSize, setItemSize] = useState<'sm' | 'md' | 'lg'>('md');
  const [posSettings, setPosSettings] = useState({ vat_rate: 0.15, service_charge: 0, currency_symbol: '$' });
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; item: MenuItem } | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Fetch POS settings on mount
  useEffect(() => {
    getPosSettings().then(setPosSettings);
  }, []);

  // Close context menu when clicking elsewhere
  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  // Handle context menu (right-click) on menu items
  const handleContextMenu = (e: React.MouseEvent, item: MenuItem) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, item });
  };

  // Handle long-press on touch devices
  const handleLongPress = (e: React.TouchEvent, item: MenuItem) => {
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      setContextMenu({ x: touch.clientX, y: touch.clientY, item });
    }
  };

  // Open item edit modal from context menu
  const openItemEdit = (item: MenuItem) => {
    setEditingItem(item);
    setEditItemPrice(String(item.price));
    setEditItemCategory(item.category_id || '');
    setEditItemCost(String((item as any).costPrice || (item as any).cost_price || ''));
    setEditItemUnit(String((item as any).unitOfMeasure || (item as any).unit || ''));
    setEditItemDesc(String(item.description || ''));
    setEditItemVis(String((item as any).visibility || 'POS Only'));
    setShowItemEdit(true);
    setContextMenu(null);
  };

  // Save edited item to database and update local state
  const saveItemEdit = async () => {
    if (!editingItem) return;
    try {
      const costPrice = Number(editItemCost || 0);
      const sellingPrice = Number(editItemPrice);
      const gp = sellingPrice > 0 ? ((sellingPrice - costPrice) / sellingPrice * 100) : 0;
      
      // Update in localStorage
      const raw = localStorage.getItem('corepms_pos_items');
      const list = raw ? JSON.parse(raw) : [];
      const updatedList = list.map((it: any) =>
        it.id === editingItem.id
          ? { 
              ...it, 
              price: Number(editItemPrice), 
              costPrice: costPrice,
              cost_price: costPrice,
              category_id: editItemCategory || it.category_id,
              unitOfMeasure: editItemUnit,
              unit: editItemUnit,
              notes: editItemDesc,
              visibility: editItemVis,
              gpPercent: Number(gp.toFixed(2))
            }
          : it
      );
      localStorage.setItem('corepms_pos_items', JSON.stringify(updatedList));

      // Update local state
      setDynamicMenu(prev => prev.map(it =>
        it.id === editingItem.id
          ? { ...it, price: Number(editItemPrice), category_id: editItemCategory || it.category_id, description: editItemDesc }
          : it
      ));

      // Sync to database
      const { db } = await import('@/lib/db');
      const dbResult = await db.query(
        `UPDATE products SET price = ?, cost_price = ?, category_id = ?, unit = ?, notes = ?, visibility = ?, updated_at = NOW() WHERE id = ?`,
        [Number(editItemPrice), costPrice, editItemCategory || null, editItemUnit || null, editItemDesc || null, editItemVis || 'POS Only', editingItem.id]
      );

      if ('error' in dbResult) {
        throw new Error(`Database update failed: ${dbResult.error}`);
      }

      toast({ title: 'Item Updated', description: `${editingItem.name} has been updated.` });
      setShowItemEdit(false);
      setEditingItem(null);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      console.error('Failed to update item:', err);
      toast({ title: 'Update Failed', description: errorMessage, variant: 'destructive' });
    }
  };

  // Quick Add handler
  const handleQuickAdd = async () => {
    if (!quickAddName.trim() || !quickAddPrice) return;
    try {
      const newItem = {
        id: `ITEM_${Date.now()}`,
        name: quickAddName.trim(),
        price: Number(quickAddPrice),
        category: activeCategory as 'food' | 'bar',
        category_id: quickAddCategory || (activeCategory === 'bar' ? 'CAT_BAR_GEN' : 'CAT_REST_GEN'),
        image: '',
        description: ''
      };

      // Save to localStorage
      const raw = localStorage.getItem('corepms_pos_items');
      const list = raw ? JSON.parse(raw) : [];
      const updatedList = [newItem, ...list];
      localStorage.setItem('corepms_pos_items', JSON.stringify(updatedList.slice(0, 500)));

      // Update local state
      setDynamicMenu(prev => [newItem, ...prev]);

      // Save to database
      const { db } = await import('@/lib/db');
      const res = await db.query(
        `INSERT INTO products (id, name, price, cost_price, unit, visibility, visibility_stations, category_id, is_stock_item, active) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, true)`,
        [newItem.id, quickAddName, Number(quickAddPrice), Number(quickAddCostPrice), quickAddUnit, JSON.stringify(quickAddStations), quickAddCategory]
      );

      toast({ title: 'Item Added', description: `${newItem.name} has been added to the menu.` });
      setShowQuickAdd(false);
      setQuickAddName('');
      setQuickAddPrice('');
      setQuickAddCategory('');
      setQuickAddCostPrice('');
      setQuickAddVisibility('POS Only');
      setQuickAddUnit('pcs');
      setQuickAddStations([]);
    } catch (err) {
      console.error('Failed to add item:', err);
      toast({ title: 'Add Failed', description: 'Could not add item to database.', variant: 'destructive' });
    }
  };

  // Quick Add Item state
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [quickAddName, setQuickAddName] = useState('');
  const [quickAddPrice, setQuickAddPrice] = useState('');
  const [quickAddCategory, setQuickAddCategory] = useState<string>('');
  const [quickAddCostPrice, setQuickAddCostPrice] = useState('');
  const [quickAddVisibility, setQuickAddVisibility] = useState('POS Only');
  const [quickAddUnit, setQuickAddUnit] = useState('pcs');
  const [quickAddStations, setQuickAddStations] = useState<string[]>([]);
  const [availableStations, setAvailableStations] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    pmsAuthDb.listCostCentres().then(setAvailableStations);
  }, []);

  // Context Menu state for item editing
  const [showItemEdit, setShowItemEdit] = useState(false);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [editItemPrice, setEditItemPrice] = useState('');
  const [editItemCategory, setEditItemCategory] = useState<string>('');
  const [editItemCost, setEditItemCost] = useState('');
  const [editItemUnit, setEditItemUnit] = useState<string>('');
  const [editItemDesc, setEditItemDesc] = useState<string>('');
  const [editItemVis, setEditItemVis] = useState<string>('POS Only');

  // Sync dynamicMenu with menuItems prop when it changes (asynchronously via FrontOffice API)
  useEffect(() => {
    const refresh = async () => {
      if (menuItems && menuItems.length > 0) {
        setDynamicMenu(menuItems);
      } else {
        try {
          const fromStore = await getMenuItems();
          if (Array.isArray(fromStore) && fromStore.length > 0) {
            setDynamicMenu(fromStore as any);
          }
        } catch { }
      }
    };
    refresh();
  }, [menuItems]);

  // Build categories for current department and select first by default
  useEffect(() => {
    const dept = activeCategory === 'bar' ? 'Bar' : 'Restaurant';
    const cats = menuCats.listCategories(dept);
    if (cats.length) {
      setSelectedCatId(prev => prev ?? cats[0].category_id);
    } else {
      // Fallback: derive from subCategory when categories are not configured
      const names = Array.from(new Set(dynamicMenu.filter(m => (dept === 'Bar' ? m.category === 'bar' : m.category === 'food')).map(m => m.subCategory).filter(Boolean)));
      setSelectedCatId(prev => prev ?? (names.length ? names[0]! : null));
    }
    setSubPath([]);
  }, [activeCategory, dynamicMenu]);

  // Load subcategory tree when a proper category id is selected
  useEffect(() => {
    try {
      if (selectedCatId && selectedCatId.startsWith('CAT_')) {
        const tree = menuCats.listSubTreeByCategory(selectedCatId);
        setSubTree(tree);
        setSubPath([]);
      } else {
        setSubTree([]);
        setSubPath([]);
      }
    } catch {
      setSubTree([]);
    }
  }, [selectedCatId]);

  const findNode = (nodes: any[], id: string | null): any | null => {
    if (!id) return null;
    for (const n of nodes) {
      if (n.sub_id === id) return n;
      const child = findNode(n.children || [], id);
      if (child) return child;
    }
    return null;
  };
  const getCurrentLevel = (): any[] => {
    if (!subPath.length) return subTree;
    const cur = findNode(subTree, subPath[subPath.length - 1]);
    return cur?.children || [];
  };
  const collectDescendantIds = (node: SubTreeNode | null): Set<string> => {
    const ids = new Set<string>();
    if (!node) return ids;
    const dfs = (n: SubTreeNode) => { ids.add(n.sub_id); (n.children || []).forEach(dfs); };
    dfs(node);
    return ids;
  };

  const addItem = (menuItem: MenuItem) => {
    const existing = items.find(i => i.menuItem.id === menuItem.id);
    if (existing) {
      setItems(items.map(i =>
        i.menuItem.id === menuItem.id
          ? { ...i, quantity: i.quantity + 1, subtotal: (i.quantity + 1) * i.menuItem.price }
          : i
      ));
    } else {
      setItems([...items, { menuItem, quantity: 1, subtotal: menuItem.price, preparation_level: 'n/a', manual_notes: '' }]);
    }
    try {
      (async () => {
        const res = await cocktailEng.decrementIngredientsForCocktail(menuItem.id, 1);
        if (res.alerts.length) toast({ title: 'Low stock', description: res.alerts.join(' • ') });
      })();
    } catch (e) {
      console.warn('[OrderModal] Ingredient decrement failed:', e);
    }
  };

  const removeItem = (itemId: string) => {
    // If this item was previously saved/printed (committed), require manager PIN
    if (committedItemIds.has(itemId)) {
      setPendingRemoveId(itemId);
      setPinValue('');
      setPinError('');
      setPinModalOpen(true);
      return;
    }
    executeRemoveItem(itemId);
  };

  const executeRemoveItem = (itemId: string) => {
    console.log('[OrderModal] Removing committed item:', itemId);
    setItems(prevItems => {
      const filtered = prevItems.filter(i => i.menuItem.id !== itemId);
      // Immediately persist the updated bill so the table doesn't stay stuck occupied.
      // This is the "Immediate Commit" path: manager-authorized removals write to DB now.
      if (bill) {
        const updatedTotal = filtered.reduce((s, i) => s + i.subtotal, 0) * (1 + posSettings.service_charge);
        onSave({
          id: bill.id || `bill-${Date.now()}`,
          tableId: `t${tableNumber}`,
          items: filtered,
          status: filtered.length === 0 ? 'paid' : 'open',
          createdAt: bill.createdAt || new Date().toISOString(),
          total: updatedTotal,
          shift_id: activeShift?.id,
          user_id: user?.id,
        });
        // If all items removed, close the modal (table becomes available)
        if (filtered.length === 0) {
          setTimeout(() => onClose(), 300);
        }
      }
      return filtered;
    });
    setCommittedItemIds(prev => { const n = new Set(prev); n.delete(itemId); return n; });
    try { cocktailEng.restoreIngredientsForCocktail(itemId, 1); } catch (e) {
      console.warn('[OrderModal] Ingredient restoration failed:', e);
    }
    // Log void to localStorage audit trail for Z-Reading stamp
    try {
      const voidEntry = {
        itemId,
        timestamp: new Date().toISOString(),
        tableId: `t${tableNumber}`,
        billId: bill?.id,
        authorizedBy: 'manager-pin',
        shiftId: activeShift?.id,
      };
      const existing = JSON.parse(localStorage.getItem('corepms_void_log') || '[]');
      localStorage.setItem('corepms_void_log', JSON.stringify([voidEntry, ...existing].slice(0, 500)));
    } catch { /* non-fatal */ }
  };

  const handlePinSubmit = async () => {
    if (!pinValue.trim()) { setPinError('Enter manager PIN'); return; }
    try {
      const ok = await verifyPosPin(pinValue);
      if (ok) {
        setPinModalOpen(false);
        setPinError('');
        const removingId = pendingRemoveId;
        setPendingRemoveId(null);
        if (removingId) executeRemoveItem(removingId);
        toast({ title: '🔐 Void authorized', description: 'Item removed and logged to audit trail.' });
      } else {
        setPinError('Incorrect PIN — manager authorization required');
      }
    } catch {
      setPinError('Verification failed — try again');
    }
  };

  const total = (Array.isArray(items) ? items : []).reduce((sum, item) => sum + item.subtotal, 0);

  // Search: filter across ALL items when searching
  const isSearching = searchQuery.trim().length > 0;
  const searchResults = isSearching
    ? (Array.isArray(dynamicMenu) ? dynamicMenu : []).filter(m =>
      m.name.toLowerCase().includes(searchQuery.trim().toLowerCase())
    )
    : [];

  const filteredDept = (Array.isArray(dynamicMenu) ? dynamicMenu : []).filter(m => m.category === activeCategory);
  const filteredMenu = filteredDept.filter(m => {
    if (!selectedCatId) return true;
    // Match either explicit category_id or fallback subCategory name
    // If it's the general fallback category, allow items that don't have a specific category mapped
    if (selectedCatId === 'CAT_BAR_GEN' && m.category === 'bar' && !m.subCategory && !m.category_id) return true;
    if (selectedCatId === 'CAT_REST_GEN' && m.category === 'food' && !m.subCategory && !m.category_id) return true;

    const currentDeptCats = menuCats.listCategories(activeCategory === 'bar' ? 'Bar' : 'Restaurant');
    const firstCatId = currentDeptCats[0]?.category_id;

    // Check if the item's mapped category or subcategory actually exists in the POS categories
    const isOrphan = !currentDeptCats.some(cat =>
      cat.category_id === m.category_id ||
      cat.category_name === m.subCategory ||
      cat.category_id === m.subCategory
    );

    // If it's an orphan (i.e. belongs to a deleted category like CAT_BAR_GEN), show it in the first tab
    if (isOrphan && selectedCatId === firstCatId && m.category === activeCategory) {
      return true;
    }

    const match = (m.category_id && menuCats.getCategoryById(selectedCatId || '')?.category_id === m.category_id)
      || (!!m.subCategory && menuCats.getCategoryById(selectedCatId || '')?.category_name === m.subCategory)
      || (!!m.subCategory && selectedCatId === m.subCategory)
      || (m.category_id === selectedCatId);

    if (activeCategory === 'bar') {
      console.log('[OrderModal Debug]', {
        itemName: m.name,
        itemCat: m.category,
        itemSubCat: m.subCategory,
        itemCatId: m.category_id,
        selectedCatId,
        match
      });
    }

    return match;
  });

  const subFilteredMenu = (() => {
    if (!subPath.length) return filteredMenu;
    const selectedNode = findNode(subTree, subPath[subPath.length - 1]);
    const allowedIds = collectDescendantIds(selectedNode);
    const allowedNames = new Set<string>();
    const buildNames = (n: any) => { allowedNames.add(String(n.name || '')); (Array.isArray(n.children) ? n.children : []).forEach(buildNames); };
    if (selectedNode) buildNames(selectedNode);
    return filteredMenu.filter(m => {
      if ((m as any).sub_id && allowedIds.has(String((m as any).sub_id))) return true;
      if (m.subCategory && allowedNames.has(String(m.subCategory))) return true;
      return false;
    });
  })();

  // Items to display: search results or normal filtered menu
  const displayItems = isSearching ? searchResults : subFilteredMenu;

  return (
    <div className="fixed inset-0 bg-white z-50 flex flex-col overflow-hidden">
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="bg-gradient-to-r from-purple-600 to-blue-600 text-white p-4 flex justify-between items-center shadow-md">
          <h2 className="text-2xl font-bold">Table {tableNumber} - Order</h2>
          <div className="flex items-center gap-4">
            <div className="flex bg-white/20 p-1 rounded-lg">
              <button
                onClick={() => setItemSize('sm')}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${itemSize === 'sm' ? 'bg-white text-purple-600 shadow-sm' : 'text-white hover:bg-white/10'}`}
              >
                Small
              </button>
              <button
                onClick={() => setItemSize('md')}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${itemSize === 'md' ? 'bg-white text-purple-600 shadow-sm' : 'text-white hover:bg-white/10'}`}
              >
                Medium
              </button>
              <button
                onClick={() => setItemSize('lg')}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${itemSize === 'lg' ? 'bg-white text-purple-600 shadow-sm' : 'text-white hover:bg-white/10'}`}
              >
                Large
              </button>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex flex-1 overflow-hidden">
          <div className="w-2/3 p-4 flex flex-col border-r h-full">
            <div className="overflow-y-auto pr-2 pb-20">
            {/* Search bar */}
            <div className="mb-4 relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <svg className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <label htmlFor="item-search" className="sr-only">Search items</label>
              <input
                id="item-search"
                ref={searchInputRef}
                type="text"
                placeholder="Search items..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-10 py-2.5 border-2 border-gray-200 rounded-xl focus:border-purple-500 focus:outline-none transition-colors text-sm"
              />
              {searchQuery && (
                <button
                  onClick={() => { setSearchQuery(''); searchInputRef.current?.focus(); }}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
                  title="Clear search"
                  aria-label="Clear search"
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>

            {/* Quick Add Item Button — Managers/POS Managers only */}
            {canManagePOS(user?.role) && (
              <Button
                variant="outline"
                className="ml-2 text-purple-600 border-purple-200 hover:bg-purple-50"
                onClick={() => {
                  setQuickAddCategory(activeCategory === 'bar' ? 'CAT_BAR_GEN' : 'CAT_REST_GEN');
                  setShowQuickAdd(true);
                }}
              >
                + Quick Add
              </Button>
            )}

            {/* Search results indicator */}
            {isSearching && (
              <div className="mb-3 text-sm text-gray-500 flex items-center gap-2">
                <span className="font-medium text-purple-600">{searchResults.length}</span> result{searchResults.length !== 1 ? 's' : ''} for "{searchQuery}"
                {searchResults.length > 0 && (
                  <span className="text-xs text-gray-400">(across all categories)</span>
                )}
              </div>
            )}

            {/* Department tabs - hidden when searching */}
            {!isSearching && (
              <div className="flex gap-4 mb-6">
                <Button
                  variant={activeCategory === 'food' ? 'default' : 'outline'}
                  onClick={() => setActiveCategory('food')}
                >
                  Restaurant
                </Button>
                <Button
                  variant={activeCategory === 'bar' ? 'default' : 'outline'}
                  onClick={() => setActiveCategory('bar')}
                >
                  Bar
                </Button>
              </div>
            )}

            {/* Category row - hidden when searching */}
            {!isSearching && (
              <div className="mb-4 overflow-x-auto">
                <div className="flex items-center gap-2">
                  {(() => {
                    const dept = activeCategory === 'bar' ? 'Bar' : 'Restaurant';
                    const cats = menuCats.listCategories(dept);
                    if (cats.length) {
                      return cats.map(c => {
                        const style = c.buttonColor || c.textColor ? { backgroundColor: c.buttonColor, color: c.textColor, border: '1px solid #e5e7eb' } : undefined;
                        return (
                          <Button key={c.category_id} variant={selectedCatId === c.category_id ? 'default' : 'outline'} onClick={() => { setSelectedCatId(c.category_id); setSubPath([]); }} style={style}>
                            {c.category_name}
                          </Button>
                        );
                      });
                    }
                    // Fallback to derived names from menu items
                    const names = Array.from(new Set(filteredDept.map(m => m.subCategory).filter(Boolean)));
                    return names.map(name => (
                      <Button key={String(name)} variant={selectedCatId === name ? 'default' : 'outline'} onClick={() => { setSelectedCatId(String(name)); setSubPath([]); }}>{String(name)}</Button>
                    ));
                  })()}
                </div>
              </div>
            )}

            {/* Sub-category breadcrumb & row - hidden when searching */}
            {!isSearching && selectedCatId && String(selectedCatId).startsWith('CAT_') && (
              <div className="mb-4">
                <div className="flex items-center gap-2 mb-2 text-sm">
                  <button className="px-2 py-1 rounded border" onClick={() => setSubPath([])}>All</button>
                  {subPath.map((sid, idx) => {
                    const node = findNode(subTree, sid);
                    return (
                      <div key={sid} className="flex items-center gap-2">
                        <span>›</span>
                        <button className="px-2 py-1 rounded border" onClick={() => setSubPath(prev => prev.slice(0, idx + 1))}>{node?.name || sid}</button>
                      </div>
                    );
                  })}
                </div>
                <div className="overflow-x-auto">
                  <div className="flex items-center gap-2">
                    {getCurrentLevel().length ? getCurrentLevel().map((n: any) => (
                      <Button key={n.sub_id} variant={subPath[subPath.length - 1] === n.sub_id ? 'default' : 'outline'} onClick={() => setSubPath(prev => [...prev, n.sub_id])}>{n.name}</Button>
                    )) : (
                      <div className="text-xs text-gray-600">No sub-categories</div>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div 
              className="grid gap-3 transition-all"
              style={{ 
                gridTemplateColumns: `repeat(${itemSize === 'sm' ? 5 : itemSize === 'md' ? 3 : 2}, minmax(0, 1fr))` 
              }}
            >
              {displayItems.length === 0 && (
                <div className="col-span-3 text-center py-12 text-gray-400">
                  {isSearching ? (
                    <div>
                      <svg className="mx-auto h-12 w-12 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                      <p>No items found for "{searchQuery}"</p>
                    </div>
                  ) : (
                    <p>No items in this category</p>
                  )}
                </div>
              )}
              {displayItems.map(item => (
                <div
                  key={item.id}
                  onClick={() => { addItem(item); if (isSearching) setSearchQuery(''); }}
                  onContextMenu={(e) => handleContextMenu(e, item)}
                  onTouchEnd={(e) => {
                    // Simple long-press detection
                    const touch = e.touches[0];
                    const element = e.currentTarget;
                    let pressTimer: NodeJS.Timeout;
                    const startPress = () => {
                      pressTimer = setTimeout(() => handleContextMenu({ clientX: touch.clientX, clientY: touch.clientY } as any, item), 500);
                    };
                    const cancelPress = () => clearTimeout(pressTimer);
                    element.addEventListener('touchstart', startPress);
                    element.addEventListener('touchend', cancelPress);
                    element.addEventListener('touchmove', cancelPress);
                  }}
                  className="cursor-pointer bg-white rounded-lg shadow hover:shadow-lg transition-all p-3 border-2 border-transparent hover:border-purple-500"
                >
                  {item.image ? (
                    <img src={item.image} alt={item.name} className={`${itemSize === 'sm' ? 'h-16' : itemSize === 'md' ? 'h-24' : 'h-40'} w-full object-cover rounded mb-2 transition-all`} />
                  ) : (
                    <div className={`${itemSize === 'sm' ? 'h-16' : itemSize === 'md' ? 'h-24' : 'h-40'} w-full rounded mb-2 transition-all`} style={{ backgroundColor: (item as any).imageBgColor || '#ddd' } as React.CSSProperties} />
                  )}
                  <div className={`font-semibold ${itemSize === 'sm' ? 'text-xs' : 'text-sm'}`}>{item.name}</div>
                  {isSearching && (
                    <div className="text-xs text-gray-400">{(item as any).type === 'Bar' ? '🍺 Bar' : '🍴 Restaurant'}</div>
                  )}
                  {item.description && (
                    <div className="text-xs text-gray-600 line-clamp-2">{item.description}</div>
                  )}
                  <div className={`text-purple-600 font-bold ${itemSize === 'sm' ? 'text-xs' : 'text-base'}`}>{formatCurrency(item.price)}</div>
                </div>
              ))}
            </div>
            </div>
          </div>

          <div className="w-1/3 p-4 bg-gray-50 flex flex-col shadow-inner h-full">
            <h3 className="text-lg font-bold mb-3 flex items-center gap-2">
              <svg className="w-5 h-5 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
              </svg>
              Order Items
            </h3>
            <div className="flex-1 overflow-y-auto mb-4">
              {items.map(item => (
                <div key={item.menuItem.id} className="bg-white p-3 rounded-lg mb-2 shadow">
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                       <div className="font-semibold">{item.menuItem?.name || 'Unknown Item'}</div>
                      {!!item.preparation_level && item.preparation_level !== 'n/a' && (
                        <div className="text-xs text-gray-600 italic">({
                          item.preparation_level.replace('-', ' ')
                        })</div>
                      )}
                      {!!item.manual_notes && (
                        <div className="text-xs text-gray-500 italic whitespace-pre-line">{item.manual_notes}</div>
                      )}
                      {/* Quantity multiplier — tap − / + or type a number directly */}
                      <div className="flex items-center gap-1 mt-1">
                        <button
                          type="button"
                          className="w-6 h-6 rounded bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-sm flex items-center justify-center"
                          onClick={() => {
                            const newQty = item.quantity - 1;
                            if (newQty <= 0) { removeItem(item.menuItem.id); return; }
                            setItems(prev => prev.map(i =>
                              i.menuItem.id === item.menuItem.id
                                ? { ...i, quantity: newQty, subtotal: newQty * i.menuItem.price }
                                : i
                            ));
                          }}
                        >−</button>
                        <input
                          type="number"
                          min={1}
                          max={999}
                          value={item.quantity}
                          onChange={e => {
                            const newQty = Math.max(1, Math.min(999, parseInt(e.target.value) || 1));
                            setItems(prev => prev.map(i =>
                              i.menuItem.id === item.menuItem.id
                                ? { ...i, quantity: newQty, subtotal: newQty * i.menuItem.price }
                                : i
                            ));
                          }}
                          className="w-12 text-center text-sm border rounded py-0.5 font-semibold"
                        />
                        <button
                          type="button"
                          className="w-6 h-6 rounded bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-sm flex items-center justify-center"
                          onClick={() => {
                            const newQty = item.quantity + 1;
                            setItems(prev => prev.map(i =>
                              i.menuItem.id === item.menuItem.id
                                ? { ...i, quantity: newQty, subtotal: newQty * i.menuItem.price }
                                : i
                            ));
                          }}
                        >+</button>
                        <span className="text-xs text-gray-500 ml-1">× {formatCurrency(item.menuItem.price)}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-purple-600">{formatCurrency(item.subtotal)}</div>
                      <button
                        onClick={() => removeItem(item.menuItem.id)}
                        className="text-red-500 text-xs hover:text-red-700"
                      >
                        Remove
                      </button>
                    </div>
                  </div>

                  {item.menuItem.category === 'bar' ? (
                    /* ── Beverage: serving instruction quick-chips ── */
                    <div className="mt-2">
                      <div className="text-xs text-gray-500 mb-1">Serving instruction (optional)</div>
                      <div className="flex flex-wrap gap-1.5">
                        {(['With Ice', 'No Ice', 'Neat', 'On The Rocks', 'Chilled', 'Room Temp', 'Straight Up'] as const).map(chip => {
                          const active = item.manual_notes === chip;
                          return (
                            <button
                              key={chip}
                              type="button"
                              className={`px-2 py-1 rounded-full border text-xs transition-all ${active ? 'bg-blue-600 text-white border-blue-600' : 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100'}`}
                              onClick={() => setItems(prev => prev.map(i =>
                                i.menuItem.id === item.menuItem.id
                                  ? { ...i, manual_notes: active ? '' : chip }
                                  : i
                              ))}
                            >
                              {chip}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    /* ── Food: preparation level buttons ── */
                    <div className="mt-2">
                      <div className="text-xs text-gray-700 mb-1">Preparation Level</div>
                      <div className="flex flex-wrap gap-2">
                        {(['rare', 'medium-rare', 'medium', 'medium-well', 'well-done', 'n/a'] as const).map(opt => (
                          <button
                            key={opt}
                            type="button"
                            className={`px-2 py-1 rounded border text-xs ${item.preparation_level === opt ? 'bg-purple-600 text-white border-purple-600' : 'bg-white hover:bg-muted/50'}`}
                            onClick={() => setItems(prev => prev.map(i => i.menuItem.id === item.menuItem.id ? { ...i, preparation_level: opt } : i))}
                            aria-pressed={item.preparation_level === opt ? "true" : "false"}
                          >
                            {opt.replace('-', ' ')}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="mt-3">
                    <button
                      type="button"
                      className="text-xs px-3 py-1 rounded border bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
                      onClick={() => {
                        const cur = item.manual_notes || '';
                        const next = cur; // toggle visibility handled via local state below
                        setItems(prev => prev.map(i => i.menuItem.id === item.menuItem.id ? { ...i, manual_notes: next } : i))
                        const el = document.getElementById(`notes-${item.menuItem.id}`);
                        if (el) { try { (el as HTMLTextAreaElement).focus(); } catch (e) { console.error('[OrderModal] Focus error:', e); } }
                      }}
                    >
                      Add Special Instructions / Extras
                    </button>
                    <label htmlFor={`notes-${item.menuItem.id}`} className="sr-only">Special Instructions</label>
                    <div className="mt-2">
                      <textarea
                        id={`notes-${item.menuItem.id}`}
                        className="w-full text-sm p-2 border rounded"
                        rows={2}
                        placeholder="e.g., Extra side of chips, No onions, Sauce on the side"
                        value={item.manual_notes || ''}
                        onChange={(e) => {
                          const val = e.target.value.slice(0, 500);
                          setItems(prev => prev.map(i => i.menuItem.id === item.menuItem.id ? { ...i, manual_notes: val } : i))
                        }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="border-t pt-4 mt-auto">
              {/* Dynamic Tax Breakdown */}
              <div className="space-y-1 mb-4 text-sm border-b pb-3">
                <div className="flex justify-between text-gray-600">
                  <span>Subtotal:</span>
                  <span>{formatCurrency(total / (1 + posSettings.vat_rate))}</span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>VAT ({posSettings.vat_rate * 100}%):</span>
                  <span>{formatCurrency(total - (total / (1 + posSettings.vat_rate)))}</span>
                </div>
                {posSettings.service_charge > 0 && (
                  <div className="flex justify-between text-gray-600">
                    <span>Service Charge:</span>
                    <span>{formatCurrency(total * posSettings.service_charge)}</span>
                  </div>
                )}
              </div>

              <div className="flex justify-between text-2xl font-bold mb-4">
                <span>Total:</span>
                <span className="text-purple-600">{formatCurrency(total * (1 + posSettings.service_charge))}</span>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={onClose} className="flex-1">Cancel</Button>

                {/* Process Payment — visible for both new and existing orders.
                    Bar items (drinks) often don't need a kitchen ticket; staff can
                    select items and go straight to payment. For a new order this
                    saves the order first so it appears in shift history. */}
                {items.length > 0 && onPayment && (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      const finalTotal = total * (1 + posSettings.service_charge);
                      const vatAmount = total - (total / (1 + posSettings.vat_rate));
                      const scAmount = total * posSettings.service_charge;
                      const billId = bill?.id || `bill-${Date.now()}`;

                      // For a brand-new order, persist it first so it appears in
                      // shift reports (fire-and-forget — payment modal opens immediately)
                      if (!bill) {
                        onSave({
                          id: billId,
                          tableId: `t${tableNumber}`,
                          items,
                          status: 'open',
                          createdAt: new Date().toISOString(),
                          total: finalTotal,
                          shift_id: activeShift?.id,
                          user_id: user?.id,
                          vat_amount: vatAmount,
                          service_charge_amount: scAmount
                        });
                      }

                      onPayment({
                        id: billId,
                        tableId: `t${tableNumber}`,
                        items: items.map(item => ({
                          name: item.menuItem?.name || 'Unknown Item',
                          quantity: item.quantity,
                          price: item.menuItem?.price || 0,
                          subtotal: item.subtotal
                        })),
                        total: finalTotal,
                        customerName: bill?.customerName,
                        roomNumber: bill?.roomNumber
                      });
                    }}
                    className="flex-1"
                  >
                    Process Payment
                  </Button>
                )}

                <Button
                  onClick={() => {
                    const finalTotal = total * (1 + posSettings.service_charge);
                    const vatAmount = total - (total / (1 + posSettings.vat_rate));
                    const scAmount = total * posSettings.service_charge;

                    // Mark all current items as committed — PIN required to remove them later
                    setCommittedItemIds(new Set(items.map(i => i.menuItem.id)));

                    onSave({
                      id: bill?.id || `bill-${Date.now()}`,
                      tableId: `t${tableNumber}`,
                      items,
                      status: 'open',
                      createdAt: new Date().toISOString(),
                      total: finalTotal,
                      shift_id: activeShift?.id,
                      user_id: user?.id,
                      vat_amount: vatAmount,
                      service_charge_amount: scAmount
                    });

                    toast({ title: 'Order saved', description: 'Items are now committed — manager PIN required for modifications.' });
                    onClose();
                  }}
                  className="flex-1"
                  disabled={items.length === 0}
                >
                  {bill ? 'Update Order' : 'Send to Kitchen'}
                </Button>
              </div>
            </div>
          </div>
        </div>

      {/* Context Menu Popup */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-white rounded-lg shadow-xl border border-gray-200 py-1 min-w-[160px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 flex items-center gap-2"
            onClick={() => {
              addItem(contextMenu.item);
              setContextMenu(null);
            }}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add to Order
          </button>
          <button
            className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 flex items-center gap-2"
            onClick={() => openItemEdit(contextMenu.item)}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            Edit Item
          </button>
        </div>
      )}

      {/* Quick Add Item Dialog */}
      <Dialog open={showQuickAdd} onOpenChange={setShowQuickAdd}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Quick Add Menu Item</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Item Name</Label>
              <Input
                value={quickAddName}
                onChange={(e) => setQuickAddName(e.target.value)}
                placeholder="e.g., Grilled Chicken"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Selling Price <span className="text-purple-600 font-bold">(shown on POS)</span></Label>
                <Input
                  type="number"
                  value={quickAddPrice}
                  onChange={(e) => setQuickAddPrice(e.target.value)}
                  placeholder="0.00"
                  step="0.01"
                  className="border-purple-300 focus:ring-purple-500"
                />
              </div>
              <div>
                <Label className="text-gray-500">Cost Price <span className="text-[10px] text-gray-400">(internal / hidden from POS)</span></Label>
                <Input
                  type="number"
                  value={quickAddCostPrice}
                  onChange={(e) => setQuickAddCostPrice(e.target.value)}
                  placeholder="0.00"
                  step="0.01"
                  className="border-gray-200"
                />
              </div>
            </div>
            {quickAddPrice && quickAddCostPrice && Number(quickAddPrice) > 0 && (
              <div className="flex items-center gap-3 p-2 rounded bg-gray-50 border text-sm">
                <span className="text-gray-500">GP:</span>
                <span className="font-bold text-green-700">
                  {(((Number(quickAddPrice) - Number(quickAddCostPrice)) / Number(quickAddPrice)) * 100).toFixed(1)}%
                </span>
                <span className="text-gray-400 text-xs">
                  (${(Number(quickAddPrice) - Number(quickAddCostPrice)).toFixed(2)} margin per unit)
                </span>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Unit</Label>
                <Select value={quickAddUnit} onValueChange={setQuickAddUnit}>
                  <SelectTrigger>
                    <SelectValue placeholder="Unit" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pcs">pcs</SelectItem>
                    <SelectItem value="kg">kg</SelectItem>
                    <SelectItem value="g">g</SelectItem>
                    <SelectItem value="l">l</SelectItem>
                    <SelectItem value="ml">ml</SelectItem>
                    <SelectItem value="box">box</SelectItem>
                    <SelectItem value="pkt">pkt</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Category</Label>
                <Select value={quickAddCategory} onValueChange={setQuickAddCategory}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {menuCats.listCategories(activeCategory === 'bar' ? 'Bar' : 'Restaurant').map((cat: any) => (
                      <SelectItem key={cat.category_id} value={cat.category_id}>{cat.category_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Visibility</Label>
                <div className="mt-1">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="w-full justify-start text-left font-normal">
                        {quickAddStations.length > 0 
                          ? `${quickAddStations.length} Stations Selected` 
                          : "Select Stations"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-64 p-2">
                      <div className="space-y-2">
                        {availableStations.map(station => (
                          <div key={station.id} className="flex items-center space-x-2 p-1 hover:bg-slate-50 rounded">
                            <Checkbox 
                              id={`station-${station.id}`}
                              checked={quickAddStations.includes(station.id)}
                              onCheckedChange={(checked) => {
                                if (checked) setQuickAddStations(prev => [...prev, station.id]);
                                else setQuickAddStations(prev => prev.filter(id => id !== station.id));
                              }}
                            />
                            <Label htmlFor={`station-${station.id}`} className="flex-1 cursor-pointer">
                              {station.name}
                            </Label>
                          </div>
                        ))}
                        {availableStations.length === 0 && (
                          <div className="text-xs text-slate-400 p-2 italic">
                            No stations configured
                          </div>
                        )}
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
              <div>
                <Label>Legacy Visibility</Label>
                <Select value={quickAddVisibility} onValueChange={setQuickAddVisibility}>
                  <SelectTrigger>
                    <SelectValue placeholder="Visibility" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="POS Only">POS Only</SelectItem>
                    <SelectItem value="Web Only">Web Only</SelectItem>
                    <SelectItem value="Both">Both</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowQuickAdd(false)}>Cancel</Button>
            <Button onClick={handleQuickAdd} disabled={!quickAddName.trim() || !quickAddPrice}>Add Item</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Item Dialog */}
      <Dialog open={showItemEdit} onOpenChange={setShowItemEdit}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Menu Item</DialogTitle>
          </DialogHeader>
          {editingItem && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Item Name</Label>
                  <Input value={editingItem.name} disabled className="bg-gray-100" />
                </div>
                <div>
                  <Label>Category</Label>
                  <Select value={editItemCategory} onValueChange={setEditItemCategory}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent>
                      {menuCats.listCategories(editingItem.category === 'bar' ? 'Bar' : 'Restaurant').map((cat: any) => (
                        <SelectItem key={cat.category_id} value={cat.category_id}>{cat.category_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label>Selling Price <span className="text-purple-600 font-bold text-[10px]">shown on POS</span></Label>
                  <Input
                    type="number"
                    value={editItemPrice}
                    onChange={(e) => setEditItemPrice(e.target.value)}
                    step="0.01"
                    placeholder="0.00"
                    className="border-purple-300 focus:ring-purple-500"
                  />
                </div>
                <div>
                  <Label className="text-gray-500">Cost Price <span className="text-[10px] text-gray-400">internal only</span></Label>
                  <Input
                    type="number"
                    value={editItemCost}
                    onChange={(e) => setEditItemCost(e.target.value)}
                    step="0.01"
                    placeholder="0.00"
                    className="border-gray-200"
                  />
                </div>
                <div>
                  <Label className="text-green-700">GP%</Label>
                  <Input
                    type="number"
                    value={editItemPrice && editItemCost ? Number(((Number(editItemPrice) - Number(editItemCost)) / Number(editItemPrice) * 100).toFixed(1)) : 0}
                    disabled
                    className="bg-green-50 border-green-200 text-green-800 font-semibold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Unit of Measure</Label>
                  <Input
                    value={editItemUnit}
                    onChange={(e) => setEditItemUnit(e.target.value)}
                    placeholder="e.g., pcs, kg, L"
                  />
                </div>
                <div>
                  <Label>Visibility</Label>
                  <Select value={editItemVis} onValueChange={setEditItemVis}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select visibility" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="POS Only">POS Only</SelectItem>
                      <SelectItem value="Menu">Menu</SelectItem>
                      <SelectItem value="Both">Both</SelectItem>
                      <SelectItem value="Hidden">Hidden</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <Label>Notes</Label>
                <Input
                  value={editItemDesc}
                  onChange={(e) => setEditItemDesc(e.target.value)}
                  placeholder="e.g., Special ingredients, preparation notes"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowItemEdit(false)}>Cancel</Button>
            <Button onClick={saveItemEdit}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manager PIN Authorization Modal — required to remove committed items */}
      <Dialog open={pinModalOpen} onOpenChange={open => { if (!open) { setPinModalOpen(false); setPendingRemoveId(null); setPinError(''); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-700">
              <span>🔐</span> Manager Authorization Required
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-gray-600">
              This item has been committed to the order. A management-level PIN is required to remove it.
            </p>
            <div>
              <Label className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Manager PIN</Label>
              <Input
                type="password"
                value={pinValue}
                onChange={e => { setPinValue(e.target.value); setPinError(''); }}
                onKeyDown={e => { if (e.key === 'Enter') handlePinSubmit(); }}
                placeholder="Enter manager PIN"
                className="mt-1 text-center text-xl tracking-widest"
                autoFocus
              />
              {pinError && <p className="text-xs text-red-500 mt-1">{pinError}</p>}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setPinModalOpen(false); setPendingRemoveId(null); setPinError(''); }}>Cancel</Button>
            <Button variant="destructive" onClick={handlePinSubmit}>Authorize & Remove</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </div>
  );
};
