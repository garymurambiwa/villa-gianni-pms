import taxSvc from '@/lib/taxService'

export const calculateTaxBreakdown = async (amount: number) => {
  return await taxSvc.calculateTaxesForAmount(amount, 'all')
}

export default { calculateTaxBreakdown }
