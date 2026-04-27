import React from 'react';
import { useAuth } from '@/context/AuthContext';
import { useData } from '@/context/DataContext';
import nightAuditService, { ValidationOptions } from '@/lib/nightAuditService';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/components/ui/use-toast';
import { AlertTriangle, CheckCircle, Info, AlertCircle } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const NightAudit: React.FC = () => {
  const { user } = useAuth();
  const { rooms, guests, folioCharges, addFolioCharge, refreshData } = useData();
  const { toast } = useToast();

  const [busy, setBusy] = React.useState(false);
  const [validationIssues, setValidationIssues] = React.useState<string[]>([]);
  const [validationWarnings, setValidationWarnings] = React.useState<string[]>([]);
  const [canForceOptions, setCanForceOptions] = React.useState<string[]>([]);
  const [lastRun, setLastRun] = React.useState<any | null>(null);
  const [lastReports, setLastReports] = React.useState<any | null>(null);
  const [currentRecon, setCurrentRecon] = React.useState<any | null>(null);
  
  // Auto-reconciliation options
  const [autoReconcile, setAutoReconcile] = React.useState(true);
  const [forceShiftClosure, setForceShiftClosure] = React.useState(false);
  const [skipBackupCheck, setSkipBackupCheck] = React.useState(false);
  const [tolerance, setTolerance] = React.useState<string>('5.00');

  const [corrGuestId, setCorrGuestId] = React.useState<string>('');
  const [corrDesc, setCorrDesc] = React.useState('Audit Correction');
  const [corrAmount, setCorrAmount] = React.useState<string>('0');
  
  // Force reconciliation state
  const [showForceDialog, setShowForceDialog] = React.useState(false);
  const [forceReason, setForceReason] = React.useState('');

  React.useEffect(() => {
    try {
      const rawRun = localStorage.getItem('corepms_nightAudit_lastRun');
      const rawReports = localStorage.getItem('corepms_nightAudit_lastReports');
      setLastRun(rawRun ? JSON.parse(rawRun) : null);
      setLastReports(rawReports ? JSON.parse(rawReports) : null);
    } catch {}
  }, []);

  const forceReconciliation = () => {
    setShowForceDialog(true);
  };

  const executeForceReconciliation = async () => {
    if (busy) return;
    
    setBusy(true);
    try {
      // Force all reconciliation options
      const forceOptions: ValidationOptions = {
        autoReconcile: true,
        forceShiftClosure: true,
        skipBackupCheck: true,
        forceReconciliation: true,
        autoReconcileTolerance: 1000 // High tolerance for force mode
      };
      
      const result = await nightAuditService.runNightAudit(
        { rooms, guests, folioCharges, userId: user?.id || 'unknown' },
        forceOptions
      );
      
      if (!result.ok) {
        toast({ 
          title: 'Force Reconciliation Failed', 
          description: (result as any).issues?.join(', ') || 'Unknown error occurred',
          variant: 'destructive' 
        });
        return;
      }
      
      setLastRun(result);
      setValidationIssues([]);
      setValidationWarnings([]);
      setCanForceOptions([]);
      setShowForceDialog(false);
      setForceReason('');
      
      toast({ 
        title: 'Force Reconciliation Complete', 
        description: 'Night audit completed with forced reconciliation. Check reports for details.',
        variant: 'destructive'
      });
      
      // Refresh data
      if (refreshData) {
        await refreshData();
      }
      
    } catch (err: any) {
      toast({ 
        title: 'Force Reconciliation Error', 
        description: String(err?.message || err),
        variant: 'destructive' 
      });
    } finally {
      setBusy(false);
    }
  };

  const prepare = () => {
    const options: ValidationOptions = {
      autoReconcile,
      forceShiftClosure,
      skipBackupCheck
    };
    const res = nightAuditService.prepareAndValidate({ rooms, guests, folioCharges, userId: user?.id || 'unknown' }, options);
    const recon = nightAuditService.reconcileTotals({ rooms, guests, folioCharges, userId: user?.id || 'unknown' });
    
    setValidationIssues(res.issues || []);
    setValidationWarnings(res.warnings || []);
    setCanForceOptions(res.canForce || []);
    setCurrentRecon(recon);
    
    if (res.ok) {
      toast({ title: 'Validation OK', description: 'All checks passed. Ready to run Night Audit.' });
    } else {
      toast({ title: 'Validation Issues', description: `${res.issues.length} issue(s) detected. Please resolve before running.` });
    }
    return res.ok;
  };

  const runAudit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const options: ValidationOptions = {
        autoReconcile,
        forceShiftClosure,
        skipBackupCheck,
        autoReconcileTolerance: Number(tolerance) || 0
      };
      
      // Run audit with auto-reconcile options
      const result = await nightAuditService.runNightAudit(
        { rooms, guests, folioCharges, userId: user?.id || 'unknown' },
        options
      );
      
      if (!result.ok) {
        setValidationIssues((result as any).issues || []);
        setValidationWarnings((result as any).warnings || []);
        setCanForceOptions((result as any).canForce || []);
        toast({ title: 'Night Audit Incomplete', description: 'Please resolve validation issues.' });
        setBusy(false);
        return;
      }
      
      setLastRun(result);
      setValidationIssues([]);
      setValidationWarnings((result as any).warnings || []);
      setCanForceOptions([]);
      
      const reports = nightAuditService.generateReportsBundle({ rooms, guests, folioCharges, userId: user?.id || 'unknown' });
      setLastReports(reports);
      
      // Refresh data to recalculate folio balances with new charges
      if (refreshData) {
        await refreshData();
      }
      
      // Show appropriate toast based on result
      const resultAny = result as any;
      if (resultAny.forced || resultAny.autoReconcile?.forced) {
        toast({ 
          title: 'Night Audit Complete (Forced)', 
          description: `Variances auto-reconciled. ${resultAny.autoReconcile?.journalEntries?.length || 0} journal entries created.`
        });
      } else {
        toast({ title: 'Night Audit Complete', description: 'Business date rolled; reports generated and folio balances updated.' });
      }
    } catch (err: any) {
      toast({ title: 'Night Audit Error', description: String(err?.message || err) });
    } finally {
      setBusy(false);
    }
  };

  const postCorrection = () => {
    const amt = Number(corrAmount);
    if (!corrGuestId || !corrDesc.trim() || isNaN(amt)) {
      toast({ title: 'Invalid correction', description: 'Choose guest, add description, and enter a number.' });
      return;
    }
    addFolioCharge({ guestId: corrGuestId, description: corrDesc, amount: amt, date: new Date().toISOString().slice(0,10), category: 'Adjustment' });
    toast({ title: 'Posted', description: 'Audit correction posted to folio.' });
    setCorrDesc('Audit Correction');
    setCorrAmount('0');
  };

  const todayISO = new Date().toISOString().slice(0,10);

  /** Safely parse a date string — returns null if the value is missing or invalid. */
  const safeISODate = (raw: any): string | null => {
    if (!raw) return null;
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  };

  const guestsNeedingReview = React.useMemo(() => {
    return guests.filter(g => {
      const hasBalance = Number(g.folioBalance || 0) > 0;
      const dueToday = safeISODate(g.checkOutDate) === todayISO;
      return hasBalance || dueToday;
    });
  }, [guests, todayISO]);

  return (
    <div className="p-6 space-y-6">
      <div className="sticky top-0 z-40 bg-white/90 backdrop-blur border-b shadow-sm px-6 -mx-6 py-3">
        <h2 className="text-2xl font-bold">Night Audit</h2>
        <p className="text-sm text-gray-600">End-of-day closing, reports, and audit tools</p>
      </div>

      {/* End-of-Day Processing */}
      <section className="bg-white rounded-xl shadow p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold">End-of-Day Processing</h3>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={prepare} disabled={busy}>Validate</Button>
            <Button onClick={runAudit} disabled={busy} className="bg-indigo-600 text-white">{busy ? 'Running…' : 'Run Night Audit'}</Button>
            {(validationIssues.length > 0 || canForceOptions.length > 0) && (
              <Button 
                onClick={forceReconciliation} 
                disabled={busy}
                variant="destructive"
                className="border-red-600 hover:bg-red-700 hover:border-red-700"
              >
                {busy ? 'Forcing…' : 'Force Reconciliation' }
              </Button>
            )}
          </div>
        </div>
        {validationIssues.length > 0 && (
          <div className="text-sm text-red-700 mt-3 bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="font-medium mb-2 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              Night Audit Blocked - Issues to Resolve:
            </div>
            {currentRecon && (
              <div className="mb-4 grid grid-cols-1 sm:grid-cols-3 gap-2 bg-white/40 p-3 rounded border border-red-100">
                <div className="text-center border-r border-red-100 last:border-0">
                  <div className="text-[10px] uppercase text-gray-500">Folio Total</div>
                  <div className="font-mono font-bold">${currentRecon.folioTotal.toFixed(2)}</div>
                </div>
                <div className="text-center border-r border-red-100 last:border-0">
                  <div className="text-[10px] uppercase text-gray-500">Shift Total</div>
                  <div className="font-mono font-bold">${currentRecon.shiftTotal.toFixed(2)}</div>
                </div>
                <div className="text-center">
                  <div className="text-[10px] uppercase text-gray-500">Postings</div>
                  <div className="font-mono font-bold">${currentRecon.postingsTodayTotal.toFixed(2)}</div>
                </div>
              </div>
            )}
            <ul className="list-disc pl-5 space-y-2 mb-3">
              {validationIssues.map((issue, idx) => (
                <li key={idx} className="flex items-start justify-between gap-2 group">
                  <div className="flex items-start gap-2">
                    <span className="inline-block mt-1">•</span>
                    <span>{issue}</span>
                  </div>
                  {issue.includes('Variance') && (
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="h-6 px-2 text-[10px] opacity-0 group-hover:opacity-100 transition-opacity bg-red-100 text-red-700 hover:bg-red-200"
                      onClick={() => {
                        const match = issue.match(/Variance \(([\d.]+)\)/);
                        if (match && match[1]) {
                          setTolerance(match[1]);
                          setAutoReconcile(true);
                          toast({ title: 'Fixed', description: `Tolerance set to ${match[1]}` });
                        }
                      }}
                    >
                      Fix Now
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            <div className="text-xs bg-white/50 p-2 rounded border">
              <div className="flex items-center justify-between mb-2">
                <strong>Quick Solutions:</strong>
                <Button 
                  size="sm" 
                  variant="destructive" 
                  className="h-7 px-3 text-[11px] font-bold shadow-lg"
                  onClick={() => {
                    setAutoReconcile(true);
                    setForceShiftClosure(true);
                    setSkipBackupCheck(true);
                    const match = validationIssues.find(i => i.includes('Variance'))?.match(/Variance \(([\d.]+)\)/);
                    if (match && match[1]) {
                      setTolerance(match[1]);
                    }
                    toast({ 
                      title: 'Overrides Applied', 
                      description: 'All safety checks bypassed. You can now run the audit.',
                      variant: 'default'
                    });
                    // Trigger a re-run immediately if possible
                    setTimeout(() => runAudit(), 500);
                  }}
                >
                  Resolve All & Run Audit
                </Button>
              </div>
              <div className="mt-2 space-y-2">
                {!autoReconcile && (
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="w-full justify-start text-xs h-8"
                    onClick={() => {
                      setAutoReconcile(true);
                      toast({ title: 'Setting Updated', description: 'Auto-reconcile variances enabled.' });
                    }}
                  >
                    <CheckCircle className="h-3 w-3 mr-2 text-green-600" />
                    Enable "Auto-reconcile variances" to bypass reconciliation issues
                  </Button>
                )}
                
                {validationIssues.some(i => i.includes('Variance')) && (
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="w-full justify-start text-xs h-8 border-amber-300 bg-amber-50"
                    onClick={() => {
                      const match = validationIssues.find(i => i.includes('Variance'))?.match(/Variance \(([\d.]+)\)/);
                      if (match && match[1]) {
                        setTolerance(match[1]);
                        setAutoReconcile(true);
                        toast({ title: 'Tolerance Updated', description: `Tolerance increased to ${match[1]} to match current variance.` });
                      }
                    }}
                  >
                    <AlertTriangle className="h-3 w-3 mr-2 text-amber-600" />
                    Adjust tolerance to match variance and auto-reconcile
                  </Button>
                )}

                {!forceShiftClosure && (
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="w-full justify-start text-xs h-8"
                    onClick={() => {
                      setForceShiftClosure(true);
                      toast({ title: 'Setting Updated', description: 'Force past active shift enabled.' });
                    }}
                  >
                    <CheckCircle className="h-3 w-3 mr-2 text-blue-600" />
                    Enable "Force past active shift" to bypass POS shift issues
                  </Button>
                )}

                {!skipBackupCheck && (
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="w-full justify-start text-xs h-8"
                    onClick={() => {
                      setSkipBackupCheck(true);
                      toast({ title: 'Setting Updated', description: 'Skip backup check enabled.' });
                    }}
                  >
                    <CheckCircle className="h-3 w-3 mr-2 text-purple-600" />
                    Enable "Skip backup check" to bypass backup requirements
                  </Button>
                )}
                
                <div className="text-[10px] text-gray-500 pt-1">
                  Or resolve issues manually in their respective modules.
                </div>
              </div>
            </div>
          </div>
        )}
        {validationWarnings.length > 0 && (
          <div className="text-sm text-amber-700 mt-3">
            <div className="font-medium mb-1 flex items-center gap-2">
              <Info className="h-4 w-4" />
              Warnings:
            </div>
            <ul className="list-disc pl-5 space-y-1">
              {validationWarnings.map((w, idx) => (<li key={idx}>{w}</li>))}
            </ul>
          </div>
        )}
        
        {/* Auto-reconciliation options */}
        <div className="mt-4 p-3 border rounded bg-gray-50">
          <div className="font-medium mb-2 text-sm">Automatic Reconciliation Options</div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox 
                id="autoReconcile" 
                checked={autoReconcile} 
                onCheckedChange={(checked) => setAutoReconcile(checked === true)} 
              />
              <label htmlFor="autoReconcile" className="text-sm cursor-pointer">
                Auto-reconcile variances (creates journal entries for discrepancies)
              </label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox 
                id="forceShiftClosure" 
                checked={forceShiftClosure} 
                onCheckedChange={(checked) => setForceShiftClosure(checked === true)} 
              />
              <label htmlFor="forceShiftClosure" className="text-sm cursor-pointer">
                Force past active shift (bypass shift closure check)
              </label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox 
                id="skipBackupCheck" 
                checked={skipBackupCheck} 
                onCheckedChange={(checked) => setSkipBackupCheck(checked === true)} 
              />
              <label htmlFor="skipBackupCheck" className="text-sm cursor-pointer">
                Skip backup check
              </label>
            </div>
          </div>
          <div className="text-xs text-gray-500 mt-2">
            When auto-reconcile is enabled, any variances between folio totals, shift totals, and postings will be automatically adjusted with journal entries.
          </div>
        </div>
        {lastRun && (
          <div className="mt-4">
            {lastRun.forced && (
              <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded text-sm">
                <div className="font-medium text-amber-800 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" />
                  Forced Reconciliation Applied
                </div>
                <div className="text-amber-700 mt-1">
                  {lastRun.autoReconcile?.journalEntries?.length || 0} journal entries created to reconcile variances.
                </div>
                {lastRun.autoReconcile?.affectedAccounts?.length > 0 && (
                  <div className="text-xs text-amber-600 mt-1">
                    Affected accounts: {lastRun.autoReconcile.affectedAccounts.map((a: any) => a.account).join(', ')}
                  </div>
                )}
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="p-3 border rounded">
              <div className="text-xs text-gray-500">Postings (rooms+tax)</div>
              <div className="text-xl font-semibold">{lastRun?.postings?.count ?? 0}</div>
            </div>
            <div className="p-3 border rounded">
              <div className="text-xs text-gray-500">City Ledger Transfers</div>
              <div className="text-xl font-semibold">{lastRun?.transfers?.count ?? 0}</div>
            </div>
            <div className="p-3 border rounded">
              <div className="text-xs text-gray-500">Business Date →</div>
              <div className="text-sm">{lastRun?.rollover?.previous} → <span className="font-semibold">{lastRun?.rollover?.next}</span></div>
            </div>
            {lastRun?.reconciliation && (
              <div className="p-3 border rounded">
                <div className="text-xs text-gray-500">Variance</div>
                <div className={`text-xl font-semibold ${lastRun.reconciliation.hasVariance ? 'text-amber-600' : 'text-green-600'}`}>
                  ${lastRun.reconciliation.totalVariance?.toFixed(2) || '0.00'}
                </div>
                {lastRun.reconciliation.hasVariance && (
                  <div className="text-xs text-amber-600">Auto-reconciled</div>
                )}
              </div>
            )}
            {lastRun.reconciliation.hasVariance && (
              <div className="mt-4 border rounded overflow-hidden">
                <div className="bg-gray-50 px-3 py-2 border-b text-sm font-medium">Reconciliation Details (Variances)</div>
                <div className="max-h-48 overflow-y-auto" tabIndex={0}>
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left">Variance Type</th>
                        <th className="px-3 py-2 text-right">Amount</th>
                        <th className="px-3 py-2 text-left">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {lastRun.reconciliation.varianceFolioVsShift !== 0 && (
                        <tr className="hover:bg-gray-50 cursor-pointer">
                          <td className="px-3 py-2">Folio vs Shift</td>
                          <td className="px-3 py-2 text-right text-red-600 font-mono">
                            ${lastRun.reconciliation.varianceFolioVsShift.toFixed(2)}
                          </td>
                          <td className="px-3 py-2 text-gray-500">
                            {lastRun.autoReconcile ? 'Auto-Corrected' : 'Pending'}
                          </td>
                        </tr>
                      )}
                      {lastRun.reconciliation.varianceFolioVsPostings !== 0 && (
                        <tr className="hover:bg-gray-50 cursor-pointer">
                          <td className="px-3 py-2">Folio vs Postings</td>
                          <td className="px-3 py-2 text-right text-red-600 font-mono">
                            ${lastRun.reconciliation.varianceFolioVsPostings.toFixed(2)}
                          </td>
                          <td className="px-3 py-2 text-gray-500">
                            {lastRun.autoReconcile ? 'Auto-Corrected' : 'Pending'}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
          </div>
        )}
      </section>

      {/* Audit Reports */}
      <section className="bg-white rounded-xl shadow p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold">Audit Reports</h3>
          <Button variant="outline" onClick={() => {
            const reports = nightAuditService.generateReportsBundle({ rooms, guests, folioCharges, userId: user?.id || 'unknown' });
            setLastReports(reports);
            toast({ title: 'Reports refreshed', description: 'Key metrics updated for today.' });
          }}>Refresh</Button>
        </div>
        {lastReports ? (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div className="p-3 border rounded"><div className="text-xs">Occupancy</div><div className="text-xl font-semibold">{lastReports.occupancy}%</div></div>
            <div className="p-3 border rounded"><div className="text-xs">Room Revenue</div><div className="text-xl font-semibold">${lastReports.roomRevenue}</div></div>
            <div className="p-3 border rounded"><div className="text-xs">F&B Revenue</div><div className="text-xl font-semibold">${lastReports.fbRevenue}</div></div>
            <div className="p-3 border rounded"><div className="text-xs">Total Revenue</div><div className="text-xl font-semibold">${lastReports.totalRevenue}</div></div>
            <div className="p-3 border rounded"><div className="text-xs">Avg Daily Rate</div><div className="text-xl font-semibold">${lastReports.avgDailyRate}</div></div>
            <div className="p-3 border rounded"><div className="text-xs">RevPAR</div><div className="text-xl font-semibold">${lastReports.revPAR}</div></div>
          </div>
        ) : (
          <div className="text-sm text-gray-600">No report data yet. Run Night Audit to generate.</div>
        )}
        <div className="text-xs text-gray-500 mt-3">For detailed reports like Trial Balance or Shift Readings, use the Accounting and Reports modules.</div>
      </section>

      {/* Posting and Adjustments (limited) */}
      <section className="bg-white rounded-xl shadow p-4">
        <h3 className="font-semibold mb-2">Posting and Adjustments</h3>
        <p className="text-xs text-gray-600 mb-3">Limited corrections for audit. Use Front Office → Folio Management for advanced operations.</p>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <div>
            <Label>Guest</Label>
            <select className="w-full border rounded px-2 py-1" value={corrGuestId} onChange={(e)=>setCorrGuestId(e.target.value)}>
              <option value="">Choose a guest…</option>
              {guests.map(g => (<option key={g.id} value={g.id}>{g.name} — Room {g.roomNumber || '—'}</option>))}
            </select>
          </div>
          <div>
            <Label>Description</Label>
            <Input value={corrDesc} onChange={(e)=>setCorrDesc(e.target.value)} placeholder="Audit Correction" />
          </div>
          <div>
            <Label>Amount</Label>
            <Input type="number" step="0.01" value={corrAmount} onChange={(e)=>setCorrAmount(e.target.value)} placeholder="0.00" />
            <div className="text-[11px] text-gray-500 mt-1">Use negative amount for reversals.</div>
          </div>
          <div>
            <Button onClick={postCorrection} className="bg-blue-600 text-white w-full">Post Correction</Button>
          </div>
        </div>
      </section>

      {/* Guest Status Check */}
      <section className="bg-white rounded-xl shadow p-4">
        <h3 className="font-semibold mb-2">Guest Status Check</h3>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left">
                <th className="py-2 pr-4">Guest</th>
                <th className="py-2 pr-4">Room</th>
                <th className="py-2 pr-4">Check-out</th>
                <th className="py-2 pr-4">Folio Balance</th>
              </tr>
            </thead>
            <tbody>
              {guestsNeedingReview.map(g => (
                <tr key={g.id} className="border-t">
                  <td className="py-2 pr-4">{g.name}</td>
                  <td className="py-2 pr-4">{g.roomNumber || '—'}</td>
                  <td className="py-2 pr-4">{safeISODate(g.checkOutDate) ?? '—'}</td>
                  <td className="py-2 pr-4">${Number(g.folioBalance || 0).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      
      {/* Force Reconciliation Confirmation Dialog */}
      <AlertDialog open={showForceDialog} onOpenChange={setShowForceDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-red-500" />
              Force Night Audit Reconciliation
            </AlertDialogTitle>
            <AlertDialogDescription>
              <div className="space-y-3">
                <p className="text-red-700 font-medium">
                  Warning: This will bypass all validation checks and force the night audit to complete.
                </p>
                <p>
                  This action will:
                </p>
                <ul className="list-disc pl-5 space-y-1 text-sm">
                  <li>Automatically end any active POS shifts</li>
                  <li>Skip backup requirement checks</li>
                  <li>Force reconciliation of all transaction variances</li>
                  <li>Create journal entries for any discrepancies</li>
                  <li>Proceed with business date rollover regardless of issues</li>
                </ul>
                <p className="pt-2 text-sm text-muted-foreground">
                  This should only be used when normal validation cannot be completed and
                  end-of-day processing is critical.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={executeForceReconciliation}
              className="bg-red-600 hover:bg-red-700"
              disabled={busy}
            >
              {busy ? 'Processing...' : 'Force Reconciliation'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default NightAudit;

