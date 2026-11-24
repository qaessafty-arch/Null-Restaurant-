import { body, int, json, route } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/auth'
import { receivePurchaseOrder } from '@/lib/server/inventory'

export const dynamic = 'force-dynamic'

export const POST = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const staff = await requirePerm('inventory.manage')
  const b = await body<{ lines: Array<{ lineId: number; qty: number; unitCost?: number; expiresOn?: string | null }> }>(req)
  return json({ purchaseOrder: receivePurchaseOrder(staff, int((await ctx.params).id, 'id', { min: 1 })!, b.lines) })
})
