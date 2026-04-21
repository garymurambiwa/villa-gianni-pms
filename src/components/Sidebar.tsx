import React from 'react';
import { Button } from '@/components/ui/button';
import { useHotkeys } from '@/contexts/HotkeysContext';
import { useAuth } from '../context/AuthContext';
import { canManagePOS } from '@/lib/permissions';
import HotkeysSettings from '@/components/modules/HotkeysSettings';
import BrandHeader from '@/components/ui/BrandHeader';
import OfflineIndicator from './OfflineIndicator';

interface SidebarProps {
  activeModule: string;
  setActiveModule: (module: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeModule, setActiveModule }) => {
  const { user, logout } = useAuth();
  const [hotkeysOpen, setHotkeysOpen] = React.useState(false);
  const { register: registerHotkey } = useHotkeys();
  const [isFullscreen, setIsFullscreen] = React.useState<boolean>(false);
  const [isFsTransitioning, setIsFsTransitioning] = React.useState<boolean>(false);

  React.useEffect(() => {
    let mounted = true;
    const nativeWin = (window as any).native?.window;

    // Detect current fullscreen via native or browser Fullscreen API
    const detectFullscreen = () => {
      try {
        if (nativeWin?.getFullscreen) {
          nativeWin.getFullscreen().then((fs: boolean) => {
            if (mounted) {
              setIsFullscreen(!!fs);
              console.log('[FullscreenDetection] Native API detected fullscreen state:', !!fs);
            }
          }).catch(err => {
            console.warn('[FullscreenDetection] Native API failed:', err);
            // Fallback to document API
            const isDocFs = !!(document.fullscreenElement || (document as any).webkitFullscreenElement || (document as any).msFullscreenElement);
            if (mounted) {
              setIsFullscreen(isDocFs);
              console.log('[FullscreenDetection] Document API detected fullscreen state:', isDocFs);
            }
          });
          return;
        }
      } catch (err) {
        console.warn('[FullscreenDetection] Native API access failed:', err);
      }

      // Fallback to document API
      const isDocFs = !!(document.fullscreenElement || (document as any).webkitFullscreenElement || (document as any).msFullscreenElement);
      if (mounted) {
        setIsFullscreen(isDocFs);
        console.log('[FullscreenDetection] Document API detected fullscreen state:', isDocFs);
      }
    };

    // Query initial
    detectFullscreen();

    // Subscribe to changes
    try {
      nativeWin?.onFullscreenChanged?.(({ fullscreen }: { fullscreen: boolean }) => {
        setIsFullscreen(!!fullscreen);
        setIsFsTransitioning(false);
        console.log('[FullscreenDetection] Native event detected fullscreen state:', !!fullscreen);
      });
    } catch (err) {
      console.warn('[FullscreenDetection] Native event subscription failed:', err);
    }

    const onDocFsChange = () => {
      const isNowFullscreen = !!(document.fullscreenElement || (document as any).webkitFullscreenElement || (document as any).msFullscreenElement);
      setIsFullscreen(isNowFullscreen);
      setIsFsTransitioning(false);
      console.log('[FullscreenDetection] Document event detected fullscreen state:', isNowFullscreen);
    };

    document.addEventListener('fullscreenchange', onDocFsChange);
    document.addEventListener('webkitfullscreenchange', onDocFsChange as any);
    document.addEventListener('MSFullscreenChange', onDocFsChange as any);

    return () => {
      mounted = false;
      document.removeEventListener('fullscreenchange', onDocFsChange);
      document.removeEventListener('webkitfullscreenchange', onDocFsChange as any);
      document.removeEventListener('MSFullscreenChange', onDocFsChange as any);
    };
  }, []);

  React.useEffect(() => {
    // Register F11/Ctrl+Cmd+F to toggle fullscreen via native bridge or browser Fullscreen API
    const toggle = async () => {
      setIsFsTransitioning(true);
      const native = (window as any).native?.window;
      try {
        if (native?.toggleFullscreen) {
          await native.toggleFullscreen();
        } else {
          const elem: any = document.documentElement;
          const inFs = !!(document.fullscreenElement || (document as any).webkitFullscreenElement || (document as any).msFullscreenElement);
          if (!inFs) {
            if (elem.requestFullscreen) await elem.requestFullscreen();
            else if (elem.webkitRequestFullscreen) await elem.webkitRequestFullscreen();
            else if (elem.msRequestFullscreen) await elem.msRequestFullscreen();
          } else {
            if (document.exitFullscreen) await document.exitFullscreen();
            else if ((document as any).webkitExitFullscreen) await (document as any).webkitExitFullscreen();
            else if ((document as any).msExitFullscreen) await (document as any).msExitFullscreen();
          }
        }
      } catch {
        setIsFsTransitioning(false);
      }
    };
    registerHotkey('F11', { tooltip: 'Toggle Fullscreen', handler: toggle });
  }, [registerHotkey]);

  const modulesBase = [
    { id: 'dashboard', name: 'Dashboard', icon: '📊', roles: ['admin', 'frontdesk', 'manager', 'supervisor', 'cashier'], section: 'Front Office' },
    { id: 'barman-dashboard', name: 'Dashboard', icon: '📊', roles: ['barman'], section: 'POS' },
    { id: 'frontoffice', name: 'Front Office', icon: '🏨', roles: ['admin', 'frontdesk', 'manager', 'supervisor'], section: 'Front Office' },
    { id: 'reservations', name: 'Reservations', icon: '📅', roles: ['admin', 'frontdesk', 'manager', 'supervisor'], section: 'Front Office' },
    { id: 'rooms', name: 'Rooms', icon: '🛏️', roles: ['admin', 'frontdesk', 'housekeeping', 'manager', 'supervisor'], section: 'Front Office' },
    { id: 'folios', name: 'Folio Management', icon: '💳', roles: ['admin', 'frontdesk', 'manager', 'supervisor'], section: 'Front Office' },
    { id: 'rate-management', name: 'Rate Management', icon: '💹', roles: ['admin', 'manager', 'supervisor'], section: 'Back Office' },

    { id: 'pos', name: 'POS System', icon: '🍽️', roles: ['admin', 'posmanager', 'manager', 'cashier', 'barman', 'supervisor'], section: 'POS' },
    { id: 'pos-management', name: 'POS Management', icon: '📊', roles: ['admin', 'manager', 'supervisor', 'posmanager'], section: 'POS' },
    { id: 'pos-settings', name: 'POS Settings', icon: '⚙️', roles: ['admin', 'manager', 'supervisor', 'posmanager'], section: 'POS' },
    { id: 'inventory-v11', name: 'Inventory', icon: '📦', roles: ['admin', 'posmanager', 'manager', 'supervisor'], section: 'POS' },

    { id: 'accounting', name: 'Accounting', icon: '📒', roles: ['admin', 'manager', 'auditor', 'supervisor'], section: 'Back Office' },
    { id: 'night-audit', name: 'Night Audit', icon: '🌙', roles: ['admin', 'manager', 'auditor', 'supervisor'], section: 'Back Office' },
    { id: 'inventory-audit', name: 'Inventory Audit', icon: '📋', roles: ['admin', 'manager', 'auditor', 'supervisor'], section: 'Back Office' },
    { id: 'reports', name: 'Reports', icon: '📈', roles: ['admin', 'auditor', 'manager', 'supervisor'], section: 'Back Office' },
    { id: 'fo-setting', name: 'FO Setting', icon: '⚙️', roles: ['admin', 'manager', 'frontdesk', 'auditor', 'posmanager', 'housekeeping', 'cashier', 'barman', 'supervisor'], section: 'Back Office' },
    { id: 'users', name: 'User Management', icon: '👥', roles: ['admin', 'supervisor'], section: 'Back Office' },
    { id: 'tasks', name: 'Tasks', icon: '✅', roles: ['admin', 'manager', 'frontdesk', 'auditor', 'posmanager', 'housekeeping', 'cashier', 'barman', 'supervisor'], section: 'Back Office' },
    { id: 'settings', name: 'System Settings', icon: '🛠️', roles: ['admin'], section: 'Back Office' },
    { id: 'versioncontrol', name: 'Version Control', icon: '🔄', roles: ['admin', 'manager', 'supervisor'], section: 'Back Office' },
    { id: 'maintenance', name: 'Maintenance', icon: '🛠️', roles: ['admin', 'manager', 'supervisor', 'maintenance', 'housekeeping'], section: 'Back Office' },
    { id: 'printer-config', name: 'Printer Configuration', icon: '🖨️', roles: ['admin', 'manager', 'supervisor'], section: 'Back Office' },
    { id: 'breakfast-management', name: 'Breakfast Management', icon: '🍳', roles: ['admin', 'manager', 'supervisor'], section: 'Back Office' }
  ];
  // Permanently remove Folio Management nav button for performance/UX optimization
  const modules = modulesBase
    .filter(m => m.id !== 'folios')
    // Remove five existing entries now consolidated under FO Setting
    .filter(m => !['superadmin-settings', 'admin-management', 'profile-admin', 'profile', 'tx-clearing'].includes(m.id));

  // Permission mapping: Module ID -> Required RightsKey from Users.tsx
  const modulePermissions: Record<string, string> = {
    'frontoffice': 'fo_checkin_checkout',
    'reservations': 'fo_reservations_edit',
    'rooms': 'fo_view_room_status',
    'rate-management': 'fo_reservations_edit',
    'pos': 'fnb_process_orders',
    'pos-management': 'fnb_process_orders',
    'pos-settings': 'admin_change_global_config',
    'inventory': 'fnb_manage_inventory',
    'inventory-audit': 'fin_night_audit_closing',
    'accounting': 'fin_access_ledgers_readonly',
    'night-audit': 'fin_night_audit_closing',
    'reports': 'fin_view_reports_pl',
    'fo-setting': 'admin_change_global_config',
    'users': 'admin_create_edit_users',
    'maintenance': 'ops_work_orders',
    'breakfast-management': 'fnb_process_orders',
  };

  const availableModules = modules.filter(m => {
    const userRole = String(user?.role || '').toLowerCase();
    const hasRole = m.roles.map(r => r.toLowerCase()).includes(userRole);
    
    // Check granular permissions
    const requiredPermission = modulePermissions[m.id];
    const hasPermission = requiredPermission && user?.permissions?.includes(requiredPermission);
    
    // Always show dashboard if they have any access
    if (m.id === 'dashboard') return true;
    
    return hasRole || hasPermission;
  });
  const sections = ['Front Office', 'POS', 'Back Office'];

  const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false);

  return (
    <div
      className="w-full md:w-64 flex flex-col md:h-screen transition-all duration-300"
      style={{ backgroundColor: 'var(--hotel-sidebar-bg, #111827)', color: 'var(--hotel-sidebar-text, #d1d5db)' }}
    >
      <div className="p-6 border-b border-gray-700 flex justify-between items-center">
        <div>
          <BrandHeader />
          <p className="text-sm mt-1" style={{ color: 'var(--hotel-sidebar-text, #9ca3af)', opacity: 0.75 }}>{user?.name}</p>
          <p className="text-xs" style={{ color: 'var(--hotel-sidebar-text, #9ca3af)', opacity: 0.55 }}>{(user?.role || '').toUpperCase()}</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="md:hidden hover:bg-white/10"
          style={{ color: 'var(--hotel-sidebar-text, #d1d5db)' }}
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
        >
          {isMobileMenuOpen ? '✕' : '☰'}
        </Button>
      </div>

      <div className={`${isMobileMenuOpen ? 'flex' : 'hidden'} md:flex flex-col flex-1 overflow-hidden min-h-0`}>
        <nav className="flex-1 overflow-y-auto min-h-0 py-4 max-h-[50vh] md:max-h-full">
          {sections.map(section => (
            <div key={section} className="mb-3">
              <div
                className="px-6 py-2 text-xs uppercase tracking-wide"
                style={{ color: 'var(--hotel-sidebar-text, #9ca3af)', opacity: 0.6 }}
              >{section}</div>
              {availableModules
                .filter(m => m.section === section)
                .map(module => (
                  <button
                    key={module.id}
                    onClick={() => {
                      setActiveModule(module.id);
                      setIsMobileMenuOpen(false); // Auto-close on selection
                    }}
                    className={`w-full px-6 py-3 flex items-center transition-colors`}
                    style={
                      activeModule === module.id
                        ? { backgroundColor: 'var(--hotel-primary)', color: '#ffffff' }
                        : { color: 'var(--hotel-sidebar-text, #d1d5db)' }
                    }
                    onMouseEnter={e => { if (activeModule !== module.id) (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--hotel-sidebar-hover, #1f2937)'; }}
                    onMouseLeave={e => { if (activeModule !== module.id) (e.currentTarget as HTMLElement).style.backgroundColor = ''; }}
                  >
                    <span className="text-xl mr-3">{module.icon}</span>
                    <span className="font-medium flex-1 text-left">{module.name}</span>
                    {module.id === 'pos-settings' && canManagePOS(user?.role) && (
                      <>
                        <span className="ml-2">🔒</span>
                        <span className="ml-2 text-[10px] uppercase tracking-wide bg-red-600 text-white px-2 py-1 rounded">Restricted</span>
                      </>
                    )}
                  </button>
                ))}
            </div>
          ))}
        </nav>

        <div
          className="p-4"
          style={{ borderTop: '1px solid var(--hotel-sidebar-border, #374151)' }}
        >
          <div className="flex items-center gap-2">
            <Button
              onClick={logout}
              size="sm"
              className="flex-1 transition-colors"
              style={{ backgroundColor: 'rgba(239, 68, 68, 0.15)', color: '#fca5a5', border: '1px solid rgba(239, 68, 68, 0.3)' }}
              onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.25)'}
              onMouseLeave={e => e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.15)'}
              aria-label="Logout"
            >
              Logout
            </Button>

            <Button
              onClick={async () => {
                console.log('[ModeButton] Clicked! Current fullscreen state:', isFullscreen);

                setIsFsTransitioning(true);
                const native = (window as any).native?.window;

                try {
                  // First try native Electron API
                  if (native?.toggleFullscreen) {
                    console.log('[ModeButton] Using native toggleFullscreen');
                    await native.toggleFullscreen();
                  } else {
                    // Fallback to browser Fullscreen API
                    console.log('[ModeButton] Using browser Fullscreen API');
                    const elem: any = document.documentElement;
                    const inFs = !!(document.fullscreenElement || (document as any).webkitFullscreenElement || (document as any).msFullscreenElement);

                    if (!inFs) {
                      console.log('[ModeButton] Entering fullscreen');
                      if (elem.requestFullscreen) {
                        await elem.requestFullscreen();
                      } else if (elem.webkitRequestFullscreen) {
                        await elem.webkitRequestFullscreen();
                      } else if (elem.msRequestFullscreen) {
                        await elem.msRequestFullscreen();
                      }
                    } else {
                      console.log('[ModeButton] Exiting fullscreen');
                      if (document.exitFullscreen) {
                        await document.exitFullscreen();
                      } else if ((document as any).webkitExitFullscreen) {
                        await (document as any).webkitExitFullscreen();
                      } else if ((document as any).msExitFullscreen) {
                        await (document as any).msExitFullscreen();
                      }
                    }
                  }

                  // Small delay to allow state to update
                  setTimeout(() => {
                    setIsFsTransitioning(false);
                  }, 300);

                } catch (error) {
                  console.error('[ModeButton] Fullscreen toggle failed:', error);

                  // Check if the error is related to missing native handler
                  if (error instanceof Error && error.message.includes('No handler registered')) {
                    console.log('[ModeButton] Native API not available, using browser API directly');

                    // Directly use browser API as fallback
                    try {
                      const elem: any = document.documentElement;
                      const inFs = !!(document.fullscreenElement || (document as any).webkitFullscreenElement || (document as any).msFullscreenElement);

                      if (!inFs) {
                        console.log('[ModeButton] Attempting to enter fullscreen via browser API');
                        if (elem.requestFullscreen) {
                          await elem.requestFullscreen();
                        } else if (elem.webkitRequestFullscreen) {
                          await elem.webkitRequestFullscreen();
                        } else if (elem.msRequestFullscreen) {
                          await elem.msRequestFullscreen();
                        }
                      } else {
                        console.log('[ModeButton] Attempting to exit fullscreen via browser API');
                        if (document.exitFullscreen) {
                          await document.exitFullscreen();
                        } else if ((document as any).webkitExitFullscreen) {
                          await (document as any).webkitExitFullscreen();
                        } else if ((document as any).msExitFullscreen) {
                          await (document as any).msExitFullscreen();
                        }
                      }
                    } catch (browserError) {
                      console.error('[ModeButton] Browser API also failed:', browserError);
                    }
                  }

                  // In all cases, update the state based on actual document state after a brief moment
                  setTimeout(() => {
                    const actualFullscreen = !!(document.fullscreenElement ||
                      (document as any).webkitFullscreenElement ||
                      (document as any).msFullscreenElement);
                    setIsFullscreen(actualFullscreen);
                    setIsFsTransitioning(false);
                  }, 100);
                }
                setIsFsTransitioning(false);
              }}
              size="sm"
              className={`min-w-[4.75rem] transition-colors ${isFsTransitioning ? 'animate-pulse' : ''}`}
              style={isFullscreen
                ? { backgroundColor: 'var(--hotel-primary)', color: '#ffffff', border: '1px solid var(--hotel-primary)' }
                : { backgroundColor: 'transparent', color: 'var(--hotel-sidebar-text)', border: '1px solid var(--hotel-sidebar-border)' }
              }
              onMouseEnter={e => { if (!isFullscreen) e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)' }}
              onMouseLeave={e => { if (!isFullscreen) e.currentTarget.style.backgroundColor = 'transparent' }}
              title="Toggle Display Mode (F11)"
              aria-label="Toggle Display Mode"
              aria-busy={isFsTransitioning}
              disabled={isFsTransitioning}
            >
              {isFullscreen ? 'Window' : 'Full'}
            </Button>

            <Button
              onClick={() => setHotkeysOpen(true)}
              size="sm"
              className="min-w-[4.75rem] transition-colors"
              style={{ backgroundColor: 'transparent', color: 'var(--hotel-sidebar-text)', border: '1px solid var(--hotel-sidebar-border)' }}
              onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)'}
              onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
              title="Open Hotkeys"
              aria-label="Open Hotkeys"
            >
              ⚡ Hotkeys
            </Button>

            {/* Connection Status Button */}
            <OfflineIndicator variant="sidebar" />
          </div>
        </div>
        <HotkeysSettings open={hotkeysOpen} onOpenChange={setHotkeysOpen} />
        {/* Journal Posting Modal removed; lives in Accounting module */}
      </div>
    </div >
  );
};
