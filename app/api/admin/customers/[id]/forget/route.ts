import { int, json, route } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/auth'
import { forgetCustomer } from '@/lib/server/customers'

export const dynamic = 'force-dynamic'

export const POST = route(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const staff = await requirePerm('orders.override')
  forgetCustomer(staff, int((await ctx.params).id, 'id', { min: 1 })!)
  return json({ ok: true })
})
