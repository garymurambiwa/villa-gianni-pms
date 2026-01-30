// Validation helpers for form inputs

export function isValidIdDocumentNumber(input: string): boolean {
  if (!input) return false;
  const trimmed = input.trim();
  if (trimmed.length < 6 || trimmed.length > 20) return false;
  // Alphanumeric with optional hyphens or spaces
  const re = /^[A-Za-z0-9][A-Za-z0-9\-\s]{4,18}[A-Za-z0-9]$/;
  return re.test(trimmed);
}

// Optional: country-specific ID/passport validation (heuristics for common formats)
export function isValidIdForNationality(input: string, nationalityCode?: string, idType?: 'ID Card' | 'Passport'): boolean {
  const base = isValidIdDocumentNumber(input);
  const code = (nationalityCode || '').toUpperCase();
  const s = (input || '').replace(/\s|\-/g, '').toUpperCase();
  if (!code || !idType) return base;
  try {
    // A few pragmatic heuristics; always fallback to base validation
    if (idType === 'Passport') {
      switch (code) {
        case 'US': // 9 chars alphanumeric
          return base && /^[A-Z0-9]{9}$/.test(s);
        case 'GB': // UK passport: 9 digits
          return base && /^\d{9}$/.test(s);
        case 'IN': // India passport: 1 letter + 7 digits
          return base && /^[A-Z]\d{7}$/.test(s);
        case 'ZA': // South Africa passports typically 9 characters
          return base && /^[A-Z0-9]{9,10}$/.test(s);
        default:
          return base;
      }
    }
    if (idType === 'ID Card') {
      switch (code) {
        case 'ZA': // SA ID: 13 digits
          return base && /^\d{13}$/.test(s);
        case 'NG': // Nigeria NIN: 11 digits
          return base && /^\d{11}$/.test(s);
        default:
          return base;
      }
    }
    return base;
  } catch { return base; }
}

// Heuristic nationality detection from ID/passport number
export function detectNationalityFromId(input: string, idType?: 'ID Card' | 'Passport'): string | undefined {
  const s = (input || '').replace(/\s|\-/g, '').toUpperCase();
  if (!s) return undefined;
  try {
    if (idType === 'Passport') {
      if (/^[A-Z]\d{7}$/.test(s)) return 'IN';
      if (/^\d{9}$/.test(s)) return 'GB';
      if (/^[A-Z0-9]{9}$/.test(s)) return 'US';
    } else if (idType === 'ID Card') {
      if (/^\d{13}$/.test(s)) return 'ZA';
      if (/^\d{11}$/.test(s)) return 'NG';
    }
    return undefined;
  } catch { return undefined; }
}
