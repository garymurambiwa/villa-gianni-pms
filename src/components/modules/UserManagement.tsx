import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useData } from '@/context/DataContext';
import { useToast } from '@/hooks/use-toast';

interface User {
  id: string;
  username: string;
  email: string;
  role: string;
  created_at: string;
}

const UserManagement: React.FC = () => {
  const { addUser, users, loading } = useData();
  const { toast } = useToast();
  
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [userForm, setUserForm] = useState({
    username: '',
    password: '',
    email: '',
    role: 'user'
  });

  const handleAddUser = async () => {
    if (!userForm.username.trim() || !userForm.password.trim() || !userForm.email.trim()) {
      toast({
        title: 'Validation Error',
        description: 'Username, password, and email are required',
        variant: 'destructive'
      });
      return;
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(userForm.email)) {
      toast({
        title: 'Validation Error',
        description: 'Please enter a valid email address',
        variant: 'destructive'
      });
      return;
    }

    const success = await addUser(userForm);
    if (success) {
      toast({
        title: 'Success',
        description: `User "${userForm.username}" created successfully`
      });
      setUserForm({
        username: '',
        password: '',
        email: '',
        role: 'user'
      });
      setShowAddUserModal(false);
    } else {
      toast({
        title: 'Error',
        description: 'Failed to create user. Please try again.',
        variant: 'destructive'
      });
    }
  };

  const roles = [
    { value: 'admin', label: 'Administrator' },
    { value: 'manager', label: 'Manager' },
    { value: 'employee', label: 'Employee' },
    { value: 'user', label: 'User' }
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">User Management</h1>
        
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
                <Label htmlFor="username">Username *</Label>
                <Input
                  id="username"
                  value={userForm.username}
                  onChange={(e) => setUserForm({...userForm, username: e.target.value})}
                  placeholder="Enter username"
                />
              </div>
              
              <div>
                <Label htmlFor="password">Password *</Label>
                <Input
                  id="password"
                  type="password"
                  value={userForm.password}
                  onChange={(e) => setUserForm({...userForm, password: e.target.value})}
                  placeholder="Enter password"
                />
              </div>
              
              <div>
                <Label htmlFor="email">Email *</Label>
                <Input
                  id="email"
                  type="email"
                  value={userForm.email}
                  onChange={(e) => setUserForm({...userForm, email: e.target.value})}
                  placeholder="Enter email"
                />
              </div>
              
              <div>
                <Label htmlFor="role">Role *</Label>
                <Select 
                  value={userForm.role} 
                  onValueChange={(value) => setUserForm({...userForm, role: value})}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select role" />
                  </SelectTrigger>
                  <SelectContent>
                    {roles.map((role) => (
                      <SelectItem key={role.value} value={role.value}>
                        {role.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              <div className="flex justify-end space-x-2 pt-4">
                <Button 
                  variant="outline" 
                  onClick={() => setShowAddUserModal(false)}
                >
                  Cancel
                </Button>
                <Button onClick={handleAddUser}>
                  Create User
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      
      <div className="border rounded-lg overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Username</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Role</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Created</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {users && users.length > 0 ? (
              users.map((user: any) => (
                <tr key={user.id}>
                  <td className="px-6 py-4 whitespace-nowrap font-medium text-gray-900">{user.username || user.name}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-gray-500">{user.email || 'No email'}</td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                      user.role === 'admin' ? 'bg-purple-100 text-purple-800' : 
                      user.role === 'manager' ? 'bg-blue-100 text-blue-800' : 
                      'bg-green-100 text-green-800'
                    }`}>
                      {user.role}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-gray-500 text-sm">
                    {user.created_at ? new Date(user.created_at).toLocaleDateString() : 'N/A'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                    <Button variant="outline" size="sm" className="mr-2">Edit</Button>
                    <Button variant="ghost" size="sm" className="text-red-600 hover:text-red-900 hover:bg-red-50">Delete</Button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5} className="px-6 py-4 text-center text-gray-500">
                  {loading ? 'Loading users...' : 'No users found.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default UserManagement;