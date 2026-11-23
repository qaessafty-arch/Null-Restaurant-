import { body, json, route, limitIp } from '@/lib/server/http'
import { priceCart, type CartLine } from '@/lib/server/orders'
import { checkCart } from '@/lib/server/inventory'

export const dynamic = 'force-dynamic'

/** Server-side price preview for the cart. Same code path as order creation. */
export const POST = route(async (req) => {
  await limitIp('quote', 120, 60_000)
  const b = await body<{ lines: CartLine[] }>(req)
  const q = priceCart(b.lines)
  checkCart(q.lines)
  return json({
    lines: q.lines.map((l) => ({ itemId: l.itemId, name: l.name, unitPrice: l.unitPrice, optionsTotal: l.optionsTotal, quantity: l.quantity, lineTotal: l.lineTotal, options: l.options })),
    subtotal: q.subtotal, tax: q.tax, service: q.service, total: q.total, estMinutes: q.estMinutes,
  })
})
