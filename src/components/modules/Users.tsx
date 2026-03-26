import React, { useState, useEffect, useMemo } from 'react';
import { useData } from '@/context/DataContext';
import pmsAuthDb from '@/lib/pmsAuthDb';
import { 
  register as authRegister, 
  updateUser as authUpdateUser, 
  deleteUser as authDeleteUser, 
  mapStandardRoleToInternal, 
  mapInternalRoleToStandard, 
  validatePasswordStrength,
  USER_ROLES,
  StandardRole
} from '@/lib/authService';

type RoleName = StandardRole;

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
  'FO Manager': ['fo_checkin_checkout', 'fo_reservations_edit', 'fo_process_room_payments', 'fo_access_folios', 'fo_view_room_status', 'fin_view_reports_pl', 'fin_access_ledgers_readonly'],
  'FNB Manager': ['fnb_process_orders', 'fnb_apply_discounts_voids', 'fnb_manage_inventory', 'fin_view_reports_pl', 'fin_access_ledgers_readonly', 'admin_view_audit_logs'],
  'FO Supervisor': ['fo_checkin_checkout', 'fo_reservations_edit', 'fo_process_room_payments', 'fo_access_folios', 'fo_view_room_status', 'fin_view_reports_pl'],
  'FNB Supervisor': ['fnb_process_orders', 'fnb_apply_discounts_voids', 'fnb_manage_inventory', 'fin_view_reports_pl'],
  'Restaurant Cashier': ['fnb_process_orders', 'fnb_apply_discounts_voids'],
  'Barman': ['fnb_process_orders', 'fnb_manage_inventory'],
  'Accountant': ['fin_view_reports_pl', 'fin_access_ledgers_readonly'],
  'Front office Cashier': ['fo_process_room_payments', 'fo_access_folios', 'fo_view_room_status'],
  'Night Auditor': ['fin_night_audit_closing', 'fin_view_reports_pl', 'fin_access_ledgers_readonly', 'fo_access_folios', 'fo_checkin_checkout'],
  'House keeper': ['fo_view_room_status'],
  'Maintenance': ['ops_work_orders', 'ops_change_room_ooo', 'fo_view_room_status'],
};

interface SystemUser {
  id: string;
  username: string;
  name: string;
  role: string;
  active: boolean;
  lastLogin: string;
  lastActivity?: string;
  permissions: RightsKey[];
}


export const Users: React.FC = () => {
  const { users: globalUsers, loadUsers, logs, loadLogs, loading: loadingData } = useData();
  const [activeTab, setActiveTab] = useState<'users' | 'logs'>('users');
  const [justUpdatedId, setJustUpdatedId] = useState<string | null>(null);

  const users = useMemo(() => {
    console.log('[Users] Mapping globalUsers:', globalUsers);
    const toStr = (v: any): string => {
      if (!v) return '—';
      if (v instanceof Date) return v.toLocaleString();
      const s = String(v);
      // If it looks like an ISO date, format it nicely
      if (s.match(/^\d{4}-\d{2}-\d{2}/)) {
        try { return new Date(s).toLocaleString(); } catch { return s; }
      }
      return s;
    };
    return globalUsers.map(u => ({
      id: u.id,
      username: u.username,
      name: u.name || u.username,
      role: mapInternalRoleToStandard(u.role as any),
      active: u.active,
      lastLogin: toStr(u.last_login),
      lastActivity: u.last_activity ? toStr(u.last_activity) : undefined,
      permissions: (u.permissions || []) as any,
    }));
  }, [globalUsers]);

  const loadingUsers = loadingData;

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const [showNewForm, setShowNewForm] = useState(false);
  const [editingUser, setEditingUser] = useState<SystemUser | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingUser, setDeletingUser] = useState<SystemUser | null>(null);
  const [deleting, setDeleting] = useState(false);

  return (
    <div className="p-6">
      <div className="sticky top-0 z-20 bg-white/90 backdrop-blur border-b px-6 -mx-6 flex justify-between items-center mb-6 py-3">
        <div className="flex flex-col">
          <h2 className="text-3xl font-bold text-gray-800">User Management</h2>
          <div className="flex gap-4 mt-2">
            <button
              onClick={() => setActiveTab('users')}
              className={`pb-2 px-1 text-sm font-medium transition-colors border-b-2 ${activeTab === 'users' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
            >
              User List
            </button>
            <button
              onClick={() => setActiveTab('logs')}
              className={`pb-2 px-1 text-sm font-medium transition-colors border-b-2 ${activeTab === 'logs' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
            >
              Activity Logs
            </button>
          </div>
        </div>
        {activeTab === 'users' && (
          <button
            onClick={() => setShowNewForm(!showNewForm)}
            className="bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700"
          >
            + New User
          </button>
        )}
      </div>

      {activeTab === 'users' ? (
        <>

      {showNewForm && (
        <NewUserForm
          users={users}
          onCreate={(u) => {
            setShowNewForm(false);
            loadUsers();
          }}
          onCancel={() => setShowNewForm(false)}
        />
      )}

      <div className="bg-white rounded-xl shadow-lg overflow-hidden overflow-x-auto">
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
                  {(() => {
                    const isOnline = user.active && user.lastActivity && (new Date().getTime() - new Date(user.lastActivity).getTime() < 5 * 60 * 1000);
                    if (isOnline) {
                      return (
                        <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-xs font-semibold animate-pulse">
                          Online
                        </span>
                      );
                    }
                    return user.active ? (
                      <span className="px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-xs font-semibold">
                        Offline
                      </span>
                    ) : (
                      <span className="px-3 py-1 bg-red-100 text-red-700 rounded-full text-xs font-semibold">
                        Inactive
                      </span>
                    );
                  })()}
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
        </>
      ) : (
        <UserLogsTable logs={logs} onRefresh={loadLogs} />
      )}
      {editingUser && (
        <EditUserDialog
          user={editingUser}
          saving={saving}
          onClose={() => setEditingUser(null)}
          onSave={async (updated) => {
            setSaving(true);
            try {
              const roleInternal = USER_ROLES.includes(updated.role as any) ? mapStandardRoleToInternal(updated.role) : (updated.role as any);
              const res = await authUpdateUser(updated.id, {
                role: roleInternal as any,
                active: updated.active,
                permissions: (updated.permissions || []) as any,
                profile: { name: updated.name },
              });
              if (!res.ok) {
                // Fallback to local update on error, but notify
                console.warn('Failed to persist edit:', res.error);
              }
              setJustUpdatedId(updated.id);
              loadUsers();
            } finally {
              setSaving(false);
              setEditingUser(null);
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
              const res = await authDeleteUser(id);
              if (!res.ok) console.warn('Delete failed:', res.error);
              loadUsers();
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
    if (!USER_ROLES.includes(role)) { setError('Please select a valid role'); return; }
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
          <label htmlFor="newUserFullName" className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
          <input id="newUserFullName" type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="e.g., Vhukile Matenda" className="w-full px-4 py-2 border rounded-lg" />
        </div>
        <div>
          <label htmlFor="newUserUsername" className="block text-sm font-medium text-gray-700 mb-1">Username (Email or System ID)</label>
          <input id="newUserUsername" type="text" value={usernameOrId} onChange={(e) => setUsernameOrId(e.target.value)} placeholder="e.g., user@example.com or SYS001" className="w-full px-4 py-2 border rounded-lg" />
        </div>
        <div>
          <label htmlFor="newUserPassword" className="block text-sm font-medium text-gray-700 mb-1">Password</label>
          <input id="newUserPassword" type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full px-4 py-2 border rounded-lg" />
          <p className="text-xs text-gray-500 mt-1">Min 8 chars, include upper, lower, number, and symbol.</p>
        </div>
        <div>
          <label htmlFor="newUserConfirmPassword" className="block text-sm font-medium text-gray-700 mb-1">Confirm Password</label>
          <input id="newUserConfirmPassword" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="w-full px-4 py-2 border rounded-lg" />
        </div>
        <div className="md:col-span-2">
          <label htmlFor="newUserRole" className="block text-sm font-medium text-gray-700 mb-1">Role</label>
          <select id="newUserRole" value={role} onChange={(e) => applyRoleDefaults(e.target.value as RoleName)} className="w-full px-4 py-2 border rounded-lg">
            {USER_ROLES.map(r => (
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
                  <input type="checkbox" className="h-4 w-4" checked={!!rights[r.key]} onChange={() => toggleRight(r.key)} />
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

const roles = [...USER_ROLES];

const EditUserDialog: React.FC<{ user: SystemUser; onClose: () => void; onSave: (u: SystemUser) => void; saving: boolean }> = ({ user, onClose, onSave, saving }) => {
  const [form, setForm] = useState<SystemUser>({ ...user });
  const [perm, setPerm] = useState<Record<RightsKey, boolean>>(() => {
    const m: Record<RightsKey, boolean> = {} as any;
    ALL_RIGHT_KEYS.forEach(k => { (m as any)[k] = (user.permissions || []).includes(k); });
    return m;
  });
  const toggleRight = (key: RightsKey) => setPerm(prev => ({ ...prev, [key]: !prev[key] }));

  // Password reset state
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const handlePasswordReset = async () => {
    if (!newPassword.trim()) { setPwMsg({ ok: false, text: 'Enter a new password' }); return; }
    if (newPassword !== confirmPassword) { setPwMsg({ ok: false, text: 'Passwords do not match' }); return; }
    setPwSaving(true);
    setPwMsg(null);
    try {
      const res = await pmsAuthDb.updatePasswordForUserUnsafe(user.username, newPassword);
      if (res.ok) {
        setPwMsg({ ok: true, text: 'Password updated successfully' });
        setNewPassword('');
        setConfirmPassword('');
      } else {
        setPwMsg({ ok: false, text: res.error || 'Failed to update password' });
      }
    } finally {
      setPwSaving(false);
    }
  };

  const handleScroll = React.useCallback((e: React.UIEvent<HTMLElement>) => {
    try { if ((import.meta as any).env?.DEV) console.log('[ScrollDiag] dialog-scrollTop', (e.target as HTMLElement).scrollTop); } catch { }
  }, []);
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="w-full max-w-md sm:max-w-lg max-h-[90vh] overflow-y-auto" onScroll={handleScroll}>
        <DialogHeader>
          <DialogTitle>Edit User</DialogTitle>
          <DialogDescription>Modify details and save. Changes apply instantly.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3">
          <div>
            <label htmlFor="editUsername" className="text-xs">Username</label>
            <Input id="editUsername" value={form.username} disabled className="mt-1" />
          </div>
          <div>
            <label htmlFor="editFullName" className="text-xs">Full Name</label>
            <Input id="editFullName" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1" />
          </div>
          <div>
            <label htmlFor="editRole" className="text-xs">Role</label>
            <select id="editRole" className="border rounded-md px-3 py-2 mt-1" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {roles.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <input id="active" type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="h-4 w-4" />
            <label htmlFor="active" className="text-sm">Active</label>
          </div>

          {/* Password Reset Section */}
          <div className="mt-2 border rounded-md p-3 bg-gray-50">
            <p className="text-sm font-semibold text-gray-700 mb-2">Reset Password</p>
            <div className="grid gap-2">
              <Input
                type="password"
                placeholder="New password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
              <Input
                type="password"
                placeholder="Confirm new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
              {newPassword && confirmPassword && newPassword !== confirmPassword && (
                <p className="text-xs text-red-600">Passwords do not match</p>
              )}
              {pwMsg && (
                <p className={`text-xs font-medium ${pwMsg.ok ? 'text-green-600' : 'text-red-600'}`}>{pwMsg.text}</p>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={handlePasswordReset}
                disabled={pwSaving || !newPassword || !confirmPassword}
              >
                {pwSaving ? 'Saving…' : 'Set New Password'}
              </Button>
            </div>
          </div>

          <div className="mt-2">
            {RIGHTS_CATEGORIES.map(cat => (
              <div key={cat.title} className="mb-2 border rounded-md">
                <div className="px-3 py-2 bg-gray-100 text-sm font-semibold text-gray-700">{cat.title}</div>
                <div className="p-3 grid grid-cols-1 md:grid-cols-2 gap-2">
                  {cat.rights.map(r => (
                    <label key={r.key} className="flex items-center gap-2 text-xs">
                      <input type="checkbox" className="h-4 w-4" checked={!!perm[r.key]} onChange={() => toggleRight(r.key)} />
                      <span>{r.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <Button className="bg-indigo-600 text-white px-4 py-2 min-h-[44px]" onClick={() => onSave({ ...form, permissions: ALL_RIGHT_KEYS.filter(k => perm[k]) as RightsKey[] })} disabled={saving}>
            {saving ? 'Saving…' : 'Save Changes'}
          </Button>
          <Button variant="outline" className="px-4 py-2 min-h-[44px]" onClick={onClose} disabled={saving}>Cancel</Button>
        </div>
        {saving && <LoadingSpinner className="mt-3" label="Applying changes" size="sm" />}
      </DialogContent>
    </Dialog>
  );
}

// Delete Confirmation Dialog
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog';

const DeleteConfirmDialog: React.FC<{ user: SystemUser; onCancel: () => void; onConfirm: () => void; deleting: boolean }> = ({ user, onCancel, onConfirm, deleting }) => {
  return (
    <AlertDialog open onOpenChange={(o) => { if (!o) onCancel(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove user “{user.username}”?</AlertDialogTitle>
          <AlertDialogDescription>
            This will deactivate the user and free up their username for future use. Their record will be kept for historical audit purposes.
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
// Activity Logs Table Component
const UserLogsTable: React.FC<{ logs: any[]; onRefresh: () => void }> = ({ logs, onRefresh }) => {
  useEffect(() => {
    onRefresh();
  }, [onRefresh]);

  return (
    <div className="bg-white rounded-xl shadow-lg overflow-hidden">
      <div className="p-4 border-b flex justify-between items-center bg-gray-50">
        <h3 className="font-bold text-gray-700">System Access & Audit Logs</h3>
        <button 
          onClick={onRefresh}
          className="text-blue-600 hover:text-blue-800 text-sm font-medium"
        >
          Refresh Logs
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-100">
            <tr>
              <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Timestamp</th>
              <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">User</th>
              <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Event</th>
              <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {logs.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-6 py-10 text-center text-gray-500 italic">No activity logs found.</td>
              </tr>
            ) : (
              logs.map((log) => (
                <tr key={log.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4 text-sm text-gray-600 whitespace-nowrap">
                    {new Date(log.ts).toLocaleString()}
                  </td>
                  <td className="px-6 py-4 text-sm font-medium text-gray-800">
                    {log.user_username || 'System'}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase ${
                      log.event.includes('fail') ? 'bg-red-100 text-red-700' : 
                      log.event.includes('success') || log.event.includes('login') ? 'bg-green-100 text-green-700' : 
                      'bg-gray-100 text-gray-700'
                    }`}>
                      {log.event.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500 max-w-xs truncate" title={JSON.stringify(log.detail)}>
                    {log.detail ? JSON.stringify(log.detail) : '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
