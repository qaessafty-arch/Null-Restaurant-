import { body, json, route } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/auth'
import { setLines, type LineStatus } from '@/lib/server/kitchen'

export const dynamic = 'force-dynamic'

export const POST = route(async (req) => {
  const staff = await requirePerm('kitchen.operate')
  const b = await body<{ orderId: string; lineIds?: number[]; stationId?: number; status: LineStatus }>(req)
  return json(setLines(staff, String(b.orderId ?? ''), { lineIds: Array.isArray(b.lineIds) ? b.lineIds : null, stationId: b.stationId ?? null, status: b.status }))
})
