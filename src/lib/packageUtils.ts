import { getDynamicPackageOptions, calculateDynamicMealPlanCost, getDynamicPackageLabel } from './dynamicPackageUtils';

export type PackageOption = { code: string; label: string; surcharge: number }

/**
 * Get reservation package label - tries dynamic lookup first, falls back to static options
 */
export async function getResPackageLabelAsync(res: any, fallbackCode = 'RO'): Promise<string> {
  try {
    const raw = res?.packageCode ?? res?.package_code ?? fallbackCode;
    const code = typeof raw === 'string' ? raw : fallbackCode;
    return await getDynamicPackageLabel(code);
  } catch {
    // Fallback to synchronous version
    return getResPackageLabel(res, [], fallbackCode);
  }
}

export function getResPackageLabel(res: any, options: PackageOption[], fallbackCode = 'RO'): string {
  try {
    const raw = res?.packageCode ?? res?.package_code ?? fallbackCode;
    const code = typeof raw === 'string' ? raw : fallbackCode;
    const found = options.find(p => p.code === code);
    return found ? found.label : code;
  } catch {
    return fallbackCode;
  }
}

/**
 * Compute total rate using dynamic pricing from Breakfast module when available
 */
export async function computeTotalRateAsync(
  baseRateInput: any, 
  pkgCodeInput: any, 
  adults: number = 2, 
  children: number = 0, 
  checkInDate?: Date,
  roomType?: string,
  fallbackCode = 'RO'
): Promise<number> {
  try {
    const base = Number(baseRateInput);
    const baseRate = isNaN(base) ? 0 : base;
    const codeRaw = typeof pkgCodeInput === 'string' ? pkgCodeInput : fallbackCode;
    
    // Try to calculate dynamic meal plan cost
    if (checkInDate && codeRaw !== 'RO') {
      const mealPlanCost = await calculateDynamicMealPlanCost(
        codeRaw,
        adults,
        children,
        checkInDate,
        roomType
      );
      return Math.max(0, Math.round((baseRate + mealPlanCost) * 100) / 100);
    }
    
    // Fallback to static calculation
    const options = await getDynamicPackageOptions();
    const pkg = options.find(p => p.code === codeRaw);
    const surcharge = pkg ? Number(pkg.surcharge || 0) : 0;
    const total = baseRate + (isNaN(surcharge) ? 0 : surcharge);
    return Math.max(0, Math.round(total * 100) / 100);
  } catch {
    // Ultimate fallback to synchronous version
    return computeTotalRate(baseRateInput, pkgCodeInput, [], fallbackCode);
  }
}

export function computeTotalRate(baseRateInput: any, pkgCodeInput: any, options: PackageOption[], fallbackCode = 'RO'): number {
  try {
    const base = Number(baseRateInput);
    const baseRate = isNaN(base) ? 0 : base;
    const codeRaw = typeof pkgCodeInput === 'string' ? pkgCodeInput : fallbackCode;
    const pkg = options.find(p => p.code === codeRaw);
    const surcharge = pkg ? Number(pkg.surcharge || 0) : 0;
    const total = baseRate + (isNaN(surcharge) ? 0 : surcharge);
    return Math.max(0, Math.round(total * 100) / 100);
  } catch {
    return Math.max(0, Number(baseRateInput) || 0);
  }
}

export function sanitizePackageCode(input: any, fallbackCode = 'RO'): string {
  const s = typeof input === 'string' ? input : '';
  return s ? s : fallbackCode;
}

