import { ApiError, body, int, json, route } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/auth'
import { setPurchaseOrderStatus } from '@/lib/server/inventory'

export const dynamic = 'force-dynamic'

export const PATCH = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const staff = await requirePerm('inventory.manage')
  const b = await body<{ status: string }>(req)
  if (b.status !== 'ordered' && b.status !== 'cancelled') throw new ApiError(400, 'Status must be ordered or cancelled', 'invalid')
  return json({ purchaseOrder: setPurchaseOrderStatus(staff, int((await ctx.params).id, 'id', { min: 1 })!, b.status) })
})
