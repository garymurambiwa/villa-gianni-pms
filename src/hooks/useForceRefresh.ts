import { useEffect, useRef } from 'react';

/**
 * Force-refresh poller. Every interval it reads the server's `force_reload_token`
 * (a system config) via /api/system/branding. The first value seen becomes the
 * baseline; if the server token later CHANGES, every open client reloads once to
 * pick up a new deployment. Admins trigger a fleet-wide refresh by bumping the
 * token in the DB. Self-healing: after reload the new token is the baseline, so
 * there is no reload loop.
 */
export function useForceRefresh(intervalMs = 60000) {
  const baseline = useRef<string | null>(null);

  useEffect(() => {
    let live = true;

    const check = async () => {
      try {
        const d = await fetch('/api/system/branding', { cache: 'no-store' }).then(r => r.json());
        if (!live) return;
        const token = d?.branding?.force_reload_token;
        if (token == null) return;
        const t = String(token);
        if (baseline.current === null) {
          baseline.current = t; // first observation — establish baseline, don't reload
          return;
        }
        if (t !== baseline.current) {
          baseline.current = t;
          try {
            // Best-effort: drop caches so the fresh bundle is fetched.
            if ('caches' in window) { const keys = await caches.keys(); await Promise.all(keys.map(k => caches.delete(k))); }
          } catch { /* ignore */ }
          window.location.reload();
        }
      } catch { /* offline — retry next tick */ }
    };

    check(); // establish baseline immediately
    const id = setInterval(check, intervalMs);
    return () => { live = false; clearInterval(id); };
  }, [intervalMs]);
}

export default useForceRefresh;
