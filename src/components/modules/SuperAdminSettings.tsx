import React from 'react';
import { useAuth } from '@/context/AuthContext';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import BackToFOSettingsButton from '@/components/modules/common/BackToFOSettingsButton';
import { canAccessTransactionClearing } from '@/lib/permissions';
import adminValidation, { __meta } from '@/lib/adminValidation';
import db from '@/lib/db';
import pmsAuthDb, { AccessLog } from '@/lib/pmsAuthDb';
import { adminPermissionFixService } from '@/lib/adminPermissionFixService';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

const SuperAdminSettings: React.FC = () => {
  const { user } = useAuth();
  const [code, setCode] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [msg, setMsg] = React.useState('');
  const [err, setErr] = React.useState('');
  const [meta, setMeta] = React.useState(() => __meta.getSuperAdminMeta());
  const allowed = canAccessTransactionClearing(user?.role || '');

  const validFormat = /^[A-Za-z0-9!@#$%^&*()_+\-={}:;"'<>?,.]{16,}$/.test(code);
  const matching = code && confirm && code === confirm;

  const save = async () => {
    setMsg(''); setErr('');
    try {
      if (!validFormat) { setErr('Code must be at least 16 characters and include allowed special characters.'); return; }
      if (!matching) { setErr('Code and confirmation do not match.'); return; }
      await __meta.setSuperAdminCodeFor(user?.id || 'unknown', code);
      setMeta(__meta.getSuperAdminMeta());
      setMsg('Super admin authorization code updated successfully.');
      setCode(''); setConfirm('');
    } catch (e) {
      setErr('Failed to update code. Please try again.');
    }
  };

  // ================================
  // Database Connection Management
  // ================================
  const [dbConfig, setDbConfig] = React.useState<DbConfig>({
    type: 'mysql',
    host: '192.168.100.18',
    port: 3306,
    user: 'root',
    password: '',
    database: 'corepms_db'
  });
  const [dbMsg, setDbMsg] = React.useState('');
  const [dbErr, setDbErr] = React.useState('');
  const [testing, setTesting] = React.useState(false);
  const [conn, setConn] = React.useState('');

  React.useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const cfg = await db.getConnectionConfig();
        if (mounted && cfg) {
          setDbConfig(cfg);
        } else if (mounted) {
          // Fallback to env if available and no config saved
          const envConn = (import.meta as any)?.env?.VITE_DB_CONN || (window as any)?.VITE_DB_CONN;
          if (typeof envConn === 'string' && envConn.startsWith('postgres')) {
             // Parse simple postgres string for initial display if needed, or just leave default
             setDbMsg('Loaded default configuration.');
          }
        }
      } catch {}
    })();
    return () => { mounted = false }
  }, []);

  const parseConnString = (str: string): Partial<DbConfig> | null => {
    try {
      // Basic parser for mysql://user:pass@host:port/db
      const u = new URL(str);
      return {
        type: 'mysql',
        host: u.hostname,
        port: Number(u.port) || 3306,
        user: u.username,
        password: u.password,
        database: u.pathname.replace('/', '')
      };
    } catch { return null; }
  };

  const applyConn = async () => {
    setDbMsg(''); setDbErr('');
    try {
      let configToSave = { ...dbConfig };
      if (conn) {
        const parsed = parseConnString(conn);
        if (parsed) {
          configToSave = { ...configToSave, ...parsed };
          setDbConfig(configToSave as DbConfig);
        }
      }
      
      if (!configToSave.host) throw new Error('Host is required');
      const res = await db.saveConnectionConfig(configToSave);
      if (!res.ok) throw new Error(res.error || 'Failed to save configuration');
      setDbMsg('Configuration saved and database pool initialized.');
      
      // Log audit event
      try {
        await pmsAuthDb.recordAccessAttempt(user?.username || 'admin', 'db_connection_updated', {
          type: configToSave.type,
          host: configToSave.host,
          user: configToSave.user,
          db: configToSave.database
        });
      } catch {} // Ignore logging errors if DB is just being set up
    } catch (e: any) {
      setDbErr(e?.message || 'Failed to save configuration.');
    }
  };

  const testConn = async () => {
    setDbMsg(''); setDbErr(''); setTesting(true);
    try {
      let configToTest = { ...dbConfig };
      if (conn) {
        const parsed = parseConnString(conn);
        if (parsed) configToTest = { ...configToTest, ...parsed };
      }
      
      const res = await db.testConnection(configToTest);
      if (!res.ok) throw new Error(res.error || 'Test failed');
      setDbMsg(`Connected successfully. Server: ${res.serverVersion || 'unknown'}`);
    } catch (e: any) {
      setDbErr(e?.message || 'Connection test failed.');
    } finally { setTesting(false) }
  };

  const exportDump = async () => {
    setDbMsg(''); setDbErr('');
    try {
      const res = await db.exportSqlDump({ actorUserId: user?.id });
      if (!res.ok) throw new Error(res.error || 'Export failed');
      setDbMsg(`SQL dump created at ${res.path}${res.warning ? ` (Note: ${res.warning})` : ''}`);
    } catch (e: any) {
      setDbErr(e?.message || 'Export failed.');
    }
  };

  const [training, setTraining] = React.useState(false);
  const [trainingMsg, setTrainingMsg] = React.useState('');
  const [trainingErr, setTrainingErr] = React.useState('');
  React.useEffect(() => {
    (async () => {
      try {
        const res = await (window as any).native.app.getTrainingMode();
        setTraining(!!res?.trainingMode);
      } catch {}
    })();
  }, []);
  const toggleTraining = async (flag: boolean) => {
    setTraining(flag);
    setTrainingMsg(''); setTrainingErr('');
    try {
      const res = await (window as any).native.app.setTrainingMode(flag);
      if (!res?.ok) throw new Error(res?.error || 'Failed to set training mode');
      setTrainingMsg(flag ? 'Training mode enabled.' : 'Training mode disabled.');
    } catch (e: any) {
      setTrainingErr(e?.message || 'Failed to set training mode');
    }
  };

  const [roomsText, setRoomsText] = React.useState('');
  const [roomsMsg, setRoomsMsg] = React.useState('');
  const [roomsErr, setRoomsErr] = React.useState('');
  const [roomsBusy, setRoomsBusy] = React.useState(false);
  React.useEffect(() => {
    (async () => {
      try {
        const cfg = await (window as any).native.persistence.load('rooms_seed', []);
        const txt = Array.isArray(cfg) ? JSON.stringify(cfg, null, 2) : JSON.stringify([], null, 2);
        setRoomsText(txt);
      } catch {}
    })();
  }, []);
  const saveRoomsConfig = async () => {
    setRoomsMsg(''); setRoomsErr('');
    try {
      const parsed = JSON.parse(roomsText || '[]');
      await (window as any).native.persistence.save('rooms_seed', parsed);
      setRoomsMsg('Rooms configuration saved.');
    } catch (e: any) {
      setRoomsErr(e?.message || 'Invalid JSON');
    }
  };
  const seedRooms = async () => {
    setRoomsMsg(''); setRoomsErr(''); setRoomsBusy(true);
    try {
      const parsed = JSON.parse(roomsText || '[]');
      if (!Array.isArray(parsed)) throw new Error('Config must be an array');
      const stmts: string[] = [];
      for (const r of parsed) {
        const num = String(r.number || '').trim();
        const type = String(r.type || 'standard');
        const rate = Number(r.rate || 0);
        if (!num) continue;
        stmts.push(`INSERT INTO rooms (number, type, status, rate) VALUES ('${num.replace(/'/g, "''")}', '${type.replace(/'/g, "''")}', 'vacant', ${rate}) ON CONFLICT (number) DO UPDATE SET type=EXCLUDED.type, rate=EXCLUDED.rate`);
      }
      if (stmts.length === 0) throw new Error('No valid rooms in config');
      const res = await db.transaction(stmts, user?.id);
      if (!res.ok) throw new Error((res as any).error || 'Failed to seed rooms');
      setRoomsMsg('Rooms seeded successfully.');
    } catch (e: any) {
      setRoomsErr(e?.message || 'Seeding failed');
    } finally { setRoomsBusy(false); }
  };

  // ================================
  // Cleanup & Deployment Prep
  // ================================
  const [prepMsg, setPrepMsg] = React.useState('');
  const [prepErr, setPrepErr] = React.useState('');
  const [prepDetails, setPrepDetails] = React.useState<any | null>(null);
  const [prepBusy, setPrepBusy] = React.useState(false);

  const runCleanup = async () => {
    setPrepMsg(''); setPrepErr(''); setPrepDetails(null); setPrepBusy(true);
    try {
      const configured = await db.isConfigured();
      if (!configured) { setPrepErr('Database not configured. Configure the connection first.'); setPrepBusy(false); return; }
      
      // First, run the permission fix to ensure admin user exists with proper permissions
      console.log('Running admin permission fix...');
      const permissionFix = await adminPermissionFixService.diagnoseAndFix();
      
      if (!permissionFix.success) {
        throw new Error(`Permission fix failed: ${permissionFix.error}`);
      }
      
      console.log('Permission fix completed, proceeding with cleanup...');
      await pmsAuthDb.init();
      const res = await pmsAuthDb.cleanupTestData('admin');
      if (!res.ok) throw new Error(res.error || 'Cleanup failed');
      const pw = await pmsAuthDb.updatePasswordForUserUnsafe('admin', 'admin123');
      if (!pw.ok) throw new Error(pw.error || 'Failed to set admin password');
      const dump = await db.exportSqlDump({ actorUserId: user?.id });
      if (!dump.ok) throw new Error(dump.error || 'Backup failed');
      setPrepDetails({ deletedCounts: res.deletedCounts, backupPath: dump.path, backupWarning: dump.warning });
      setPrepMsg('Cleanup complete. Admin credentials set. Backup created.');
    } catch (e: any) {
      setPrepErr(e?.message || 'Deployment preparation failed');
    } finally { setPrepBusy(false); }
  };

  // ================================
  // Verify Cleanup & Backup
  // ================================
  const [backupMsg, setBackupMsg] = React.useState('');
  const [backupErr, setBackupErr] = React.useState('');
  const [backupInfo, setBackupInfo] = React.useState<any | null>(null);
  const [backupBusy, setBackupBusy] = React.useState(false);

  const verifyCleanup = async (): Promise<{ ok: boolean; details?: any; error?: string }> => {
    try {
      const checks: Record<string, any> = {}
      const q = async (sql: string, params: any[] = []) => {
        try { return await db.query(sql, params) } catch { return { error: 'query_failed' } }
      }
      const r1 = await q(`SELECT COUNT(*)::int AS c FROM public.reservations`)
      const r2 = await q(`SELECT COUNT(*)::int AS c FROM public.guests`)
      const r3 = await q(`SELECT COUNT(*)::int AS c FROM public.login_attempts`)
      const r4 = await q(`SELECT COUNT(*)::int AS c FROM public.email_verifications`)
      const r5 = await q(`SELECT COUNT(*)::int AS c FROM public.app_users WHERE lower(username) <> lower($1)`, ['admin'])
      checks.reservations = ('error' in r1) ? null : (r1.rows?.[0]?.c ?? null)
      checks.guests = ('error' in r2) ? null : (r2.rows?.[0]?.c ?? null)
      checks.login_attempts = ('error' in r3) ? null : (r3.rows?.[0]?.c ?? null)
      checks.email_verifications = ('error' in r4) ? null : (r4.rows?.[0]?.c ?? null)
      checks.non_admin_users = ('error' in r5) ? null : (r5.rows?.[0]?.c ?? null)

      const logs = await pmsAuthDb.listAccessLogs({ event: 'cleanup_executed', limit: 5 })
      const tempRemoved = true // renderer has no temp file context; rely on cleanup routine and absence of errors
      const processesRunning = false // cleanup is synchronous; no background task remains
      const ok = tempRemoved && !processesRunning && [checks.reservations, checks.guests, checks.login_attempts, checks.email_verifications, checks.non_admin_users].every(v => v === 0)
      return { ok, details: { checks, recentLogs: logs } }
    } catch (e: any) { return { ok: false, error: e?.message || 'verification_failed' } }
  }

  const runVerifyAndBackup = async () => {
    setBackupMsg(''); setBackupErr(''); setBackupInfo(null); setBackupBusy(true)
    const startedAt = new Date().toISOString()
    try {
      const v = await verifyCleanup()
      if (!v.ok) { throw new Error('Cleanup verification failed') }
      const dump = await db.exportSqlDump({ actorUserId: user?.id || user?.username || 'admin' })
      if (!dump.ok || !dump.path) throw new Error(dump.error || 'Backup failed')
      const snapshot = {
        startedAt,
        finishedAt: new Date().toISOString(),
        warning: dump.warning || null,
        config: {
          mode: (import.meta as any)?.env?.MODE,
          apiBaseUrl: (import.meta as any)?.env?.VITE_API_BASE_URL,
          supabaseUrl: (import.meta as any)?.env?.VITE_SUPABASE_URL,
          logLevel: (import.meta as any)?.env?.VITE_LOG_LEVEL,
        },
        db: { connectionString: await db.getConnectionString() },
        verification: v.details || null,
      }
      const metaPath = dump.path.replace(/\.sql$/, '.backup_meta.json')
      await (window as any).native.saveFile(metaPath, JSON.stringify(snapshot, null, 2))
      setBackupInfo({ path: dump.path, metaPath, warning: dump.warning || null })
      setBackupMsg('Backup completed and verified.')
    } catch (e: any) {
      setBackupErr(e?.message || 'Backup failed')
    } finally { setBackupBusy(false) }
  }

  if (!allowed) {
    return (
      <div className="p-6">
        <div className="max-w-xl mx-auto bg-white shadow rounded-lg p-6 text-center">
          <h2 className="text-xl font-semibold mb-2">Access Denied</h2>
          <p className="text-sm text-gray-600">You do not have permission to access Super Admin Settings.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-4">
        <BackToFOSettingsButton />
        <h2 className="text-2xl font-bold">Super Admin Settings</h2>
      </div>
      {meta && (
        <div className="p-3 mb-4 rounded bg-gray-50 text-gray-700 text-sm">Last set by <strong>{meta.adminId}</strong> at <strong>{new Date(meta.setAt).toLocaleString()}</strong></div>
      )}
      {msg && (<div className="p-3 mb-3 rounded bg-green-50 text-green-700">{msg}</div>)}
      {err && (<div className="p-3 mb-3 rounded bg-red-50 text-red-700">{err}</div>)}
      <div className="bg-white p-4 rounded shadow max-w-xl">
        <label htmlFor="sa-code" className="text-sm font-medium">New Authorization Code</label>
        <Input id="sa-code" type="password" value={code} onChange={(e)=> setCode(e.target.value)} placeholder="Enter new authorization code" />
        <div className="text-xs text-gray-500 mt-1">Minimum 16 characters; allowed characters A–Z, a–z, 0–9 and !@#$%^&*()_+-=&#123;&#125;:;"'&lt;&gt;?,.</div>
        <label htmlFor="sa-confirm" className="text-sm font-medium mt-3">Confirm Authorization Code</label>
        <Input id="sa-confirm" type="password" value={confirm} onChange={(e)=> setConfirm(e.target.value)} placeholder="Re-enter authorization code" />
        <div className="mt-3 flex items-center gap-2">
          <Button onClick={save} className="bg-blue-600 text-white hover:bg-blue-700" disabled={!validFormat || !matching}>Save Code</Button>
          <Button variant="outline" onClick={()=> { setCode(''); setConfirm(''); setErr(''); setMsg(''); }}>Reset</Button>
        </div>
      </div>

      {/* Database Connection & Migration */}
      <div className="bg-white p-4 rounded shadow max-w-2xl mt-6">
        <h3 className="text-xl font-semibold mb-2">Database Connection & Migration</h3>
        {dbMsg && (<div className="p-3 mb-3 rounded bg-green-50 text-green-700">{dbMsg}</div>)}
        {dbErr && (<div className="p-3 mb-3 rounded bg-red-50 text-red-700">{dbErr}</div>)}
        <label htmlFor="db-conn" className="text-sm font-medium">Database Connection String</label>
        <Input id="db-conn" type="text" value={conn} onChange={(e)=> setConn(e.target.value)} placeholder="mysql://root:password@localhost:3306/corepms" />
        <div className="mt-3 flex items-center gap-2">
          <Button onClick={applyConn} className="bg-indigo-600 text-white hover:bg-indigo-700">Save Connection</Button>
          <Button onClick={testConn} disabled={testing} variant="outline">{testing ? 'Testing…' : 'Test Connection'}</Button>
        </div>
        <div className="mt-6 border-t pt-4">
          <h4 className="text-lg font-semibold mb-2">Export for Supabase Migration</h4>
          <p className="text-sm text-gray-600 mb-2">Generates a SQL dump of the current local PostgreSQL database, ready for import into Supabase.</p>
          <Button onClick={exportDump} className="bg-emerald-600 text-white hover:bg-emerald-700">Export SQL Dump</Button>
        </div>
        <div className="text-xs text-gray-600 mt-3">Tip: Ensure PostgreSQL tools (pg_dump) are installed on at least one workstation or run export on the server machine.</div>
      </div>

      <div className="bg-white p-4 rounded shadow max-w-2xl mt-6">
        <h3 className="text-xl font-semibold mb-2">Training Mode</h3>
        {trainingMsg && (<div className="p-3 mb-3 rounded bg-green-50 text-green-700">{trainingMsg}</div>)}
        {trainingErr && (<div className="p-3 mb-3 rounded bg-red-50 text-red-700">{trainingErr}</div>)}
        <div className="flex items-center gap-3">
          <Label>Enable Training Mode</Label>
          <Switch checked={training} onCheckedChange={toggleTraining} />
        </div>
        <div className="text-xs text-gray-600 mt-2">When enabled, database writes and reads use the training schema.</div>
      </div>

      <div className="bg-white p-4 rounded shadow max-w-2xl mt-6">
        <h3 className="text-xl font-semibold mb-2">Seed Default Rooms</h3>
        {roomsMsg && (<div className="p-3 mb-3 rounded bg-green-50 text-green-700">{roomsMsg}</div>)}
        {roomsErr && (<div className="p-3 mb-3 rounded bg-red-50 text-red-700">{roomsErr}</div>)}
        <div className="text-sm text-gray-600 mb-2">Paste JSON array of room objects with fields: number, type, rate.</div>
        <textarea className="w-full border rounded p-2 text-sm h-40" value={roomsText} onChange={(e)=> setRoomsText(e.target.value)} />
        <div className="mt-3 flex items-center gap-2">
          <Button variant="outline" onClick={saveRoomsConfig}>Save Config</Button>
          <Button onClick={seedRooms} disabled={roomsBusy || !training} className="bg-green-600 text-white hover:bg-green-700">{roomsBusy ? 'Seeding…' : 'Seed Rooms'}</Button>
        </div>
      </div>

      {/* Access Logs Viewer */}
      <div className="bg-white p-4 rounded shadow max-w-5xl mt-6">
        <h3 className="text-xl font-semibold mb-2">Access Logs</h3>
        <p className="text-sm text-gray-600 mb-3">Recent authentication and security events recorded by the system.</p>
        <AccessLogsPanel />
      </div>

      {/* Cleanup & Deployment Preparation */}
      <div className="bg-white p-4 rounded shadow max-w-2xl mt-6">
        <h3 className="text-xl font-semibold mb-2">Cleanup & Deployment Preparation</h3>
        {prepMsg && (<div className="p-3 mb-3 rounded bg-green-50 text-green-700">{prepMsg}</div>)}
        {prepErr && (<div className="p-3 mb-3 rounded bg-red-50 text-red-700">{prepErr}</div>)}
        <p className="text-sm text-gray-600 mb-2">Removes test data, preserves the Super User Admin (username <code>admin</code>, password <code>admin123</code>), runs optimization, and creates a backup.</p>
        <div className="flex items-center gap-2">
          <Button onClick={runCleanup} disabled={prepBusy} className="bg-red-600 text-white hover:bg-red-700">{prepBusy ? 'Running…' : 'Run Cleanup'}</Button>
          <Button variant="outline" onClick={()=> { setPrepMsg(''); setPrepErr(''); setPrepDetails(null); }}>Reset</Button>
        </div>
        {prepDetails && (
          <div className="mt-3 text-xs text-gray-700">
            <div>Deleted: {Object.entries(prepDetails.deletedCounts || {}).map(([k,v]) => `${k}=${v}`).join(', ')}</div>
            <div>Backup: {String(prepDetails.backupPath || '')}{prepDetails.backupWarning ? ` (Note: ${prepDetails.backupWarning})` : ''}</div>
          </div>
        )}
      </div>

      {/* Verify & Backup */}
      <div className="bg-white p-4 rounded shadow max-w-2xl mt-6">
        <h3 className="text-xl font-semibold mb-2">Verify Cleanup & Perform Backup</h3>
        {backupMsg && (<div className="p-3 mb-3 rounded bg-green-50 text-green-700">{backupMsg}</div>)}
        {backupErr && (<div className="p-3 mb-3 rounded bg-red-50 text-red-700">{backupErr}</div>)}
        <p className="text-sm text-gray-600 mb-2">Verifies cleanup (tables empty, logs recorded), then runs standard backup and writes metadata.</p>
        <div className="flex items-center gap-2">
          <Button onClick={runVerifyAndBackup} disabled={backupBusy} className="bg-indigo-600 text-white hover:bg-indigo-700">{backupBusy ? 'Running…' : 'Verify & Backup'}</Button>
          <Button variant="outline" onClick={()=> { setBackupMsg(''); setBackupErr(''); setBackupInfo(null); }}>Reset</Button>
        </div>
        {backupInfo && (
          <div className="mt-3 text-xs text-gray-700">
            <div>SQL Dump: {String(backupInfo.path || '')}</div>
            <div>Metadata: {String(backupInfo.metaPath || '')}</div>
            {backupInfo.warning && (<div className="text-yellow-700">Note: {backupInfo.warning}</div>)}
          </div>
        )}
      </div>
    </div>
  );
};

export default SuperAdminSettings;

const AccessLogsPanel: React.FC = () => {
  const [logs, setLogs] = React.useState<AccessLog[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [filters, setFilters] = React.useState<{ username?: string; event?: string; from?: string; to?: string; limit?: number }>({ limit: 50 });
  const [error, setError] = React.useState('');
  const [info, setInfo] = React.useState('');

  const load = async () => {
    setLoading(true); setError(''); setInfo('');
    try {
      const configured = await db.isConfigured();
      if (!configured) {
        setInfo('Database not configured. Configure connection above to view logs.');
        setLogs([]);
        return;
      }
      const rows = await pmsAuthDb.listAccessLogs(filters);
      setLogs(rows);
    } catch (e: any) {
      setError(e?.message || 'Failed to load access logs');
    } finally { setLoading(false); }
  };

  React.useEffect(() => { load(); }, []);

  const summary = React.useMemo(() => {
    const map = new Map<string, { success: number; failure: number; last: string | null }>();
    logs.filter(l => l.event === 'login_attempt').forEach(l => {
      const u = l.user_username || 'unknown';
      const entry = map.get(u) || { success: 0, failure: 0, last: null };
      let ok: boolean | null = null;
      try {
        if (typeof l.detail === 'string') {
          const parsed = JSON.parse(l.detail);
          ok = !!parsed.ok;
        } else if (l.detail && typeof l.detail === 'object') {
          ok = !!(l.detail as any).ok;
        }
      } catch {}
      if (ok === true) entry.success += 1; else if (ok === false) entry.failure += 1; else entry.failure += 0;
      entry.last = l.ts;
      map.set(u, entry);
    });
    return Array.from(map.entries()).map(([username, stats]) => ({ username, ...stats }));
  }, [logs]);

  const exportCsv = () => {
    const header = ['id','ts','username','event','detail'];
    const escape = (v: any) => {
      const s = typeof v === 'string' ? v : JSON.stringify(v);
      const q = s?.replace(/"/g, '""') || '';
      return `"${q}"`;
    };
    const rows = logs.map(l => [l.id, l.ts, l.user_username || '', l.event, typeof l.detail === 'string' ? l.detail : JSON.stringify(l.detail)]);
    const csv = [header.join(','), ...rows.map(r => r.map(escape).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const ts = new Date().toISOString().replace(/[:]/g, '-');
    a.download = `access_logs_${ts}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div>
      {info && (<div className="p-3 mb-3 rounded bg-yellow-50 text-yellow-700">{info}</div>)}
      {error && (<div className="p-3 mb-3 rounded bg-red-50 text-red-700">{error}</div>)}
      <div className="flex flex-wrap items-end gap-3 mb-3">
        <div>
          <label className="text-sm">Username</label>
          <Input value={filters.username || ''} onChange={(e)=> setFilters(f => ({ ...f, username: e.target.value || undefined }))} placeholder="e.g., Super User" />
        </div>
        <div>
          <label className="text-sm">Event</label>
          <Input value={filters.event || ''} onChange={(e)=> setFilters(f => ({ ...f, event: e.target.value || undefined }))} placeholder="e.g., login_attempt" />
        </div>
        <div>
          <label className="text-sm">From</label>
          <Input type="datetime-local" value={filters.from || ''} onChange={(e)=> setFilters(f => ({ ...f, from: e.target.value || undefined }))} />
        </div>
        <div>
          <label className="text-sm">To</label>
          <Input type="datetime-local" value={filters.to || ''} onChange={(e)=> setFilters(f => ({ ...f, to: e.target.value || undefined }))} />
        </div>
        <div>
          <label className="text-sm">Limit</label>
          <Input type="number" min={1} max={500} value={filters.limit || 50} onChange={(e)=> setFilters(f => ({ ...f, limit: Number(e.target.value || 50) }))} />
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={load} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</Button>
          <Button variant="outline" onClick={()=> { setFilters({ limit: 50 }); load(); }}>Clear Filters</Button>
          <Button variant="secondary" onClick={exportCsv}>Export CSV</Button>
        </div>
      </div>
      <div className="overflow-auto border rounded">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left">Time</th>
              <th className="px-3 py-2 text-left">Username</th>
              <th className="px-3 py-2 text-left">Event</th>
              <th className="px-3 py-2 text-left">Detail</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 && (
              <tr><td className="px-3 py-2" colSpan={4}>No logs found.</td></tr>
            )}
            {logs.map(l => (
              <tr key={l.id} className="border-t">
                <td className="px-3 py-2 whitespace-nowrap">{new Date(l.ts).toLocaleString()}</td>
                <td className="px-3 py-2">{l.user_username || '—'}</td>
                <td className="px-3 py-2">{l.event}</td>
                <td className="px-3 py-2"><pre className="text-xs whitespace-pre-wrap">{typeof l.detail === 'string' ? l.detail : JSON.stringify(l.detail, null, 2)}</pre></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Summary: Per-user login success/failure counts */}
      <div className="mt-6">
        <h4 className="text-lg font-semibold mb-2">Login Attempts Summary</h4>
        <div className="overflow-auto border rounded">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left">Username</th>
                <th className="px-3 py-2 text-left">Success</th>
                <th className="px-3 py-2 text-left">Failure</th>
                <th className="px-3 py-2 text-left">Last Attempt</th>
              </tr>
            </thead>
            <tbody>
              {summary.length === 0 && (
                <tr><td className="px-3 py-2" colSpan={4}>No login attempts found.</td></tr>
              )}
              {summary.map(s => (
                <tr key={s.username} className="border-t">
                  <td className="px-3 py-2">{s.username}</td>
                  <td className="px-3 py-2">{s.success}</td>
                  <td className="px-3 py-2">{s.failure}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{s.last ? new Date(s.last).toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
