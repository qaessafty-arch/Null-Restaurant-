import { json, route } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/auth'
import { loyaltySettings, searchCustomers } from '@/lib/server/customers'

export const dynamic = 'force-dynamic'

/** Quick lookup for the POS and waiters (masked phone unless the role manages customers). */
export const GET = route(async (req) => {
  const staff = await requirePerm('customers.view')
  return json({ customers: searchCustomers(staff, new URL(req.url).searchParams.get('q') ?? '', 8), loyalty: loyaltySettings() })
})
