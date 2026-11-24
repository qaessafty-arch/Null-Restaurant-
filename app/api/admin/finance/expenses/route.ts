import { body, int, json, route } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/auth'
import { addExpense, listExpenses, parseRange, voidExpense } from '@/lib/server/finance'

export const dynamic = 'force-dynamic'

export const GET = route(async (req) => {
  await requirePerm('finance.manage', 'reports.view')
  const q = new URL(req.url).searchParams
  return json({ expenses: listExpenses(parseRange(q.get('from'), q.get('to'))) })
})

export const POST = route(async (req) => {
  const staff = await requirePerm('finance.manage')
  return json({ id: addExpense(staff, await body(req)) }, { status: 201 })
})

/** Void (expenses are never deleted). */
export const PATCH = route(async (req) => {
  const staff = await requirePerm('finance.manage')
  const b = await body<{ id: number; reason: string }>(req)
  voidExpense(staff, int(b.id, 'id', { min: 1 })!, b.reason)
  return json({ ok: true })
})
