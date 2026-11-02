import React from 'react';

/**
 * License alert banner — a red marquee with white text, shown only when the
 * property has a `license_banner_text` system config set (currently Baradzanwa).
 * Config-driven so it can be edited or removed from the DB without a deploy, and
 * never appears on properties that don't set it (e.g. Villa Gianni).
 */
export const LicenseBanner: React.FC = () => {
  const [text, setText] = React.useState<string>('');

  React.useEffect(() => {
    let live = true;
    fetch('/api/system/branding')
      .then(r => r.json())
      .then(d => {
        if (!live) return;
        const b = d?.branding || {};
        const enabled = b.license_banner_enabled;
        const msg = String(b.license_banner_text || '').trim();
        // Show when text is present and not explicitly disabled.
        if (msg && enabled !== false && enabled !== 'false') setText(msg);
      })
      .catch(() => { /* no banner if config unreachable */ });
    return () => { live = false; };
  }, []);

  if (!text) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      style={{
        background: '#dc2626',
        color: '#ffffff',
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        position: 'relative',
        height: '30px',
        lineHeight: '30px',
        fontWeight: 700,
        fontSize: '14px',
        letterSpacing: '0.02em',
        borderBottom: '1px solid #991b1b',
        zIndex: 60,
      }}
    >
      <style>{`
        @keyframes license-marquee { 0% { transform: translateX(100%); } 100% { transform: translateX(-100%); } }
        .license-marquee-track { display: inline-block; padding-left: 100%; animation: license-marquee 18s linear infinite; }
      `}</style>
      <span className="license-marquee-track">
        ⚠ {text} &nbsp;&nbsp;•&nbsp;&nbsp; ⚠ {text} &nbsp;&nbsp;•&nbsp;&nbsp; ⚠ {text}
      </span>
    </div>
  );
};

export default LicenseBanner;
