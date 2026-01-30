import { supabase } from '@/lib/supabaseClient';

export type DrawerModel = 'escpos_generic' | 'epson_tm_t88' | 'star_tsp100' | 'custom';

export interface DrawerConfig {
  enabled: boolean;
  printerDeviceName?: string; // OS printer name when available
  model: DrawerModel;
  ip?: string; // network printer IP (optional)
  port?: number; // default 9100
  pulseOnTimeMs?: number; // default 50
  pulseOffTimeMs?: number; // default 50
  drawerNumber?: 0 | 1; // ESC/POS: 0 or 1
  customCommandHex?: string; // optional raw hex string for custom
}

export interface PrinterConfig {
  propertyId: string;
  pos: DrawerConfig;
  frontOffice: DrawerConfig;
  updatedAt?: string;
}

const KEY = 'corepms_printer_config';

export const defaultDrawer: DrawerConfig = {
  enabled: false,
  model: 'escpos_generic',
  port: 9100,
  pulseOnTimeMs: 50,
  pulseOffTimeMs: 50,
  drawerNumber: 0,
};

export const defaultPrinterConfig = (propertyId: string): PrinterConfig => ({
  propertyId,
  pos: { ...defaultDrawer },
  frontOffice: { ...defaultDrawer },
});

export async function readPrinterConfig(propertyId: string): Promise<PrinterConfig> {
  // Prefer Supabase if configured
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('printer_configs')
        .select('data, updated_at')
        .eq('property_id', propertyId)
        .single();
      if (error) throw error;
      if (data?.data) {
        return {
          propertyId,
          pos: { ...defaultDrawer, ...(data.data.pos || {}) },
          frontOffice: { ...defaultDrawer, ...(data.data.frontOffice || {}) },
          updatedAt: data.updated_at,
        };
      }
    } catch {
      // fall through to local
    }
  }
  // Local fallback for offline mode
  try {
    const raw = localStorage.getItem(`${KEY}_${propertyId}`);
    if (raw) {
      const obj = JSON.parse(raw);
      return {
        propertyId,
        pos: { ...defaultDrawer, ...(obj.pos || {}) },
        frontOffice: { ...defaultDrawer, ...(obj.frontOffice || {}) },
        updatedAt: obj.updatedAt,
      };
    }
  } catch {}
  return defaultPrinterConfig(propertyId);
}

export async function writePrinterConfig(cfg: PrinterConfig): Promise<{ ok: boolean; error?: string }>{
  // Persist to Supabase when configured; RLS requires admin membership for write
  if (supabase) {
    try {
      const { error } = await supabase
        .from('printer_configs')
        .upsert({ property_id: cfg.propertyId, data: { pos: cfg.pos, frontOffice: cfg.frontOffice } }, { onConflict: 'property_id' });
      if (error) throw error;
    } catch (err: any) {
      // Also save locally so changes aren’t lost
      try { localStorage.setItem(`${KEY}_${cfg.propertyId}`, JSON.stringify({ pos: cfg.pos, frontOffice: cfg.frontOffice, updatedAt: new Date().toISOString() })); } catch {}
      return { ok: false, error: String(err?.message || err) };
    }
  }
  // Always save locally as a cache/fallback
  try { localStorage.setItem(`${KEY}_${cfg.propertyId}`, JSON.stringify({ pos: cfg.pos, frontOffice: cfg.frontOffice, updatedAt: new Date().toISOString() })); } catch {}
  return { ok: true };
}

export function getModelLabel(model: DrawerModel): string {
  switch (model) {
    case 'escpos_generic': return 'Generic ESC/POS';
    case 'epson_tm_t88': return 'Epson TM-T88';
    case 'star_tsp100': return 'Star TSP100';
    case 'custom': return 'Custom (Hex)';
    default: return 'Unknown';
  }
}
