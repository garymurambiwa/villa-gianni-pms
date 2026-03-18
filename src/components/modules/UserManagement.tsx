import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useData } from '@/context/DataContext';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import pmsAuthDb from '@/lib/pmsAuthDb';

interface UserRow {
  id: string;
  username: string;
  name?: string;
  email?: string;
  role: string;
  created_at?: string;
  last_login?: string;
  last_activity?: string;
  active?: boolean;
}

const ONLINE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

function isOnline(lastActivity?: string): boolean {
  if (!lastActivity) return false;
  return Date.now() - new Date(lastActivity).getTime() < ONLINE_THRESHOLD_MS;
}

function relativeTime(ts?: string): string {
  if (!ts) return 'Never';
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

const UserManagement: React.FC = () => {
  const { addUser, loading } = useData();
  const { user: currentUser } = useAuth();
  const { toast } = useToast();

  const [users, setUsers] = useState<UserRow[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);

  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [userForm, setUserForm] = useState({ username: '', password: '', email: '', role: 'user' });

  // Password reset state
  const [resetTarget, setResetTarget] = useState<UserRow | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetConfirm, setResetConfirm] = useState('');
  const [resetLoading, setResetLoading] = useState(false);

  const isAdmin = currentUser?.role === 'admin';

  const loadUsers = useCallback(async () => {
    try {
      const rows = await pmsAuthDb.listUsers();
      setUsers(rows as UserRow[]);
    } catch (e) {
      console.error('Failed to load users:', e);
    } finally {
      setUsersLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
    // Refresh every 30 seconds to keep online status current
    const interval = setInterval(loadUsers, 30_000);
    return () => clearInterval(interval);
  }, [loadUsers]);

  const handleAddUser = async () => {
    if (!userForm.username.trim() || !userForm.password.trim() || !userForm.email.trim()) {
      toast({ title: 'Validation Error', description: 'Username, password, and email are required', variant: 'destructive' });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userForm.email)) {
      toast({ title: 'Validation Error', description: 'Please enter a valid email address', variant: 'destructive' });
      return;
    }
    const success = await addUser(userForm);
    if (success) {
      toast({ title: 'Success', description: `User "${userForm.username}" created successfully` });
      setUserForm({ username: '', password: '', email: '', role: 'user' });
      setShowAddUserModal(false);
      loadUsers();
    } else {
      toast({ title: 'Error', description: 'Failed to create user. Please try again.', variant: 'destructive' });
    }
  };

  const handleResetPassword = async () => {
    if (!resetTarget) return;
    if (!resetPassword.trim()) {
      toast({ title: 'Validation Error', description: 'New password is required', variant: 'destructive' });
      return;
    }
    if (resetPassword !== resetConfirm) {
      toast({ title: 'Validation Error', description: 'Passwords do not match', variant: 'destructive' });
      return;
    }
    setResetLoading(true);
    try {
      const res = await pmsAuthDb.updatePasswordForUserUnsafe(resetTarget.username, resetPassword);
      if (res.ok) {
        toast({ title: 'Password Reset', description: `Password for "${resetTarget.username}" has been updated` });
        setResetTarget(null);
        setResetPassword('');
        setResetConfirm('');
      } else {
        toast({ title: 'Error', description: res.error || 'Failed to reset password', variant: 'destructive' });
      }
    } finally {
      setResetLoading(false);
    }
  };

  const roles = [
    { value: 'admin', label: 'Administrator' },
    { value: 'manager', label: 'Manager' },
    { value: 'employee', label: 'Employee' },
    { value: 'user', label: 'User' },
  ];

  const roleColors: Record<string, string> = {
    admin: 'bg-purple-100 text-purple-800',
    manager: 'bg-blue-100 text-blue-800',
    employee: 'bg-green-100 text-green-800',
    user: 'bg-gray-100 text-gray-700',
  };

  const displayUsers = users.length > 0 ? users : [];

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">User Management</h1>
          <p className="text-sm text-gray-500 mt-1">🟢 Online = active in the last 5 minutes</p>
        </div>

        <Dialog open={showAddUserModal} onOpenChange={setShowAddUserModal}>
          <DialogTrigger asChild>
            <Button>New User</Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Add New User</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="um-username">Username *</Label>
                <Input id="um-username" value={userForm.username} onChange={(e) => setUserForm({ ...userForm, username: e.target.value })} placeholder="Enter username" />
              </div>
              <div>
                <Label htmlFor="um-password">Password *</Label>
                <Input id="um-password" type="password" value={userForm.password} onChange={(e) => setUserForm({ ...userForm, password: e.target.value })} placeholder="Enter password" />
              </div>
              <div>
                <Label htmlFor="um-email">Email *</Label>
                <Input id="um-email" type="email" value={userForm.email} onChange={(e) => setUserForm({ ...userForm, email: e.target.value })} placeholder="Enter email" />
              </div>
              <div>
                <Label htmlFor="um-role">Role *</Label>
                <Select value={userForm.role} onValueChange={(value) => setUserForm({ ...userForm, role: value })}>
                  <SelectTrigger id="um-role">
                    <SelectValue placeholder="Select role" />
                  </SelectTrigger>
                  <SelectContent>
                    {roles.map((role) => (
                      <SelectItem key={role.value} value={role.value}>{role.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex justify-end space-x-2 pt-4">
                <Button variant="outline" onClick={() => setShowAddUserModal(false)}>Cancel</Button>
                <Button onClick={handleAddUser}>Create User</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Users Table */}
      <div className="border rounded-lg overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Username</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Role</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Last Seen</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Last Login</th>
              {isAdmin && (
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
              )}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {(loading || usersLoading) ? (
              <tr>
                <td colSpan={isAdmin ? 7 : 6} className="px-6 py-4 text-center text-gray-500">Loading users...</td>
              </tr>
            ) : displayUsers.length === 0 ? (
              <tr>
                <td colSpan={isAdmin ? 7 : 6} className="px-6 py-4 text-center text-gray-500">No users found.</td>
              </tr>
            ) : (
              displayUsers.map((user) => {
                const online = isOnline(user.last_activity);
                return (
                  <tr key={user.id} className="hover:bg-gray-50">
                    {/* Online / Offline indicator */}
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <span className={`inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 ${online ? 'bg-green-500' : 'bg-gray-300'}`} />
                        <span className={`text-xs font-medium ${online ? 'text-green-700' : 'text-gray-400'}`}>
                          {online ? 'Online' : 'Offline'}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap font-medium text-gray-900">
                      {user.username || (user as any).name}
                      {user.username === currentUser?.username && (
                        <span className="ml-2 text-xs text-blue-500 font-normal">(you)</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-gray-500">{user.email || 'No email'}</td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${roleColors[user.role] || 'bg-gray-100 text-gray-700'}`}>
                        {user.role}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-gray-500 text-sm">
                      {relativeTime(user.last_activity)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-gray-500 text-sm">
                      {user.last_login ? relativeTime(user.last_login) : 'Never'}
                    </td>
                    {isAdmin && (
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setResetTarget(user);
                            setResetPassword('');
                            setResetConfirm('');
                          }}
                        >
                          Reset Password
                        </Button>
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Password Reset Dialog */}
      <Dialog open={!!resetTarget} onOpenChange={(open) => { if (!open) setResetTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reset Password — {resetTarget?.username}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="reset-pw">New Password *</Label>
              <Input
                id="reset-pw"
                type="password"
                value={resetPassword}
                onChange={(e) => setResetPassword(e.target.value)}
                placeholder="Enter new password"
              />
            </div>
            <div>
              <Label htmlFor="reset-confirm">Confirm Password *</Label>
              <Input
                id="reset-confirm"
                type="password"
                value={resetConfirm}
                onChange={(e) => setResetConfirm(e.target.value)}
                placeholder="Confirm new password"
              />
              {resetConfirm && resetPassword !== resetConfirm && (
                <p className="text-xs text-red-600 mt-1">Passwords do not match</p>
              )}
            </div>
            <div className="flex justify-end space-x-2 pt-4">
              <Button variant="outline" onClick={() => setResetTarget(null)} disabled={resetLoading}>Cancel</Button>
              <Button onClick={handleResetPassword} disabled={resetLoading}>
                {resetLoading ? 'Saving…' : 'Save Password'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default UserManagement;