import React, { useState } from 'react';
import { listUsers as authListUsers, register as authRegister, updateUser as authUpdateUser, deleteUser as authDeleteUser, mapStandardRoleToInternal, mapInternalRoleToStandard, validatePasswordStrength } from '@/lib/authService';

// Standardized roles and granular rights model
const ROLE_LIST = [
  'Super Admin',
  'Admin',
  'FO Manager',
  'FNB Manager',
  'FO Supervisor',
  'FNB Supervisor',
  'Restaurant Cashier',
  'Barman',
  'Accountant',
  'Front office Cashier',
  'Night Auditor',
  'House keeper',
  'Maintenance',
] as const;

type RoleName = typeof ROLE_LIST[number];

type RightsKey =
  | 'admin_create_edit_users'
  | 'admin_view_audit_logs'
  | 'admin_change_global_config'
  | 'fo_checkin_checkout'
  | 'fo_reservations_edit'
  | 'fo_process_room_payments'
  | 'fo_access_folios'
  | 'fo_view_room_status'
  | 'fnb_process_orders'
  | 'fnb_apply_discounts_voids'
  | 'fnb_manage_inventory'
  | 'fin_night_audit_closing'
  | 'fin_view_reports_pl'
  | 'fin_access_ledgers_readonly'
  | 'ops_work_orders'
  | 'ops_change_room_ooo';

const RIGHTS_CATEGORIES: Array<{ title: string; rights: Array<{ key: RightsKey; label: string }> }> = [
  {
    title: 'Administration & System',
    rights: [
      { key: 'admin_create_edit_users', label: 'Create/Edit User Profiles (Full Access)' },
      { key: 'admin_view_audit_logs', label: 'View Audit Logs' },
      { key: 'admin_change_global_config', label: 'Change Global System Configuration' },
    ],
  },
  {
    title: 'Front Office & Rooms (FO)',
    rights: [
      { key: 'fo_checkin_checkout', label: 'Process Guest Check-ins/Check-outs' },
      { key: 'fo_reservations_edit', label: 'View/Edit Guest Reservations (Rates & Dates)' },
      { key: 'fo_process_room_payments', label: 'Process Room Payments & Post Charges' },
      { key: 'fo_access_folios', label: 'Access All Guest Folios & Billing History' },
      { key: 'fo_view_room_status', label: 'View Current Room Status & Housekeeping Reports' },
    ],
  },
  {
    title: 'Food & Beverage (FNB)',
    rights: [
      { key: 'fnb_process_orders', label: 'Process FNB Orders/Sales Transactions' },
      { key: 'fnb_apply_discounts_voids', label: 'Apply Discounts/Comps/Void FNB Items' },
      { key: 'fnb_manage_inventory', label: 'Manage FNB Inventory (Stocktake, Receiving, Transfers)' },
    ],
  },
  {
    title: 'Finance & Accounting',
    rights: [
      { key: 'fin_night_audit_closing', label: 'Perform End-of-Day/Night Audit Closing Procedures' },
      { key: 'fin_view_reports_pl', label: 'View Detailed Financial Reports & P&L' },
      { key: 'fin_access_ledgers_readonly', label: 'Access Accounting Ledgers (Read-Only)' },
    ],
  },
  {
    title: 'Maintenance & Operations',
    rights: [
      { key: 'ops_work_orders', label: 'Create & Close Maintenance Work Orders' },
      { key: 'ops_change_room_ooo', label: 'Change Room Status to Out of Order (OOO)' },
    ],
  },
];

const ALL_RIGHT_KEYS = RIGHTS_CATEGORIES.flatMap(c => c.rights.map(r => r.key));

const DEFAULT_ROLE_RIGHTS: Record<RoleName, RightsKey[]> = {
  'Super Admin': [...ALL_RIGHT_KEYS],
  'Admin': [...ALL_RIGHT_KEYS],
  'FO Manager': ['fo_checkin_checkout','fo_reservations_edit','fo_process_room_payments','fo_access_folios','fo_view_room_status','fin_view_reports_pl','fin_access_ledgers_readonly'],
  'FNB Manager': ['fnb_process_orders','fnb_apply_discounts_voids','fnb_manage_inventory','fin_view_reports_pl','fin_access_ledgers_readonly','admin_view_audit_logs'],
  'FO Supervisor': ['fo_checkin_checkout','fo_reservations_edit','fo_process_room_payments','fo_access_folios','fo_view_room_status','fin_view_reports_pl'],
  'FNB Supervisor': ['fnb_process_orders','fnb_apply_discounts_voids','fnb_manage_inventory','fin_view_reports_pl'],
  'Restaurant Cashier': ['fnb_process_orders','fnb_apply_discounts_voids'],
  'Barman': ['fnb_process_orders','fnb_manage_inventory'],
  'Accountant': ['fin_view_reports_pl','fin_access_ledgers_readonly'],
  'Front office Cashier': ['fo_process_room_payments','fo_access_folios','fo_view_room_status'],
  'Night Auditor': ['fin_night_audit_closing','fin_view_reports_pl','fin_access_ledgers_readonly','fo_access_folios','fo_checkin_checkout'],
  'House keeper': ['fo_view_room_status'],
  'Maintenance': ['ops_work_orders','ops_change_room_ooo','fo_view_room_status'],
};

interface SystemUser {
  id: string;
  username: string;
  name: string;
  role: string;
  active: boolean;
  lastLogin: string;
  permissions: RightsKey[];
}

const mockUsers: SystemUser[] = [
  { id: '1', username: 'admin', name: 'System Administrator', role: 'admin', active: true, lastLogin: '2025-10-29 18:30', permissions: [] },
  { id: '2', username: 'frontdesk', name: 'Front Desk Manager', role: 'frontdesk', active: true, lastLogin: '2025-10-29 14:20', permissions: [] },
  { id: '3', username: 'auditor', name: 'Night Auditor', role: 'auditor', active: true, lastLogin: '2025-10-29 02:15', permissions: [] },
  { id: '4', username: 'posmanager', name: 'POS Manager', role: 'posmanager', active: true, lastLogin: '2025-10-28 20:45', permissions: [] },
  { id: '5', username: 'housekeeping', name: 'Housekeeping Supervisor', role: 'housekeeping', active: true, lastLogin: '2025-10-29 08:00', permissions: [] }
];

export const Users: React.FC = () => {
  const [users, setUsers] = useState<SystemUser[]>(() => {
    try {
      const rows = authListUsers();
      return rows.map(u => ({
        id: u.id,
        username: u.username,
        name: u.profile?.name || u.username,
        role: mapInternalRoleToStandard(u.role as any),
        active: u.active,
        lastLogin: '—',
        permissions: (u.permissions || []) as any,
      }));
    } catch {
      return mockUsers;
    }
  });
  const [showNewForm, setShowNewForm] = useState(false);
  const [editingUser, setEditingUser] = useState<SystemUser | null>(null);
  const [saving, setSaving] = useState(false);
  const [justUpdatedId, setJustUpdatedId] = useState<string | null>(null);
  const [deletingUser, setDeletingUser] = useState<SystemUser | null>(null);
  const [deleting, setDeleting] = useState(false);

  return (
    <div className="p-6">
      <div className="sticky top-0 z-20 bg-white/90 backdrop-blur border-b px-6 -mx-6 flex justify-between items-center mb-6 py-3">
        <h2 className="text-3xl font-bold text-gray-800">User Management</h2>
        <button
          onClick={() => setShowNewForm(!showNewForm)}
          className="bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700"
        >
          + New User
        </button>
      </div>

      {showNewForm && (
        <NewUserForm
          users={users}
          onCreate={(u) => {
            setUsers(prev => [{ ...u }, ...prev]);
            setShowNewForm(false);
          }}
          onCancel={() => setShowNewForm(false)}
        />
      )}

      <div className="bg-white rounded-xl shadow-lg overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-100">
            <tr>
              <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Username</th>
              <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Full Name</th>
              <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Role</th>
              <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Last Login</th>
              <th className="px-6 py-4 text-center text-sm font-semibold text-gray-700">Status</th>
              <th className="px-6 py-4 text-center text-sm font-semibold text-gray-700">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {users.map(user => (
              <tr
                key={user.id}
                className={`hover:bg-gray-50 transition-colors ${justUpdatedId === user.id ? 'bg-green-50' : ''}`}
              >
                <td className="px-6 py-4 text-sm font-medium text-gray-800">{user.username}</td>
                <td className="px-6 py-4 text-sm text-gray-600">{user.name}</td>
                <td className="px-6 py-4">
                  <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-semibold">
                    {user.role}
                  </span>
                </td>
                <td className="px-6 py-4 text-sm text-gray-600">{user.lastLogin}</td>
                <td className="px-6 py-4 text-center">
                  {user.active ? (
                    <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-xs font-semibold">
                      Active
                    </span>
                  ) : (
                    <span className="px-3 py-1 bg-red-100 text-red-700 rounded-full text-xs font-semibold">
                      Inactive
                    </span>
                  )}
                </td>
                <td className="px-6 py-4 text-center">
                  <div className="flex justify-center gap-2">
                    <button
                      className="bg-blue-600 text-white px-4 py-2 rounded-md text-xs md:text-sm hover:bg-blue-700 active:scale-[0.98] transition min-h-[44px]"
                      onClick={() => setEditingUser(user)}
                    >
                      Edit
                    </button>
                    <button
                      className="bg-red-600 text-white px-4 py-2 rounded-md text-xs md:text-sm hover:bg-red-700 active:scale-[0.98] transition min-h-[44px]"
                      onClick={() => setDeletingUser(user)}
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white rounded-xl shadow-lg p-6 border-l-4 border-blue-500">
          <p className="text-gray-600 text-sm font-medium mb-2">Total Users</p>
          <p className="text-3xl font-bold text-gray-800">{users.length}</p>
        </div>
        <div className="bg-white rounded-xl shadow-lg p-6 border-l-4 border-green-500">
          <p className="text-gray-600 text-sm font-medium mb-2">Active Users</p>
          <p className="text-3xl font-bold text-gray-800">{users.filter(u => u.active).length}</p>
        </div>
        <div className="bg-white rounded-xl shadow-lg p-6 border-l-4 border-purple-500">
          <p className="text-gray-600 text-sm font-medium mb-2">User Roles</p>
          <p className="text-3xl font-bold text-gray-800">6</p>
        </div>
      </div>
      {/* Edit Dialog */}
      {editingUser && (
        <EditUserDialog
          user={editingUser}
          saving={saving}
          onClose={() => setEditingUser(null)}
          onSave={async (updated) => {
            setSaving(true);
            try {
              const roleInternal = ROLE_LIST.includes(updated.role as any) ? mapStandardRoleToInternal(updated.role) : (updated.role as any);
              const res = authUpdateUser(updated.id, {
                role: roleInternal as any,
                active: updated.active,
                permissions: (updated.permissions || []) as any,
                profile: { name: updated.name },
              });
              if (!res.ok) {
                // Fallback to local update on error, but notify
                console.warn('Failed to persist edit:', res.error);
              }
              setUsers(prev => prev.map(u => (u.id === updated.id ? { ...updated } : u)));
            } finally {
              setSaving(false);
              setEditingUser(null);
              setJustUpdatedId(updated.id);
              setTimeout(() => setJustUpdatedId(null), 1500);
            }
          }}
        />
      )}

      {/* Delete Confirm */}
      {deletingUser && (
        <DeleteConfirmDialog
          user={deletingUser}
          deleting={deleting}
          onCancel={() => { if (!deleting) setDeletingUser(null); }}
          onConfirm={async () => {
            setDeleting(true);
            try {
              const id = deletingUser?.id || '';
              const res = authDeleteUser(id);
              if (!res.ok) console.warn('Delete failed:', res.error);
              setUsers(prev => prev.filter(u => u.id !== id));
            } finally {
              setDeleting(false);
              setDeletingUser(null);
            }
          }}
        />
      )}
    </div>
  );
};

// --- New User Creation Form with Role-based Permissions ---

const NewUserForm: React.FC<{ users: SystemUser[]; onCreate: (u: SystemUser) => void; onCancel: () => void }> = ({ users, onCreate, onCancel }) => {
  const [fullName, setFullName] = useState('');
  const [usernameOrId, setUsernameOrId] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [role, setRole] = useState<RoleName>('Admin');
  const [rights, setRights] = useState<Record<RightsKey, boolean>>(() => {
    const initial: Record<RightsKey, boolean> = {} as any;
    ALL_RIGHT_KEYS.forEach(k => { (initial as any)[k] = false; });
    return initial;
  });
  const [error, setError] = useState<string>('');

  const isEmail = (val: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);

  const applyRoleDefaults = (nextRole: RoleName) => {
    setRole(nextRole);
    const defaults = DEFAULT_ROLE_RIGHTS[nextRole] || [];
    const next: Record<RightsKey, boolean> = {} as any;
    ALL_RIGHT_KEYS.forEach(k => { (next as any)[k] = defaults.includes(k as RightsKey); });
    setRights(next);
  };

  const toggleRight = (key: RightsKey) => {
    setRights(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const isUniqueUsername = (val: string) => {
    const lc = val.trim().toLowerCase();
    return users.every(u => u.username.toLowerCase() !== lc);
  };

  const handleCreate = async () => {
    setError('');
    const uname = usernameOrId.trim();
    if (!fullName.trim()) { setError('Full Name is required'); return; }
    if (!uname) { setError('Username (Email or System ID) is required'); return; }
    if (!isUniqueUsername(uname)) { setError('Username must be unique'); return; }
    if (!validatePasswordStrength(password)) { setError('Password must be at least 8 characters and include uppercase, lowercase, number, and symbol'); return; }
    if (password !== confirmPassword) { setError('Passwords do not match'); return; }
    if (!ROLE_LIST.includes(role)) { setError('Please select a valid role'); return; }
    const permissions = ALL_RIGHT_KEYS.filter(k => rights[k]) as RightsKey[];
    const res = await authRegister({
      username: uname,
      email: isEmail(uname) ? uname : undefined,
      password,
      role: mapStandardRoleToInternal(role),
      name: fullName.trim(),
      permissions,
    });
    if (!res.ok || !res.user) { setError(res.error || 'Failed to create user'); return; }
    const created = res.user;
    const newUser: SystemUser = {
      id: created.id,
      username: created.username,
      name: created.profile?.name || created.username,
      role, // display standardized role name in UI
      active: created.active,
      lastLogin: '—',
      permissions,
    };
    onCreate(newUser);
  };

  return (
    <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
      <h3 className="text-xl font-bold text-gray-800 mb-4">Create New User Profile</h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
          <input type="text" value={fullName} onChange={(e)=>setFullName(e.target.value)} placeholder="e.g., Vhukile Matenda" className="w-full px-4 py-2 border rounded-lg" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Username (Email or System ID)</label>
          <input type="text" value={usernameOrId} onChange={(e)=>setUsernameOrId(e.target.value)} placeholder="e.g., user@example.com or SYS001" className="w-full px-4 py-2 border rounded-lg" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
          <input type="password" value={password} onChange={(e)=>setPassword(e.target.value)} className="w-full px-4 py-2 border rounded-lg" />
          <p className="text-xs text-gray-500 mt-1">Min 8 chars, include upper, lower, number, and symbol.</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Confirm Password</label>
          <input type="password" value={confirmPassword} onChange={(e)=>setConfirmPassword(e.target.value)} className="w-full px-4 py-2 border rounded-lg" />
        </div>
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
          <select value={role} onChange={(e)=>applyRoleDefaults(e.target.value as RoleName)} className="w-full px-4 py-2 border rounded-lg">
            {ROLE_LIST.map(r => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
          <p className="text-xs text-gray-500 mt-1">Selecting a role auto-assigns default rights. You can override below.</p>
        </div>
      </div>

      <div className="mt-6">
        {RIGHTS_CATEGORIES.map(cat => (
          <div key={cat.title} className="mb-4 border rounded-lg">
            <div className="px-4 py-2 bg-gray-100 font-semibold text-gray-700">{cat.title}</div>
            <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
              {cat.rights.map(r => (
                <label key={r.key} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="h-4 w-4" checked={!!rights[r.key]} onChange={()=>toggleRight(r.key)} />
                  <span>{r.label}</span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>

      {error && (
        <div className="mt-3 p-2 bg-red-50 text-red-700 text-sm rounded">{error}</div>
      )}

      <div className="flex gap-3 mt-4">
        <button onClick={handleCreate} className="bg-green-600 text-white px-6 py-2 rounded-lg hover:bg-green-700">Create User</button>
        <button onClick={onCancel} className="bg-gray-300 text-gray-700 px-6 py-2 rounded-lg hover:bg-gray-400">Cancel</button>
      </div>
    </div>
  );
};

// Edit Dialog Component (responsive, smooth transitions)
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

const roles = [...ROLE_LIST];

const EditUserDialog: React.FC<{ user: SystemUser; onClose: ()=>void; onSave: (u: SystemUser)=>void; saving: boolean }>=({ user, onClose, onSave, saving })=>{
  const [form, setForm] = useState<SystemUser>({ ...user });
  const [perm, setPerm] = useState<Record<RightsKey, boolean>>(()=>{
    const m: Record<RightsKey, boolean> = {} as any;
    ALL_RIGHT_KEYS.forEach(k => { (m as any)[k] = (user.permissions || []).includes(k); });
    return m;
  });
  const toggleRight = (key: RightsKey) => setPerm(prev => ({ ...prev, [key]: !prev[key] }));
  const handleScroll = React.useCallback((e: React.UIEvent<HTMLElement>) => {
    try { if ((import.meta as any).env?.DEV) console.log('[ScrollDiag] dialog-scrollTop', (e.target as HTMLElement).scrollTop); } catch {}
  }, []);
  return (
    <Dialog open onOpenChange={(o)=>{ if(!o) onClose(); }}>
      <DialogContent className="w-full max-w-md sm:max-w-lg max-h-[90vh] overflow-y-auto" onScroll={handleScroll}>
        <DialogHeader>
          <DialogTitle>Edit User</DialogTitle>
          <DialogDescription>Modify details and save. Changes apply instantly.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3">
          <div>
            <label className="text-xs">Username</label>
            <Input value={form.username} disabled className="mt-1"/>
          </div>
          <div>
            <label className="text-xs">Full Name</label>
            <Input value={form.name} onChange={(e)=>setForm({ ...form, name: e.target.value })} className="mt-1"/>
          </div>
          <div>
            <label className="text-xs">Role</label>
            <select className="border rounded-md px-3 py-2 mt-1" value={form.role} onChange={(e)=>setForm({ ...form, role: e.target.value })}>
              {roles.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <input id="active" type="checkbox" checked={form.active} onChange={(e)=>setForm({ ...form, active: e.target.checked })} className="h-4 w-4" />
            <label htmlFor="active" className="text-sm">Active</label>
          </div>
          <div className="mt-2">
            {RIGHTS_CATEGORIES.map(cat => (
              <div key={cat.title} className="mb-2 border rounded-md">
                <div className="px-3 py-2 bg-gray-100 text-sm font-semibold text-gray-700">{cat.title}</div>
                <div className="p-3 grid grid-cols-1 md:grid-cols-2 gap-2">
                  {cat.rights.map(r => (
                    <label key={r.key} className="flex items-center gap-2 text-xs">
                      <input type="checkbox" className="h-4 w-4" checked={!!perm[r.key]} onChange={()=>toggleRight(r.key)} />
                      <span>{r.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <Button className="bg-indigo-600 text-white px-4 py-2 min-h-[44px]" onClick={()=>onSave({ ...form, permissions: ALL_RIGHT_KEYS.filter(k => perm[k]) as RightsKey[] })} disabled={saving}>
            {saving ? 'Saving…' : 'Save Changes'}
          </Button>
          <Button variant="outline" className="px-4 py-2 min-h-[44px]" onClick={onClose} disabled={saving}>Cancel</Button>
        </div>
        {saving && <LoadingSpinner className="mt-3" label="Applying changes" size="sm"/>}
      </DialogContent>
    </Dialog>
  );
}

// Delete Confirmation Dialog
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog';

const DeleteConfirmDialog: React.FC<{ user: SystemUser; onCancel: ()=>void; onConfirm: ()=>void; deleting: boolean }>=({ user, onCancel, onConfirm, deleting })=>{
  return (
    <AlertDialog open onOpenChange={(o)=>{ if(!o) onCancel(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete user “{user.username}”?</AlertDialogTitle>
          <AlertDialogDescription>
            This action permanently removes the user. You can’t undo this.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="min-h-[44px]" onClick={onCancel} disabled={deleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction className="bg-red-600 hover:bg-red-700 min-h-[44px]" onClick={onConfirm} disabled={deleting}>
            {deleting ? 'Deleting…' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
