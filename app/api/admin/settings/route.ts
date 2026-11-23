import { ApiError, body, json, route, str } from '@/lib/server/http'
import { audit, requirePerm } from '@/lib/server/auth'
import { getSettings, setSetting, type Settings } from '@/lib/server/settings'
import { isCurrency } from '@/lib/money'

export const dynamic = 'force-dynamic'

export const GET = route(async () => {
  await requirePerm('settings.manage')
  return json({ settings: getSettings() })
})

const bool = (v: unknown, k: string) => { if (typeof v !== 'boolean') throw new ApiError(400, `${k} must be on or off`, 'invalid'); return v }
const num = (v: unknown, k: string, min: number, max: number) => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new ApiError(400, `${k} must be between ${min} and ${max}`, 'invalid')
  return v
}
const time = (v: unknown) => { if (typeof v !== 'string' || !/^([01]\d|2[0-4]):[0-5]\d$/.test(v)) throw new ApiError(400, 'Times must look like 09:30', 'invalid'); return v }

const VALIDATORS: Record<keyof Settings, (v: unknown) => unknown> = {
  restaurantName: (v) => str(v, 'restaurant name', { required: true, max: 80 }),
  tagline: (v) => str(v, 'tagline', { max: 120 }),
  description: (v) => str(v, 'description', { max: 600 }),
  logoUrl: (v) => str(v, 'logo', { max: 500 }),
  coverUrl: (v) => str(v, 'cover image', { max: 500 }),
  currency: (v) => str(v, 'currency', { required: true, max: 8 }),
  taxPercent: (v) => num(v, 'tax', 0, 50),
  servicePercent: (v) => num(v, 'service charge', 0, 50),
  timezone: (v) => { const t = str(v, 'timezone', { required: true, max: 60 }); try { new Intl.DateTimeFormat('en', { timeZone: t }) } catch { throw new ApiError(400, 'Unknown timezone', 'invalid') } return t },
  hours: (v) => {
    if (!Array.isArray(v) || v.length !== 7) throw new ApiError(400, 'Provide opening hours for all 7 days', 'invalid')
    return v.map((d) => ({ day: str(d.day, 'day', { required: true, max: 3 }), open: time(d.open), close: time(d.close), closed: bool(d.closed, 'closed') }))
  },
  orderingEnabled: (v) => bool(v, 'ordering'),
  requireVerification: (v) => bool(v, 'verification'),
  kitchenNeedsVerified: (v) => bool(v, 'kitchen rule'),
  waiterCanSkipKitchen: (v) => bool(v, 'waiter shortcut'),
  manualTableMode: (v) => { if (!['open', 'waiter_only', 'off'].includes(v as string)) throw new ApiError(400, 'Invalid table mode', 'invalid'); return v },
  verifyTtlMinutes: (v) => num(v, 'code lifetime', 5, 720),
  tableSessionHours: (v) => num(v, 'table session length', 1, 48),
  requestTypes: (v) => { if (!Array.isArray(v) || v.length > 12) throw new ApiError(400, 'Invalid request types', 'invalid'); return v.map((x) => str(x, 'request type', { required: true, max: 30 })) },
  soundAlerts: (v) => bool(v, 'sound alerts'),
  languages: (v) => { if (!Array.isArray(v) || !v.every((x) => ['EN', 'KU', 'AR'].includes(x))) throw new ApiError(400, 'Invalid languages', 'invalid'); return v },
  whatsapp: (v) => str(v, 'WhatsApp number', { max: 20 }),
  deliveryEnabled: (v) => bool(v, 'delivery'),
  notice: (v) => str(v, 'notice', { max: 200 }),
  paymentMethods: (v) => {
    if (!Array.isArray(v) || v.length < 1 || v.length > 12) throw new ApiError(400, 'Provide 1 to 12 payment methods', 'invalid')
    const ids = new Set<string>()
    const out = v.map((m) => {
      const id = str(m?.id, 'method id', { required: true, max: 24 })
      if (!/^[a-z0-9_-]+$/.test(id) || ids.has(id)) throw new ApiError(400, 'Payment method ids must be unique, lowercase', 'invalid')
      ids.add(id)
      if (!['cash', 'card', 'transfer', 'online', 'other'].includes(m.kind)) throw new ApiError(400, 'Invalid payment method kind', 'invalid')
      return { id, label: str(m.label, 'method name', { required: true, max: 40 }), kind: m.kind, enabled: bool(m.enabled, 'enabled') }
    })
    if (!out.some((m) => m.enabled)) throw new ApiError(400, 'Keep at least one payment method enabled', 'invalid')
    return out
  },
  acceptedCurrencies: (v) => {
    if (!Array.isArray(v) || !v.length || !v.every(isCurrency)) throw new ApiError(400, 'Invalid currencies', 'invalid')
    return [...new Set(v)]
  },
  exchangeRates: (v) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new ApiError(400, 'Invalid exchange rates', 'invalid')
    const out: Record<string, number> = {}
    for (const [c, r] of Object.entries(v)) {
      if (!isCurrency(c)) throw new ApiError(400, `Unknown currency ${c}`, 'invalid')
      out[c] = num(r, `${c} rate`, 0.000001, 10_000_000)
    }
    return out
  },
  exchangeRatesUpdatedAt: () => { throw new ApiError(400, 'The rate update time is recorded automatically', 'invalid') },
  maxCashierDiscountPercent: (v) => num(v, 'cashier discount limit', 0, 100),
  receiptHeader: (v) => str(v, 'receipt header', { max: 300 }),
  receiptFooter: (v) => str(v, 'receipt footer', { max: 300 }),
  kitchenDelayMinutes: (v) => num(v, 'kitchen delay warning', 3, 180),
  reservationsEnabled: (v) => bool(v, 'reservations'),
  reservationDurationMinutes: (v) => num(v, 'reservation length', 15, 480),
  reservationBufferMinutes: (v) => num(v, 'reservation buffer', 0, 120),
  reservationSlotMinutes: (v) => { const n = num(v, 'slot interval', 5, 120); if (![5, 10, 15, 20, 30, 45, 60, 90, 120].includes(n)) throw new ApiError(400, 'Slot interval must be 5, 10, 15, 20, 30, 45, 60, 90 or 120 minutes', 'invalid'); return n },
  reservationMaxParty: (v) => num(v, 'largest party', 1, 100),
  reservationLeadMinutes: (v) => num(v, 'minimum notice', 0, 7 * 24 * 60),
  reservationMaxDays: (v) => num(v, 'how far ahead', 1, 365),
  reservationAutoConfirm: (v) => bool(v, 'auto-confirm'),
  allowNegativeStock: (v) => bool(v, 'negative stock'),
  autoSoldOut: (v) => bool(v, 'automatic sold out'),
  expiryWarningDays: (v) => num(v, 'expiry warning', 0, 60),
  loyaltyEnabled: (v) => bool(v, 'loyalty'),
  loyaltyEarnPer: (v) => num(v, 'spend per point', 1, 10_000_000),
  loyaltyPointValue: (v) => num(v, 'point value', 0, 1_000_000),
  loyaltyMinRedeem: (v) => num(v, 'minimum points to redeem', 1, 1_000_000),
  loyaltyMaxRedeemPercent: (v) => num(v, 'share of a bill points can pay', 1, 100),
  loyaltyTiers: (v) => {
    if (!Array.isArray(v) || !v.length || v.length > 6) throw new ApiError(400, 'Provide 1 to 6 tiers', 'invalid')
    const tiers = v.map((t) => ({ name: str(t?.name, 'tier name', { required: true, max: 30 }), minSpend: num(t?.minSpend, 'tier spend', 0, 1e12), multiplier: num(t?.multiplier, 'tier multiplier', 0.1, 10) }))
      .sort((a, b) => a.minSpend - b.minSpend)
    if (tiers[0].minSpend !== 0) throw new ApiError(400, 'The first tier must start at 0', 'invalid')
    return tiers
  },
}

export const PUT = route(async (req) => {
  const staff = await requirePerm('settings.manage')
  const b = await body(req)
  const changed: string[] = []
  const validated: Array<[keyof Settings, unknown]> = []
  for (const [k, v] of Object.entries(b)) {
    const fn = VALIDATORS[k as keyof Settings]
    if (!fn) throw new ApiError(400, `Unknown setting: ${k}`, 'invalid')
    validated.push([k as keyof Settings, fn(v)])
  }
  for (const [k, v] of validated) { setSetting(k, v); changed.push(k) }
  if (validated.some(([k]) => k === 'exchangeRates')) setSetting('exchangeRatesUpdatedAt', new Date().toISOString())
  audit(staff, staff.name, 'settings.update', changed.join(','),
    validated.some(([k]) => k === 'exchangeRates') ? JSON.stringify(getSettings().exchangeRates) : '')
  return json({ settings: getSettings() })
})
