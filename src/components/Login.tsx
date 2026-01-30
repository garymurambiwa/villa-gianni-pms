import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { logger } from '@/lib/logger';
import VersionDisplay from '@/components/ui/VersionDisplay';

export const Login: React.FC = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { login } = useAuth();
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
    } catch {}
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
        backgroundImage: 'url(https://d64gsuwffb70l.cloudfront.net/6902597c3f1b2e5af1fa50b6_1761984216938_8ca99844.webp)',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat'
      }}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm"></div>
      <div className="bg-white/95 backdrop-blur-xl rounded-3xl shadow-2xl p-8 w-full max-w-md border border-gray-200 relative z-10">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">COREPMS</h1>
          <p className="text-gray-600">Hotel Management System</p>
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
        
        <div className="mt-6 p-4 bg-gray-50 rounded-xl border border-gray-200">
          <div className="flex items-start gap-3">
            <div aria-hidden="true" className="mt-0.5 h-4 w-4 rounded-sm bg-gray-300 flex items-center justify-center">
              <span className="text-[10px] font-bold text-gray-700">🔒</span>
            </div>
            <div className="text-xs text-gray-600">
              <p className="font-semibold">Credentials hidden for security</p>
              <p className="text-gray-600">Contact your administrator for access. Admins can securely reveal test accounts with an access code.</p>
              <ProtectedReveal />
            </div>
          </div>
        </div>
        <div className="mt-4 flex justify-center">
          <VersionDisplay />
        </div>
      </div>
    </div>
    {dbModalOpen && (
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
        <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-lg border border-gray-200">
          <div className="flex justify-between items-center mb-3">
            <h2 className="text-xl font-bold">Database Connection Setup</h2>
            <button className="text-gray-500 hover:text-gray-700" onClick={()=> setDbModalOpen(false)}>×</button>
          </div>
          {dbStatus && <div className="mb-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">{dbStatus}</div>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Host</label>
              <input className="w-full px-3 py-2 border rounded" value={dbHost} onChange={(e)=> setDbHost(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Port</label>
              <input className="w-full px-3 py-2 border rounded" value={dbPort} onChange={(e)=> setDbPort(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">User</label>
              <input className="w-full px-3 py-2 border rounded" value={dbUser} onChange={(e)=> setDbUser(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <input type="password" className="w-full px-3 py-2 border rounded" value={dbPassword} onChange={(e)=> setDbPassword(e.target.value)} />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Database</label>
              <input className="w-full px-3 py-2 border rounded" value={dbName} onChange={(e)=> setDbName(e.target.value)} />
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <button
              className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:bg-gray-300"
              disabled={dbBusy}
              onClick={async () => {
                setDbBusy(true); setDbStatus('');
                try {
                  const dsn = `mysql://${encodeURIComponent(dbUser)}:${encodeURIComponent(dbPassword)}@${dbHost}:${dbPort}/${dbName}`;
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
              onClick={()=> setDbModalOpen(false)}
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

// Secure, click-to-reveal flow — requires an admin access code via Electron IPC.
// No credentials are present in the DOM or source until authorization succeeds.
const ProtectedReveal: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<'idle'|'loading'|'success'|'error'>('idle');
  const [error, setError] = useState('');
  const [creds, setCreds] = useState<Array<{ username: string; password: string; role?: string }>>([]);

  const isElectronAvailable = typeof (window as any).native?.security?.revealDefaultCredentials === 'function';

  const handleReveal = async () => {
    if (!isElectronAvailable) {
      setError('Secure reveal is only available in the desktop app.');
      setStatus('error');
      return;
    }
    setStatus('loading'); setError(''); setCreds([]);
    try {
      const res = await (window as any).native.security.revealDefaultCredentials(code);
      if (res?.ok && Array.isArray(res?.creds)) {
        setCreds(res.creds);
        setStatus('success');
        // Seed accounts locally to enable sign-in (without exposing in DOM beforehand)
        try {
          const { register } = await import('@/lib/authService');
          for (const c of res.creds) {
            await register({ username: c.username, email: '', password: c.password, role: (c.role as any) || 'frontdesk' });
          }
        } catch {}
      } else {
        setStatus('error');
        setError(res?.error || 'Reveal failed');
      }
    } catch (e) {
      setStatus('error');
      setError('Reveal failed');
    }
  };

  return (
    <div className="mt-3" aria-live="polite">
      <button
        type="button"
        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-semibold bg-gray-200 hover:bg-gray-300 text-gray-800"
        aria-expanded={open}
        aria-controls="reveal-panel"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? 'Close' : 'Reveal Test Accounts (Admin Code)'}
      </button>

      {open && (
        <div id="reveal-panel" className="mt-2 space-y-2">
          <label className="block text-[11px] text-gray-700 font-medium">Admin access code</label>
          <input
            type="password"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="w-full px-3 py-2 rounded-md bg-white border border-gray-300 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="Enter administrator access code"
            aria-label="Administrator access code"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="px-3 py-1.5 rounded-md text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-60 disabled:cursor-not-allowed"
              onClick={handleReveal}
              disabled={status === 'loading'}
            >
              {status === 'loading' ? 'Verifying…' : 'Verify & Reveal'}
            </button>
            {!isElectronAvailable && (
              <span className="text-[11px] text-gray-500">Desktop app required for secure reveal.</span>
            )}
          </div>

          {status === 'error' && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-md text-[11px]" role="alert">
              {error}
            </div>
          )}

          {status === 'success' && creds.length > 0 && (
            <div className="bg-green-50 border border-green-200 text-green-800 px-3 py-2 rounded-md text-[11px]" role="status">
              <p className="font-semibold">Test accounts ready</p>
              <ul className="mt-1 list-disc list-inside">
                {creds.map((c, i) => (
                  <li key={i}><span className="font-medium">{c.username}</span> — role: {c.role}</li>
                ))}
              </ul>
              <p className="mt-1">Use these to sign in; passwords are not shown here.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
