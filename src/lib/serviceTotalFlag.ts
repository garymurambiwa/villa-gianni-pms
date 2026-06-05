/**
 * serviceTotalFlag.ts — the pilot switch for the Service Total lifecycle.
 *
 * Default OFF. Until a manager turns it on, the POS behaves exactly as before.
 * Scoped per-device (the natural unit for piloting — enable on the Bar terminal
 * only), with an optional per-outlet allow-list for multi-terminal setups.
 */

const DEVICE_KEY = 'corepms_service_total_enabled';   // whole-terminal switch
const OUTLETS_KEY = 'corepms_service_total_outlets';   // optional ["bar", ...]

export function isServiceTotalEnabled(outlet?: string): boolean {
  try {
    if (localStorage.getItem(DEVICE_KEY) === 'true') return true;
    if (outlet) {
      const raw = localStorage.getItem(OUTLETS_KEY);
      if (raw) {
        const list = JSON.parse(raw);
        if (Array.isArray(list) && list.map((s) => String(s).toLowerCase()).includes(outlet.toLowerCase())) {
          return true;
        }
      }
    }
  } catch {
    /* any failure → default OFF */
  }
  return false;
}

export function setServiceTotalEnabled(on: boolean): void {
  try {
    localStorage.setItem(DEVICE_KEY, on ? 'true' : 'false');
  } catch {
    /* ignore */
  }
}

export default { isServiceTotalEnabled, setServiceTotalEnabled };
