import { body, json, route } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/auth'
import { setRush } from '@/lib/server/kitchen'

export const dynamic = 'force-dynamic'

export const POST = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const staff = await requirePerm('orders.serve', 'orders.override')
  const b = await body<{ rush: boolean }>(req)
  setRush(staff, (await ctx.params).id, b.rush === true)
  return json({ ok: true })
})
