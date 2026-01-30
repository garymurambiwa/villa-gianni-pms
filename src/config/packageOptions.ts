export type PackageOption = { code: string; description: string; extraCharge: number }

export const packageOptions: PackageOption[] = [
  { code: 'RO', description: 'Room Only (RO)', extraCharge: 0.00 },
  { code: 'BB', description: 'Bed & Breakfast (BB)', extraCharge: 15.00 },
  { code: 'DBB', description: 'Dinner, Bed & Breakfast (DBB)', extraCharge: 45.00 },
  { code: 'AI', description: 'All Inclusive (AI)', extraCharge: 150.00 },
]

export default packageOptions
