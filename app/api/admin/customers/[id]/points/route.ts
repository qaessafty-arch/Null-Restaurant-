import { body, int, json, route } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/auth'
import { adjustPoints } from '@/lib/server/customers'

export const dynamic = 'force-dynamic'

/** Manual points correction: managers only, with a reason, recorded in the ledger. */
export const POST = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const staff = await requirePerm('orders.override')
  const b = await body<{ points: number; reason: string }>(req)
  return json({ balance: adjustPoints(staff, int((await ctx.params).id, 'id', { min: 1 })!, b.points, b.reason) })
})
