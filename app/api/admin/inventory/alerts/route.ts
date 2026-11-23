import { json, route } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/auth'
import { alerts } from '@/lib/server/inventory'

export const dynamic = 'force-dynamic'

export const GET = route(async () => {
  await requirePerm('inventory.manage')
  return json(alerts())
})
