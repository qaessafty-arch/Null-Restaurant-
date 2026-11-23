import { body, json, route } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/auth'
import { setReservationStatus, type ResStatus } from '@/lib/server/reservations'

export const dynamic = 'force-dynamic'

export const POST = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const staff = await requirePerm('reservations.manage')
  const b = await body<{ to: ResStatus; reason?: string }>(req)
  return json({ reservation: setReservationStatus(staff, (await ctx.params).id, b.to, b.reason ?? '') })
})
