import { body, json, limit, limitIp, route } from '@/lib/server/http'
import { createReservation, type ReservationInput } from '@/lib/server/reservations'

export const dynamic = 'force-dynamic'

/** Public booking. Staff-only fields (table, notes, source) are ignored here. */
export const POST = route(async (req) => {
  await limitIp('res-create', 10, 10 * 60_000)
  const b = await body<ReservationInput>(req)
  limit(`res-phone:${String(b.phone ?? '').replace(/\D/g, '')}`, 5, 60 * 60_000)
  const { tableId: _t, notes: _n, source: _s, ...guest } = b
  const r = createReservation(guest as ReservationInput, null)
  return json({ reservation: r.reservation, manageToken: r.manageToken }, { status: r.duplicate ? 200 : 201 })
})
