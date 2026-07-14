import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import gl from '@/lib/glAccounting';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';

interface JournalPostingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type LineEdit = { accountId: string; description: string; debit: string; credit: string };

const JournalPostingModal: React.FC<JournalPostingModalProps> = ({ open, onOpenChange }) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [date, setDate] = React.useState<string>(new Date().toISOString().slice(0,10));
  const [reference, setReference] = React.useState<string>('Daily Reconciliation');
  const [lines, setLines] = React.useState<LineEdit[]>([ { accountId: '', description: '', debit: '', credit: '' } ]);
  const [status, setStatus] = React.useState<string>('');

  const sumDebit = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
  const sumCredit = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
  const balanced = Math.abs(sumDebit - sumCredit) < 0.005 && sumDebit > 0 && sumCredit > 0;
  const accountIndex = React.useMemo(() => {
    try { const list = gl.getAccounts(); const idx: Record<string, string> = {}; list.forEach(a => { idx[a.id] = a.category as any; }); return idx; } catch { return {}; }
  }, []);
  const categoryTotals = React.useMemo(() => {
    const agg: Record<string, { debit: number; credit: number }> = {};
    lines.forEach(l => {
      const cat = accountIndex[l.accountId?.trim()] || 'Uncategorized';
      if (!agg[cat]) agg[cat] = { debit: 0, credit: 0 };
      agg[cat].debit += Number(l.debit || 0);
      agg[cat].credit += Number(l.credit || 0);
    });
    return agg;
  }, [lines, accountIndex]);

  const addLine = () => setLines(prev => [ ...prev, { accountId: '', description: '', debit: '', credit: '' } ]);
  const removeLine = (idx: number) => setLines(prev => prev.filter((_, i) => i !== idx));

  const validateAccounts = (): { ok: boolean; invalid?: string[] } => {
    try {
      const accounts = gl.getAccounts();
      const ids = new Set(accounts.map(a => a.id));
      const invalid = lines
        .map(l => l.accountId.trim())
        .filter(id => !id || !ids.has(id));
      return invalid.length ? { ok: false, invalid } : { ok: true };
    } catch {
      return { ok: false, invalid: ['<accounts unavailable>'] };
    }
  };

  const post = async () => {
    setStatus('');
    // Validation: balanced, valid accounts, positive numbers
    const glLines = lines.map(l => ({ accountId: l.accountId.trim(), description: l.description || reference, debit: Number(l.debit || 0), credit: Number(l.credit || 0) }));
    if (!gl.isBalanced(glLines)) { setStatus('Entry not balanced.'); return; }
    const acctCheck = validateAccounts();
    if (!acctCheck.ok) { setStatus(`Invalid accounts: ${acctCheck.invalid?.join(', ')}`); return; }
    const nonPositive = glLines.some(l => l.debit < 0 || l.credit < 0);
    if (nonPositive) { setStatus('Amounts must be non-negative.'); return; }

    try {
      const entry = { id: `GLMAN_${date}_${Date.now()}`, date, lines: glLines, reference, attachments: { reconciliationKey: 'corepms_reconciliation_last' } } as any;
      try { const shiftRaw = localStorage.getItem('corepms_activeShift'); const shift = shiftRaw ? JSON.parse(shiftRaw) : null; if (shift?.id) { entry.attachments = { ...(entry.attachments||{}), shiftId: shift.id }; } } catch {}
      try { const backupRaw = localStorage.getItem('corepms_backup_last'); const backup = backupRaw ? JSON.parse(backupRaw) : null; entry.attachments = { ...(entry.attachments||{}), businessDate: date, auditSnapshotKey: backup?.key, userId: user?.id, userName: user?.name }; } catch {}
      // 1. Fast local cache so the in-browser trial balance / P&L preview reflects it immediately.
      gl.appendLedger(entry);
      // 2. Persist to the DB so the authoritative reports (P&L, Trial Balance, Balance
      //    Sheet, Daily Journal) update in real time and across devices. Without this the
      //    entry lived only in this browser's localStorage and never reached the GL.
      const persisted = await gl.persistJournalEntryToDB(entry, 'manual');
      if (!persisted.ok) {
        setStatus(`Saved locally, but DB persist failed: ${persisted.error || 'unknown'}`);
        toast({ title: 'Posted locally only', description: persisted.error || 'Could not reach the GL server. Reports may not update until retried.', variant: 'destructive' });
        return;
      }
      toast({ title: 'Journal posted', description: `Date ${date} • Lines ${glLines.length} • Synced to GL` });
      setStatus('Posted and synced to the General Ledger.');
      onOpenChange(false);
    } catch (err) {
      console.error('Journal posting failed', err);
      setStatus('Failed to post.');
      toast({ title: 'Posting failed', description: 'Please review entries and try again.', variant: 'destructive' });
    }
  };

  const importFromNightAudit = async () => {
    try {
      const raw = localStorage.getItem('corepms_nightAudit_lastReports');
      const bundle = raw ? JSON.parse(raw) : {};
      const entry = await gl.createDailyJournalFromNightAudit(date, bundle);
      setReference(entry.reference || 'Daily Reconciliation');
      setLines(entry.lines.map(l => ({ accountId: l.accountId, description: l.description || reference, debit: String(Number(l.debit || 0)), credit: String(Number(l.credit || 0)) })));
      setStatus('Imported suggested lines from Night Audit. Please review and post.');
    } catch (err) {
      console.error('Import from Night Audit failed', err);
      setStatus('Failed to import from Night Audit.');
    }
  };

  const postFromNightAudit = async () => {
    try {
      const raw = localStorage.getItem('corepms_nightAudit_lastReports');
      const bundle = raw ? JSON.parse(raw) : {};
      const res = await gl.postDailyJournalFromNightAudit(date, bundle);
      if (!res.ok) {
        setStatus(res.error || 'Posting failed');
        toast({ title: 'Posting failed', description: res.error || 'Unknown error', variant: 'destructive' });
        return;
      }
      // Attach shift context if available
      try {
        const shiftRaw = localStorage.getItem('corepms_activeShift');
        const shift = shiftRaw ? JSON.parse(shiftRaw) : null;
        if (shift && res.entry) {
          gl.appendLedger({ ...res.entry, attachments: { ...(res.entry.attachments||{}), shiftId: shift.id, userId: user?.id, userName: user?.name } });
        }
      } catch {}
      toast({ title: 'Daily Journal posted', description: `Date ${date}` });
      onOpenChange(false);
    } catch (err) {
      console.error('Post from Night Audit failed', err);
      toast({ title: 'Posting failed', description: 'Please review Night Audit bundle.', variant: 'destructive' });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Daily Journal Posting</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <div>
              <Label htmlFor="je-date">Date</Label>
              <Input id="je-date" type="date" value={date} onChange={(e)=>setDate(e.target.value)} />
            </div>
            <div className="md:col-span-2">
              <Label htmlFor="je-ref">Reference</Label>
              <Input id="je-ref" value={reference} onChange={(e)=>setReference(e.target.value)} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={importFromNightAudit}>Import from Night Audit</Button>
            <Button className="bg-indigo-600 text-white" onClick={postFromNightAudit}>Post from Night Audit</Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><th className="p-2 text-left">Account Code</th><th className="p-2 text-left">Description</th><th className="p-2 text-right">Debit</th><th className="p-2 text-right">Credit</th><th className="p-2">Actions</th></tr></thead>
              <tbody>
                {lines.map((l, idx) => (
                  <tr key={idx}>
                    <td className="p-2"><Input aria-label={`Account code line ${idx+1}`} placeholder="e.g. 1000" value={l.accountId} onChange={(e)=>setLines(prev => prev.map((x,i)=> i===idx ? { ...x, accountId: e.target.value } : x))} /></td>
                    <td className="p-2"><Input aria-label={`Description line ${idx+1}`} placeholder="Description" value={l.description} onChange={(e)=>setLines(prev => prev.map((x,i)=> i===idx ? { ...x, description: e.target.value } : x))} /></td>
                    <td className="p-2 text-right"><Input aria-label={`Debit line ${idx+1}`} type="number" value={l.debit} onChange={(e)=>setLines(prev => prev.map((x,i)=> i===idx ? { ...x, debit: e.target.value } : x))} /></td>
                    <td className="p-2 text-right"><Input aria-label={`Credit line ${idx+1}`} type="number" value={l.credit} onChange={(e)=>setLines(prev => prev.map((x,i)=> i===idx ? { ...x, credit: e.target.value } : x))} /></td>
                    <td className="p-2"><Button variant="outline" onClick={()=>removeLine(idx)}>Remove</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-1 text-xs">Debit: <span className="font-semibold">$ {sumDebit.toFixed(2)}</span> · Credit: <span className="font-semibold">$ {sumCredit.toFixed(2)}</span> · {balanced ? <span className="text-green-700">Balanced</span> : <span className="text-red-700">Not Balanced</span>}</div>
          <div className="mt-2 p-2 border rounded">
            <div className="text-xs font-semibold mb-1">Category Preview</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
              {Object.entries(categoryTotals).map(([cat, t]) => (
                <div key={cat} className="flex justify-between"><span>{cat}</span><span>Debit: ${t.debit.toFixed(2)} · Credit: ${t.credit.toFixed(2)}</span></div>
              ))}
              {Object.keys(categoryTotals).length===0 && (<div className="text-gray-600">No lines yet</div>)}
            </div>
          </div>
          <div className="mt-2 p-2 border rounded">
            <div className="text-xs font-semibold mb-1">Trial Balance Impact (Selected Accounts)</div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr><th className="p-1 text-left">Account</th><th className="p-1 text-right">Base</th><th className="p-1 text-right">Delta</th><th className="p-1 text-right">New</th></tr></thead>
                <tbody>
                  {(() => {
                    try {
                      const tb = gl.getTrialBalance('0000-01-01','9999-12-31');
                      const byId: Record<string, { name: string; balance: number }> = {};
                      tb.forEach(a => { byId[a.accountId] = { name: a.name, balance: a.balance }; });
                      const usedIds = Array.from(new Set(lines.map(l => l.accountId.trim()).filter(Boolean)));
                      const rows = usedIds.map(id => {
                        const base = byId[id]?.balance || 0;
                        const delta = lines.filter(l => l.accountId.trim()===id).reduce((s, l)=> s + Number(l.debit||0) - Number(l.credit||0), 0);
                        const name = byId[id]?.name || id;
                        const next = Number((base + delta).toFixed(2));
                        return { id, name, base: Number(base.toFixed?.(2) ?? base), delta: Number(delta.toFixed(2)), next };
                      });
                      return rows.map(r => (
                        <tr key={r.id}><td className="p-1">{r.name} ({r.id})</td><td className="p-1 text-right">${r.base.toFixed(2)}</td><td className="p-1 text-right">${r.delta.toFixed(2)}</td><td className="p-1 text-right">${r.next.toFixed(2)}</td></tr>
                      ));
                    } catch { return <tr><td className="p-1" colSpan={4}>N/A</td></tr>; }
                  })()}
                </tbody>
              </table>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={addLine}>Add Line</Button>
            <Button className="bg-indigo-600 text-white" disabled={!balanced} onClick={post}>Post Journal</Button>
            {status && <div className="text-xs ml-2" role="status" aria-live="polite">{status}</div>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={()=> onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default JournalPostingModal;
