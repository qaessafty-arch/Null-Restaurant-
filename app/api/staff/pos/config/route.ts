import { json, route } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/auth'
import { getSettings } from '@/lib/server/settings'
import { all } from '@/lib/server/db'

export const dynamic = 'force-dynamic'

/** What the POS screen needs to render: methods, currencies and the rates in force, tables. */
export const GET = route(async () => {
  await requirePerm('pos.order', 'payments.take')
  const s = getSettings()
  return json({
    baseCurrency: s.currency,
    currencies: s.acceptedCurrencies.filter((c) => c === s.currency || s.exchangeRates[c] > 0),
    rates: s.exchangeRates,
    ratesUpdatedAt: s.exchangeRatesUpdatedAt || null,
    methods: s.paymentMethods.filter((m) => m.enabled),
    maxCashierDiscountPercent: s.maxCashierDiscountPercent,
    loyalty: { enabled: s.loyaltyEnabled, pointValue: s.loyaltyPointValue, minRedeem: s.loyaltyMinRedeem, maxRedeemPercent: s.loyaltyMaxRedeemPercent },
    deliveryEnabled: s.deliveryEnabled,
    taxPercent: s.taxPercent,
    servicePercent: s.servicePercent,
    tables: all<{ id: number; number: string; location: string }>('SELECT id, number, location FROM tables WHERE active = 1 ORDER BY CAST(number AS INTEGER), number'),
  })
})
