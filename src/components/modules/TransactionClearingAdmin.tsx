import React from 'react';
import BackToFOSettingsButton from '@/components/modules/common/BackToFOSettingsButton';
import { useAuth } from '@/context/AuthContext';
import { useData } from '@/context/DataContext';
import { canAccessTransactionClearing } from '@/lib/permissions';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import adminValidation from '@/lib/adminValidation';
import txSvc from '@/lib/transactionService';
import { logger } from '@/lib/logger';
import pmsAuthDb from '@/lib/pmsAuthDb';
import db from '@/lib/db';

const TransactionClearingAdmin: React.FC = () => {
  const { user } = useAuth();
  const { reservations, reconcileReservationsOnClearing } = useData();
  const [authCode, setAuthCode] = React.useState('');
  const [authError, setAuthError] = React.useState('');
  const [summary, setSummary] = React.useState<{ count: number; total: number; byMethod: Record<string, number> }>({ count: 0, total: 0, byMethod: { cash: 0, card: 0, 'room-charge': 0 } });
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [resultMsg, setResultMsg] = React.useState('');
  const [confirmErr, setConfirmErr] = React.useState('');

  const allowed = canAccessTransactionClearing(user?.role || '');

  const refreshSummary = async () => {
    try { const s = await txSvc.getTransactionSummary(); setSummary(s); } catch {}
  };
  React.useEffect(() => { refreshSummary(); }, []);

  const validateAndConfirm = async () => {
    setResultMsg(''); setAuthError(''); setBusy(true);
    try {
      let res = await adminValidation.validateSuperAdminCode(user?.id || 'unknown', authCode);
      if (!res.ok) {
        const msg = String(res.error || 'Authorization failed');
        if (/not configured/i.test(msg) && authCode && authCode.length >= 16) {
          try {
            await adminValidation.setSuperAdminCodeFor(user?.id || 'unknown', authCode);
            res = await adminValidation.validateSuperAdminCode(user?.id || 'unknown', authCode);
          } catch {}
        }
      }
      if (!res.ok) { setAuthError(res.error || 'Authorization failed'); setBusy(false); return; }
      setConfirmOpen(true);
    } catch (e) {
      setAuthError('Authorization service error');
    } finally { setBusy(false); }
  };

  const clearTransactions = async () => {
    setBusy(true); setResultMsg(''); setAuthError(''); setConfirmErr('');
    const startedAt = performance.now();
    logger.logAuth('clearing_attempt', { adminId: user?.id, count: summary.count, total: summary.total, requiresSecondApproval: false });
    try {
      const configured = await db.isConfigured();
      if (configured) {
        try { await pmsAuthDb.recordAccessAttempt(user?.username || 'admin', 'transaction_clearing_attempt', { count: summary.count, total: summary.total }) } catch {}
      }
      const before = { ...summary };
      const beforeReservationsToCheckOut = reservations.filter(r => {
        const co = new Date(r.checkOut);
        const coOk = !isNaN(co.getTime());
        const today = new Date().toISOString().slice(0,10);
        return r.status === 'checked-in' && coOk && co.toISOString().slice(0,10) <= today;
      }).length;
      const details = await txSvc.clearAllTransactions();
      const resDetails = await (reconcileReservationsOnClearing ? reconcileReservationsOnClearing() : Promise.resolve({ updated: 0, checkedOut: 0, awaitingPaymentVerification: 0, affectedIds: [] }));
      refreshSummary();
      const after = await txSvc.getTransactionSummary();
      const durationMs = Math.round(performance.now() - startedAt);
      const okIntegrity = before.count === details.removedCount && before.total === details.removedTotal && after.count === 0 && Number(after.total || 0) === 0;
      const okReservations = resDetails.checkedOut === beforeReservationsToCheckOut;
      if (!okIntegrity) {
        setConfirmErr('Integrity check failed after clearing. Please review logs.');
      }
      setResultMsg(`Cleared ${details.removedCount} transactions · Total $${details.removedTotal.toFixed(2)} · Shifts affected: ${details.affectedShifts.join(', ')} · Reservations checked-out: ${resDetails.checkedOut} · Awaiting payment verification: ${resDetails.awaitingPaymentVerification} (in ${durationMs}ms)`);
      logger.logAuth('clearing_success', {
        approvals: [ { adminId: user?.id, approvedAt: new Date().toISOString() } ],
        removedCount: details.removedCount,
        removedTotal: details.removedTotal,
        affectedShifts: details.affectedShifts,
        durationMs,
        integrityOk: okIntegrity,
        reservationsOk: okReservations,
        reservationsAffected: resDetails.affectedIds,
        reservationsAwaitingPaymentVerification: resDetails.awaitingPaymentVerification,
      });
      if (configured) {
        try {
          await pmsAuthDb.recordAccessAttempt(user?.username || 'admin', 'transaction_clearing_success', {
            removedCount: details.removedCount,
            removedTotal: details.removedTotal,
            affectedShifts: details.affectedShifts,
            durationMs,
            integrityOk: okIntegrity,
            reservationsOk: okReservations,
            reservationsAffected: resDetails.affectedIds,
            reservationsAwaitingPaymentVerification: resDetails.awaitingPaymentVerification,
          })
        } catch {}
      }
    } catch (e) {
      const msg = (e as any)?.message || 'Clearing failed. Please try again.'
      setAuthError(msg);
      logger.logAuth('clearing_failure', { adminId: user?.id, error: (e as any)?.message });
      try { await pmsAuthDb.recordAccessAttempt(user?.username || 'admin', 'transaction_clearing_failure', { error: msg }) } catch {}
    } finally {
      setBusy(false); setConfirmOpen(false);
    }
  };

  if (!allowed) {
    return (
      <div className="p-6">
        <div className="max-w-xl mx-auto bg-white shadow rounded-lg p-6 text-center">
          <h2 className="text-xl font-semibold mb-2">Access Denied</h2>
          <p className="text-sm text-gray-600">You do not have permission to access Transaction Clearing.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-4">
        <BackToFOSettingsButton />
        <h2 className="text-2xl font-bold">Transaction Clearing (Admin)</h2>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        <div className="bg-white p-4 rounded shadow">
          <div className="text-sm text-gray-600">Transactions</div>
          <div className="text-2xl font-bold">{summary.count}</div>
        </div>
        <div className="bg-white p-4 rounded shadow">
          <div className="text-sm text-gray-600">Total Amount</div>
          <div className="text-2xl font-bold">${summary.total.toFixed(2)}</div>
        </div>
        <div className="bg-white p-4 rounded shadow">
          <div className="text-sm text-gray-600">By Method</div>
          <div className="text-sm">Cash: ${Number(summary.byMethod.cash||0).toFixed(2)}</div>
          <div className="text-sm">Card: ${Number(summary.byMethod.card||0).toFixed(2)}</div>
          <div className="text-sm">Room: ${Number(summary.byMethod['room-charge']||0).toFixed(2)}</div>
        </div>
      </div>

      {resultMsg && (<div className="p-3 mb-3 rounded bg-green-50 text-green-700">{resultMsg}</div>)}
      {authError && (<div className="p-3 mb-3 rounded bg-red-50 text-red-700">{authError}</div>)}

      <div className="bg-white p-4 rounded shadow max-w-xl">
        <h3 className="text-lg font-semibold mb-2">Super Admin Authorization</h3>
        <label htmlFor="auth-code" className="text-sm">Authorization Code</label>
        <Input id="auth-code" type="password" value={authCode} onChange={(e)=> setAuthCode(e.target.value)} placeholder="Enter authorization code" />
        <div className="text-xs text-gray-500 mt-1">Minimum 16 characters; include letters, numbers, and special characters.</div>
        <div className="mt-3 flex items-center gap-2">
          <Button variant="outline" onClick={refreshSummary}>Refresh Summary</Button>
          <Button onClick={validateAndConfirm} disabled={busy || !authCode || authCode.length < 16} className="bg-red-600 text-white hover:bg-red-700 disabled:opacity-60">Proceed to Clear</Button>
        </div>
      </div>

      {confirmOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white w-full max-w-md rounded-xl shadow-xl p-6">
            <h4 className="text-lg font-semibold mb-2">Confirm Clearing</h4>
            <p className="text-sm text-gray-700 mb-4">You are about to permanently remove <strong>{summary.count}</strong> transactions totaling <strong>${summary.total.toFixed(2)}</strong>. This action cannot be undone.</p>
            {confirmErr && (<div className="p-2 mb-3 rounded bg-yellow-50 text-yellow-700 text-sm">{confirmErr}</div>)}
            <div className="flex items-center gap-2 justify-end">
              <Button variant="outline" onClick={()=> setConfirmOpen(false)}>Cancel</Button>
              <Button onClick={clearTransactions} className="bg-red-600 text-white hover:bg-red-700" disabled={busy}>{busy ? 'Clearing…' : 'Confirm Clear'}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TransactionClearingAdmin;
