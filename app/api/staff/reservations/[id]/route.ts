import { body, json, route } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/auth'
import { reservationHistory, updateReservation, type ReservationInput } from '@/lib/server/reservations'

export const dynamic = 'force-dynamic'

export const GET = route(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  await requirePerm('reservations.manage', 'tables.view')
  return json({ history: reservationHistory((await ctx.params).id) })
})

export const PATCH = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const staff = await requirePerm('reservations.manage')
  return json({ reservation: updateReservation(staff, (await ctx.params).id, await body<Partial<ReservationInput>>(req)) })
})
