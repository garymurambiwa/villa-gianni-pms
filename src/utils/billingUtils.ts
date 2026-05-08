import taxSvc from '@/lib/taxService'

export const calculateTaxBreakdown = async (amount: number, category: 'all'|'accommodation'|'pos'|'services' = 'all') => {
  return await taxSvc.calculateTaxesForAmount(amount, category)
}

export default { calculateTaxBreakdown }
