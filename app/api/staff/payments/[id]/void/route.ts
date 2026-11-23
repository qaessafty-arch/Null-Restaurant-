import { body, json, route } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/auth'
import { voidPayment } from '@/lib/server/payments'

export const dynamic = 'force-dynamic'

export const POST = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const staff = await requirePerm('payments.refund')
  const b = await body<{ reason: string }>(req)
  return json({ payment: voidPayment(staff, (await ctx.params).id, b.reason) })
})
