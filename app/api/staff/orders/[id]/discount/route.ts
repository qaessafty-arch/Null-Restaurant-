import { body, json, route } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/auth'
import { applyDiscount } from '@/lib/server/payments'

export const dynamic = 'force-dynamic'

export const POST = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const staff = await requirePerm('discounts.apply')
  const b = await body<{ kind: 'percent' | 'amount'; value: number; reason: string }>(req)
  return json(applyDiscount(staff, (await ctx.params).id, b))
})
