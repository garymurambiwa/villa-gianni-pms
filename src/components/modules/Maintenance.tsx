import React from 'react';
import { useAuth } from '@/context/AuthContext';
import { useData } from '@/context/DataContext';
import maintenanceService, { WorkOrder, Asset } from '@/lib/maintenanceService';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';

const Maintenance: React.FC = () => {
  const { user } = useAuth();
  const { rooms, updateRoomStatus } = useData();
  const { toast } = useToast();

  // Work Orders
  const [orders, setOrders] = React.useState<WorkOrder[]>(() => maintenanceService.listWorkOrders());
  const [title, setTitle] = React.useState('');
  const [desc, setDesc] = React.useState('');
  const [woRoom, setWoRoom] = React.useState('');
  const [assetId, setAssetId] = React.useState('');
  const [priority, setPriority] = React.useState<'low' | 'medium' | 'high'>('medium');

  // Assets
  const [assets, setAssets] = React.useState<Asset[]>(() => maintenanceService.listAssets());
  const [assetName, setAssetName] = React.useState('');
  const [assetLocation, setAssetLocation] = React.useState('');
  const [assetSerial, setAssetSerial] = React.useState('');
  const [assetNotes, setAssetNotes] = React.useState('');

  // Room status integration
  const [targetRoomId, setTargetRoomId] = React.useState('');
  const [targetStatus, setTargetStatus] = React.useState<'OOO' | 'OOS'>('OOO');

  const refreshOrders = () => setOrders(maintenanceService.listWorkOrders());
  const refreshAssets = () => setAssets(maintenanceService.listAssets());

  const createOrder = () => {
    if (!title.trim()) { toast({ title: 'Missing title', description: 'Provide a brief work order title.' }); return; }
    const wo = maintenanceService.createWorkOrder({ title: title.trim(), description: desc.trim(), roomNumber: woRoom || undefined, assetId: assetId || undefined, priority });
    setTitle(''); setDesc(''); setWoRoom(''); setAssetId(''); setPriority('medium');
    setOrders([wo, ...orders]);
    toast({ title: 'Work Order Created', description: `#${wo.id} opened.` });
  };

  const setStatus = (id: string, status: 'open' | 'in_progress' | 'closed') => {
    const updated = maintenanceService.setWorkOrderStatus(id, status);
    if (updated) setOrders(prev => prev.map(o => o.id === id ? updated : o));
  };

  const assign = (id: string, assignee: string) => {
    const updated = maintenanceService.assignWorkOrder(id, assignee);
    if (updated) setOrders(prev => prev.map(o => o.id === id ? updated : o));
  };

  const linkAsset = (id: string, asset: string) => {
    const updated = maintenanceService.updateWorkOrder(id, { assetId: asset || undefined });
    if (updated) setOrders(prev => prev.map(o => o.id === id ? updated : o));
  };

  const addAsset = () => {
    if (!assetName.trim()) { toast({ title: 'Missing asset name', description: 'Enter an asset name.' }); return; }
    const a = maintenanceService.addAsset({ name: assetName.trim(), location: assetLocation || undefined, serialNumber: assetSerial || undefined, notes: assetNotes || undefined });
    setAssetName(''); setAssetLocation(''); setAssetSerial(''); setAssetNotes('');
    setAssets([a, ...assets]);
    toast({ title: 'Asset Added', description: `#${a.id} ${a.name}` });
  };

  const changeRoomStatus = async () => {
    if (!targetRoomId) { toast({ title: 'Select a room', description: 'Choose a room to set status.' }); return; }
    await updateRoomStatus(targetRoomId, targetStatus);
    toast({ title: 'Room Status Updated', description: `Room updated to ${targetStatus}.` });
  };

  const stats = maintenanceService.getMaintenanceStats();

  return (
    <div className="p-6 space-y-6">
      <div className="sticky top-0 z-40 bg-white/90 backdrop-blur border-b shadow-sm px-6 -mx-6 py-3">
        <h2 className="text-2xl font-bold">Maintenance</h2>
        <p className="text-sm text-gray-600">Work orders, assets, room status, and reporting</p>
      </div>

      {/* Work Orders Management (Main View) */}
      <section className="bg-white rounded-xl shadow p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold">Work Order Management</h3>
          <Button variant="outline" onClick={refreshOrders}>Refresh</Button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end mb-3">
          <div>
            <Label>Title</Label>
            <Input value={title} onChange={(e)=>setTitle(e.target.value)} placeholder="e.g., AC not cooling" />
          </div>
          <div>
            <Label>Description</Label>
            <Input value={desc} onChange={(e)=>setDesc(e.target.value)} placeholder="Optional details" />
          </div>
          <div>
            <Label>Room</Label>
            <select className="w-full border rounded px-2 py-1" value={woRoom} onChange={(e)=>setWoRoom(e.target.value)}>
              <option value="">—</option>
              {rooms.map(r => (<option key={r.id} value={r.number}>{r.number} ({r.type})</option>))}
            </select>
          </div>
          <div>
            <Label>Asset</Label>
            <select className="w-full border rounded px-2 py-1" value={assetId} onChange={(e)=>setAssetId(e.target.value)}>
              <option value="">—</option>
              {assets.map(a => (<option key={a.id} value={a.id}>{a.name}</option>))}
            </select>
          </div>
          <div>
            <Label>Priority</Label>
            <select className="w-full border rounded px-2 py-1" value={priority} onChange={(e)=>setPriority(e.target.value as any)}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>
        </div>
        <Button onClick={createOrder} className="bg-blue-600 text-white">Create Work Order</Button>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left">
                <th className="py-2 pr-4">ID</th>
                <th className="py-2 pr-4">Title</th>
                <th className="py-2 pr-4">Room</th>
                <th className="py-2 pr-4">Asset</th>
                <th className="py-2 pr-4">Priority</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Assigned</th>
                <th className="py-2 pr-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {orders.map(o => (
                <tr key={o.id} className="border-t">
                  <td className="py-2 pr-4">{o.id}</td>
                  <td className="py-2 pr-4">{o.title}</td>
                  <td className="py-2 pr-4">{o.roomNumber || '—'}</td>
                  <td className="py-2 pr-4">
                    <select className="border rounded px-2 py-1" value={o.assetId || ''} onChange={(e)=>linkAsset(o.id, e.target.value)}>
                      <option value="">—</option>
                      {assets.map(a => (<option key={a.id} value={a.id}>{a.name}</option>))}
                    </select>
                  </td>
                  <td className="py-2 pr-4">{o.priority || 'medium'}</td>
                  <td className="py-2 pr-4">
                    <select className="border rounded px-2 py-1" value={o.status} onChange={(e)=>setStatus(o.id, e.target.value as any)}>
                      <option value="open">Open</option>
                      <option value="in_progress">In Progress</option>
                      <option value="closed">Closed</option>
                    </select>
                  </td>
                  <td className="py-2 pr-4">
                    <Input value={o.assignedTo || ''} onChange={(e)=>assign(o.id, e.target.value)} placeholder="Assignee" />
                  </td>
                  <td className="py-2 pr-4">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-gray-500">Created {new Date(o.createdAt).toLocaleString()}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Room Status Integration (OOO/OOS) */}
      <section className="bg-white rounded-xl shadow p-4">
        <h3 className="font-semibold mb-2">Room Status Integration (OOO/OOS)</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <div>
            <Label>Room</Label>
            <select className="w-full border rounded px-2 py-1" value={targetRoomId} onChange={(e)=>setTargetRoomId(e.target.value)}>
              <option value="">Choose a room…</option>
              {rooms.map(r => (<option key={r.id} value={r.id}>{r.number} ({r.type})</option>))}
            </select>
          </div>
          <div>
            <Label>Status</Label>
            <select className="w-full border rounded px-2 py-1" value={targetStatus} onChange={(e)=>setTargetStatus(e.target.value as any)}>
              <option value="OOO">Out of Order (OOO)</option>
              <option value="OOS">Out of Service (OOS)</option>
            </select>
          </div>
          <div className="md:col-span-2">
            <Button onClick={changeRoomStatus} className="bg-orange-600 text-white">Update Status</Button>
          </div>
        </div>
      </section>

      {/* Asset Tracking */}
      <section className="bg-white rounded-xl shadow p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold">Asset Tracking</h3>
          <Button variant="outline" onClick={refreshAssets}>Refresh</Button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end mb-3">
          <div>
            <Label>Name</Label>
            <Input value={assetName} onChange={(e)=>setAssetName(e.target.value)} placeholder="e.g., Boiler #1" />
          </div>
          <div>
            <Label>Location</Label>
            <Input value={assetLocation} onChange={(e)=>setAssetLocation(e.target.value)} placeholder="Plant room" />
          </div>
          <div>
            <Label>Serial</Label>
            <Input value={assetSerial} onChange={(e)=>setAssetSerial(e.target.value)} placeholder="Optional" />
          </div>
          <div>
            <Label>Notes</Label>
            <Input value={assetNotes} onChange={(e)=>setAssetNotes(e.target.value)} placeholder="Optional" />
          </div>
        </div>
        <Button onClick={addAsset} className="bg-green-600 text-white">Add Asset</Button>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left">
                <th className="py-2 pr-4">ID</th>
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4">Location</th>
                <th className="py-2 pr-4">Serial</th>
                <th className="py-2 pr-4">Notes</th>
              </tr>
            </thead>
            <tbody>
              {assets.map(a => (
                <tr key={a.id} className="border-t">
                  <td className="py-2 pr-4">{a.id}</td>
                  <td className="py-2 pr-4">{a.name}</td>
                  <td className="py-2 pr-4">{a.location || '—'}</td>
                  <td className="py-2 pr-4">{a.serialNumber || '—'}</td>
                  <td className="py-2 pr-4">{a.notes || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Reporting */}
      <section className="bg-white rounded-xl shadow p-4">
        <h3 className="font-semibold mb-2">Maintenance Reporting</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="p-3 border rounded">
            <div className="text-xs text-gray-500">Open Work Orders</div>
            <div className="text-xl font-semibold">{stats.open}</div>
          </div>
          <div className="p-3 border rounded">
            <div className="text-xs text-gray-500">Closed Work Orders</div>
            <div className="text-xl font-semibold">{stats.closed}</div>
          </div>
          <div className="p-3 border rounded">
            <div className="text-xs text-gray-500">Average Repair Time (hrs)</div>
            <div className="text-xl font-semibold">{stats.avgRepairHours}</div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default Maintenance;

