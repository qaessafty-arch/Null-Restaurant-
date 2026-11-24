import { body, int, json, route } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/auth'
import { customerProfile, updateCustomer } from '@/lib/server/customers'

export const dynamic = 'force-dynamic'

export const GET = route(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const staff = await requirePerm('customers.view')
  return json({ customer: customerProfile(staff, int((await ctx.params).id, 'id', { min: 1 })!) })
})

export const PATCH = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const staff = await requirePerm('customers.manage')
  const id = int((await ctx.params).id, 'id', { min: 1 })!
  updateCustomer(staff, id, await body(req))
  return json({ customer: customerProfile(staff, id) })
})
