import { ApiError, json, limitIp, route } from '@/lib/server/http'
import { byManageToken } from '@/lib/server/reservations'

export const dynamic = 'force-dynamic'

export const GET = route(async (_req, ctx: { params: Promise<{ token: string }> }) => {
  await limitIp('res-view', 120, 60_000)
  const r = byManageToken((await ctx.params).token)
  if (!r) throw new ApiError(404, 'Booking not found', 'not_found')
  return json({ reservation: r })
})
