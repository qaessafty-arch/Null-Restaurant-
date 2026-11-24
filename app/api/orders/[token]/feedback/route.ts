import { body, json, limit, route } from '@/lib/server/http'
import { feedbackForOrder, rateOrder } from '@/lib/server/feedback'

export const dynamic = 'force-dynamic'

export const GET = route(async (_req, ctx: { params: Promise<{ token: string }> }) => json({ feedback: feedbackForOrder((await ctx.params).token) }))

/** Rate a served order. The tracking token proves the guest had the order. */
export const POST = route(async (req, ctx: { params: Promise<{ token: string }> }) => {
  const { token } = await ctx.params
  limit(`rate:${token.slice(0, 12)}`, 5, 10 * 60_000)
  return json(rateOrder(token, await body(req)), { status: 201 })
})
