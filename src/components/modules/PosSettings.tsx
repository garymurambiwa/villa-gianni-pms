import React from 'react';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { createAuditEntry, formatCurrency } from '@/lib/posIntegration';
import { useToast } from '@/hooks/use-toast';
import { canManagePOS, canEditStockItem, canFixStockItem, canDeleteStockItem, canImportStockCSV, canExportIssuesCSV, canExportStockCSV, canDownloadTemplate, isAdmin } from '@/lib/permissions';
import InventoryItemsButton from '@/components/modules/InventoryItemsButton';
import { useHotkeys } from '@/contexts/HotkeysContext';
import menuCats from '@/lib/menuCategories';
import CocktailEngineering from '@/components/modules/CocktailEngineering';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import StockTab from '@/components/modules/StockTab';
import ReceiptSettingsModal from '@/components/modules/ReceiptSettingsModal';
import HorizontalScrollNav from '@/components/ui/HorizontalScrollNav';
import { Label } from '@/components/ui/label';
import { db } from '@/lib/db';
import { parseColor, getContrastRatio } from '@/lib/colorUtils';
import { syncPosItemToDb, deletePosItemFromDb, performFullSync } from '@/lib/dbSync';
import vendors from '@/lib/vendors';

const defaultPalette = [
  '#4f46e5',
  '#3b82f6',
  '#ef4444',
  '#10b981',
  '#f59e0b',
  '#8b5cf6',
  '#06b6d4',
  '#f97316',
  '#ec4899',
  '#6b7280',
  '#000000',
  '#ffffff'
];

const isColorValid = (c: string) => !!parseColor(c);
const contrastRatio = (bg: string, fg: string) => {
  const b = parseColor(bg);
  const f = parseColor(fg);
  if (!b || !f) return 1;
  return getContrastRatio(b.rgb, f.rgb);
};
const isAccessible = (bg: string, fg: string) => contrastRatio(bg, fg) >= 4.5;

const Section: React.FC<{ title: string; id?: string; children: React.ReactNode }> = ({ title, id, children }) => (
  <div id={id} className="p-4 border rounded">
    <div className="font-semibold mb-2">{title}</div>
    <div className="space-y-4 text-sm">{children}</div>
  </div>
);

const MenuCategoriesPanel: React.FC = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [name, setName] = React.useState('');
  const [dept, setDept] = React.useState<'Bar' | 'Restaurant'>('Bar');
  const [sort, setSort] = React.useState<number>(0);
  const [btnColor, setBtnColor] = React.useState<string>('#4f46e5');
  const [txtColor, setTxtColor] = React.useState<string>('#ffffff');
  const [filterDept, setFilterDept] = React.useState<'All' | 'Bar' | 'Restaurant'>('All');
  const [rows, setRows] = React.useState(menuCats.listCategories());
  const [editing, setEditing] = React.useState<Record<string, { name: string; sort_order: number; buttonColor?: string; textColor?: string }>>({});

  const reload = () => setRows(menuCats.listCategories());

  const logAudit = (action: string, details?: Record<string, any>) => {
    try {
      const entry = createAuditEntry(action, 'ADMIN', user?.id || 'unknown', 'server-1', details);
      const raw = localStorage.getItem('corepms_pos_audit');
      const list = raw ? JSON.parse(raw) : [];
      const next = [entry, ...list].slice(0, 200);
      localStorage.setItem('corepms_pos_audit', JSON.stringify(next));
    } catch { }
  };

  const add = () => {
    if (!name.trim()) { toast({ title: 'Name required', description: 'Enter category name' }); return; }
    if (!isColorValid(btnColor) || !isColorValid(txtColor)) { toast({ title: 'Invalid color', description: 'Use valid hex, rgb(), or hsl() color.' }); return; }
    if (!isAccessible(btnColor, txtColor)) { toast({ title: 'Low contrast', description: 'Choose colors meeting WCAG AA contrast (≥4.5).' }); return; }
    try {
      const row = menuCats.addCategory({ category_name: name.trim(), department: dept, sort_order: sort, buttonColor: btnColor, textColor: txtColor });
      logAudit('POS_CATEGORY_CREATE', row as any);
      setName(''); setSort(0); reload();
    } catch (err) { toast({ title: 'Failed to add category', description: String(err) }); }
  };

  const seedDefaults = () => {
    try {
      const existing = menuCats.listCategories();
      const has = (name: string, dept: 'Bar' | 'Restaurant') => existing.some(c => c.category_name.toLowerCase() === name.toLowerCase() && c.department === dept);
      const toAdd: { name: string; dept: 'Bar' | 'Restaurant'; sort: number }[] = [
        // Bar
        { name: 'Cocktails', dept: 'Bar', sort: 10 },
        { name: 'Beers', dept: 'Bar', sort: 20 },
        { name: 'Wines', dept: 'Bar', sort: 30 },
        { name: 'Spirits', dept: 'Bar', sort: 40 },
        { name: 'Non-Alcoholic', dept: 'Bar', sort: 50 },
        // Restaurant
        { name: 'Appetizers', dept: 'Restaurant', sort: 10 },
        { name: 'Salads', dept: 'Restaurant', sort: 20 },
        { name: 'Mains', dept: 'Restaurant', sort: 30 },
        { name: 'Sides', dept: 'Restaurant', sort: 40 },
        { name: 'Desserts', dept: 'Restaurant', sort: 50 },
      ];
      let added = 0;
      toAdd.forEach(({ name, dept, sort }) => { if (!has(name, dept)) { menuCats.addCategory({ category_name: name, department: dept, sort_order: sort }); added++; } });
      logAudit('POS_CATEGORY_SEED_DEFAULTS', { added });
      reload();
      toast({ title: 'Seeded default categories', description: `${added} new categories added.` });
    } catch (err) {
      toast({ title: 'Failed to seed categories', description: String(err) });
    }
  };

  const saveRow = (id: string) => {
    const orig = rows.find(r => r.category_id === id);
    const edit = editing[id];
    if (!orig || !edit) return;
    if ((edit.buttonColor || orig.buttonColor) && (edit.textColor || orig.textColor)) {
      const bg = edit.buttonColor || orig.buttonColor || '';
      const fg = edit.textColor || orig.textColor || '';
      if (!isColorValid(bg) || !isColorValid(fg)) { toast({ title: 'Invalid color', description: 'Use valid hex, rgb(), or hsl() color.' }); return; }
      if (!isAccessible(bg, fg)) { toast({ title: 'Low contrast', description: 'WCAG AA contrast (≥4.5) not met.' }); return; }
    }
    try {
      const updated = { ...orig, category_name: edit.name, sort_order: edit.sort_order, buttonColor: edit.buttonColor ?? orig.buttonColor, textColor: edit.textColor ?? orig.textColor };
      const next = rows.map(r => r.category_id === id ? updated : r);
      menuCats.setCategories(next);
      logAudit('POS_CATEGORY_UPDATE', updated as any);
      setEditing(prev => { const n = { ...prev }; delete n[id]; return n; });
      reload();
    } catch (err) { toast({ title: 'Failed to update category', description: String(err) }); }
  };

  const delRow = (id: string) => {
    try {
      const next = rows.filter(r => r.category_id !== id);
      menuCats.setCategories(next);
      logAudit('POS_CATEGORY_DELETE', { id });
      reload();
    } catch (err) { toast({ title: 'Failed to delete category', description: String(err) }); }
  };

  const list = filterDept === 'All' ? rows : rows.filter(r => r.department === filterDept);

  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
        <div>
          <label className="text-xs">Category name</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Cocktails" />
        </div>
        <div>
          <label className="text-xs">Department</label>
          <Select value={dept} onValueChange={(v) => setDept(v as any)}>
            <SelectTrigger>
              <SelectValue placeholder="Select" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Bar">Bar</SelectItem>
              <SelectItem value="Restaurant">Restaurant</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs">Sort order</label>
          <Input type="number" value={sort} onChange={(e) => setSort(Number(e.target.value) || 0)} />
        </div>
        <div className="flex items-end">
          <Button className="bg-indigo-600 text-white" onClick={add}>Add Category</Button>
        </div>
      </div>

      <div className="mt-2">
        <Button variant="outline" onClick={seedDefaults}>Seed Default Categories</Button>
      </div>

      <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2 items-end">
        <div>
          <label className="text-xs">Button color</label>
          <div className="flex items-center gap-2">
            <input type="color" value={(parseColor(btnColor)?.hex) || '#4f46e5'} onChange={(e) => setBtnColor(e.target.value)} />
            <Input placeholder="#4f46e5 or rgb() or hsl()" value={btnColor} onChange={(e) => setBtnColor(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="text-xs">Text color</label>
          <div className="flex items-center gap-2">
            <input type="color" value={(parseColor(txtColor)?.hex) || '#ffffff'} onChange={(e) => setTxtColor(e.target.value)} />
            <Input placeholder="#ffffff or rgb() or hsl()" value={txtColor} onChange={(e) => setTxtColor(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="text-xs">Palette</label>
          <div className="flex flex-wrap gap-2">
            {defaultPalette.map(c => (
              <button key={c} className="w-6 h-6 rounded border" style={{ backgroundColor: c }} title={c} onClick={() => setBtnColor(c)} />
            ))}
          </div>
        </div>
      </div>
      <div className="mt-2 text-xs">Contrast: <span className={isAccessible(btnColor, txtColor) ? 'text-green-700' : 'text-red-700'}>{contrastRatio(btnColor, txtColor).toFixed(2)} {isAccessible(btnColor, txtColor) ? 'OK' : 'LOW'}</span></div>
      <div className="mt-2">
        <button className="px-4 py-2 rounded border" style={{ backgroundColor: btnColor, color: txtColor }}>Preview Button</button>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <label className="text-xs">Filter</label>
        <Select value={filterDept} onValueChange={(v) => setFilterDept(v as any)}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Department" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="All">All</SelectItem>
            <SelectItem value="Bar">Bar</SelectItem>
            <SelectItem value="Restaurant">Restaurant</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="text-sm w-full">
          <thead><tr><th className="p-2 text-left">Name</th><th className="p-2">Department</th><th className="p-2">Sort</th><th className="p-2">Colors</th><th className="p-2">Actions</th></tr></thead>
          <tbody>
            {list.map(r => {
              const draft = editing[r.category_id] ?? { name: r.category_name, sort_order: r.sort_order ?? 0, buttonColor: r.buttonColor, textColor: r.textColor };
              const isEditing = !!editing[r.category_id];
              return (
                <tr key={r.category_id}>
                  <td className="p-2">
                    {isEditing ? (
                      <Input value={draft.name} onChange={(e) => setEditing(prev => ({ ...prev, [r.category_id]: { ...draft, name: e.target.value } }))} />
                    ) : (
                      r.category_name
                    )}
                  </td>
                  <td className="p-2">{r.department}</td>
                  <td className="p-2">
                    {isEditing ? (
                      <Input type="number" value={draft.sort_order} onChange={(e) => setEditing(prev => ({ ...prev, [r.category_id]: { ...draft, sort_order: Number(e.target.value) || 0 } }))} />
                    ) : (
                      r.sort_order ?? 0
                    )}
                  </td>
                  <td className="p-2">
                    <div className="flex items-center gap-2">
                      <input type="color" value={(parseColor(draft.buttonColor || '')?.hex) || (r.buttonColor || '#4f46e5')} onChange={(e) => setEditing(prev => ({ ...prev, [r.category_id]: { ...draft, buttonColor: e.target.value } }))} />
                      <input type="color" value={(parseColor(draft.textColor || '')?.hex) || (r.textColor || '#ffffff')} onChange={(e) => setEditing(prev => ({ ...prev, [r.category_id]: { ...draft, textColor: e.target.value } }))} />
                      <button className="px-3 py-1 rounded border" style={{ backgroundColor: draft.buttonColor || r.buttonColor || '#4f46e5', color: draft.textColor || r.textColor || '#ffffff' }}>Preview</button>
                    </div>
                    <div className="text-[11px] mt-1">Contrast: <span className={(draft.buttonColor || r.buttonColor) && (draft.textColor || r.textColor) && isAccessible(draft.buttonColor || r.buttonColor || '', draft.textColor || r.textColor || '') ? 'text-green-700' : 'text-red-700'}>{((draft.buttonColor || r.buttonColor) && (draft.textColor || r.textColor)) ? contrastRatio(draft.buttonColor || r.buttonColor || '', draft.textColor || r.textColor || '').toFixed(2) : '—'}</span></div>
                  </td>
                  <td className="p-2">
                    {isEditing ? (
                      <div className="flex items-center gap-2">
                        <Button variant="outline" onClick={() => saveRow(r.category_id)}>Save</Button>
                        <Button variant="outline" onClick={() => setEditing(prev => { const n = { ...prev }; delete n[r.category_id]; return n; })}>Cancel</Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <Button variant="outline" onClick={() => setEditing(prev => ({ ...prev, [r.category_id]: draft }))}>Edit</Button>
                        <Button variant="destructive" onClick={() => delRow(r.category_id)}>Delete</Button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const SubCategoriesPanel: React.FC = () => {
  const { toast } = useToast();
  const [deptFilter, setDeptFilter] = React.useState<'All' | 'Bar' | 'Restaurant'>('All');
  const [name, setName] = React.useState('');
  const [categoryId, setCategoryId] = React.useState<string>('');
  const [parentSubId, setParentSubId] = React.useState<string>('none');
  const [description, setDescription] = React.useState('');
  const [sort, setSort] = React.useState<number>(0);
  const [editing, setEditing] = React.useState<Record<string, { name: string; description?: string; sort_order?: number }>>({});

  const cats = React.useMemo(() => deptFilter === 'All' ? menuCats.listCategories() : menuCats.listCategories(deptFilter as any), [deptFilter]);
  const subTreeByCat = React.useMemo(() => {
    const map = new Map<string, ReturnType<typeof menuCats.listSubTreeByCategory>>();
    cats.forEach(c => map.set(c.category_id, menuCats.listSubTreeByCategory(c.category_id)));
    return map;
  }, [cats]);

  const add = () => {
    if (!name.trim()) { toast({ title: 'Name required', description: 'Enter sub-category name' }); return; }
    if (!categoryId) { toast({ title: 'Select category', description: 'Choose a parent category' }); return; }
    try {
      menuCats.addSubcategory({ name: name.trim(), category_id: categoryId, parent_sub_id: (parentSubId && parentSubId !== 'none') ? parentSubId : undefined, description, sort_order: sort });
      setName(''); setDescription(''); setSort(0);
      toast({ title: 'Sub-category added' });
    } catch (err) {
      toast({ title: 'Failed to add', description: String(err) });
    }
  };

  React.useEffect(() => {
    // Reset parent sub-category when category changes
    setParentSubId('none');
  }, [categoryId]);

  const saveRow = (subId: string) => {
    const draft = editing[subId];
    if (!draft) return;
    const orig = menuCats.getSubcategoryById(subId);
    if (!orig) return;
    try {
      menuCats.updateSubcategory({ ...orig, name: draft.name, description: draft.description, sort_order: draft.sort_order });
      setEditing(prev => { const n = { ...prev }; delete n[subId]; return n; });
      toast({ title: 'Saved changes' });
    } catch (err) { toast({ title: 'Failed to save', description: String(err) }); }
  };

  const delRow = (subId: string) => {
    try { menuCats.deleteSubcategory(subId); toast({ title: 'Deleted sub-category' }); }
    catch (err) { toast({ title: 'Failed to delete', description: String(err) }); }
  };

  const renderTree = (nodes: any[], depth = 0) => (
    nodes.map(n => {
      const d = editing[n.sub_id] ?? { name: n.name, description: n.description, sort_order: n.sort_order };
      const isEditing = !!editing[n.sub_id];
      return (
        <tr key={n.sub_id}>
          <td className="p-2">{Array(depth).fill(0).map((_, i) => <span key={i} className="inline-block w-4" />)}
            {isEditing ? (
              <Input value={d.name} onChange={(e) => setEditing(prev => ({ ...prev, [n.sub_id]: { ...d, name: e.target.value } }))} />
            ) : (
              n.name
            )}
          </td>
          <td className="p-2">{isEditing ? (
            <Textarea value={d.description || ''} onChange={(e) => setEditing(prev => ({ ...prev, [n.sub_id]: { ...d, description: e.target.value } }))} />
          ) : (n.description || '—')}</td>
          <td className="p-2">{isEditing ? (
            <Input type="number" value={Number(d.sort_order || 0)} onChange={(e) => setEditing(prev => ({ ...prev, [n.sub_id]: { ...d, sort_order: Number(e.target.value) || 0 } }))} />
          ) : (n.sort_order ?? 0)}</td>
          <td className="p-2">
            {isEditing ? (
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={() => saveRow(n.sub_id)}>Save</Button>
                <Button variant="outline" onClick={() => setEditing(prev => { const nn = { ...prev }; delete nn[n.sub_id]; return nn; })}>Cancel</Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={() => setEditing(prev => ({ ...prev, [n.sub_id]: d }))}>Edit</Button>
                <Button variant="destructive" onClick={() => delRow(n.sub_id)}>Delete</Button>
              </div>
            )}
          </td>
        </tr>
      );
    }).concat(nodes.flatMap((n: any) => renderTree(n.children, depth + 1)))
  );

  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
        <div>
          <label className="text-xs font-medium">Name</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Classic Cocktails" />
        </div>
        <div>
          <label className="text-xs font-medium">Category</label>
          <Select value={categoryId || undefined} onValueChange={(v) => setCategoryId(v)}>
            <SelectTrigger>
              <SelectValue placeholder="Select category" />
            </SelectTrigger>
            <SelectContent>
              {menuCats.listCategories().map(c => (<SelectItem key={c.category_id} value={c.category_id}>{c.category_name}</SelectItem>))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs font-medium">Parent sub-category</label>
          <Select value={parentSubId} onValueChange={(v) => setParentSubId(v)} disabled={!categoryId}>
            <SelectTrigger>
              <SelectValue placeholder={categoryId ? 'Optional' : 'Select category first'} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {categoryId && menuCats.listSubcategories(categoryId).map(s => (<SelectItem key={s.sub_id} value={s.sub_id}>{s.name}</SelectItem>))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs font-medium">Sort</label>
          <Input type="number" value={sort} onChange={(e) => setSort(Number(e.target.value) || 0)} />
        </div>
        <div className="flex items-end">
          <Button className="bg-indigo-600 text-white" onClick={add}>Add Sub-category</Button>
        </div>
        <div className="md:col-span-5">
          <label className="text-xs font-medium">Description</label>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional description" />
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <label className="text-xs">Filter</label>
        <Select value={deptFilter} onValueChange={(v) => setDeptFilter(v as any)}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Department" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="All">All</SelectItem>
            <SelectItem value="Bar">Bar</SelectItem>
            <SelectItem value="Restaurant">Restaurant</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="text-sm w-full">
          <thead><tr><th className="p-2 text-left">Sub-category</th><th className="p-2">Description</th><th className="p-2">Sort</th><th className="p-2">Actions</th></tr></thead>
          <tbody>
            {cats.map(c => (
              <React.Fragment key={c.category_id}>
                <tr>
                  <td className="p-2 font-semibold" colSpan={4}>{c.category_name} <span className="text-xs text-gray-600">({c.department})</span></td>
                </tr>
                {renderTree(subTreeByCat.get(c.category_id) || [])}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
export const PosSettings: React.FC = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const isManager = canManagePOS(user?.role);
  const isAdminRole = isAdmin(user?.role);
  const logSettingsError = (step: string, error: any, ctx?: any) => {
    try {
      const entry = { step, error: String((error && (error.message || error)) || 'Unknown'), ctx, at: new Date().toISOString() };
      const raw = localStorage.getItem('corepms_payment_errors');
      const list = raw ? JSON.parse(raw) : [];
      localStorage.setItem('corepms_payment_errors', JSON.stringify([entry, ...list].slice(0, 500)));
    } catch { }
  };
  const requireManager = (action: string, fn?: () => void) => {
    if (!isManager) {
      toast({ title: 'Permission denied', description: 'This action requires manager or admin role.', duration: 2500 });
      log('ACTION_DENIED', { action, user: user?.id, role: user?.role });
      return;
    }
    fn?.();
  };

  const log = (action: string, details?: Record<string, any>) => {
    try {
      const entry = createAuditEntry(action, 'ADMIN', user?.id || 'unknown', 'server-1', details);
      const raw = localStorage.getItem('corepms_pos_audit');
      const list = raw ? JSON.parse(raw) : [];
      const next = [entry, ...list].slice(0, 200);
      localStorage.setItem('corepms_pos_audit', JSON.stringify(next));
    } catch { }
  };

  // Vendor creation handler
  const handleAddVendor = () => {
    if (!vendorName.trim()) {
      toast({ title: 'Validation Error', description: 'Vendor name is required', variant: 'destructive' });
      return;
    }

    try {
      const newVendor = vendors.addVendor(vendorName.trim(), 'USD', vendorTerms.trim() || 'Net 30');
      log('VENDOR_CREATE', { vendorId: newVendor.id, vendorName: newVendor.name });
      toast({ title: 'Success', description: `Vendor "${newVendor.name}" created successfully` });

      // Reset form
      setVendorName('');
      setVendorTerms('');
    } catch (error) {
      console.error('Failed to create vendor:', error);
      toast({ title: 'Error', description: 'Failed to create vendor', variant: 'destructive' });
    }
  };

  React.useEffect(() => { if (!isManager && !isAdminRole) return; log('OPEN_POS_SETTINGS'); return () => log('CLOSE_POS_SETTINGS'); }, [isManager, isAdminRole]);
  const [activeTab, setActiveTab] = React.useState<'admin' | 'menu' | 'stock' | 'purchasing'>('admin');
  const [activeSectionId, setActiveSectionId] = React.useState<string>('');
  const [showReceiptModal, setShowReceiptModal] = React.useState<boolean>(false);
  // Vendor state
  const [vendorName, setVendorName] = React.useState('');
  const [vendorTerms, setVendorTerms] = React.useState('');

  // Tab label mapping and anchors per tab for breadcrumb/quick jumps
  const tabLabels: Record<'admin' | 'menu' | 'stock' | 'purchasing', string> = {
    admin: 'System Administration & Users',
    menu: 'Menu & Recipe Configuration',
    stock: 'Stock & Inventory Control',
    purchasing: 'Purchasing & Suppliers',
  };
  const tabAnchors: Record<'admin' | 'menu' | 'stock' | 'purchasing', Array<{ id: string; label: string }>> = {
    admin: [
      { id: 'receipt-branding', label: 'Receipt Branding & Contact Info' },
      { id: 'pos-reporting-tools', label: 'POS Reporting Tools' },
      { id: 'data-migration', label: 'Data Migration' },
      { id: 'category-gaps', label: 'Category Gaps' },
      { id: 'pos-user-rights', label: 'POS User Rights Management' },
    ],
    menu: [
      { id: 'menu-categories', label: 'Menu Categories' },
      { id: 'sub-categories', label: 'Sub-Categories' },
      { id: 'cocktail-engineering', label: 'Cocktail Engineering' },
    ],
    stock: [
      { id: 'stock-list', label: 'Stock List' },
      { id: 'stock-controls', label: 'Stock Management Controls' },
      { id: 'inventory-control', label: 'Inventory Control' },
      { id: 'stock-level-monitoring', label: 'Stock Level Monitoring' },
      { id: 'printing-quick-updates', label: 'Print/Quick Updates' },
      { id: 'adjust-stock-quantities', label: 'Adjust Stock Quantities' },
    ],
    purchasing: [
      { id: 'purchasing-config', label: 'Purchasing Configuration' },
      { id: 'suppliers', label: 'Suppliers' },
    ],
  };

  const navigateToAnchor = React.useCallback((anchorId: string) => {
    try {
      const el = document.getElementById(anchorId);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch { }
  }, []);

  // Initialize tab from URL or localStorage; persist and deep-link on changes
  React.useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const q = String(params.get('tab') || '').trim();
      const stored = localStorage.getItem('corepms_pos_settings_tab');
      const init = (q === 'admin' || q === 'menu' || q === 'stock' || q === 'purchasing') ? (q as any) : (stored as any) || 'admin';
      setActiveTab(init);
      const anchor = String(params.get('anchor') || '').trim();
      const anchors = tabAnchors[init];
      const fallback = anchors.length ? anchors[0].id : '';
      setActiveSectionId(anchor || fallback);
    } catch { }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    try {
      localStorage.setItem('corepms_pos_settings_tab', activeTab);
      const url = new URL(window.location.href);
      url.searchParams.set('tab', activeTab);
      // reset section to the first for the new tab
      const anchors = tabAnchors[activeTab];
      const nextSection = anchors.length ? anchors[0].id : '';
      setActiveSectionId(nextSection);
      url.searchParams.set('anchor', nextSection);
      window.history.replaceState({}, '', url.toString());
    } catch { }
  }, [activeTab]);

  // Keyboard shortcuts: Ctrl+1..4 to switch tabs quickly
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.shiftKey && !e.altKey) {
        if (e.key === '1') setActiveTab('admin');
        else if (e.key === '2') setActiveTab('menu');
        else if (e.key === '3') setActiveTab('stock');
        else if (e.key === '4') setActiveTab('purchasing');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Stock item modal state
  const [stockOpen, setStockOpen] = React.useState(false);
  const [inventoryControlOpen, setInventoryControlOpen] = React.useState(false);
  const [itemName, setItemName] = React.useState('');
  const [qtyReceived, setQtyReceived] = React.useState<number>(0);
  const [qtyInStock, setQtyInStock] = React.useState<number>(0);
  const [unitOfMeasure, setUnitOfMeasure] = React.useState<string>('');
  const [inventoryCategory, setInventoryCategory] = React.useState<'kitchen' | 'cellar' | ''>('');
  const [costPrice, setCostPrice] = React.useState<number>(0);
  const [sellingPrice, setSellingPrice] = React.useState<number>(0);
  const [costCenter, setCostCenter] = React.useState<'bar' | 'restaurant' | ''>('');
  const [categoryId, setCategoryId] = React.useState<string>('');
  const [subId, setSubId] = React.useState<string>('none');
  const [barVisible, setBarVisible] = React.useState<boolean>(false);
  const [restaurantVisible, setRestaurantVisible] = React.useState<boolean>(false);
  const [cosPercent, setCosPercent] = React.useState<number>(0);
  const [pictureFile, setPictureFile] = React.useState<File | null>(null);
  const [picturePreview, setPicturePreview] = React.useState<string>('');
  const [imageBgColor, setImageBgColor] = React.useState<string>('#cccccc');
  const [barcode, setBarcode] = React.useState<string>('');
  const [scannedCodes, setScannedCodes] = React.useState<string[]>([]);
  const [notes, setNotes] = React.useState('');
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [focusField, setFocusField] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (stockOpen && focusField) {
      const el = document.getElementById(focusField);
      if (el) {
        try { (el as HTMLInputElement).focus(); } catch { }
      }
    }
  }, [stockOpen, focusField]);

  const gpAmount = React.useMemo(() => Number((sellingPrice - costPrice).toFixed(2)), [sellingPrice, costPrice]);
  const gpPercent = React.useMemo(() => sellingPrice > 0 ? Number(((gpAmount / sellingPrice) * 100).toFixed(2)) : 0, [gpAmount, sellingPrice]);
  const computedCOS = React.useMemo(() => {
    if (sellingPrice <= 0) return 0;
    const val = (costPrice / sellingPrice) * 100;
    return Number.isFinite(val) ? Number(val.toFixed(2)) : 0;
  }, [costPrice, sellingPrice]);

  React.useEffect(() => {
    try {
      setCosPercent(computedCOS);
    } catch { }
  }, [computedCOS]);

  // Clear sub-category if category changes
  React.useEffect(() => {
    setSubId('none');
  }, [categoryId]);

  const [items, setItems] = React.useState<any[]>([]);
  const [showPinModal, setShowPinModal] = React.useState(false);
  const [pinCurrent, setPinCurrent] = React.useState('');
  const [pinNew, setPinNew] = React.useState('');
  const [pinConfirm, setPinConfirm] = React.useState('');
  const [pinScope, setPinScope] = React.useState<'void'>('void');
  const [pinVerified, setPinVerified] = React.useState(false);
  const [pinBusy, setPinBusy] = React.useState(false);
  const [pinMsg, setPinMsg] = React.useState('');
  const [pinErr, setPinErr] = React.useState('');
  const [hasExistingPin, setHasExistingPin] = React.useState<boolean>(true);
  const isValidPin = React.useMemo(() => /^\d{6,8}$/.test(pinNew) && pinNew === pinConfirm, [pinNew, pinConfirm]);
  const makeSalt = () => { const arr = new Uint8Array(16); (window.crypto || crypto).getRandomValues(arr); return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join(''); };
  const hashPin = async (pin: string, salt: string) => { const data = new TextEncoder().encode(salt + pin); const dig = await (window.crypto || crypto).subtle.digest('SHA-256', data); const bytes = Array.from(new Uint8Array(dig)); return bytes.map(b => b.toString(16).padStart(2, '0')).join(''); };
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const stockSectionRef = React.useRef<HTMLDivElement>(null);
  const [searchTerm, setSearchTerm] = React.useState('');
  const [centerFilter, setCenterFilter] = React.useState<'all' | 'bar' | 'restaurant'>('all');
  const [barFilter, setBarFilter] = React.useState<boolean>(false);
  const [restaurantFilter, setRestaurantFilter] = React.useState<boolean>(false);
  const [sortKey, setSortKey] = React.useState<'name' | 'price' | 'gp'>('name');
  const [sortDir, setSortDir] = React.useState<'asc' | 'desc'>('asc');
  const [attentionOnly, setAttentionOnly] = React.useState<boolean>(false);
  const [quickFilter, setQuickFilter] = React.useState<'all' | 'low' | 'bar' | 'restaurant'>('all');
  const [lowStockThreshold, setLowStockThreshold] = React.useState<number>(() => {
    try {
      const raw = localStorage.getItem('corepms_inventory_threshold');
      const n = raw ? Number(raw) : 5;
      return Number.isFinite(n) && n >= 0 ? n : 5;
    } catch { return 5; }
  });
  const [adjustItemId, setAdjustItemId] = React.useState<string>('');
  const [adjustDelta, setAdjustDelta] = React.useState<number>(0);
  const [showAdjustInline, setShowAdjustInline] = React.useState<boolean>(false);
  const [strictImportMode, setStrictImportMode] = React.useState<boolean>(false);

  React.useEffect(() => {
    try {
      localStorage.setItem('corepms_inventory_threshold', String(lowStockThreshold));
      window.dispatchEvent(new CustomEvent('inventory:threshold:update'));
    } catch { }
  }, [lowStockThreshold]);

  const getItemIssues = React.useCallback((it: any): string[] => {
    const issues: string[] = [];
    if (!String(it.name || '').trim()) issues.push('Missing name');
    if (!it.costCenter) issues.push('No center');
    if (Number(it.costPrice || 0) <= 0) issues.push('Cost ≤ 0');
    if (Number(it.sellingPrice || 0) <= 0) issues.push('Price ≤ 0');
    if (Number(it.cosPercent || 0) < 0 || Number(it.cosPercent || 0) > 100) issues.push('COS out of range');
    return issues;
  }, []);

  const [severityFilter, setSeverityFilter] = React.useState<'all' | 'critical' | 'minor'>('all');
  const getItemSeverity = React.useCallback((it: any): 'critical' | 'minor' | 'none' => {
    if (!String(it.name || '').trim()) return 'critical';
    if (!it.costCenter) return 'critical';
    if (Number(it.costPrice || 0) <= 0) return 'critical';
    if (Number(it.sellingPrice || 0) <= 0) return 'critical';
    if (Number(it.cosPercent || 0) < 0 || Number(it.cosPercent || 0) > 100) return 'minor';
    return 'none';
  }, []);

  const resetForm = () => {
    setItemName('');
    setQtyReceived(0);
    setQtyInStock(0);
    setCostPrice(0);
    setInventoryCategory('');
    setSellingPrice(0);
    setCostCenter('');
    setCategoryId('');
    setSubId('none');
    setBarVisible(false);
    setRestaurantVisible(false);
    setCosPercent(0);
    setPictureFile(null);
    setPicturePreview('');
    setNotes('');
    setErrors({});
    setEditingId(null);
  };

  const loadItems = React.useCallback(() => {
    try { const raw = localStorage.getItem('corepms_pos_items'); setItems(raw ? JSON.parse(raw) : []); } catch { setItems([]); }
  }, []);

  React.useEffect(() => { if (!isManager && !isAdminRole) return; loadItems(); }, [loadItems, isManager, isAdminRole]);

  // Register module-specific hotkeys (F1, F2, F3, Shift+I)
  const hk = useHotkeys();
  React.useEffect(() => {
    if (!isManager && !isAdminRole) return;
    hk.register('F1', { tooltip: 'Create new stock item', handler: () => setStockOpen(true) }, 'pos-settings');
    hk.register('F2', {
      tooltip: 'Save current record', handler: () => {
        if (stockOpen) saveStockItem(); else toast({ title: 'No record', description: 'Open the Stock Item form to save.', duration: 1500 });
      }
    }, 'pos-settings');
    hk.register('F3', {
      tooltip: 'Add new supplier', handler: () => {
        const nameEl = document.getElementById('supplierName') as HTMLInputElement | null;
        const contactEl = document.getElementById('supplierContact') as HTMLInputElement | null;
        nameEl?.focus();
        toast({ title: 'Shortcut: F3', description: 'Focus Supplier Name to add a new supplier', duration: 1400 });
      }
    }, 'pos-settings');
    hk.register('Shift+I', {
      tooltip: 'Open Inventory Items Viewer', handler: () => {
        window.dispatchEvent(new CustomEvent('openInventoryViewer'));
      }
    }, 'pos-settings');
    return () => {
      hk.unregister('F1', 'pos-settings');
      hk.unregister('F2', 'pos-settings');
      hk.unregister('F3', 'pos-settings');
      hk.unregister('Shift+I', 'pos-settings');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stockOpen, isManager, isAdminRole]);


  // Persist and restore items controls
  React.useEffect(() => {
    if (!isManager && !isAdminRole) return;
    try {
      const raw = localStorage.getItem('corepms_pos_items_controls');
      if (raw) {
        const c = JSON.parse(raw);
        if (typeof c.searchTerm === 'string') setSearchTerm(c.searchTerm);
        if (c.centerFilter) setCenterFilter(c.centerFilter);
        if (typeof c.barFilter !== 'undefined') setBarFilter(!!c.barFilter);
        if (typeof c.restaurantFilter !== 'undefined') setRestaurantFilter(!!c.restaurantFilter);
        if (c.sortKey) setSortKey(c.sortKey);
        if (c.sortDir) setSortDir(c.sortDir);
        if (typeof c.attentionOnly !== 'undefined') setAttentionOnly(!!c.attentionOnly);
        if (c.severityFilter) setSeverityFilter(c.severityFilter);
        if (c.quickFilter) setQuickFilter(c.quickFilter);
      }
    } catch { }
  }, [isManager, isAdminRole]);

  React.useEffect(() => {
    if (!isManager && !isAdminRole) return;
    try {
      const payload = { searchTerm, centerFilter, barFilter, restaurantFilter, sortKey, sortDir, attentionOnly, severityFilter, quickFilter };
      localStorage.setItem('corepms_pos_items_controls', JSON.stringify(payload));
    } catch { }
  }, [searchTerm, centerFilter, barFilter, restaurantFilter, sortKey, sortDir, attentionOnly, severityFilter, quickFilter, isManager, isAdminRole]);

  const validateCode = (code: string) => {
    if (!code) return true;
    const trimmed = code.trim();
    // Allow alphanumeric, dashes, underscores, 8-64 chars
    return /^[A-Za-z0-9_\-]{8,64}$/.test(trimmed);
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!itemName.trim()) e.itemName = 'Item name is required';
    if (qtyReceived < 0) e.qtyReceived = 'Quantity received cannot be negative';
    if (qtyInStock < 0) e.qtyInStock = 'Quantity in stock cannot be negative';
    if (costPrice <= 0) e.costPrice = 'Cost price must be greater than 0';
    if (sellingPrice <= 0) e.sellingPrice = 'Selling price must be greater than 0';
    if (sellingPrice <= costPrice) e.sellingPrice = 'Selling price must be greater than cost price';
    if (!costCenter) e.costCenter = 'Select a cost center';
    if (!categoryId) e.categoryId = 'Select a category';
    if (!unitOfMeasure) e.unitOfMeasure = 'Select unit of measure';
    if (barcode && !validateCode(barcode)) e.barcode = 'Invalid code format (8-64 chars, letters/numbers/_/-)';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handlePictureChange = (file?: File) => {
    if (!file) { setPictureFile(null); setPicturePreview(''); return; }
    setPictureFile(file);
    try { setPicturePreview(URL.createObjectURL(file)); } catch { }
  };

  const handleScanCode = async () => {
    try {
      // Try BarcodeDetector if available
      const supportsDetector = (window as any).BarcodeDetector;
      if (supportsDetector) {
        const detector = new (window as any).BarcodeDetector({ formats: ['qr_code', 'ean_13', 'code_128'] });
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        const video = document.createElement('video');
        video.srcObject = stream as any;
        await video.play();
        const canvas = document.createElement('canvas');
        canvas.width = 640; canvas.height = 480;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const bitmap = await createImageBitmap(canvas);
          const codes = await detector.detect(bitmap);
          if (codes && codes.length) {
            const value = String(codes[0].rawValue || '').trim();
            if (validateCode(value)) {
              setBarcode(value);
              setScannedCodes(prev => Array.from(new Set([value, ...prev])).slice(0, 5));
            }
          }
        }
        stream.getTracks().forEach(t => t.stop());
      } else {
        // Fallback: prompt manual entry
        const v = (window.prompt('Enter barcode/QR code') || '').trim();
        if (v && validateCode(v)) {
          setBarcode(v);
          setScannedCodes(prev => Array.from(new Set([v, ...prev])).slice(0, 5));
        } else if (v) {
          toast({ title: 'Invalid code', description: 'Use 8-64 characters (letters, numbers, _ or -).', variant: 'destructive' });
        }
      }
    } catch (err) {
      console.error('Scan failed', err);
      const v = (window.prompt('Enter barcode/QR code') || '').trim();
      if (v && validateCode(v)) {
        setBarcode(v);
        setScannedCodes(prev => Array.from(new Set([v, ...prev])).slice(0, 5));
      }
    }
  };

  const saveStockItem = () => {
    if (!validate()) return;
    const base = {
      name: itemName.trim(),
      qtyReceived,
      qtyInStock,
      unitOfMeasure,
      costPrice: Number(costPrice.toFixed(2)),
      sellingPrice: Number(sellingPrice.toFixed(2)),
      costCenter,
      visibility: { bar: barVisible, restaurant: restaurantVisible },
      cosPercent: computedCOS,
      gpAmount,
      gpPercent,
      category_id: categoryId || null,
      sub_id: subId && subId !== 'none' ? subId : null,
      pictureName: pictureFile?.name || null,
      pictureData: picturePreview || null,
      imageBgColor,
      barcodes: scannedCodes.length ? scannedCodes : (barcode ? [barcode] : []),
      notes
    };
    try {
      const raw = localStorage.getItem('corepms_pos_items');
      const list = raw ? JSON.parse(raw) : [];
      let next: any[] = list;
      let savedItem: any;
      if (editingId) {
        next = list.map((it: any) => it.id === editingId ? { ...it, ...base } : it);
        savedItem = next.find((it: any) => it.id === editingId);
        localStorage.setItem('corepms_pos_items', JSON.stringify(next));
        log('STOCK_ITEM_UPDATE', savedItem);
      } else {
        const item = { id: `ITEM_${Date.now()}`, ...base };
        next = [item, ...list].slice(0, 500);
        localStorage.setItem('corepms_pos_items', JSON.stringify(next));
        savedItem = item;
        log('STOCK_ITEM_CREATE', item);
      }
      setItems(next);
      setStockOpen(false);
      resetForm();

      // Sync to database asynchronously
      if (savedItem) {
        syncPosItemToDb(savedItem).then(result => {
          if (!result.success) {
            console.warn('[PosSettings] Database sync failed:', result.error);
            toast({ title: 'Sync failed', description: result.error, variant: 'destructive' });
          }
        }).catch(err => {
          console.warn('[PosSettings] Database sync error:', err);
          toast({ title: 'Sync error', description: String(err), variant: 'destructive' });
        });
      }
    } catch (err) {
      console.error(err);
      toast({ title: 'Failed to save item', description: String(err), variant: 'destructive' });
    }
  };

  const startEdit = (it: any) => {
    setEditingId(it.id);
    setItemName(it.name);
    setQtyReceived(Number(it.qtyReceived) || 0);
    setQtyInStock(Number(it.qtyInStock) || 0);
    setCostPrice(Number(it.costPrice) || 0);
    setSellingPrice(Number(it.sellingPrice) || 0);
    setCostCenter(it.costCenter || '');
    setCategoryId(String(it.category_id || ''));
    setSubId(String(it.sub_id || 'none'));
    setInventoryCategory((it.inventoryCategory as any) || (it.costCenter === 'bar' ? 'cellar' : it.costCenter === 'restaurant' ? 'kitchen' : undefined));

    setBarVisible(!!it.visibility?.bar);
    setRestaurantVisible(!!it.visibility?.restaurant);
    setCosPercent(Number(it.cosPercent) || 0);
    setPictureFile(null);
    setPicturePreview(it.pictureData || '');
    setNotes(it.notes || '');
    setStockOpen(true);
    setFocusField(null);
  };

  const fixItem = (it: any) => {
    const issues = getItemIssues(it);
    let field: string | null = null;
    if (issues.includes('Missing name')) field = 'itemName';
    else if (issues.includes('No center')) field = 'costCenterTrigger';
    else if (issues.includes('Cost ≤ 0')) field = 'costPrice';
    else if (issues.includes('Price ≤ 0')) field = 'sellingPrice';
    else if (issues.includes('COS out of range')) field = 'cosPercent';
    setFocusField(field);
    startEdit(it);
  };

  const deleteItem = (id: string) => {
    try {
      const raw = localStorage.getItem('corepms_pos_items');
      const list = raw ? JSON.parse(raw) : [];
      const next = list.filter((it: any) => it.id !== id);
      localStorage.setItem('corepms_pos_items', JSON.stringify(next));
      setItems(next);
      log('STOCK_ITEM_DELETE', { id });

      // Delete from database asynchronously
      deletePosItemFromDb(id).then(result => {
        if (!result.success) {
          console.warn('[PosSettings] Database delete failed:', result.error);
          toast({ title: 'Delete sync failed', description: result.error, variant: 'destructive' });
        }
      }).catch(err => {
        console.warn('[PosSettings] Database delete error:', err);
        toast({ title: 'Delete sync error', description: String(err), variant: 'destructive' });
      });
    } catch (err) {
      console.error(err);
      toast({ title: 'Failed to delete item', description: String(err), variant: 'destructive' });
    }
  };

  const getFilteredSortedItems = React.useCallback(() => {
    const filtered = items
      .filter((it) => {
        const nameOk = !searchTerm.trim() || String(it.name || '').toLowerCase().includes(searchTerm.trim().toLowerCase());
        const centerOk = centerFilter === 'all' || it.costCenter === centerFilter;
        const barOk = !barFilter || !!it.visibility?.bar;
        const restOk = !restaurantFilter || !!it.visibility?.restaurant;
        return nameOk && centerOk && barOk && restOk;
      });
    const sorted = filtered.slice().sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'name') cmp = String(a.name || '').localeCompare(String(b.name || ''));
      else if (sortKey === 'price') cmp = Number(a.sellingPrice || 0) - Number(b.sellingPrice || 0);
      else cmp = Number(a.gpPercent || 0) - Number(b.gpPercent || 0);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [items, searchTerm, centerFilter, barFilter, restaurantFilter, sortKey, sortDir]);

  const exportCSV = () => {
    try {
      const data = getFilteredSortedItems();
      const headers = ['ID', 'Name', 'Center', 'CategoryId', 'CategoryName', 'SellingPrice', 'CostPrice', 'QtyInStock', 'QtyReceived', 'BarVisible', 'RestaurantVisible', 'COSPercent', 'GPAmount', 'GPPercent', 'Notes', 'TotalValue', 'TotalCost', 'Margin'];
      const rows = data.map((it: any) => {
        const selling = Number(it.sellingPrice || 0);
        const cost = Number(it.costPrice || 0);
        const qty = Number(it.qtyInStock || 0);
        const totalValue = selling * qty;
        const totalCost = cost * qty;
        const margin = totalValue - totalCost;
        const cat = it.category_id ? menuCats.getCategoryById(String(it.category_id)) : undefined;
        const values = [
          it.id,
          it.name || '',
          it.costCenter || '',
          String(it.category_id || ''),
          cat?.category_name || '',
          selling.toFixed(2),
          cost.toFixed(2),
          qty,
          Number(it.qtyReceived || 0),
          it.visibility?.bar ? 'Yes' : 'No',
          it.visibility?.restaurant ? 'Yes' : 'No',
          Number(it.cosPercent || 0).toFixed(2),
          Number(it.gpAmount ?? (selling - cost)).toFixed(2),
          Number(it.gpPercent || 0).toFixed(2),
          it.notes ? String(it.notes).replace(/\r?\n/g, ' ') : '',
          totalValue.toFixed(2),
          totalCost.toFixed(2),
          margin.toFixed(2)
        ];
        return values.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
      });
      const csv = [headers.join(','), ...rows].join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `stock_items_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      log('STOCK_ITEMS_EXPORT', { count: data.length });
    } catch (err) {
      console.error(err);
      logSettingsError('export_csv', err);
      toast({ title: 'Export failed', description: 'Could not generate CSV.', variant: 'destructive' });
    }
  };

  const exportIssuesCSV = () => {
    try {
      const data = getFilteredSortedItems().filter((it: any) => getItemIssues(it).length > 0);
      const headers = ['ID', 'Name', 'Center', 'Severity', 'Issues'];
      const rows = data.map((it: any) => {
        const sev = getItemSeverity(it);
        const issues = getItemIssues(it).join('; ');
        const values = [it.id, it.name || '', it.costCenter || '', sev, issues];
        return values.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
      });
      const csv = [headers.join(','), ...rows].join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `stock_items_issues_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      log('STOCK_ITEMS_ISSUES_EXPORT', { count: data.length });
    } catch (err) {
      console.error(err);
      logSettingsError('export_issues_csv', err);
      toast({ title: 'Export failed', description: 'Could not generate Issues CSV.', variant: 'destructive' });
    }
  };

  const [importSummary, setImportSummary] = React.useState<{ imported: number; created: number; updated: number; errors: string[]; total: number } | null>(null);
  const [lastImportSummary, setLastImportSummary] = React.useState<{ imported: number; created: number; updated: number; errors: string[]; total: number } | null>(null);

  React.useEffect(() => {
    if (!isManager && !isAdminRole) return;
    try {
      const raw = localStorage.getItem('corepms_pos_last_import_summary');
      if (raw) setLastImportSummary(JSON.parse(raw));
    } catch { }
  }, [isManager, isAdminRole]);

  const importCSVFromFile = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,text/csv';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const lines = text.split(/\r?\n/).filter(l => l.trim().length);
        if (lines.length < 2) { setImportSummary({ imported: 0, created: 0, updated: 0, errors: ['CSV has no data rows'], total: items.length }); return; }
        const headerLine = lines[0];
        const headers = headerLine.split(',').map(h => h.replace(/^\"|\"$/g, '').trim());
        const idx = (name: string) => headers.findIndex(h => h.toLowerCase() === name.toLowerCase());
        const idIdx = idx('ID');
        const nameIdx = idx('Name');
        const centerIdx = idx('Center');
        const invcatIdx = idx('InventoryCategory');
        const catIdIdx = idx('CategoryId');
        const catNameIdx = idx('CategoryName');
        const sellIdx = idx('SellingPrice');
        const costIdx = idx('CostPrice');
        const stockIdx = idx('QtyInStock');
        const recvIdx = idx('QtyReceived');
        const barIdx = idx('BarVisible');
        const restIdx = idx('RestaurantVisible');
        const cosIdx = idx('COSPercent');
        const gpAmtIdx = idx('GPAmount');
        const gpPctIdx = idx('GPPercent');
        const notesIdx = idx('Notes');
        const parsed: any[] = [];
        const errors: string[] = [];
        let updated = 0;
        let created = 0;
        for (let i = 1; i < lines.length; i++) {
          const row = lines[i];
          const cols = row.split(',').map(c => c.replace(/^\"|\"$/g, '').trim());
          if (cols.length !== headers.length) { errors.push(`Row ${i + 1}: column count mismatch`); continue; }
          const name = cols[nameIdx] || '';
          if (!name) { errors.push(`Row ${i + 1}: missing Name`); continue; }
          const centerRaw = (cols[centerIdx] || '').toLowerCase();
          const costCenter = centerRaw === 'bar' || centerRaw === 'restaurant' ? (centerRaw as any) : null;
          if (!costCenter) { errors.push(`Row ${i + 1}: invalid Center '${cols[centerIdx]}'`); continue; }
          const sellingPrice = Number(cols[sellIdx] || 0);
          const costPrice = Number(cols[costIdx] || 0);
          const qtyInStock = Number(cols[stockIdx] || 0);
          const qtyReceived = Number(cols[recvIdx] || 0);
          const barVisible = String(cols[barIdx] || '').toLowerCase().startsWith('y');
          const restaurantVisible = String(cols[restIdx] || '').toLowerCase().startsWith('y');
          const cosPercent = Number(cols[cosIdx] || 0);
          const gpAmount = cols[gpAmtIdx] ? Number(cols[gpAmtIdx]) : sellingPrice - costPrice;
          const gpPercent = cols[gpPctIdx] ? Number(cols[gpPctIdx]) : (sellingPrice ? (gpAmount / sellingPrice) * 100 : 0);
          const notes = cols[notesIdx] || '';
          const id = cols[idIdx] || `ITEM_${Date.now()}_${i}`;
          // Resolve category
          let category_id: string | null = null;
          const catIdVal = catIdIdx >= 0 ? (cols[catIdIdx] || '').trim() : '';
          const catNameVal = catNameIdx >= 0 ? (cols[catNameIdx] || '').trim() : '';
          if (catIdVal) {
            category_id = catIdVal;
          } else if (catNameVal) {
            const dept = costCenter === 'bar' ? 'Bar' : 'Restaurant';
            const found = menuCats.listCategories(dept as any).find(c => c.category_name.toLowerCase() === catNameVal.toLowerCase());
            if (found) category_id = found.category_id; else errors.push(`Row ${i + 1}: unknown CategoryName '${catNameVal}' for department '${dept}'`);
          }
          // InventoryCategory parsing
          let inventoryCategory: 'kitchen' | 'cellar' | undefined = undefined;
          const invRaw = invcatIdx >= 0 ? (cols[invcatIdx] || '').trim().toLowerCase() : '';
          if (invRaw === 'kitchen') inventoryCategory = 'kitchen';
          else if (invRaw === 'cellar') inventoryCategory = 'cellar';
          else inventoryCategory = costCenter === 'bar' ? 'cellar' : costCenter === 'restaurant' ? 'kitchen' : undefined;

          parsed.push({ id, name, costCenter, inventoryCategory, sellingPrice, costPrice, qtyInStock, qtyReceived, visibility: { bar: barVisible, restaurant: restaurantVisible }, cosPercent, gpAmount, gpPercent, notes, category_id });
        }
        const raw = localStorage.getItem('corepms_pos_items');
        const list = raw ? JSON.parse(raw) : [];
        const map = new Map<string, any>(list.map((it: any) => [it.id, it]));
        for (const it of parsed) {
          if (map.has(it.id)) updated++; else created++;
          map.set(it.id, { ...(map.get(it.id) || {}), ...it });
        }
        const next = Array.from(map.values()).slice(0, 500);
        if (strictImportMode && errors.length > 0) {
          const summary = { imported: 0, created: 0, updated: 0, errors, total: items.length };
          setImportSummary(summary);
          setLastImportSummary(summary);
          try { localStorage.setItem('corepms_pos_last_import_summary', JSON.stringify(summary)); } catch { }
          log('STOCK_ITEMS_IMPORT_STRICT_FAIL', { errors: errors.length });
          return;
        }
        // Update local state and storage
        localStorage.setItem('corepms_pos_items', JSON.stringify(next));
        setItems(next);

        // Sync imported items to Database
        let dbSynced = 0;
        let dbErrors: string[] = [];

        // Process DB sync in background to avoid blocking UI
        (async () => {
          try {
            toast({ title: 'Syncing to Database...', description: `Syncing ${parsed.length} imported items...` });
            for (const item of parsed) {
              const res = await syncPosItemToDb(item);
              if (res.success) dbSynced++;
              else if (res.error) dbErrors.push(`${item.name}: ${res.error}`);
            }

            if (dbErrors.length > 0) {
              toast({ title: 'Sync completed with errors', description: `Synced ${dbSynced}/${parsed.length} items. Check console for details.`, variant: 'destructive' });
              console.warn('Import sync errors:', dbErrors);
            } else {
              toast({ title: 'Import Synced', description: `Successfully synced ${dbSynced} items to the database.` });
            }

            // Update summary with DB sync results
            const finalSummary = {
              imported: parsed.length,
              created,
              updated,
              errors: [...errors, ...dbErrors],
              total: next.length
            };
            setImportSummary(finalSummary);
            setLastImportSummary(finalSummary);
            localStorage.setItem('corepms_pos_last_import_summary', JSON.stringify(finalSummary));

          } catch (err) {
            console.error('Background sync failed:', err);
          }
        })();

        const summary = { imported: parsed.length, created, updated, errors, total: next.length };
        setImportSummary(summary);
        setLastImportSummary(summary);
        try { localStorage.setItem('corepms_pos_last_import_summary', JSON.stringify(summary)); } catch { }
        log('STOCK_ITEMS_IMPORT', { imported: parsed.length, created, updated, errors: errors.length, total: next.length });
      } catch (err) {
        setImportSummary({ imported: 0, created: 0, updated: 0, errors: ['Failed to import CSV'], total: items.length });
        console.error(err);
        logSettingsError('import_csv', err);
      }
    };
    input.click();
  };

  const downloadTemplateCSV = () => {
    const headers = ['ID', 'Name', 'Center', 'InventoryCategory', 'CategoryId', 'CategoryName', 'SellingPrice', 'CostPrice', 'QtyInStock', 'QtyReceived', 'BarVisible', 'RestaurantVisible', 'COSPercent', 'GPAmount', 'GPPercent', 'Notes'];
    const sample = ['', 'Mojito', 'bar', 'Cellar', '', 'Cocktails', '12.00', '6.00', '10', '10', 'Yes', 'No', '50', '6.00', '50', 'Mint, lime'];
    const csv = [headers.join(','), sample.map(v => `"${v}"`).join(',')].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'stock_items_template.csv';
    a.click();
    URL.revokeObjectURL(url);
    log('STOCK_ITEMS_TEMPLATE_DOWNLOAD');
  };

  const migrateInventoryCategories = () => {
    try {
      const raw = localStorage.getItem('corepms_pos_items');
      const list = raw ? JSON.parse(raw) : [];
      const barCats = menuCats.listCategories('Bar');
      const restCats = menuCats.listCategories('Restaurant');
      const barDefault = barCats[0] || menuCats.addCategory({ category_name: 'General', department: 'Bar' });
      const restDefault = restCats[0] || menuCats.addCategory({ category_name: 'General', department: 'Restaurant' });
      let changed = 0;
      const next = list.map((it: any) => {
        const center = String(it.costCenter || '').toLowerCase();
        const isBar = center === 'bar';
        const deptDefault = isBar ? barDefault : restDefault;
        const catId = it.category_id || null;
        const catValid = catId && !!menuCats.getCategoryById(String(catId));
        const newCatId = catValid ? catId : deptDefault.category_id;
        const invCat = it.inventoryCategory === 'kitchen' || it.inventoryCategory === 'cellar'
          ? it.inventoryCategory
          : (isBar ? 'cellar' : center === 'restaurant' ? 'kitchen' : it.inventoryCategory);
        const vis = {
          bar: isBar ? true : !!it.visibility?.bar,
          restaurant: center === 'restaurant' ? true : !!it.visibility?.restaurant,
        };
        const merged = { ...it, category_id: newCatId, inventoryCategory: invCat, visibility: vis };
        if (
          newCatId !== catId ||
          invCat !== it.inventoryCategory ||
          vis.bar !== !!it.visibility?.bar ||
          vis.restaurant !== !!it.visibility?.restaurant
        ) changed++;
        return merged;
      });
      localStorage.setItem('corepms_pos_items', JSON.stringify(next));
      setItems(next);
      log('INVENTORY_CATEGORIES_MIGRATED', { changed, total: next.length });
      toast({ title: 'Migration complete', description: `Updated ${changed} items`, duration: 2000 });
    } catch (e) {
      logSettingsError('migrate_categories', e);
      toast({ title: 'Migration failed', description: 'Could not migrate categories', variant: 'destructive' });
    }
  };

  const downloadErrorsCSV = () => {
    if (!importSummary || !importSummary.errors.length) return;
    try {
      const headers = ['Error'];
      const rows = importSummary.errors.map(e => `"${String(e).replace(/\"/g, '""')}"`);
      const csv = [headers.join(','), ...rows].join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `stock_items_import_errors_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      log('STOCK_ITEMS_ERRORS_EXPORT', { errors: importSummary.errors.length });
    } catch (err) {
      console.error('Failed to download errors CSV', err);
    }
  };

  if (!isManager) {
    return (
      <div className="min-h-screen p-8">
        <div className="max-w-xl mx-auto bg-white shadow rounded-lg p-6 text-center">
          <h2 className="text-xl font-semibold mb-2">Access Denied</h2>
          <p className="text-sm text-gray-600 mb-4">You do not have permission to access POS Settings.</p>
          <div className="flex items-center justify-center gap-3">
            <Button onClick={() => window.dispatchEvent(new CustomEvent('navigateToModule', { detail: { module: 'pos' } }))}>Back to POS</Button>
            <Button className="bg-red-600 text-white hover:bg-red-700" onClick={() => {
              try { (window as any).native?.auth?.logout?.(); } catch { }
              try { const a = require('@/lib/authService').default; a?.logout?.(); } catch { }
              try { localStorage.clear(); sessionStorage.clear(); } catch { }
              try { window.location.href = '#/login'; } catch { }
            }}>Force Logout & Clear Data</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs text-gray-500 mb-1">POS / Settings</div>
          <h3 className="text-xl font-bold">POS Back Office Settings</h3>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => window.dispatchEvent(new CustomEvent('navigateToModule', { detail: { module: 'pos' } }))}>Back to POS</Button>
          <Button className="bg-indigo-600 text-white" onClick={() => setStockOpen(true)}>New Stock Item</Button>
        </div>
      </div>

      {/* Stock Item Setup Modal */}
      <Dialog open={stockOpen} onOpenChange={setStockOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Stock Item Setup</DialogTitle>
          </DialogHeader>

          {/* Scrollable content area */}
          <div className="flex-1 overflow-y-auto">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs">Item name</label>
                <Input id="itemName" value={itemName} onChange={(e) => setItemName(e.target.value)} placeholder="e.g. Mojito" />
                {errors.itemName && <div className="text-xs text-red-600 mt-1">{errors.itemName}</div>}
              </div>
              <div>
                <label className="text-xs">Cost center</label>
                <Select value={costCenter || undefined} onValueChange={(v) => setCostCenter(v as any)}>
                  <SelectTrigger id="costCenterTrigger">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bar">Bar</SelectItem>
                    <SelectItem value="restaurant">Restaurant</SelectItem>
                  </SelectContent>
                </Select>
                {errors.costCenter && <div className="text-xs text-red-600 mt-1">{errors.costCenter}</div>}
              </div>

              <div>
                <label className="text-xs">Category</label>
                <Select value={categoryId || undefined} onValueChange={(v) => setCategoryId(v)} disabled={!costCenter}>
                  <SelectTrigger id="categoryTrigger">
                    <SelectValue placeholder={costCenter ? 'Select category' : 'Select cost center first'} />
                  </SelectTrigger>
                  <SelectContent>
                    {menuCats.listCategories(costCenter === 'bar' ? 'Bar' : 'Restaurant').map(c => (
                      <SelectItem key={c.category_id} value={c.category_id}>{c.category_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.categoryId && <div className="text-xs text-red-600 mt-1">{errors.categoryId}</div>}
              </div>



              <div>
                <label className="text-xs">Sub-category</label>
                <Select value={subId || undefined} onValueChange={(v) => setSubId(v)} disabled={!categoryId}>
                  <SelectTrigger id="subCategoryTrigger">
                    <SelectValue placeholder={categoryId ? 'Select sub-category' : 'Select category first'} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {categoryId && menuCats.listSubcategories(categoryId).map(s => (
                      <SelectItem key={s.sub_id} value={s.sub_id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-xs">Quantity received</label>
                <Input type="number" min={0} value={qtyReceived} onChange={(e) => setQtyReceived(Number(e.target.value))} />
                {errors.qtyReceived && <div className="text-xs text-red-600 mt-1">{errors.qtyReceived}</div>}
              </div>
              <div>
                <label className="text-xs">Quantity in stock</label>
                <Input type="number" min={0} value={qtyInStock} onChange={(e) => setQtyInStock(Number(e.target.value))} />
                {errors.qtyInStock && <div className="text-xs text-red-600 mt-1">{errors.qtyInStock}</div>}
              </div>

              <div>
                <label className="text-xs">Unit of measure</label>
                <Select value={unitOfMeasure || undefined} onValueChange={(v) => setUnitOfMeasure(v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select unit" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="each">each</SelectItem>
                    <SelectItem value="kg">kg</SelectItem>
                    <SelectItem value="lb">lb</SelectItem>
                    <SelectItem value="ml">ml</SelectItem>
                    <SelectItem value="L">L</SelectItem>
                  </SelectContent>
                </Select>
                {errors.unitOfMeasure && <div className="text-xs text-red-600 mt-1">{errors.unitOfMeasure}</div>}
              </div>

              <div>
                <label className="text-xs">Inventory Category</label>
                <Select value={inventoryCategory || undefined} onValueChange={(v) => setInventoryCategory(v as "" | "kitchen" | "cellar")}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select inventory category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="kitchen">Kitchen</SelectItem>
                    <SelectItem value="cellar">Cellar</SelectItem>
                  </SelectContent>
                </Select>
                {errors.inventoryCategory && <div className="text-xs text-red-600 mt-1">{errors.inventoryCategory}</div>}
              </div>

              <div>
                <label className="text-xs">Cost price</label>
                <Input id="costPrice" type="number" min={0} step="0.01" value={costPrice} onChange={(e) => setCostPrice(Number(e.target.value))} />
                {errors.costPrice && <div className="text-xs text-red-600 mt-1">{errors.costPrice}</div>}
              </div>
              <div>
                <label className="text-xs">Selling price</label>
                <Input id="sellingPrice" type="number" min={0} step="0.01" value={sellingPrice} onChange={(e) => setSellingPrice(Number(e.target.value))} />
                {errors.sellingPrice && <div className="text-xs text-red-600 mt-1">{errors.sellingPrice}</div>}
              </div>

              <div>
                <label className="text-xs">COS (Cost of Sales) %</label>
                <Input id="cosPercent" type="number" readOnly value={computedCOS} />
              </div>
              <div>
                <label className="text-xs">Picture upload</label>
                <Input type="file" accept="image/*" onChange={(e) => handlePictureChange(e.target.files?.[0] || undefined)} />
                {picturePreview && <img src={picturePreview} alt="preview" className="mt-2 h-20 w-20 object-cover rounded" />}
              </div>

              <div>
                <label className="text-xs">Picture alternative (solid color)</label>
                <div className="flex items-center gap-3">
                  <input type="color" value={imageBgColor} onChange={(e) => setImageBgColor(e.target.value)} />
                  <div className="w-10 h-10 rounded border" style={{ backgroundColor: imageBgColor }} title="Color preview"></div>
                </div>
                <div className="text-xs text-gray-600 mt-1">Used when no picture is uploaded.</div>
              </div>

              <div className="md:col-span-2">
                <label className="text-xs">Barcode / QR Code</label>
                <div className="flex items-center gap-2 mt-1">
                  <Input placeholder="Manual entry" value={barcode} onChange={(e) => setBarcode(e.target.value)} />
                  <Button variant="outline" onClick={handleScanCode}>Scan</Button>
                </div>
                {errors.barcode && <div className="text-xs text-red-600 mt-1">{errors.barcode}</div>}
                {!!scannedCodes.length && (
                  <div className="text-xs text-gray-600 mt-1">Recent: {scannedCodes.slice(0, 3).join(', ')}</div>
                )}
              </div>

              <div className="md:col-span-2">
                <label className="text-xs">Visibility</label>
                <div className="flex items-center gap-4 mt-1">
                  <div className="flex items-center gap-2">
                    <Checkbox checked={barVisible} onCheckedChange={(v) => setBarVisible(!!v)} />
                    <span className="text-sm">Show in Bar menu</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox checked={restaurantVisible} onCheckedChange={(v) => setRestaurantVisible(!!v)} />
                    <span className="text-sm">Show in Restaurant menu</span>
                  </div>
                </div>
              </div>

              <div className="md:col-span-2">
                <label className="text-xs">Notes</label>
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes" />
              </div>

              <div className="md:col-span-2">
                <div className="text-sm text-gray-700">GP: <span className="font-semibold">{gpAmount.toFixed(2)}</span> ({gpPercent.toFixed(2)}%)</div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setStockOpen(false); }}>Cancel</Button>
            <Button className="bg-indigo-600 text-white" onClick={saveStockItem}>Save Item</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Navigation: Tabs and Section Buttons */}
      <div className="p-4 border rounded">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
          <TabsList className="flex flex-wrap gap-2">
            <TabsTrigger value="admin">⚙️ System Administration & Users</TabsTrigger>
            <TabsTrigger value="menu">🍔 Menu & Recipe Configuration</TabsTrigger>
            <TabsTrigger value="stock">📦 Stock & Inventory Control</TabsTrigger>
            <TabsTrigger value="purchasing">💰 Purchasing & Suppliers</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="mt-3">
          <div className="text-xs text-gray-600 mb-2">Select Section</div>
          <HorizontalScrollNav
            items={tabAnchors[activeTab]}
            activeId={activeSectionId}
            onSelect={(id) => {
              setActiveSectionId(id);
              try { const url = new URL(window.location.href); url.searchParams.set('anchor', id); window.history.replaceState({}, '', url.toString()); } catch { }
            }}
            ariaLabel={`Select section for ${tabLabels[activeTab]}`}
          />
        </div>
      </div>

      {/* Menu Categories Management */}
      {activeTab === 'menu' && activeSectionId === 'menu-categories' && (
        <Section id="menu-categories" title="Menu Categories">
          <MenuCategoriesPanel />
        </Section>
      )}

      {activeTab === 'menu' && activeSectionId === 'sub-categories' && (
        <Section id="sub-categories" title="Sub-Categories">
          <SubCategoriesPanel />
        </Section>
      )}

      {/* Data Migration */}
      {activeTab === 'admin' && activeSectionId === 'receipt-branding' && (
        <Section id="receipt-branding" title="Receipt Branding & Contact Info">
          <div className="text-xs text-gray-600 mb-2">Configure your company logo and contact details used on receipts and printed documents.</div>
          <Button variant="outline" onClick={() => setShowReceiptModal(true)}>Configure Receipt Branding</Button>
          {showReceiptModal && (<ReceiptSettingsModal open={showReceiptModal} onClose={() => setShowReceiptModal(false)} />)}
        </Section>
      )}

      {activeTab === 'admin' && activeSectionId === 'data-migration' && (
        <Section id="data-migration" title="Data Migration">
          <div className="space-y-2">
            <div className="text-xs text-gray-600">Bulk-map legacy item subCategory strings to categories and persist category_id on items.</div>
            <Button
              variant="outline"
              onClick={() => {
                try {
                  const itemsRaw = localStorage.getItem('corepms_pos_items');
                  const list = itemsRaw ? JSON.parse(itemsRaw) : [];
                  let updated = 0;
                  const ensureCategory = (name: string, dept: 'Bar' | 'Restaurant') => {
                    const byDept = menuCats.listCategories(dept);
                    const found = byDept.find(c => c.category_name.toLowerCase() === name.toLowerCase());
                    if (found) return found;
                    return menuCats.addCategory({ category_name: name, department: dept, sort_order: 99 });
                  };
                  const next = list.map((it: any) => {
                    const dept: 'Bar' | 'Restaurant' | null = it.costCenter === 'bar' ? 'Bar' : (it.costCenter === 'restaurant' ? 'Restaurant' : null);
                    const sub = String(it.subCategory || '').trim();
                    if (!dept || !sub) return it;
                    const cat = ensureCategory(sub, dept);
                    if (!it.category_id || it.category_id !== cat.category_id) { it.category_id = cat.category_id; updated++; }
                    return it;
                  });
                  localStorage.setItem('corepms_pos_items', JSON.stringify(next));
                  setItems(next);
                  log('POS_MIGRATE_SUBCATEGORY', { updated });
                  toast({ title: 'Migration complete', description: `${updated} items updated with category_id` });
                } catch (err) {
                  toast({ title: 'Migration failed', description: String(err) });
                }
              }}
            >
              Map subCategory → category_id
            </Button>
          </div>
        </Section>
      )}

      {/* Category Gaps Report */}
      {activeTab === 'admin' && activeSectionId === 'category-gaps' && (
        <Section id="category-gaps" title="Category Gaps">
          <div className="text-xs text-gray-600">Items missing a category assignment (no CategoryId). Use the Data Migration tool or edit items to assign a category.</div>
          {(() => {
            const gaps = items.filter((it: any) => !it.category_id);
            if (!gaps.length) return (<div className="text-xs text-green-700 mt-2">All items have categories ✔</div>);
            return (
              <div className="mt-2 overflow-x-auto">
                <table className="text-sm w-full">
                  <thead><tr><th className="p-2 text-left">ID</th><th className="p-2 text-left">Name</th><th className="p-2">Center</th><th className="p-2">subCategory</th></tr></thead>
                  <tbody>
                    {gaps.map((it: any) => (
                      <tr key={it.id}>
                        <td className="p-2 font-mono text-xs">{it.id}</td>
                        <td className="p-2">{it.name}</td>
                        <td className="p-2">{it.costCenter || '—'}</td>
                        <td className="p-2">{String(it.subCategory || '—')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="text-xs text-red-700 mt-2">Missing categories: <span className="font-semibold">{gaps.length}</span></div>
              </div>
            );
          })()}
        </Section>
      )}

      {/* Import Summary Modal */}
      <Dialog open={!!importSummary} onOpenChange={(open) => setImportSummary(open ? importSummary : null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Import Summary</DialogTitle>
          </DialogHeader>
          {importSummary && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div>Imported: <span className="font-semibold">{importSummary.imported}</span></div>
                <div>Created: <span className="font-semibold text-green-700">{importSummary.created}</span></div>
                <div>Updated: <span className="font-semibold text-blue-700">{importSummary.updated}</span></div>
                <div>Total Items: <span className="font-semibold">{importSummary.total}</span></div>
              </div>
              <div>
                <div className="font-semibold mb-1">Errors ({importSummary.errors.length})</div>
                {importSummary.errors.length ? (
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {importSummary.errors.map((e, i) => (
                      <div key={i} className="text-red-700">• {e}</div>
                    ))}
                  </div>
                ) : (
                  <div className="text-gray-600">No errors</div>
                )}
              </div>
            </div>
          )}
          <DialogFooter className="mt-4">
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setImportSummary(null)}>Close</Button>
              <Button
                variant="outline"
                disabled={!importSummary || !importSummary.errors.length}
                onClick={downloadErrorsCSV}
              >
                Download Errors CSV
              </Button>
              <Button variant="secondary" disabled={!isManager} onClick={() => requireManager('RETRY_IMPORT', importCSVFromFile)}>Retry Import</Button>
              <Button variant="outline" onClick={() => { stockSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); setImportSummary(null); }}>Go to Stock Items</Button>
              <Button variant="outline" disabled={!importSummary || !importSummary.errors.length} onClick={() => importSummary && setImportSummary({ ...importSummary, errors: [] })}>Clear Errors</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {activeTab === 'admin' && activeSectionId === 'pos-user-rights' && (
        <Section id="pos-user-rights" title="POS User Rights Management">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input placeholder="User Full Name" />
            <Select>
              <SelectTrigger>
                <SelectValue placeholder="Role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="staff">Staff</SelectItem>
                <SelectItem value="manager">Manager</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button onClick={() => log('USER_CREATE')}>Create</Button>
            <Button variant="secondary" onClick={() => log('USER_MODIFY')}>Modify</Button>
            <Button variant="outline" onClick={() => log('USER_ASSIGN_PERMS')}>Assign Permissions</Button>
            <Button className="bg-red-600 text-white hover:bg-red-700" onClick={() => { setShowPinModal(true); setPinMsg(''); setPinErr(''); setPinVerified(false); setPinCurrent(''); setPinNew(''); setPinConfirm(''); }}>Configure Management PINs</Button>
          </div>
          <Dialog open={showPinModal} onOpenChange={(v) => setShowPinModal(v)}>
            <DialogContent className="max-w-[560px] w-[95vw]">
              <DialogHeader>
                <DialogTitle>Management PIN Configuration</DialogTitle>
              </DialogHeader>
              <div className="space-y-3 text-sm">
                <div className="text-xs text-gray-600">Configure Manager PINs used to authorize void operations. PINs are stored securely (salted hash) and validated server-side.</div>
                <div className="rounded bg-yellow-50 text-yellow-800 p-2 text-xs">Warning: Changing PINs affects authorization for void workflows. Share PINs only with authorized management.</div>
                <div>
                  <Label className="text-xs">Current Manager PIN</Label>
                  <Input type="password" inputMode="numeric" pattern="\\d{6,8}" maxLength={8} value={pinCurrent} onChange={(e) => { setPinCurrent(e.target.value.replace(/[^0-9]/g, '')); setPinVerified(false); setPinErr(''); setPinMsg(''); }} aria-label="Current manager PIN" />
                  <div className="mt-2 flex items-center gap-2">
                    <Button variant="outline" disabled={pinBusy || !/^\\d{6,8}$/.test(pinCurrent)} onClick={async () => {
                      setPinBusy(true); setPinErr(''); setPinMsg('');
                      try {
                        const configured = await db.isConfigured(); if (!configured) throw new Error('Database not configured');
                        const byCode = await db.query<{ role: string }>(`SELECT role FROM pos_pins WHERE pin_code = ? AND scope = 'void' ORDER BY updated_at DESC LIMIT 1`, [pinCurrent]);
                        let ok = false;
                        if (!('error' in byCode) && byCode.rows && byCode.rows[0]) { ok = String(byCode.rows[0].role || '').toLowerCase() === 'manager'; }
                        if (!ok) {
                          const row = await db.query<{ role: string; pin_hash: string; salt: string }>(`SELECT role, pin_hash, salt FROM pos_pins WHERE role = 'manager' AND scope = 'void' ORDER BY updated_at DESC LIMIT 1`, []);
                          if (!('error' in row) && row.rows && row.rows[0]) {
                            const rec = row.rows[0]; const h = await hashPin(pinCurrent, String(rec.salt || '')); ok = (String(rec.pin_hash || '') === h);
                          }
                        }
                        setPinVerified(ok);
                        setPinMsg(ok ? 'Current PIN verified.' : 'Current PIN invalid.');
                        if (!ok) setPinErr('Invalid current PIN');
                      } catch (e: any) {
                        setPinErr(e?.message || 'Verification failed');
                        setPinVerified(false);
                        logSettingsError('pin_verify', e, { userId: user?.id });
                      } finally { setPinBusy(false); }
                    }}>Verify Current PIN</Button>
                    {pinVerified && (<span className="text-xs text-green-700">Verified ✔</span>)}
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">New PIN (6–8 digits)</Label>
                    <Input type="password" inputMode="numeric" pattern="\\d{6,8}" maxLength={8} value={pinNew} onChange={(e) => setPinNew(e.target.value.replace(/[^0-9]/g, ''))} aria-label="New PIN" />
                  </div>
                  <div>
                    <Label className="text-xs">Confirm New PIN</Label>
                    <Input type="password" inputMode="numeric" pattern="\\d{6,8}" maxLength={8} value={pinConfirm} onChange={(e) => setPinConfirm(e.target.value.replace(/[^0-9]/g, ''))} aria-label="Confirm new PIN" />
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Permission Level</Label>
                  <Select value={pinScope} onValueChange={(v) => setPinScope(v as any)}>
                    <SelectTrigger><SelectValue placeholder="Select scope" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="void">Void Operations Only</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {pinErr && (<div role="alert" className="text-xs text-red-600">{pinErr}</div>)}
                {pinMsg && (<div role="status" className="text-xs text-gray-700">{pinMsg}</div>)}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowPinModal(false)} disabled={pinBusy}>Cancel</Button>
                <Button disabled={pinBusy || !isValidPin || !(pinVerified || (!hasExistingPin && String(user?.role || '').toLowerCase() === 'admin'))} onClick={async () => {
                  setPinBusy(true); setPinErr(''); setPinMsg('');
                  try {
                    const configured = await db.isConfigured(); if (!configured) throw new Error('Database not configured');
                    await db.query(`CREATE TABLE IF NOT EXISTS pos_pins (role TEXT NOT NULL, scope TEXT NOT NULL, pin_hash TEXT NOT NULL, salt TEXT NOT NULL, updated_by TEXT, updated_at DATETIME NOT NULL DEFAULT now())`, []);
                    const salt = makeSalt(); const hash = await hashPin(pinNew, salt);
                    await db.query(`INSERT INTO pos_pins (role, scope, pin_hash, salt, updated_by) VALUES (?, ?, ?, ?, ?)`, ['manager', pinScope, hash, salt, user?.id || 'unknown']);
                    try { const entry = createAuditEntry('PIN_UPDATE', 'ADMIN', user?.id || 'unknown', 'server-1', { role: 'manager', scope: pinScope }); const raw = localStorage.getItem('corepms_pos_audit'); const list = raw ? JSON.parse(raw) : []; localStorage.setItem('corepms_pos_audit', JSON.stringify([entry, ...list].slice(0, 500))); } catch { }
                    await db.query(`INSERT INTO audit_log (event, user_id, level, detail, ts) VALUES ('PIN_UPDATE', ?, 'manager', ?, now())`, [user?.id || 'unknown', JSON.stringify({ scope: pinScope })]).catch(() => { });
                    const row = await db.query<{ pin_hash: string; salt: string }>(`SELECT pin_hash, salt FROM pos_pins WHERE role='manager' AND scope=? ORDER BY updated_at DESC LIMIT 1`, [pinScope]);
                    let verified = false;
                    if (!('error' in row) && row.rows && row.rows[0]) { const rec = row.rows[0]; const chk = await hashPin(pinNew, String(rec.salt || '')); verified = chk === String(rec.pin_hash || ''); }
                    setPinMsg(verified ? 'PIN updated and verified on server.' : 'PIN updated. Verification skipped.');
                    setShowPinModal(false);
                    toast({ title: 'PIN updated', description: 'Management PIN saved securely.' });
                  } catch (e: any) {
                    const msg = e?.message || 'Failed to update PIN';
                    setPinErr(msg);
                    toast({ title: 'PIN update failed', description: msg, variant: 'destructive' });
                    logSettingsError('pin_save', e, { userId: user?.id, scope: pinScope });
                  } finally { setPinBusy(false); }
                }}>Save PIN</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </Section>
      )}

      {activeTab === 'stock' && activeSectionId === 'stock-list' && (
        <Section id="stock-list" title="Stock List">
          <StockTab
            items={items}
            userRole={user?.role || null}
            onEditItem={(it) => requireManager('EDIT_ITEM', () => startEdit(it))}
            onFixItem={(it) => requireManager('FIX_ITEM', () => fixItem(it))}
            onDeleteItem={(id) => requireManager('DELETE_ITEM', () => deleteItem(id))}
          />
        </Section>
      )}

      {activeTab === 'stock' && activeSectionId === 'stock-controls' && (
        <Section id="stock-controls" title="Stock Management Controls">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Input placeholder="Item SKU" />
            <Input placeholder="Adjustment (+/-)" type="number" />
            <Textarea placeholder="Reason / Notes" />
          </div>
          <Button className="bg-indigo-600 text-white hover:bg-indigo-700" onClick={() => log('STOCK_ADJUST')}>Apply Adjustment</Button>
        </Section>
      )}

      <div ref={stockSectionRef}>
        {activeTab === 'stock' && activeSectionId === 'inventory-control' && (
          <Section id="inventory-control" title="Inventory Control">
            {/* Quick Filters */}
            <div id="inventoryQuickFilters" className="bg-white rounded-xl shadow-lg p-6 mb-3">
              <div className="flex flex-wrap gap-3 items-center">
                <button className={quickFilter === 'all' ? "px-4 py-2 rounded-lg font-medium bg-blue-600 text-white" : "px-4 py-2 rounded-lg font-medium bg-gray-200 text-gray-700"} onClick={() => setQuickFilter('all')}>All Items</button>
                <button className={quickFilter === 'low' ? "px-4 py-2 rounded-lg font-medium bg-blue-600 text-white" : "px-4 py-2 rounded-lg font-medium bg-gray-200 text-gray-700"} onClick={() => setQuickFilter('low')}>Low Stock</button>
                <button className={quickFilter === 'bar' ? "px-4 py-2 rounded-lg font-medium bg-blue-600 text-white" : "px-4 py-2 rounded-lg font-medium bg-gray-200 text-gray-700"} onClick={() => setQuickFilter('bar')}>Cellar</button>
                <button className={quickFilter === 'restaurant' ? "px-4 py-2 rounded-lg font-medium bg-blue-600 text-white" : "px-4 py-2 rounded-lg font-medium bg-gray-200 text-gray-700"} onClick={() => setQuickFilter('restaurant')}>Kitchen</button>
                <Button id="adjustStockBtn" className="bg-indigo-600 text-white hover:bg-indigo-700" onClick={() => setShowAdjustInline(true)}>Adjust Stock</Button>
                <div className="ml-auto flex items-center gap-2">
                  <span className="text-xs text-gray-600">Low stock ≤</span>
                  <Input type="number" min={0} value={lowStockThreshold} onChange={(e) => setLowStockThreshold(Math.max(0, Number(e.target.value || 0)))} className="w-20 h-8" />
                </div>
              </div>
              {showAdjustInline && (
                <div className="mt-3 grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
                  <div>
                    <label className="text-xs font-medium">Item</label>
                    <Select value={adjustItemId || undefined} onValueChange={(v) => setAdjustItemId(v)}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select item" />
                      </SelectTrigger>
                      <SelectContent>
                        {items.map((it: any) => (
                          <SelectItem key={it.id} value={it.id}>{it.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs font-medium">Current</label>
                    <Input value={String(items.find((x: any) => x.id === adjustItemId)?.qtyInStock ?? 0)} readOnly />
                  </div>
                  <div>
                    <label className="text-xs font-medium">Adjustment (±)</label>
                    <Input type="number" value={adjustDelta} onChange={(e) => setAdjustDelta(Number(e.target.value || 0))} />
                  </div>
                  <div>
                    <label className="text-xs font-medium">New</label>
                    <Input value={(() => { const cur = items.find((x: any) => x.id === adjustItemId); const curQty = Number(cur?.qtyInStock || 0); const nextQty = curQty + Number(adjustDelta || 0); return nextQty < 0 ? 'Invalid' : String(nextQty); })()} readOnly />
                  </div>
                  <div className="md:col-span-4 flex gap-2">
                    <Button className="bg-indigo-600 text-white hover:bg-indigo-700" onClick={() => {
                      const cur = items.find((x: any) => x.id === adjustItemId);
                      if (!cur) { toast({ title: 'No item selected', description: 'Select an item to adjust.', duration: 1500 }); return; }
                      const curQty = Number(cur.qtyInStock || 0);
                      const delta = Number(adjustDelta || 0);
                      const nextQty = curQty + delta;
                      if (nextQty < 0) { toast({ title: 'Invalid adjustment', description: 'Adjustment would set stock below zero.', duration: 2000 }); return; }
                      try {
                        const updated = items.map((it: any) => it.id === adjustItemId ? { ...it, qtyInStock: nextQty } : it);
                        localStorage.setItem('corepms_pos_items', JSON.stringify(updated));
                        setItems(updated);
                        toast({ title: 'Stock updated', description: `${cur.name}: ${curQty} → ${nextQty}`, duration: 1800 });
                        log('INVENTORY_ADJUST', { id: adjustItemId, name: cur.name, delta, newQty: nextQty });
                        setAdjustItemId('');
                        setAdjustDelta(0);
                        setShowAdjustInline(false);
                      } catch (err) {
                        alert('Failed to update stock');
                      }
                    }}>Save</Button>
                    <Button variant="outline" onClick={() => { setAdjustItemId(''); setAdjustDelta(0); setShowAdjustInline(false); }}>Cancel</Button>
                  </div>
                </div>
              )}
            </div>
            {/* Adjust Stock Quantities */}
            <div className="bg-white rounded-lg p-4 mb-3">
              <div className="text-sm font-semibold mb-2">Adjust Stock Quantities</div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                <div>
                  <label className="text-xs font-medium">Item</label>
                  <Select value={adjustItemId || undefined} onValueChange={(v) => setAdjustItemId(v)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select item" />
                    </SelectTrigger>
                    <SelectContent>
                      {items.map((it: any) => (
                        <SelectItem key={it.id} value={it.id}>{it.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium">Current stock</label>
                  <Input value={String(items.find((x: any) => x.id === adjustItemId)?.qtyInStock ?? 0)} readOnly />
                </div>
                <div>
                  <label className="text-xs font-medium">Adjustment (±)</label>
                  <Input type="number" value={adjustDelta} onChange={(e) => setAdjustDelta(Number(e.target.value || 0))} />
                </div>
              </div>
              <div className="mt-2 text-xs text-gray-600">
                New stock: {(() => {
                  const cur = items.find((x: any) => x.id === adjustItemId);
                  const curQty = Number(cur?.qtyInStock || 0);
                  const nextQty = curQty + Number(adjustDelta || 0);
                  return nextQty < 0 ? 'Invalid (below zero)' : nextQty;
                })()}
              </div>
              <div className="mt-3 flex gap-2">
                <Button className="bg-indigo-600 text-white hover:bg-indigo-700" onClick={() => {
                  const cur = items.find((x: any) => x.id === adjustItemId);
                  if (!cur) { toast({ title: 'No item selected', description: 'Select an item to adjust.', duration: 1500 }); return; }
                  const curQty = Number(cur.qtyInStock || 0);
                  const delta = Number(adjustDelta || 0);
                  const nextQty = curQty + delta;
                  if (nextQty < 0) { toast({ title: 'Invalid adjustment', description: 'Adjustment would set stock below zero.', duration: 2000 }); return; }
                  try {
                    const updated = items.map((it: any) => it.id === adjustItemId ? { ...it, qtyInStock: nextQty } : it);
                    localStorage.setItem('corepms_pos_items', JSON.stringify(updated));
                    setItems(updated);
                    toast({ title: 'Stock updated', description: `${cur.name}: ${curQty} → ${nextQty}`, duration: 1800 });
                    log('INVENTORY_ADJUST', { id: adjustItemId, name: cur.name, delta, newQty: nextQty });
                    setAdjustItemId('');
                    setAdjustDelta(0);
                  } catch (err) {
                    alert('Failed to update stock');
                  }
                }}>Save</Button>
                <Button variant="outline" onClick={() => { setAdjustItemId(''); setAdjustDelta(0); }}>Cancel</Button>
              </div>
            </div>
            {/* Recent Adjustments */}
            <div className="bg-white rounded-lg p-4 mb-3">
              <div className="text-sm font-semibold mb-2">Recent Adjustments</div>
              {(() => {
                try {
                  const raw = localStorage.getItem('corepms_pos_audit');
                  const list = raw ? JSON.parse(raw) : [];
                  const recents = list.filter((e: any) => e.action === 'INVENTORY_ADJUST').slice(0, 3);
                  if (!recents.length) return (<div className="text-xs text-gray-600">No adjustments yet</div>);
                  return (
                    <div className="space-y-1 text-xs">
                      {recents.map((e: any) => {
                        const d = e.details ? JSON.parse(e.details) : {};
                        const deltaLabel = Number(d.delta || 0) >= 0 ? `+${Number(d.delta || 0)}` : String(d.delta || 0);
                        return (
                          <div key={e.id} className="flex items-center justify-between">
                            <span className="font-medium">{d.name || e.entityId}</span>
                            <span className="text-gray-700">{deltaLabel}</span>
                            <span className="text-gray-700">New: {d.newQty}</span>
                            <span className="text-gray-500">{new Date(e.timestamp).toLocaleString()}</span>
                          </div>
                        );
                      })}
                    </div>
                  );
                } catch {
                  return (<div className="text-xs text-red-600">Failed to load recent adjustments</div>);
                }
              })()}
            </div>
            {/* Controls */}
            <div id="filter-bar" className="flex flex-wrap items-center gap-2 md:gap-3 mb-3">
              <div className="flex items-center gap-3">
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
              <div className="flex items-center gap-2 md:gap-3 flex-wrap">
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
                {canExportStockCSV(user?.role) && (
                  <Button variant="outline" className="whitespace-nowrap" onClick={exportCSV}>Export CSV</Button>
                )}
                {canExportIssuesCSV(user?.role) && (
                  <Button variant="outline" className="whitespace-nowrap" onClick={() => requireManager('EXPORT_ISSUES_CSV', exportIssuesCSV)}>Export Issues CSV</Button>
                )}
                {canImportStockCSV(user?.role) && (
                  <Button variant="outline" onClick={() => requireManager('IMPORT_CSV', importCSVFromFile)}>Import CSV</Button>
                )}
                {canDownloadTemplate(user?.role) && (
                  <Button variant="outline" onClick={downloadTemplateCSV}>Download Template</Button>
                )}
                <div className="flex items-center gap-2 ml-2">
                  <Checkbox checked={strictImportMode} onCheckedChange={(v) => setStrictImportMode(!!v)} />
                  <span className="text-sm">Strict import</span>
                </div>
                <Button variant="outline" onClick={() => requireManager('MIGRATE_CATEGORIES', migrateInventoryCategories)}>Migrate Inventory Categories</Button>

                {/* Manual Sync to DB */}
                <Button
                  variant="outline"
                  className="gap-2 border-blue-200 text-blue-700 hover:bg-blue-50"
                  onClick={async () => {
                    toast({ title: 'Syncing...', description: 'Pushing all items to DB...' });
                    const res = await performFullSync();
                    if (res.success) {
                      toast({ title: 'Sync Complete', description: `Successfully synced ${res.synced} items.` });
                    } else {
                      toast({ title: 'Sync Failed', description: res.error, variant: 'destructive' });
                    }
                  }}
                >
                  Sync to DB
                </Button>
                {lastImportSummary && lastImportSummary.errors?.length > 0 && (
                  <div className="ml-2 px-2 py-1 rounded bg-red-100 text-red-700 text-xs flex items-center gap-2">
                    <span>Import errors: {lastImportSummary.errors.length}</span>
                    <Button variant="outline" size="sm" onClick={() => setImportSummary(lastImportSummary)}>View</Button>
                    <Button variant="outline" size="sm" onClick={() => { try { localStorage.setItem('corepms_pos_last_import_summary', JSON.stringify({ ...lastImportSummary, errors: [] })); } catch { }; setLastImportSummary(prev => prev ? { ...prev, errors: [] } : prev); }}>Clear</Button>
                  </div>
                )}
              </div>
            </div>

            {items.length === 0 ? (
              <div className="text-sm text-gray-600">No items saved yet.</div>
            ) : (
              <div className="overflow-x-auto">
                {/* Summary bar */}
                <div className="text-xs text-gray-600 mb-2">
                  {(() => {
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
                              ? it.costCenter === 'bar'
                              : it.costCenter === 'restaurant';
                        return nameOk && centerOk && barOk && restOk && attentionOk && severityOk && quickOk;
                      });
                    const count = filtered.length;
                    const prices = filtered.map((it) => Number(it.sellingPrice || 0));
                    const gpPercents = filtered.map((it) => Number(it.gpPercent || 0));
                    const avgGp = count ? (gpPercents.reduce((a, b) => a + b, 0) / count) : 0;
                    const minPrice = count ? Math.min(...prices) : 0;
                    const maxPrice = count ? Math.max(...prices) : 0;
                    const totalValue = filtered.reduce((acc, it) => acc + Number(it.sellingPrice || 0) * Number(it.qtyInStock || 0), 0);
                    const totalCost = filtered.reduce((acc, it) => acc + Number(it.costPrice || 0) * Number(it.qtyInStock || 0), 0);
                    const margin = totalValue - totalCost;
                    const marginPct = totalValue > 0 ? (margin / totalValue) * 100 : 0;
                    return `Items: ${count} • Avg GP: ${avgGp.toFixed(2)}% • Min: ${formatCurrency(minPrice)} • Max: ${formatCurrency(maxPrice)} • Total Value: ${formatCurrency(totalValue)} • Total Cost: ${formatCurrency(totalCost)} • Margin: ${formatCurrency(margin)} (${marginPct.toFixed(2)}%)`;
                  })()}
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left border-b">
                      <th className="py-2 pr-4">Name</th>
                      <th className="py-2 pr-4">Center</th>
                      <th className="py-2 pr-4">Price</th>
                      <th className="py-2 pr-4">GP%</th>
                      <th className="py-2 pr-4">Issues</th>
                      <th className="py-2 pr-4">Visible</th>
                      <th className="py-2 pr-4">Actions</th>
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
                        return nameOk && centerOk && barOk && restOk && attentionOk && severityOk;
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
                            <td className="py-2 pr-4">
                              <div className="flex gap-2">
                                {canEditStockItem(user?.role) && (
                                  <Button variant="outline" onClick={() => requireManager('EDIT_ITEM', () => startEdit(it))}>Edit</Button>
                                )}
                                {canFixStockItem(user?.role) && (
                                  <Button variant="secondary" onClick={() => requireManager('FIX_ITEM', () => fixItem(it))}>Fix</Button>
                                )}
                                {canDeleteStockItem(user?.role) && (
                                  <Button variant="destructive" onClick={() => requireManager('DELETE_ITEM', () => deleteItem(it.id))}>Delete</Button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Printing and Quick Updates */}
            {activeTab === 'stock' && (
              <div id="printing-quick-updates" className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="p-3 border rounded">
                  <div className="font-semibold mb-2 text-sm">Print Stock Sheet</div>
                  <Button variant="outline" onClick={() => {
                    try {
                      const raw = localStorage.getItem('corepms_pos_items');
                      const items = raw ? JSON.parse(raw) : [];
                      const rows = items.map((it: any) => `<tr><td>${it.name}</td><td>${Number(it.qtyInStock || 0)}</td><td>${Number(it.costPrice || 0).toFixed(2)}</td><td>${Number(it.sellingPrice || 0).toFixed(2)}</td></tr>`).join('');
                      const html = `<!doctype html><html><head><title>Stock Sheet</title></head><body><h2>Stock Sheet</h2><table border="1" cellspacing="0" cellpadding="4"><thead><tr><th>Name</th><th>Qty</th><th>Cost</th><th>Price</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
                      const blob = new Blob([html], { type: 'text/html' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `stock_sheet_${new Date().toISOString().slice(0, 10)}.html`;
                      a.click();
                      URL.revokeObjectURL(url);
                      log('STOCK_SHEET_PRINT');
                    } catch (err) {
                      alert('Failed to prepare stock sheet');
                    }
                  }}>Download Stock Sheet</Button>
                </div>
                <div className="p-3 border rounded">
                  <div className="font-semibold mb-2 text-sm">Quick Stock Count</div>
                  <Input id="quickCountName" placeholder="Item name" />
                  <Input id="quickCountQty" type="number" min={0} placeholder="New quantity" className="mt-1" />
                  <Button className="mt-2" onClick={() => {
                    try {
                      const name = (document.getElementById('quickCountName') as HTMLInputElement)?.value || '';
                      const qty = Number((document.getElementById('quickCountQty') as HTMLInputElement)?.value || 0);
                      const raw = localStorage.getItem('corepms_pos_items');
                      const list = raw ? JSON.parse(raw) : [];
                      const next = list.map((it: any) => String(it.name || '').toLowerCase() === String(name).toLowerCase() ? { ...it, qtyInStock: qty } : it);
                      localStorage.setItem('corepms_pos_items', JSON.stringify(next));
                      setItems(next);
                      log('STOCK_COUNT_UPDATE', { name, qty });
                    } catch (err) {
                      alert('Failed to update stock count');
                    }
                  }}>Apply Count</Button>
                </div>
                <div id="adjust-stock-quantities" className="p-3 border rounded">
                  <div className="font-semibold mb-2 text-sm">Quick Inventory Update</div>
                  <Input id="quickUpdateName" placeholder="Item name" />
                  <Input id="quickUpdateDelta" type="number" placeholder="± Quantity" className="mt-1" />
                  <Button className="mt-2" onClick={() => {
                    try {
                      const name = (document.getElementById('quickUpdateName') as HTMLInputElement)?.value || '';
                      const delta = Number((document.getElementById('quickUpdateDelta') as HTMLInputElement)?.value || 0);
                      const raw = localStorage.getItem('corepms_pos_items');
                      const list = raw ? JSON.parse(raw) : [];
                      const next = list.map((it: any) => {
                        if (String(it.name || '').toLowerCase() !== String(name).toLowerCase()) return it;
                        const updated = Math.max(0, Number(it.qtyInStock || 0) + delta);
                        return { ...it, qtyInStock: updated };
                      });
                      localStorage.setItem('corepms_pos_items', JSON.stringify(next));
                      setItems(next);
                      log('INVENTORY_QUICK_UPDATE', { name, delta });
                    } catch (err) {
                      alert('Failed to update inventory');
                    }
                  }}>Apply Update</Button>
                </div>
              </div>
            )}

            {/* Purchases Reporting */}
            <div className="mt-6 p-4 border rounded">
              <div className="font-semibold mb-2 text-sm">Purchases Reporting</div>
              <div className="flex gap-2 mb-2">
                <Input id="purchaseItem" placeholder="Item name" />
                <Input id="purchaseQty" type="number" placeholder="Quantity" />
                <Input id="purchaseCost" type="number" step="0.01" placeholder="Total Cost" />
                <Button onClick={() => {
                  try {
                    const item = (document.getElementById('purchaseItem') as HTMLInputElement)?.value || '';
                    const qty = Number((document.getElementById('purchaseQty') as HTMLInputElement)?.value || 0);
                    const cost = Number((document.getElementById('purchaseCost') as HTMLInputElement)?.value || 0);
                    const rec = { id: `PUR_${Date.now()}`, item, qty, cost, date: new Date().toISOString() };
                    const raw = localStorage.getItem('corepms_purchases');
                    const list = raw ? JSON.parse(raw) : [];
                    localStorage.setItem('corepms_purchases', JSON.stringify([rec, ...list].slice(0, 500)));
                    log('PURCHASE_RECORD', rec);
                  } catch { }
                }}>Record Purchase</Button>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left border-b">
                      <th className="py-2 pr-4">Date</th>
                      <th className="py-2 pr-4">Item</th>
                      <th className="py-2 pr-4">Qty</th>
                      <th className="py-2 pr-4">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const raw = localStorage.getItem('corepms_purchases');
                      const list = raw ? JSON.parse(raw) : [];
                      if (!list.length) return (<tr><td colSpan={4} className="py-2 text-gray-500">No purchases yet</td></tr>);
                      return list.slice(0, 50).map((p: any) => (
                        <tr key={p.id} className="border-b">
                          <td className="py-2 pr-4">{new Date(p.date).toLocaleString()}</td>
                          <td className="py-2 pr-4">{p.item}</td>
                          <td className="py-2 pr-4">{p.qty}</td>
                          <td className="py-2 pr-4">{formatCurrency(Number(p.cost || 0))}</td>
                        </tr>
                      ));
                    })()}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Supplier Management */}
            <div className="mt-6 p-4 border rounded">
              <div className="font-semibold mb-2 text-sm">Supplier List Management</div>
              <div className="flex gap-2 mb-2">
                <Input id="supplierName" placeholder="Supplier name" />
                <Input id="supplierContact" placeholder="Contact info" />
                <Button onClick={() => {
                  try {
                    const name = (document.getElementById('supplierName') as HTMLInputElement)?.value || '';
                    const contact = (document.getElementById('supplierContact') as HTMLInputElement)?.value || '';
                    const rec = { id: `SUP_${Date.now()}`, name, contact };
                    const raw = localStorage.getItem('corepms_suppliers');
                    const list = raw ? JSON.parse(raw) : [];
                    localStorage.setItem('corepms_suppliers', JSON.stringify([rec, ...list].slice(0, 200)));
                    log('SUPPLIER_ADD', rec);
                  } catch { }
                }}>Add Supplier</Button>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left border-b">
                      <th className="py-2 pr-4">Name</th>
                      <th className="py-2 pr-4">Contact</th>
                      <th className="py-2 pr-4">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const raw = localStorage.getItem('corepms_suppliers');
                      const list = raw ? JSON.parse(raw) : [];
                      if (!list.length) return (<tr><td colSpan={3} className="py-2 text-gray-500">No suppliers</td></tr>);
                      return list.slice(0, 50).map((s: any) => (
                        <tr key={s.id} className="border-b">
                          <td className="py-2 pr-4">{s.name}</td>
                          <td className="py-2 pr-4">{s.contact}</td>
                          <td className="py-2 pr-4">
                            <Button variant="outline" onClick={() => {
                              const name = prompt('Edit name', s.name) || s.name;
                              const contact = prompt('Edit contact', s.contact) || s.contact;
                              const raw2 = localStorage.getItem('corepms_suppliers');
                              const list2 = raw2 ? JSON.parse(raw2) : [];
                              localStorage.setItem('corepms_suppliers', JSON.stringify(list2.map((x: any) => x.id === s.id ? { ...x, name, contact } : x)));
                              log('SUPPLIER_EDIT', { id: s.id });
                            }}>Edit</Button>
                            <Button variant="destructive" onClick={() => {
                              const raw2 = localStorage.getItem('corepms_suppliers');
                              const list2 = raw2 ? JSON.parse(raw2) : [];
                              localStorage.setItem('corepms_suppliers', JSON.stringify(list2.filter((x: any) => x.id !== s.id)));
                              log('SUPPLIER_DELETE', { id: s.id });
                            }}>Delete</Button>
                          </td>
                        </tr>
                      ));
                    })()}
                  </tbody>
                </table>
              </div>
            </div>

          </Section>
        )}
      </div>

      {activeTab === 'admin' && (
        <Section id="pos-reporting-tools" title="POS Reporting Tools">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Select>
              <SelectTrigger>
                <SelectValue placeholder="Range" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="7d">Last 7 Days</SelectItem>
                <SelectItem value="30d">Last 30 Days</SelectItem>
              </SelectContent>
            </Select>
            <Select>
              <SelectTrigger>
                <SelectValue placeholder="Report Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sales">Sales</SelectItem>
                <SelectItem value="performance">Performance</SelectItem>
                <SelectItem value="inventory">Inventory</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button variant="secondary" onClick={() => log('REPORT_GENERATE')}>Generate Report</Button>
        </Section>
      )}

      {activeTab === 'purchasing' && (
        <Section id="purchasing-config" title="Purchasing System Configuration">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input
              placeholder="Vendor Name"
              value={vendorName}
              onChange={(e) => setVendorName(e.target.value)}
            />
            <Input
              placeholder="Order Terms"
              value={vendorTerms}
              onChange={(e) => setVendorTerms(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <Button onClick={handleAddVendor}>Add Vendor</Button>
            <Button variant="outline" onClick={() => log('PURCHASE_CONFIG_UPDATE')}>Save Settings</Button>
          </div>
        </Section>
      )}

      {activeTab === 'stock' && (
        <Section id="stock-level-monitoring" title="Stock Level Monitoring">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Input placeholder="Item SKU" />
            <Input placeholder="New Level" type="number" />
            <Input placeholder="Threshold" type="number" />
          </div>
          <div className="flex gap-2">
            <Button className="bg-orange-600 text-white hover:bg-orange-700" onClick={() => log('STOCK_SET_LEVEL')}>Set Level</Button>
            <Button variant="outline" onClick={() => log('STOCK_REALTIME_ADJUST')}>Real-time Adjust</Button>
          </div>
        </Section>
      )}

      {activeTab === 'menu' && (
        <Section id="cocktail-engineering" title="Cocktail Engineering">
          <CocktailEngineering />
        </Section>
      )}
    </div>
  );
};

export default PosSettings;
