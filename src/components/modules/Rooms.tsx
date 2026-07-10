import React, { useMemo, useState } from 'react';
import { useData } from '../../context/DataContext';
import { Room, User } from '../../types';
import { useAuth } from '@/context/AuthContext';
import { isManager } from '@/lib/permissions';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ViewSelector, { ViewOption } from '@/components/ui/ViewSelector';
import { useToast } from '@/components/ui/use-toast';
import roomApi from '@/lib/roomApi';
import { Calendar } from 'lucide-react';

export const Rooms: React.FC = () => {
  const { rooms, guests, updateRoomStatus, addRoom, updateRoom, deleteRoom, bulkDeleteRooms, bulkUpdateRoomStatus, getRoomAudit, revertRoomChange, refreshData } = useData();
  const { user } = useAuth();
  const { toast } = useToast();
  const [filter, setFilter] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState<'number' | 'type'>('number');
  const [ascending, setAscending] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState<{ number: string; type: string; floor: number; rate: number; category: 'guest' | 'conference' }>({ number: '', type: '', floor: 1, rate: 0, category: 'guest' });
  const [processing, setProcessing] = useState(false);
  const [editing, setEditing] = useState<Room | null>(null);
  const [deleting, setDeleting] = useState<Room | null>(null);
  const initialView = ((): ViewOption => {
    try { const v = localStorage.getItem('corepms_rooms_view') as ViewOption | null; return (v && ['xl', 'md', 'sm', 'list'].includes(v)) ? v : 'md'; } catch { return 'md'; }
  })();
  const [view, setView] = useState<ViewOption>(initialView);
  const [audit, setAudit] = useState<any[]>([]);

  React.useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const list = await (getRoomAudit?.() as unknown as Promise<any[]>);
        if (mounted && Array.isArray(list)) setAudit(list);
      } catch {
        const list = (getRoomAudit?.() as unknown as any[]) || [];
        if (mounted) setAudit(list);
      }
    })();
    return () => { mounted = false; };
  }, [getRoomAudit]);

  const statusColors: Record<Room['status'], string> = {
    VC: 'bg-green-500',
    VD: 'bg-yellow-500',
    OC: 'bg-blue-500',
    OD: 'bg-orange-500',
    OOO: 'bg-red-500',
    OOS: 'bg-gray-500'
  };

  const statusLabels: Record<Room['status'], string> = {
    VC: 'Vacant Clean',
    VD: 'Vacant Dirty',
    OC: 'Occupied Clean',
    OD: 'Occupied Dirty',
    OOO: 'Out of Order',
    OOS: 'Out of Service'
  };

  // Check if a guest needs to check out (approaching or past check-out date)
  const getCheckOutNotification = (room: Room) => {
    if (room.status !== 'OC' && room.status !== 'OD') return null;

    const guest = guests.find(g => g.roomNumber === room.number);
    if (!guest || !guest.checkOut) return null;

    try {
      const checkOutDate = new Date(guest.checkOut);
      const today = new Date();
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      // Reset time parts for accurate date comparison
      checkOutDate.setHours(0, 0, 0, 0);
      today.setHours(0, 0, 0, 0);
      tomorrow.setHours(0, 0, 0, 0);

      // Check if check-out is today or has passed
      if (checkOutDate <= today) {
        return {
          type: 'urgent' as const,
          message: `Guest needs to check out today (${checkOutDate.toLocaleDateString()})`,
          daysRemaining: 0
        };
      }
      // Check if check-out is tomorrow
      else if (checkOutDate.getTime() === tomorrow.getTime()) {
        return {
          type: 'warning' as const,
          message: `Guest check-out tomorrow (${checkOutDate.toLocaleDateString()})`,
          daysRemaining: 1
        };
      }
      // Check if check-out is within 3 days
      else if (checkOutDate.getTime() <= tomorrow.getTime() + 2 * 24 * 60 * 60 * 1000) {
        const daysDiff = Math.ceil((checkOutDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
        return {
          type: 'info' as const,
          message: `Guest check-out in ${daysDiff} days (${checkOutDate.toLocaleDateString()})`,
          daysRemaining: daysDiff
        };
      }

      return null;
    } catch (e) {
      console.warn('Error parsing check-out date:', e);
      return null;
    }
  };

  const filteredRooms = useMemo(() => {
    const base = filter === 'all' ? rooms : rooms.filter(r => r.status === filter);
    const searched = query.trim() ? base.filter(r => r.number.toLowerCase().includes(query.toLowerCase()) || r.type.toLowerCase().includes(query.toLowerCase())) : base;
    const sorted = [...searched].sort((a, b) => {
      const av = sortBy === 'number' ? a.number : a.type;
      const bv = sortBy === 'number' ? b.number : b.type;
      return ascending ? av.localeCompare(bv) : bv.localeCompare(av);
    });
    return sorted;
  }, [rooms, filter, query, sortBy, ascending]);

  const handleStatusChange = (roomId: string, newStatus: Room['status']) => {
    updateRoomStatus(roomId, newStatus);
  };

  const canManage = isManager(user?.role);

  return (
    <div className="p-6">
      <div className="sticky top-0 z-20 bg-white/90 backdrop-blur border-b px-6 -mx-6 py-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-6">
        <h2 className="text-3xl font-bold text-gray-800">Rooms Management</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Input id="room-search" aria-label="Search rooms" placeholder="Search rooms..." value={query} onChange={(e) => setQuery(e.target.value)} className="w-48" />
          <select id="room-sort" aria-label="Sort rooms" className="border rounded px-2 py-2" value={sortBy} onChange={(e) => setSortBy(e.target.value as any)}>
            <option value="number">Sort by Number</option>
            <option value="type">Sort by Name</option>
          </select>
          <Button variant="outline" onClick={() => setAscending(a => !a)}>{ascending ? 'Asc' : 'Desc'}</Button>
          {canManage && <Button className="bg-indigo-600 text-white" onClick={() => setShowAdd(true)}>+ Add Room</Button>}
          <ViewSelector value={view} onChange={setView} />
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => setFilter('all')}
            className={`px-4 py-2 rounded-lg font-medium ${filter === 'all' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}
          >
            All Rooms
          </button>
          {Object.entries(statusLabels).map(([status, label]) => (
            <button
              key={status}
              onClick={() => setFilter(status)}
              className={`px-4 py-2 rounded-lg font-medium ${filter === status ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Bulk actions */}
      {canManage && selected.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className="text-sm text-gray-600">Selected: {selected.length}</span>
          <Button variant="outline" onClick={() => { setProcessing(true); setTimeout(() => { bulkUpdateRoomStatus?.(selected, 'VC'); setProcessing(false); setSelected([]); }, 400); }}>Mark VC</Button>
          <Button variant="outline" onClick={() => { setProcessing(true); setTimeout(() => { bulkUpdateRoomStatus?.(selected, 'VD'); setProcessing(false); setSelected([]); }, 400); }}>Mark VD</Button>
          <Button variant="outline" className="text-red-600" onClick={() => { setProcessing(true); setTimeout(() => { bulkDeleteRooms?.(selected); setProcessing(false); setSelected([]); }, 400); }}>Bulk Delete</Button>
          <div className="flex items-center gap-1">
            <Input type="number" className="w-28" placeholder="Floor" onChange={(e) => { const floor = Number(e.target.value || 0); (window as any).__bulkFloorVal = floor; }} />
            <Button variant="outline" onClick={() => { const floor = Number((window as any).__bulkFloorVal || 0); setProcessing(true); setTimeout(async () => { await roomApi.bulkFloor(selected, floor, user as User); const list = await roomApi.listRooms(); (window as any).__bulkFloorVal = 0; setProcessing(false); setSelected([]); }, 400); }}>Set Floor</Button>
          </div>
          <div className="flex items-center gap-1">
            <Input type="number" className="w-28" placeholder="Rate" onChange={(e) => { const rate = Number(e.target.value || 0); (window as any).__bulkRateVal = rate; }} />
            <Button variant="outline" onClick={() => { const rate = Number((window as any).__bulkRateVal || 0); setProcessing(true); setTimeout(async () => { await roomApi.bulkRate(selected, rate, user as User); const list = await roomApi.listRooms(); (window as any).__bulkRateVal = 0; setProcessing(false); setSelected([]); }, 400); }}>Set Rate</Button>
          </div>
        </div>
      )}

      {view !== 'list' && (
        <div className={view === 'xl' ? 'grid grid-cols-1 md:grid-cols-1 gap-6' : view === 'sm' ? 'grid grid-cols-1 md:grid-cols-3 xl:grid-cols-4 gap-3' : 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4'}>
          {filteredRooms.map(room => {
            const notification = getCheckOutNotification(room);
            return (
              <div key={room.id} className={`bg-white rounded-xl shadow-lg overflow-hidden transition ${view === 'xl' ? 'p-2' : ''}`}>
                <div className="p-6">
                  {/* Check-out notification banner */}
                  {notification && (
                    <div className={`mb-3 p-2 rounded-lg text-sm font-medium ${notification.type === 'urgent' ? 'bg-red-100 text-red-800 border border-red-200' :
                      notification.type === 'warning' ? 'bg-yellow-100 text-yellow-800 border border-yellow-200' :
                        'bg-blue-100 text-blue-800 border border-blue-200'
                      }`}>
                      <div className="flex items-center gap-2">
                        {/* Calendar icon - using text instead of component for simplicity */}
                        <span className="font-bold">!</span>
                        <span>{notification.message}</span>
                      </div>
                    </div>
                  )}
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className={view === 'xl' ? 'text-4xl font-bold text-gray-800' : view === 'sm' ? 'text-lg font-bold text-gray-800' : 'text-2xl font-bold text-gray-800'}>Room {room.number}</h3>
                      <p className={view === 'xl' ? 'text-base text-gray-600' : 'text-sm text-gray-600'}>
                        {room.type}
                        {/conference/i.test(String(room.type || '')) && (
                          <span className="ml-1.5 align-middle px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-700">CONFERENCE</span>
                        )}
                      </p>
                      {view !== 'sm' && <p className="text-sm text-gray-500">Floor {room.floor}</p>}
                    </div>
                    <div className="text-right">
                      <p className={view === 'xl' ? 'text-2xl font-bold text-blue-600' : 'text-lg font-bold text-blue-600'}>${room.rate}</p>
                      <p className="text-xs text-gray-500">{/conference/i.test(String(room.type || '')) ? 'per day' : 'per night'}</p>
                    </div>
                  </div>
                  <div className={`${statusColors[room.status]} text-white ${view === 'sm' ? 'px-2 py-1' : 'px-3 py-2'} rounded-lg text-center font-semibold mb-4`}>
                    {statusLabels[room.status]}
                  </div>
                  <label htmlFor={`status-${room.id}`} className="sr-only">Room Status</label>
                  <select
                    id={`status-${room.id}`}
                    value={room.status}
                    onChange={(e) => handleStatusChange(room.id, e.target.value as Room['status'])}
                    className={view === 'sm' ? 'w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500' : 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500'}
                  >
                    {Object.entries(statusLabels).map(([status, label]) => (
                      <option key={status} value={status}>{label}</option>
                    ))}
                  </select>
                  <div className="mt-3 flex items-center justify-between">
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" className="h-4 w-4" checked={selected.includes(room.id)} onChange={(e) => {
                        setSelected(prev => e.target.checked ? [...prev, room.id] : prev.filter(x => x !== room.id));
                      }} aria-label={`Select room ${room.number}`} />
                      <span>Select</span>
                    </label>
                    {canManage && (
                      <div className="flex items-center gap-2">
                        <Button variant="outline" className="min-h-[36px]" onClick={() => setEditing(room)} aria-label={`Edit room ${room.number}`}>Edit</Button>
                        <Button variant="outline" className="min-h-[36px] text-red-600" onClick={() => setDeleting(room)} aria-label={`Delete room ${room.number}`}>Delete</Button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {view === 'list' && (
        <div className="bg-white rounded-xl shadow-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="p-2">Select</th>
                <th className="p-2 text-left">ID</th>
                <th className="p-2 text-left">Number</th>
                <th className="p-2 text-left">Name</th>
                <th className="p-2 text-left">Status</th>
                <th className="p-2 text-left">Floor</th>
                <th className="p-2 text-left">Rate</th>
                <th className="p-2 text-left">Guest</th>
                <th className="p-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRooms.map(room => (
                <tr key={room.id} className="border-t">
                  <td className="p-2 text-center"><input type="checkbox" className="h-4 w-4" checked={selected.includes(room.id)} onChange={(e) => { setSelected(prev => e.target.checked ? [...prev, room.id] : prev.filter(x => x !== room.id)); }} aria-label={`Select room ${room.number}`} /></td>
                  <td className="p-2">{room.id}</td>
                  <td className="p-2">{room.number}</td>
                  <td className="p-2">{room.type}</td>
                  <td className="p-2">
                    <label htmlFor={`list-status-${room.id}`} className="sr-only">Room Status</label>
                    <select id={`list-status-${room.id}`} value={room.status} onChange={(e) => handleStatusChange(room.id, e.target.value as Room['status'])} className="border rounded px-2 py-1">
                      {Object.entries(statusLabels).map(([status, label]) => <option key={status} value={status}>{label}</option>)}
                    </select>
                  </td>
                  <td className="p-2">{room.floor}</td>
                  <td className="p-2">${room.rate}</td>
                  <td className="p-2">{room.guestId || '—'}</td>
                  <td className="p-2 text-center">
                    {canManage && (
                      <div className="flex items-center justify-center gap-2">
                        <Button variant="outline" onClick={() => setEditing(room)} aria-label={`Edit room ${room.number}`}>Edit</Button>
                        <Button variant="outline" className="text-red-600" onClick={() => setDeleting(room)} aria-label={`Delete room ${room.number}`}>Delete</Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Room Dialog */}
      {showAdd && (
        <Dialog open onOpenChange={(o) => { if (!o) setShowAdd(false); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add New Room</DialogTitle>
              <DialogDescription>Provide room number and name. Required fields are validated.</DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="md:col-span-2">
                <label htmlFor="new-room-category" className="text-xs">Room Category</label>
                <select id="new-room-category" className="border rounded px-2 py-2 w-full text-sm" value={addForm.category}
                  onChange={(e) => setAddForm(f => ({ ...f, category: e.target.value as 'guest' | 'conference' }))}>
                  <option value="guest">Guest Room</option>
                  <option value="conference">Conference Room</option>
                </select>
                {addForm.category === 'conference' && (
                  <div className="text-xs mt-1 text-indigo-700">
                    Conference rooms book through the same reservation calendar with their own daily rate, but are
                    excluded from occupancy / ADR / RevPAR and their revenue posts to Conference &amp; Events (4200) — room statistics stay untouched.
                  </div>
                )}
              </div>
              <div>
                <label htmlFor="new-room-number" className="text-xs">Room Number</label>
                <Input id="new-room-number" value={addForm.number} onChange={(e) => setAddForm(f => ({ ...f, number: e.target.value }))} placeholder="e.g. 305" />
                {(() => {
                  const dup = rooms.some(r => r.number.trim().toLowerCase() === addForm.number.trim().toLowerCase());
                  const invalidNum = addForm.number.trim().length < 3 || !/^[a-zA-Z0-9-]+$/.test(addForm.number);
                  return <div className="text-xs mt-1">{dup ? <span className="text-red-600">Duplicate room number</span> : invalidNum ? <span className="text-red-600">Invalid room number</span> : <span className="text-green-700">OK</span>}</div>;
                })()}
              </div>
              <div>
                <label htmlFor="new-room-name" className="text-xs">Room Name (display)</label>
                <Input id="new-room-name" value={addForm.type} onChange={(e) => setAddForm(f => ({ ...f, type: e.target.value.slice(0, 50) }))} placeholder="e.g. Deluxe Queen" />
                {(() => {
                  const invalidType = addForm.type.trim().length === 0 || addForm.type.length > 50;
                  return <div className="text-xs mt-1">{invalidType ? <span className="text-red-600">Name required (≤50 chars)</span> : <span className="text-green-700">OK</span>}</div>;
                })()}
              </div>
              <div>
                <label htmlFor="new-room-floor" className="text-xs">Floor</label>
                <Input id="new-room-floor" type="number" value={addForm.floor} onChange={(e) => setAddForm(f => ({ ...f, floor: Number(e.target.value || 1) }))} />
              </div>
              <div>
                <label htmlFor="new-room-rate" className="text-xs">Rate</label>
                <Input id="new-room-rate" type="number" value={addForm.rate} onChange={(e) => setAddForm(f => ({ ...f, rate: Number(e.target.value || 0) }))} />
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <Button
                className="bg-indigo-600 text-white min-h-[44px]"
                disabled={
                  processing ||
                  !canManage ||
                  rooms.some(r => r.number.trim().toLowerCase() === addForm.number.trim().toLowerCase()) ||
                  addForm.number.trim().length < 3 ||
                  !/^[a-zA-Z0-9-]+$/.test(addForm.number) ||
                  addForm.type.trim().length === 0 ||
                  addForm.type.length > 50
                }
                onClick={async () => {
                  setProcessing(true);
                  try {
                    // Prevent duplicate room numbers in local state before even hitting DB
                    const exists = rooms.find((r: any) => r.number === addForm.number);
                    if (exists) {
                      toast({ title: "Validation Error", description: "Room number already exists", variant: "destructive" });
                      return;
                    }

                    // Conference rooms carry a "Conference" type marker so KPI
                    // exclusions and revenue routing recognize them everywhere.
                    const savedType = addForm.category === 'conference'
                      ? (/conference/i.test(addForm.type) ? addForm.type.trim() : `Conference — ${addForm.type.trim()}`.replace(/ — $/, ''))
                      : addForm.type;
                    const success = await addRoom?.({
                      number: addForm.number,
                      type: savedType,
                      floor: addForm.floor,
                      rate: parseFloat(String(addForm.rate)) || 0
                    });

                    if (success) {
                      setShowAdd(false);
                      setAddForm({ number: '', type: '', floor: 1, rate: 0 });
                      toast({ title: "Success", description: "Room created successfully" });
                    }
                  } finally {
                    setProcessing(false);
                  }
                }}
              >
                Add Room
              </Button>
              <Button variant="outline" className="min-h-[44px]" onClick={() => setShowAdd(false)} disabled={processing}>Cancel</Button>
            </div>
            {processing && <LoadingSpinner size="sm" label="Processing" className="mt-2" />}
          </DialogContent>
        </Dialog>
      )}

      {/* Edit Room Dialog */}
      {editing && (
        <Dialog open onOpenChange={(o) => { if (!o) setEditing(null); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Room</DialogTitle>
              <DialogDescription>Modify room number or name. Duplicate numbers are blocked.</DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label htmlFor="edit-room-number" className="text-xs">Room Number</label>
                <Input id="edit-room-number" value={editing.number} onChange={(e) => setEditing(r => r ? { ...r, number: e.target.value } : r)} />
                {(() => {
                  const dup = rooms.some(r => r.number.trim().toLowerCase() === String(editing?.number || '').trim().toLowerCase() && r.id !== editing?.id);
                  const invalidNum = String(editing?.number || '').trim().length < 3 || !/^[a-zA-Z0-9-]+$/.test(String(editing?.number || ''));
                  return <div className="text-xs mt-1">{dup ? <span className="text-red-600">Duplicate room number</span> : invalidNum ? <span className="text-red-600">Invalid room number</span> : <span className="text-green-700">OK</span>}</div>;
                })()}
              </div>
              <div>
                <label htmlFor="edit-room-name" className="text-xs">Room Name (display)</label>
                <Input id="edit-room-name" value={editing.type} onChange={(e) => setEditing(r => r ? { ...r, type: e.target.value.slice(0, 50) } : r)} />
                {(() => {
                  const invalidType = String(editing?.type || '').trim().length === 0 || String(editing?.type || '').length > 50;
                  return <div className="text-xs mt-1">{invalidType ? <span className="text-red-600">Name required (≤50 chars)</span> : <span className="text-green-700">OK</span>}</div>;
                })()}
              </div>
              <div>
                <label htmlFor="edit-room-rate" className="text-xs">Room Rate</label>
                <Input
                  id="edit-room-rate"
                  type="number"
                  step="0.01"
                  value={Number(editing.rate || 0)}
                  onChange={(e) => setEditing(r => r ? { ...r, rate: Number(e.target.value || 0) } : r)}
                />
                {(() => {
                  const rateVal = Number(editing?.rate ?? 0);
                  const invalidRate = Number.isNaN(rateVal) || rateVal < 0;
                  return <div className="text-xs mt-1">{invalidRate ? <span className="text-red-600">Rate must be a non-negative number</span> : <span className="text-green-700">OK</span>}</div>;
                })()}
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <Button className="bg-indigo-600 text-white min-h-[44px]" disabled={processing || !canManage || rooms.some(r => r.number.trim().toLowerCase() === String(editing?.number || '').trim().toLowerCase() && r.id !== editing?.id) || String(editing?.number || '').trim().length < 3 || !/^[a-zA-Z0-9-]+$/.test(String(editing?.number || '')) || String(editing?.type || '').trim().length === 0 || String(editing?.type || '').length > 50 || Number.isNaN(Number(editing?.rate ?? 0)) || Number(editing?.rate ?? 0) < 0} onClick={async () => {
                setProcessing(true);
                try {
                  if (editing) {
                    const patch = { number: editing.number, type: editing.type, rate: Number(editing.rate || 0) };
                    let result: any;
                    if (updateRoom) {
                      result = await updateRoom(editing.id, patch);
                    } else {
                      result = await roomApi.updateRoom(editing.id, patch, user as User);
                      await (refreshData?.() as Promise<any>);
                    }
                    // Only close and show success if API confirmed
                    if (result === false || result?.error) {
                      toast({ title: 'Update Failed', description: result?.error || 'Could not update the room. Please try again.', variant: 'destructive' });
                    } else {
                      toast({ title: 'Success', description: `Room ${editing.number} updated successfully.` });
                      setEditing(null);
                    }
                  }
                } catch (err: any) {
                  toast({ title: 'Update Failed', description: err?.message || 'An unexpected error occurred.', variant: 'destructive' });
                } finally {
                  setProcessing(false);
                }
              }}>Save Changes</Button>
              <Button variant="outline" className="min-h-[44px]" onClick={() => setEditing(null)} disabled={processing}>Cancel</Button>
            </div>
            {processing && <LoadingSpinner size="sm" label="Saving" className="mt-2" />}
          </DialogContent>
        </Dialog>
      )}

      {/* Delete Confirmation */}
      {deleting && (
        <AlertDialog open onOpenChange={(o) => { if (!o) setDeleting(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Room {deleting.number}?</AlertDialogTitle>
              <AlertDialogDescription>This action will deactivate the room. Historical data will be preserved.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="min-h-[44px]" onClick={() => setDeleting(null)} disabled={processing}>Cancel</AlertDialogCancel>
              <AlertDialogAction className="bg-red-600 hover:bg-red-700 min-h-[44px]" disabled={processing || !canManage} onClick={async () => {
                setProcessing(true);
                try {
                  const ok = await deleteRoom?.(deleting.id);
                  if (ok === false) {
                    toast({ title: 'Delete failed', description: 'Could not delete the room. It may have active reservations.', variant: 'destructive' });
                  } else {
                    toast({ title: 'Room deleted', description: `Room ${deleting.number} removed.` });
                  }
                } catch (err: any) {
                  toast({ title: 'Delete failed', description: err?.message || 'An unexpected error occurred.', variant: 'destructive' });
                } finally {
                  setProcessing(false);
                  setDeleting(null);
                }
              }}>{processing ? 'Deleting…' : 'Delete'}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
      {/* Audit Trail */}
      {canManage && (
        <div className="mt-6 bg-white rounded-xl shadow-lg p-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Recent Room Changes</h3>
            <div className="flex items-center gap-2">
              <Input placeholder="Search in audit..." value={query} onChange={(e) => setQuery(e.target.value)} className="w-48" />
              <Button variant="outline" onClick={() => { (async () => { try { const list = await (getRoomAudit?.() as unknown as Promise<any[]>); setAudit(Array.isArray(list) ? list : []); } catch { const list = (getRoomAudit?.() as unknown as any[]) || []; setAudit(Array.isArray(list) ? list : []); } })(); }}>Refresh</Button>
              <Button variant="outline" onClick={() => {
                const rows = (audit || []).map((a: any) => [a.id, a.timestamp, a.action, a.roomId, a.user?.username || ''].map(x => `"${String(x || '').replace(/"/g, '"')}"`).join(','));
                const csv = ['id,timestamp,action,roomId,user'].concat(rows).join('\n');
                const blob = new Blob([csv], { type: 'text/csv' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a'); a.href = url; a.download = 'room_audit.csv'; a.click(); URL.revokeObjectURL(url);
              }}>Export CSV</Button>
            </div>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><th className="p-2 text-left">Time</th><th className="p-2 text-left">Action</th><th className="p-2 text-left">Room</th><th className="p-2 text-left">User</th><th className="p-2">Revert</th></tr></thead>
              <tbody>
                {(audit || []).filter((a: any) => !query.trim() || JSON.stringify(a).toLowerCase().includes(query.toLowerCase())).slice(0, 20).map((a: any) => (
                  <tr key={a.id}>
                    <td className="p-2">{new Date(a.timestamp).toLocaleString()}</td>
                    <td className="p-2">{a.action}</td>
                    <td className="p-2">{a.roomId}</td>
                    <td className="p-2">{a.user?.username || '—'}</td>
                    <td className="p-2 text-center">
                      {a.action === 'update' && (
                        <Button variant="outline" onClick={() => { const ok = revertRoomChange?.(a.id); if (ok) toast({ title: 'Change reverted' }); else toast({ title: 'Revert failed' }); }}>Revert</Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
