import { body, json, limit, route } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/auth'
import { listPayments, takePayment, type PaymentInput } from '@/lib/server/payments'

export const dynamic = 'force-dynamic'

/** Transaction history. ?from=&to= are UTC "YYYY-MM-DD HH:MM:SS" bounds. */
export const GET = route(async (req) => {
  await requirePerm('payments.take')
  const q = new URL(req.url).searchParams
  const d = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?$/.test(v) ? v : undefined)
  return json({ payments: listPayments({ from: d(q.get('from')), to: d(q.get('to')), limit: Number(q.get('limit')) || 100 }) })
})

export const POST = route(async (req) => {
  const staff = await requirePerm('payments.take')
  limit(`pay:${staff.id}`, 60, 60_000)
  const r = takePayment(staff, await body<PaymentInput>(req))
  return json(r, { status: r.duplicate ? 200 : 201 })
})
