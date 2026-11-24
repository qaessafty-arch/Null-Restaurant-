import { body, json, route } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/auth'
import { birthdaysThisWeek, createCustomer, loyaltySettings, searchCustomers } from '@/lib/server/customers'

export const dynamic = 'force-dynamic'

export const GET = route(async (req) => {
  const staff = await requirePerm('customers.view')
  const q = new URL(req.url).searchParams
  return json({ customers: searchCustomers(staff, q.get('q') ?? '', Number(q.get('limit')) || 50), birthdays: birthdaysThisWeek(), loyalty: loyaltySettings() })
})

export const POST = route(async (req) => {
  const staff = await requirePerm('customers.manage')
  return json({ id: createCustomer(staff, await body(req)) }, { status: 201 })
})
