import React from 'react';

/**
 * Full-screen system-block overlay. When the property sets
 * `system_block_enabled = true` (currently Baradzanwa only), this renders over
 * EVERYTHING — including the login screen — so no one can sign in. It polls the
 * server config and, when the flag is turned off, reloads to restore normal use.
 *
 * Config-driven so it can be raised/removed from the DB without a deploy and
 * never appears where it isn't set (Villa Gianni).
 */
const BYPASS_KEY = 'corepms_sysblock_bypass';

// This machine is exempt from the block when it carries the bypass flag. An admin
// sets it by opening the app with ?corebypass=1 (and clears it with ?corebypass=0).
// Lets the administrator keep ONE machine working while every other machine on the
// property shows the block.
const machineBypassed = (): boolean => {
  try {
    const href = String(window.location.href || '');
    if (/corebypass=1/.test(href)) { localStorage.setItem(BYPASS_KEY, '1'); }
    else if (/corebypass=0/.test(href)) { localStorage.removeItem(BYPASS_KEY); }
    return localStorage.getItem(BYPASS_KEY) === '1';
  } catch { return false; }
};

export const SystemBlockOverlay: React.FC = () => {
  const [blocked, setBlocked] = React.useState(false);
  const wasBlocked = React.useRef(false);
  const bypass = React.useRef(machineBypassed());

  React.useEffect(() => {
    let live = true;
    const check = async () => {
      if (bypass.current) { setBlocked(false); return; }
      try {
        const d = await fetch('/api/system/branding', { cache: 'no-store' }).then(r => r.json());
        if (!live) return;
        const v = d?.branding?.system_block_enabled;
        const on = v === true || v === 'true';
        setBlocked(on);
        // If it WAS blocking and is now cleared, reload to resume normalcy.
        if (wasBlocked.current && !on) { window.location.reload(); return; }
        wasBlocked.current = on;
      } catch { /* offline — keep current state */ }
    };
    check();
    const id = setInterval(check, 15000);
    return () => { live = false; clearInterval(id); };
  }, []);

  if (!blocked) return null;

  const reasons = [
    { title: 'License has expired', code: 'C0r3xx1' },
    { title: 'System maintenance in progress', code: 'C0r3xx2' },
    { title: 'System error', code: 'C0r3xx3' },
  ];

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label="System unavailable"
      style={{
        position: 'fixed', inset: 0, zIndex: 2147483647,
        background: 'linear-gradient(135deg, #fff7ed 0%, #ffedd5 55%, #fed7aa 100%)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
        padding: '24px', overflow: 'auto',
      }}
    >
      {/* decorative blobs */}
      <div style={{ position: 'absolute', top: '-80px', right: '-60px', width: '280px', height: '280px', borderRadius: '50%', background: 'rgba(249,115,22,0.15)' }} />
      <div style={{ position: 'absolute', bottom: '-90px', left: '-70px', width: '320px', height: '320px', borderRadius: '50%', background: 'rgba(234,88,12,0.12)' }} />

      <div style={{
        position: 'relative', width: '100%', maxWidth: '620px', background: '#ffffff',
        borderRadius: '24px', boxShadow: '0 30px 80px rgba(124,45,18,0.25)',
        padding: '40px 40px 36px', textAlign: 'center', border: '1px solid #ffe4cc',
      }}>
        {/* icon badge */}
        <div style={{
          width: '84px', height: '84px', margin: '0 auto 18px', borderRadius: '20px',
          background: 'linear-gradient(135deg, #f97316, #ea580c)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 12px 28px rgba(234,88,12,0.4)',
        }}>
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </div>

        <div style={{ fontSize: '13px', letterSpacing: '0.18em', textTransform: 'uppercase', color: '#ea580c', fontWeight: 700 }}>
          Contact System Administrator
        </div>
        <h1 style={{ fontSize: '34px', lineHeight: 1.15, fontWeight: 800, color: '#1f2937', margin: '8px 0 6px' }}>
          System Administrator
        </h1>
        <p style={{ color: '#6b7280', fontSize: '15px', margin: '0 0 22px' }}>
          Access to this system is currently unavailable. Please contact your system administrator and quote the error code below.
        </p>

        <div style={{ textAlign: 'left', display: 'grid', gap: '12px', marginBottom: '26px' }}>
          {reasons.map((r, i) => (
            <div key={r.code} style={{
              display: 'flex', alignItems: 'center', gap: '14px',
              background: '#fff7ed', border: '1px solid #ffedd5', borderRadius: '14px', padding: '14px 16px',
            }}>
              <div style={{
                flex: '0 0 auto', width: '30px', height: '30px', borderRadius: '50%',
                background: '#f97316', color: '#fff', fontWeight: 700, fontSize: '14px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>{i + 1}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, color: '#1f2937', fontSize: '15px' }}>{r.title}</div>
                <div style={{ fontSize: '12px', color: '#9ca3af' }}>Error code</div>
              </div>
              <div style={{
                fontFamily: 'ui-monospace, monospace', fontWeight: 800, fontSize: '15px',
                color: '#c2410c', background: '#ffedd5', padding: '6px 12px', borderRadius: '10px',
              }}>{r.code}</div>
            </div>
          ))}
        </div>

        <div style={{
          display: 'inline-block', background: 'linear-gradient(135deg, #f97316, #ea580c)', color: '#fff',
          fontWeight: 700, fontSize: '15px', padding: '13px 30px', borderRadius: '999px',
          boxShadow: '0 10px 24px rgba(234,88,12,0.35)',
        }}>
          Contact System Administrator
        </div>

        <div style={{ marginTop: '18px', fontSize: '12px', color: '#9ca3af' }}>
          Powered by Coredigita · This screen will clear automatically once service is restored.
        </div>
      </div>
    </div>
  );
};

export default SystemBlockOverlay;
