import { body, int, json, route } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/auth'
import { adjustStock, movements } from '@/lib/server/inventory'

export const dynamic = 'force-dynamic'

export const GET = route(async (req) => {
  await requirePerm('inventory.manage')
  const q = new URL(req.url).searchParams
  return json({ movements: movements({ ingredientId: q.get('ingredient') ? int(q.get('ingredient'), 'ingredient', { min: 1 })! : undefined, limit: Number(q.get('limit')) || 200 }) })
})

/** Receive without a PO, adjust, record waste, or enter a stock count. */
export const POST = route(async (req) => {
  const staff = await requirePerm('inventory.manage')
  return json(adjustStock(staff, await body(req)), { status: 201 })
})
