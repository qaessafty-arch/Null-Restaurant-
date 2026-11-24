import { body, json, route } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/auth'
import { receipt } from '@/lib/server/payments'

export const dynamic = 'force-dynamic'

/** Builds a receipt and records the print (reprints are logged). */
export const POST = route(async (req) => {
  const staff = await requirePerm('payments.take', 'orders.serve')
  const b = await body<{ orderIds: string[]; paymentId?: string }>(req)
  return json(receipt(staff, { orderIds: Array.isArray(b.orderIds) ? b.orderIds : [], paymentId: b.paymentId }))
})
