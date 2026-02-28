import { Room, RoomStatus } from '@/types';
import { db } from './db';
import { v4 as uuidv4 } from 'uuid';

// In-memory cache for synchronous access
let roomsCache: Room[] = [];
let hasLoaded = false;

// Initialize cache from DB
export const refreshRooms = async (): Promise<Room[]> => {
  try {
    const res = await db.query('SELECT * FROM rooms WHERE is_active != false ORDER BY number');
    // Check if query succeeded (res has "rows")
    if ('rows' in res && Array.isArray(res.rows)) {
      // Map DB rows to Room objects
      roomsCache = res.rows.map((r: any) => ({
        id: r.id,
        number: r.number,
        type: r.type,
        floor: Number(r.floor || 1),
        rate: Number(r.rate || 0),
        status: r.status as RoomStatus
      }));
    }
    hasLoaded = true;
    return roomsCache;
  } catch (e) {
    console.error('Failed to refresh rooms cache:', e);
    return roomsCache; // Return stale cache on error
  }
};

export const getRooms = (): Room[] => {
  if (!hasLoaded && roomsCache.length === 0) {
    // Trigger async load if not loaded, but return empty/stale for now
    refreshRooms().catch(console.error);
  }
  return roomsCache;
};

export const getRoom = (id: string): Room | undefined => {
  return roomsCache.find(r => r.id === id);
};

export const setRooms = async (rooms: Room[]): Promise<void> => {
  console.warn('setRooms called - this only updates local cache and does not persist to DB! Use add/updateRoom instead.');
  roomsCache = rooms;
};

export const addRoom = async (room: Omit<Room, 'id'>): Promise<Room> => {
  const newRoom: Room = { ...room, id: uuidv4(), floor: room.floor || 1 };

  // Optimistic update
  roomsCache = [...roomsCache, newRoom].sort((a, b) => a.number.localeCompare(b.number));

  // DB Insert
  try {
    await db.query(
      'INSERT INTO rooms (id, number, type, floor, rate, status) VALUES (?, ?, ?, ?, ?, ?)',
      [newRoom.id, newRoom.number, newRoom.type, newRoom.floor, newRoom.rate, newRoom.status]
    );
  } catch (e) {
    console.error('Failed to insert room:', e);
    roomsCache = roomsCache.filter(r => r.id !== newRoom.id);
    throw e;
  }

  return newRoom;
};

export const updateRoom = async (room: Room): Promise<Room> => {
  // Optimistic update
  const original = roomsCache.find(r => r.id === room.id);
  roomsCache = roomsCache.map(r => r.id === room.id ? room : r).sort((a, b) => a.number.localeCompare(b.number));

  // DB Update
  try {
    await db.query(
      'UPDATE rooms SET number = ?, type = ?, floor = ?, rate = ?, status = ? WHERE id = ?',
      [room.number, room.type, room.floor || 1, room.rate, room.status, room.id]
    );
  } catch (e) {
    console.error('Failed to update room:', e);
    if (original) {
      roomsCache = roomsCache.map(r => r.id === room.id ? original : r).sort((a, b) => a.number.localeCompare(b.number));
    }
    throw e;
  }

  return room;
};

export const deleteRoom = async (id: string): Promise<void> => {
  // Optimistic update
  const original = roomsCache.find(r => r.id === id);
  roomsCache = roomsCache.filter(r => r.id !== id);

  // Soft-delete: mark as inactive to preserve FK references
  try {
    await db.query('UPDATE rooms SET is_active = false WHERE id = ?', [id]);
  } catch (e) {
    console.error('Failed to soft-delete room:', e);
    if (original) {
      roomsCache = [...roomsCache, original].sort((a, b) => a.number.localeCompare(b.number));
    }
    throw e;
  }
};

export const updateRoomStatus = async (id: string, status: RoomStatus): Promise<void> => {
  const room = roomsCache.find(r => r.id === id);
  if (room) {
    await updateRoom({ ...room, status });
  }
};

export const resetToDefaultRooms = async (defaults: Omit<Room, 'id'>[]): Promise<void> => {
  // Clear DB
  await db.query('DELETE FROM rooms');
  roomsCache = [];

  // Bulk Insert
  for (const r of defaults) {
    await addRoom(r);
  }

  await pushAudit({
    action: 'reset',
    user: 'System',
    message: 'Reset rooms to default configuration'
  });
};

// ============================================================================
// AUDIT LOGGING (DB-Backed)
// ============================================================================

export interface RoomAudit {
  id: string;
  timestamp: string;
  userId?: string;
  user?: string; // name
  role?: string;
  action: 'create' | 'update' | 'delete' | 'status_change' | 'reset';
  roomId?: string;
  roomNumber?: string;
  before?: Partial<Room>;
  after?: Partial<Room>;
  message?: string;
}

export const getAudit = async (): Promise<RoomAudit[]> => {
  const res = await db.query<any>('SELECT * FROM room_audits ORDER BY timestamp DESC LIMIT 100');
  if ('rows' in res && Array.isArray(res.rows)) {
    return res.rows.map((row: any) => ({
      id: row.id,
      timestamp: row.timestamp,
      userId: row.user_id,
      user: row.user_username,
      role: row.user_role,
      action: row.action,
      roomId: row.room_id,
      before: typeof row.before_state === 'string' ? JSON.parse(row.before_state) : row.before_state,
      after: typeof row.after_state === 'string' ? JSON.parse(row.after_state) : row.after_state,
      message: row.message
    }));
  }
  return [];
};

export const pushAudit = async (entry: Omit<RoomAudit, 'id' | 'timestamp'>): Promise<void> => {
  try {
    const id = uuidv4();
    await db.query(
      `INSERT INTO room_audits (id, user_id, user_username, user_role, action, room_id, before_state, after_state, message)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        entry.userId || null,
        entry.user || null,
        entry.role || null,
        entry.action,
        entry.roomId || null,
        entry.before ? JSON.stringify(entry.before) : null,
        entry.after ? JSON.stringify(entry.after) : null,
        entry.message || null
      ]
    );
  } catch (e) {
    console.error('Failed to push room audit:', e);
  }
};

export const revertAudit = async (auditId: string): Promise<boolean> => {
  const res = await db.query<any>('SELECT * FROM room_audits WHERE id = ?', [auditId]);
  if (!('rows' in res) || !res.rows.length) return false;

  const audit = res.rows[0];
  const before = typeof audit.before_state === 'string' ? JSON.parse(audit.before_state) : audit.before_state;

  if (before && audit.room_id) {
    // Log "reverting" message?

    let success = false;

    // For delete revert: Insert
    if (audit.action === 'delete') {
      const insertRes = await db.query(
        'INSERT INTO rooms (id, number, type, floor, rate, status) VALUES (?, ?, ?, ?, ?, ?)',
        [audit.room_id, before.number, before.type, before.floor, before.rate, before.status]
      );
      if (!('error' in insertRes)) success = true;
    }
    // For other actions: Update
    else {
      const updateRes = await db.query(
        'UPDATE rooms SET number = ?, type = ?, floor = ?, rate = ?, status = ? WHERE id = ?',
        [before.number, before.type, before.floor, before.rate, before.status, audit.room_id]
      );
      if (!('error' in updateRes)) success = true;
    }

    if (success) {
      await refreshRooms();
      await pushAudit({
        action: 'update',
        roomId: audit.room_id,
        user: 'System',
        message: `Reverted action ${audit.action} from audit ${auditId}`
      });
      return true;
    }
  }

  return false;
};

export default {
  getRooms,
  getRoom,
  setRooms,
  addRoom,
  updateRoom,
  deleteRoom,
  updateRoomStatus,
  resetToDefaultRooms,
  refreshRooms,
  getAudit,
  pushAudit,
  revertAudit
};
