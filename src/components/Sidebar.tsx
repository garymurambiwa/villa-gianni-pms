import React from 'react';
import { Button } from '@/components/ui/button';
import { useHotkeys } from '@/contexts/HotkeysContext';
import { useAuth } from '../context/AuthContext';
import { canManagePOS } from '@/lib/permissions';
import HotkeysSettings from '@/components/modules/HotkeysSettings';
import BrandHeader from '@/components/ui/BrandHeader';
import VersionDisplay from '@/components/ui/VersionDisplay';

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
    { id: 'dashboard', name: 'Dashboard', icon: '📊', roles: ['admin', 'frontdesk', 'manager', 'supervisor'], section: 'Front Office' },
    { id: 'frontoffice', name: 'Front Office', icon: '🏨', roles: ['admin', 'frontdesk', 'manager', 'supervisor'], section: 'Front Office' },
    { id: 'reservations', name: 'Reservations', icon: '📅', roles: ['admin', 'frontdesk', 'manager', 'supervisor'], section: 'Front Office' },
    { id: 'rooms', name: 'Rooms', icon: '🛏️', roles: ['admin', 'frontdesk', 'housekeeping', 'manager', 'supervisor'], section: 'Front Office' },
    { id: 'folios', name: 'Folio Management', icon: '💳', roles: ['admin', 'frontdesk', 'manager', 'supervisor'], section: 'Front Office' },
    { id: 'rate-management', name: 'Rate Management', icon: '💹', roles: ['admin', 'manager', 'supervisor'], section: 'Back Office' },

    { id: 'pos', name: 'POS System', icon: '🍽️', roles: ['admin', 'posmanager', 'manager', 'cashier', 'barman', 'supervisor'], section: 'POS' },
    { id: 'pos-settings', name: 'POS Settings', icon: '⚙️', roles: ['admin', 'manager', 'supervisor'], section: 'POS' },
    { id: 'inventory', name: 'Inventory', icon: '📦', roles: ['admin', 'posmanager', 'manager', 'supervisor', 'barman'], section: 'POS' },

    { id: 'accounting', name: 'Accounting', icon: '📒', roles: ['admin', 'manager', 'auditor', 'supervisor'], section: 'Back Office' },
    { id: 'night-audit', name: 'Night Audit', icon: '🌙', roles: ['admin','manager','auditor','supervisor'], section: 'Back Office' },
    { id: 'reports', name: 'Reports', icon: '📈', roles: ['admin', 'auditor', 'manager', 'supervisor'], section: 'Back Office' },
    { id: 'fo-setting', name: 'FO Setting', icon: '⚙️', roles: ['admin','manager','frontdesk','auditor','posmanager','housekeeping','cashier','barman','supervisor'], section: 'Back Office' },
    { id: 'users', name: 'User Management', icon: '👥', roles: ['admin', 'supervisor'], section: 'Back Office' },
    { id: 'tasks', name: 'Tasks', icon: '✅', roles: ['admin','manager','frontdesk','auditor','posmanager','housekeeping','cashier','barman','supervisor'], section: 'Back Office' },
    { id: 'versioncontrol', name: 'Version Control', icon: '🔄', roles: ['admin', 'manager', 'supervisor'], section: 'Back Office' },
    { id: 'maintenance', name: 'Maintenance', icon: '🛠️', roles: ['admin','manager','supervisor','maintenance','housekeeping'], section: 'Back Office' },
    { id: 'printer-config', name: 'Printer Configuration', icon: '🖨️', roles: ['admin','manager','supervisor'], section: 'Back Office' },
    { id: 'breakfast-management', name: 'Breakfast Management', icon: '🍳', roles: ['admin','manager','supervisor'], section: 'Back Office' }
  ];
  // Permanently remove Folio Management nav button for performance/UX optimization
  const modules = modulesBase
    .filter(m => m.id !== 'folios')
    // Remove five existing entries now consolidated under FO Setting
    .filter(m => !['superadmin-settings','admin-management','profile-admin','profile','tx-clearing'].includes(m.id));

  const availableModules = modules.filter(m => m.roles.map(r => r.toLowerCase()).includes(String(user?.role || '').toLowerCase()));
  const sections = ['Front Office', 'POS', 'Back Office'];

  return (
    <div className="w-64 bg-gray-900 text-white h-screen flex flex-col">
      <div className="p-6 border-b border-gray-700">
        <BrandHeader />
        <p className="text-sm text-gray-400 mt-1">{user?.name}</p>
        <p className="text-xs text-gray-500">{(user?.role || '').toUpperCase()}</p>
      </div>
      
      <nav className="flex-1 overflow-y-auto py-4">
        {sections.map(section => (
          <div key={section} className="mb-3">
            <div className="px-6 py-2 text-xs uppercase tracking-wide text-gray-400">{section}</div>
            {availableModules
              .filter(m => m.section === section)
              .map(module => (
                <button
                  key={module.id}
                  onClick={() => setActiveModule(module.id)}
                  className={`w-full px-6 py-3 flex items-center transition-colors ${
                    activeModule === module.id 
                      ? 'bg-blue-600 text-white' 
                      : 'text-gray-300 hover:bg-gray-800'
                  }`}
                >
                  <span className="text-xl mr-3">{module.icon}</span>
                  <span className="font-medium flex-1 text-left">{module.name}</span>
                  {module.id === 'pos-settings' && canManagePOS(user?.role) && (
                    <>
                      <span className="ml-2">🔒</span>
                      <span className="ml-2 text-[10px] uppercase tracking-wide bg-red-600 text-white px-2 py-1 rounded">Admin/Supervisor</span>
                    </>
                  )}
                </button>
              ))}
          </div>
        ))}
      </nav>
      
      <div className="p-4 border-t border-gray-700">
        <div className="flex items-center gap-2">
          <Button
            onClick={logout}
            variant="destructive"
            size="sm"
            className="flex-1"
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
            }}
            variant={isFullscreen ? 'secondary' : 'default'}
            size="sm"
            className={`min-w-[4.75rem] ${isFsTransitioning ? 'animate-pulse' : ''}`}
            title="Toggle Display Mode (F11)"
            aria-label="Toggle Display Mode"
            aria-busy={isFsTransitioning}
            disabled={isFsTransitioning}
          >
            {isFullscreen ? 'Window' : 'Full'}
          </Button>

          <Button
            onClick={() => setHotkeysOpen(true)}
            variant="secondary"
            size="sm"
            className="min-w-[4.75rem]"
            title="Open Hotkeys"
            aria-label="Open Hotkeys"
          >
            ⚡ Hotkeys
          </Button>
        </div>
        <div className="mt-3 flex justify-center">
          <VersionDisplay className="text-gray-600" />
        </div>
      </div>
      <HotkeysSettings open={hotkeysOpen} onOpenChange={setHotkeysOpen} />
      {/* Journal Posting Modal removed; lives in Accounting module */}
    </div>
  );
};
