import React, { useMemo, useState } from 'react';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import * as RechartsPrimitive from 'recharts';
import gl, { REQUIRED_CODES, suggestAccountForPMSCode } from '@/lib/glAccounting';
import expenseSvc from '@/lib/expenseService';
import budgetSvc from '@/lib/budgetService';
import { isManager } from '@/lib/permissions';
import { useAuth } from '@/context/AuthContext';
import vendors from '@/lib/vendors';
import glHarness from '@/lib/glHarness';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import BackToAccountingButton from '@/components/modules/common/BackToAccountingButton';
import { usePagination } from '@/hooks/usePagination';
import PaginationBar from '@/components/shared/PaginationBar';

export const GLAccounting: React.FC = () => {
  const [coa, setCoa] = useState(gl.getAccounts());
  const [mappings, setMappings] = useState(gl.getMappings());
  const [newAcc, setNewAcc] = useState({ id: '', name: '', category: 'Asset' as any, department: '' });
  const [range, setRange] = useState({ from: new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0,10), to: new Date().toISOString().slice(0,10) });
  const [suggestInput, setSuggestInput] = useState({ codeName: '', costCenter: '', type: 'charge' as 'charge'|'payment'|'tax' });
  const suggestion = suggestAccountForPMSCode(suggestInput.codeName, { costCenter: suggestInput.costCenter, type: suggestInput.type });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingEdits, setPendingEdits] = useState<Record<string, Partial<{ name: string; category: 'Asset'|'Liability'|'Equity'|'Revenue'|'Expense'; department?: string }>>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [applyBusy, setApplyBusy] = useState(false);
  const { toast } = useToast();
  const hasInvalidEdits = useMemo(() => {
    for (const [id, d] of Object.entries(pendingEdits)) {
      const name = String(d.name || '').trim();
      const category = d.category as any;
      const dept = String(d.department || '').trim();
      if (!name) return true;
      if (!['Asset','Liability','Equity','Revenue','Expense'].includes(category)) return true;
      if (category === 'Expense' && !dept) return true;
    }
    return false;
  }, [pendingEdits]);

  React.useEffect(() => {
    const seeded = gl.ensureUSALIBaseAccounts();
    if (seeded?.length && coa.length === 0) setCoa(seeded);
  }, []);

  // Dev-only: auto-fill missing required GL mappings to speed up testing
  React.useEffect(() => {
    const isDev = (import.meta as any)?.env?.DEV;
    if (!isDev) return;
    try {
      const current = gl.getMappings();
      const missing = REQUIRED_CODES.filter((code) => !current[code]);
      if (missing.length === 0) return;
      const suggestions = gl.suggestRequiredCodeMappings();
      const next = { ...current } as Record<string, string>;
      for (const s of suggestions) {
        if (missing.includes(s.code) && s.accountId) {
          next[s.code] = s.accountId;
        }
      }
      gl.setMappings(next);
      setMappings(next);
    } catch (err) {
      // no-op in dev if suggestions fail
    }
  }, []);

  const tb = useMemo(() => gl.getTrialBalance(range.from, range.to), [range]);
  // Drill-down: account selected from the Trial Balance → its journal lines
  const [drillAccount, setDrillAccount] = useState<{ id: string; name: string } | null>(null);
  // Classify a journal entry's originating sub-ledger from its id/reference so the
  // drill panel can offer an "open source document" link.
  const classifySource = (entryId: string, reference: string): { source: string; module: string | null } => {
    const id = String(entryId || '');
    const ref = String(reference || '');
    if (id.startsWith('GLJE_') || /night ?audit/i.test(ref)) return { source: 'Night Audit', module: 'reports' };
    if (id.startsWith('GL_') || /vendor expense|expense/i.test(ref)) return { source: 'Expense', module: 'vendors' };
    if (/grn|goods received/i.test(ref)) return { source: 'GRN', module: 'inventory' };
    if (/folio|guest/i.test(ref)) return { source: 'Folio', module: 'front-office' };
    if (/city ?ledger/i.test(ref)) return { source: 'City Ledger', module: 'city-ledger' };
    return { source: 'Manual', module: null };
  };
  const drillLines = useMemo(() => {
    if (!drillAccount) return [];
    const rows: Array<{ date: string; reference: string; description: string; debit: number; credit: number; entryId: string; source: string; module: string | null }> = [];
    for (const entry of gl.getLedger()) {
      if (entry.date < range.from || entry.date > range.to) continue;
      for (const l of entry.lines) {
        if (l.accountId !== drillAccount.id) continue;
        const cls = classifySource(entry.id, entry.reference || '');
        rows.push({ date: entry.date, reference: entry.reference || entry.id, description: l.description || '', debit: l.debit, credit: l.credit, entryId: entry.id, source: cls.source, module: cls.module });
      }
    }
    return rows.sort((a, b) => a.date.localeCompare(b.date));
  }, [drillAccount, range]);
  const openSourceModule = (module: string | null) => {
    if (!module) return;
    try { window.dispatchEvent(new CustomEvent('navigateToModule', { detail: { module } })); } catch { /* noop */ }
  };
  const pl = useMemo(() => gl.getPLStatement(range.from, range.to), [range]);
  // Expandable P&L — break revenue & expense down to the account level so each
  // line can be drilled to the journal entries (and from there to source docs).
  const plDetail = useMemo(() => {
    const accs = gl.getAccounts();
    const catOf = (id: string) => accs.find(a => a.id === id)?.category;
    const nameOf = (id: string) => accs.find(a => a.id === id)?.name || id;
    const revenue = tb
      .filter(r => catOf(r.accountId) === 'Revenue')
      .map(r => ({ id: r.accountId, name: nameOf(r.accountId), amount: -r.balance }))
      .filter(r => Math.abs(r.amount) > 0.005)
      .sort((a, b) => b.amount - a.amount);
    const expense = tb
      .filter(r => catOf(r.accountId) === 'Expense')
      .map(r => ({ id: r.accountId, name: nameOf(r.accountId), amount: r.balance }))
      .filter(r => Math.abs(r.amount) > 0.005)
      .sort((a, b) => b.amount - a.amount);
    return { revenue, expense };
  }, [tb]);
  const bs = useMemo(() => gl.getBalanceSheet ? gl.getBalanceSheet(range.from, range.to) : { assets: 0, liabilities: 0, equity: 0 }, [range]);
  const mappingStatus = gl.validateMappingsComplete();
  const [aiSuggestions, setAiSuggestions] = useState<Array<{ code: string; accountId: string; reason: string }>>([]);
  const [validation, setValidation] = useState<{ status?: string; missing?: string[] } | null>(null);
  const [smoke, setSmoke] = useState<{ nightAudit?: string; expense?: string } | null>(null);
  const [expenseForm, setExpenseForm] = useState({ date: new Date().toISOString().slice(0,10), vendorId: '', invoiceRef: '', paymentMethod: 'Cash' as any, amount: '', currency: 'USD', glAccountId: '', costCenter: '', description: '', attachmentName: '', attachmentDataURL: '' });
  const [expenses, setExpenses] = useState<any[]>([]);
  const [vendorsList, setVendorsList] = useState<any[]>([]);
  const [approveThreshold] = useState(500);
  const [pending, setPending] = useState<any[]>([]);
  const coaPg = usePagination<any>(coa);
  const expensesPg = usePagination<any>(expenses);
  const [apAging, setApAging] = useState<any>({ current: [], d1_30: [], d31_60: [], d61_90: [], over90: [] });
  const [deptBreakdown, setDeptBreakdown] = useState<any[]>([]);
  const [dailyCashFlow, setDailyCashFlow] = useState<number>(0);

  React.useEffect(() => {
    (async () => {
      try {
        const [exps, vnds, pnds, aging, dept, cf] = await Promise.all([
          expenseSvc.listExpenses(),
          vendors.listVendors(),
          expenseSvc.listPendingApproval(),
          expenseSvc.getAPAging(range.to),
          expenseSvc.departmentalBreakdown(range.from, range.to),
          expenseSvc.getDailyCashFlow(new Date().toISOString().slice(0,10))
        ]);
        setExpenses(exps);
        setVendorsList(vnds);
        setPending(pnds);
        setApAging(aging);
        setDeptBreakdown(dept);
        setDailyCashFlow(cf.net);
      } catch (err) {
        console.error("Error loading GL accounting data:", err);
      }
    })();
  }, [range]);
  const [commentDraft, setCommentDraft] = useState<Record<string,string>>({});
  const { user } = useAuth();
  const isMgr = isManager(user?.role);

  // Dev-only auto verification: run mapping validation and smoke tests on mount
  React.useEffect(() => {
    try {
      // Only in dev to avoid noisy production behavior
      if ((import.meta as any)?.env?.DEV) {
        const date = new Date().toISOString().slice(0, 10);
        const results = glHarness.runSmokeTests(date);
        const na = results.nightAudit.ok
          ? `Night Audit OK (balanced ${results.nightAudit.entryId || ''})`
          : `Night Audit FAIL ${results.nightAudit.error ? `— ${results.nightAudit.error}` : ''}${results.nightAudit.missing?.length ? ` — Missing: ${results.nightAudit.missing.join(', ')}` : ''}`;
        const exp = results.expense.ok
          ? `Expense OK (expense ${results.expense.expenseId || ''}, entry ${results.expense.entryId || ''})`
          : `Expense FAIL ${results.expense.error ? `— ${results.expense.error}` : ''}`;
        setSmoke({ nightAudit: na, expense: exp });

        const mapVal = glHarness.validateNightAuditMappings(date);
        if (!mapVal.ok) {
          if (mapVal.missing && mapVal.missing.length) setValidation({ status: 'Missing mappings', missing: mapVal.missing });
          else setValidation({ status: `Validation failed: ${mapVal.error || 'Unknown error'}` });
        } else {
          setValidation({ status: `Validation OK — Balanced journal (${mapVal.entryId})` });
        }
      }
    } catch {}
  }, []);

  return (
    <div className="space-y-6">
      <BackToAccountingButton />
      <h3 className="text-xl font-bold">GL Accounting</h3>

      <div className="ds-section">
        <div className="ds-subheader">Chart of Accounts</div>
        <div className="ds-grid-responsive mb-3">
          <Input className="ds-input-compact" placeholder="Account ID" value={newAcc.id} onChange={(e)=>setNewAcc({...newAcc, id: e.target.value})} />
          <Input className="ds-input-compact" placeholder="Name" value={newAcc.name} onChange={(e)=>setNewAcc({...newAcc, name: e.target.value})} />
          <select className="ds-select-compact border rounded" value={newAcc.category} onChange={(e)=>setNewAcc({...newAcc, category: e.target.value as any})}>
            {(['Asset','Liability','Equity','Revenue','Expense'] as const).map(c=> <option key={c} value={c}>{c}</option>)}
          </select>
          {newAcc.category === 'Expense' && (
            <select className="ds-select-compact border rounded" value={newAcc.department} onChange={(e)=>setNewAcc({...newAcc, department: e.target.value})}>
              <option value="">Department</option>
              {['Rooms','F&B','Administration','Sales & Marketing'].map(d=> <option key={d} value={d}>{d}</option>)}
            </select>
          )}
        </div>
        <Button variant="outline" className="ds-button-compact" onClick={()=>{
          if (!newAcc.id || !newAcc.name) return;
          const next = [...coa, { ...newAcc }];
          gl.setAccounts(next); setCoa(next);
          // Write-through to the DB so the account is authoritative immediately
          // (not just at next startup migration). ON CONFLICT DO NOTHING server-side.
          fetch('/api/gl/accounts', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: newAcc.id, account_number: newAcc.id, name: newAcc.name, category: newAcc.category }),
          }).catch(() => { /* offline — startup migration will push it up later */ });
          setNewAcc({ id:'', name:'', category:'Asset' as any, department:'' });
        }}>Add Account</Button>
        <div className="ds-muted mt-2">Predefined USALI base accounts are seeded automatically.</div>
        
        <div className="ds-table-container mt-4">
          <table className="ds-table">
            <thead>
              <tr>
                <th className="p-2">ID</th>
                <th className="p-2">Name</th>
                <th className="p-2">Category</th>
                <th className="p-2">Department</th>
                <th className="p-2">Actions</th>
              </tr>
            </thead>
            <tbody>{coaPg.pageItems.map(a => {
              const isEditing = editingId === a.id;
              const draft = { name: pendingEdits[a.id]?.name ?? a.name, category: pendingEdits[a.id]?.category ?? a.category, department: pendingEdits[a.id]?.department ?? a.department } as any;
              const validateDraft = (): string | null => {
                if (!String(draft.name || '').trim()) return 'Name is required';
                if (!['Asset','Liability','Equity','Revenue','Expense'].includes(draft.category)) return 'Invalid category';
                if (draft.category === 'Expense' && !String(draft.department||'').trim()) return 'Department is required for Expense accounts';
                return null;
              };
              return (
                <tr key={a.id}>
                  <td className="p-2 font-mono text-xs">{String(a.id)}</td>
                  <td className="p-2">
                    {isEditing ? (
                      <Input className="ds-input-compact" value={draft.name} onChange={(e)=> setPendingEdits(p=> ({ ...p, [a.id]: { ...p[a.id], name: e.target.value } }))} />
                    ) : (
                      String(a.name)
                    )}
                    {isEditing && (()=>{ const err = validateDraft(); return err ? <div className="text-xs text-red-700 mt-1">{err}</div> : null; })()}
                  </td>
                  <td className="p-2">
                    {isEditing ? (
                      <select className="ds-select-compact border rounded" value={draft.category} onChange={(e)=> setPendingEdits(p=> ({ ...p, [a.id]: { ...p[a.id], category: e.target.value as any, department: e.target.value === 'Expense' ? (p[a.id]?.department || a.department || '') : '' } }))}>
                        {(['Asset','Liability','Equity','Revenue','Expense'] as const).map(c=> <option key={c} value={c}>{c}</option>)}
                      </select>
                    ) : (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100">{String(a.category)}</span>
                    )}
                  </td>
                  <td className="p-2">
                    {isEditing ? (
                      draft.category === 'Expense' ? (
                        <select className="ds-select-compact border rounded" value={draft.department || ''} onChange={(e)=> setPendingEdits(p=> ({ ...p, [a.id]: { ...p[a.id], department: e.target.value } }))}>
                          <option value="">Department</option>
                          {['Rooms','F&B','Administration','Sales & Marketing'].map(d=> <option key={d} value={d}>{d}</option>)}
                        </select>
                      ) : (
                        <span>—</span>
                      )
                    ) : (
                      <span className="text-xs italic">{String(a.department || '—')}</span>
                    )}
                  </td>
                  <td className="p-2">
                    {isEditing ? (
                      <div className="flex gap-1">
                        <Button variant="outline" className="ds-button-compact bg-green-50" onClick={() => { if (!validateDraft()) setEditingId(null); }}>Done</Button>
                        <Button variant="outline" className="ds-button-compact bg-red-50" onClick={() => { setPendingEdits(p => { const n = { ...p }; delete n[a.id]; return n; }); setEditingId(null); }}>Cancel</Button>
                      </div>
                    ) : (
                      <div className="flex gap-1">
                        <Button variant="outline" className="ds-button-compact" onClick={() => setEditingId(a.id)}>Edit</Button>
                        <Button variant="destructive" className="ds-button-compact" onClick={() => { if (confirm(`Delete account ${a.id}?`)) { const next = coa.filter(x => x.id !== a.id); gl.setAccounts(next); setCoa(next); } }}>Del</Button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
        <PaginationBar {...coaPg} itemLabel="accounts" />
      </div>
      {Object.keys(pendingEdits).length > 0 && (
            <div className="mt-3 p-2 border rounded bg-yellow-50 text-xs">
              <div className="font-semibold mb-1">Pending Changes Preview</div>
              <div className="space-y-1">
                {Object.entries(pendingEdits).map(([id, d])=>{
                  const before = coa.find(x=> x.id===id);
                  return (
                    <div key={id}>
                      <span className="font-mono">{id}</span>: {before?.name} → {d.name || before?.name} · {before?.category} → {d.category || before?.category} · {before?.department || '—'} → {d.department || ((d as any).category==='Expense' ? before?.department || '—' : '—')}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

      <div className="p-4 border rounded">
        <div className="font-semibold mb-2">Code Mappings</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {REQUIRED_CODES.map(code => (
            <div key={code} className="flex items-center gap-2">
              <label className="w-48 text-sm">{code}</label>
              <Input placeholder="Account ID" value={mappings[code] || ''} onChange={(e)=>{ const next = { ...mappings, [code]: e.target.value }; setMappings(next); gl.setMappings(next); }} />
            </div>
          ))}
        </div>
        <div className={`mt-2 text-sm ${mappingStatus.ok ? 'text-green-700' : 'text-red-700'}`}>{mappingStatus.ok ? 'All required codes mapped.' : `Missing: ${mappingStatus.missing.join(', ')}`}</div>
        <div className="mt-2 flex items-center gap-2">
          <Button variant="outline" onClick={()=>{
            const date = new Date().toISOString().slice(0,10);
            const res = glHarness.validateNightAuditMappings(date);
            if (!res.ok) {
              if (res.missing && res.missing.length) setValidation({ status: 'Missing mappings', missing: res.missing });
              else setValidation({ status: `Validation failed: ${res.error || 'Unknown error'}` });
            } else {
              setValidation({ status: `Validation OK — Balanced journal (${res.entryId})` });
            }
          }}>Validate Mappings</Button>
          {validation?.status && (
            <span className="text-xs text-gray-700">{validation.status}{validation.missing?.length ? `: ${validation.missing.join(', ')}` : ''}</span>
          )}
          <Button variant="outline" onClick={()=>{
            const date = new Date().toISOString().slice(0,10);
            const results = glHarness.runSmokeTests(date);
            const na = results.nightAudit.ok ? `Night Audit OK (balanced ${results.nightAudit.entryId || ''})` : `Night Audit FAIL ${results.nightAudit.error ? `— ${results.nightAudit.error}` : ''}${results.nightAudit.missing?.length ? ` — Missing: ${results.nightAudit.missing.join(', ')}` : ''}`;
            const exp = results.expense.ok ? `Expense OK (expense ${results.expense.expenseId || ''}, entry ${results.expense.entryId || ''})` : `Expense FAIL ${results.expense.error ? `— ${results.expense.error}` : ''}`;
            setSmoke({ nightAudit: na, expense: exp });
          }}>Run Smoke Tests</Button>
          {smoke && (
            <div className="text-xs text-gray-700 space-y-1">
              <div>{smoke.nightAudit}</div>
              <div>{smoke.expense}</div>
            </div>
          )}
        </div>
        <div className="mt-3 p-3 border rounded">
          <div className="font-semibold mb-2">AI Mapping for Required Codes</div>
          <div className="flex items-center gap-2 mb-2">
            <Button variant="outline" onClick={()=>{ const s = gl.suggestRequiredCodeMappings(); setAiSuggestions(s); }}>Run AI Suggestions</Button>
            <Button className="bg-indigo-600 text-white" disabled={applyBusy || hasInvalidEdits || (aiSuggestions.length===0 && Object.keys(pendingEdits).length===0)} onClick={()=> setConfirmOpen(true)}>Apply Suggestions & Edits</Button>
          </div>
          {aiSuggestions.length>0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr><th className="p-2">Code</th><th className="p-2">Suggested Account</th><th className="p-2">Reason</th></tr></thead>
                <tbody>
                  {aiSuggestions.map(s=> (<tr key={s.code}><td className="p-2">{s.code}</td><td className="p-2">{s.accountId}</td><td className="p-2 text-gray-600">{s.reason}</td></tr>))}
                </tbody>
              </table>
            </div>
          )}
          <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Apply Changes</DialogTitle>
              </DialogHeader>
              <div className="text-sm">
                <div>Pending edits: <span className="font-semibold">{Object.keys(pendingEdits).length}</span></div>
                <div>AI suggestions to apply: <span className="font-semibold">{aiSuggestions.length}</span></div>
                <div className="mt-2 text-xs text-gray-600">Please confirm to validate and apply changes to Chart of Accounts and required code mappings.</div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={()=> setConfirmOpen(false)}>Cancel</Button>
                <Button className="bg-indigo-600 text-white" onClick={()=>{
                  setApplyBusy(true);
                  try {
                    // Validate edits
                    for (const [id, d] of Object.entries(pendingEdits)) {
                      const name = String(d.name || '').trim();
                      const category = d.category as any;
                      const dept = String(d.department || '').trim();
                      if (!name) throw new Error(`Account ${id}: name is required`);
                      if (!['Asset','Liability','Equity','Revenue','Expense'].includes(category)) throw new Error(`Account ${id}: invalid category`);
                      if (category === 'Expense' && !dept) throw new Error(`Account ${id}: department required for Expense`);
                    }
                    // Apply edits
                    const nextAcc = coa.map(a => pendingEdits[a.id] ? { ...a, name: pendingEdits[a.id].name ?? a.name, category: (pendingEdits[a.id].category ?? a.category) as any, department: (pendingEdits[a.id].category ?? a.category) === 'Expense' ? (pendingEdits[a.id].department ?? a.department ?? '') : '' } : a);
                    gl.setAccounts(nextAcc); setCoa(nextAcc);
                    // Audit trail
                    try {
                      const raw = localStorage.getItem('corepms_gl_account_audit');
                      const list = raw ? JSON.parse(raw) : [];
                      const now = new Date().toISOString();
                      const entries = Object.entries(pendingEdits).map(([id,d])=> ({ id, before: coa.find(x=>x.id===id), after: nextAcc.find(x=>x.id===id), user: user?.username, timestamp: now, action: 'edit' }));
                      localStorage.setItem('corepms_gl_account_audit', JSON.stringify([ ...entries, ...list ].slice(0, 2000)));
                    } catch {}
                    // Apply AI suggestions to mappings
                    const nextMap = { ...mappings };
                    aiSuggestions.forEach(s=>{ if (!nextMap[s.code]) nextMap[s.code] = s.accountId; });
                    gl.setMappings(nextMap); setMappings(nextMap);
                    setPendingEdits({}); setAiSuggestions([]); setConfirmOpen(false);
                    toast({ title: 'Changes Applied', description: 'Chart of Accounts and mappings updated successfully.' });
                  } catch (err:any) {
                    toast({ title: 'Apply Failed', description: String(err?.message || err) });
                  } finally {
                    setApplyBusy(false);
                  }
                }}>Confirm Apply</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
        <div className="mt-4 p-3 border rounded">
          <div className="font-semibold mb-2">AI / Suggested Mapping</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-2">
            <Input placeholder="PMS Charge Code name" value={suggestInput.codeName} onChange={(e)=>setSuggestInput(s=>({ ...s, codeName: e.target.value }))} />
            <select className="border rounded px-2 py-2" value={suggestInput.costCenter} onChange={(e)=>setSuggestInput(s=>({ ...s, costCenter: e.target.value }))}>
              <option value="">Cost Center (optional)</option>
              <option value="bar">Bar</option>
              <option value="restaurant">Restaurant</option>
            </select>
            <select className="border rounded px-2 py-2" value={suggestInput.type} onChange={(e)=>setSuggestInput(s=>({ ...s, type: e.target.value as any }))}>
              <option value="charge">Charge</option>
              <option value="payment">Payment</option>
              <option value="tax">Tax</option>
            </select>
          </div>
          <div className="text-xs mb-2">Suggested Account: <span className="font-semibold">{suggestion.accountId}</span> — {suggestion.reason}</div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={()=>{
              const key = String(suggestInput.codeName || '').trim().toUpperCase().replace(/\s+/g,'_');
              if (!key) return;
              const next = { ...mappings, [key]: suggestion.accountId };
              gl.setMappings(next); setMappings(next);
            }}>Apply Mapping</Button>
            <div className="text-xs text-gray-600">Applied under code key: {String(suggestInput.codeName || '').trim().toUpperCase().replace(/\s+/g,'_') || '—'}</div>
          </div>
        </div>
      </div>

      {/* Expense Entry */}
      <div className="p-4 border rounded">
        <div className="font-semibold mb-2">Expense Entry</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <div>
            <label className="text-xs">Date</label>
            <Input type="date" value={expenseForm.date} onChange={(e)=>setExpenseForm(f=>({ ...f, date: e.target.value }))} />
          </div>
          <div>
            <label className="text-xs">Vendor</label>
            <select className="border rounded px-2 py-2 w-full" value={expenseForm.vendorId} onChange={(e)=>setExpenseForm(f=>({ ...f, vendorId: e.target.value }))}>
              <option value="">Select vendor</option>
              {vendorsList.map(v=> <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs">Invoice/Ref</label>
            <Input value={expenseForm.invoiceRef} onChange={(e)=>setExpenseForm(f=>({ ...f, invoiceRef: e.target.value }))} />
          </div>
          <div>
            <label className="text-xs">Payment Method</label>
            <select className="border rounded px-2 py-2 w-full" value={expenseForm.paymentMethod} onChange={(e)=>setExpenseForm(f=>({ ...f, paymentMethod: e.target.value as any }))}>
              <option>Cash</option>
              <option>BankTransfer</option>
              <option>CreditCard</option>
            </select>
          </div>
          <div>
            <label className="text-xs">Amount</label>
            <Input type="number" value={expenseForm.amount} onChange={(e)=>setExpenseForm(f=>({ ...f, amount: e.target.value }))} />
          </div>
          <div>
            <label className="text-xs">Currency</label>
            <Input value={expenseForm.currency} onChange={(e)=>setExpenseForm(f=>({ ...f, currency: e.target.value }))} />
          </div>
          <div>
            <label className="text-xs">GL Account</label>
            <select className="border rounded px-2 py-2 w-full" value={expenseForm.glAccountId} onChange={(e)=>setExpenseForm(f=>({ ...f, glAccountId: e.target.value }))}>
              <option value="">Select account</option>
              {gl.getAccounts().filter(a=> a.category==='Expense').map(a=> <option key={a.id} value={a.id}>{a.id} - {a.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs">Cost Center</label>
            <select className="border rounded px-2 py-2 w-full" value={expenseForm.costCenter} onChange={(e)=>setExpenseForm(f=>({ ...f, costCenter: e.target.value }))}>
              <option value="">Select</option>
              <option value="Rooms">Rooms</option>
              <option value="F&B">Food & Beverage</option>
              <option value="Administration">Administration</option>
              <option value="Sales & Marketing">Sales & Marketing</option>
            </select>
          </div>
          <div className="md:col-span-3">
            <label className="text-xs">Description</label>
            <Input value={expenseForm.description} onChange={(e)=>setExpenseForm(f=>({ ...f, description: e.target.value }))} />
          </div>
          <div className="md:col-span-3">
            <label className="text-xs">Attachment</label>
            <input type="file" className="border rounded px-2 py-2 w-full" onChange={async (e)=>{
              const file = e.target.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = ()=>{ setExpenseForm(f=>({ ...f, attachmentName: file.name, attachmentDataURL: String(reader.result) })); }; reader.readAsDataURL(file);
            }} />
          </div>
        </div>
        <div className="mt-3 flex gap-2 items-center">
          <Button className="bg-indigo-600 text-white" onClick={async ()=>{
            const amt = Number(expenseForm.amount||0);
            const res = await expenseSvc.addExpense({ date: expenseForm.date, vendorId: expenseForm.vendorId, invoiceRef: expenseForm.invoiceRef, paymentMethod: expenseForm.paymentMethod, amount: amt, currency: expenseForm.currency, glAccountId: expenseForm.glAccountId, costCenter: expenseForm.costCenter, description: expenseForm.description, attachmentName: expenseForm.attachmentName, attachmentDataURL: expenseForm.attachmentDataURL });
            if (res.ok) { const exps = await expenseSvc.listExpenses(); setExpenses(exps); setExpenseForm({ ...expenseForm, invoiceRef:'', amount:'', description:'', attachmentName:'', attachmentDataURL:'' }); }
          }}>Add Expense</Button>
          <div className="text-xs text-gray-600">Approval threshold: ${approveThreshold}+ requires manager sign-off.</div>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="text-sm w-full">
            <thead><tr><th className="p-2">Date</th><th className="p-2">Vendor</th><th className="p-2">Invoice</th><th className="p-2 text-right">Amount</th><th className="p-2">GL</th><th className="p-2">Cost Center</th><th className="p-2">Status</th><th className="p-2">Actions</th></tr></thead>
            <tbody>
              {expensesPg.pageItems.map(r=> (
                <tr key={r.id}>
                  <td className="p-2">{r.date}</td>
                  <td className="p-2">{vendorsList.find(v=>v.id===r.vendorId)?.name || r.vendorId}</td>
                  <td className="p-2">{r.invoiceRef}</td>
                  <td className="p-2 text-right">${Number(r.amount || 0).toFixed(2)}</td>
                  <td className="p-2">{r.glAccountId}</td>
                  <td className="p-2">{r.costCenter}</td>
                  <td className="p-2">{r.status}</td>
                  <td className="p-2">
                    <div className="flex items-center gap-2">
                      {r.status==='pending_approval' && <Button variant="outline" onClick={async ()=>{ const ok = await expenseSvc.approveExpense(r.id); if (ok.ok) { const exps = await expenseSvc.listExpenses(); setExpenses(exps); } }}>Approve</Button>}
                      {r.status==='approved' && <Button className="bg-green-600 text-white" onClick={async ()=>{ const ok = await expenseSvc.postExpenseToGL(r.id); if (ok.ok) { const exps = await expenseSvc.listExpenses(); setExpenses(exps); } }}>Post to GL</Button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <PaginationBar {...expensesPg} itemLabel="expenses" />
      </div>

      {/* Budgets */}
      <div className="p-4 border rounded">
        <div className="font-semibold mb-2">Budgets</div>
        {(()=>{ const [month, setMonth] = React.useState(new Date().toISOString().slice(0,7)); const [rev, setRev] = React.useState(''); const [cc, setCc] = React.useState<Record<string,string>>({ Rooms:'', 'F&B':'', Administration:'', 'Sales & Marketing':'' }); return (
          <div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <div>
                <label className="text-xs">Month</label>
                <Input type="month" value={month} onChange={(e)=>setMonth(e.target.value)} />
              </div>
              <div>
                <label className="text-xs">Revenue Budget</label>
                <Input type="number" value={rev} onChange={(e)=>setRev(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mt-2">
              {Object.keys(cc).map(k=> (
                <div key={k}><label className="text-xs">{k}</label><Input type="number" value={cc[k]} onChange={(e)=>setCc(x=>({ ...x, [k]: e.target.value }))} /></div>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <Button variant="outline" onClick={()=>{ budgetSvc.setBudget({ month, revenue: Number(rev||0), costCenters: Object.fromEntries(Object.entries(cc).map(([k,v])=>[k, Number(v||0)])) }); }}>Save Budget</Button>
              <Button variant="outline" onClick={()=>{ const rows = budgetSvc.listBudgets(); const header='month,revenue,Rooms,F&B,Administration,Sales & Marketing'; const data = rows.map(r=> [r.month,r.revenue,r.costCenters?.Rooms||0,r.costCenters?.['F&B']||0,r.costCenters?.Administration||0,r.costCenters?.['Sales & Marketing']||0].join(',')); const blob = new Blob([ [header, ...data].join('\n') ], { type:'text/csv' }); const url = URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='budgets.csv'; a.click(); URL.revokeObjectURL(url); }}>Export Budgets CSV</Button>
              <input type="file" className="border rounded px-2 py-2" onChange={async (e)=>{ const file=e.target.files?.[0]; if(!file) return; const text= await file.text(); const lines=text.split(/\r?\n/).filter(Boolean); const [hdr,...rest]=lines; rest.forEach(l=>{ const [m, r, rooms, fb, admin, sm] = l.split(','); budgetSvc.setBudget({ month:m, revenue:Number(r||0), costCenters:{ Rooms:Number(rooms||0), 'F&B':Number(fb||0), Administration:Number(admin||0), 'Sales & Marketing':Number(sm||0) } }); }); }} />
            </div>
          </div>
        ); })()}
      </div>

      {/* Expense Reports */}
      <div className="p-4 border rounded">
        <div className="font-semibold mb-2">Expense Reports</div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mb-2">
          <div>
            <label className="text-xs">From</label>
            <Input type="date" value={range.from} onChange={(e)=>setRange(r=>({ ...r, from: e.target.value }))} />
          </div>
          <div>
            <label className="text-xs">To</label>
            <Input type="date" value={range.to} onChange={(e)=>setRange(r=>({ ...r, to: e.target.value }))} />
          </div>
          <div>
            <label className="text-xs">GL Account</label>
            <select className="border rounded px-2 py-2 w-full" onChange={(e)=>{ /* simple filter at export */ }}>
              <option value="">All</option>
              {gl.getAccounts().map(a=> <option key={a.id} value={a.id}>{a.id} - {a.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs">Cost Center</label>
            <select className="border rounded px-2 py-2 w-full" onChange={(e)=>{ /* simple filter at export */ }}>
              <option value="">All</option>
              <option value="Rooms">Rooms</option>
              <option value="F&B">Food & Beverage</option>
              <option value="Administration">Administration</option>
              <option value="Sales & Marketing">Sales & Marketing</option>
            </select>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={async ()=>{
            const rows = await expenseSvc.filterExpenses({ from: range.from, to: range.to });
            const blob = expenseSvc.exportCSV(rows);
            const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href=url; a.download='expenses.csv'; a.click(); URL.revokeObjectURL(url);
          }}>Export CSV</Button>
          <div className="text-xs text-gray-600">Daily Cash Flow (today): $ {dailyCashFlow.toFixed(2)} net</div>
        </div>

        {/* AP Aging */}
        <div className="mt-4 border rounded p-3">
          <div className="font-semibold mb-2">A/P Aging</div>
          {(()=>{ const ag = apAging; const total = (arr: any[])=> (arr || []).reduce((s,r)=> s + r.amount,0); return (
            <div className="grid grid-cols-1 md:grid-cols-5 gap-2 text-sm">
              <div className="p-2 bg-gray-50 rounded">Current: $ {total(ag.current).toFixed(2)} ({ag.current?.length || 0})</div>
              <div className="p-2 bg-gray-50 rounded">1–30: $ {total(ag.d1_30).toFixed(2)} ({ag.d1_30?.length || 0})</div>
              <div className="p-2 bg-gray-50 rounded">31–60: $ {total(ag.d31_60).toFixed(2)} ({ag.d31_60?.length || 0})</div>
              <div className="p-2 bg-gray-50 rounded">61–90: $ {total(ag.d61_90).toFixed(2)} ({ag.d61_90?.length || 0})</div>
              <div className="p-2 bg-gray-50 rounded">&gt;90: $ {total(ag.over90).toFixed(2)} ({ag.over90?.length || 0})</div>
            </div>
          ); })()}
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><th className="p-2">Bucket</th><th className="p-2">Date</th><th className="p-2">Vendor</th><th className="p-2">Invoice</th><th className="p-2 text-right">Amount</th><th className="p-2">Days</th></tr></thead>
              <tbody>
                {(()=>{ const ag = apAging; const row = (e:any,b:string)=> (
                  <tr key={e.id}><td className="p-2">{b}</td><td className="p-2">{e.date}</td><td className="p-2">{vendorsList.find(v=>v.id===e.vendorId)?.name || e.vendorId}</td><td className="p-2">{e.invoiceRef}</td><td className="p-2 text-right">${Number(e.amount || 0).toFixed(2)}</td><td className="p-2">{Math.floor((new Date(range.to).getTime() - new Date(e.date).getTime())/(1000*60*60*24))}</td></tr>
                ); return [
                  ...(ag.current || []).map((e: any)=> row(e,'Current')),
                  ...(ag.d1_30 || []).map((e: any)=> row(e,'1–30')),
                  ...(ag.d31_60 || []).map((e: any)=> row(e,'31–60')),
                  ...(ag.d61_90 || []).map((e: any)=> row(e,'61–90')),
                  ...(ag.over90 || []).map((e: any)=> row(e,'>90')),
                ]; })()}
              </tbody>
            </table>
          </div>
          <div className="mt-2">
            <Button variant="outline" onClick={()=>{ const ag = apAging; const rows = ['bucket,date,vendor,invoice,amount,days']; const push=(e:any,b:string)=> rows.push([b,e.date,(vendorsList.find(v=>v.id===e.vendorId)?.name||e.vendorId),e.invoiceRef,e.amount,Math.floor((new Date(range.to).getTime()-new Date(e.date).getTime())/(1000*60*60*24))].join(',')); (ag.current||[]).forEach((e:any)=>push(e,'Current')); (ag.d1_30||[]).forEach((e:any)=>push(e,'1-30')); (ag.d31_60||[]).forEach((e:any)=>push(e,'31-60')); (ag.d61_90||[]).forEach((e:any)=>push(e,'61-90')); (ag.over90||[]).forEach((e:any)=>push(e,'>90')); const blob = new Blob([rows.join('\n')], { type:'text/csv' }); const url = URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='ap_aging_detail.csv'; a.click(); URL.revokeObjectURL(url); }}>Export AP Aging CSV</Button>
          </div>
        </div>

        {/* Departmental Breakdown */}
        <div className="mt-4 border rounded p-3">
          <div className="font-semibold mb-2">Departmental Expense Breakdown</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><th className="p-2 text-left">Cost Center</th><th className="p-2 text-right">Total</th></tr></thead>
              <tbody>
                {deptBreakdown.map(r => (
                  <tr key={r.costCenter}><td className="p-2">{r.costCenter}</td><td className="p-2 text-right">$ {Number(r.total || 0).toFixed(2)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

      {/* USALI Income Statement */}
      <div className="mt-4 border rounded p-3">
        <div className="font-semibold mb-2">USALI Income Statement (Summary)</div>
          {(()=>{ const repPromise = expenseSvc.getUSALIIncomeStatement(range.from, range.to); return (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              {(()=>{ const [rep, setRep] = React.useState<any | null>(null); const bud = budgetSvc.getBudget(range.to.slice(0,7)); React.useEffect(()=>{ (async()=>{ const r = await repPromise; setRep(r); })(); }, [range]); if (!rep) return <div className="p-3">Loading…</div>; return (
                <>
                  <div className="border rounded p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <label className="text-xs">Filter Department</label>
                      <select className="border rounded px-2 py-1 text-xs" onChange={(e)=>{ /* simple client filter */ }}>
                        <option value="">All</option>
                        {['Rooms','F&B','Administration','Sales & Marketing'].map(d=> <option key={d}>{d}</option>)}
                      </select>
                    </div>
                    <div>Revenue: <span className="font-semibold">$ {Number(rep.revenue || 0).toFixed(2)}</span> {bud?.revenue ? <span className="text-xs text-gray-600">(Budget $ {Number(bud.revenue || 0).toFixed(2)})</span> : null}</div>
                    <div className="mt-2">Departmental Expenses:</div>
                    {rep.departmentalExpenses.map((e:any)=> <div key={e.costCenter} className="flex justify-between"><span>{e.costCenter}</span><span>$ {Number(e.amount || 0).toFixed(2)} {bud?.costCenters?.[e.costCenter] ? <span className="text-xs text-gray-600">(Budget $ {bud.costCenters[e.costCenter].toFixed(2)})</span> : null}</span></div>)}
                    <div className="mt-2">Departmental Profit: <span className="font-semibold">$ {rep.departmentalProfit.toFixed(2)}</span></div>
                    <div className="mt-2">Undistributed Expenses:</div>
                    {rep.undistributedExpenses.map((e:any)=> <div key={e.costCenter} className="flex justify-between"><span>{e.costCenter}</span><span>$ {Number(e.amount || 0).toFixed(2)}</span></div>)}
                    <div className="mt-2">GOP: <span className="font-semibold">$ {rep.GOP.toFixed(2)}</span></div>
                  </div>
                  <div className="border rounded p-3">
                    <div className="font-semibold mb-1">YTD vs Budget vs Prior Year</div>
                    <div>YTD Revenue: $ {Number(rep.ytd?.revenue || 0).toFixed(2)}</div>
                    <div>YTD Dept Expenses: $ {rep.ytd.deptExpenses.toFixed(2)}</div>
                    <div>YTD Undistributed: $ {rep.ytd.undistributed.toFixed(2)}</div>
                    <div>YTD GOP: $ {rep.ytd.GOP.toFixed(2)}</div>
                    <div className="mt-2">Prior YTD GOP: $ {rep.ytdPrior.GOP.toFixed(2)}</div>
                  </div>
                </>
              ); })()}
            </div>
          ); })()}
        </div>

        {/* Department Trends */}
        <div className="mt-4 border rounded p-3">
          <div className="font-semibold mb-2">Department Trends</div>
          {(()=>{ const [dept, setDept] = React.useState('Rooms'); const [months, setMonths] = React.useState(6); const data = expenseSvc.getDepartmentMonthlyTrend(dept, months, range.to); const config = { expense: { label:'Expense', color: '#ef4444' }, revenue: { label:'Revenue', color:'#3b82f6' }, pct: { label:'Expense % of Revenue', color:'#22c55e' } }; return (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <select className="border rounded px-2 py-1 text-sm" value={dept} onChange={(e)=>setDept(e.target.value)}>
                  {['Rooms','F&B','Administration','Sales & Marketing'].map(d=> <option key={d} value={d}>{d}</option>)}
                </select>
                <select className="border rounded px-2 py-1 text-sm" value={months} onChange={(e)=>setMonths(Number(e.target.value))}>
                  <option value={6}>Last 6 months</option>
                  <option value={12}>Last 12 months</option>
                </select>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <ChartContainer config={config}>
                  <RechartsPrimitive.LineChart data={data}>
                    <RechartsPrimitive.CartesianGrid strokeDasharray="3 3" />
                    <RechartsPrimitive.XAxis dataKey="month" />
                    <RechartsPrimitive.YAxis />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <RechartsPrimitive.Legend />
                    <RechartsPrimitive.Line type="monotone" dataKey="expense" stroke="var(--color-expense)" />
                    <RechartsPrimitive.Line type="monotone" dataKey="revenue" stroke="var(--color-revenue)" />
                  </RechartsPrimitive.LineChart>
                </ChartContainer>
                <ChartContainer config={config}>
                  <RechartsPrimitive.LineChart data={data}>
                    <RechartsPrimitive.CartesianGrid strokeDasharray="3 3" />
                    <RechartsPrimitive.XAxis dataKey="month" />
                    <RechartsPrimitive.YAxis />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <RechartsPrimitive.Legend />
                    <RechartsPrimitive.Line type="monotone" dataKey="pct" stroke="var(--color-pct)" />
                  </RechartsPrimitive.LineChart>
                </ChartContainer>
              </div>
            </div>
          ); })()}
        </div>

        {/* USALI Drill-down */}
        <div className="mt-4 border rounded p-3">
          <div className="font-semibold mb-2">USALI Drill-down</div>
          {(()=>{ const [dept, setDept] = React.useState('Rooms'); const rows = expenseSvc.getDepartmentAccountsDrilldown(range.from, range.to, dept); return (
            <div>
              <div className="flex items-center gap-2 mb-2"><label className="text-xs">Department</label><select className="border rounded px-2 py-1 text-sm" value={dept} onChange={(e)=>setDept(e.target.value)}>{['Rooms','F&B','Administration','Sales & Marketing'].map(d=> <option key={d} value={d}>{d}</option>)}</select></div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr><th className="p-2 text-left">GL Account</th><th className="p-2 text-right">Total</th><th className="p-2">Transactions</th></tr></thead>
                  <tbody>
                    {rows.map(r=> (
                      <tr key={r.accountId}>
                        <td className="p-2">{r.accountId}</td><td className="p-2 text-right">$ {Number(r.total || 0).toFixed(2)}</td>
                        <td className="p-2">
                          <details>
                            <summary className="cursor-pointer text-xs">View</summary>
                            <table className="w-full text-xs mt-2">
                              <thead><tr><th className="p-1">Date</th><th className="p-1">Entry</th><th className="p-1">Ref</th><th className="p-1 text-right">Amount</th><th className="p-1">Description</th></tr></thead>
                              <tbody>
                                {r.lines.map(l=> (<tr key={l.entryId+String(l.amount)}><td className="p-1">{String(l.date)}</td><td className="p-1">{String(l.entryId)}</td><td className="p-1">{String(l.reference||'—')}</td><td className="p-1 text-right">$ {Number(l.amount || 0).toFixed(2)}</td><td className="p-1">{String(l.description||'—')}</td></tr>))}
                              </tbody>
                            </table>
                          </details>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ); })()}
        </div>
      </div>

      {/* Approve Queue (Manager) */}
      {isMgr && (
        <div className="p-4 border rounded">
          <div className="font-semibold mb-2">Manager Approval Queue</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><th className="p-2">Date</th><th className="p-2">Vendor</th><th className="p-2">Invoice</th><th className="p-2 text-right">Amount</th><th className="p-2">Comment</th><th className="p-2">Actions</th></tr></thead>
              <tbody>
                {pending.map(r=> (
                  <tr key={r.id}>
                    <td className="p-2">{r.date}</td>
                    <td className="p-2">{vendorsList.find(v=>v.id===r.vendorId)?.name || r.vendorId}</td>
                    <td className="p-2">{r.invoiceRef}</td>
                    <td className="p-2 text-right">${Number(r.amount || 0).toFixed(2)}</td>
                    <td className="p-2">
                      <Input placeholder="Add comment" value={commentDraft[r.id]||''} onChange={(e)=>setCommentDraft(d=>({ ...d, [r.id]: e.target.value }))} />
                    </td>
                    <td className="p-2">
                      <div className="flex items-center gap-2">
                        <Button variant="outline" onClick={async ()=>{ const text = (commentDraft[r.id]||'').trim(); if (text) await expenseSvc.addComment(r.id, 'manager', text); const ok = await expenseSvc.approveExpense(r.id); if (ok.ok) { const [pnds, exps] = await Promise.all([expenseSvc.listPendingApproval(), expenseSvc.listExpenses()]); setPending(pnds); setExpenses(exps); } }}>Approve</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <div className="p-4 border rounded">
        <div className="font-semibold mb-2">Reports</div>
        <div className="flex items-center gap-2 mb-2">
          <div>
            <label className="text-xs">From</label>
            <Input type="date" value={range.from} onChange={(e)=>setRange(r=>({ ...r, from: e.target.value }))} />
          </div>
          <div>
            <label className="text-xs">To</label>
            <Input type="date" value={range.to} onChange={(e)=>setRange(r=>({ ...r, to: e.target.value }))} />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="border rounded p-3">
            <div className="font-semibold mb-1">Trial Balance</div>
            <div className="overflow-x-auto">
              <table className="text-sm w-full">
                <thead><tr><th className="p-2 text-left">Account</th><th className="p-2 text-right">Debit</th><th className="p-2 text-right">Credit</th><th className="p-2 text-right">Balance</th></tr></thead>
                <tbody>{tb.map(r => (<tr key={r.accountId} onClick={()=>setDrillAccount({ id: r.accountId, name: r.name })} title="Click to view the transactions behind this balance" className="cursor-pointer hover:bg-indigo-50"><td className="p-2">{r.accountId} - {r.name}</td><td className="p-2 text-right">$ {Number(r.debit || 0).toFixed(2)}</td><td className="p-2 text-right">$ {Number(r.credit || 0).toFixed(2)}</td><td className="p-2 text-right">$ {Number(r.balance || 0).toFixed(2)}</td></tr>))}</tbody>
              </table>
            </div>
            {drillAccount && (
              <div className="mt-3 border rounded p-3 bg-indigo-50/40">
                <div className="flex items-center justify-between mb-2">
                  <div className="font-semibold text-sm">
                    Transactions — {drillAccount.id} {drillAccount.name}
                    <span className="ml-2 font-normal text-xs text-gray-500">({range.from} → {range.to})</span>
                  </div>
                  <button onClick={()=>setDrillAccount(null)} className="text-gray-400 hover:text-gray-600 font-bold">✕</button>
                </div>
                {drillLines.length === 0 ? (
                  <div className="text-xs text-gray-500">No journal lines hit this account in the selected range.</div>
                ) : (
                  <div className="overflow-x-auto max-h-72 overflow-y-auto">
                    <table className="text-xs w-full">
                      <thead><tr className="text-gray-500"><th className="p-1.5 text-left">Date</th><th className="p-1.5 text-left">Source</th><th className="p-1.5 text-left">Reference</th><th className="p-1.5 text-left">Description</th><th className="p-1.5 text-right">Debit</th><th className="p-1.5 text-right">Credit</th><th className="p-1.5 text-center">Open</th></tr></thead>
                      <tbody>
                        {drillLines.map((l, i) => (
                          <tr key={`${l.entryId}-${i}`} className="border-t border-indigo-100">
                            <td className="p-1.5">{l.date}</td>
                            <td className="p-1.5"><span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-indigo-100 text-indigo-700">{l.source}</span></td>
                            <td className="p-1.5 text-gray-600">{l.reference}</td>
                            <td className="p-1.5 text-gray-600">{l.description || '—'}</td>
                            <td className="p-1.5 text-right font-mono">{l.debit ? `$ ${l.debit.toFixed(2)}` : ''}</td>
                            <td className="p-1.5 text-right font-mono">{l.credit ? `$ ${l.credit.toFixed(2)}` : ''}</td>
                            <td className="p-1.5 text-center">
                              {l.module ? (
                                <button onClick={() => openSourceModule(l.module)} title={`Open ${l.source} source document`}
                                  className="text-indigo-600 hover:text-indigo-800 font-semibold">↗ Open</button>
                              ) : <span className="text-gray-300">—</span>}
                            </td>
                          </tr>
                        ))}
                        <tr className="border-t-2 border-indigo-200 font-semibold">
                          <td className="p-1.5" colSpan={4}>Total ({drillLines.length} lines)</td>
                          <td className="p-1.5 text-right font-mono">$ {drillLines.reduce((s,l)=>s+l.debit,0).toFixed(2)}</td>
                          <td className="p-1.5 text-right font-mono">$ {drillLines.reduce((s,l)=>s+l.credit,0).toFixed(2)}</td>
                          <td className="p-1.5"></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="border rounded p-3">
            <div className="font-semibold mb-2">Profit &amp; Loss (USALI) — click any line to drill to its journal entries</div>
            {/* Revenue */}
            <div className="text-xs font-bold uppercase tracking-wide text-gray-500 mt-1 mb-0.5">Revenue</div>
            {plDetail.revenue.length === 0 ? (
              <div className="text-xs text-gray-400 pl-2">No revenue posted in range.</div>
            ) : plDetail.revenue.map(r => (
              <button key={r.id}
                onClick={() => setDrillAccount({ id: r.id, name: r.name })}
                className={`w-full flex justify-between items-center text-sm px-2 py-1 rounded hover:bg-indigo-50 ${drillAccount?.id === r.id ? 'bg-indigo-100' : ''}`}>
                <span className="text-left"><span className="font-mono text-xs text-gray-400 mr-1">{r.id}</span>{r.name}</span>
                <span className="font-mono font-medium">$ {r.amount.toFixed(2)}</span>
              </button>
            ))}
            <div className="flex justify-between text-sm font-semibold border-t mt-1 pt-1 px-2">
              <span>Total Revenue</span><span className="font-mono">$ {Number(pl.revenue || 0).toFixed(2)}</span>
            </div>
            {/* Expenses */}
            <div className="text-xs font-bold uppercase tracking-wide text-gray-500 mt-3 mb-0.5">Expenses</div>
            {plDetail.expense.length === 0 ? (
              <div className="text-xs text-gray-400 pl-2">No expenses posted in range.</div>
            ) : plDetail.expense.map(r => (
              <button key={r.id}
                onClick={() => setDrillAccount({ id: r.id, name: r.name })}
                className={`w-full flex justify-between items-center text-sm px-2 py-1 rounded hover:bg-rose-50 ${drillAccount?.id === r.id ? 'bg-rose-100' : ''}`}>
                <span className="text-left"><span className="font-mono text-xs text-gray-400 mr-1">{r.id}</span>{r.name}</span>
                <span className="font-mono font-medium">$ {r.amount.toFixed(2)}</span>
              </button>
            ))}
            <div className="flex justify-between text-sm font-semibold border-t mt-1 pt-1 px-2">
              <span>Total Expenses</span><span className="font-mono">$ {pl.expense.toFixed(2)}</span>
            </div>
            {/* Net */}
            <div className={`flex justify-between text-sm font-bold border-t-2 mt-2 pt-1 px-2 ${pl.netIncome >= 0 ? 'text-green-700' : 'text-red-700'}`}>
              <span>Net Income</span><span className="font-mono">$ {pl.netIncome.toFixed(2)}</span>
            </div>
          </div>
          <div className="border rounded p-3">
            <div className="font-semibold mb-1">Balance Sheet</div>
            <div className="text-sm">Assets: <span className="font-semibold">$ {bs.assets.toFixed(2)}</span></div>
            <div className="text-sm">Liabilities: <span className="font-semibold">$ {bs.liabilities.toFixed(2)}</span></div>
            <div className="text-sm">Equity: <span className="font-semibold">$ {bs.equity.toFixed(2)}</span></div>
          </div>
        </div>
      </div>

      {/* Manual Journal Entry */}
      <div className="p-4 border rounded">
        <div className="font-semibold mb-2">Manual Journal Entry</div>
        <ManualJECreator />
      </div>
    </div>
  );
};

const ManualJECreator: React.FC = () => {
  const [date, setDate] = useState(new Date().toISOString().slice(0,10));
  const [reference, setReference] = useState('Manual JE');
  const [lines, setLines] = useState<Array<{ accountId: string; debit: string; credit: string }>>([
    { accountId: '', debit: '', credit: '' },
    { accountId: '', debit: '', credit: '' }
  ]);
  const [message, setMessage] = useState<string>('');
  const addLine = () => setLines(prev => [...prev, { accountId: '', debit: '', credit: '' }]);
  const removeLine = (idx: number) => setLines(prev => prev.filter((_, i) => i !== idx));
  const sumDebit = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
  const sumCredit = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
  const balanced = Math.abs(sumDebit - sumCredit) < 0.005 && sumDebit > 0 && sumCredit > 0;
  const post = () => {
    try {
      const glLines = lines.map(l => ({ accountId: l.accountId, description: reference, debit: Number(l.debit || 0), credit: Number(l.credit || 0) }));
      if (!gl.isBalanced(glLines)) { setMessage('Entry not balanced.'); return; }
      // 'GLMAN_' prefix so the drill panel classifies it as a Manual entry (not Night Audit).
      const entry = { id: `GLMAN_${date}_${Date.now()}`, date, lines: glLines, reference };
      gl.appendLedger(entry);
      // Persist to the DB gl_journal_* tables so the manual entry appears in the
      // authoritative P&L / Trial Balance and survives a browser wipe.
      gl.persistJournalEntryToDB(entry, 'manual').catch((e: any) =>
        console.warn('[GLAccounting] manual JE DB persist failed (non-fatal):', e?.message));
      setMessage('Journal posted.');
    } catch (err) { setMessage('Failed to post.'); console.error(err); }
  };
  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-2">
        <div>
          <label className="text-xs">Date</label>
          <Input type="date" value={date} onChange={(e)=>setDate(e.target.value)} />
        </div>
        <div className="md:col-span-2">
          <label className="text-xs">Reference</label>
          <Input value={reference} onChange={(e)=>setReference(e.target.value)} />
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr><th className="p-2 text-left">Account ID</th><th className="p-2 text-right">Debit</th><th className="p-2 text-right">Credit</th><th className="p-2">Actions</th></tr></thead>
          <tbody>
            {lines.map((l, idx) => (
              <tr key={idx}>
                <td className="p-2"><Input placeholder="e.g. 1000" value={l.accountId} onChange={(e)=>setLines(prev => prev.map((x,i)=> i===idx ? { ...x, accountId: e.target.value } : x))} /></td>
                <td className="p-2 text-right"><Input type="number" value={l.debit} onChange={(e)=>setLines(prev => prev.map((x,i)=> i===idx ? { ...x, debit: e.target.value } : x))} /></td>
                <td className="p-2 text-right"><Input type="number" value={l.credit} onChange={(e)=>setLines(prev => prev.map((x,i)=> i===idx ? { ...x, credit: e.target.value } : x))} /></td>
                <td className="p-2"><Button variant="outline" onClick={()=>removeLine(idx)}>Remove</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 text-xs">Debit: <span className="font-semibold">$ {sumDebit.toFixed(2)}</span> · Credit: <span className="font-semibold">$ {sumCredit.toFixed(2)}</span> · {balanced ? <span className="text-green-700">Balanced</span> : <span className="text-red-700">Not Balanced</span>}</div>
      <div className="mt-2 flex items-center gap-2">
        <Button variant="outline" onClick={addLine}>Add Line</Button>
        <Button className="bg-indigo-600 text-white" disabled={!balanced} onClick={post}>Post Journal</Button>
        {message && <div className="text-xs ml-2">{message}</div>}
      </div>
    </div>
  );
};

export default GLAccounting;
