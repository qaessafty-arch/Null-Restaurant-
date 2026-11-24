import { body, json, route } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/auth'
import { redeemPoints } from '@/lib/server/customers'
import { orderBill } from '@/lib/server/payments'

export const dynamic = 'force-dynamic'

/** Use loyalty points as a discount on this order; points: 0 undoes it. */
export const POST = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const staff = await requirePerm('payments.take')
  const id = (await ctx.params).id
  const b = await body<{ points: number }>(req)
  redeemPoints(staff, id, b.points)
  return json(orderBill(id))
})
