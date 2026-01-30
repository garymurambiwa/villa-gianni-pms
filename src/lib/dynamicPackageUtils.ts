import { breakfastPackageService } from './breakfastPackageService';
import { PackageOption } from './packageUtils';

/**
 * Get dynamic package options by fetching current breakfast package data
 * This replaces the hardcoded packageOptions array with live data from the Breakfast module
 */
export async function getDynamicPackageOptions(): Promise<PackageOption[]> {
  try {
    const packages = await breakfastPackageService.getActivePackages();
    
    // Convert breakfast packages to package options format
    const packageOptions: PackageOption[] = packages.map(pkg => ({
      code: pkg.code,
      label: pkg.name,
      surcharge: pkg.basePrice // Use base price as the surcharge
    }));
    
    // Sort by sort order, then alphabetically
    return packageOptions.sort((a, b) => {
      const pkgA = packages.find(p => p.code === a.code);
      const pkgB = packages.find(p => p.code === b.code);
      const orderA = pkgA?.sortOrder || 0;
      const orderB = pkgB?.sortOrder || 0;
      
      if (orderA !== orderB) {
        return orderA - orderB;
      }
      return a.label.localeCompare(b.label);
    });
  } catch (error) {
    console.error('Failed to fetch dynamic package options:', error);
    // Return fallback options if fetch fails
    return [
      { code: 'RO', label: 'Room Only', surcharge: 0 },
      { code: 'BB', label: 'Bed & Breakfast', surcharge: 15 },
      { code: 'DBB', label: 'Dinner, Bed & Breakfast', surcharge: 45 }
    ];
  }
}

/**
 * Calculate dynamic meal plan cost using the Breakfast module's pricing system
 * This takes into account seasonal multipliers and package-specific pricing
 */
export async function calculateDynamicMealPlanCost(
  packageCode: string,
  adults: number,
  children: number,
  checkInDate: Date,
  roomType?: string
): Promise<number> {
  try {
    // Use the Breakfast module's calculation service
    const totalPrice = await breakfastPackageService.calculateBreakfastPrice(
      packageCode,
      adults,
      children,
      checkInDate,
      roomType
    );
    
    return Math.max(0, totalPrice);
  } catch (error) {
    console.error('Failed to calculate dynamic meal plan cost:', error);
    // Fallback to simple calculation if service fails
    const packages = await breakfastPackageService.getActivePackages();
    const pkg = packages.find(p => p.code === packageCode);
    
    if (pkg) {
      // Simple fallback calculation without seasonal rates
      const baseCost = pkg.basePrice;
      const adultCost = pkg.adultPrice * adults;
      const childCost = pkg.childPrice * children;
      return Math.max(0, baseCost + adultCost + childCost);
    }
    
    return 0;
  }
}

/**
 * Get package label with dynamic data
 */
export async function getDynamicPackageLabel(packageCode: string): Promise<string> {
  try {
    const packages = await breakfastPackageService.getActivePackages();
    const pkg = packages.find(p => p.code === packageCode);
    return pkg ? pkg.name : packageCode;
  } catch (error) {
    console.error('Failed to get dynamic package label:', error);
    return packageCode;
  }
}