import React from 'react';
import { useAuth } from '@/context/AuthContext';
import { useShift } from '@/contexts/ShiftContext';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { fetchDepartments, isMultiSelectEnabled, DepartmentNode } from '@/lib/departments';
import { Crypto } from '@/lib/crypto';
import wf from '@/lib/approvalWorkflow';
import db from '@/lib/db';
import { USER_ROLES, mapStandardRoleToInternal } from '@/lib/authService';

const AuthPortal: React.FC = () => {
  const { user, login, register, requestPasswordReset, resetPassword, costCentre, setCostCentre, shiftId, setShiftId, logout } = useAuth();
  const { clearActiveShift } = useShift();
  const [tab, setTab] = React.useState<'login' | 'register' | 'recover'>('login');
  const [message, setMessage] = React.useState<string>('');

  const [loginForm, setLoginForm] = React.useState({ username: '', password: '' });
  const [regForm, setRegForm] = React.useState({ username: '', email: '', password: '', name: '', phone: '' });
  const [recoverForm, setRecoverForm] = React.useState({ email: '', token: '', newPassword: '' });
  const [role, setRole] = React.useState<string>('');
  const [roleInfoOpen, setRoleInfoOpen] = React.useState(false);
  const [deptQuery, setDeptQuery] = React.useState('');
  const [departments, setDepartments] = React.useState<DepartmentNode[]>([]);
  const [selectedDepts, setSelectedDepts] = React.useState<string[]>([]);
  const [approvalId, setApprovalId] = React.useState<string>('');
  const [approvalStatus, setApprovalStatus] = React.useState<'idle' | 'pending' | 'approved' | 'rejected' | 'escalated' | 'cancelled'>('idle');
  const [showCancelDialog, setShowCancelDialog] = React.useState(false);
  const [eta, setEta] = React.useState<string>('Calculating…');
  const [expectedIp, setExpectedIp] = React.useState<string>('');

  const COST_CENTRES = [
    'Room Service',
    'Bar 1',
    'Bar 2',
    'Main Restaurant',
    'Lounge Restaurant'
  ];

  const doLogin = async () => {
    setMessage('');
    const res = await login(loginForm.username, loginForm.password);
    if (res.success) {
      setMessage('Logged in successfully');
    } else {
      setMessage(res.error?.message || 'Invalid credentials');
    }
  };

  const handleSelectCostCentre = async (cc: string) => {
    setCostCentre(cc);
    clearActiveShift();
    try {
      const res = await db.query('SELECT id FROM pos_shifts WHERE cost_center = $1 AND status = \'open\' LIMIT 1', [cc]);
      if (res && 'rows' in res && Array.isArray(res.rows) && res.rows.length > 0) {
        setShiftId(res.rows[0].id);
      } else {
        setShiftId(null);
      }
    } catch (e) {
      console.error('Error checking shift:', e);
    }
  };

  const doRegister = async () => {
    setMessage('');
    if (!role) { setMessage('Please select a role before submitting.'); return; }
    try {
      const token = await Crypto.encryptAES256(role);
      sessionStorage.setItem('corepms_reg_role', token);
    } catch { }
    try {
      const res = await fetch('https://api.ipify.org?format=json');
      const json = await res.json();
      setExpectedIp(String(json.ip));
    } catch { }
    try {
      setApprovalStatus('pending');
      const payload = {
        userId: `pending_${Date.now()}`,
        username: regForm.username,
        role,
        departments: selectedDepts,
        requestedAt: Date.now(),
      };
      const rec = await wf.createApprovalRequest(payload);
      setApprovalId(rec.id);
      setMessage('Approval requested. You’ll be notified upon decision.');
      computeETA().then(setEta).catch(() => setEta('~48–72 hours'));
    } catch (e: any) {
      setApprovalStatus('idle');
      setMessage(e?.message || 'Failed to submit for approval');
    }
  };

  React.useEffect(() => {
    const t = setTimeout(() => {
      fetchDepartments(deptQuery).then(r => setDepartments(r.items)).catch(() => { });
    }, 150);
    return () => clearTimeout(t);
  }, [deptQuery]);

  const toggleDept = (id: string) => {
    setSelectedDepts(prev => {
      const exists = prev.includes(id);
      if (isMultiSelectEnabled()) {
        return exists ? prev.filter(x => x !== id) : [...prev, id];
      }
      return exists ? [] : [id];
    });
  };

  async function onCancelRequest() {
    setShowCancelDialog(false);
    if (!approvalId) return;
    try {
      await wf.cancelRequest(approvalId, regForm.username || 'unknown');
      setApprovalStatus('cancelled');
      setMessage('Request cancelled');
    } catch (e: any) {
      setMessage(e?.message || 'Failed to cancel request');
    }
  }

  async function pollApprovalStatus() {
    if (!approvalId) return;
    try {
      const status = await wf.getApprovalStatus(approvalId);
      setApprovalStatus(status as any);
      if (status === 'approved') {
        const ok = expectedIp ? await wf.validateSessionIP(expectedIp) : true;
        if (!ok) { setMessage('Session IP mismatch. Please restart approval.'); return; }
        await wf.provisionPermissions(`pending_${Date.now()}`, role, selectedDepts);
        setMessage('Approved. Permissions provisioning started.');
      }
    } catch { }
  }

  React.useEffect(() => {
    if (approvalStatus === 'pending' || approvalStatus === 'escalated') {
      const h = setInterval(pollApprovalStatus, 4000);
      return () => clearInterval(h);
    }
  }, [approvalStatus, approvalId]);

  async function computeETA(): Promise<string> {
    try {
      const ms = await wf.computeEtaMs();
      return wf.formatEta(ms);
    } catch {
      return '~48–72 hours';
    }
  }

  const doRequestReset = () => {
    setMessage('');
    const res = requestPasswordReset(recoverForm.email);
    if (res.ok && res.token) {
      setRecoverForm(f => ({ ...f, token: res.token }));
      setMessage(`Reset token generated: ${res.token}`);
    } else {
      setMessage(res.error || 'Failed to generate token');
    }
  };

  const doReset = async () => {
    setMessage('');
    const res = await resetPassword(recoverForm.token, recoverForm.newPassword);
    setMessage(res.ok ? 'Password reset successful. Please login.' : (res.error || 'Password reset failed'));
  };

  // 1. Station Selection View
  if (user && !costCentre) {
    return (
      <div className="p-8 max-w-4xl mx-auto min-h-[600px] flex flex-col justify-center">
        <div className="text-center mb-10">
          <h2 className="text-3xl font-bold text-gray-900 mb-2">Select Cost Centre</h2>
          <p className="text-gray-600">Please choose your active workstation to continue</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {COST_CENTRES.map((cc) => (
            <div
              key={cc}
              onClick={() => handleSelectCostCentre(cc)}
              className="cursor-pointer group relative overflow-hidden rounded-2xl bg-white p-8 shadow-sm transition-all hover:shadow-xl hover:-translate-y-1 border border-gray-100"
            >
              <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <div className="w-24 h-24 bg-blue-500 rounded-full -mr-12 -mt-12"></div>
              </div>
              <h3 className="text-xl font-bold text-gray-800 mb-2 group-hover:text-blue-600 transition-colors">{cc}</h3>
              <p className="text-sm text-gray-500">Access Point of Sale and Inventory</p>
              <div className="mt-6 flex items-center text-blue-600 text-sm font-semibold opacity-0 group-hover:opacity-100 transition-all transform translate-x-2 group-hover:translate-x-0">
                Select Workstation →
              </div>
            </div>
          ))}
        </div>
        <div className="mt-12 text-center">
          <Button variant="ghost" onClick={logout} className="text-gray-500 hover:text-red-600">
            Sign out and change user
          </Button>
        </div>
      </div>
    );
  }

  // 2. Authenticated View (Dashboard/Home)
  if (user) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h2 className="text-2xl font-bold text-gray-900 line-clamp-1">Welcome back, {user.name}</h2>
              <p className="text-gray-500">Authenticated Station: <span className="font-semibold text-blue-600">{costCentre}</span></p>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="rounded-xl" onClick={() => { clearActiveShift(); setCostCentre(null); }}>Switch Station</Button>
              <Button variant="destructive" className="rounded-xl" onClick={logout}>Logout</Button>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="p-6 bg-blue-50 rounded-2xl border border-blue-100">
              <h4 className="font-bold text-blue-900 mb-1">POS Status</h4>
              <p className="text-sm text-blue-700">{shiftId ? 'Shift Open' : 'Waiting for Shift Initiation'}</p>
            </div>
            <div className="p-6 bg-green-50 rounded-2xl border border-green-100">
              <h4 className="font-bold text-green-900 mb-1">Last Login</h4>
              <p className="text-sm text-green-700">{new Date().toLocaleTimeString()}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 3. Unauthenticated View (Login/Register)
  return (
    <div className="p-6 max-w-7xl mx-auto min-h-[600px] flex flex-col justify-center items-center">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-2 mb-8 bg-gray-50 p-2 rounded-2xl w-fit mx-auto">
          <Button variant={tab === 'login' ? 'default' : 'ghost'} onClick={() => setTab('login')} className="rounded-xl px-6">Login</Button>
          <Button variant={tab === 'register' ? 'default' : 'ghost'} onClick={() => setTab('register')} className="rounded-xl px-6">Register</Button>
          <Button variant={tab === 'recover' ? 'default' : 'ghost'} onClick={() => setTab('recover')} className="rounded-xl px-6">Recover</Button>
        </div>

        {message && (
          <div className="text-sm p-4 mb-6 rounded-2xl bg-blue-50 text-blue-700 border border-blue-100 animate-in fade-in slide-in-from-top-2">
            {message}
          </div>
        )}

        {tab === 'login' && (
          <div className="bg-white p-8 rounded-3xl shadow-xl shadow-gray-100 border border-gray-100">
            <h2 className="text-2xl font-bold mb-6 text-gray-900">Sign In</h2>
            <div className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="login-username">Username or Email</Label>
                <Input
                  id="login-username"
                  placeholder="name@example.com"
                  className="rounded-xl border-gray-200 h-12"
                  value={loginForm.username}
                  onChange={(e) => setLoginForm(f => ({ ...f, username: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="login-password">Password</Label>
                <Input
                  id="login-password"
                  type="password"
                  placeholder="••••••••"
                  className="rounded-xl border-gray-200 h-12"
                  value={loginForm.password}
                  onChange={(e) => setLoginForm(f => ({ ...f, password: e.target.value }))}
                />
              </div>
              <Button onClick={doLogin} className="w-full rounded-xl h-12 text-lg font-semibold shadow-lg shadow-blue-100 transition-all hover:shadow-xl hover:-translate-y-0.5">
                Login
              </Button>
            </div>
          </div>
        )}

        {tab === 'register' && (
          <div className="bg-white p-8 rounded-3xl shadow-xl shadow-gray-100 border border-gray-100 min-w-[400px]">
            <h2 className="text-2xl font-bold mb-6 text-gray-900">Create Account</h2>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label htmlFor="reg-username">Username</Label>
                  <Input id="reg-username" value={regForm.username} onChange={(e) => setRegForm(f => ({ ...f, username: e.target.value }))} className="rounded-xl" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="reg-email">Email</Label>
                  <Input id="reg-email" type="email" value={regForm.email} onChange={(e) => setRegForm(f => ({ ...f, email: e.target.value }))} className="rounded-xl" />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="reg-password">Password</Label>
                <Input id="reg-password" type="password" value={regForm.password} onChange={(e) => setRegForm(f => ({ ...f, password: e.target.value }))} className="rounded-xl" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="reg-name">Full Name</Label>
                <Input id="reg-name" value={regForm.name} onChange={(e) => setRegForm(f => ({ ...f, name: e.target.value }))} className="rounded-xl" />
              </div>

              <div>
                <Label htmlFor="reg-role">Role</Label>
                <div className="flex items-center gap-2 mt-1">
                  <select id="reg-role" className="border border-gray-200 rounded-xl px-3 py-2 w-full h-11" value={role} onChange={(e) => setRole(e.target.value)}>
                    <option value="">Select Role</option>
                    {USER_ROLES.map(r => (
                      <option key={r} value={mapStandardRoleToInternal(r)}>{r}</option>
                    ))}
                  </select>
                  <Button variant="outline" className="h-11 w-11 rounded-xl" onClick={() => setRoleInfoOpen(true)}>?</Button>
                </div>
              </div>

              <div className="pt-4">
                <Button onClick={doRegister} className="w-full rounded-xl h-12 font-semibold" disabled={!role}>
                  Submit Application
                </Button>
              </div>
            </div>

            <Dialog open={roleInfoOpen} onOpenChange={setRoleInfoOpen}>
              <DialogContent className="rounded-3xl">
                <DialogHeader>
                  <DialogTitle>Role Permissions</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4 text-sm text-gray-600">
                  <p><strong>Admin:</strong> Global control, users, settings.</p>
                  <p><strong>Manager:</strong> Department management, reports, shift controls.</p>
                  <p><strong>Employee:</strong> Front-office tasks, order processing.</p>
                </div>
                <DialogFooter>
                  <Button onClick={() => setRoleInfoOpen(false)} className="rounded-xl">Close</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        )}

        {tab === 'recover' && (
          <div className="bg-white p-8 rounded-3xl shadow-xl shadow-gray-100 border border-gray-100 max-w-md">
            <h2 className="text-2xl font-bold mb-6 text-gray-900">Reset Password</h2>
            <div className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="rec-email">Email or Username</Label>
                <Input id="rec-email" value={recoverForm.email} onChange={(e) => setRecoverForm(f => ({ ...f, email: e.target.value }))} className="rounded-xl h-11" />
              </div>
              <Button variant="outline" onClick={doRequestReset} className="w-full rounded-xl h-11">Request Token</Button>

              <div className="pt-4 border-t border-gray-50 space-y-4">
                <div className="space-y-1">
                  <Label htmlFor="rec-token">Reset Token</Label>
                  <Input id="rec-token" value={recoverForm.token} onChange={(e) => setRecoverForm(f => ({ ...f, token: e.target.value }))} className="rounded-xl h-11" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="rec-new">New Password</Label>
                  <Input id="rec-new" type="password" value={recoverForm.newPassword} onChange={(e) => setRecoverForm(f => ({ ...f, newPassword: e.target.value }))} className="rounded-xl h-11" />
                </div>
                <Button onClick={doReset} className="w-full rounded-xl h-12 font-semibold">Update Password</Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AuthPortal;

const DeptNode: React.FC<{ node: DepartmentNode; selected: string[]; onToggle: (id: string) => void; depth: number }> = ({ node, selected, onToggle, depth }) => {
  const pad = depth * 12;
  const checked = selected.includes(node.id);
  const hasChildren = !!(node.children && node.children.length > 0);
  const [collapsed, setCollapsed] = React.useState(false);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault(); onToggle(node.id);
    } else if (e.key === 'ArrowRight' && hasChildren) {
      e.preventDefault(); setCollapsed(false);
    } else if (e.key === 'ArrowLeft' && hasChildren) {
      e.preventDefault(); setCollapsed(true);
    }
  };

  return (
    <div
      className="flex items-center py-1"
      style={{ paddingLeft: pad }}
      role="treeitem"
      aria-expanded={hasChildren ? !collapsed : undefined}
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      {hasChildren && (
        <Button
          variant="ghost"
          size="sm"
          aria-label={collapsed ? `Expand ${node.name}` : `Collapse ${node.name}`}
          onClick={() => setCollapsed(v => !v)}
          className="mr-1 px-1"
        >
          {collapsed ? '+' : '–'}
        </Button>
      )}
      <input
        type={isMultiSelectEnabled() ? 'checkbox' : 'radio'}
        aria-label={`Select ${node.name}`}
        checked={checked}
        onChange={() => onToggle(node.id)}
        className="mr-2"
      />
      <span className="text-sm">{node.name}</span>
      {!collapsed && node.children && node.children.map(ch => (
        <DeptNode key={ch.id} node={ch} selected={selected} onToggle={onToggle} depth={depth + 1} />
      ))}
    </div>
  );
};
