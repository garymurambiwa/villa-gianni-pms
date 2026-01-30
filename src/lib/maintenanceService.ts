// LocalStorage-backed Maintenance Service for Work Orders and Assets
export type WorkOrderStatus = 'open' | 'in_progress' | 'closed';
export interface WorkOrder {
  id: string;
  title: string;
  description?: string;
  roomNumber?: string;
  assetId?: string;
  priority?: 'low' | 'medium' | 'high';
  status: WorkOrderStatus;
  assignedTo?: string; // user id or name
  createdAt: string; // ISO
  updatedAt?: string; // ISO
  closedAt?: string; // ISO
}

export interface Asset {
  id: string;
  name: string;
  location?: string;
  serialNumber?: string;
  notes?: string;
  createdAt: string; // ISO
  updatedAt?: string; // ISO
}

const KEY_WO = 'corepms_work_orders';
const KEY_ASSETS = 'corepms_assets';

const readJSON = <T>(key: string, fallback: T): T => {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; }
};
const writeJSON = (key: string, value: any) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };

export const listWorkOrders = (): WorkOrder[] => readJSON<WorkOrder[]>(KEY_WO, []);
export const saveWorkOrders = (items: WorkOrder[]) => writeJSON(KEY_WO, items);

export const createWorkOrder = (input: Omit<WorkOrder, 'id' | 'status' | 'createdAt'>): WorkOrder => {
  const now = new Date().toISOString();
  const wo: WorkOrder = { id: `WO${Date.now()}`, status: 'open', createdAt: now, ...input };
  const list = listWorkOrders();
  list.unshift(wo);
  saveWorkOrders(list);
  return wo;
};

export const updateWorkOrder = (id: string, patch: Partial<WorkOrder>): WorkOrder | null => {
  const list = listWorkOrders();
  const idx = list.findIndex(w => w.id === id);
  if (idx === -1) return null;
  const now = new Date().toISOString();
  const next = { ...list[idx], ...patch, updatedAt: now } as WorkOrder;
  list[idx] = next;
  saveWorkOrders(list);
  return next;
};

export const setWorkOrderStatus = (id: string, status: WorkOrderStatus): WorkOrder | null => {
  const now = new Date().toISOString();
  const patch: Partial<WorkOrder> = { status, updatedAt: now };
  if (status === 'closed') patch.closedAt = now;
  return updateWorkOrder(id, patch);
};

export const assignWorkOrder = (id: string, assignee: string): WorkOrder | null => {
  return updateWorkOrder(id, { assignedTo: assignee });
};

export const listAssets = (): Asset[] => readJSON<Asset[]>(KEY_ASSETS, []);
export const saveAssets = (items: Asset[]) => writeJSON(KEY_ASSETS, items);

export const addAsset = (input: Omit<Asset, 'id' | 'createdAt'>): Asset => {
  const now = new Date().toISOString();
  const asset: Asset = { id: `AS${Date.now()}`, createdAt: now, ...input };
  const list = listAssets();
  list.unshift(asset);
  saveAssets(list);
  return asset;
};

export const updateAsset = (id: string, patch: Partial<Asset>): Asset | null => {
  const list = listAssets();
  const idx = list.findIndex(a => a.id === id);
  if (idx === -1) return null;
  const now = new Date().toISOString();
  const next = { ...list[idx], ...patch, updatedAt: now } as Asset;
  list[idx] = next;
  saveAssets(list);
  return next;
};

export const getMaintenanceStats = () => {
  const orders = listWorkOrders();
  const open = orders.filter(o => o.status !== 'closed').length;
  const closed = orders.filter(o => o.status === 'closed');
  const avgRepairMs = closed.length
    ? closed.reduce((acc, o) => {
        const start = new Date(o.createdAt).getTime();
        const end = new Date(o.closedAt || o.updatedAt || o.createdAt).getTime();
        return acc + Math.max(0, end - start);
      }, 0) / closed.length
    : 0;
  const avgRepairHours = Number((avgRepairMs / 3600000).toFixed(2));
  return { open, closed: closed.length, avgRepairHours };
};

export default {
  listWorkOrders,
  saveWorkOrders,
  createWorkOrder,
  updateWorkOrder,
  setWorkOrderStatus,
  assignWorkOrder,
  listAssets,
  saveAssets,
  addAsset,
  updateAsset,
  getMaintenanceStats,
};

