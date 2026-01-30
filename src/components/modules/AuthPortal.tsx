import React from 'react';
import { useAuth } from '@/context/AuthContext';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { fetchDepartments, isMultiSelectEnabled, DepartmentNode } from '@/lib/departments';
import { Crypto } from '@/lib/crypto';
import wf from '@/lib/approvalWorkflow';

const AuthPortal: React.FC = () => {
  const { user, login, register, requestPasswordReset, resetPassword } = useAuth();
  const [tab, setTab] = React.useState<'login'|'register'|'recover'>('login');
  const [message, setMessage] = React.useState<string>('');

  const [loginForm, setLoginForm] = React.useState({ username:'', password:'' });
  const [regForm, setRegForm] = React.useState({ username:'', email:'', password:'', name:'', phone:'' });
  const [recoverForm, setRecoverForm] = React.useState({ email:'', token:'', newPassword:'' });
  const [role, setRole] = React.useState<string>('');
  const [roleInfoOpen, setRoleInfoOpen] = React.useState(false);
  const [deptQuery, setDeptQuery] = React.useState('');
  const [departments, setDepartments] = React.useState<DepartmentNode[]>([]);
  const [selectedDepts, setSelectedDepts] = React.useState<string[]>([]);
  const [approvalId, setApprovalId] = React.useState<string>('');
  const [approvalStatus, setApprovalStatus] = React.useState<'idle'|'pending'|'approved'|'rejected'|'escalated'|'cancelled'>('idle');
  const [showCancelDialog, setShowCancelDialog] = React.useState(false);
  const [eta, setEta] = React.useState<string>('Calculating…');
  const [expectedIp, setExpectedIp] = React.useState<string>('');

  const doLogin = async () => {
    setMessage('');
    const ok = await login(loginForm.username, loginForm.password);
    setMessage(ok ? 'Logged in successfully' : 'Invalid credentials');
  };

  const doRegister = async () => {
    setMessage('');
    if (!role) { setMessage('Please select a role before submitting.'); return; }
    try {
      const token = await Crypto.encryptAES256(role);
      sessionStorage.setItem('corepms_reg_role', token);
    } catch {}
    try {
      const res = await fetch('https://api.ipify.org?format=json');
      const json = await res.json();
      setExpectedIp(String(json.ip));
    } catch {}
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
      computeETA().then(setEta).catch(()=> setEta('~48–72 hours'));
    } catch (e: any) {
      setApprovalStatus('idle');
      setMessage(e?.message || 'Failed to submit for approval');
    }
  };

  React.useEffect(() => {
    const t = setTimeout(() => {
      fetchDepartments(deptQuery).then(r => setDepartments(r.items)).catch(()=>{});
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
    } catch {}
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

  return (
    <div className="p-6">
      <div className="flex items-center gap-2 mb-4">
        <Button variant={tab==='login'?'default':'outline'} onClick={()=> setTab('login')}>Login</Button>
        <Button variant={tab==='register'?'default':'outline'} onClick={()=> setTab('register')}>Register</Button>
        <Button variant={tab==='recover'?'default':'outline'} onClick={()=> setTab('recover')}>Recover Password</Button>
      </div>
      {message && <div className="text-sm p-2 mb-3 rounded bg-blue-50 text-blue-700">{message}</div>}

      {tab==='login' && (
        <div className="bg-white p-4 rounded shadow max-w-md">
          <div className="space-y-2">
            <div>
              <Label htmlFor="login-username">Username or Email</Label>
              <Input id="login-username" value={loginForm.username} onChange={(e)=> setLoginForm(f=> ({...f, username:e.target.value}))} />
            </div>
            <div>
              <Label htmlFor="login-password">Password</Label>
              <Input id="login-password" type="password" value={loginForm.password} onChange={(e)=> setLoginForm(f=> ({...f, password:e.target.value}))} />
            </div>
            <Button onClick={doLogin}>Login</Button>
          </div>
        </div>
      )}

      {tab==='register' && (
        <div className="bg-white p-4 rounded shadow max-w-md">
          <div className="space-y-2">
            <div>
              <Label htmlFor="reg-username">Username</Label>
              <Input id="reg-username" value={regForm.username} onChange={(e)=> setRegForm(f=> ({...f, username:e.target.value}))} />
            </div>
            <div>
              <Label htmlFor="reg-email">Email</Label>
              <Input id="reg-email" type="email" value={regForm.email} onChange={(e)=> setRegForm(f=> ({...f, email:e.target.value}))} />
            </div>
            <div>
              <Label htmlFor="reg-password">Password</Label>
              <Input id="reg-password" type="password" value={regForm.password} onChange={(e)=> setRegForm(f=> ({...f, password:e.target.value}))} />
              <div className="text-xs text-gray-500">Min 8 chars, at least 1 letter and 1 number.</div>
            </div>
            <div>
              <Label htmlFor="reg-name">Full Name</Label>
              <Input id="reg-name" value={regForm.name} onChange={(e)=> setRegForm(f=> ({...f, name:e.target.value}))} />
            </div>
            <div>
              <Label htmlFor="reg-phone">Phone</Label>
              <Input id="reg-phone" value={regForm.phone} onChange={(e)=> setRegForm(f=> ({...f, phone:e.target.value}))} />
            </div>
            <div>
              <Label htmlFor="reg-role">Role</Label>
              <div className="flex items-center gap-2">
                <select id="reg-role" aria-describedby="role-help" className="border rounded-md px-3 py-2 w-full" value={role} onChange={async (e)=>{
                  const r = e.target.value; setRole(r);
                  try { const token = await Crypto.encryptAES256(r); sessionStorage.setItem('corepms_reg_role', token); } catch {}
                }}>
                  <option value="">Select a role</option>
                  <option value="admin">Admin</option>
                  <option value="manager">Manager</option>
                  <option value="employee">Employee</option>
                </select>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="outline" aria-label="Role info" onClick={()=> setRoleInfoOpen(true)}>?</Button>
                    </TooltipTrigger>
                    <TooltipContent>View role permissions and access details</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <div id="role-help" className="text-xs text-gray-500">Required. Choose the role to request.</div>
            </div>

            <Dialog open={roleInfoOpen} onOpenChange={setRoleInfoOpen}>
              <DialogContent aria-label="Role descriptions">
                <DialogHeader>
                  <DialogTitle>Role Permissions</DialogTitle>
                  <DialogDescription>Summary of access levels for common roles.</DialogDescription>
                </DialogHeader>
                <div className="text-sm space-y-2">
                  <p><strong>Admin:</strong> Full system access, user management, configuration.</p>
                  <p><strong>Manager:</strong> Operational modules, approvals, limited admin views.</p>
                  <p><strong>Employee:</strong> Assigned tasks and limited module access.</p>
                </div>
                <DialogFooter>
                  <Button onClick={()=> setRoleInfoOpen(false)}>Close</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <div>
              <Label htmlFor="dept-search">Departments</Label>
              <Input id="dept-search" placeholder="Search departments" value={deptQuery} onChange={(e)=> setDeptQuery(e.target.value)} aria-describedby="dept-help" />
              <div id="dept-help" className="text-xs text-gray-500">{isMultiSelectEnabled() ? 'Multiple selection enabled' : 'Single selection'}</div>
              <ScrollArea className="mt-2 h-40 rounded border">
                <div className="p-2" role="tree" aria-label="Departments">
                  {departments.length === 0 && (
                    <div className="text-xs text-gray-500">No departments found</div>
                  )}
                  {departments.map(root => (
                    <DeptNode key={root.id} node={root} selected={selectedDepts} onToggle={toggleDept} depth={0} />
                  ))}
                </div>
              </ScrollArea>
            </div>

            {approvalStatus !== 'idle' && (
              <div className="mt-2" role="status" aria-live="polite">
                <div className="flex items-center gap-2 text-sm">
                  <span className={`px-2 py-1 rounded ${approvalStatus==='pending'?'bg-yellow-100 text-yellow-800':''}${approvalStatus==='approved'?'bg-green-100 text-green-800':''}${approvalStatus==='rejected'?'bg-red-100 text-red-800':''}${approvalStatus==='escalated'?'bg-orange-100 text-orange-800':''}${approvalStatus==='cancelled'?'bg-gray-100 text-gray-700':''}`}>{approvalStatus}</span>
                  <span className="text-gray-600">ETA: {eta}</span>
                </div>
                <div className="mt-2 h-2 w-full bg-gray-200 rounded">
                  <div className={`h-2 rounded ${approvalStatus==='pending'?'bg-yellow-500 w-1/3':''}${approvalStatus==='escalated'?'bg-orange-500 w-1/2':''}${approvalStatus==='approved'?'bg-green-600 w-full':''}${approvalStatus==='rejected'?'bg-red-600 w-full':''}${approvalStatus==='cancelled'?'bg-gray-400 w-full':''}`}></div>
                </div>
                {approvalStatus==='pending' && (
                  <div className="mt-2">
                    <Button variant="outline" onClick={()=> setShowCancelDialog(true)}>Cancel Request</Button>
                  </div>
                )}
              </div>
            )}

            <Dialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
              <DialogContent aria-label="Cancel approval">
                <DialogHeader>
                  <DialogTitle>Cancel Approval Request</DialogTitle>
                  <DialogDescription>This will stop the approval process.</DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button variant="outline" onClick={()=> setShowCancelDialog(false)}>Keep</Button>
                  <Button onClick={onCancelRequest}>Confirm Cancel</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {approvalStatus==='approved' ? (
              <div className="mt-2">
                <h4 className="text-sm font-semibold">Onboarding Checklist</h4>
                <ul className="text-sm list-disc list-inside text-gray-700">
                  <li>Confirm email</li>
                  <li>Review assigned permissions</li>
                  <li>Complete profile details</li>
                </ul>
              </div>
            ) : (
              <Button onClick={doRegister} disabled={!role}>Submit for Approval</Button>
            )}
          </div>
        </div>
      )}

      {tab==='recover' && (
        <div className="bg-white p-4 rounded shadow max-w-md">
          <div className="space-y-2">
            <div>
              <Label htmlFor="rec-email">Username or Email</Label>
              <Input id="rec-email" value={recoverForm.email} onChange={(e)=> setRecoverForm(f=> ({...f, email:e.target.value}))} />
            </div>
            <Button variant="outline" onClick={doRequestReset}>Generate Reset Token</Button>
            <div>
              <Label htmlFor="rec-token">Reset Token</Label>
              <Input id="rec-token" value={recoverForm.token} onChange={(e)=> setRecoverForm(f=> ({...f, token:e.target.value}))} />
            </div>
            <div>
              <Label htmlFor="rec-new">New Password</Label>
              <Input id="rec-new" type="password" value={recoverForm.newPassword} onChange={(e)=> setRecoverForm(f=> ({...f, newPassword:e.target.value}))} />
            </div>
            <Button onClick={doReset}>Reset Password</Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default AuthPortal;

const DeptNode: React.FC<{ node: DepartmentNode; selected: string[]; onToggle: (id:string)=>void; depth: number }> = ({ node, selected, onToggle, depth }) => {
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
        type={isMultiSelectEnabled() ? 'checkbox':'radio'}
        aria-label={`Select ${node.name}`}
        checked={checked}
        onChange={()=> onToggle(node.id)}
        className="mr-2"
      />
      <span className="text-sm">{node.name}</span>
      {!collapsed && node.children && node.children.map(ch => (
        <DeptNode key={ch.id} node={ch} selected={selected} onToggle={onToggle} depth={depth+1} />
      ))}
    </div>
  );
};
