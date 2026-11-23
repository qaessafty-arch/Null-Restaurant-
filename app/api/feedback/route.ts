import { body, json, limitIp, route } from '@/lib/server/http'
import { publicReviews, submitReview } from '@/lib/server/feedback'

export const dynamic = 'force-dynamic'

/** Published reviews and the real average of all ratings received. */
export const GET = route(async () => json(publicReviews(12), { headers: { 'Cache-Control': 'no-store' } }))

/** A website review: stored as pending until a manager publishes it. */
export const POST = route(async (req) => {
  await limitIp('review', 5, 60 * 60_000)
  return json(submitReview(await body(req)), { status: 201 })
})
