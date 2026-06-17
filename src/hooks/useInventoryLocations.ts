import { useEffect, useState } from 'react';

export interface InvLocation {
  id: string;
  name: string;
  location_type?: string; // 'Storage' | 'Outlet'
  is_active?: boolean;
}

/**
 * Single source of truth for inventory locations across all reports and forms.
 *
 * Replaces the hardcoded location arrays that were scattered across the report
 * components (StockSheetReport, PilferageAnalysisReport, etc.). Those arrays
 * referenced ids like 'loc_main_cellar' / 'loc_bar1' that do not exist (or are
 * inactive) in every property's DB — so the dropdowns and the reports they drove
 * came up empty. This hook fetches the live, active locations from the inventory
 * API so every property (Villa Gianni, Baradzanwa, …) shows its own stores.
 *
 * @param onlyActive  when true (default) inactive locations are filtered out
 */
export function useInventoryLocations(onlyActive: boolean = true) {
  const [locations, setLocations] = useState<InvLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/v1/inventory/locations').then(r => r.json());
        if (cancelled) return;
        if (res?.ok && Array.isArray(res.data)) {
          const list: InvLocation[] = res.data
            .filter((l: any) => (onlyActive ? l.is_active !== false : true))
            .map((l: any) => ({
              id: l.id,
              name: l.name,
              location_type: l.location_type,
              is_active: l.is_active,
            }))
            .sort((a, b) => String(a.name).localeCompare(String(b.name)));
          setLocations(list);
        } else {
          setError(res?.error || 'No locations returned');
          setLocations([]);
        }
      } catch (e: any) {
        if (!cancelled) { setError(e?.message || 'Failed to load locations'); setLocations([]); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [onlyActive]);

  return { locations, loading, error };
}
