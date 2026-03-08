import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { logger } from '@/lib/logger';
import VersionDisplay from '@/components/ui/VersionDisplay';
import { useSettings } from '@/hooks/useSettings';

export const Login: React.FC = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { login } = useAuth();
  const { settings: appSettings } = useSettings();
  const [loading, setLoading] = useState(false);
  const [dbModalOpen, setDbModalOpen] = useState(false);
  const [dbHost, setDbHost] = useState('192.168.100.18');
  const [dbPort, setDbPort] = useState('3306');
  const [dbUser, setDbUser] = useState('root');
  const [dbPassword, setDbPassword] = useState('');
  const [dbName, setDbName] = useState('corepms_db');
  const [dbStatus, setDbStatus] = useState('');
  const [dbBusy, setDbBusy] = useState(false);

  React.useEffect(() => {
    try {
      const available = typeof (window as any).native?.db?.onSetupRequired === 'function';
      if (available) {
        (window as any).native.db.onSetupRequired((payload: any) => {
          setDbStatus(String(payload?.error || 'Database connection required'));
          setDbModalOpen(true);
        });
      }
    } catch { }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setLoading(true);
    logger.logAuth('login_attempt', { username, timestamp: new Date().toISOString() });
    try {
      const result = await login(username, password);
      if (result.success) {
        logger.logAuth('login_success', { username, timestamp: new Date().toISOString() });
      } else if (result.error) {
        // Handle different error types with appropriate user messages
        let userMessage = 'Invalid username or password';
        switch (result.error.code) {
          case 'USER_LOCKED':
            userMessage = 'Account is locked due to multiple failed attempts. Please try again later.';
            break;
          case 'RATE_LIMITED':
            userMessage = 'Too many login attempts. Please wait before trying again.';
            break;
          case 'USER_INACTIVE':
            userMessage = 'Account is inactive. Please contact your administrator.';
            break;
          case 'NETWORK_ERROR':
            userMessage = 'Unable to connect to authentication service. Please try again later.';
            break;
          case 'SESSION_EXPIRED':
            userMessage = 'Your session has expired. Please sign in again.';
            break;
          default:
            userMessage = 'Invalid username or password';
        }

        logger.logAuth('login_failure', {
          username,
          errorCode: result.error.code,
          timestamp: new Date().toISOString()
        });
        setError(userMessage);
      }
    } catch (err) {
      logger.logAuth('login_failure', {
        username,
        errorCode: 'UNKNOWN_ERROR',
        error: (err as any)?.message,
        timestamp: new Date().toISOString()
      });
      setError('Sign-in failed. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {appSettings.themePreset === 'bronze' ? (
        <div className="min-h-screen flex flex-col md:flex-row bg-white w-full">
          {/* Left side: Login Form matching reference styling */}
          <div className="w-full md:w-1/2 xl:w-[45%] flex flex-col justify-center px-8 sm:px-16 lg:px-24 py-12 min-h-screen relative z-10">
            <div className="w-full max-w-md mx-auto">
              <div className="mb-10">
                <img src={appSettings.logoUrl || import.meta.env.VITE_HOTEL_LOGO_URL || '/logo.png'} alt="Logo" className="h-10 object-contain" />
              </div>

              <h1 className="text-3xl font-bold text-gray-900 mb-2">Login</h1>
              <p className="text-gray-500 font-medium mb-8 text-sm">{appSettings.hotelTagline || 'See your growth and get consulting support!'}</p>

              <button type="button" className="w-full flex items-center justify-center gap-3 bg-white border border-gray-200 text-gray-700 font-bold py-3.5 rounded-full hover:bg-gray-50 transition-colors mb-6 shadow-sm">
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                </svg>
                Sign in with Google
              </button>

              <div className="flex items-center mb-6">
                <div className="flex-1 border-t border-gray-200"></div>
                <span className="px-4 text-xs text-gray-400 uppercase tracking-widest font-semibold">or Sign in with Email</span>
                <div className="flex-1 border-t border-gray-200"></div>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label className="block text-gray-900 text-sm font-bold mb-2">Username or Email*</label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full px-5 py-3.5 rounded-full border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[var(--hotel-primary)] transition-shadow text-sm"
                    placeholder="mail@website.com"
                    required
                  />
                </div>
                <div>
                  <label className="block text-gray-900 text-sm font-bold mb-2">Password*</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-5 py-3.5 rounded-full border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[var(--hotel-primary)] transition-shadow text-sm"
                    placeholder="Min. 8 character"
                    required
                  />
                </div>

                <div className="flex items-center justify-between mt-2 mb-6">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" className="rounded text-[var(--hotel-primary)] focus:ring-2 focus:ring-[var(--hotel-primary)] w-4 h-4 border-gray-300" defaultChecked />
                    <span className="text-sm font-bold text-gray-900">Remember me</span>
                  </label>
                  <a href="#" className="text-sm font-bold text-[var(--hotel-primary)] hover:underline">Forget password?</a>
                </div>

                {error && (
                  <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm font-medium">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  className="w-full text-white py-4 rounded-full font-bold transition-opacity hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed shadow-lg text-sm"
                  style={{ backgroundColor: 'var(--hotel-primary, #BB7338)' }}
                  disabled={loading}
                >
                  {loading ? 'Signing In…' : 'Login'}
                </button>
              </form>

              <div className="mt-6 text-sm font-bold text-gray-900">
                Not registered yet? <a href="#" className="text-[var(--hotel-primary)] hover:underline">Create an Account</a>
              </div>

              <div className="mt-12 text-xs font-semibold text-gray-400">
                ©{new Date().getFullYear()} {appSettings.hotelName || 'Felix'} All rights reserved.
              </div>

              {/* Additional DB config hidden mostly, standard link */}
              <div className="mt-4 flex items-center gap-2">
                <button
                  onClick={() => setDbModalOpen(true)}
                  className="text-xs font-semibold text-gray-400 hover:text-gray-600 transition-colors"
                >
                  Configure DB
                </button>
                <div className="text-xs text-gray-300 opacity-50"><VersionDisplay /></div>
              </div>
            </div>
          </div>

          {/* Right side: Aesthetic colored background matching reference shape */}
          <div className="hidden md:flex flex-1 relative overflow-hidden items-center justify-center p-12" style={{ backgroundColor: 'var(--hotel-primary, #BB7338)' }}>

            {/* Geometric Step Patterns */}
            <div className="absolute top-0 left-0 w-64 h-64 flex flex-col opacity-50">
              <div className="h-16 w-64 bg-black/10"></div>
              <div className="h-16 w-48 bg-black/10"></div>
              <div className="h-16 w-32 bg-black/10"></div>
              <div className="h-16 w-16 bg-black/10"></div>
            </div>

            <div className="absolute bottom-0 right-0 w-64 h-64 flex flex-col items-end opacity-50">
              <div className="h-16 w-16 bg-black/10"></div>
              <div className="h-16 w-32 bg-black/10"></div>
              <div className="h-16 w-48 bg-black/10"></div>
              <div className="h-16 w-64 bg-black/10"></div>
            </div>

            <div className="absolute top-16 right-16 flex gap-2 opacity-50">
              <div className="w-0 h-0 border-l-[16px] border-l-transparent border-t-[16px] border-t-black/20"></div>
              <div className="w-0 h-0 border-l-[16px] border-l-transparent border-t-[16px] border-t-black/20"></div>
              <div className="w-0 h-0 border-l-[16px] border-l-transparent border-t-[16px] border-t-black/20"></div>
            </div>

            <div className="relative z-20 w-full max-w-lg -mt-20">

              {/* Floating Social Icons */}
              <div className="absolute -top-12 left-10 w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-lg transform -rotate-12 z-30">
                <span className="text-xl text-[#1DA1F2]">🐦</span>
              </div>
              <div className="absolute -top-20 left-1/2 w-10 h-10 bg-white rounded-full flex items-center justify-center shadow-lg z-30">
                <span className="text-[#E1306C] font-bold text-sm">IG</span>
              </div>

              <div className="relative flex perspective-1000 items-center justify-center">

                {/* Main Wide Chart Card */}
                <div className="bg-white/95 backdrop-blur rounded-sm shadow-2xl p-6 w-[22rem] relative z-10 mr-12 mt-16 transform transition-transform hover:scale-105">
                  <p className="text-3xl font-bold text-gray-800">$162,751</p>

                  <div className="h-20 w-full mt-2 relative">
                    <svg viewBox="0 0 200 60" className="w-full h-full stroke-[var(--hotel-primary)]" fill="none" strokeWidth="2">
                      <path d="M0,50 C20,40 30,20 60,25 C90,30 110,5 140,15 C170,25 190,40 200,45" />
                      <path d="M0,50 C20,40 30,20 60,25 C90,30 110,5 140,15 C170,25 190,40 200,45 L200,60 L0,60 Z" fill="color-mix(in srgb, var(--hotel-primary) 10%, transparent)" stroke="none" />
                      <circle cx="140" cy="15" r="3" fill="#fff" stroke="var(--hotel-primary)" strokeWidth="2" />
                    </svg>
                  </div>

                  <div className="flex justify-between text-[9px] text-gray-400 font-bold mt-2 uppercase tracking-wide px-1">
                    <span>Apr</span><span>May</span><span>Jun</span>
                    <span className="text-[var(--hotel-primary)] border-b-2 border-[var(--hotel-primary)] pb-0.5" style={{ color: 'var(--hotel-primary)', borderColor: 'var(--hotel-primary)' }}>Jul</span>
                    <span>Aug</span>
                  </div>
                </div>

                {/* Overlapping Rewards Square Card */}
                <div className="bg-white rounded-sm shadow-2xl p-6 w-48 absolute right-4 -top-8 z-20 transform transition-transform hover:scale-105">
                  <p className="text-sm font-bold text-gray-900 mb-6">Rewards</p>

                  <div className="flex justify-center mb-6">
                    <div className="w-20 h-20 rounded-full border-[3px] border-b-transparent border-l-transparent flex items-center justify-center transform -rotate-45" style={{ borderColor: 'color-mix(in srgb, var(--hotel-primary) 20%, transparent)', borderTopColor: 'var(--hotel-primary)', borderRightColor: 'var(--hotel-primary)' }}>
                      <div className="w-14 h-14 bg-cyan-100/50 rounded-full overflow-hidden flex items-center justify-center transform rotate-45 shadow-inner">
                        <span className="text-3xl">👨‍💼</span>
                      </div>
                    </div>
                  </div>

                  <p className="text-center text-[10px] text-gray-400 uppercase font-bold tracking-widest">Points</p>
                  <p className="text-center text-xl font-bold text-gray-900 mt-1">172,832</p>
                </div>

                {/* Floating Chat Bubble Icon */}
                <div className="absolute -bottom-8 -right-2 w-10 h-10 bg-white rounded-full flex items-center justify-center shadow-lg z-30">
                  <span className="text-lg">💬</span>
                </div>

              </div>
            </div>

            <div className="absolute bottom-20 left-0 right-0 text-center px-12 z-20">
              <h2 className="text-3xl md:text-4xl font-bold text-white mb-4 leading-tight">Turn your ideas<br />into reality.</h2>
              <p className="text-white/80 text-sm max-w-sm mx-auto font-medium leading-relaxed">Consistent quality and experience across all platforms and devices.</p>

              <div className="flex justify-center gap-1.5 mt-8 items-center">
                <div className="w-4 h-1.5 bg-white rounded-full transition-all"></div>
                <div className="w-1.5 h-1.5 bg-white/40 rounded-full hover:bg-white/60 transition-colors cursor-pointer"></div>
                <div className="w-1.5 h-1.5 bg-white/40 rounded-full hover:bg-white/60 transition-colors cursor-pointer"></div>
              </div>
            </div>

          </div>
        </div>
      ) : (
        <div
          className="min-h-screen flex items-center justify-center p-4 relative"
          style={{
            backgroundImage: `url(${appSettings.backgroundImageUrl || import.meta.env.VITE_HOTEL_LOGIN_BG_URL || 'https://d64gsuwffb70l.cloudfront.net/6902597c3f1b2e5af1fa50b6_1761984216938_8ca99844.webp'})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat'
          }}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm"></div>
          <div className="bg-white/95 backdrop-blur-xl rounded-3xl shadow-2xl p-8 w-full max-w-md border border-gray-200 relative z-10">
            <div className="text-center mb-8">
              <img src={appSettings.logoUrl || import.meta.env.VITE_HOTEL_LOGO_URL || '/logo.png'} alt={appSettings.hotelName || import.meta.env.VITE_HOTEL_NAME || 'Hotel Logo'} className="h-32 mx-auto mb-6 object-contain" />
              <h1 className="text-2xl font-bold text-gray-900 mb-2">{appSettings.hotelName || import.meta.env.VITE_HOTEL_NAME || 'Hotel Name'}</h1>
              {appSettings.hotelTagline && <p className="text-gray-600 mb-2">{appSettings.hotelTagline}</p>}
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label className="block text-gray-700 text-sm font-medium mb-2">Username</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl bg-white border border-gray-300 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Enter username"
                  required
                />
              </div>

              <div>
                <label className="block text-gray-700 text-sm font-medium mb-2">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl bg-white border border-gray-300 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Enter password"
                  required
                />
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
                  {error}
                </div>
              )}

              <button
                type="submit"
                className="w-full bg-blue-600 text-white py-3 rounded-xl font-semibold hover:bg-blue-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                disabled={loading}
              >
                {loading ? 'Signing In…' : 'Sign In'}
              </button>
            </form>

            <div className="mt-8 flex flex-col items-center gap-4">
              <button
                onClick={() => setDbModalOpen(true)}
                className="text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline flex items-center gap-1"
              >
                <span>🌐</span> Configure Network Database
              </button>
              <VersionDisplay />
            </div>
          </div>
        </div>
      )}
      {dbModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-lg border border-gray-200">
            <div className="flex justify-between items-center mb-3">
              <h2 className="text-xl font-bold">Database Connection Setup</h2>
              <button className="text-gray-500 hover:text-gray-700" onClick={() => setDbModalOpen(false)}>×</button>
            </div>
            {dbStatus && <div className="mb-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">{dbStatus}</div>}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Host</label>
                <input className="w-full px-3 py-2 border rounded" value={dbHost} onChange={(e) => setDbHost(e.target.value)} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Port</label>
                <input className="w-full px-3 py-2 border rounded" value={dbPort} onChange={(e) => setDbPort(e.target.value)} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">User</label>
                <input className="w-full px-3 py-2 border rounded" value={dbUser} onChange={(e) => setDbUser(e.target.value)} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                <input type="password" className="w-full px-3 py-2 border rounded" value={dbPassword} onChange={(e) => setDbPassword(e.target.value)} />
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Database</label>
                <input className="w-full px-3 py-2 border rounded" value={dbName} onChange={(e) => setDbName(e.target.value)} />
              </div>
            </div>
            <div className="mt-4 flex items-center gap-2">
              <button
                className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:bg-gray-300"
                disabled={dbBusy}
                onClick={async () => {
                  setDbBusy(true); setDbStatus('');
                  try {
                    const pcol = 'postgres';
                    const dsn = `${pcol}://${encodeURIComponent(dbUser)}:${encodeURIComponent(dbPassword)}@${dbHost}:${dbPort}/${dbName}`;
                    const res = await (window as any).native.db.setConnectionString(dsn);
                    if (!res?.ok) { setDbStatus(res?.error || 'Failed to save connection'); setDbBusy(false); return; }
                    const test = await (window as any).native.db.testConnection();
                    if (!test?.ok) { setDbStatus(test?.error || 'Connection test failed'); setDbBusy(false); return; }
                    setDbStatus(`Connected. Server: ${String(test.serverVersion || 'unknown')}`);
                    setDbModalOpen(false);
                  } catch (e: any) {
                    setDbStatus(e?.message || 'Failed to apply settings');
                  } finally { setDbBusy(false); }
                }}
              >
                Save & Test
              </button>
              <button
                className="border px-4 py-2 rounded hover:bg-gray-50"
                onClick={() => setDbModalOpen(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
