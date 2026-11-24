import { body, json, route } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/auth'
import { attachCustomer } from '@/lib/server/customers'

export const dynamic = 'force-dynamic'

/** Attach a customer (by id, or by phone, creating them) to an order so it earns points. */
export const POST = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const staff = await requirePerm('pos.order', 'payments.take')
  const b = await body<{ customerId?: number | null; phone?: string; name?: string }>(req)
  return json({ customerId: attachCustomer(staff, (await ctx.params).id, b) })
})
