import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { Login } from './Login';
import { Sidebar } from './Sidebar';
import { Dashboard } from './modules/Dashboard';
import { FrontOffice } from './modules/FrontOffice';
import { Reservations } from './modules/Reservations';
import { Rooms } from './modules/Rooms';
import { CityLedger } from './modules/CityLedger';
import { Inventory } from './modules/Inventory';
import { Reports } from './modules/Reports';
import { Users } from './modules/Users';
import VersionControl from './modules/VersionControl';
import SystemSettings from './modules/SystemSettings';
import ErrorBoundary from './ErrorBoundary';
import LoadingSpinner from './ui/LoadingSpinner';
import { Button } from './ui/button';

// Lazy-load POSFrontOffice with a retry mechanism for chunk load failures (common after deployment)
const POSFrontOfficeLazy = React.lazy(() => {
  return new Promise((resolve, reject) => {
    import('./modules/POSFrontOffice')
      .then(m => resolve({ default: m.POSFrontOffice }))
      .catch(error => {
        // Detect if the error is a loading error (ChunkLoadError)
        const isChunkLoadError = error.message && (
          error.message.includes('error loading dynamically imported module') ||
          error.message.includes('Failed to fetch dynamically imported module')
        );
        if (isChunkLoadError) {
          console.warn('[corepms] Chunk load failed. Attempting to reload page to get latest version.');
          // Provide a small delay before reloading to prevent infinite reload loops
          setTimeout(() => window.location.reload(), 1500);
        }
        reject(error);
      });
  });
});
import { canManagePOS, canAccessPOS, canAccessInventoryManagement, canAccessReporting, canAccessTransactionClearing, isAdmin, canManageStaff, isManager, normalizeRole } from '@/lib/permissions';
import PosSettings from './modules/PosSettings';
import { HotkeysProvider, useHotkeys } from '@/contexts/HotkeysContext';
import APInvoiceEntry from './modules/APInvoiceEntry';
import AuthPortal from './modules/AuthPortal';
import { POSManagement } from './modules/POSManagement';
import ProfileSettings from './modules/ProfileSettings';
import TransactionClearingAdmin from './modules/TransactionClearingAdmin';
import SuperAdminSettings from './modules/SuperAdminSettings';
import Tasks from './modules/Tasks';
import ProfileAdmin from './modules/ProfileAdmin';
import PrinterConfiguration from './modules/PrinterConfiguration';
import AdminManagement from './modules/AdminManagement';
import RateManagement from './modules/RateManagement';
import { useToast } from '@/components/ui/use-toast';
import AccountingDom from './modules/AccountingDom';
import AccountingTaxConfiguration from './modules/AccountingTaxConfiguration';
import FOSetting from './modules/FOSetting';
import { useLocation, useNavigate } from 'react-router-dom';
import { logger } from '@/lib/logger';
import auth from '@/lib/authService';
import { shouldDenyPosSettings } from '../lib/posAccess';
import NightAudit from './modules/NightAudit';
import Maintenance from './modules/Maintenance';
import { DynamicBackgroundDiv } from './ui/DynamicBackgroundDiv';
import '@/styles/dynamic-background.css';
import { initializeDatabase } from '@/lib/databaseInitializer'
import VendorManagement from './modules/VendorManagement';
import BreakfastManager from './modules/BreakfastManager';
import OfflineIndicator from './OfflineIndicator';
import { InventoryReconciliation } from './modules/InventoryReconciliation';

const AppLayout: React.FC = () => {
  const { user } = useAuth();
  const [activeModule, setActiveModule] = useState('dashboard');
  const { toast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();

  const renderAccessDenied = (message: string, backModule: string, backLabel = 'Back') => (
    <div className="p-8">
      <div className="max-w-xl mx-auto bg-white shadow rounded-lg p-6 text-center">
        <h2 className="text-xl font-semibold mb-2">Access Denied</h2>
        <p className="text-sm text-gray-600 mb-4">{message}</p>
        <Button onClick={() => setActiveModule(backModule)}>{backLabel}</Button>
      </div>
    </div>
  );

  const ActiveModuleSync: React.FC<{ mod: string }> = ({ mod }) => {
    const hk = useHotkeys();
    React.useEffect(() => { hk.setActiveModule(mod); }, [hk, mod]);
    return null;
  };

  // If the app is opened via deep-link to a module while unauthenticated,
  // redirect to login and preserve the intended destination.
  const hasRedirectedRef = React.useRef(false);
  useEffect(() => {
    (async () => {
      try { await initializeDatabase() } catch { }
    })()
    try {
      const url = new URL(window.location.href);
      const requestedModule = url.searchParams.get('module');
      const isLoginRoute = location.pathname === '/login';
      const alreadyRedirecting = hasRedirectedRef.current || url.searchParams.has('redirect');
      if (!user && requestedModule && !isLoginRoute && !alreadyRedirecting) {
        hasRedirectedRef.current = true;
        logger.logAuth?.('redirect_to_login', { requestedModule });
        navigate(`/login?redirect=${encodeURIComponent(requestedModule)}`);
      }
    } catch (e) {
      if (!user && location.pathname !== '/login' && !hasRedirectedRef.current) {
        hasRedirectedRef.current = true;
        logger.logAuth?.('redirect_to_login_fallback');
        navigate('/login');
      }
    }
  }, [user, location.pathname, navigate]);

  React.useEffect(() => {
    const circuit: Record<string, number> = {}
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { key?: string; payload?: any }
      const k = String(detail?.key || 'unknown')
      const now = Date.now()
      const last = circuit[k] || 0
      if (now - last < 5000) return
      circuit[k] = now
      toast({ title: 'An error occurred', description: k })
    }
    window.addEventListener('corepms:error', handler as EventListener)
    return () => window.removeEventListener('corepms:error', handler as EventListener)
  }, [toast])

  // If a logged-in account must change password, force redirect and block module rendering
  useEffect(() => {
    if (user && user.passwordChangeRequired) {
      try {
        navigate('/password-change');
      } catch { }
    }
  }, [user?.passwordChangeRequired]);

  useEffect(() => {
    // Enforce login-first: do not auto-load modules until user is authenticated
    if (!user) {
      try { localStorage.removeItem('corepms_active_module'); } catch { }
      setActiveModule('dashboard');
      return;
    }

    // Initialize module from URL or localStorage for deep-linking AFTER auth
    try {
      const url = new URL(window.location.href);
      const fromUrl = url.searchParams.get('module');
      const persisted = localStorage.getItem('corepms_active_module');
      const initial = fromUrl || persisted;
      // Map deprecated modules to their new equivalents
      const resolved = initial === 'folios' ? 'frontoffice' : initial;
      if (resolved) {
        setActiveModule(resolved);
        try { localStorage.setItem('corepms_active_module', resolved); } catch { }
      }
      // If the URL requested the deprecated folios module, update it for clarity
      if (fromUrl === 'folios') {
        url.searchParams.set('module', 'frontoffice');
        window.history.replaceState({}, '', url.toString());
        const suppress = url.searchParams.get('noRedirectToast') === '1';
        if (!suppress) {
          toast({
            title: 'Redirected to Front Office',
            description: 'Folio Management is now part of Front Office.'
          });
        }
      }
    } catch { }
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { module?: string };
      const target = detail?.module === 'folios' ? 'frontoffice' : detail?.module;
      if (user && target) {
        setActiveModule(target);
        try { localStorage.setItem('corepms_active_module', target); } catch { }
      }
    };
    window.addEventListener('navigateToModule', handler as EventListener);
    return () => window.removeEventListener('navigateToModule', handler as EventListener);
  }, [user]);

  React.useEffect(() => {
    if (!(import.meta as any).env?.DEV) return;
    const onWheel = (e: WheelEvent) => {
      try { console.log('[ScrollDiag] wheel', { dy: e.deltaY, mode: e.deltaMode, ctrl: e.ctrlKey }); } catch { }
    };
    const onPointer = (e: PointerEvent) => {
      if (e.pointerType === 'touch') {
        try { console.log('[ScrollDiag] touch pointer', { type: e.type }); } catch { }
      }
    };
    window.addEventListener('wheel', onWheel, { passive: true });
    window.addEventListener('pointerdown', onPointer, { passive: true });
    window.addEventListener('pointermove', onPointer, { passive: true });
    return () => {
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('pointermove', onPointer);
    };
  }, []);

  // Initialize real-time data synchronization when user is authenticated
  const { startRealTimeSync, isRealTimeSyncActive } = useData();
  useEffect(() => {
    if (user && !isRealTimeSyncActive) {
      console.log('[AppLayout] Starting real-time sync service');
      startRealTimeSync();
    }
  }, [user, isRealTimeSyncActive, startRealTimeSync]);

  if (!user) {
    return (
      <div className="p-6">
        <Login />
        <div className="mt-6">
          <ErrorBoundary fallbackTitle="Auth Error" fallbackMessage="Authentication portal failed.">
            <AuthPortal />
          </ErrorBoundary>
        </div>
      </div>
    );
  }

  if (user?.passwordChangeRequired) {
    return (
      <div className="p-6">
        <div className="max-w-xl mx-auto bg-white shadow rounded-lg p-6 text-center">
          <h2 className="text-xl font-semibold mb-2">Action Required</h2>
          <p className="text-sm text-gray-600 mb-4">Please change your password to continue.</p>
          <Button onClick={() => navigate('/password-change')}>Go to Password Change</Button>
        </div>
      </div>
    );
  }

  const renderModule = () => {
    switch (activeModule) {
      case 'dashboard': return <Dashboard />;
      case 'frontoffice': return <FrontOffice />;
      case 'reservations': return <Reservations />;
      case 'rooms': return <Rooms />;
      case 'night-audit': {
        const role = normalizeRole(user?.role);
        const allowed = ['auditor', 'admin', 'manager', 'supervisor'].includes(role);
        return allowed
          ? (
            <ErrorBoundary fallbackTitle="Night Audit Error" fallbackMessage="Please reload or contact support.">
              <NightAudit />
            </ErrorBoundary>
          )
          : renderAccessDenied('You do not have permission to access Night Audit.', 'dashboard', 'Back to Dashboard');
      }
      case 'maintenance': {
        const role = normalizeRole(user?.role);
        const allowed = ['maintenance', 'housekeeping', 'admin', 'manager', 'supervisor'].includes(role);
        return allowed
          ? (
            <ErrorBoundary fallbackTitle="Maintenance Module Error" fallbackMessage="Please reload or contact support.">
              <Maintenance />
            </ErrorBoundary>
          )
          : renderAccessDenied('You do not have permission to access Maintenance.', 'dashboard', 'Back to Dashboard');
      }
      case 'fo-setting': {
        return (
          <ErrorBoundary fallbackTitle="FO Setting Error" fallbackMessage="Please reload or contact support.">
            <FOSetting />
          </ErrorBoundary>
        );
      }
      case 'accounting': {
        return (
          <ErrorBoundary fallbackTitle="Accounting Module Error" fallbackMessage="Please reload or contact support.">
            <AccountingDom />
          </ErrorBoundary>
        );
      }
      case 'accounting-tax': {
        const role = normalizeRole(user?.role);
        const allowed = ['admin', 'manager', 'auditor', 'supervisor'].includes(role);
        return allowed
          ? (
            <ErrorBoundary fallbackTitle="Tax Configuration Error" fallbackMessage="Please reload or contact support.">
              <AccountingTaxConfiguration />
            </ErrorBoundary>
          )
          : renderAccessDenied('You do not have permission to access Tax Configuration.', 'accounting', 'Back to Accounting');
      }
      case 'inventory-recon': {
        const role = normalizeRole(user?.role);
        const allowed = ['admin', 'manager', 'auditor', 'supervisor'].includes(role);
        return allowed
          ? (
            <ErrorBoundary fallbackTitle="Inventory Reconciliation Error" fallbackMessage="Please reload or contact support.">
              <InventoryReconciliation />
            </ErrorBoundary>
          )
          : renderAccessDenied('You do not have permission to access Inventory Reconciliation.', 'accounting', 'Back to Accounting');
      }
      case 'pos': return (
        canAccessPOS(user?.role)
          ? (
            <ErrorBoundary fallbackTitle="POS Module Error" fallbackMessage="Please reload or contact support.">
              <React.Suspense fallback={
                <div className="p-6">
                  <div className="flex items-center justify-center">
                    <LoadingSpinner label="Loading POS…" size="md" />
                  </div>
                </div>
              }>
                <POSFrontOfficeLazy />
              </React.Suspense>
            </ErrorBoundary>
          )
          : renderAccessDenied('You do not have permission to access POS.', 'dashboard', 'Back to Dashboard')
      );
      case 'pos-settings': {
        // Session validation and privilege checks
        const sess = auth.getSession?.();
        const prevPrivRaw = (() => { try { return localStorage.getItem('corepms_session_priv'); } catch { return null; } })();
        const prevPriv = (() => { try { return prevPrivRaw ? JSON.parse(prevPrivRaw) : null; } catch { return null; } })();
        const roleNow = normalizeRole(user?.role);
        const rolePrev = normalizeRole(prevPriv?.role);
        const deny = shouldDenyPosSettings(user, sess, prevPriv, canManagePOS);
        if (deny) {
          const roleNow = normalizeRole(user?.role);
          const rolePrev = normalizeRole(prevPriv?.role);
          const map: Record<string, { msg: string; back: string; label: string; event: string; ctx?: any }> = {
            session_invalid: { msg: 'Your session is invalid or expired. Please log in again to access POS Settings.', back: 'dashboard', label: 'Back to Dashboard', event: 'pos_settings_session_invalid' },
            privilege_reduced: { msg: 'Your privileges have been reduced. Re-authenticate with Manager/Admin credentials to access POS Settings.', back: 'dashboard', label: 'Back to Dashboard', event: 'pos_settings_privilege_reduced', ctx: { from: rolePrev, to: roleNow } },
            desktop_denied: { msg: 'Desktop access requires Manager/Admin privileges for POS Settings.', back: 'pos', label: 'Back to POS', event: 'pos_settings_desktop_denied', ctx: { role: roleNow } },
            denied: { msg: 'You do not have permission to access POS Settings.', back: 'pos', label: 'Back to POS', event: 'pos_settings_denied', ctx: { role: roleNow } },
          }
          const e = map[deny]
          logger.logSecurity?.(e.event, { userId: user?.id, ...(e.ctx || {}) })
          return renderAccessDenied(e.msg, e.back, e.label)
        }
        return (
          <ErrorBoundary fallbackTitle="POS Settings Error" fallbackMessage="Module failed to render due to configuration or permission issues. Use Copy Details to share diagnostics, then reload or re-login.">
            <PosSettings />
          </ErrorBoundary>
        );
      }
      case 'pos-management': {
        return (isManager(user?.role) || normalizeRole(user?.role) === 'posmanager')
          ? (
            <ErrorBoundary fallbackTitle="POS Management Error" fallbackMessage="Please reload or contact support.">
              <POSManagement />
            </ErrorBoundary>
          )
          : renderAccessDenied('You do not have permission to access POS Management.', 'dashboard', 'Back to Dashboard');
      }
      case 'cityledger': {
        return isManager(user?.role)
          ? <CityLedger />
          : renderAccessDenied('You do not have permission to access City Ledger.', 'dashboard', 'Back to Dashboard');
      }
      case 'inventory': {
        return canAccessInventoryManagement(user?.role)
          ? <Inventory />
          : renderAccessDenied('You do not have permission to access Inventory.', 'dashboard', 'Back to Dashboard');
      }
      case 'ap': {
        return isManager(user?.role)
          ? <APInvoiceEntry />
          : renderAccessDenied('You do not have permission to access AP Invoice Entry.', 'dashboard', 'Back to Dashboard');
      }
      case 'reports': {
        return canAccessReporting(user?.role)
          ? <Reports />
          : renderAccessDenied('You do not have permission to access Reports.', 'dashboard', 'Back to Dashboard');
      }
      case 'profile': return <ProfileSettings />;
      case 'profile-admin': {
        return canManageStaff(user?.role)
          ? <ProfileAdmin />
          : renderAccessDenied('You do not have permission to access Profile Admin.', 'dashboard', 'Back to Dashboard');
      }
      case 'tasks': return <Tasks />;
      case 'tx-clearing': {
        return canAccessTransactionClearing(user?.role)
          ? <TransactionClearingAdmin />
          : renderAccessDenied('You do not have permission to access Transaction Clearing.', 'dashboard', 'Back to Dashboard');
      }
      case 'superadmin-settings': {
        return isAdmin(user?.role)
          ? <SuperAdminSettings />
          : renderAccessDenied('You do not have permission to access Super Admin Settings.', 'dashboard', 'Back to Dashboard');
      }
      case 'admin-management': {
        if (!isAdmin(user?.role)) {
          return renderAccessDenied('You do not have permission to access Admin Management.', 'dashboard', 'Back to Dashboard');
        }
        return (
          <ErrorBoundary fallbackTitle="Admin Management Error" fallbackMessage="Please reload or contact support.">
            <AdminManagement />
          </ErrorBoundary>
        )
      }
      case 'users': {
        return canManageStaff(user?.role)
          ? <Users />
          : renderAccessDenied('You do not have permission to access Users.', 'dashboard', 'Back to Dashboard');
      }
      case 'settings': {
        return isAdmin(user?.role)
          ? (
            <ErrorBoundary fallbackTitle="System Settings Error" fallbackMessage="Please reload or contact support.">
              <SystemSettings />
            </ErrorBoundary>
          )
          : renderAccessDenied('You do not have permission to access System Settings.', 'dashboard', 'Back to Dashboard');
      }
      case 'versioncontrol': {
        return isAdmin(user?.role)
          ? <VersionControl />
          : renderAccessDenied('You do not have permission to access Version Control.', 'dashboard', 'Back to Dashboard');
      }
      case 'printer-config': {
        return isManager(user?.role)
          ? <PrinterConfiguration />
          : renderAccessDenied('You do not have permission to access Printer Configuration.', 'dashboard', 'Back to Dashboard');
      }
      case 'rate-management': {
        return isManager(user?.role)
          ? <RateManagement />
          : renderAccessDenied('You do not have permission to access Rate Management.', 'dashboard', 'Back to Dashboard');
      }
      case 'vendor-management': {
        return isManager(user?.role)
          ? (
            <ErrorBoundary fallbackTitle="Vendor Management Error" fallbackMessage="Please reload or contact support.">
              <VendorManagement />
            </ErrorBoundary>
          )
          : renderAccessDenied('You do not have permission to access Vendor Management.', 'accounting', 'Back to Accounting');
      }
      case 'breakfast-management': {
        return isManager(user?.role)
          ? (
            <ErrorBoundary fallbackTitle="Breakfast Management Error" fallbackMessage="Please reload or contact support.">
              <BreakfastManager />
            </ErrorBoundary>
          )
          : renderAccessDenied('You do not have permission to access Breakfast Management.', 'dashboard', 'Back to Dashboard');
      }
      case 'inventory-audit': {
        const role = normalizeRole(user?.role);
        const allowed = ['admin', 'manager', 'auditor', 'supervisor'].includes(role);
        return allowed
          ? (
            <ErrorBoundary fallbackTitle="Inventory Audit Error" fallbackMessage="Please reload or contact support.">
              <InventoryReconciliation />
            </ErrorBoundary>
          )
          : renderAccessDenied('You do not have permission to access Inventory Audit.', 'dashboard', 'Back to Dashboard');
      }
      default: return <Dashboard />;
    }
  };

  return (
    <HotkeysProvider>
      <ActiveModuleSync mod={activeModule} />
      <div className="flex flex-col md:flex-row h-screen bg-gray-100">
        <Sidebar activeModule={activeModule} setActiveModule={setActiveModule} />
        <div className="flex-1 min-w-0 min-h-0 overflow-y-auto overflow-x-hidden" style={{ touchAction: 'pan-y' }}>
          {/* Dynamic Background Div - Changes color based on selected menu item */}
          <div className="p-4">
            <DynamicBackgroundDiv
              activeModule={activeModule}
              settings={{
                enableTransitions: true,
                transitionDuration: 300,
                validateAccessibility: true,
                defaultColor: '#dddddd',
                minContrastRatio: 7.0,
                autoAdjustOptOutModules: []
              }}
              onClick={() => console.log(`Background for ${activeModule} module clicked`)}
              onHover={(isHovering) => console.log(`Background hover state: ${isHovering}`)}
              className="shadow-lg"
            />
          </div>

          {/* Module content */}
          {renderModule()}

          {/* Offline indicator for network status */}
          <OfflineIndicator />
        </div>
      </div>
    </HotkeysProvider>
  );
};

export default AppLayout;
