import { body, int, json, route } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/auth'
import { setTableState } from '@/lib/server/floor'

export const dynamic = 'force-dynamic'

/** Seat, clear (guests left -> cleaning), cleaned, out of service, back in service. */
export const POST = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const staff = await requirePerm('orders.serve', 'reservations.manage', 'tables.manage')
  const b = await body<{ action: 'seat' | 'clear' | 'cleaned' | 'out_of_service' | 'back_in_service' }>(req)
  setTableState(staff, int((await ctx.params).id, 'table', { min: 1 })!, b.action)
  return json({ ok: true })
})
