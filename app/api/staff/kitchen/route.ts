import { int, json, route } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/auth'
import { kitchenBoard } from '@/lib/server/kitchen'

export const dynamic = 'force-dynamic'

/** ?station=<id> shows that station's lines only; omit for the whole kitchen. */
export const GET = route(async (req) => {
  await requirePerm('kitchen.operate')
  const st = new URL(req.url).searchParams.get('station')
  return json(kitchenBoard(st ? int(st, 'station', { min: 1 }) : null))
})
