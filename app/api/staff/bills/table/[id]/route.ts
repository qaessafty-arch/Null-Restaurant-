import { int, json, route } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/auth'
import { tableBill } from '@/lib/server/payments'

export const dynamic = 'force-dynamic'

export const GET = route(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  await requirePerm('payments.take', 'orders.serve')
  return json(tableBill(int((await ctx.params).id, 'table', { min: 1 })!))
})
