import { db } from '@/lib/db';

// DB-backed Maintenance Service for Work Orders and Assets
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

// ============================================================================
// WORK ORDERS
// ============================================================================

export const listWorkOrders = async (): Promise<WorkOrder[]> => {
  try {
    const res = await db.query('SELECT * FROM work_orders ORDER BY created_at DESC');
    if ('rows' in res) {
      return res.rows.map((r: any) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        roomNumber: r.room_number,
        assetId: r.asset_id,
        priority: r.priority,
        status: r.status,
        assignedTo: r.assigned_to,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        closedAt: r.closed_at
      }));
    }
    return [];
  } catch (e) {
    console.error('Failed to list work orders:', e);
    return [];
  }
};

export const createWorkOrder = async (input: Omit<WorkOrder, 'id' | 'status' | 'createdAt'>): Promise<WorkOrder | null> => {
  const id = `WO${Date.now()}`;
  const now = new Date().toISOString();
  const status = 'open';

  try {
    await db.query(
      `INSERT INTO work_orders (id, title, description, room_number, asset_id, priority, status, assigned_to, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, input.title, input.description || null, input.roomNumber || null, input.assetId || null, input.priority || 'medium', status, input.assignedTo || null, now]
    );

    return {
      id,
      status,
      createdAt: now,
      ...input
    };
  } catch (e) {
    console.error('Failed to create work order:', e);
    return null;
  }
};

export const updateWorkOrder = async (id: string, patch: Partial<WorkOrder>): Promise<WorkOrder | null> => {
  try {
    // Build dynamic update query
    const fields: string[] = [];
    const values: any[] = [];
    const now = new Date().toISOString();

    if (patch.title !== undefined) { fields.push('title = ?'); values.push(patch.title); }
    if (patch.description !== undefined) { fields.push('description = ?'); values.push(patch.description); }
    if (patch.roomNumber !== undefined) { fields.push('room_number = ?'); values.push(patch.roomNumber); }
    if (patch.assetId !== undefined) { fields.push('asset_id = ?'); values.push(patch.assetId); }
    if (patch.priority !== undefined) { fields.push('priority = ?'); values.push(patch.priority); }
    if (patch.status !== undefined) { fields.push('status = ?'); values.push(patch.status); }
    if (patch.assignedTo !== undefined) { fields.push('assigned_to = ?'); values.push(patch.assignedTo); }
    if (patch.closedAt !== undefined) { fields.push('closed_at = ?'); values.push(patch.closedAt); }

    fields.push('updated_at = ?'); values.push(now);

    if (fields.length === 1) return null; // Only updated_at

    values.push(id);

    await db.query(`UPDATE work_orders SET ${fields.join(', ')} WHERE id = ?`, values);

    // Fetch updated
    const res = await db.query('SELECT * FROM work_orders WHERE id = ?', [id]);
    if ('rows' in res && res.rows.length > 0) {
      const r = res.rows[0];
      return {
        id: r.id,
        title: r.title,
        description: r.description,
        roomNumber: r.room_number,
        assetId: r.asset_id,
        priority: r.priority,
        status: r.status,
        assignedTo: r.assigned_to,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        closedAt: r.closed_at
      };
    }
    return null;
  } catch (e) {
    console.error('Failed to update work order:', e);
    return null;
  }
};

export const setWorkOrderStatus = async (id: string, status: WorkOrderStatus): Promise<WorkOrder | null> => {
  const now = new Date().toISOString();
  const patch: Partial<WorkOrder> = { status };
  if (status === 'closed') patch.closedAt = now;
  return updateWorkOrder(id, patch);
};

export const assignWorkOrder = async (id: string, assignee: string): Promise<WorkOrder | null> => {
  return updateWorkOrder(id, { assignedTo: assignee });
};

// ============================================================================
// ASSETS
// ============================================================================

export const listAssets = async (): Promise<Asset[]> => {
  try {
    const res = await db.query('SELECT * FROM assets ORDER BY name');
    if ('rows' in res) {
      return res.rows.map((r: any) => ({
        id: r.id,
        name: r.name,
        location: r.location,
        serialNumber: r.serial_number,
        notes: r.notes,
        createdAt: r.created_at,
        updatedAt: r.updated_at
      }));
    }
    return [];
  } catch (e) {
    console.error('Failed to list assets:', e);
    return [];
  }
};

export const addAsset = async (input: Omit<Asset, 'id' | 'createdAt'>): Promise<Asset | null> => {
  const id = `AS${Date.now()}`;
  const now = new Date().toISOString();

  try {
    await db.query(
      `INSERT INTO assets (id, name, location, serial_number, notes, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
      [id, input.name, input.location || null, input.serialNumber || null, input.notes || null, now]
    );

    return {
      id,
      createdAt: now,
      ...input
    };
  } catch (e) {
    console.error('Failed to add asset:', e);
    return null;
  }
};

export const updateAsset = async (id: string, patch: Partial<Asset>): Promise<Asset | null> => {
  try {
    const fields: string[] = [];
    const values: any[] = [];
    const now = new Date().toISOString();

    if (patch.name !== undefined) { fields.push('name = ?'); values.push(patch.name); }
    if (patch.location !== undefined) { fields.push('location = ?'); values.push(patch.location); }
    if (patch.serialNumber !== undefined) { fields.push('serial_number = ?'); values.push(patch.serialNumber); }
    if (patch.notes !== undefined) { fields.push('notes = ?'); values.push(patch.notes); }

    fields.push('updated_at = ?'); values.push(now);

    values.push(id);

    await db.query(`UPDATE assets SET ${fields.join(', ')} WHERE id = ?`, values);

    const res = await db.query('SELECT * FROM assets WHERE id = ?', [id]);
    if ('rows' in res && res.rows.length > 0) {
      const r = res.rows[0];
      return {
        id: r.id,
        name: r.name,
        location: r.location,
        serialNumber: r.serial_number,
        notes: r.notes,
        createdAt: r.created_at,
        updatedAt: r.updated_at
      };
    }
    return null;
  } catch (e) {
    console.error('Failed to update asset:', e);
    return null;
  }
};

export const getMaintenanceStats = async () => {
  try {
    const openRes = await db.query("SELECT COUNT(*) as count FROM work_orders WHERE status != 'closed'");
    const closedRes = await db.query("SELECT COUNT(*) as count FROM work_orders WHERE status = 'closed'");

    // Calculate avg repair time for closed tickets
    // DB calculation might be better but for consistency/simplicity in migration:
    const closedOrdersRes = await db.query("SELECT created_at, closed_at FROM work_orders WHERE status = 'closed' LIMIT 500");

    let avgRepairHours = 0;
    if ('rows' in closedOrdersRes && closedOrdersRes.rows.length > 0) {
      const totalMs = closedOrdersRes.rows.reduce((acc: number, r: any) => {
        const start = new Date(r.created_at).getTime();
        const end = new Date(r.closed_at).getTime();
        return acc + Math.max(0, end - start);
      }, 0);
      avgRepairHours = Number((totalMs / closedOrdersRes.rows.length / 3600000).toFixed(2));
    }

    return {
      open: 'rows' in openRes ? Number(openRes.rows[0].count) : 0,
      closed: 'rows' in closedRes ? Number(closedRes.rows[0].count) : 0,
      avgRepairHours
    };
  } catch (e) {
    console.error('Failed to get maintenance stats:', e);
    return { open: 0, closed: 0, avgRepairHours: 0 };
  }
};

export default {
  listWorkOrders,
  createWorkOrder,
  updateWorkOrder,
  setWorkOrderStatus,
  assignWorkOrder,
  listAssets,
  addAsset,
  updateAsset,
  getMaintenanceStats,
};
