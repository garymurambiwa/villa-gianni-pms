import { syncCategoryToDb, deleteCategoryFromDb, syncSubcategoryToDb, deleteSubcategoryFromDb } from './dbSync';

export interface MenuCategory {
  category_id: string;
  category_name: string;
  department: 'Bar' | 'Restaurant';
  sort_order?: number;
  buttonColor?: string; // CSS color (hex/rgb/hsl)
  textColor?: string;   // CSS color (hex/rgb/hsl)
}

export interface SubCategory {
  sub_id: string;
  name: string;
  category_id: string;        // parent category
  parent_sub_id?: string;     // supports multi-level nesting
  description?: string;
  sort_order?: number;
}

const K_CATEGORIES = 'corepms_pos_categories';
const K_SUBCATS = 'corepms_pos_subcategories';

const readJSON = <T>(key: string, fallback: T): T => {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; }
};
const writeJSON = (key: string, value: any) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { } };

export const listCategories = (department?: 'Bar' | 'Restaurant'): MenuCategory[] => {
  const DEFAULTS: MenuCategory[] = [
    { category_id: 'CAT_BAR_GEN', category_name: 'General', department: 'Bar', sort_order: 0, buttonColor: '#4f46e5', textColor: '#ffffff' },
    { category_id: 'CAT_REST_GEN', category_name: 'General', department: 'Restaurant', sort_order: 0, buttonColor: '#10b981', textColor: '#ffffff' },
    { category_id: 'CAT_BAR_BEV', category_name: 'Soft Drinks', department: 'Bar', sort_order: 1, buttonColor: '#3b82f6', textColor: '#ffffff' },
    { category_id: 'CAT_BAR_ALC', category_name: 'Beer & Alcohol', department: 'Bar', sort_order: 2, buttonColor: '#ef4444', textColor: '#ffffff' },
    { category_id: 'CAT_REST_MAIN', category_name: 'Mains', department: 'Restaurant', sort_order: 1, buttonColor: '#f59e0b', textColor: '#ffffff' }
  ];
  const rows = readJSON<MenuCategory[]>(K_CATEGORIES, DEFAULTS);
  if (rows.length === 0) return DEFAULTS;
  const filtered = department ? rows.filter(r => r.department === department) : rows;
  return filtered.slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.category_name.localeCompare(b.category_name));
};

export const addCategory = (payload: Omit<MenuCategory, 'category_id'> & { category_id?: string }): MenuCategory => {
  const id = payload.category_id || `CAT_${Date.now()}`;
  const row: MenuCategory = {
    category_id: id,
    category_name: payload.category_name,
    department: payload.department,
    sort_order: payload.sort_order,
    buttonColor: payload.buttonColor,
    textColor: payload.textColor,
  };
  const list = readJSON<MenuCategory[]>(K_CATEGORIES, []);
  const existIdx = list.findIndex(c => c.category_id === id);
  const next = existIdx >= 0 ? list.map(c => c.category_id === id ? row : c) : [row, ...list];
  writeJSON(K_CATEGORIES, next);
  syncCategoryToDb(row).catch(err => console.error('[menuCats] DB sync failed:', err));
  return row;
};

export const setCategories = (rows: MenuCategory[]) => writeJSON(K_CATEGORIES, rows);
export const getCategoryById = (id: string): MenuCategory | undefined => listCategories().find(c => c.category_id === id);

export const deleteCategory = (category_id: string) => {
  const list = readJSON<MenuCategory[]>(K_CATEGORIES, []);
  const next = list.filter(c => c.category_id !== category_id);
  writeJSON(K_CATEGORIES, next);
  deleteCategoryFromDb(category_id).catch(err => console.error('[menuCats] DB delete failed:', err));
};

// SubCategories CRUD and tree helpers
export const listSubcategories = (category_id?: string, parent_sub_id?: string): SubCategory[] => {
  const rows = readJSON<SubCategory[]>(K_SUBCATS, []);
  let filtered = rows;
  if (category_id) filtered = filtered.filter(r => r.category_id === category_id);
  if (typeof parent_sub_id !== 'undefined') filtered = filtered.filter(r => r.parent_sub_id === parent_sub_id);
  return filtered.slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name));
};

export const addSubcategory = (payload: Omit<SubCategory, 'sub_id'> & { sub_id?: string }): SubCategory => {
  const id = payload.sub_id || `SUB_${Date.now()}`;
  const row: SubCategory = { sub_id: id, name: payload.name, category_id: payload.category_id, parent_sub_id: payload.parent_sub_id, description: payload.description, sort_order: payload.sort_order };
  const list = readJSON<SubCategory[]>(K_SUBCATS, []);
  const existIdx = list.findIndex(s => s.sub_id === id);
  const next = existIdx >= 0 ? list.map(s => s.sub_id === id ? row : s) : [row, ...list];
  writeJSON(K_SUBCATS, next);
  syncSubcategoryToDb(row).catch(err => console.error('[menuCats] DB sync sub failed:', err));
  return row;
};

export const updateSubcategory = (row: SubCategory) => {
  const list = readJSON<SubCategory[]>(K_SUBCATS, []);
  const next = list.map(s => s.sub_id === row.sub_id ? { ...s, ...row } : s);
  writeJSON(K_SUBCATS, next);
  syncSubcategoryToDb(row).catch(err => console.error('[menuCats] DB sync sub failed:', err));
};

export const deleteSubcategory = (sub_id: string) => {
  const list = readJSON<SubCategory[]>(K_SUBCATS, []);
  // also delete children recursively
  const toDelete = new Set<string>();
  const addDesc = (id: string) => {
    toDelete.add(id);
    list.filter(s => s.parent_sub_id === id).forEach(s => addDesc(s.sub_id));
  };
  addDesc(sub_id);
  const next = list.filter(s => !toDelete.has(s.sub_id));
  writeJSON(K_SUBCATS, next);
  Array.from(toDelete).forEach(id => {
    deleteSubcategoryFromDb(id).catch(err => console.error('[menuCats] DB delete sub failed:', err));
  });
};

export const setSubcategories = (rows: SubCategory[]) => writeJSON(K_SUBCATS, rows);
export const getSubcategoryById = (id: string): SubCategory | undefined => listSubcategories().find(s => s.sub_id === id);

export type SubTreeNode = SubCategory & { children: SubTreeNode[] };
export const listSubTreeByCategory = (category_id: string): SubTreeNode[] => {
  const all = listSubcategories(category_id);
  const nodes = new Map<string, SubTreeNode>(all.map(s => [s.sub_id, { ...s, children: [] }]));
  const roots: SubTreeNode[] = [];
  for (const n of nodes.values()) {
    if (n.parent_sub_id && nodes.has(n.parent_sub_id)) nodes.get(n.parent_sub_id)!.children.push(n); else roots.push(n);
  }
  const sortTree = (arr: SubTreeNode[]) => arr.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name)).forEach(n => sortTree(n.children));
  sortTree(roots);
  return roots;
};

export default {
  listCategories,
  addCategory,
  deleteCategory,
  setCategories,
  getCategoryById,
  // subcategories
  listSubcategories,
  addSubcategory,
  updateSubcategory,
  deleteSubcategory,
  setSubcategories,
  getSubcategoryById,
  listSubTreeByCategory,
};
