import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useShift } from '../../contexts/ShiftContext';
import { useSettings } from '../../hooks/useSettings';
import { Button } from '../ui/button';
import { StartShiftModal } from './StartShiftModal';
import { ShiftReportModal } from './ShiftReportModal';
import { ShiftClosureModal } from '../pos/ShiftClosureModal';
import { PINModal } from '../pos/PINModal';
import { ShiftReading } from '../../types';
import { canManagePOS } from '../../lib/permissions';
// import BackOfficeSettings from './BackOfficeSettings';

export const Header: React.FC = () => {
  const { user, logout, costCentre, setCostCentre, verifyPosPin } = useAuth();
  const { settings: appSettings } = useSettings();
  const { activeShift, generateXReading, getTotals } = useShift();
  const [showStartModal, setShowStartModal] = useState(false);
  const [showClosureModal, setShowClosureModal] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [showPinModal, setShowPinModal] = useState(false);
  const [pinPurpose, setPinPurpose] = useState<'start' | 'switch' | null>(null);
  const [currentReading, setCurrentReading] = useState<ShiftReading | null>(null);
  // const [showSettings, setShowSettings] = useState(false);

  const handleXReading = async () => {
    try {
      const reading = await generateXReading();
      setCurrentReading(reading);
      setShowReportModal(true);
    } catch (error) {
      console.error('Failed to generate X-Reading:', error);
    }
  };

  const handleEndShift = () => {
    setShowClosureModal(true);
  };

  const handleShiftClosed = (zReading: ShiftReading) => {
    setCurrentReading(zReading);
    setShowReportModal(true);
    setShowClosureModal(false);
  };

  const handlePinSuccess = (verifiedUser: any) => {
    setShowPinModal(false);
    if (pinPurpose === 'start') {
      // We could store the verifiedUser in a state if we want StartShiftModal to use it instead of useAuth().user
      setShowStartModal(true);
    } else if (pinPurpose === 'switch') {
      setCostCentre(null);
    }
    setPinPurpose(null);
  };

  // Brand logo fallback (shared with BrandHeader defaults)
  const readJSON = <T,>(key: string, fallback: T): T => {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; }
  };
  type BrandSettings = { logoDataUrl?: string };
  const settings = readJSON<BrandSettings>('corepms_brand_settings', {} as BrandSettings);
  const defaultLogo = import.meta.env.VITE_HOTEL_LOGO_URL || '/logo.png';
  const logoSrc = appSettings.logoUrl || settings.logoDataUrl || defaultLogo;

  return (
    <>
      <header
        className="text-white shadow-2xl sticky top-0 z-40"
        style={{ background: 'linear-gradient(to right, var(--hotel-header-from), var(--hotel-header-mid), var(--hotel-header-to))' }}
      >
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <a href="#/" aria-label="Go to homepage" title="Go to homepage" className="block select-none">
                <picture>
                  {String(logoSrc).startsWith('data:image/svg') || String(logoSrc).endsWith('.svg') ? (
                    <source srcSet={logoSrc} type="image/svg+xml" />
                  ) : null}
                  <img
                    src={logoSrc}
                    alt={appSettings.hotelName || import.meta.env.VITE_HOTEL_NAME || 'Hotel Logo'}
                    className="w-[120px] sm:w-[150px] md:w-[180px] h-auto object-contain"
                    srcSet={`${logoSrc} 1x`}
                    loading="eager"
                  />
                </picture>
              </a>
              <div>
                {/* Brand Name Removed */}
                <p className="text-sm text-purple-200">Restaurant Management System</p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              {activeShift && (
                <div className="bg-green-500/20 border border-green-400 rounded px-3 py-2">
                  <div className="text-xs text-green-200">Active Shift</div>
                  <div className="text-sm font-bold">
                    ${(getTotals().cash + getTotals().card + getTotals().roomCharge).toFixed(2)}
                  </div>
                  <div className="text-xs">{getTotals().count} orders</div>
                </div>
              )}

              <div className="flex gap-2">
                {!activeShift ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { setPinPurpose('start'); setShowPinModal(true); }}
                    className="bg-red-600 hover:bg-red-700 border-red-600 text-current hover:text-current transition-all duration-200 transform hover:scale-105 hover:shadow-lg"
                  >
                    Start Shift
                  </Button>
                ) : (
                  <>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={handleXReading}
                      className="transition-all duration-200 transform hover:scale-105 hover:shadow-lg"
                    >
                      X-Reading
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={handleEndShift}
                      className="transition-all duration-200 transform hover:scale-105 hover:shadow-lg"
                    >
                      End Shift
                    </Button>
                  </>
                )}
              </div>

              {/* Management-only Settings button */}
              {canManagePOS(user?.role) && (
                <Button
                  size="sm"
                  onClick={() => window.dispatchEvent(new CustomEvent('navigateToModule', { detail: { module: 'pos-settings' } }))}
                  className="bg-indigo-600 text-white hover:bg-indigo-700 transition-all duration-200 transform hover:scale-105 hover:shadow-lg"
                >
                  <span className="mr-2">⚙️</span>
                  Settings
                </Button>
              )}

              {/* Management-only Reports button */}
              {canManagePOS(user?.role) && (
                <Button
                  size="sm"
                  onClick={() => {
                    const end = new Date();
                    const start = new Date(); start.setDate(end.getDate() - 30);
                    try {
                      const url = new URL(window.location.href);
                      url.searchParams.set('start', start.toISOString().slice(0, 10));
                      url.searchParams.set('end', end.toISOString().slice(0, 10));
                      window.history.replaceState({}, '', url.toString());
                    } catch { }
                    window.dispatchEvent(new CustomEvent('navigateToModule', { detail: { module: 'reports' } }));
                  }}
                  className="bg-teal-600 text-white hover:bg-teal-700 transition-all duration-200 transform hover:scale-105 hover:shadow-lg"
                >
                  <span className="mr-2">📊</span>
                  Reports
                </Button>
              )}

              <div className="border-l border-purple-400 pl-4 flex flex-col justify-center">
                <div className="flex items-center gap-2">
                  <div className="text-sm font-semibold">{user?.name}</div>
                  <div className="text-[10px] bg-white/20 px-1.5 py-0.5 rounded uppercase tracking-wider font-bold">
                    {user?.role || 'Staff'}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-xs text-purple-200">
                    Station: <span className="font-bold text-white">{costCentre || 'Not Selected'}</span>
                  </div>
                  <button 
                    onClick={() => { setPinPurpose('switch'); setShowPinModal(true); }}
                    className="text-[10px] text-purple-300 hover:text-white underline decoration-purple-400 underline-offset-2 transition-colors"
                  >
                    Switch
                  </button>
                </div>
              </div>

              <Button 
                variant="ghost" 
                size="sm" 
                onClick={logout}
                className="text-white hover:bg-white/10"
              >
                Logout
              </Button>
            </div>
          </div>
        </div>
      </header>

      <StartShiftModal open={showStartModal} onClose={() => setShowStartModal(false)} />
      <ShiftClosureModal
        open={showClosureModal}
        onClose={() => setShowClosureModal(false)}
        onSuccess={handleShiftClosed}
      />
      <ShiftReportModal
        open={showReportModal}
        onClose={() => setShowReportModal(false)}
        reading={currentReading}
      />


      <PINModal
        isOpen={showPinModal}
        onClose={() => setShowPinModal(false)}
        onSuccess={handlePinSuccess}
        verifyPin={verifyPosPin}
      />
    </>
  );
};
