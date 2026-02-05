import { Room, User } from '@/types';
import { isManager } from '@/lib/permissions';

const ROOMS_KEY = 'corepms_rooms';
const ROOMS_AUDIT_KEY = 'corepms_rooms_audit';

type AuditAction = 'add' | 'update' | 'delete' | 'revert';
export interface RoomAuditEntry {
  id: string;
  timestamp: string; // ISO
  user?: Pick<User, 'id' | 'username' | 'role'> | null;
  action: AuditAction;
  roomId: string;
  before?: Partial<Room> | null;
  after?: Partial<Room> | null;
  message?: string;
}

const readJSON = <T>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
};

const writeJSON = (key: string, value: any) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { }
};

const isAlphanumeric = (s: string) => /^[a-zA-Z0-9-]+$/.test(s);

export const getRooms = (): Room[] => readJSON<Room[]>(ROOMS_KEY, []);

export const setRooms = (rooms: Room[]) => writeJSON(ROOMS_KEY, rooms);

export const getAudit = (): RoomAuditEntry[] => readJSON<RoomAuditEntry[]>(ROOMS_AUDIT_KEY, []);

const pushAudit = (entry: RoomAuditEntry) => {
  const log = getAudit();
  log.unshift(entry);
  writeJSON(ROOMS_AUDIT_KEY, log);
};

export const validateRoom = (input: { number: string; type: string }): { ok: boolean; error?: string } => {
  const number = String(input.number || '').trim();
  const type = String(input.type || '').trim();
  if (number.length < 3) return { ok: false, error: 'Room number must be at least 3 characters' };
  if (!isAlphanumeric(number)) return { ok: false, error: 'Room number must be alphanumeric' };
  if (!type) return { ok: false, error: 'Room name is required' };
  if (type.length > 50) return { ok: false, error: 'Room name must be 50 characters or less' };
  return { ok: true };
};

const uniqueNumber = (rooms: Room[], number: string, excludeId?: string) => {
  return !rooms.some(r => r.number.toLowerCase() === number.toLowerCase() && r.id !== excludeId);
};

export const addRoom = (input: Omit<Room, 'id' | 'status'> & { status?: Room['status'] }, actor?: User | null): { ok: boolean; error?: string; room?: Room } => {
  if (!isManager(actor?.role)) return { ok: false, error: 'Unauthorized' };
  const rooms = getRooms();
  const check = validateRoom({ number: input.number, type: input.type });
  if (!check.ok) return { ok: false, error: check.error };
  if (!uniqueNumber(rooms, input.number)) return { ok: false, error: 'Duplicate room number' };
  const room: Room = {
    id: `R${Date.now()}`,
    number: input.number.trim(),
    type: input.type.trim(),
    status: input.status || 'VC',
    floor: input.floor || 1,
    rate: input.rate || 0,
  };
  const next = [room, ...rooms];
  setRooms(next);
  pushAudit({ id: `AUD${Date.now()}`, timestamp: new Date().toISOString(), user: actor ? { id: actor.id, username: actor.username, role: actor.role } : null, action: 'add', roomId: room.id, after: room, message: 'Room added' });
  return { ok: true, room };
};

export const updateRoom = (id: string, patch: Partial<Room>, actor?: User | null): { ok: boolean; error?: string; room?: Room } => {
  if (!isManager(actor?.role)) return { ok: false, error: 'Unauthorized' };
  const rooms = getRooms();
  const idx = rooms.findIndex(r => r.id === id);
  if (idx === -1) return { ok: false, error: 'Room not found' };
  const current = rooms[idx];
  const nextNumber = patch.number !== undefined ? String(patch.number).trim() : current.number;
  const nextType = patch.type !== undefined ? String(patch.type).trim() : current.type;
  const check = validateRoom({ number: nextNumber, type: nextType });
  if (!check.ok) return { ok: false, error: check.error };
  if (!uniqueNumber(rooms, nextNumber, id)) return { ok: false, error: 'Duplicate room number' };
  const updated: Room = { ...current, ...patch, number: nextNumber, type: nextType };
  const next = [...rooms]; next[idx] = updated;
  setRooms(next);
  pushAudit({ id: `AUD${Date.now()}`, timestamp: new Date().toISOString(), user: actor ? { id: actor.id, username: actor.username, role: actor.role } : null, action: 'update', roomId: id, before: current, after: updated, message: 'Room updated' });
  return { ok: true, room: updated };
};

export const deleteRoom = (id: string, actor?: User | null): { ok: boolean; error?: string } => {
  if (!isManager(actor?.role)) return { ok: false, error: 'Unauthorized' };
  const rooms = getRooms();
  const current = rooms.find(r => r.id === id);
  if (!current) return { ok: false, error: 'Room not found' };
  const next = rooms.filter(r => r.id !== id);
  setRooms(next);
  pushAudit({ id: `AUD${Date.now()}`, timestamp: new Date().toISOString(), user: actor ? { id: actor.id, username: actor.username, role: actor.role } : null, action: 'delete', roomId: id, before: current, message: 'Room deleted' });
  return { ok: true };
};

export const revertAudit = (auditId: string, actor?: User | null): { ok: boolean; error?: string } => {
  if (!isManager(actor?.role)) return { ok: false, error: 'Unauthorized' };
  const log = getAudit();
  const entry = log.find(a => a.id === auditId);
  if (!entry || !entry.before) return { ok: false, error: 'Revert target not found' };
  const rooms = getRooms();
  const idx = rooms.findIndex(r => r.id === entry.roomId);
  if (idx === -1) return { ok: false, error: 'Room not found' };
  rooms[idx] = { ...rooms[idx], ...entry.before } as Room;
  setRooms(rooms);
  pushAudit({ id: `AUD${Date.now()}`, timestamp: new Date().toISOString(), user: actor ? { id: actor.id, username: actor.username, role: actor.role } : null, action: 'revert', roomId: entry.roomId, before: entry.after, after: entry.before, message: 'Reverted change' });
  return { ok: true };
};

export const bulkDelete = (ids: string[], actor?: User | null): { ok: boolean; error?: string } => {
  if (!isManager(actor?.role)) return { ok: false, error: 'Unauthorized' };
  const rooms = getRooms();
  const next = rooms.filter(r => !ids.includes(r.id));
  setRooms(next);
  ids.forEach(id => pushAudit({ id: `AUD${Date.now()}_${id}`, timestamp: new Date().toISOString(), user: actor ? { id: actor.id, username: actor.username, role: actor.role } : null, action: 'delete', roomId: id, message: 'Room deleted (bulk)' }));
  return { ok: true };
};

export const bulkUpdateStatus = (ids: string[], status: Room['status'], actor?: User | null): { ok: boolean; error?: string } => {
  if (!isManager(actor?.role)) return { ok: false, error: 'Unauthorized' };
  const rooms = getRooms();
  const next = rooms.map(r => ids.includes(r.id) ? { ...r, status } : r);
  setRooms(next);
  ids.forEach(id => {
    const before = rooms.find(r => r.id === id);
    const after = next.find(r => r.id === id);
    pushAudit({ id: `AUD${Date.now()}_${id}`, timestamp: new Date().toISOString(), user: actor ? { id: actor.id, username: actor.username, role: actor.role } : null, action: 'update', roomId: id, before, after, message: 'Status updated (bulk)' });
  });
  return { ok: true };
};

export const resetToDefaultRooms = (rooms: Room[]): void => {
  setRooms(rooms);
  pushAudit({
    id: `AUD${Date.now()}_MIGRATION`,
    timestamp: new Date().toISOString(),
    user: null, // System action
    action: 'revert',
    roomId: 'ALL',
    message: 'System migration: Reset to default rooms'
  });
};

export default {
  getRooms,
  setRooms,
  addRoom,
  updateRoom,
  deleteRoom,
  bulkDelete,
  bulkUpdateStatus,
  getAudit,
  revertAudit,
  validateRoom,
  resetToDefaultRooms,
};
