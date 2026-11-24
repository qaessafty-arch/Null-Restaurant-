/**
 * Money, shared by server and browser. Amounts are integers in a currency's minor unit
 * (IQD has none in practice, USD has cents). Conversions always use an explicit, stored rate:
 * nothing here assumes an exchange rate.
 */

export const CURRENCIES = {
  IQD: { minor: 0, symbol: 'IQD', name: 'Iraqi dinar' },
  USD: { minor: 2, symbol: '$', name: 'US dollar' },
} as const
export type Currency = keyof typeof CURRENCIES

export const isCurrency = (c: unknown): c is Currency => typeof c === 'string' && c in CURRENCIES

/** 12345 USD-cents → 123.45 */
export const toMajor = (amount: number, c: Currency) => amount / 10 ** CURRENCIES[c].minor
/** 123.45 USD → 12345 cents (rounded half away from zero) */
export const toMinor = (major: number, c: Currency) => Math.round(major * 10 ** CURRENCIES[c].minor)

/**
 * Converts a payment amount to the base currency.
 * `rate` = base major units per 1 major unit of `from` (e.g. 1310 IQD per USD).
 */
export function toBase(amount: number, from: Currency, base: Currency, rate: number) {
  if (from === base) return amount
  if (!(rate > 0)) throw new Error(`No exchange rate for ${from}`)
  return toMinor(toMajor(amount, from) * rate, base)
}

/** Base-currency amount expressed in another currency, rounded UP so it always covers the amount. */
export function fromBase(amountBase: number, to: Currency, base: Currency, rate: number) {
  if (to === base) return amountBase
  if (!(rate > 0)) throw new Error(`No exchange rate for ${to}`)
  return Math.ceil((toMajor(amountBase, base) / rate) * 10 ** CURRENCIES[to].minor - 1e-9)
}

export function formatMoney(amount: number, c: Currency | string = 'IQD', locale = 'en-US') {
  const cur = (isCurrency(c) ? c : 'IQD') as Currency
  const { minor, symbol } = CURRENCIES[cur]
  const n = toMajor(amount, cur).toLocaleString(locale, { minimumFractionDigits: minor, maximumFractionDigits: minor })
  return cur === 'USD' ? `${symbol}${n}` : `${n} ${symbol}`
}

/** Splits `total` into `parts` integer shares that add up exactly (earlier shares take the remainder). */
export function splitEvenly(total: number, parts: number) {
  const n = Math.max(1, Math.floor(parts))
  const base = Math.floor(total / n)
  return Array.from({ length: n }, (_, i) => base + (i < total - base * n ? 1 : 0))
}

/** Tax and service are charged on the subtotal after discount, rounded to whole base units. */
export function orderTotals(subtotal: number, discount: number, taxPercent: number, servicePercent: number) {
  const net = Math.max(0, subtotal - Math.min(discount, subtotal))
  const tax = Math.round((net * taxPercent) / 100)
  const service = Math.round((net * servicePercent) / 100)
  return { net, tax, service, total: net + tax + service }
}
