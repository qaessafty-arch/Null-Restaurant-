import { body, json, limitIp, route } from '@/lib/server/http'
import { cancelByGuest } from '@/lib/server/reservations'

export const dynamic = 'force-dynamic'

export const POST = route(async (req, ctx: { params: Promise<{ token: string }> }) => {
  await limitIp('res-cancel', 20, 10 * 60_000)
  const b = await body<{ reason?: string }>(req)
  return json({ reservation: cancelByGuest((await ctx.params).token, String(b.reason ?? '')) })
})
