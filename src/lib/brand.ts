/**
 * Single source of truth for the property name used across all printed
 * documents, reports, and UI footers.
 *
 * Set VITE_HOTEL_NAME in the deployment's environment variables:
 *   - Villa Gianni (Render):  VITE_HOTEL_NAME="Villa Gianni"
 *   - Baradzanwa   (Vercel):  VITE_HOTEL_NAME="Baradzanwa"
 *
 * Vite replaces import.meta.env.VITE_* at build time, so this value is
 * baked into the bundle — no runtime fetch needed.
 */
export const HOTEL_NAME: string =
  (import.meta.env.VITE_HOTEL_NAME as string) || 'Villa Gianni';
