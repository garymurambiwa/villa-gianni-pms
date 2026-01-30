import { requireSupabase } from './supabaseClient';
import { logger } from './logger';

export interface DepartmentNode {
  id: string;
  name: string;
  parentId?: string | null;
  children?: DepartmentNode[];
}

export interface DepartmentSearchResult {
  items: DepartmentNode[];
}

const env = (import.meta as any).env || {};
const MULTI = String(env.VITE_DEPT_MULTI_SELECT || 'false') === 'true';

export function isMultiSelectEnabled(): boolean {
  return MULTI;
}

export async function fetchDepartments(query?: string): Promise<DepartmentSearchResult> {
  const supabase = requireSupabase();
  let req = supabase.from('departments').select('id,name,parent_id');
  if (query && query.trim()) req = req.ilike('name', `%${query}%`);
  const { data, error } = await req;
  if (error) {
    logger.error('departments.fetch.error', error);
    throw error;
  }
  const nodes = (data || []).map((d: any) => ({
    id: String(d.id),
    name: String(d.name),
    parentId: d.parent_id ? String(d.parent_id) : null,
  }));
  return { items: buildHierarchy(nodes) };
}

export function buildHierarchy(flat: DepartmentNode[]): DepartmentNode[] {
  const byId = new Map<string, DepartmentNode>();
  flat.forEach(n => byId.set(n.id, { ...n, children: [] }));
  const roots: DepartmentNode[] = [];
  byId.forEach(n => {
    if (n.parentId && byId.has(n.parentId)) {
      byId.get(n.parentId)!.children!.push(n);
    } else {
      roots.push(n);
    }
  });
  return roots;
}

export default { fetchDepartments, buildHierarchy, isMultiSelectEnabled };
