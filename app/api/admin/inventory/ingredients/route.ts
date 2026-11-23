import { ApiError, body, bool, int, json, route, str } from '@/lib/server/http'
import { audit, requirePerm } from '@/lib/server/auth'
import { get, run, tx } from '@/lib/server/db'
import { CATEGORIES, UNITS, listIngredients, move, toQty } from '@/lib/server/inventory'

export const dynamic = 'force-dynamic'

export const GET = route(async () => {
  await requirePerm('inventory.manage')
  return json({ ingredients: listIngredients() })
})

function fields(b: Record<string, unknown>) {
  const unit = str(b.unit, 'unit', { required: true, max: 3 })
  if (!(UNITS as readonly string[]).includes(unit)) throw new ApiError(400, 'Unit must be g, kg, ml, l or pcs', 'invalid')
  const category = str(b.category, 'category', { max: 20 }) || 'ingredient'
  if (!(CATEGORIES as readonly string[]).includes(category)) throw new ApiError(400, 'Invalid category', 'invalid')
  const cost = Number(b.unitCost ?? 0)
  if (!Number.isFinite(cost) || cost < 0) throw new ApiError(400, 'Cost must be zero or more', 'invalid')
  const min = toQty(b.minLevel ?? 0, 'minimum level')
  if (min < 0) throw new ApiError(400, 'Minimum level cannot be negative', 'invalid')
  const supplierId = int(b.supplierId, 'supplier', { min: 1, required: false })
  if (supplierId && !get('SELECT 1 FROM suppliers WHERE id = ?', supplierId)) throw new ApiError(400, 'Unknown supplier', 'invalid')
  return {
    name: str(b.name, 'name', { required: true, max: 80 }), sku: str(b.sku, 'SKU', { max: 40 }) || null, category, unit,
    min_level: min, unit_cost: cost, supplier_id: supplierId, track_expiry: bool(b.trackExpiry),
  }
}

export const POST = route(async (req) => {
  const staff = await requirePerm('inventory.manage')
  const b = await body(req)
  const f = fields(b)
  const id = tx(() => {
    if (get('SELECT 1 FROM ingredients WHERE name = ?', f.name)) throw new ApiError(409, 'An ingredient with that name exists', 'duplicate')
    if (f.sku && get('SELECT 1 FROM ingredients WHERE sku = ?', f.sku)) throw new ApiError(409, 'That SKU is in use', 'duplicate')
    const r = run('INSERT INTO ingredients (name, sku, category, unit, min_level, unit_cost, supplier_id, track_expiry) VALUES (?,?,?,?,?,?,?,?)',
      f.name, f.sku, f.category, f.unit, f.min_level, f.unit_cost, f.supplier_id, f.track_expiry)
    const id = Number(r.lastInsertRowid)
    // Opening stock is a recorded movement, never a silent number.
    const opening = b.openingStock === undefined || b.openingStock === '' ? 0 : toQty(b.openingStock, 'opening stock')
    if (opening < 0) throw new ApiError(400, 'Opening stock cannot be negative', 'invalid')
    if (opening > 0) move(id, opening, 'opening', { staffId: staff.id, unitCost: f.unit_cost, reason: 'Opening stock' })
    return id
  })
  audit(staff, staff.name, 'ingredient.create', f.name)
  return json({ id }, { status: 201 })
})

export const PATCH = route(async (req) => {
  const staff = await requirePerm('inventory.manage')
  const b = await body(req)
  const id = int(b.id, 'id', { min: 1 })!
  const cur = get<{ name: string; unit: string; sku: string | null }>('SELECT name, unit, sku FROM ingredients WHERE id = ?', id)
  if (!cur) throw new ApiError(404, 'Ingredient not found', 'not_found')
  if (b.active !== undefined && Object.keys(b).length === 2) {
    if (!bool(b.active) && get('SELECT 1 FROM recipe_lines WHERE ingredient_id = ?', id)) throw new ApiError(409, 'Remove it from recipes before archiving it', 'in_use')
    run('UPDATE ingredients SET active = ? WHERE id = ?', bool(b.active), id)
  } else {
    const f = fields({ unit: cur.unit, ...b })
    if (f.unit !== cur.unit && get('SELECT 1 FROM stock_movements WHERE ingredient_id = ?', id))
      throw new ApiError(409, 'The unit cannot change once stock has moved. Create a new ingredient instead.', 'unit_locked')
    if (get('SELECT 1 FROM ingredients WHERE name = ? AND id != ?', f.name, id)) throw new ApiError(409, 'An ingredient with that name exists', 'duplicate')
    if (f.sku && get('SELECT 1 FROM ingredients WHERE sku = ? AND id != ?', f.sku, id)) throw new ApiError(409, 'That SKU is in use', 'duplicate')
    run('UPDATE ingredients SET name=?, sku=?, category=?, unit=?, min_level=?, unit_cost=?, supplier_id=?, track_expiry=?, low_notified = CASE WHEN stock > ? THEN 0 ELSE low_notified END WHERE id=?',
      f.name, f.sku, f.category, f.unit, f.min_level, f.unit_cost, f.supplier_id, f.track_expiry, f.min_level, id)
  }
  audit(staff, staff.name, 'ingredient.update', String(id))
  return json({ ok: true })
})
