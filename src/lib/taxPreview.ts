export type TaxMethod = 'inclusive' | 'exclusive'

export function calcTaxBreakdown(nightlyBase: number, nights: number, ratePercent: number, method: TaxMethod, enabled: boolean) {
  const nb = isFinite(nightlyBase) ? Math.max(0, nightlyBase) : 0
  const n = isFinite(nights) ? Math.max(1, Math.floor(nights)) : 1
  const r = Math.max(0, Math.min(100, isFinite(ratePercent) ? ratePercent : 0)) / 100
  if (!enabled) {
    const subtotal = nb * n
    return { nights: n, nightlyBase: nb, subtotal, tax: 0, total: subtotal, ratePercent: r * 100 }
  }
  if (method === 'inclusive') {
    const nightlySubtotal = nb / (1 + r)
    const nightlyTax = nb - nightlySubtotal
    return { nights: n, nightlyBase: nb, subtotal: nightlySubtotal * n, tax: nightlyTax * n, total: nb * n, ratePercent: r * 100 }
  }
  const nightlyTax = nb * r
  const nightlyTotal = nb + nightlyTax
  return { nights: n, nightlyBase: nb, subtotal: nb * n, tax: nightlyTax * n, total: nightlyTotal * n, ratePercent: r * 100 }
}
