import { json, route } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/auth'
import { openBills } from '@/lib/server/payments'

export const dynamic = 'force-dynamic'

/** Everything with money still due, tables that asked for the bill first. */
export const GET = route(async () => {
  await requirePerm('payments.take')
  return json({ bills: openBills() })
})
