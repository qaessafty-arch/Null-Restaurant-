import { body, json, route } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/auth'
import { createReservation, listReservations, type ReservationInput } from '@/lib/server/reservations'
import { getSettings } from '@/lib/server/settings'
import { localDate } from '@/lib/time'

export const dynamic = 'force-dynamic'

/** ?from=YYYY-MM-DD&to=YYYY-MM-DD (restaurant-local dates, inclusive). Defaults to today. */
export const GET = route(async (req) => {
  await requirePerm('reservations.manage', 'tables.view')
  const q = new URL(req.url).searchParams
  const today = localDate(new Date(), getSettings().timezone)
  return json({ reservations: listReservations(q.get('from') ?? today, q.get('to') ?? q.get('from') ?? today), today })
})

export const POST = route(async (req) => {
  const staff = await requirePerm('reservations.manage')
  const r = createReservation(await body<ReservationInput>(req), staff)
  return json({ reservation: r.reservation }, { status: r.duplicate ? 200 : 201 })
})
