// Breakfast Package Types and Interfaces

export interface BreakfastPackage {
  id: string;
  code: string;
  name: string;
  description?: string;
  basePrice: number; // Base price per room/stay
  adultPrice: number; // Additional price per adult
  childPrice: number; // Additional price per child
  applicableRoomTypes: string[]; // Room types this package applies to (empty = all)
  isActive: boolean;
  sortOrder: number;
  insertedAt?: Date;
  updatedAt?: Date;
}

export interface BreakfastPackageSeasonalRate {
  id: string;
  breakfastPackageId: string;
  seasonKey: string; // 'low' | 'shoulder' | 'high'
  priceMultiplier: number; // Multiplier applied to base prices (e.g., 1.2 for +20%)
  startDate?: Date;
  endDate?: Date;
  isActive: boolean;
  insertedAt?: Date;
  updatedAt?: Date;
}

export interface ReservationBreakfastInfo {
  breakfastPackageCode: string;
  breakfastAdults: number;
  breakfastChildren: number;
  breakfastTotalPrice: number; // Calculated total breakfast price
}

export interface BreakfastPackageWithRates extends BreakfastPackage {
  seasonalRates: BreakfastPackageSeasonalRate[];
}

// Service interface for breakfast package operations
export interface BreakfastPackageService {
  getAllPackages(): Promise<BreakfastPackage[]>;
  getActivePackages(): Promise<BreakfastPackage[]>;
  getPackageByCode(code: string): Promise<BreakfastPackage | null>;
  createPackage(data: Omit<BreakfastPackage, 'id' | 'insertedAt' | 'updatedAt'>): Promise<BreakfastPackage>;
  updatePackage(id: string, data: Partial<Omit<BreakfastPackage, 'id' | 'insertedAt' | 'updatedAt'>>): Promise<BreakfastPackage>;
  deletePackage(id: string): Promise<boolean>;
  getSeasonalRates(packageId: string): Promise<BreakfastPackageSeasonalRate[]>;
  updateSeasonalRate(packageId: string, seasonKey: string, multiplier: number): Promise<BreakfastPackageSeasonalRate>;
  calculateBreakfastPrice(
    packageCode: string,
    adults: number,
    children: number,
    date: Date,
    roomType?: string
  ): Promise<number>;
  getAvailablePackagesForRoomType(roomType: string): Promise<BreakfastPackage[]>;
}

// Rate calculation context
export interface BreakfastRateCalculationContext {
  packageCode: string;
  adults: number;
  children: number;
  date: Date;
  roomType?: string;
  seasonKey?: string;
}