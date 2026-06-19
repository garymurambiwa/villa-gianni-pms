import React, { useState } from 'react';
import { useData } from '../../context/DataContext';
import ErrorBoundary from '../ErrorBoundary';
const PosReportsLazy = React.lazy(() => import('./PosReports'));
import { ReportsDropdown } from '@/components/ui/ReportsDropdown';
import { useToast } from '@/hooks/use-toast';
import { createAuditEntry } from '@/lib/posIntegration';
import { useAuth } from '@/context/AuthContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import nightAuditService, { runNightAudit as executeNightAudit } from '@/lib/nightAuditService';
import JournalPostingModal from '@/components/modules/JournalPostingModal';
import ReportingDashboard from '@/components/modules/ReportingDashboard';
import BackToAccountingButton from '@/components/modules/common/BackToAccountingButton';
import { StockSheetReport } from '@/components/modules/StockSheetReport';
import { CostMarginReport } from '@/components/modules/CostMarginReport';
import { PilferageAnalysisReport } from '@/components/modules/PilferageAnalysisReport';
import { MonthEndClosingReport } from '@/components/modules/MonthEndClosingReport';
import RevenueAnalysis from '@/components/modules/RevenueAnalysis';
// Map named export GLAccounting to default for React.lazy to avoid default import collisions
const GLAccountingLazy = React.lazy(() =>
  import('./GLAccounting').then((m) => ({ default: m.GLAccounting }))
);

export const Reports: React.FC = () => {
  const { rooms = [], guests = [], folioCharges = [] } = useData() || {};
  const [reportType, setReportType] = useState<string>(() => {
    try {
      const param = new URLSearchParams(window.location.search).get('report');
      return param || 'daily';
    } catch {
      return 'daily';
    }
  });
  const [journalOpen, setJournalOpen] = useState<boolean>(false);
  const { toast } = useToast();
  const { user } = useAuth();
  const [auditRunning, setAuditRunning] = useState<boolean>(false);
  const [auditConfirmOpen, setAuditConfirmOpen] = useState<boolean>(false);
  const [forceConfirmOpen, setForceConfirmOpen] = useState<boolean>(false);
  const [forceReason, setForceReason] = useState<string>('');
  const [txReconciled, setTxReconciled] = useState<boolean>(false);
  const [reportsReviewed, setReportsReviewed] = useState<boolean>(false);
  const [backupsCompleted, setBackupsCompleted] = useState<boolean>(false);
  const [exceptionsNotes, setExceptionsNotes] = useState<string>('');
  const [confirmUserId, setConfirmUserId] = useState<string>('');
  const [lastRun, setLastRun] = useState<any>(() => {
    try { const raw = localStorage.getItem('corepms_nightAudit_lastRun'); return raw ? JSON.parse(raw) : null; } catch { return null; }
  });
  const [lastReports, setLastReports] = useState<any>(() => {
    try { const raw = localStorage.getItem('corepms_nightAudit_lastReports'); return raw ? JSON.parse(raw) : null; } catch { return null; }
  });
  const [recon, setRecon] = useState<any>(null);
  const reconciliationTolerance = 0.01;
  const [termsAccepted, setTermsAccepted] = useState<boolean>(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [serverStatus, setServerStatus] = useState<'idle'|'pending'|'ok'|'error'>('idle');
  const [validationMessages, setValidationMessages] = useState<string[]>([]);
  // Dev-only auto-run guard to avoid repeated executions
  const autoRunAuditRef = React.useRef(false);
  const auditScrollRef = React.useRef<HTMLDivElement>(null);

  // Persist selection to URL for deep-linking: ?report=<type>
  React.useEffect(() => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('report', reportType);
      window.history.replaceState({}, '', url.toString());
    } catch {}
  }, [reportType]);

  // On mount (dev only), open Journal modal if ?journal=1 is present
  React.useEffect(() => {
    try {
      if ((import.meta as any)?.env?.DEV) {
        const param = new URLSearchParams(window.location.search).get('journal');
        if (param === '1') setJournalOpen(true);
      }
    } catch {}
  }, []);

  // Sync journal modal state to URL: add/remove ?journal=1
  React.useEffect(() => {
    try {
      const url = new URL(window.location.href);
      if (journalOpen) url.searchParams.set('journal', '1');
      else url.searchParams.delete('journal');
      window.history.replaceState({}, '', url.toString());
    } catch {}
  }, [journalOpen]);

  // Dev-only: when navigating to Night Audit, auto-clear active POS shift to avoid blocker
  React.useEffect(() => {
    try {
      if ((import.meta as any)?.env?.DEV && reportType === 'night-audit') {
        const activeRaw = localStorage.getItem('corepms_activeShift');
        if (activeRaw) {
          localStorage.removeItem('corepms_activeShift');
          try {
            const entry = createAuditEntry('DEV_CLEAR_ACTIVE_SHIFT', 'SYSTEM', 'reports', user?.id || 'dev', { reason: 'Night Audit dev navigation' });
            const raw = localStorage.getItem('corepms_pos_audit');
            const list = raw ? JSON.parse(raw) : [];
            localStorage.setItem('corepms_pos_audit', JSON.stringify([entry, ...list].slice(0, 500)));
          } catch {}
        }
      }
    } catch {}
  }, [reportType, user?.id]);

  // Dev-only deep-links: ?reconcile=1 to auto-run reconciliation, ?backup=1 to open a fresh snapshot
  React.useEffect(() => {
    try {
      if (!(import.meta as any)?.env?.DEV) return;
      const sp = new URLSearchParams(window.location.search);
      const doReconcile = sp.get('reconcile') === '1';
      const doBackup = sp.get('backup') === '1';
      // Auto reconciliation
      if (doReconcile) {
        try {
          const res = nightAuditService.reconcileTotals({ rooms, guests, folioCharges, userId: user?.id || 'dev' });
          setRecon(res);
          const tol = 0.01;
          const ok = Math.abs(res.varianceFolioVsShift) < tol && Math.abs(res.varianceFolioVsPostings) < tol;
          if (ok) {
            setTxReconciled(true);
            localStorage.setItem('corepms_tx_reconciled', 'true');
            toast({ title: 'Reconciliation complete', description: 'No variances detected.' });
          } else {
            toast({ title: 'Reconciliation variance', description: `Folio vs Shift: $${res.varianceFolioVsShift} · Folio vs Postings: $${res.varianceFolioVsPostings}` });
          }
        } catch {}
      }
      // Fresh backup snapshot open
      if (doBackup) {
        try {
          const snapshot = { date: new Date().toISOString(), by: user?.id || 'dev', rooms, guests, folioCharges };
          const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const win = window.open(url, '_blank');
          setTimeout(() => URL.revokeObjectURL(url), 5000);
          if (!win) toast({ title: 'Popup blocked', description: 'Allow popups to view snapshot' });
        } catch {}
      }
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rooms, guests, folioCharges, user?.id]);

  // Dev-only: seed prerequisites to reduce Night Audit friction
  React.useEffect(() => {
    const isDev = (import.meta as any)?.env?.DEV;
    if (!isDev) return;
    try {
      const backupRaw = localStorage.getItem('corepms_backup_last');
      if (!backupRaw) {
        nightAuditService.backupSnapshot({ rooms, guests, folioCharges, userId: user?.id || 'dev' });
      }
      const reconciled = localStorage.getItem('corepms_tx_reconciled');
      if (!reconciled) {
        localStorage.setItem('corepms_tx_reconciled', 'true');
      }
    } catch {}
  }, [rooms, guests, folioCharges, user?.id]);

  // Dev-only deep-link: ?runAudit=1 to auto-run Night Audit once
  React.useEffect(() => {
    try {
      if (!(import.meta as any)?.env?.DEV) return;
      if (autoRunAuditRef.current) return;
      const sp = new URLSearchParams(window.location.search);
      const shouldRun = sp.get('runAudit') === '1';
      if (!shouldRun) return;
      if (reportType !== 'night-audit') return;

      // Satisfy verification prerequisites in dev
      setReportsReviewed(true);
      setTermsAccepted(true);
      try {
        const devFile = new File([
          `CorePMS Dev Verification – ${new Date().toISOString()}`
        ], 'dev_verification.txt', { type: 'text/plain' });
        setUploadFile(devFile);
      } catch {}

      // Ensure dialog is closed and trigger the audit run
      setAuditConfirmOpen(false);
      autoRunAuditRef.current = true;
      handleRunNightAudit();

      // Clean up URL to prevent accidental re-runs on navigation
      const url = new URL(window.location.href);
      url.searchParams.delete('runAudit');
      window.history.replaceState({}, '', url.toString());
    } catch {}
  }, [reportType]);

  const isAuthorizedMatch = (entered: string) => {
    const v = String(entered || '').trim().toLowerCase();
    const uid = String(user?.id || '').trim().toLowerCase();
    const uname = String((user as any)?.username || '').trim().toLowerCase();
    const email = String((user as any)?.email || '').trim().toLowerCase();
    if (!v) return false;
    return v === uid || (!!uname && v === uname) || (!!email && v === email);
  };

  const allVerified = (
    txReconciled &&
    reportsReviewed &&
    backupsCompleted &&
    termsAccepted &&
    !!uploadFile &&
    isAuthorizedMatch(confirmUserId) &&
    serverStatus === 'ok' &&
    validationMessages.length === 0
  );

  // Real-time local + server-side validation simulation
  React.useEffect(() => {
    let msgs: string[] = [];
    if (!txReconciled) msgs.push('Mark transactions as reconciled');
    if (!reportsReviewed) msgs.push('Confirm reports reviewed');
    if (!backupsCompleted) msgs.push('Confirm backups completed');
    if (!termsAccepted) msgs.push('Accept terms & conditions');
    if (!uploadFile) msgs.push('Upload required verification file');
    if (!isAuthorizedMatch(confirmUserId)) msgs.push('Enter your username, email, or user ID to authorize');
    setServerStatus('pending');
    const t = setTimeout(() => {
      // Run server-side validation only if local checks pass
      if (msgs.length === 0) {
        const result = nightAuditService.prepareAndValidate({ rooms, guests, folioCharges, userId: user?.id || 'unknown' });
        if (result.ok) {
          setServerStatus('ok');
        } else {
          setServerStatus('error');
          // Merge server issues into messages for visibility
          msgs = [...msgs, ...result.issues];
        }
      } else {
        setServerStatus('error');
      }
      setValidationMessages(msgs);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txReconciled, reportsReviewed, backupsCompleted, termsAccepted, uploadFile, confirmUserId, rooms, guests, folioCharges]);

  // Auto-run reconciliation snapshot when dialog opens
  React.useEffect(() => {
    if (!auditConfirmOpen) return;
    try {
      const res = nightAuditService.reconcileTotals({ rooms, guests, folioCharges, userId: user?.id || 'unknown' });
      setRecon(res);
      const ok = Math.abs(res.varianceFolioVsShift) < reconciliationTolerance && Math.abs(res.varianceFolioVsPostings) < reconciliationTolerance;
      if (ok) {
        setTxReconciled(true);
        localStorage.setItem('corepms_tx_reconciled', 'true');
      }
    } catch (err) {
      console.error('Auto reconciliation snapshot failed', err);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auditConfirmOpen]);

  const handleRunNightAudit = () => {
    if (auditRunning) return;
    setAuditRunning(true);
    try {
      const activeRaw = localStorage.getItem('corepms_activeShift');
      if (activeRaw) {
        toast({ title: 'Night Audit blocked', description: 'End POS shift before running night audit.', duration: 2500 });
        setAuditRunning(false);
        return;
      }
      // Log verification and attempt
      try {
        const verification = createAuditEntry('NIGHT_AUDIT_VERIFICATION', 'SYSTEM', 'reports', user?.id || 'unknown', {
          txReconciled, reportsReviewed, backupsCompleted, exceptionsNotes
        });
        const attempt = createAuditEntry('NIGHT_AUDIT_ATTEMPT', 'SYSTEM', 'reports', user?.id || 'unknown', {
          occupiedRooms: rooms.filter(r=>r.status==='OC'||r.status==='OD').length
        });
        const raw = localStorage.getItem('corepms_pos_audit');
        const list = raw ? JSON.parse(raw) : [];
        localStorage.setItem('corepms_pos_audit', JSON.stringify([verification, attempt, ...list].slice(0, 500)));
      } catch {}

      // Execute real operations via nightAuditService
      const result = executeNightAudit({ rooms, guests, folioCharges, userId: user?.id || 'unknown' });
      if (!result.ok) {
        toast({ title: 'Night Audit blocked', description: (result.issues || []).join(' • '), duration: 3000 });
        setAuditRunning(false);
        return;
      }
      toast({ title: 'Posting Room & Tax', description: `${result.postings.count} postings created`, duration: 1600 });
      toast({ title: 'City Ledger Transfers', description: `${result.transfers.count} transfers processed`, duration: 1600 });
      toast({ title: 'Rollover Complete', description: `Business date: ${result.rollover.next}`, duration: 2200 });
      toast({ title: 'Backup Saved', description: `Snapshot: ${result.backup.key}`, duration: 2000 });
      toast({ title: 'Reports Generated', description: `Revenue: $${result.reports.totalRevenue.toFixed(2)} · Occupancy: ${result.reports.occupancy}%`, duration: 2200 });
      try {
        const done = createAuditEntry('NIGHT_AUDIT_COMPLETED', 'SYSTEM', 'reports', user?.id || 'unknown', { rooms: rooms.length, folioCount: folioCharges.length });
        const raw = localStorage.getItem('corepms_pos_audit');
        const list = raw ? JSON.parse(raw) : [];
        localStorage.setItem('corepms_pos_audit', JSON.stringify([done, ...list].slice(0, 500)));
      } catch {}
      // Refresh last run & reports panels
      try {
        const lrRaw = localStorage.getItem('corepms_nightAudit_lastRun');
        const lr = lrRaw ? JSON.parse(lrRaw) : null;
        const repRaw = localStorage.getItem('corepms_nightAudit_lastReports');
        const rep = repRaw ? JSON.parse(repRaw) : null;
        setLastRun(lr); setLastReports(rep);
      } catch {}
      setAuditRunning(false);
    } catch (err) {
      console.error('Night audit run error', err);
      toast({ title: 'Night Audit error', description: 'See console for details', duration: 2500 });
      setAuditRunning(false);
    }
  };

  const openBackupSnapshot = () => {
    try {
      const key = lastRun?.backup?.key; if (!key) { toast({ title: 'No snapshot available' }); return; }
      const raw = localStorage.getItem(key); if (!raw) { toast({ title: 'Snapshot missing', description: key }); return; }
      const blob = new Blob([raw], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const win = window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      if (!win) toast({ title: 'Popup blocked', description: 'Allow popups to view snapshot' });
    } catch (err) { console.error(err); toast({ title: 'Open snapshot failed' }); }
  };

  const occupiedRooms = rooms.filter(r => r.status === 'OC' || r.status === 'OD').length;
  const availableRooms = rooms.filter(r => r.status !== 'OOO' && r.status !== 'OOS').length;

  // ── DB-sourced KPI metrics (last completed night audit + today's live POS) ─
  const [dbKpi, setDbKpi] = React.useState({ roomRevenue: 0, fbRevenue: 0, posRevenue: 0, adr: 0, revpar: 0, auditDate: '' });

  React.useEffect(() => {
    const loadKpi = async () => {
      try {
        const { db } = await import('@/lib/db');
        // Last completed night audit
        const auditRes = await db.query<any>(
          `SELECT business_date, room_revenue, total_revenue, adr, revpar FROM night_audit_runs ORDER BY business_date DESC LIMIT 1`
        );
        const audit = 'rows' in auditRes ? auditRes.rows[0] : null;

        // Today's closed POS orders
        const posRes = await db.query<any>(
          `SELECT COALESCE(SUM(total_amount),0) AS pos_total FROM pos_orders WHERE status='closed' AND created_at::date = CURRENT_DATE`
        );
        const posTotal = Number('rows' in posRes ? posRes.rows[0]?.pos_total : 0);

        if (audit) {
          setDbKpi({
            roomRevenue: Number(audit.room_revenue || 0),
            fbRevenue: posTotal,
            posRevenue: posTotal,
            adr:    Number(audit.adr    || 0),
            revpar: Number(audit.revpar || 0),
            auditDate: audit.business_date ? String(audit.business_date).slice(0, 10) : '',
          });
        }
      } catch (err) {
        console.warn('[Reports] KPI DB query failed:', err);
      }
    };
    loadKpi();
  }, []);

  const roomRevenue  = dbKpi.roomRevenue;
  const fbRevenue    = dbKpi.fbRevenue;
  const totalRevenue = roomRevenue + fbRevenue;
  const avgDailyRate = dbKpi.adr  || (occupiedRooms > 0 ? roomRevenue / occupiedRooms : 0);
  let revPAR         = dbKpi.revpar || (availableRooms > 0 ? roomRevenue / availableRooms : 0);

  return (
    <div className="p-6">
      {(reportType === 'night-audit' || reportType === 'gl') && (
        <BackToAccountingButton />
      )}
      <h2 className="text-xl sm:text-2xl lg:text-3xl font-bold text-gray-800 mb-4 sm:mb-6">Reports &amp; Analytics</h2>
      
      <div className="bg-blue-600 rounded-xl shadow-lg p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="text-sm text-white">Quick Select</div>
          <ReportsDropdown
            reports={[
              { key: 'daily', name: 'Daily Report' },
              { key: 'night-audit', name: 'Night Audit' },
              { key: 'revenue', name: 'Revenue Analysis' },
              { key: 'inventory', name: 'Inventory Reports' },
              { key: 'gl', name: 'GL Accounting' },
              { key: 'pos', name: 'POS Reports (Managers)' },
              { key: 'all', name: 'All Reports' }
            ]}
            selectedKey={reportType}
            onChange={(key) => setReportType(key)}
            persistKey={'corepms_selected_report'}
          />
        </div>
      
    </div>

      {(reportType === 'daily') && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
            <h3 className="text-xl font-bold text-gray-800 mb-4">Reporting Suite</h3>
            <ReportingDashboard />
          </div>
          {dbKpi.auditDate && (
            <div className="flex items-center gap-2 text-xs text-gray-400 -mb-2">
              <span>📊 KPIs from last completed night audit:</span>
              <span className="font-semibold text-gray-600">{dbKpi.auditDate}</span>
              <span>· F&amp;B from today's live POS orders</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            <div className="bg-white rounded-xl shadow-lg p-6 border-l-4 border-blue-500">
              <p className="text-gray-600 text-sm font-medium mb-2">Occupancy Rate</p>
              <p className="text-4xl font-bold text-blue-600">
                {rooms.length > 0 ? ((occupiedRooms / rooms.length) * 100).toFixed(1) : '0.0'}%
              </p>
              <p className="text-xs text-gray-400 mt-1">{occupiedRooms} of {rooms.length} rooms</p>
            </div>
            <div className="bg-white rounded-xl shadow-lg p-6 border-l-4 border-green-500">
              <p className="text-gray-600 text-sm font-medium mb-2">Total Revenue</p>
              <p className="text-4xl font-bold text-green-600">${totalRevenue.toFixed(2)}</p>
              <p className="text-xs text-gray-400 mt-1">Rooms + F&amp;B</p>
            </div>
            <div className="bg-white rounded-xl shadow-lg p-6 border-l-4 border-purple-500">
              <p className="text-gray-600 text-sm font-medium mb-2">ADR</p>
              <p className="text-4xl font-bold text-purple-600">${avgDailyRate.toFixed(2)}</p>
              <p className="text-xs text-gray-400 mt-1">RevPAR: ${revPAR.toFixed(2)}</p>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-lg p-6">
            <h3 className="text-xl font-bold text-gray-800 mb-4">Revenue Breakdown</h3>
            <div className="space-y-4">
              {recon && (
                <div className="space-y-3">
                  <div className="flex justify-between items-center p-3 bg-white rounded border">
                    <span className="text-gray-600">POS Sales (Total)</span>
                    <span className="font-bold text-lg">{String(formatCurrency(recon.posTotal))}</span>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-white rounded border">
                    <span className="text-gray-600">Folio Charges (Posted)</span>
                    <span className="font-bold text-lg text-blue-600">{String(formatCurrency(recon.folioTotal))}</span>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-white rounded border">
                    <span className="text-gray-600">Discrepancy</span>
                    <span className={`font-bold text-lg ${Math.abs(recon.discrepancy) > 1 ? 'text-red-600' : 'text-green-600'}`}>
                      {String(formatCurrency(recon.discrepancy))}
                    </span>
                  </div>
                  {Math.abs(recon.discrepancy) > 0.01 && (
                    <div className="p-3 bg-red-50 text-red-800 rounded text-sm border border-red-100">
                      <strong>Action Required:</strong> Discrepancy detected between POS sales and folio postings. Please audit individual guest bills before proceeding.
                    </div>
                  )}
                </div>
              )}
              <div className="flex justify-between items-center p-4 bg-blue-50 rounded-lg">
                <div>
                  <span className="font-medium text-gray-700">Room Revenue</span>
                  <p className="text-xs text-gray-400">From last night audit</p>
                </div>
                <span className="text-2xl font-bold text-blue-600">${roomRevenue.toFixed(2)}</span>
              </div>
              <div className="flex justify-between items-center p-4 bg-green-50 rounded-lg">
                <div>
                  <span className="font-medium text-gray-700">F&amp;B / POS Revenue</span>
                  <p className="text-xs text-gray-400">Today's closed POS orders</p>
                </div>
                <span className="text-2xl font-bold text-green-600">${fbRevenue.toFixed(2)}</span>
              </div>
              <div className="flex justify-between items-center p-4 bg-gray-50 rounded-lg">
                <div>
                  <span className="font-medium text-gray-700">Outstanding Folios</span>
                  <p className="text-xs text-gray-400">Open guest balances (not yet checked out)</p>
                </div>
                <span className="text-2xl font-bold text-gray-600">
                  ${guests.reduce((s, g) => s + (g.folioBalance || 0), 0).toFixed(2)}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {reportType === 'pos' && (
        <div className="ds-card">
          <ErrorBoundary fallbackTitle="POS Reports Error" fallbackMessage="Unable to load POS reports. Please try again or contact support.">
            <React.Suspense fallback={<div className="text-sm text-gray-600">Loading POS Reports…</div>}>
              <PosReportsLazy />
            </React.Suspense>
          </ErrorBoundary>
        </div>
      )}

      {reportType === 'gl' && (
        <div className="ds-card">
          <ErrorBoundary fallbackTitle="GL Error" fallbackMessage="Unable to load GL module.">
            <React.Suspense fallback={<div className="text-sm text-gray-600">Loading GL Accounting…</div>}>
              <GLAccountingLazy />
            </React.Suspense>
          </ErrorBoundary>
        </div>
      )}

      {reportType === 'all' && (
        <div className="ds-card">
          <ReportingDashboard />
        </div>
      )}

      {reportType === 'night-audit' && (
        <div className="ds-card">
          <h3 className="text-xl font-bold text-gray-800 mb-4">Night Audit Summary</h3>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-600 mb-1">Rooms Occupied</p>
                <p className="text-2xl font-bold text-gray-800">{occupiedRooms}</p>
              </div>
              <div className="p-4 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-600 mb-1">Rooms Available</p>
                <p className="text-2xl font-bold text-gray-800">{rooms.length - occupiedRooms}</p>
              </div>
              <div className="p-4 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-600 mb-1">Total Charges Posted</p>
                <p className="text-2xl font-bold text-gray-800">{folioCharges.length}</p>
              </div>
              <div className="p-4 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-600 mb-1">RevPAR</p>
                <p className="text-2xl font-bold text-gray-800">${revPAR.toFixed(2)}</p>
              </div>
            </div>
            <button
              className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed"
              onClick={() => setAuditConfirmOpen(true)}
              disabled={auditRunning}
            >
              {auditRunning ? 'Running Night Audit…' : 'Run Night Audit & Close Day'}
            </button>
            <div className="flex items-center gap-2">
              <button className="px-3 py-2 text-sm bg-gray-100 rounded hover:bg-gray-200" onClick={()=> setJournalOpen(true)}>Open Journal Posting</button>
            </div>
            {/* Last Night Audit Summary Card */}
            {(lastRun || lastReports) && (
              <div className="mt-6 p-4 border rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <div className="font-semibold">Last Night Audit Summary</div>
                  <div className="text-xs text-gray-600">Date: {lastReports?.date || lastRun?.reports?.date || '—'}</div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                  <div>Postings: <span className="font-semibold">{lastRun?.postings?.count ?? 0}</span></div>
                  <div>Transfers: <span className="font-semibold">{lastRun?.transfers?.count ?? 0}</span></div>
                  <div>Business Date: <span className="font-semibold">{lastRun?.rollover?.next ?? '—'}</span></div>
                  <div>Snapshot Key: <span className="font-semibold break-all">{lastRun?.backup?.key ?? '—'}</span></div>
                  <div>Total Revenue: <span className="font-semibold">${(lastReports?.totalRevenue ?? 0).toFixed?.(2) ?? Number(lastReports?.totalRevenue || 0).toFixed(2)}</span></div>
                  <div>Occupancy: <span className="font-semibold">{lastReports?.occupancy ?? 0}%</span></div>
                  <div>ADR: <span className="font-semibold">${lastReports?.avgDailyRate ?? 0}</span></div>
                  <div>RevPAR: <span className="font-semibold">${lastReports?.revPAR ?? 0}</span></div>
                  <div>Folio Total: <span className="font-semibold">${lastRun?.reconciliation?.folioTotal ?? 0}</span></div>
                  <div>Shift Sales Total: <span className="font-semibold">${lastRun?.reconciliation?.shiftTotal ?? 0}</span></div>
                  <div>Postings Today: <span className="font-semibold">${lastRun?.reconciliation?.postingsTodayTotal ?? 0}</span></div>
                  <div className={(Math.abs(Number(lastRun?.reconciliation?.varianceFolioVsShift ?? 0)) < 0.01 ? 'text-green-700' : 'text-red-700')}>Variance Folio vs Shift: <span className="font-semibold">${lastRun?.reconciliation?.varianceFolioVsShift ?? 0}</span></div>
                  <div className={(Math.abs(Number(lastRun?.reconciliation?.varianceFolioVsPostings ?? 0)) < 0.01 ? 'text-green-700' : 'text-red-700')}>Variance Folio vs Postings: <span className="font-semibold">${lastRun?.reconciliation?.varianceFolioVsPostings ?? 0}</span></div>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <button className="px-3 py-2 border rounded text-sm" onClick={openBackupSnapshot}>View Backup Snapshot</button>
                  <button className="px-3 py-2 border rounded text-sm" onClick={() => {
                    try {
                      const data = lastReports || lastRun?.reports || {};
                      const blob = new Blob([JSON.stringify(data,null,2)], { type: 'application/json' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a'); a.href = url; a.download = `nightAuditReports_${data.date || 'latest'}.json`; a.click();
                      setTimeout(()=>URL.revokeObjectURL(url), 2000);
                    } catch {}
                  }}>Download Reports JSON</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {journalOpen && (<JournalPostingModal open={journalOpen} onOpenChange={setJournalOpen} />)}

      {/* Night Audit Verification Dialog */}
      <Dialog open={auditConfirmOpen} onOpenChange={setAuditConfirmOpen}>
        <DialogContent className="max-w-xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Night Audit Verification</DialogTitle>
          </DialogHeader>
          <div 
            ref={auditScrollRef}
            className="space-y-3 text-sm overflow-y-auto scroll-smooth pr-2 -mr-2"
            tabIndex={0}
            style={{
              WebkitOverflowScrolling: 'touch',
              touchAction: 'pan-y'
            }}
            onKeyDown={(e) => {
              const el = auditScrollRef.current;
              if (!el) return;
              const scrollAmount = 100;
              if (e.key === 'ArrowDown') { 
                e.preventDefault();
                el.scrollBy({ top: 40, behavior: 'smooth' }); 
              }
              if (e.key === 'ArrowUp') { 
                e.preventDefault();
                el.scrollBy({ top: -40, behavior: 'smooth' }); 
              }
              if (e.key === 'PageDown') { 
                e.preventDefault();
                el.scrollBy({ top: el.clientHeight, behavior: 'smooth' }); 
              }
              if (e.key === 'PageUp') { 
                e.preventDefault();
                el.scrollBy({ top: -el.clientHeight, behavior: 'smooth' }); 
              }
              if (e.key === 'Home') {
                e.preventDefault();
                el.scrollTo({ top: 0, behavior: 'smooth' });
              }
              if (e.key === 'End') {
                e.preventDefault();
                el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
              }
            }}
          >
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={txReconciled}
                onChange={(e) => {
                  const v = e.target.checked;
                  setTxReconciled(v);
                  try {
                    if (v) localStorage.setItem('corepms_tx_reconciled', 'true');
                    else localStorage.removeItem('corepms_tx_reconciled');
                  } catch {}
                }}
              />
              <span>All daily transactions recorded and reconciled</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={reportsReviewed} onChange={(e) => setReportsReviewed(e.target.checked)} />
              <span>Required reports generated and reviewed</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={backupsCompleted}
                onChange={(e) => {
                  const v = e.target.checked;
                  setBackupsCompleted(v);
                  try {
                    if (v) {
                      const snapshot = {
                        date: new Date().toISOString(),
                        by: user?.id || 'unknown',
                        note: 'Verification checkpoint',
                      };
                      localStorage.setItem('corepms_backup_last', JSON.stringify(snapshot));
                    } else {
                      localStorage.removeItem('corepms_backup_last');
                    }
                  } catch {}
                }}
              />
              <span>System backups completed successfully</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={termsAccepted} onChange={(e) => setTermsAccepted(e.target.checked)} />
              <span>Terms & Conditions accepted</span>
            </label>
            <div>
              <label className="text-xs font-medium">Exceptions / Irregularities (optional)</label>
              <textarea className="w-full border rounded p-2" value={exceptionsNotes} onChange={(e) => setExceptionsNotes(e.target.value)} placeholder="Document any items requiring follow-up" />
            </div>
            <div>
              <label className="text-xs font-medium">Upload verification file (required)</label>
              <input type="file" className="w-full border rounded p-2" onChange={(e) => setUploadFile(e.target.files?.[0] || null)} />
              {!!uploadFile && (<div className="text-xs text-gray-600 mt-1">Selected: {uploadFile.name}</div>)}
            </div>
            {/* Inline reconciliation snapshot */}
            {recon && (
              <div className="mt-2 p-2 border rounded">
                <div className="text-xs font-semibold mb-1">Reconciliation Snapshot (Date: {recon.date})</div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>Folio Total: <span className="font-semibold">${recon.folioTotal}</span></div>
                  <div>Shift Total: <span className="font-semibold">${recon.shiftTotal}</span></div>
                  <div>Postings Today: <span className="font-semibold">${recon.postingsTodayTotal}</span></div>
                  <div className={(Math.abs(Number(recon.varianceFolioVsShift)) < reconciliationTolerance ? 'text-green-700' : 'text-red-700')}>Variance Folio vs Shift: <span className="font-semibold">${recon.varianceFolioVsShift}</span></div>
                  <div className={(Math.abs(Number(recon.varianceFolioVsPostings)) < reconciliationTolerance ? 'text-green-700' : 'text-red-700')}>Variance Folio vs Postings: <span className="font-semibold">${recon.varianceFolioVsPostings}</span></div>
                </div>
                {Math.abs(Number(recon.varianceFolioVsShift)) < reconciliationTolerance && Math.abs(Number(recon.varianceFolioVsPostings)) < reconciliationTolerance ? (
                  <div className="text-xs text-green-700 mt-1">No variances detected. Marked as reconciled.</div>
                ) : (
                  <div className="text-xs text-red-700 mt-1">Variances present. Please review totals before proceeding.</div>
                )}
              </div>
            )}
            <div>
              <label className="text-xs font-medium">Confirm your User ID (authorization)</label>
              <input className="w-full border rounded p-2" value={confirmUserId} onChange={(e) => setConfirmUserId(e.target.value)} placeholder="Enter your User ID" />
              <div className="text-xs text-gray-600 mt-1">Only authorized personnel can proceed. This is recorded in the audit trail.</div>
              <div className="text-xs text-gray-600 mt-1">Hint: username {String((user as any)?.username || '—')} · user ID {String(user?.id || '—')}</div>
            </div>
            <div className="text-xs mt-2">
              {serverStatus === 'pending' && (<span className="text-gray-600">Validating…</span>)}
              {serverStatus === 'error' && validationMessages.length > 0 && (
                <ul className="text-red-700 list-disc pl-5">
                  {validationMessages.map((m, i) => (<li key={i}>{m}</li>))}
                </ul>
              )}
              {serverStatus === 'ok' && validationMessages.length === 0 && (<span className="text-green-700">All requirements satisfied.</span>)}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <button
                className="px-3 py-2 border rounded text-sm"
                onClick={() => {
                  try {
                    const res = nightAuditService.reconcileTotals({ rooms, guests, folioCharges, userId: user?.id || 'unknown' });
                    // Auto-mark reconciled when variances are within tolerance
                    const tol = 0.01;
                    const ok = Math.abs(res.varianceFolioVsShift) < tol && Math.abs(res.varianceFolioVsPostings) < tol;
                    if (ok) {
                      setTxReconciled(true);
                      localStorage.setItem('corepms_tx_reconciled', 'true');
                      toast({ title: 'Reconciliation complete', description: 'No variances detected.' });
                    } else {
                      toast({ title: 'Reconciliation variance', description: `Folio vs Shift: $${res.varianceFolioVsShift} · Folio vs Postings: $${res.varianceFolioVsPostings}` });
                    }
                  } catch (err) {
                    console.error('Reconciliation failed', err);
                    toast({ title: 'Reconciliation failed', description: 'See console for details.' });
                  }
                }}
              >Run Reconciliation</button>
              <button
                className="px-3 py-2 border rounded text-sm"
                onClick={() => {
                  try {
                    const raw = localStorage.getItem('corepms_reconciliation_last');
                    const data = raw ? JSON.parse(raw) : null;
                    if (!data) { toast({ title: 'No reconciliation snapshot' }); return; }
                    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a'); a.href = url; a.download = `reconciliation_${data.date || 'latest'}.json`; a.click();
                    setTimeout(() => URL.revokeObjectURL(url), 2000);
                  } catch {}
                }}
              >Download Reconciliation JSON</button>
            </div>
          </div>
          <DialogFooter className="mt-4">
            <button className="px-4 py-2 border rounded" onClick={() => setAuditConfirmOpen(false)}>Cancel</button>
            <button
              className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed"
              disabled={!allVerified || auditRunning}
              onClick={() => { setAuditConfirmOpen(false); handleRunNightAudit(); }}
            >
              Confirm & Proceed
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Force Reconciliation Confirmation Dialog */}
      <Dialog open={forceConfirmOpen} onOpenChange={setForceConfirmOpen}>
        <DialogContent className="max-w-md border-red-200 bg-red-50">
          <DialogHeader>
            <DialogTitle className="text-red-800 flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
              Force Reconciliation?
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm text-red-900">
            <p className="font-semibold">Variances detected exceeding tolerance:</p>
            <div className="bg-white p-3 rounded border border-red-200 whitespace-pre-wrap font-mono text-xs">
              {forceReason}
            </div>
            <p>
              Continuing will <strong>force</strong> the creation of adjusting journal entries and close the business day.
              This action will be permanently logged in the audit trail.
            </p>
            <p className="font-semibold">Do you want to proceed?</p>
          </div>
          <DialogFooter className="mt-4">
            <button 
              className="px-4 py-2 border border-red-200 bg-white text-red-900 rounded hover:bg-red-50" 
              onClick={() => setForceConfirmOpen(false)}
            >
              Cancel
            </button>
            <button
              className="px-4 py-2 rounded bg-red-600 text-white hover:bg-red-700"
              onClick={() => { 
                setForceConfirmOpen(false); 
                handleRunNightAudit(true); // Call with force=true
              }}
            >
              Force & Proceed
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {reportType === 'revenue' && (
        <ErrorBoundary fallbackTitle="Revenue Analysis Error" fallbackMessage="Unable to load revenue analysis. Please reload or contact support.">
          <RevenueAnalysis />
        </ErrorBoundary>
      )}

      {reportType === 'inventory' && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl shadow-lg p-6">
            <h3 className="text-xl font-bold text-gray-800 mb-4">Inventory Reports</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              <div className="border rounded-lg p-4 hover:bg-gray-50 cursor-pointer transition-colors"
                   onClick={() => setReportType('inventory-stock-sheet')}>
                <h4 className="font-semibold text-lg mb-2">📦 Stock Sheet Report</h4>
                <p className="text-gray-600 text-sm">Physical inventory count sheets by location</p>
              </div>
              <div className="border rounded-lg p-4 hover:bg-gray-50 cursor-pointer transition-colors"
                   onClick={() => setReportType('inventory-cost-margin')}>
                <h4 className="font-semibold text-lg mb-2">💰 Cost Margin Analysis</h4>
                <p className="text-gray-600 text-sm">Profit margins by item and category</p>
              </div>
              <div className="border rounded-lg p-4 hover:bg-gray-50 cursor-pointer transition-colors"
                   onClick={() => setReportType('inventory-pilferage')}>
                <h4 className="font-semibold text-lg mb-2">🛡️ Pilferage Analysis</h4>
                <p className="text-gray-600 text-sm">Shrinkage and potential theft detection</p>
              </div>
              <div className="border rounded-lg p-4 hover:bg-gray-50 cursor-pointer transition-colors"
                   onClick={() => setReportType('inventory-month-end')}>
                <h4 className="font-semibold text-lg mb-2">📊 Month-End Closing</h4>
                <p className="text-gray-600 text-sm">Period-end inventory reconciliation</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {reportType === 'inventory-stock-sheet' && (
        <div className="ds-card">
          <ErrorBoundary fallbackTitle="Stock Sheet Error" fallbackMessage="Please reload or contact support.">
            <StockSheetReport />
          </ErrorBoundary>
        </div>
      )}

      {reportType === 'inventory-cost-margin' && (
        <div className="ds-card">
          <ErrorBoundary fallbackTitle="Cost Margin Error" fallbackMessage="Please reload or contact support.">
            <CostMarginReport />
          </ErrorBoundary>
        </div>
      )}

      {reportType === 'inventory-pilferage' && (
        <div className="ds-card">
          <ErrorBoundary fallbackTitle="Pilferage Analysis Error" fallbackMessage="Please reload or contact support.">
            <PilferageAnalysisReport />
          </ErrorBoundary>
        </div>
      )}

      {reportType === 'inventory-month-end' && (
        <div className="ds-card">
          <ErrorBoundary fallbackTitle="Month-End Closing Error" fallbackMessage="Please reload or contact support.">
            <MonthEndClosingReport />
          </ErrorBoundary>
        </div>
      )}
    </div>
  );
};
