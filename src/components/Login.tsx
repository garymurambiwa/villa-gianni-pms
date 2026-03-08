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
