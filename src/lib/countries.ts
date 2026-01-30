export type Country = { code: string; name: string; flag?: string };

// Convert ISO 3166-1 alpha-2 code to emoji flag
export function codeToFlag(code: string): string {
  const cc = (code || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return '';
  const base = 0x1F1E6; // Regional Indicator Symbol Letter A
  const chars = [cc.charCodeAt(0) - 65 + base, cc.charCodeAt(1) - 65 + base];
  return String.fromCodePoint(...chars);
}

// Minimal fallback list to ensure dropdown works offline; will be enriched via fetch
export const DEFAULT_COUNTRIES: Country[] = [
  { code: 'US', name: 'United States' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'CA', name: 'Canada' },
  { code: 'ZA', name: 'South Africa' },
  { code: 'ZW', name: 'Zimbabwe' },
  { code: 'AU', name: 'Australia' },
  { code: 'NZ', name: 'New Zealand' },
  { code: 'DE', name: 'Germany' },
  { code: 'FR', name: 'France' },
  { code: 'ES', name: 'Spain' },
  { code: 'IT', name: 'Italy' },
  { code: 'CN', name: 'China' },
  { code: 'JP', name: 'Japan' },
  { code: 'IN', name: 'India' },
  { code: 'BR', name: 'Brazil' },
  { code: 'NG', name: 'Nigeria' },
  { code: 'KE', name: 'Kenya' },
  { code: 'TZ', name: 'Tanzania' },
  { code: 'AE', name: 'United Arab Emirates' },
  { code: 'SA', name: 'Saudi Arabia' },
  { code: 'OT', name: 'Other' },
];

export async function fetchCountries(): Promise<Country[]> {
  try {
    const res = await fetch('https://restcountries.com/v3.1/all?fields=name,cca2');
    const json = await res.json();
    if (!Array.isArray(json)) return DEFAULT_COUNTRIES.map(c => ({ ...c, flag: codeToFlag(c.code) }));
    const list: Country[] = json
      .map((r: any) => ({ code: (r?.cca2 || '').toUpperCase(), name: r?.name?.common || r?.name?.official || r?.cca2 }))
      .filter((c: Country) => /^[A-Z]{2}$/.test(c.code) && !!c.name)
      .sort((a: Country, b: Country) => a.name.localeCompare(b.name))
      .map(c => ({ ...c, flag: codeToFlag(c.code) }));
    
    // Add "Other" option at the end only if it's not already present
    const hasOther = list.some(c => c.code === 'OT');
    const otherOption: Country = { code: 'OT', name: 'Other', flag: '🏳️' };
    
    return list.length ? (hasOther ? list : [...list, otherOption]) : [...DEFAULT_COUNTRIES.map(c => ({ ...c, flag: codeToFlag(c.code) })), otherOption];
  } catch {
    // Even in error case, include the Other option
    const otherOption: Country = { code: 'OT', name: 'Other', flag: '🏳️' };
    return [...DEFAULT_COUNTRIES.map(c => ({ ...c, flag: codeToFlag(c.code) })), otherOption];
  }
}

