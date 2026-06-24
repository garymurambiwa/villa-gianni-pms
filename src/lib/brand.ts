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
