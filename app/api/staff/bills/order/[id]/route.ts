import { json, route } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/auth'
import { orderBill } from '@/lib/server/payments'

export const dynamic = 'force-dynamic'

export const GET = route(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  await requirePerm('payments.take', 'orders.serve')
  return json(orderBill((await ctx.params).id))
})
