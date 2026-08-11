/**
 * Short display IDs for long UUID primary keys (folios, guests, reservations).
 * The full id stays the source of truth in state/DB; we only shorten for display.
 */

/** First 5 alphanumeric chars, uppercased, prefixed with # — e.g. '#72DC9'. */
export const formatShortId = (id: string | null | undefined, len = 5): string => {
  const clean = String(id ?? '').replace(/[^a-zA-Z0-9]/g, '');
  if (!clean) return '#—';
  return '#' + clean.slice(0, len).toUpperCase();
};

/** Bare short code without the # (for filenames, titles). */
export const shortCode = (id: string | null | undefined, len = 5): string =>
  String(id ?? '').replace(/[^a-zA-Z0-9]/g, '').slice(0, len).toUpperCase();

/**
 * Match a search term against an id by BOTH the full value and its 5-char short
 * prefix, so lookups work whether the user types the UUID or '#72dc9' / '72DC9'.
 */
export const matchesId = (id: string | null | undefined, term: string): boolean => {
  const q = String(term ?? '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  if (!q) return true;
  const full = String(id ?? '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  return full.includes(q) || full.slice(0, 5).startsWith(q);
};
