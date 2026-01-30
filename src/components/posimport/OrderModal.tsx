import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { formatCurrency, getMenuItemsFromPOSStore } from '@/lib/posIntegration';
import menuCats from '@/lib/menuCategories';
import cocktailEng from '@/lib/cocktailEngineering';
import { useToast } from '@/hooks/use-toast';

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
  createdAt: Date;
  total: number;
}

interface OrderModalProps {
  tableNumber: number;
  bill: Bill | null;
  onClose: () => void;
  onSave: (bill: Bill) => void;
  menuItems: MenuItem[];
}

export const OrderModal: React.FC<OrderModalProps> = ({ tableNumber, bill, onClose, onSave, menuItems }) => {
  const [items, setItems] = useState<BillItem[]>(bill?.items || []);
  const [activeCategory, setActiveCategory] = useState<'food' | 'bar'>('food');
  const [dynamicMenu, setDynamicMenu] = useState<MenuItem[]>(() => {
    try {
      if (Array.isArray(menuItems) && menuItems.length) return menuItems;
      const fromStore = getMenuItemsFromPOSStore() as any[];
      return Array.isArray(fromStore) ? fromStore : [];
    } catch {
      return [];
    }
  });
  const [selectedCatId, setSelectedCatId] = useState<string | null>(null);
  const { toast } = useToast();
  const [subTree, setSubTree] = useState<any[]>([]);
  const [subPath, setSubPath] = useState<string[]>([]);

  useEffect(() => {
    const refresh = () => {
      try { setDynamicMenu(getMenuItemsFromPOSStore() as any); } catch (err) { console.error('OrderModal menu refresh failed', err); }
    };
    refresh();
    const iv = setInterval(refresh, 60_000);
    const onStorage = (e: StorageEvent) => { if (e.key === 'corepms_pos_items') refresh(); };
    window.addEventListener('storage', onStorage);
    return () => { clearInterval(iv); window.removeEventListener('storage', onStorage); };
  }, []);

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
  const collectDescendantIds = (node: any | null): Set<string> => {
    const ids = new Set<string>();
    if (!node) return ids;
    const dfs = (n: any) => { ids.add(n.sub_id); (n.children || []).forEach(dfs); };
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
      const res = cocktailEng.decrementIngredientsForCocktail(menuItem.id, 1);
      if (res.alerts.length) toast({ title: 'Low stock', description: res.alerts.join(' • ') });
    } catch {}
  };

  const removeItem = (itemId: string) => {
    setItems(items.filter(i => i.menuItem.id !== itemId));
    try { cocktailEng.restoreIngredientsForCocktail(itemId, 1); } catch {}
  };

  const total = (Array.isArray(items) ? items : []).reduce((sum, item) => sum + item.subtotal, 0);
  const filteredDept = (Array.isArray(dynamicMenu) ? dynamicMenu : []).filter(m => m.category === activeCategory);
  const filteredMenu = filteredDept.filter(m => {
    if (!selectedCatId) return true;
    // Match either explicit category_id or fallback subCategory name
    return (m.category_id && menuCats.getCategoryById(selectedCatId || '')?.category_id === m.category_id)
      || (!!m.subCategory && menuCats.getCategoryById(selectedCatId || '')?.category_name === m.subCategory)
      || (!!m.subCategory && selectedCatId === m.subCategory);
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

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-6xl w-full max-h-[90vh] overflow-hidden">
        <div className="bg-gradient-to-r from-purple-600 to-blue-600 text-white p-6">
          <h2 className="text-3xl font-bold">Table {tableNumber} - Order</h2>
        </div>
        
        <div className="flex h-[calc(90vh-200px)]">
          <div className="w-2/3 p-6 overflow-y-auto border-r">
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

        {/* Category row */}
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

        {/* Sub-category breadcrumb & row */}
        {selectedCatId && String(selectedCatId).startsWith('CAT_') && (
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
            
            <div className="grid grid-cols-3 gap-4">
              {subFilteredMenu.map(item => (
                <div 
                  key={item.id}
                  onClick={() => addItem(item)}
                  className="cursor-pointer bg-white rounded-lg shadow hover:shadow-lg transition-all p-3 border-2 border-transparent hover:border-purple-500"
                >
                  {item.image ? (
                    <img src={item.image} alt={item.name} className="w-full h-24 object-cover rounded mb-2" />
                  ) : (
                    <div className="w-full h-24 rounded mb-2" style={{ backgroundColor: (item as any).imageBgColor || '#ddd' }} />
                  )}
                  <div className="font-semibold text-sm">{item.name}</div>
                  {item.description && (
                    <div className="text-xs text-gray-600 line-clamp-2">{item.description}</div>
                  )}
                  <div className="text-purple-600 font-bold">{formatCurrency(item.price)}</div>
                </div>
              ))}
            </div>
          </div>
          
          <div className="w-1/3 p-6 bg-gray-50 flex flex-col">
            <h3 className="text-xl font-bold mb-4">Order Items</h3>
            <div className="flex-1 overflow-y-auto mb-4">
              {items.map(item => (
                <div key={item.menuItem.id} className="bg-white p-3 rounded-lg mb-2 shadow">
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <div className="font-semibold">{item.menuItem.name}</div>
                      {!!item.preparation_level && item.preparation_level !== 'n/a' && (
                        <div className="text-xs text-gray-600 italic">({
                          item.preparation_level.replace('-', ' ')
                        })</div>
                      )}
                      {!!item.manual_notes && (
                        <div className="text-xs text-gray-500 italic whitespace-pre-line">{item.manual_notes}</div>
                      )}
                      <div className="text-sm text-gray-600 mt-1">{item.quantity} x {formatCurrency(item.menuItem.price)}</div>
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

                  <div className="mt-2">
                    <div className="text-xs text-gray-700 mb-1">Preparation Level</div>
                    <div className="flex flex-wrap gap-2">
                      {(['rare','medium-rare','medium','medium-well','well-done','n/a'] as const).map(opt => (
                        <button
                          key={opt}
                          type="button"
                          className={`px-2 py-1 rounded border text-xs ${item.preparation_level===opt ? 'bg-purple-600 text-white border-purple-600' : 'bg-white hover:bg-muted/50'}`}
                          onClick={() => {
                            setItems(prev => prev.map(i => i.menuItem.id===item.menuItem.id ? { ...i, preparation_level: opt } : i))
                          }}
                          aria-pressed={item.preparation_level===opt}
                        >
                          {opt.replace('-', ' ')}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="mt-3">
                    <button
                      type="button"
                      className="text-xs px-3 py-1 rounded border bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
                      onClick={() => {
                        const cur = item.manual_notes || '';
                        const next = cur; // toggle visibility handled via local state below
                        setItems(prev => prev.map(i => i.menuItem.id===item.menuItem.id ? { ...i, manual_notes: next } : i))
                        const el = document.getElementById(`notes-${item.menuItem.id}`);
                        if (el) { try { (el as HTMLTextAreaElement).focus(); } catch {} }
                      }}
                    >
                      Add Special Instructions / Extras
                    </button>
                    <div className="mt-2">
                      <textarea
                        id={`notes-${item.menuItem.id}`}
                        className="w-full text-sm p-2 border rounded"
                        rows={2}
                        placeholder="e.g., Extra side of chips, No onions, Sauce on the side"
                        value={item.manual_notes || ''}
                        onChange={(e) => {
                          const val = e.target.value.slice(0, 500);
                          setItems(prev => prev.map(i => i.menuItem.id===item.menuItem.id ? { ...i, manual_notes: val } : i))
                        }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            
            <div className="border-t pt-4 mt-auto">
              <div className="flex justify-between text-2xl font-bold mb-4">
                <span>Total:</span>
                <span className="text-purple-600">{formatCurrency(total)}</span>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
                <Button 
                  onClick={() => {
                    onSave({
                      id: bill?.id || `bill-${Date.now()}`,
                      tableId: `t${tableNumber}`,
                      items,
                      status: 'open',
                      createdAt: new Date(),
                      total
                    });
                    onClose();
                  }}
                  className="flex-1"
                >
                  Save Order
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
