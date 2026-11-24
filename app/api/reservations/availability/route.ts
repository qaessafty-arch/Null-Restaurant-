import { json, limitIp, route } from '@/lib/server/http'
import { availability } from '@/lib/server/reservations'

export const dynamic = 'force-dynamic'

export const GET = route(async (req) => {
  await limitIp('res-avail', 120, 60_000)
  const q = new URL(req.url).searchParams
  return json(availability(q.get('date'), Number(q.get('party')), q.get('section')))
})
