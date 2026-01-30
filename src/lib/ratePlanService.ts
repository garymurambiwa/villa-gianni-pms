export type SeasonKey = 'low' | 'shoulder' | 'high';

export interface RatePlanConfig {
  baseRates: Record<string, number>; // roomType -> base nightly rate
  regionAdjustments: Record<string, number>; // originRegion -> percentage multiplier (e.g., 0.15 for +15%)
  seasons: {
    key: SeasonKey;
    name: string;
    startMonthDay: string; // MM-DD (inclusive)
    endMonthDay: string;   // MM-DD (inclusive, wraps year if end < start)
    adjustment: number;    // percentage multiplier (e.g., 0.2 for +20%)
  }[];
  rateBounds?: Record<string, { min: number; max: number }>;
}

const DEFAULT_RATE_PLAN: RatePlanConfig = {
  baseRates: {
    'Standard King': 120,
    'Standard Twin': 120,
    'Deluxe Queen': 140,
    'Suite': 250,
  },
  regionAdjustments: {
    'Domestic': -0.05,
    'SADC': 0.0,
    'EU': 0.1,
    'USA/Canada': 0.15,
    'UK/Ireland': 0.1,
    'Asia-Pacific': 0.08,
    'Middle East': 0.12,
    'Latin America': 0.05,
    'Other': 0.0,
  },
  seasons: [
    { key: 'high', name: 'Festive High', startMonthDay: '12-15', endMonthDay: '01-15', adjustment: 0.2 },
    { key: 'shoulder', name: 'Winter Shoulder', startMonthDay: '06-01', endMonthDay: '08-31', adjustment: 0.1 },
    { key: 'low', name: 'Base Season', startMonthDay: '02-01', endMonthDay: '05-31', adjustment: 0.0 },
    // Note: remaining periods implicitly considered 'low' with 0 adjustment
  ],
};

const STORAGE_KEY = 'corepms_ratePlanConfig';
let __listeners: Array<(cfg: RatePlanConfig) => void> = [];
try {
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) {
      try {
        const cfg = getConfig();
        __listeners.forEach(fn => { try { fn(cfg) } catch {} });
      } catch {}
    }
  });
} catch {}

export function getConfig(): RatePlanConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_RATE_PLAN;
    const parsed = JSON.parse(raw) as RatePlanConfig;
    return parsed;
  } catch {
    return DEFAULT_RATE_PLAN;
  }
}

export function saveConfig(config: RatePlanConfig) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // noop
  }
  try { __listeners.forEach(fn => { try { fn(config) } catch {} }); } catch {}
}

function isDateInRange(date: Date, start: string, end: string): boolean {
  // start/end as MM-DD (season may wrap year)
  const [sm, sd] = start.split('-').map(Number);
  const [em, ed] = end.split('-').map(Number);
  const md = (date.getMonth() + 1) * 100 + date.getDate();
  const startMd = sm * 100 + sd;
  const endMd = em * 100 + ed;
  if (endMd >= startMd) {
    return md >= startMd && md <= endMd;
  }
  // wrap year: e.g., Dec 15 to Jan 15
  return md >= startMd || md <= endMd;
}

export function getSeasonForDate(date: Date, config: RatePlanConfig = getConfig()): SeasonKey {
  const match = config.seasons.find(s => isDateInRange(date, s.startMonthDay, s.endMonthDay));
  return match?.key ?? 'low';
}

export function computeRate(params: { roomType: string; originRegion: string; date: string | Date }, config: RatePlanConfig = getConfig()): number {
  const dateObj = typeof params.date === 'string' ? new Date(params.date) : params.date;
  const seasonKey = getSeasonForDate(dateObj, config);

  const base = config.baseRates[params.roomType] ?? 0;
  const regionAdj = config.regionAdjustments[params.originRegion] ?? 0;
  const seasonAdj = config.seasons.find(s => s.key === seasonKey)?.adjustment ?? 0;

  const computed = Math.round(base * (1 + regionAdj) * (1 + seasonAdj));
  return computed > 0 ? computed : base;
}

export function computeRateBreakdown(params: { roomType: string; originRegion: string; date: string | Date }, config: RatePlanConfig = getConfig()): { base: number; regionAdjPct: number; seasonAdjPct: number; total: number } {
  const dateObj = typeof params.date === 'string' ? new Date(params.date) : params.date;
  const seasonKey = getSeasonForDate(dateObj, config);
  const base = config.baseRates[params.roomType] ?? 0;
  const regionAdj = config.regionAdjustments[params.originRegion] ?? 0;
  const seasonAdj = config.seasons.find(s => s.key === seasonKey)?.adjustment ?? 0;
  const total = Math.round(base * (1 + regionAdj) * (1 + seasonAdj));
  return { base, regionAdjPct: regionAdj, seasonAdjPct: seasonAdj, total: total > 0 ? total : base };
}

export function listRoomTypes(config: RatePlanConfig = getConfig()): string[] {
  return Object.keys(config.baseRates || {});
}

export function getRateBounds(roomType: string, config: RatePlanConfig = getConfig()): { min: number; max: number } {
  const base = config.baseRates[roomType];
  
  // If no base rate is configured for this room type, return a reasonable default range
  if (base == null || base === 0) {
    return { min: 50, max: 1000 }; // Reasonable default range for hotels
  }
  
  const bounds = config.rateBounds?.[roomType];
  if (bounds && Number.isFinite(bounds.min) && Number.isFinite(bounds.max)) return bounds;
  const min = Math.max(0, Math.round(base * 0.5));
  const max = Math.round(base * 2);
  return { min, max };
}

export function subscribeRateConfig(fn: (cfg: RatePlanConfig) => void): () => void {
  __listeners.push(fn);
  return () => { __listeners = __listeners.filter(x => x !== fn); };
}

export function logRateAudit(entry: { type: 'calc' | 'mapping'; roomType?: string; originRegion?: string; date?: string; suggested?: number; base?: number; regionAdjPct?: number; seasonAdjPct?: number }) {
  try {
    const raw = localStorage.getItem('corepms_rateAudit');
    const list = raw ? JSON.parse(raw) : [];
    const next = [{ ts: new Date().toISOString(), ...entry }, ...list];
    localStorage.setItem('corepms_rateAudit', JSON.stringify(next.slice(0, 500)));
  } catch {}
}

export default {
  getConfig,
  saveConfig,
  getSeasonForDate,
  computeRate,
  computeRateBreakdown,
  listRoomTypes,
  getRateBounds,
  subscribeRateConfig,
  logRateAudit,
};
