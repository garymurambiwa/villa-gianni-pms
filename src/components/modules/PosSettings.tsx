import React from 'react';
import { useAuth } from '@/context/AuthContext';
import { useData } from '@/context/DataContext';
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
import PosReports from '@/components/modules/PosReports';
import { db } from '@/lib/db';
import { parseColor, getContrastRatio } from '@/lib/colorUtils';
import {
  syncPosItemToDb,
  deletePosItemFromDb,
  deletePosItemsFromDb,
  performFullSync,
  ensureTablesExist,
  fixItemVisibility,
  fixAllItemsVisibility
} from '@/lib/dbSync';
import vendors from '@/lib/vendors';
import pmsAuthDb, { DbUser, Shift } from '@/lib/pmsAuthDb';

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

const INITIAL_UNITS = [
  'piece', 'each', 'kg', 'g', 'gram', 'lb', 'oz', 'ml', 'milliliter', 'L', 'liter', 'tot (tray)',
  'glass', 'bottle 750ml', 'bottle 1 Litre'
];

const getVisibleUnits = (blacklist: string[]) => {
  return INITIAL_UNITS.filter(u => !blacklist.includes(u));
};

// Map cost centers to departments (Bar or Restaurant)
const getCostCenterDepartment = (costCenter: string): 'Bar' | 'Restaurant' => {
  const barCenters = ['bar', 'flamehouse_bar', 'conference_bar', 'beverage_cellar'];
  return barCenters.includes(String(costCenter || '').toLowerCase()) ? 'Bar' : 'Restaurant';
};

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
          <label htmlFor="pos-cat-name" className="text-xs">Category name</label>
          <Input id="pos-cat-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Cocktails" />
        </div>
        <div>
          <label htmlFor="pos-cat-dept" className="text-xs">Department</label>
          <Select value={dept} onValueChange={(v) => setDept(v as any)}>
            <SelectTrigger id="pos-cat-dept">
              <SelectValue placeholder="Select" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Bar">Bar</SelectItem>
              <SelectItem value="Restaurant">Restaurant</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label htmlFor="pos-cat-sort" className="text-xs">Sort order</label>
          <Input id="pos-cat-sort" type="number" value={sort} onChange={(e) => setSort(Number(e.target.value) || 0)} />
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
          <label htmlFor="pos-cat-btn-color" className="text-xs">Button color</label>
          <div className="flex items-center gap-2">
            <input id="pos-cat-btn-color" type="color" value={(parseColor(btnColor)?.hex) || '#4f46e5'} onChange={(e) => setBtnColor(e.target.value)} />
            <Input aria-label="Button color hex" placeholder="#4f46e5 or rgb() or hsl()" value={btnColor} onChange={(e) => setBtnColor(e.target.value)} />
          </div>
        </div>
        <div>
          <label htmlFor="pos-cat-txt-color" className="text-xs">Text color</label>
          <div className="flex items-center gap-2">
            <input id="pos-cat-txt-color" type="color" value={(parseColor(txtColor)?.hex) || '#ffffff'} onChange={(e) => setTxtColor(e.target.value)} />
            <Input aria-label="Text color hex" placeholder="#ffffff or rgb() or hsl()" value={txtColor} onChange={(e) => setTxtColor(e.target.value)} />
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
        <label htmlFor="pos-cat-filter" className="text-xs">Filter</label>
        <Select value={filterDept} onValueChange={(v) => setFilterDept(v as any)}>
          <SelectTrigger id="pos-cat-filter" className="w-40">
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
          <label htmlFor="sub-cat-name" className="text-xs font-medium">Name</label>
          <Input id="sub-cat-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Classic Cocktails" />
        </div>
        <div>
          <label htmlFor="sub-cat-parent-cat" className="text-xs font-medium">Category</label>
          <Select value={categoryId || undefined} onValueChange={(v) => setCategoryId(v)}>
            <SelectTrigger id="sub-cat-parent-cat">
              <SelectValue placeholder="Select category" />
            </SelectTrigger>
            <SelectContent>
              {menuCats.listCategories().map(c => (<SelectItem key={c.category_id} value={c.category_id}>{c.category_name}</SelectItem>))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label htmlFor="sub-cat-parent-sub" className="text-xs font-medium">Parent sub-category</label>
          <Select value={parentSubId} onValueChange={(v) => setParentSubId(v)} disabled={!categoryId}>
            <SelectTrigger id="sub-cat-parent-sub">
              <SelectValue placeholder={categoryId ? 'Optional' : 'Select category first'} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {categoryId && menuCats.listSubcategories(categoryId).map(s => (<SelectItem key={s.sub_id} value={s.sub_id}>{s.name}</SelectItem>))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label htmlFor="sub-cat-sort" className="text-xs font-medium">Sort</label>
          <Input id="sub-cat-sort" type="number" value={sort} onChange={(e) => setSort(Number(e.target.value) || 0)} />
        </div>
        <div className="flex items-end">
          <Button className="bg-indigo-600 text-white" onClick={add}>Add Sub-category</Button>
        </div>
        <div className="md:col-span-5">
          <label htmlFor="sub-cat-desc" className="text-xs font-medium">Description</label>
          <Textarea id="sub-cat-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional description" />
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <label htmlFor="sub-cat-filter" className="text-xs">Filter</label>
        <Select value={deptFilter} onValueChange={(v) => setDeptFilter(v as any)}>
          <SelectTrigger id="sub-cat-filter" className="w-40">
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

const StationManagementPanel: React.FC = () => {
  const { toast } = useToast();
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [stations, setStations] = React.useState<Array<{ id: string; name: string; description?: string; active: boolean }>>([]);
  const [loading, setLoading] = React.useState(false);

  const loadStations = React.useCallback(async () => {
    setLoading(true);
    try {
      const data = await pmsAuthDb.listCostCentres();
      setStations(data);
    } catch (err) {
      toast({ title: 'Error', description: 'Failed to load stations', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  React.useEffect(() => {
    loadStations();
  }, [loadStations]);

  const handleAdd = async () => {
    if (!name.trim()) {
      toast({ title: 'Validation Error', description: 'Station name is required', variant: 'destructive' });
      return;
    }
    try {
      const res = await pmsAuthDb.addCostCentre(name.trim(), description.trim());
      if (res.ok) {
        toast({ title: 'Success', description: `Station "${name}" created` });
        setName('');
        setDescription('');
        loadStations();
      } else {
        toast({ title: 'Error', description: res.error || 'Failed to add station', variant: 'destructive' });
      }
    } catch (err) {
      toast({ title: 'Error', description: 'Failed to add station', variant: 'destructive' });
    }
  };

  const handleDelete = async (id: string, stationName: string) => {
    if (!window.confirm(`Are you sure you want to deactivate station "${stationName}"?`)) return;
    try {
      const res = await pmsAuthDb.deleteCostCentre(id);
      if (res.ok) {
        toast({ title: 'Success', description: 'Station deactivated' });
        loadStations();
      } else {
        toast({ title: 'Error', description: res.error || 'Failed to deactivate station', variant: 'destructive' });
      }
    } catch (err) {
      toast({ title: 'Error', description: 'Failed to deactivate station', variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
        <div className="md:col-span-1">
          <Label className="text-xs">Station Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Pool Bar" />
        </div>
        <div className="md:col-span-1">
          <Label className="text-xs">Description (Optional)</Label>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Outdoor outlet" />
        </div>
        <Button className="bg-indigo-600 text-white" onClick={handleAdd}>Add Station</Button>
      </div>

      <div className="mt-4 border rounded overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="p-2 text-left">Name</th>
              <th className="p-2 text-left">Description</th>
              <th className="p-2 text-center">Status</th>
              <th className="p-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} className="p-4 text-center text-gray-500">Loading stations...</td></tr>
            ) : stations.length === 0 ? (
              <tr><td colSpan={4} className="p-4 text-center text-gray-500">No stations configured.</td></tr>
            ) : stations.map((s) => (
              <tr key={s.id} className="border-b hover:bg-gray-50">
                <td className="p-2 font-medium">{s.name}</td>
                <td className="p-2 text-gray-600">{s.description || '—'}</td>
                <td className="p-2 text-center">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] ${s.active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {s.active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="p-2 text-right">
                  {s.active && (
                    <Button variant="ghost" size="sm" className="text-red-600 hover:text-red-700 h-8" onClick={() => handleDelete(s.id, s.name)}>
                      Deactivate
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const UserManagementPanel: React.FC = () => {
  const { toast } = useToast();
  const [users, setUsers] = React.useState<DbUser[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [showPinModal, setShowPinModal] = React.useState(false);
  const [selectedUser, setSelectedUser] = React.useState<DbUser | null>(null);
  const [newPin, setNewPin] = React.useState('');

  const loadUsers = React.useCallback(async () => {
    setLoading(true);
    try {
      const data = await pmsAuthDb.listUsers();
      setUsers(data);
    } catch (err) {
      toast({ title: 'Error', description: 'Failed to load users', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  React.useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const handleUpdatePin = async () => {
    if (!selectedUser || !/^\d{6}$/.test(newPin)) {
      toast({ title: 'Invalid PIN', description: 'PIN must be 6 digits', variant: 'destructive' });
      return;
    }
    const res = await pmsAuthDb.updateUserPin(selectedUser.id, newPin);
    if (res.ok) {
      toast({ title: 'Success', description: `PIN updated for ${selectedUser.name}` });
      setShowPinModal(false);
      setNewPin('');
    } else {
      toast({ title: 'Error', description: res.error || 'Update failed', variant: 'destructive' });
    }
  };

  const togglePosAccess = async (user: DbUser, enabled: boolean) => {
    const res = await pmsAuthDb.updateUser(user.id, { is_pos_enabled: enabled } as any);
    if (res.ok) {
      toast({ title: 'Success', description: `${user.name} POS access ${enabled ? 'enabled' : 'disabled'}` });
      loadUsers();
    }
  };

  return (
    <div className="space-y-4">
      <div className="text-xs text-gray-500 mb-2">Manage POS access and security PINs for all staff members.</div>
      <div className="border rounded overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="p-2 text-left">User</th>
              <th className="p-2 text-left">Role</th>
              <th className="p-2 text-center">POS Enabled</th>
              <th className="p-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} className="p-4 text-center">Loading users...</td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={4} className="p-4 text-center">No users found.</td></tr>
            ) : users.map(u => (
              <tr key={u.id} className="border-b hover:bg-gray-50">
                <td className="p-2 font-medium">{u.name} <div className="text-[10px] text-gray-500 font-normal">{u.username}</div></td>
                <td className="p-2 capitalize">{u.role}</td>
                <td className="p-2 text-center">
                  <Checkbox 
                    checked={!!(u as any).is_pos_enabled} 
                    onCheckedChange={(v) => togglePosAccess(u, !!v)} 
                  />
                </td>
                <td className="p-2 text-right">
                  <Button variant="outline" size="sm" onClick={() => { setSelectedUser(u); setShowPinModal(true); }}>Set PIN</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={showPinModal} onOpenChange={setShowPinModal}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Set POS PIN: {selectedUser?.name}</DialogTitle></DialogHeader>
          <div className="py-4 space-y-3">
            <Label className="text-xs">Enter New 6-Digit PIN</Label>
            <Input 
              type="password" 
              value={newPin} 
              onChange={e => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="******"
              className="text-center text-3xl font-mono tracking-[0.5em] h-14"
            />
            <div className="text-[10px] text-center text-gray-500">Staff will use this PIN to start shifts and unlock terminals.</div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPinModal(false)}>Cancel</Button>
            <Button className="bg-blue-600 text-white" disabled={newPin.length !== 6} onClick={handleUpdatePin}>Save PIN</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

const ShiftReportingPanel: React.FC = () => {
  const [shifts, setShifts] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [selectedShift, setSelectedShift] = React.useState<string | null>(preselectedShift);
  const [shiftData, setShiftData] = React.useState<any | null>(null);
  const [reportLoading, setReportLoading] = React.useState(false);

  React.useEffect(() => {
    setLoading(true);
    pmsAuthDb.listShifts().then(data => {
      setShifts(data);
      setLoading(false);
    });
  }, []);

  const fetchShiftReport = async (shiftId: string) => {
    if (!shiftId) return;
    setReportLoading(true);
    try {
      // Fetch detailed shift data including transactions
      const shiftRes = await db.query(
        `SELECT * FROM pos_shifts WHERE id = ?`,
        [shiftId]
      );
      
      const transactionsRes = await db.query(
        `SELECT * FROM pos_transactions WHERE shift_id = ? ORDER BY created_at`,
        [shiftId]
      );
      
      const itemsRes = await db.query(
        `SELECT * FROM pos_shift_items WHERE shift_id = ?`,
        [shiftId]
      );
      
      const summary = {
        shift: shiftRes.rows?.[0] || null,
        transactions: transactionsRes.rows || [],
        items: itemsRes.rows || [],
        totals: {
          sales: transactionsRes.rows?.reduce((sum, t) => sum + Number(t.amount || 0), 0) || 0,
          cash: transactionsRes.rows?.reduce((sum, t) => sum + Number(t.cash_amount || 0), 0) || 0,
          card: transactionsRes.rows?.reduce((sum, t) => sum + Number(t.card_amount || 0), 0) || 0,
          room: transactionsRes.rows?.reduce((sum, t) => sum + Number(t.room_charge || 0), 0) || 0
        }
      };
      
      setShiftData(summary);
    } catch (err) {
      console.error('Failed to fetch shift report:', err);
      toast({ title: 'Error', description: 'Failed to load shift data', variant: 'destructive' });
    } finally {
      setReportLoading(false);
    }
  };

  React.useEffect(() => {
    if (selectedShift) {
      fetchShiftReport(selectedShift);
    }
  }, [selectedShift]);

  return (
    <div className="space-y-4">
      <div className="text-xs text-gray-500 mb-2">Detailed view of all POS work shifts and associated sales data.</div>
      <div className="border rounded overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="p-2 text-left">Start Time</th>
              <th className="p-2 text-left">User</th>
              <th className="p-2 text-center">Status</th>
              <th className="p-2 text-right">Balance</th>
              <th className="p-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="p-4 text-center">Loading shifts...</td></tr>
            ) : shifts.length === 0 ? (
              <tr><td colSpan={5} className="p-4 text-center">No shifts recorded yet.</td></tr>
            ) : shifts.map(s => (
              <tr key={s.id} className="border-b hover:bg-gray-50">
                <td className="p-2">{new Date(s.start_time).toLocaleString()}</td>
                <td className="p-2 font-medium">{s.user_name}</td>
                <td className="p-2 text-center">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${s.status === 'open' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}`}>
                    {(s.status || 'open').toUpperCase()}
                  </span>
                </td>
                <td className="p-2 text-right font-mono">
                  {s.status === 'open' ? `In: $${Number(s.start_balance).toFixed(2)}` : `Out: $${Number(s.end_balance || 0).toFixed(2)}`}
                </td>
                <td className="p-2 text-right">
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => setSelectedShift(s.id)}
                    disabled={reportLoading && selectedShift === s.id}
                  >
                    {reportLoading && selectedShift === s.id ? 'Loading...' : 'Report'}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      
      {shiftData && !reportLoading && (
        <div className="mt-6 p-4 border rounded">
          <div className="text-lg font-semibold mb-4">Shift Report: #{shiftData.shift?.id?.slice(-6) || 'Unknown'}</div>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <div className="text-sm font-medium text-gray-500">Shift Details</div>
              <table className="w-full text-sm space-y-2">
                <tr><td className="p-1">Date:</td><td className="p-1 text-right">{new Date(shiftData.shift?.start_time).toLocaleDateString()}</td></tr>
                <tr><td className="p-1">User:</td><td className="p-1 text-right">{shiftData.shift?.user_name || 'Unknown'}</td></tr>
                <tr><td className="p-1">Status:</td><td className="p-1 text-right">{shiftData.shift?.status || 'Unknown'}</td></tr>
                <tr><td className="p-1">Opened:</td><td className="p-1 text-right">{new Date(shiftData.shift?.start_time).toLocaleTimeString()}</td></tr>
                <tr><td className="p-1">Closed:</td><td className="p-1 text-right">{shiftData.shift?.end_time ? new Date(shiftData.shift?.end_time).toLocaleTimeString() : 'Open'}</td></tr>
              </table>
            </div>
            <div>
              <div className="text-sm font-medium text-gray-500">Financial Summary</div>
              <table className="w-full text-sm space-y-2">
                <tr><td className="p-1">Total Sales:</td><td className="p-1 text-right font-bold">{formatCurrency(shiftData.totals.sales)}</td></tr>
                <tr><td className="p-1">Cash:</td><td className="p-1 text-right">{formatCurrency(shiftData.totals.cash)}</td></tr>
                <tr><td className="p-1">Card:</td><td className="p-1 text-right">{formatCurrency(shiftData.totals.card)}</td></tr>
                <tr><td className="p-1">Room Charges:</td><td className="p-1 text-right">{formatCurrency(shiftData.totals.room)}</td></tr>
                <tr><td className="p-1">Transaction Count:</td><td className="p-1 text-right">{shiftData.transactions.length}</td></tr>
              </table>
            </div>
          </div>
          
          {shiftData.transactions.length > 0 && (
            <div className="mb-4">
              <div className="text-sm font-medium text-gray-500 mb-2">Transactions</div>
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="p-2 text-left">Time</th>
                    <th className="p-2">Type</th>
                    <th className="p-2">Amount</th>
                    <th className="p-2">Method</th>
                    <th className="p-2">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {shiftData.transactions.map((t, i) => (
                    <tr key={i} className="border-t">
                      <td className="p-2">{new Date(t.created_at).toLocaleTimeString()}</td>
                      <td className="p-2">{t.transaction_type || 'Unknown'}</td>
                      <td className="p-2 text-right">{formatCurrency(Number(t.amount || 0))}</td>
                      <td className="p-2">{t.payment_method || 'Unknown'}</td>
                      <td className="p-2">{t.description || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          
          {shiftData.items.length > 0 && (
            <div className="mb-4">
              <div className="text-sm font-medium text-gray-500 mb-2">Item Sales</div>
              <div className="ds-table-container">
                <table className="ds-table">
                  <thead>
                    <tr>
                      <th scope="col">Item</th>
                      <th scope="col" className="text-center">Qty</th>
                      <th scope="col" className="text-right hide-on-mobile">Price</th>
                      <th scope="col" className="text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shiftData.items.map((item: any, i: number) => (
                      <tr key={i}>
                        <td>{item.name || 'Unknown Item'}</td>
                        <td className="text-center">{item.quantity || 0}</td>
                        <td className="text-right hide-on-mobile">{formatCurrency(Number(item.price || 0))}</td>
                        <td className="text-right font-semibold">{formatCurrency(Number(item.quantity || 0) * Number(item.price || 0))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const PosConfigPanel: React.FC = () => {
  const { toast } = useToast();
  const [vatRate, setVatRate] = React.useState('15');
  const [serviceCharge, setServiceCharge] = React.useState('0');
  const [currency, setCurrency] = React.useState('$');
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    getPosSettings().then(s => {
      setVatRate(String(s.vat_rate * 100));
      setServiceCharge(String(s.service_charge * 100));
      setCurrency(s.currency_symbol);
      setLoading(false);
    });
  }, []);

  const handleSave = async () => {
    try {
      const { db } = await import('@/lib/db');
      const updates = [
        { key: 'vat_rate', value: String(Number(vatRate) / 100) },
        { key: 'service_charge', value: String(Number(serviceCharge) / 100) },
        { key: 'currency_symbol', value: currency }
      ];

      for (const { key, value } of updates) {
        await db.query(
          `INSERT INTO pos_settings (key, value) VALUES ($1, $2)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
          [key, value]
        );
      }

      toast({ title: 'Settings Saved', description: 'POS configuration has been updated.' });
    } catch (err) {
      console.error('Failed to save POS settings:', err);
      toast({ title: 'Error', description: 'Failed to save settings to database.', variant: 'destructive' });
    }
  };

  if (loading) return <div className="p-4 text-center">Loading configuration...</div>;

  return (
    <div className="space-y-6 max-w-md">
      <div className="grid gap-4">
        <div className="space-y-2">
          <Label htmlFor="vat-rate">VAT Rate (%)</Label>
          <Input 
            id="vat-rate" 
            type="number" 
            value={vatRate} 
            onChange={(e) => setVatRate(e.target.value)} 
            placeholder="15" 
          />
          <p className="text-[10px] text-gray-500">Standard VAT rate applied to all POS items.</p>
        </div>
        
        <div className="space-y-2">
          <Label htmlFor="service-charge">Service Charge (%)</Label>
          <Input 
            id="service-charge" 
            type="number" 
            value={serviceCharge} 
            onChange={(e) => setServiceCharge(e.target.value)} 
            placeholder="0" 
          />
          <p className="text-[10px] text-gray-500">Optional service charge added to the total bill.</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="currency-symbol">Currency Symbol</Label>
          <Select value={currency} onValueChange={setCurrency}>
            <SelectTrigger id="currency-symbol">
              <SelectValue placeholder="Select currency" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="$">USD ($)</SelectItem>
              <SelectItem value="ZiG">ZiG</SelectItem>
              <SelectItem value="R">ZAR (R)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Button className="w-full bg-indigo-600 text-white" onClick={handleSave}>
        Save POS Configuration
      </Button>
    </div>
  );
};

export const PosSettings: React.FC = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const isManager = canManagePOS(user?.role);
  const isAdminRole = isAdmin(user?.role);
  const [preselectedShift, setPreselectedShift] = React.useState<string | null>(null);
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
  const handleAddVendor = async () => {
    if (!vendorName.trim()) {
      toast({ title: 'Validation Error', description: 'Vendor name is required', variant: 'destructive' });
      return;
    }

    try {
      const newVendor = await vendors.addVendor(vendorName.trim(), 'USD', vendorTerms.trim() || 'Net 30');
      if (newVendor) {
        log('VENDOR_CREATE', { vendorId: newVendor.id, vendorName: newVendor.name });
        toast({ title: 'Success', description: `Vendor "${newVendor.name}" created successfully` });
      }

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
      { id: 'receipt-branding',  label: '🖨 Receipt Branding' },
      { id: 'station-management', label: '🏪 Cost Centres / Stations' },
      { id: 'user-management',   label: '👤 POS Users' },
      { id: 'pos-user-rights',   label: '🔐 User Rights & PIN' },
      { id: 'shift-reporting',   label: '📊 Shift Reports' },
      { id: 'pos-configuration',  label: '⚙️ POS Configuration' },
      { id: 'category-gaps',     label: '⚠ Category Gaps' },
      { id: 'data-migration',    label: '🔄 Data Migration' },
    ],
    menu: [
      { id: 'menu-categories',    label: '🏷 Menu Categories' },
      { id: 'sub-categories',     label: '🗂 Sub-Categories' },
      { id: 'cocktail-engineering', label: '🍹 Cocktail Engineering' },
    ],
    stock: [
      { id: 'stock-list',           label: '📦 Stock List' },
      { id: 'inventory-control',    label: '🔍 Inventory Control' },
      { id: 'printing-quick-updates', label: '🖨 Print / Quick Count' },
      { id: 'adjust-stock-quantities', label: '± Adjust Quantities' },
      { id: 'unit-management',      label: '📏 Units of Measure' },
    ],
    purchasing: [
      { id: 'suppliers', label: '🏢 Suppliers' },
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
      const shiftId = String(params.get('shift') || '').trim();
      const anchors = tabAnchors[init];
      const fallback = anchors.length ? anchors[0].id : '';
      setActiveSectionId(anchor || fallback);
      // Preselect shift if specified in URL and we're in the shift reporting section
      if (init === 'admin' && anchor === 'shift-reporting' && shiftId) {
        setPreselectedShift(shiftId);
      }
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

  const [sellingPrice, setSellingPrice] = React.useState<number>(0);
  const [costPrice, setCostPrice] = React.useState<number>(0);
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

  // Custom Units Management
  const [customUnits, setCustomUnits] = React.useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('corepms_custom_units');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [blacklistedUnits, setBlacklistedUnits] = React.useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('corepms_blacklisted_units');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [newUnitModalOpen, setNewUnitModalOpen] = React.useState(false);
  const [tempNewUnit, setTempNewUnit] = React.useState('');

  const handleAddCustomUnit = () => {
    const trimmed = tempNewUnit.trim();
    if (!trimmed) return;
    
    // If it's a standard unit and NOT hidden, just select it
    if (INITIAL_UNITS.includes(trimmed) && !blacklistedUnits.includes(trimmed)) {
      setUnitOfMeasure(trimmed);
      setNewUnitModalOpen(false);
      return;
    }

    // If it was hidden, show it again
    if (blacklistedUnits.includes(trimmed)) {
      const next = blacklistedUnits.filter(u => u !== trimmed);
      setBlacklistedUnits(next);
      localStorage.setItem('corepms_blacklisted_units', JSON.stringify(next));
      setUnitOfMeasure(trimmed);
      setNewUnitModalOpen(false);
      setTempNewUnit('');
      toast({ title: 'Unit restored', description: `Standard unit "${trimmed}" has been restored.` });
      return;
    }

    if (customUnits.includes(trimmed)) {
      setUnitOfMeasure(trimmed);
      setNewUnitModalOpen(false);
      return;
    }
    const next = [...customUnits, trimmed];
    setCustomUnits(next);
    localStorage.setItem('corepms_custom_units', JSON.stringify(next));
    setUnitOfMeasure(trimmed);
    setNewUnitModalOpen(false);
    setTempNewUnit('');
  };

  React.useEffect(() => {
    if (stockOpen && focusField) {
      const el = document.getElementById(focusField);
      if (el) {
        try { (el as HTMLInputElement).focus(); } catch { }
      }
    }
  }, [stockOpen, focusField]);

  const gpAmount   = React.useMemo(() => Math.max(0, sellingPrice - costPrice), [sellingPrice, costPrice]);
  const gpPercent  = React.useMemo(() => sellingPrice > 0 ? (gpAmount / sellingPrice) * 100 : 0, [gpAmount, sellingPrice]);
  const computedCOS = React.useMemo(() => sellingPrice > 0 ? (costPrice / sellingPrice) * 100 : 0, [costPrice, sellingPrice]);

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
    if (Number(it.sellingPrice || 0) <= 0) issues.push('Price ≤ 0');
    return issues;
  }, []);

  const [severityFilter, setSeverityFilter] = React.useState<'all' | 'critical' | 'minor'>('all');
  const getItemSeverity = React.useCallback((it: any): 'critical' | 'minor' | 'none' => {
    if (!String(it.name || '').trim()) return 'critical';
    if (!it.costCenter) return 'critical';
    if (Number(it.sellingPrice || 0) <= 0) return 'critical';
    return 'none';
  }, []);

   const resetForm = () => {
     setItemName('');
     setQtyReceived(0);
     setQtyInStock(0);
     setInventoryCategory('');
     setSellingPrice(0);
     setCostPrice(0);
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

  // Use inventory from DataContext instead of localStorage
  const { inventory, refreshData } = useData();

  React.useEffect(() => {
    if ((isManager || isAdminRole) && inventory) {
      setItems(inventory);
    }
  }, [inventory, isManager, isAdminRole]);

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
    if (sellingPrice <= 0) e.sellingPrice = 'Selling price must be greater than 0';
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

    // FIX: Auto-assign Bar visibility based on cost center
    // Items in bar-related cost centers show as Bar:Yes, Restaurant:No
    // Items in restaurant-related cost centers show as Bar:No, Restaurant:Yes
    const department = getCostCenterDepartment(costCenter);
    const isBarItem = department === 'Bar';
    const effectiveBarVisible = isBarItem ? true : false;
    const effectiveRestaurantVisible = isBarItem ? false : true;

    const base = {
      name: itemName.trim(),
      qtyReceived,
      qtyInStock,
      unitOfMeasure,
      sellingPrice: Number(sellingPrice.toFixed(2)),
      costPrice:    Number(costPrice.toFixed(2)),
      cost_price:   Number(costPrice.toFixed(2)),
      costCenter,
      // FIX: Include type field for proper department handling in sync
      type: department,
      inventoryCategory: inventoryCategory || undefined,
      // FIX: Use effective visibility with auto-assignment
      visibility: { bar: effectiveBarVisible, restaurant: effectiveRestaurantVisible },
      bar_visibility: effectiveBarVisible,
      restaurant_visibility: effectiveRestaurantVisible,
      cosPercent: Number(computedCOS.toFixed(2)),
      gpAmount:   Number(gpAmount.toFixed(2)),
      gpPercent:  Number(gpPercent.toFixed(2)),
      category_id: categoryId || null,
      sub_id: subId && subId !== 'none' ? subId : null,
      pictureName: pictureFile?.name || null,
      pictureData: picturePreview || null,
      imageBgColor,
      barcodes: scannedCodes.length ? scannedCodes : (barcode ? [barcode] : []),
      notes
    };
    try {
      // Use current items state as source of truth
      let next: any[] = items;
      let savedItem: any;

      if (editingId) {
        next = items.map((it: any) => it.id === editingId ? { ...it, ...base } : it);
        savedItem = next.find((it: any) => it.id === editingId);
        log('STOCK_ITEM_UPDATE', savedItem);
      } else {
        const item = { id: `ITEM_${Date.now()}`, ...base };
        next = [item, ...items];
        savedItem = item;
        log('STOCK_ITEM_CREATE', item);
      }

      // Update local state immediately (optimistic UI)
      setItems(next);
      // Persist to localStorage so performFullSync doesn't overwrite with stale data
      try { localStorage.setItem('corepms_pos_items', JSON.stringify(next)); } catch { }
      setStockOpen(false);
      resetForm();

      // Sync to database asynchronously
      if (savedItem) {
        syncPosItemToDb(savedItem).then(result => {
          if (!result.success) {
            console.warn('[PosSettings] Database sync failed:', result.error);
            toast({ title: 'Sync failed', description: result.error, variant: 'destructive' });
            // Optionally revert state here if needed
          } else {
            toast({ title: 'Saved', description: 'Item saved to database.' });
            // Reload inventory from DB so DataContext stays in sync
            refreshData?.();
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
    setSellingPrice(Number(it.sellingPrice) || 0);
    setCostPrice(Number(it.costPrice ?? it.cost_price ?? 0));
    setCostCenter(it.costCenter || '');
    setCategoryId(String(it.category_id || ''));
    setSubId(String(it.sub_id || 'none'));
    setInventoryCategory((it.inventoryCategory as any) || (getCostCenterDepartment(it.costCenter) === 'Bar' ? 'cellar' : 'kitchen'));

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
    else if (issues.includes('Price ≤ 0')) field = 'sellingPrice';
    else if (issues.includes('COS out of range')) field = 'cosPercent';
    setFocusField(field);
    startEdit(it);
  };

  const deleteItem = async (id: string) => {
    try {
      // Optimistic delete from UI
      const previousItems = [...items];
      const next = items.filter((it: any) => it.id !== id);
      setItems(next);
      localStorage.setItem('corepms_pos_items', JSON.stringify(next));

      const result = await deletePosItemFromDb(id);
      if (!result.success) {
        // Revert on failure
        setItems(previousItems);
        localStorage.setItem('corepms_pos_items', JSON.stringify(previousItems));
        console.warn('[PosSettings] Database delete failed:', result.error);
        toast({ title: 'Delete failed', description: result.error, variant: 'destructive' });
      } else {
        toast({ title: 'Deleted', description: 'Item removed from database.' });
        log('STOCK_ITEM_DELETE', { id });
        refreshData?.();
      }
    } catch (err) {
      console.error(err);
      toast({ title: 'Error', description: 'Could not delete item.', variant: 'destructive' });
    }
  };

  const bulkDeleteItems = async (ids: string[]) => {
    try {
      const previousItems = [...items];
      const next = items.filter((it: any) => !ids.includes(it.id));
      setItems(next);
      localStorage.setItem('corepms_pos_items', JSON.stringify(next));

      const result = await deletePosItemsFromDb(ids);
      if (!result.success) {
        setItems(previousItems);
        localStorage.setItem('corepms_pos_items', JSON.stringify(previousItems));
        toast({ title: 'Bulk delete failed', description: result.error, variant: 'destructive' });
      } else {
        toast({ title: 'Success', description: `${ids.length} items deleted.` });
        log('STOCK_ITEMS_BULK_DELETE', { count: ids.length });
        refreshData?.();
      }
    } catch (err) {
      console.error(err);
      toast({ title: 'Error', description: 'Could not delete items.', variant: 'destructive' });
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
      const headers = ['ID', 'Name', 'Center', 'CategoryId', 'CategoryName', 'SellingPrice', 'QtyInStock', 'QtyReceived', 'BarVisible', 'RestaurantVisible', 'COSPercent', 'GPAmount', 'GPPercent', 'Notes', 'TotalValue'];
      const rows = data.map((it: any) => {
        const selling = Number(it.sellingPrice || 0);
        const qty = Number(it.qtyInStock || 0);
        const totalValue = selling * qty;
        const cat = it.category_id ? menuCats.getCategoryById(String(it.category_id)) : undefined;
        const values = [
          it.id,
          it.name || '',
          it.costCenter || '',
          String(it.category_id || ''),
          cat?.category_name || '',
          selling.toFixed(2),
          qty,
          Number(it.qtyReceived || 0),
          it.visibility?.bar ? 'Yes' : 'No',
          it.visibility?.restaurant ? 'Yes' : 'No',
          Number(it.cosPercent || 0).toFixed(2),
          Number(it.gpAmount || 0).toFixed(2),
          Number(it.gpPercent || 0).toFixed(2),
          it.notes ? String(it.notes).replace(/\r?\n/g, ' ') : '',
          totalValue.toFixed(2)
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

  const [importSummary, setImportSummary] = React.useState<{ imported: number; created: number; updated: number; errors: string[]; total: number; pendingCategoryReview?: number } | null>(null);
  const [lastImportSummary, setLastImportSummary] = React.useState<{ imported: number; created: number; updated: number; errors: string[]; total: number; pendingCategoryReview?: number } | null>(null);
  const [pendingCategoryQueue, setPendingCategoryQueue] = React.useState<any[]>([]);
  const [showPendingQueue, setShowPendingQueue] = React.useState(false);

  // Load pending category queue on mount
  React.useEffect(() => {
    try {
      const queue = JSON.parse(localStorage.getItem('corepms_pending_category_queue') || '[]');
      setPendingCategoryQueue(queue);
    } catch { }
  }, []);

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
        const idx = (...names: string[]) => headers.findIndex(h => names.some(n => h.toLowerCase() === n.toLowerCase()));
        const idIdx = idx('ID', 'Code');
        const nameIdx = idx('Name', 'Item', 'Description');
        const centerIdx = idx('Center', 'Type', 'CostCenter');
        const invcatIdx = idx('InventoryCategory', 'Cat');
        const catIdIdx = idx('CategoryId', 'CatId');
        const catNameIdx = idx('CategoryName', 'Category', 'SubCategory');
        const sellIdx = idx('SellingPrice', 'Selling', 'Price', 'Retail');
        const costIdx = idx('CostPrice', 'Cost', 'Buy');
        const stockIdx = idx('QtyInStock', 'Qty', 'Stock', 'Count');
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
          const qtyInStock = Number(cols[stockIdx] || 0);
          const qtyReceived = Number(cols[recvIdx] || 0);
          const parseBool = (val: string) => {
            const v = String(val || '').trim().toLowerCase();
            return ['y', 'yes', 'true', '1', 'on'].includes(v);
          };

          const barVisible = parseBool(cols[barIdx]);
          const restaurantVisible = parseBool(cols[restIdx]);
          const cosPercent = 0;
          const gpAmount = 0;
          const gpPercent = 0;
          const notes = cols[notesIdx] || '';
          const id = cols[idIdx] || `ITEM_${Date.now()}_${i}`;
          // Resolve category with intelligent mapping and pending queue support
          let category_id: string | null = null;
          let pendingCategoryReview = false;
          const catIdVal = catIdIdx >= 0 ? (cols[catIdIdx] || '').trim() : '';
          const catNameVal = catNameIdx >= 0 ? (cols[catNameIdx] || '').trim() : '';

          // Default category IDs for fallback
          const defaultBarCategory = 'CAT_BAR_GEN';
          const defaultRestCategory = 'CAT_REST_GEN';

          if (catIdVal) {
            // Validate that the category_id exists
            const dept = getCostCenterDepartment(costCenter);
            const existingCat = menuCats.listCategories(dept).find(c => c.category_id === catIdVal);
            if (existingCat) {
              category_id = catIdVal;
            } else {
              // Category ID doesn't exist - mark for pending review
              category_id = dept === 'Bar' ? defaultBarCategory : defaultRestCategory;
              pendingCategoryReview = true;
              // Store pending category mapping for later review
              const pendingQueue = JSON.parse(localStorage.getItem('corepms_pending_category_queue') || '[]');
              pendingQueue.push({
                itemId: id,
                itemName: name,
                requestedCategoryId: catIdVal,
                assignedCategoryId: category_id,
                department: costCenter,
                timestamp: new Date().toISOString()
              });
              localStorage.setItem('corepms_pending_category_queue', JSON.stringify(pendingQueue.slice(-100)));
            }
          } else if (catNameVal) {
            // Try to match by category name
            const dept = getCostCenterDepartment(costCenter);
            const found = menuCats.listCategories(dept).find(c => c.category_name.toLowerCase() === catNameVal.toLowerCase());
            if (found) {
              category_id = found.category_id;
            } else {
              // Category name doesn't exist - try fuzzy matching
              const allCats = menuCats.listCategories(dept);
              const fuzzyMatch = allCats.find(c =>
                c.category_name.toLowerCase().includes(catNameVal.toLowerCase()) ||
                catNameVal.toLowerCase().includes(c.category_name.toLowerCase())
              );
              if (fuzzyMatch) {
                category_id = fuzzyMatch.category_id;
              } else {
                // Assign to default category and mark for review
                category_id = dept === 'Bar' ? defaultBarCategory : defaultRestCategory;
                pendingCategoryReview = true;
                // Store pending category mapping for later review
                const pendingQueue = JSON.parse(localStorage.getItem('corepms_pending_category_queue') || '[]');
                pendingQueue.push({
                  itemId: id,
                  itemName: name,
                  requestedCategoryName: catNameVal,
                  assignedCategoryId: category_id,
                  department: costCenter,
                  timestamp: new Date().toISOString()
                });
                localStorage.setItem('corepms_pending_category_queue', JSON.stringify(pendingQueue.slice(-100)));
              }
            }
          } else {
            // No category specified - assign default based on cost center
            const dept = getCostCenterDepartment(costCenter);
            category_id = dept === 'Bar' ? defaultBarCategory : defaultRestCategory;
          }
          // InventoryCategory parsing
          let inventoryCategory: 'kitchen' | 'cellar' | undefined = undefined;
          const invRaw = invcatIdx >= 0 ? (cols[invcatIdx] || '').trim().toLowerCase() : '';
          if (invRaw === 'kitchen') inventoryCategory = 'kitchen';
          else if (invRaw === 'cellar') inventoryCategory = 'cellar';
          else inventoryCategory = getCostCenterDepartment(costCenter) === 'Bar' ? 'cellar' : 'kitchen';

          parsed.push({ id, name, costCenter, inventoryCategory, sellingPrice, qtyInStock, qtyReceived, visibility: { bar: barVisible, restaurant: restaurantVisible }, cosPercent, gpAmount, gpPercent, notes, category_id });
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

        // SYNC TO DATABASE (BLOCKING)
        // ensureTablesExist and syncPosItemToDb are async
        try {
          toast({ title: 'Syncing to Cloud...', description: `Uploading ${parsed.length} items to database. Please wait...`, duration: 5000 });
          await ensureTablesExist();

          let dbSynced = 0;
          const dbErrors: string[] = [];

          for (const item of parsed) {
            const res = await syncPosItemToDb(item);
            if (res.success) dbSynced++;
            else if (res.error) dbErrors.push(`${item.name}: ${res.error}`);
          }

          if (dbErrors.length > 0) {
            console.warn('Import sync errors:', dbErrors);
            errors.push(...dbErrors.map(e => `Cloud Sync: ${e}`));
            toast({ title: 'Import Complete with Errors', description: `Synced ${dbSynced}/${parsed.length} to cloud. Some failed.`, variant: 'destructive' });
          } else {
            toast({ title: 'Cloud Sync Successful', description: `All ${dbSynced} items verified in cloud database.` });
          }
        } catch (err) {
          console.error('Cloud sync failed:', err);
          errors.push(`Cloud Sync Critical Failure: ${String(err)}`);
          toast({ title: 'Cloud Sync Failed', description: 'Could not connect to database.', variant: 'destructive' });
        }

        // Get updated pending queue count
        const currentPendingQueue = JSON.parse(localStorage.getItem('corepms_pending_category_queue') || '[]');
        const pendingCategoryReview = currentPendingQueue.length;

        const summary = { imported: parsed.length, created, updated, errors, total: next.length, pendingCategoryReview };
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
        // FIX: Don't overwrite explicit visibility settings - only set defaults if undefined
        // This preserves user-assigned visibility values
        const vis = {
          bar: it.visibility?.bar !== undefined ? !!it.visibility?.bar : (isBar ? true : !!it.visibility?.bar),
          restaurant: it.visibility?.restaurant !== undefined ? !!it.visibility?.restaurant : (center === 'restaurant' ? true : !!it.visibility?.restaurant),
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

  // FIX: Function to fix visibility in database - corrects items with incorrect visibility settings
  const fixVisibilityInDatabase = async () => {
    toast({ title: 'Fixing visibility...', description: 'This may take a moment', duration: 2000 });
    try {
      const result = await fixAllItemsVisibility();
      if (result.success) {
        toast({ title: 'Visibility fixed', description: `Fixed ${result.synced} items in database`, duration: 3000 });
        // Reload data from database
        refreshData?.();
      } else {
        toast({ title: 'Fix failed', description: result.error || 'Unknown error', variant: 'destructive' });
      }
    } catch (err) {
      console.error('[PosSettings] Fix visibility error:', err);
      toast({ title: 'Fix error', description: String(err), variant: 'destructive' });
    }
  };

  // FIX: Function to fix a specific item (e.g., ABSOLUTE VODKA)
  const fixSpecificItem = async (itemId: string, itemName: string, targetCostCenter: string, targetVisibility: { bar: boolean; restaurant: boolean }) => {
    toast({ title: 'Fixing item...', description: `Updating ${itemName}`, duration: 2000 });
    try {
      const result = await fixItemVisibility(itemId, targetCostCenter, targetVisibility);
      if (result.success) {
        toast({ title: 'Item fixed', description: `${itemName} updated successfully`, duration: 3000 });
        // Reload data from database
        refreshData?.();
      } else {
        toast({ title: 'Fix failed', description: result.error || 'Unknown error', variant: 'destructive' });
      }
    } catch (err) {
      console.error('[PosSettings] Fix item error:', err);
      toast({ title: 'Fix error', description: String(err), variant: 'destructive' });
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
                    <SelectItem value="flamehouse_bar">Flamehouse Bar</SelectItem>
                    <SelectItem value="flamehouse_kitchen">Flamehouse Kitchen</SelectItem>
                    <SelectItem value="conference_bar">Conference Bar</SelectItem>
                    <SelectItem value="conference_kitchen">Conference Kitchen</SelectItem>
                    <SelectItem value="beverage_cellar">Beverage Cellar</SelectItem>
                    <SelectItem value="dry_goods">Dry Goods Store</SelectItem>
                    <SelectItem value="freezer_perishable">Freezer and Perishable</SelectItem>
                    <SelectItem value="general_stores">General Stores</SelectItem>
                    <SelectItem value="maintenance_stores">Maintenance Stores</SelectItem>
                    <SelectItem value="fb_service_stocks">F&B Service Stocks</SelectItem>
                    <SelectItem value="kitchen_utensils">Kitchen Utensils</SelectItem>
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
                    {menuCats.listCategories(costCenter ? getCostCenterDepartment(costCenter) : 'Bar').map(c => (
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
                <Select value={unitOfMeasure || undefined} onValueChange={(v) => {
                  if (v === 'ADD_CUSTOM') {
                    setNewUnitModalOpen(true);
                  } else {
                    setUnitOfMeasure(v);
                  }
                }}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select unit" />
                  </SelectTrigger>
                  <SelectContent>
                    {getVisibleUnits(blacklistedUnits).map(u => (
                      <SelectItem key={u} value={u}>{u}</SelectItem>
                    ))}
                    {customUnits.map(u => (
                      <SelectItem key={u} value={u}>{u}</SelectItem>
                    ))}
                    <div className="border-t mt-1 pt-1">
                      <SelectItem value="ADD_CUSTOM" className="text-blue-600 font-bold">+ Add New Unit...</SelectItem>
                    </div>
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


              {/* ── Pricing block ── */}
              <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-3 gap-3 p-3 rounded-lg border border-gray-200 bg-gray-50">
                <div>
                  <label className="text-xs font-semibold text-purple-700">
                    Selling Price <span className="text-[10px] font-normal text-purple-500">(shown on POS)</span>
                  </label>
                  <Input
                    id="sellingPrice"
                    type="number"
                    min={0}
                    step="0.01"
                    value={sellingPrice}
                    onChange={(e) => setSellingPrice(Number(e.target.value))}
                    className="border-purple-300 focus:ring-purple-400 mt-1"
                  />
                  {errors.sellingPrice && <div className="text-xs text-red-600 mt-1">{errors.sellingPrice}</div>}
                </div>

                <div>
                  <label className="text-xs font-semibold text-gray-600">
                    Cost Price <span className="text-[10px] font-normal text-gray-400">optional · internal only</span>
                  </label>
                  <Input
                    id="costPrice"
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="0.00 (optional)"
                    value={costPrice || ''}
                    onChange={(e) => setCostPrice(e.target.value === '' ? 0 : Number(e.target.value))}
                    className="border-gray-300 mt-1"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-green-700">
                    GP% <span className="text-[10px] font-normal text-green-500">(auto-calculated)</span>
                  </label>
                  <Input
                    type="number"
                    readOnly
                    value={Number(gpPercent.toFixed(1))}
                    className="bg-green-50 border-green-200 text-green-800 font-semibold mt-1"
                  />
                  {sellingPrice > 0 && costPrice > 0 && (
                    <div className="text-[10px] text-gray-500 mt-1">
                      Margin: ${gpAmount.toFixed(2)} &nbsp;·&nbsp; COS: {computedCOS.toFixed(1)}%
                    </div>
                  )}
                </div>
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

            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setStockOpen(false); }}>Cancel</Button>
            <Button className="bg-indigo-600 text-white" onClick={saveStockItem}>Save Item</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New Unit of Measure Dialog */}
      <Dialog open={newUnitModalOpen} onOpenChange={setNewUnitModalOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Custom Unit of Measure</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs">Unit Name</Label>
              <Input 
                value={tempNewUnit} 
                onChange={(e) => setTempNewUnit(e.target.value)} 
                placeholder="e.g. Keg, Case of 24" 
                onKeyDown={(e) => e.key === 'Enter' && handleAddCustomUnit()}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setNewUnitModalOpen(false); setTempNewUnit(''); }}>Cancel</Button>
            <Button className="bg-indigo-600 text-white" onClick={handleAddCustomUnit}>Add Unit</Button>
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
                    const dept: 'Bar' | 'Restaurant' | null = getCostCenterDepartment(it.costCenter);
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
              <div className="space-y-2 mt-2">
                <div className="ds-table-container">
                  <table className="ds-table">
                    <thead><tr><th scope="col">ID</th><th scope="col">Name</th><th scope="col" className="hide-on-mobile">Center</th><th scope="col">subCategory</th></tr></thead>
                    <tbody>
                      {gaps.map((it: any) => (
                        <tr key={it.id}>
                          <td className="font-mono text-xs">{it.id}</td>
                          <td>{it.name}</td>
                          <td className="hide-on-mobile">{it.costCenter || '—'}</td>
                          <td>{String(it.subCategory || '—')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="text-xs text-red-700">Missing categories: <span className="font-semibold">{gaps.length}</span></div>
              </div>
            );
          })()}
        </Section>
      )}

      {activeTab === 'admin' && activeSectionId === 'station-management' && (
        <Section id="station-management" title="Station Management (Cost Centres)">
          <div className="text-xs text-gray-600 mb-2">Configure POS outlets and cost centres. These stations will be available for shift selection and order tracking.</div>
          <StationManagementPanel />
        </Section>
      )}

      {activeTab === 'admin' && activeSectionId === 'user-management' && (
        <Section id="user-management" title="POS User Management">
          <UserManagementPanel />
        </Section>
      )}

      {activeTab === 'admin' && activeSectionId === 'shift-reporting' && (
        <Section id="shift-reporting" title="Shift & Activity Reports">
          <ShiftReportingPanel />
        </Section>
      )}

      {activeTab === 'admin' && activeSectionId === 'pos-configuration' && (
        <Section id="pos-configuration" title="POS System Configuration">
          <div className="text-xs text-gray-600 mb-4">Set global financial parameters for the POS system including tax rates and currency.</div>
          <PosConfigPanel />
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
                {(importSummary.pendingCategoryReview ?? 0) > 0 && (
                  <div className="col-span-2 mt-2 p-2 bg-yellow-50 border border-yellow-200 rounded">
                    <div className="font-semibold text-yellow-800">
                      Pending Category Review: {importSummary.pendingCategoryReview} items
                    </div>
                    <div className="text-xs text-yellow-700 mt-1">
                      These items were assigned to default categories because their requested categories don't exist. Review and assign proper categories.
                    </div>
                  </div>
                )}
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
            onBulkDelete={(ids) => requireManager('DELETE_ITEM', () => bulkDeleteItems(ids))}
          />
        </Section>
      )}

{/* stock-controls section removed — functionality merged into adjust-stock-quantities */}

      {/* Unit of Measure Management */}
      {activeTab === 'stock' && activeSectionId === 'unit-management' && (
        <Section id="unit-management" title="Unit of Measure Management">
          <div className="text-xs text-gray-600 mb-4">Manage the units of measure available when setting up stock items.</div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div>
              <h4 className="text-sm font-bold mb-2">Standard Units (Built-in)</h4>
              <div className="flex flex-wrap gap-2">
                {INITIAL_UNITS.map(u => {
                  const isHidden = blacklistedUnits.includes(u);
                  return (
                    <div key={u} className={`flex items-center gap-1 px-2 py-1 rounded-full border transition-all ${isHidden ? 'bg-gray-50 text-gray-400 border-gray-100 opacity-50' : 'bg-gray-100 text-gray-700 border-gray-200'}`}>
                      <span className="text-[11px]">{u}</span>
                      <button 
                        className={`ml-1 hover:text-red-500 transition-colors ${isHidden ? 'hidden' : ''}`}
                        title="Hide standard unit"
                        onClick={() => {
                          const next = [...blacklistedUnits, u];
                          setBlacklistedUnits(next);
                          localStorage.setItem('corepms_blacklisted_units', JSON.stringify(next));
                          toast({ title: 'Unit hidden', description: `Standard unit "${u}" has been hidden.` });
                        }}
                      >
                        <span className="text-[10px]">✕</span>
                      </button>
                      {isHidden && (
                        <button 
                          className="ml-1 text-blue-500 hover:text-blue-600 text-[10px] font-bold"
                          title="Restore unit"
                          onClick={() => {
                            const next = blacklistedUnits.filter(x => x !== u);
                            setBlacklistedUnits(next);
                            localStorage.setItem('corepms_blacklisted_units', JSON.stringify(next));
                            toast({ title: 'Unit restored', description: `"${u}" is now visible again.` });
                          }}
                        >
                          ↺
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-bold">Custom Units</h4>
                <Button variant="ghost" size="sm" className="text-blue-600 text-[10px] h-6" onClick={() => { setNewUnitModalOpen(true); setTempNewUnit(''); }}>+ Add New</Button>
              </div>
              {customUnits.length === 0 ? (
                <div className="text-xs text-gray-500 italic p-4 border border-dashed rounded text-center">No custom units added yet. Use the button above or "Add New" in the stock item setup.</div>
              ) : (
                <div className="space-y-1">
                  {customUnits.map(u => (
                    <div key={u} className="flex items-center justify-between px-3 py-2 bg-slate-50 rounded border border-slate-200 group hover:border-slate-300 transition-colors">
                      <span className="text-xs font-semibold">{u}</span>
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="h-6 w-6 p-0 text-red-500 hover:bg-red-50 hover:text-red-600 transition-opacity"
                        onClick={() => {
                          const next = customUnits.filter(x => x !== u);
                          setCustomUnits(next);
                          localStorage.setItem('corepms_custom_units', JSON.stringify(next));
                          toast({ title: 'Unit removed', description: `"${u}" has been deleted.` });
                        }}
                      >
                        ✕
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
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
                    await ensureTablesExist();
                    const res = await performFullSync();
                    if (res.success) {
                      toast({ title: 'Sync Complete', description: `Successfully synced ${res.synced} items.` });
                    } else {
                      toast({ title: 'Sync Failed', description: `Error: ${res.error}. Check console for details.`, variant: 'destructive' });
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
                              ? getCostCenterDepartment(it.costCenter) === 'Bar'
                              : getCostCenterDepartment(it.costCenter) === 'Restaurant';
                        return nameOk && centerOk && barOk && restOk && attentionOk && severityOk && quickOk;
                      });
                    const count = filtered.length;
                    const prices = filtered.map((it) => Number(it.sellingPrice || 0));
                    const gpPercents = filtered.map((it) => Number(it.gpPercent || 0));
                    const avgGp = count ? (gpPercents.reduce((a, b) => a + b, 0) / count) : 0;
                    const minPrice = count ? Math.min(...prices) : 0;
                    const maxPrice = count ? Math.max(...prices) : 0;
                    const totalValue = filtered.reduce((acc, it) => acc + Number(it.sellingPrice || 0) * Number(it.qtyInStock || 0), 0);
                    return `Items: ${count} • Avg GP: ${avgGp.toFixed(2)}% • Min: ${formatCurrency(minPrice)} • Max: ${formatCurrency(maxPrice)} • Total Value: ${formatCurrency(totalValue)}`;
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
            {activeTab === 'stock' && activeSectionId === 'printing-quick-updates' && (
              <div id="printing-quick-updates" className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="p-3 border rounded">
                  <div className="font-semibold mb-2 text-sm">Print Stock Sheet</div>
                  <Button variant="outline" onClick={async () => {
                    try {
                      const { db: dbLib } = await import('@/lib/db');
                      const res = await dbLib.query(
                        `SELECT name, department, price, cost_price, stock_level, unit
                         FROM products WHERE active = true ORDER BY department, name`
                      );
                      const dbItems = ('rows' in res && Array.isArray(res.rows)) ? res.rows : [];
                      const rows = dbItems.map((it: any) =>
                        `<tr><td>${it.name}</td><td>${it.department||''}</td><td>${Number(it.stock_level||0)}</td><td>${it.unit||''}</td><td>$${Number(it.price||0).toFixed(2)}</td><td>$${Number(it.cost_price||0).toFixed(2)}</td></tr>`
                      ).join('');
                      const html = `<!doctype html><html><head><title>Stock Sheet — ${new Date().toLocaleDateString()}</title><style>body{font-family:Arial;padding:20px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccc;padding:6px;font-size:12px}th{background:#f3f4f6}h2{margin-bottom:12px}</style></head><body><h2>Stock Sheet — ${new Date().toLocaleDateString()}</h2><table><thead><tr><th>Item</th><th>Dept</th><th>On Hand</th><th>Unit</th><th>Sell Price</th><th>Cost Price</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
                      const win = window.open('', '_blank');
                      if (win) { win.document.write(html); win.document.close(); win.print(); }
                      log('STOCK_SHEET_PRINT');
                    } catch (err) {
                      alert('Failed to prepare stock sheet: ' + String(err));
                    }
                  }}>🖨 Print Stock Sheet</Button>
                </div>
                <div className="p-3 border rounded">
                  <div className="font-semibold mb-2 text-sm">Quick Stock Count</div>
                  <p className="text-xs text-gray-500 mb-2">Set the exact on-hand quantity for an item (replaces current value).</p>
                  <Input id="quickCountName" placeholder="Item name (exact)" />
                  <Input id="quickCountQty" type="number" min={0} placeholder="New quantity" className="mt-1" />
                  <Button className="mt-2" onClick={async () => {
                    try {
                      const name = (document.getElementById('quickCountName') as HTMLInputElement)?.value?.trim() || '';
                      const qty  = Number((document.getElementById('quickCountQty') as HTMLInputElement)?.value || 0);
                      if (!name) { toast({ title: 'Enter item name', variant: 'destructive' }); return; }
                      const { db: dbLib } = await import('@/lib/db');
                      const r = await dbLib.query(
                        `UPDATE products SET stock_level = $1, updated_at = NOW()
                         WHERE LOWER(name) = LOWER($2) RETURNING id, name, stock_level`,
                        [qty, name]
                      );
                      const updated = ('rows' in r && r.rows.length) ? r.rows.length : 0;
                      if (!updated) { toast({ title: 'Item not found', description: `No item matching "${name}"`, variant: 'destructive' }); return; }
                      toast({ title: 'Stock updated', description: `${name} set to ${qty}` });
                      log('STOCK_COUNT_UPDATE', { name, qty });
                    } catch (err) {
                      toast({ title: 'Failed', description: String(err), variant: 'destructive' });
                    }
                  }}>Set Count</Button>
                </div>
                <div id="adjust-stock-quantities" className="p-3 border rounded">
                  <div className="font-semibold mb-2 text-sm">Adjust Quantity (±)</div>
                  <p className="text-xs text-gray-500 mb-2">Add or subtract from current stock level.</p>
                  <Input id="quickUpdateName" placeholder="Item name (exact)" />
                  <Input id="quickUpdateDelta" type="number" placeholder="e.g. +5 or -3" className="mt-1" />
                  <Button className="mt-2" onClick={async () => {
                    try {
                      const name  = (document.getElementById('quickUpdateName') as HTMLInputElement)?.value?.trim() || '';
                      const delta = Number((document.getElementById('quickUpdateDelta') as HTMLInputElement)?.value || 0);
                      if (!name) { toast({ title: 'Enter item name', variant: 'destructive' }); return; }
                      const { db: dbLib } = await import('@/lib/db');
                      const r = await dbLib.query(
                        `UPDATE products SET stock_level = GREATEST(0, stock_level + $1), updated_at = NOW()
                         WHERE LOWER(name) = LOWER($2) RETURNING id, name, stock_level`,
                        [delta, name]
                      );
                      const updated = ('rows' in r && r.rows.length) ? r.rows.length : 0;
                      if (!updated) { toast({ title: 'Item not found', description: `No item matching "${name}"`, variant: 'destructive' }); return; }
                      const newQty = ('rows' in r) ? r.rows[0]?.stock_level : '?';
                      toast({ title: 'Stock adjusted', description: `${name} → ${newQty}` });
                      log('INVENTORY_QUICK_UPDATE', { name, delta });
                    } catch (err) {
                      toast({ title: 'Failed', description: String(err), variant: 'destructive' });
                    }
                  }}>Apply Adjustment</Button>
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
              <div className="ds-table-container">
                <table className="ds-table">
                  <thead>
                    <tr>
                      <th scope="col">Date</th>
                      <th scope="col">Item</th>
                      <th scope="col">Qty</th>
                      <th scope="col" className="text-right">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const raw = localStorage.getItem('corepms_purchases');
                      const list = raw ? JSON.parse(raw) : [];
                      if (!list.length) return (<tr><td colSpan={4} className="text-center py-4 text-gray-500">No purchases yet</td></tr>);
                      return list.slice(0, 50).map((p: any) => (
                        <tr key={p.id}>
                          <td>{new Date(p.date).toLocaleString()}</td>
                          <td>{p.item}</td>
                          <td>{p.qty}</td>
                          <td className="text-right font-mono">{formatCurrency(Number(p.cost || 0))}</td>
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
              <div className="ds-table-container">
                <table className="ds-table">
                  <thead>
                    <tr>
                      <th scope="col">Name</th>
                      <th scope="col" className="hide-on-mobile">Contact</th>
                      <th scope="col" className="text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const raw = localStorage.getItem('corepms_suppliers');
                      const list = raw ? JSON.parse(raw) : [];
                      if (!list.length) return (<tr><td colSpan={3} className="text-center py-4 text-gray-500">No suppliers</td></tr>);
                      return list.slice(0, 50).map((s: any) => (
                        <tr key={s.id}>
                          <td>{s.name}</td>
                          <td className="hide-on-mobile">{s.contact}</td>
                          <td>
                            <div className="flex gap-1 justify-center">
                              <Button variant="outline" className="ds-button-compact" onClick={() => {
                                const name = prompt('Edit name', s.name) || s.name;
                                const contact = prompt('Edit contact', s.contact) || s.contact;
                                const raw2 = localStorage.getItem('corepms_suppliers');
                                const list2 = raw2 ? JSON.parse(raw2) : [];
                                localStorage.setItem('corepms_suppliers', JSON.stringify(list2.map((x: any) => x.id === s.id ? { ...x, name, contact } : x)));
                                log('SUPPLIER_EDIT', { id: s.id });
                              }}>Edit</Button>
                              <Button variant="destructive" className="ds-button-compact" onClick={() => {
                                const raw2 = localStorage.getItem('corepms_suppliers');
                                const list2 = raw2 ? JSON.parse(raw2) : [];
                                localStorage.setItem('corepms_suppliers', JSON.stringify(list2.filter((x: any) => x.id !== s.id)));
                                log('SUPPLIER_DELETE', { id: s.id });
                              }}>Delete</Button>
                            </div>
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

      {activeTab === 'admin' && activeSectionId === 'pos-reporting-tools' && (
        <Section id="pos-reporting-tools" title="POS Reporting Tools">
          <PosReports />
        </Section>
      )}

{/* purchasing-config stub removed — vendor management is in the Suppliers section */}

{/* stock-level-monitoring removed — stock levels are managed in the Stock List section */}

      {activeTab === 'menu' && (
        <Section id="cocktail-engineering" title="Cocktail Engineering">
          <CocktailEngineering />
        </Section>
      )}
    </div>
  );
};

export default PosSettings;
