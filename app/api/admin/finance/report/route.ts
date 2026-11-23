import { json, route } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/auth'
import { parseRange, report } from '@/lib/server/finance'

export const dynamic = 'force-dynamic'

/** ?from=YYYY-MM-DD&to=YYYY-MM-DD in the restaurant's local dates (inclusive). Compared with the period before. */
export const GET = route(async (req) => {
  await requirePerm('reports.view')
  const q = new URL(req.url).searchParams
  return json(report(parseRange(q.get('from'), q.get('to'))))
})
