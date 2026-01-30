import { Room, User } from '@/types';

const headers = (user?: User | null) => ({ 'Content-Type':'application/json', 'x-role': user?.role || '' });

export const listRooms = async (): Promise<Room[]> => {
  const res = await fetch('/api/rooms');
  return res.json();
};

export const getAudit = async (): Promise<any[]> => {
  const res = await fetch('/api/rooms/audit');
  return res.json();
};

export const addRoom = async (payload: Omit<Room,'id'|'status'> & { status?: Room['status'] }, user?: User | null) => {
  const res = await fetch('/api/rooms', { method:'POST', headers: headers(user), body: JSON.stringify(payload) });
  return res.json();
};

export const updateRoom = async (id: string, patch: Partial<Room>, user?: User | null) => {
  const res = await fetch(`/api/rooms/${id}`, { method:'PUT', headers: headers(user), body: JSON.stringify(patch) });
  return res.json();
};

export const deleteRoom = async (id: string, user?: User | null) => {
  const res = await fetch(`/api/rooms/${id}`, { method:'DELETE', headers: headers(user) });
  return res.json();
};

export const revertAudit = async (auditId: string, user?: User | null) => {
  const res = await fetch('/api/rooms/revert', { method:'POST', headers: headers(user), body: JSON.stringify({ auditId }) });
  return res.json();
};

export const bulkStatus = async (ids: string[], status: Room['status'], user?: User | null) => {
  const res = await fetch('/api/rooms/bulk/status', { method:'POST', headers: headers(user), body: JSON.stringify({ ids, status }) });
  return res.json();
};

export const bulkDelete = async (ids: string[], user?: User | null) => {
  const res = await fetch('/api/rooms/bulk/delete', { method:'POST', headers: headers(user), body: JSON.stringify({ ids }) });
  return res.json();
};

export const bulkFloor = async (ids: string[], floor: number, user?: User | null) => {
  const res = await fetch('/api/rooms/bulk/floor', { method:'POST', headers: headers(user), body: JSON.stringify({ ids, floor }) });
  return res.json();
};

export const bulkRate = async (ids: string[], rate: number, user?: User | null) => {
  const res = await fetch('/api/rooms/bulk/rate', { method:'POST', headers: headers(user), body: JSON.stringify({ ids, rate }) });
  return res.json();
};

export default { listRooms, getAudit, addRoom, updateRoom, deleteRoom, revertAudit, bulkStatus, bulkDelete, bulkFloor, bulkRate };

