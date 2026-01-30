/**
 * Maps country codes to predefined origin regions
 * Returns 'Other' for countries that don't belong to any specific region
 */

// Define country mappings to regions
const REGION_MAPPINGS: Record<string, string> = {
  // SADC Countries
  'ZA': 'SADC', // South Africa
  'ZW': 'SADC', // Zimbabwe
  'BW': 'SADC', // Botswana
  'MZ': 'SADC', // Mozambique
  'SZ': 'SADC', // Eswatini
  'LS': 'SADC', // Lesotho
  'NA': 'SADC', // Namibia
  'MW': 'SADC', // Malawi
  'ZM': 'SADC', // Zambia
  'AO': 'SADC', // Angola
  'MU': 'SADC', // Mauritius
  'SC': 'SADC', // Seychelles
  'KM': 'SADC', // Comoros
  'MG': 'SADC', // Madagascar
  
  // EU Countries
  'DE': 'EU', // Germany
  'FR': 'EU', // France
  'ES': 'EU', // Spain
  'IT': 'EU', // Italy
  'NL': 'EU', // Netherlands
  'BE': 'EU', // Belgium
  'AT': 'EU', // Austria
  'SE': 'EU', // Sweden
  'DK': 'EU', // Denmark
  'FI': 'EU', // Finland
  'NO': 'EU', // Norway
  'CH': 'EU', // Switzerland
  'PT': 'EU', // Portugal
  'GR': 'EU', // Greece
  'PL': 'EU', // Poland
  'CZ': 'EU', // Czech Republic
  'HU': 'EU', // Hungary
  'SK': 'EU', // Slovakia
  'SI': 'EU', // Slovenia
  'EE': 'EU', // Estonia
  'LV': 'EU', // Latvia
  'LT': 'EU', // Lithuania
  'LU': 'EU', // Luxembourg
  'MT': 'EU', // Malta
  'CY': 'EU', // Cyprus
  'BG': 'EU', // Bulgaria
  'RO': 'EU', // Romania
  'HR': 'EU', // Croatia
  
  // USA/Canada
  'US': 'USA/Canada', // United States
  'CA': 'USA/Canada', // Canada
  
  // UK/Ireland
  'GB': 'UK/Ireland', // United Kingdom
  'IE': 'UK/Ireland', // Ireland (also in EU but prioritized here)
  
  // Asia-Pacific
  'AU': 'Asia-Pacific', // Australia
  'NZ': 'Asia-Pacific', // New Zealand
  'JP': 'Asia-Pacific', // Japan
  'CN': 'Asia-Pacific', // China
  'KR': 'Asia-Pacific', // South Korea
  'SG': 'Asia-Pacific', // Singapore
  'MY': 'Asia-Pacific', // Malaysia
  'TH': 'Asia-Pacific', // Thailand
  'VN': 'Asia-Pacific', // Vietnam
  'PH': 'Asia-Pacific', // Philippines
  'ID': 'Asia-Pacific', // Indonesia
  'IN': 'Asia-Pacific', // India (could be debated, but including in Asia-Pacific)
  
  // Middle East
  'AE': 'Middle East', // United Arab Emirates
  'SA': 'Middle East', // Saudi Arabia
  'QA': 'Middle East', // Qatar
  'KW': 'Middle East', // Kuwait
  'BH': 'Middle East', // Bahrain
  'OM': 'Middle East', // Oman
  'IL': 'Middle East', // Israel
  'JO': 'Middle East', // Jordan
  'LB': 'Middle East', // Lebanon
  'TR': 'Middle East', // Turkey (transcontinental but culturally Middle Eastern)
  
  // Latin America
  'BR': 'Latin America', // Brazil
  'MX': 'Latin America', // Mexico
  'AR': 'Latin America', // Argentina
  'CL': 'Latin America', // Chile
  'PE': 'Latin America', // Peru
  'CO': 'Latin America', // Colombia
  'VE': 'Latin America', // Venezuela
  'EC': 'Latin America', // Ecuador
  'GT': 'Latin America', // Guatemala
  'CU': 'Latin America', // Cuba
  'BO': 'Latin America', // Bolivia
  'HN': 'Latin America', // Honduras
  'PY': 'Latin America', // Paraguay
  'SV': 'Latin America', // El Salvador
  'NI': 'Latin America', // Nicaragua
  'CR': 'Latin America', // Costa Rica
  'PA': 'Latin America', // Panama
  'UY': 'Latin America', // Uruguay
  
  // African countries not in SADC
  'NG': 'Other', // Nigeria
  'KE': 'Other', // Kenya
  'TZ': 'Other', // Tanzania
  'EG': 'Other', // Egypt
  'MA': 'Other', // Morocco
  'TN': 'Other', // Tunisia
  'GH': 'Other', // Ghana
  'ET': 'Other', // Ethiopia
  'UG': 'Other', // Uganda
};

/**
 * Get the origin region for a given country code
 * @param countryCode ISO 3166-1 alpha-2 country code
 * @returns The corresponding region or 'Other' if not mapped
 */
export function getRegionForCountry(countryCode: string): string {
  const code = (countryCode || '').toUpperCase().trim();
  return REGION_MAPPINGS[code] || 'Other';
}

/**
 * Get all countries mapped to a specific region
 * @param region The region name
 * @returns Array of country codes mapped to that region
 */
export function getCountriesForRegion(region: string): string[] {
  return Object.entries(REGION_MAPPINGS)
    .filter(([_, mappedRegion]) => mappedRegion === region)
    .map(([countryCode, _]) => countryCode);
}

/**
 * Check if a country belongs to a specific region
 * @param countryCode ISO 3166-1 alpha-2 country code
 * @param region The region to check against
 * @returns boolean indicating if the country belongs to the region
 */
export function isCountryInRegion(countryCode: string, region: string): boolean {
  return getRegionForCountry(countryCode) === region;
}

export default {
  getRegionForCountry,
  getCountriesForRegion,
  isCountryInRegion
};