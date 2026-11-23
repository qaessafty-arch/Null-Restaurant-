import { body, json, route } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/auth'
import { refundPayment } from '@/lib/server/payments'

export const dynamic = 'force-dynamic'

export const POST = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const staff = await requirePerm('payments.refund')
  const b = await body<{ amount?: number; reason: string; idempotencyKey: string }>(req)
  const r = refundPayment(staff, (await ctx.params).id, b)
  return json(r, { status: r.duplicate ? 200 : 201 })
})
