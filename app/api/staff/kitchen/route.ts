import { json, route } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/auth'
import { kitchenOrders } from '@/lib/server/orders'

export const dynamic = 'force-dynamic'

export const GET = route(async () => {
  await requirePerm('kitchen.operate')
  return json({ orders: kitchenOrders() })
})
