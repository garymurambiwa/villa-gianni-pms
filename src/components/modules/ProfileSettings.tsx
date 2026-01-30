import React from 'react';
import { useAuth } from '@/context/AuthContext';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import BackToFOSettingsButton from '@/components/modules/common/BackToFOSettingsButton';
import { Label } from '@/components/ui/label';

const ProfileSettings: React.FC = () => {
  const { user, updateProfile, changePassword } = useAuth();
  const [name, setName] = React.useState(user?.name || '');
  const [phone, setPhone] = React.useState('');
  const [curPwd, setCurPwd] = React.useState('');
  const [newPwd, setNewPwd] = React.useState('');
  const [msg, setMsg] = React.useState('');
  const [shortcutMsg, setShortcutMsg] = React.useState('');

  const saveProfile = async () => {
    setMsg('');
    const res = await updateProfile({ name, phone });
    setMsg(res.ok ? 'Profile saved' : (res.error || 'Failed to save profile'));
  };
  const savePassword = async () => {
    setMsg('');
    const res = await changePassword(curPwd, newPwd);
    setMsg(res.ok ? 'Password changed' : (res.error || 'Failed to change password'));
  };

  const createDesktopShortcut = async () => {
    try {
      setShortcutMsg('');
      const native = (window as any).native;
      if (!native || typeof native.createDesktopShortcut !== 'function') {
        setShortcutMsg('Desktop shortcut not supported in this environment.');
        return;
      }
      const res = await native.createDesktopShortcut();
      if (res?.ok) setShortcutMsg(`Shortcut created: ${res.path || 'Desktop'}`);
      else setShortcutMsg(res?.error || 'Failed to create shortcut');
    } catch (e: any) {
      setShortcutMsg(e?.message || String(e));
    }
  };

  return (
    <div className="p-6">
      <div className="sticky top-0 z-20 bg-white/90 backdrop-blur border-b px-6 -mx-6 py-3 mb-3 flex items-center gap-3">
        <BackToFOSettingsButton />
        <h2 className="text-xl font-semibold">Profile & Account Settings</h2>
      </div>
      {msg && (<div className="text-sm p-2 rounded bg-green-50 text-green-700 mb-3">{msg}</div>)}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-white p-4 rounded shadow">
        <div>
          <Label htmlFor="ps-name">Full Name</Label>
          <Input id="ps-name" value={name} onChange={(e)=> setName(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="ps-phone">Phone</Label>
          <Input id="ps-phone" value={phone} onChange={(e)=> setPhone(e.target.value)} />
        </div>
        <div className="md:col-span-2">
          <Button onClick={saveProfile}>Save Profile</Button>
        </div>
      </div>

      <div className="mt-6 bg-white p-4 rounded shadow max-w-md">
        <h3 className="text-lg font-semibold mb-2">Change Password</h3>
        <div className="space-y-2">
          <div>
            <Label htmlFor="ps-cur">Current Password</Label>
            <Input id="ps-cur" type="password" value={curPwd} onChange={(e)=> setCurPwd(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="ps-new">New Password</Label>
            <Input id="ps-new" type="password" value={newPwd} onChange={(e)=> setNewPwd(e.target.value)} />
            <div className="text-xs text-gray-500">Min 8 chars, at least 1 letter & 1 number.</div>
          </div>
          <Button onClick={savePassword}>Change Password</Button>
        </div>
      </div>

      <div className="mt-6 bg-white p-4 rounded shadow max-w-md">
        <h3 className="text-lg font-semibold mb-2">Desktop Shortcut</h3>
        <p className="text-sm text-gray-600 mb-3">Create a desktop shortcut to launch the application quickly.</p>
        {shortcutMsg && (<div className="text-sm p-2 rounded bg-blue-50 text-blue-700 mb-3">{shortcutMsg}</div>)}
        <Button onClick={createDesktopShortcut}>Create Desktop Shortcut</Button>
        <div className="text-xs text-gray-500 mt-2">
          Windows: .lnk file on Desktop • macOS: Finder alias on Desktop • Linux: .desktop file
        </div>
      </div>
    </div>
  );
};

export default ProfileSettings;
