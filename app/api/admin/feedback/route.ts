import { body, int, json, route } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/auth'
import { listFeedback, moderate, publicReviews } from '@/lib/server/feedback'

export const dynamic = 'force-dynamic'

export const GET = route(async (req) => {
  await requirePerm('customers.manage')
  return json({ feedback: listFeedback(new URL(req.url).searchParams.get('status') ?? undefined), summary: publicReviews(0) })
})

export const PATCH = route(async (req) => {
  const staff = await requirePerm('customers.manage')
  const b = await body<{ id: number; status?: string; reply?: string }>(req)
  moderate(staff, int(b.id, 'id', { min: 1 })!, b)
  return json({ ok: true })
})
