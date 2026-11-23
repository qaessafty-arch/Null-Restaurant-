import { body, int, json, route } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/auth'
import { recipeFor, setRecipe } from '@/lib/server/inventory'

export const dynamic = 'force-dynamic'

export const GET = route(async (req) => {
  await requirePerm('inventory.manage')
  return json({ lines: recipeFor(int(new URL(req.url).searchParams.get('item'), 'item', { min: 1 })!) })
})

export const PUT = route(async (req) => {
  const staff = await requirePerm('inventory.manage')
  const b = await body<{ itemId: number; lines: Array<{ ingredientId: number; qty: number; optionId?: number | null }> }>(req)
  return json({ lines: setRecipe(staff, int(b.itemId, 'item', { min: 1 })!, b.lines) })
})
