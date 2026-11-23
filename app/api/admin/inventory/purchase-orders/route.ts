import { body, json, route } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/auth'
import { createPurchaseOrder, listPurchaseOrders } from '@/lib/server/inventory'

export const dynamic = 'force-dynamic'

export const GET = route(async () => {
  await requirePerm('inventory.manage')
  return json({ purchaseOrders: listPurchaseOrders() })
})

export const POST = route(async (req) => {
  const staff = await requirePerm('inventory.manage')
  return json({ purchaseOrder: createPurchaseOrder(staff, await body(req)) }, { status: 201 })
})
