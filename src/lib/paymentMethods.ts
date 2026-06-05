/**
 * paymentMethods.ts — the single source of truth for POS payment-method identity
 * and display.
 *
 * Every report, GL posting and shift total should run raw values through
 * normalizePaymentMethod() so the front end and back end never treat
 * "card"/"swipe" or "Ecocash"/"ECOCASH" as different methods (which would
 * double-count or hide revenue). Display always goes through paymentMethodLabel().
 *
 * Canonical stored values (lowercase): cash · ecocash · swipe · room-charge · city-ledger
 */

export type CanonicalPaymentMethod =
  | 'cash' | 'ecocash' | 'swipe' | 'room-charge' | 'city-ledger' | 'unknown';

export const CANONICAL_METHODS: Exclude<CanonicalPaymentMethod, 'unknown'>[] =
  ['cash', 'ecocash', 'swipe', 'room-charge', 'city-ledger'];

// Exact aliases first (covers the known variants seen across the codebase).
const ALIASES: Record<string, CanonicalPaymentMethod> = {
  cash: 'cash', 'cash payment': 'cash',
  ecocash: 'ecocash', 'eco-cash': 'ecocash', 'eco cash': 'ecocash', eco: 'ecocash',
  'mobile money': 'ecocash', mobilemoney: 'ecocash', 'mobile-money': 'ecocash',
  swipe: 'swipe', card: 'swipe', 'credit card': 'swipe', creditcard: 'swipe',
  'credit-card': 'swipe', 'credit_card': 'swipe', 'debit card': 'swipe', 'debit-card': 'swipe',
  eft: 'swipe', pos: 'swipe', 'card/eft': 'swipe', 'card / eft': 'swipe', 'swipe (card)': 'swipe',
  'room-charge': 'room-charge', 'room charge': 'room-charge', roomcharge: 'room-charge',
  room_charge: 'room-charge', room: 'room-charge', folio: 'room-charge',
  'city-ledger': 'city-ledger', 'city ledger': 'city-ledger', cityledger: 'city-ledger',
  city_ledger: 'city-ledger', ar: 'city-ledger', 'a/r': 'city-ledger',
};

/** Collapse any raw method string into one canonical value. */
export function normalizePaymentMethod(raw: any): CanonicalPaymentMethod {
  const v = String(raw ?? '').trim().toLowerCase();
  if (!v) return 'unknown';
  if (ALIASES[v]) return ALIASES[v];
  // Tolerant contains-matching for noisy/legacy values. Order matters:
  // check 'eco' before 'cash' because "ecocash" contains "cash".
  if (v.includes('eco') || v.includes('mobile')) return 'ecocash';
  if (v.includes('cash')) return 'cash';
  if (v.includes('swipe') || v.includes('card') || v.includes('eft')) return 'swipe';
  if (v.includes('room') || v.includes('folio')) return 'room-charge';
  if (v.includes('ledger') || v.includes('city')) return 'city-ledger';
  return 'unknown';
}

const LABELS: Record<CanonicalPaymentMethod, string> = {
  cash: 'Cash',
  ecocash: 'EcoCash',
  swipe: 'Swipe',
  'room-charge': 'Room Charge',
  'city-ledger': 'City Ledger',
  unknown: 'Unrecorded',
};

/** Human label for a raw or canonical method value. */
export function paymentMethodLabel(raw: any): string {
  return LABELS[normalizePaymentMethod(raw)];
}

export default { normalizePaymentMethod, paymentMethodLabel, CANONICAL_METHODS };
