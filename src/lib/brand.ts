/**
 * Single source of truth for the property name used across printed documents,
 * reports and UI footers. Resolved per-property so each deployment shows its own
 * brand (e.g. Baradzanwa never shows "Villa Gianni").
 *
 * Resolution order:
 *   1. Runtime branding cache (corepms_receipt_branding) — DB-backed per-property
 *      config the app loads on startup. This is authoritative.
 *   2. Build-time env var VITE_HOTEL_NAME (baked into the bundle by Vite).
 *   3. A NEUTRAL default — never a specific competitor property name.
 */
function resolveHotelName(): string {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('corepms_receipt_branding') : null;
    if (raw) {
      const b = JSON.parse(raw);
      const n = b?.restaurant_name || b?.hotel_name || b?.name;
      if (n && String(n).trim()) return String(n).trim();
    }
  } catch { /* ignore cache errors */ }
  const env = import.meta.env.VITE_HOTEL_NAME as string;
  if (env && String(env).trim()) return String(env).trim();
  return 'Property Management System';
}

export const HOTEL_NAME: string = resolveHotelName();

/** Re-resolve the name on demand (use after the branding cache is refreshed). */
export const getHotelName = (): string => resolveHotelName();

// ── DB-authoritative branding sync ───────────────────────────────────────────
// The per-property branding lives in the DB (system_configs via
// /api/system/branding), but nothing ever wrote it into the local cache — so
// resolution fell through to the build-time env var, and a stale committed
// .env.production ("Villa Gianni") branded EVERY property's printed documents.
// Sync the cache from the DB at module load so the DB always wins; printed
// documents call getHotelName() at click time and pick up the synced value.
(() => {
  if (typeof fetch === 'undefined' || typeof localStorage === 'undefined') return;
  fetch('/api/system/branding')
    .then(r => r.json())
    .then(d => {
      const b = d?.branding;
      if (!b || !String(b.hotel_name || '').trim()) return;
      let cache: any = {};
      try { cache = JSON.parse(localStorage.getItem('corepms_receipt_branding') || '{}'); } catch { /* reset */ }
      localStorage.setItem('corepms_receipt_branding', JSON.stringify({
        ...cache,
        hotel_name: String(b.hotel_name).trim(),
        restaurant_name: String(b.hotel_name).trim(),
        address: b.hotel_address ?? cache.address,
        phone: b.hotel_phone ?? cache.phone,
        footer: b.hotel_receipt_footer ?? cache.footer,
      }));
    })
    .catch(() => { /* offline — keep existing cache/env fallback */ });
})();
