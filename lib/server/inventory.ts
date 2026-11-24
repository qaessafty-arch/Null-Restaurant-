import 'server-only'
import { all, get, run, tx } from './db'
import { ApiError } from './http'
import { audit, type Staff } from './auth'
import { publish } from './events'
import { getSettings } from './settings'
import { notify } from './notify'
import type { PricedLine } from './orders'

/**
 * Inventory. Quantities are integer thousandths of each ingredient's unit (1.5 kg = 1500 in a "kg"
 * ingredient; 150 g = 150000 in a "g" ingredient). Stock changes only through move(), which writes an
 * auditable stock_movements row, keeps expiry batches, maintains the weighted average cost, raises a
 * low-stock alert once per crossing, and refuses to go below zero unless the restaurant allows it.
 */

export const K = 1000
export const UNITS = ['g', 'kg', 'ml', 'l', 'pcs'] as const
export const CATEGORIES = ['ingredient', 'packaging', 'drink', 'finished', 'cleaning', 'other'] as const
export type MoveKind = 'sale' | 'sale_reversal' | 'purchase' | 'adjustment' | 'waste' | 'count' | 'opening'

export const toQty = (n: unknown, field = 'quantity') => {
  const v = typeof n === 'string' ? Number(n) : n
  if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > 1e9) throw new ApiError(400, `${field} must be a number`, 'invalid')
  return Math.round(v * K)
}
export const fromQty = (q: number) => Math.round(q) / K
const iso = (s: string | null) => (s ? s.replace(' ', 'T') + 'Z' : null)

type Ing = { id: number; name: string; unit: string; stock: number; min_level: number; unit_cost: number; low_notified: number; active: number; track_expiry: number }

function ingredient(id: number) {
  const i = get<Ing>('SELECT id, name, unit, stock, min_level, unit_cost, low_notified, active, track_expiry FROM ingredients WHERE id = ?', id)
  if (!i) throw new ApiError(404, 'Ingredient not found', 'not_found')
  return i
}
const fmt = (q: number, unit: string) => `${fromQty(q).toLocaleString('en-US', { maximumFractionDigits: 3 })} ${unit}`

/** The single way stock changes. Call inside a transaction. Returns the new balance. */
export function move(ingredientId: number, change: number, kind: MoveKind, o: {
  reason?: string; unitCost?: number; orderId?: number | null; poId?: number | null; staffId?: number | null; expiresOn?: string | null
} = {}) {
  if (!Number.isInteger(change) || change === 0) return null
  const i = ingredient(ingredientId)
  const s = getSettings()
  const next = i.stock + change
  if (change < 0 && next < 0 && !s.allowNegativeStock)
    throw new ApiError(409, `Not enough ${i.name}: ${fmt(i.stock, i.unit)} left, ${fmt(-change, i.unit)} needed`, 'out_of_stock')

  let cost = i.unit_cost
  if (kind === 'purchase' && change > 0) {
    const incoming = o.unitCost ?? i.unit_cost
    const have = Math.max(i.stock, 0)
    cost = have + change > 0 ? (have * i.unit_cost + change * incoming) / (have + change) : incoming
    cost = Math.round(cost * 10000) / 10000
  }
  run('UPDATE ingredients SET stock = ?, unit_cost = ? WHERE id = ?', next, cost, i.id)

  if (change > 0 && o.expiresOn) {
    run('INSERT INTO stock_batches (ingredient_id, qty_remaining, expires_on, po_id) VALUES (?,?,?,?)', i.id, change, o.expiresOn, o.poId ?? null)
  } else if (change < 0) {
    // Use the batches closest to expiry first.
    let need = -change
    for (const b of all<{ id: number; qty_remaining: number }>('SELECT id, qty_remaining FROM stock_batches WHERE ingredient_id = ? AND qty_remaining > 0 ORDER BY expires_on, id', i.id)) {
      if (need <= 0) break
      const take = Math.min(need, b.qty_remaining)
      run('UPDATE stock_batches SET qty_remaining = qty_remaining - ? WHERE id = ?', take, b.id)
      need -= take
    }
  }

  run(`INSERT INTO stock_movements (ingredient_id, change, balance_after, kind, reason, unit_cost, order_id, po_id, staff_id) VALUES (?,?,?,?,?,?,?,?,?)`,
    i.id, change, next, kind, (o.reason ?? '').slice(0, 300), kind === 'purchase' ? (o.unitCost ?? i.unit_cost) : i.unit_cost,
    o.orderId ?? null, o.poId ?? null, o.staffId ?? null)

  if (i.min_level > 0 && next <= i.min_level && !i.low_notified) {
    run('UPDATE ingredients SET low_notified = 1 WHERE id = ?', i.id)
    const msg = `${fmt(next, i.unit)} left (minimum ${fmt(i.min_level, i.unit)})`
    notify('inventory', 'low_stock', `Low stock: ${i.name}`, msg)
    notify('admin', 'low_stock', `Low stock: ${i.name}`, msg)
  } else if (next > i.min_level && i.low_notified) run('UPDATE ingredients SET low_notified = 0 WHERE id = ?', i.id)
  return next
}

// ---------------------------------------------------------------- recipes -> requirements

type Need = Map<number, number>
const add = (m: Need, id: number, q: number) => m.set(id, (m.get(id) ?? 0) + q)

/** Ingredients an order uses: item recipes x quantity, plus recipes of the options picked. */
function needsForOrder(orderId: number): Need {
  const m: Need = new Map()
  for (const r of all<{ ingredient_id: number; q: number }>(
    `SELECT rl.ingredient_id, SUM(rl.qty * oi.quantity) q FROM order_items oi JOIN recipe_lines rl ON rl.item_id = oi.item_id AND rl.option_id IS NULL
     WHERE oi.order_id = ? GROUP BY rl.ingredient_id`, orderId)) add(m, r.ingredient_id, r.q)
  for (const r of all<{ ingredient_id: number; q: number }>(
    `SELECT rl.ingredient_id, SUM(rl.qty * oi.quantity) q FROM order_item_options oio JOIN order_items oi ON oi.id = oio.order_item_id
     JOIN recipe_lines rl ON rl.option_id = oio.option_id AND rl.item_id = oi.item_id WHERE oi.order_id = ? GROUP BY rl.ingredient_id`, orderId)) add(m, r.ingredient_id, r.q)
  return m
}

/** Same, for a cart that is not yet an order (used to warn the guest early). */
function needsForLines(lines: PricedLine[]): Need {
  const m: Need = new Map()
  if (!lines.length) return m
  const items = [...new Set(lines.map((l) => l.itemId))]
  const rows = all<{ item_id: number; option_id: number | null; ingredient_id: number; qty: number }>(
    `SELECT item_id, option_id, ingredient_id, qty FROM recipe_lines WHERE item_id IN (${items.map(() => '?').join(',')})`, ...items)
  for (const l of lines) {
    const picked = new Set(l.options.map((o) => o.id))
    for (const r of rows) if (r.item_id === l.itemId && (r.option_id === null || picked.has(r.option_id))) add(m, r.ingredient_id, r.qty * l.quantity)
  }
  return m
}

/** Throws out_of_stock if the cart cannot be made from what is in stock (advisory: deduction re-checks). */
export function checkCart(lines: PricedLine[]) {
  if (getSettings().allowNegativeStock) return
  for (const [id, q] of needsForLines(lines)) {
    if (q <= 0) continue
    const i = get<{ name: string; stock: number }>('SELECT name, stock FROM ingredients WHERE id = ?', id)
    if (i && i.stock < q) throw new ApiError(409, `Sorry, we are running out of ${i.name}. Please choose something else.`, 'out_of_stock')
  }
}

/** Deducts an order's ingredients once (when it goes to the kitchen). Call inside the order's transaction. */
export function consumeForOrder(orderId: number, staffId: number | null) {
  const o = get<{ number: number; stock_deducted_at: string | null }>('SELECT number, stock_deducted_at FROM orders WHERE id = ?', orderId)
  if (!o || o.stock_deducted_at) return
  const touched: number[] = []
  for (const [id, q] of needsForOrder(orderId)) {
    if (q <= 0) continue
    move(id, -q, 'sale', { orderId, staffId, reason: `ORD-${o.number}` })
    touched.push(id)
  }
  run(`UPDATE orders SET stock_deducted_at = datetime('now') WHERE id = ?`, orderId)
  refreshAvailability(touched)
}

/** Puts back what an order took (cancelled before anything was cooked). Call inside the transaction. */
export function reverseForOrder(orderId: number, staffId: number | null) {
  const o = get<{ number: number; stock_deducted_at: string | null }>('SELECT number, stock_deducted_at FROM orders WHERE id = ?', orderId)
  if (!o || !o.stock_deducted_at) return
  const touched: number[] = []
  for (const r of all<{ ingredient_id: number; net: number }>(
    `SELECT ingredient_id, SUM(change) net FROM stock_movements WHERE order_id = ? AND kind IN ('sale','sale_reversal') GROUP BY ingredient_id`, orderId)) {
    if (r.net >= 0) continue
    move(r.ingredient_id, -r.net, 'sale_reversal', { orderId, staffId, reason: `ORD-${o.number} cancelled before cooking` })
    touched.push(r.ingredient_id)
  }
  run('UPDATE orders SET stock_deducted_at = NULL WHERE id = ?', orderId)
  refreshAvailability(touched)
}

/**
 * Dishes whose recipe cannot be made right now are marked sold out (auto_soldout = 1), and come back
 * when restocked. A dish someone marked sold out by hand is never switched back on here.
 */
export function refreshAvailability(ingredientIds: number[]) {
  if (!ingredientIds.length || !getSettings().autoSoldOut) return
  const items = all<{ id: number; name_en: string; available: number; auto_soldout: number }>(
    `SELECT DISTINCT i.id, i.name_en, i.available, i.auto_soldout FROM items i JOIN recipe_lines rl ON rl.item_id = i.id AND rl.option_id IS NULL
     WHERE rl.ingredient_id IN (${ingredientIds.map(() => '?').join(',')})`, ...ingredientIds)
  let changed = false
  for (const it of items) {
    const short = get<{ name: string }>(
      `SELECT g.name FROM recipe_lines rl JOIN ingredients g ON g.id = rl.ingredient_id
       WHERE rl.item_id = ? AND rl.option_id IS NULL AND g.stock < rl.qty LIMIT 1`, it.id)
    if (short && it.available) {
      run('UPDATE items SET available = 0, auto_soldout = 1 WHERE id = ?', it.id)
      notify('inventory', 'soldout', `${it.name_en} is sold out`, `Out of ${short.name}`)
      notify('admin', 'soldout', `${it.name_en} is sold out`, `Out of ${short.name}`)
      changed = true
    } else if (!short && !it.available && it.auto_soldout) {
      run('UPDATE items SET available = 1, auto_soldout = 0 WHERE id = ?', it.id)
      changed = true
    }
  }
  if (changed) publish('staff', 'menu', {})
}

// ---------------------------------------------------------------- read models

export function listIngredients() {
  const s = getSettings()
  const soon = new Date(Date.now() + s.expiryWarningDays * 86400000).toISOString().slice(0, 10)
  return all<Ing & { sku: string | null; category: string; supplier_id: number | null; supplier: string | null; used_by: number; next_expiry: string | null; expiring: number }>(
    `SELECT g.*, sp.name AS supplier,
       (SELECT COUNT(DISTINCT item_id) FROM recipe_lines WHERE ingredient_id = g.id) AS used_by,
       (SELECT MIN(expires_on) FROM stock_batches WHERE ingredient_id = g.id AND qty_remaining > 0) AS next_expiry,
       (SELECT COALESCE(SUM(qty_remaining), 0) FROM stock_batches WHERE ingredient_id = g.id AND qty_remaining > 0 AND expires_on <= ?) AS expiring
     FROM ingredients g LEFT JOIN suppliers sp ON sp.id = g.supplier_id ORDER BY g.active DESC, g.name`, soon,
  ).map((g) => ({
    id: g.id, name: g.name, sku: g.sku, category: g.category, unit: g.unit, stock: fromQty(g.stock), minLevel: fromQty(g.min_level),
    unitCost: g.unit_cost, value: Math.round(Math.max(g.stock, 0) / K * g.unit_cost), supplierId: g.supplier_id, supplier: g.supplier,
    trackExpiry: !!g.track_expiry, active: !!g.active, low: g.min_level > 0 && g.stock <= g.min_level, out: g.stock <= 0,
    usedBy: g.used_by, nextExpiry: g.next_expiry, expiringQty: fromQty(g.expiring),
  }))
}

export function movements(f: { ingredientId?: number; limit?: number } = {}) {
  return all<{ id: number; ingredient_id: number; name: string; unit: string; change: number; balance_after: number; kind: string; reason: string; unit_cost: number; order_number: number | null; po_number: number | null; staff: string | null; created_at: string }>(
    `SELECT m.*, g.name, g.unit, o.number AS order_number, p.number AS po_number, s.name AS staff FROM stock_movements m
     JOIN ingredients g ON g.id = m.ingredient_id LEFT JOIN orders o ON o.id = m.order_id
     LEFT JOIN purchase_orders p ON p.id = m.po_id LEFT JOIN staff s ON s.id = m.staff_id
     ${f.ingredientId ? 'WHERE m.ingredient_id = ?' : ''} ORDER BY m.id DESC LIMIT ?`,
    ...(f.ingredientId ? [f.ingredientId] : []), Math.min(f.limit ?? 200, 1000),
  ).map((m) => ({
    id: m.id, ingredientId: m.ingredient_id, ingredient: m.name, unit: m.unit, change: fromQty(m.change), balance: fromQty(m.balance_after),
    kind: m.kind, reason: m.reason, value: Math.round(Math.abs(m.change) / K * m.unit_cost), order: m.order_number ? `ORD-${m.order_number}` : null,
    po: m.po_number ? `PO-${m.po_number}` : null, by: m.staff, at: iso(m.created_at),
  }))
}

/** Low stock and expiring batches. Raises an expiry alert once per batch. */
export function alerts() {
  const s = getSettings()
  const soon = new Date(Date.now() + s.expiryWarningDays * 86400000).toISOString().slice(0, 10)
  const expiring = all<{ id: number; ingredient: string; unit: string; qty_remaining: number; expires_on: string; warned_at: string | null }>(
    `SELECT b.id, g.name AS ingredient, g.unit, b.qty_remaining, b.expires_on, b.warned_at FROM stock_batches b JOIN ingredients g ON g.id = b.ingredient_id
     WHERE b.qty_remaining > 0 AND b.expires_on <= ? ORDER BY b.expires_on`, soon)
  const fresh = expiring.filter((b) => !b.warned_at)
  if (fresh.length) tx(() => {
    for (const b of fresh) {
      if (!run(`UPDATE stock_batches SET warned_at = datetime('now') WHERE id = ? AND warned_at IS NULL`, b.id).changes) continue
      const today = new Date().toISOString().slice(0, 10)
      notify('inventory', 'expiry', `${b.ingredient} ${b.expires_on < today ? 'has expired' : `expires ${b.expires_on}`}`, fmt(b.qty_remaining, b.unit))
    }
  })
  const low = listIngredients().filter((g) => g.active && g.low)
  return {
    low,
    expiring: expiring.map((b) => ({ batchId: b.id, ingredient: b.ingredient, unit: b.unit, qty: fromQty(b.qty_remaining), expiresOn: b.expires_on, expired: b.expires_on < new Date().toISOString().slice(0, 10) })),
  }
}

export function recipeFor(itemId: number) {
  return all<{ id: number; option_id: number | null; option_name: string | null; ingredient_id: number; ingredient: string; unit: string; qty: number; unit_cost: number }>(
    `SELECT rl.id, rl.option_id, o.name_en AS option_name, rl.ingredient_id, g.name AS ingredient, g.unit, rl.qty, g.unit_cost
     FROM recipe_lines rl JOIN ingredients g ON g.id = rl.ingredient_id LEFT JOIN options o ON o.id = rl.option_id
     WHERE rl.item_id = ? ORDER BY rl.option_id IS NOT NULL, o.name_en, g.name`, itemId,
  ).map((r) => ({ optionId: r.option_id, option: r.option_name, ingredientId: r.ingredient_id, ingredient: r.ingredient, unit: r.unit, qty: fromQty(r.qty), cost: Math.round(r.qty / K * r.unit_cost) }))
}

// ---------------------------------------------------------------- writes

export function setRecipe(staff: Staff, itemId: number, lines: Array<{ ingredientId: number; qty: number; optionId?: number | null }>) {
  if (!Array.isArray(lines) || lines.length > 60) throw new ApiError(400, 'Invalid recipe', 'invalid')
  tx(() => {
    if (!get('SELECT 1 FROM items WHERE id = ?', itemId)) throw new ApiError(404, 'Item not found', 'not_found')
    const seen = new Set<string>()
    const rows = lines.map((l) => {
      const ingredientId = Number(l.ingredientId)
      const optionId = l.optionId ? Number(l.optionId) : null
      if (!get('SELECT 1 FROM ingredients WHERE id = ?', ingredientId)) throw new ApiError(400, 'Unknown ingredient', 'invalid')
      if (optionId && !get('SELECT 1 FROM options o JOIN option_groups g ON g.id = o.group_id WHERE o.id = ? AND g.item_id = ?', optionId, itemId))
        throw new ApiError(400, 'That option does not belong to this dish', 'invalid')
      const qty = toQty(l.qty)
      if (qty === 0) throw new ApiError(400, 'Quantities cannot be zero', 'invalid')
      if (qty < 0 && !optionId) throw new ApiError(400, 'Only option lines can remove an ingredient', 'invalid')
      const k = `${optionId ?? 0}:${ingredientId}`
      if (seen.has(k)) throw new ApiError(400, 'An ingredient is listed twice', 'invalid')
      seen.add(k)
      return { ingredientId, optionId, qty }
    })
    run('DELETE FROM recipe_lines WHERE item_id = ?', itemId)
    for (const r of rows) run('INSERT INTO recipe_lines (item_id, option_id, ingredient_id, qty) VALUES (?,?,?,?)', itemId, r.optionId, r.ingredientId, r.qty)
    refreshAvailability(rows.map((r) => r.ingredientId))
  })
  audit(staff, staff.name, 'recipe.update', String(itemId), `${lines.length} lines`)
  return recipeFor(itemId)
}

/** Manual stock changes. "count" sets the counted amount; the rest are signed changes. */
export function adjustStock(staff: Staff, input: { ingredientId: number; kind: 'adjustment' | 'waste' | 'count' | 'purchase' | 'opening'; quantity: number; reason?: string; unitCost?: number; expiresOn?: string | null }) {
  const kind = input.kind
  if (!['adjustment', 'waste', 'count', 'purchase', 'opening'].includes(kind)) throw new ApiError(400, 'Invalid movement', 'invalid')
  const reason = String(input.reason ?? '').trim().slice(0, 300)
  if ((kind === 'adjustment' || kind === 'waste') && !reason) throw new ApiError(400, 'Please give a reason', 'reason_required')
  let qty = toQty(input.quantity)
  const unitCost = input.unitCost === undefined || input.unitCost === null ? undefined : Number(input.unitCost)
  if (unitCost !== undefined && (!Number.isFinite(unitCost) || unitCost < 0)) throw new ApiError(400, 'Invalid cost', 'invalid')
  const expiresOn = input.expiresOn ? String(input.expiresOn) : null
  if (expiresOn && !/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) throw new ApiError(400, 'Expiry must be a date', 'invalid')
  const out = tx(() => {
    const i = ingredient(Number(input.ingredientId))
    let change = qty
    if (kind === 'count') { if (qty < 0) throw new ApiError(400, 'A count cannot be negative', 'invalid'); change = qty - i.stock }
    else if (kind === 'waste') change = -Math.abs(qty)
    else if (kind === 'purchase' || kind === 'opening') { if (qty <= 0) throw new ApiError(400, 'Enter how much arrived', 'invalid') }
    if (change === 0) return { balance: i.stock, change: 0 }
    const balance = move(i.id, change, kind, { reason: reason || (kind === 'count' ? 'Stock count' : ''), unitCost, staffId: staff.id, expiresOn: change > 0 ? expiresOn : null })!
    refreshAvailability([i.id])
    return { balance, change }
  })
  audit(staff, staff.name, `stock.${kind}`, String(input.ingredientId), `${fromQty(out.change)}: ${reason}`)
  publish('staff', 'stock', {})
  return { balance: fromQty(out.balance), change: fromQty(out.change) }
}

// ---------------------------------------------------------------- purchase orders

export function listPurchaseOrders() {
  const pos = all<{ id: number; number: number; supplier_id: number | null; supplier: string | null; status: string; expected_on: string | null; notes: string; created_at: string; received_at: string | null }>(
    `SELECT p.*, s.name AS supplier FROM purchase_orders p LEFT JOIN suppliers s ON s.id = p.supplier_id ORDER BY p.id DESC LIMIT 200`)
  const lines = pos.length ? all<{ id: number; po_id: number; ingredient_id: number; name: string; unit: string; qty: number; unit_cost: number; received_qty: number }>(
    `SELECT l.*, g.name, g.unit FROM purchase_order_lines l JOIN ingredients g ON g.id = l.ingredient_id WHERE l.po_id IN (${pos.map(() => '?').join(',')}) ORDER BY l.id`, ...pos.map((p) => p.id)) : []
  return pos.map((p) => {
    const ls = lines.filter((l) => l.po_id === p.id).map((l) => ({
      id: l.id, ingredientId: l.ingredient_id, ingredient: l.name, unit: l.unit, qty: fromQty(l.qty), unitCost: l.unit_cost, received: fromQty(l.received_qty),
      total: Math.round(l.qty / K * l.unit_cost),
    }))
    return { id: p.id, label: `PO-${p.number}`, supplierId: p.supplier_id, supplier: p.supplier, status: p.status, expectedOn: p.expected_on, notes: p.notes,
      createdAt: iso(p.created_at), receivedAt: iso(p.received_at), lines: ls, total: ls.reduce((a, l) => a + l.total, 0) }
  })
}

export function createPurchaseOrder(staff: Staff, input: { supplierId?: number | null; expectedOn?: string | null; notes?: string; lines: Array<{ ingredientId: number; qty: number; unitCost?: number }> }) {
  if (!Array.isArray(input.lines) || !input.lines.length || input.lines.length > 100) throw new ApiError(400, 'Add at least one line', 'invalid')
  const id = tx(() => {
    if (input.supplierId && !get('SELECT 1 FROM suppliers WHERE id = ?', input.supplierId)) throw new ApiError(400, 'Unknown supplier', 'invalid')
    const number = (get<{ n: number | null }>('SELECT MAX(number) n FROM purchase_orders')!.n ?? 100) + 1
    const r = run('INSERT INTO purchase_orders (number, supplier_id, expected_on, notes, created_by) VALUES (?,?,?,?,?)',
      number, input.supplierId ?? null, input.expectedOn || null, String(input.notes ?? '').slice(0, 500), staff.id)
    const po = Number(r.lastInsertRowid)
    for (const l of input.lines) {
      const g = get<{ unit_cost: number }>('SELECT unit_cost FROM ingredients WHERE id = ?', Number(l.ingredientId))
      if (!g) throw new ApiError(400, 'Unknown ingredient', 'invalid')
      const qty = toQty(l.qty)
      if (qty <= 0) throw new ApiError(400, 'Quantities must be positive', 'invalid')
      const cost = l.unitCost === undefined || l.unitCost === null ? g.unit_cost : Number(l.unitCost)
      if (!Number.isFinite(cost) || cost < 0) throw new ApiError(400, 'Invalid cost', 'invalid')
      run('INSERT INTO purchase_order_lines (po_id, ingredient_id, qty, unit_cost) VALUES (?,?,?,?)', po, Number(l.ingredientId), qty, cost)
    }
    return po
  })
  audit(staff, staff.name, 'po.create', String(id))
  return listPurchaseOrders().find((p) => p.id === id)!
}

export function setPurchaseOrderStatus(staff: Staff, id: number, to: 'ordered' | 'cancelled') {
  tx(() => {
    const p = get<{ status: string }>('SELECT status FROM purchase_orders WHERE id = ?', id)
    if (!p) throw new ApiError(404, 'Purchase order not found', 'not_found')
    const ok = to === 'ordered' ? p.status === 'draft' : ['draft', 'ordered'].includes(p.status)
    if (!ok) throw new ApiError(409, `A ${p.status} purchase order cannot become ${to}`, 'bad_transition')
    run(`UPDATE purchase_orders SET status = ?, ordered_at = CASE WHEN ? = 'ordered' THEN datetime('now') ELSE ordered_at END WHERE id = ?`, to, to, id)
  })
  audit(staff, staff.name, `po.${to}`, String(id))
  return listPurchaseOrders().find((p) => p.id === id)!
}

/** Books what actually arrived (can be less or more than ordered), at the invoiced cost. */
export function receivePurchaseOrder(staff: Staff, id: number, lines: Array<{ lineId: number; qty: number; unitCost?: number; expiresOn?: string | null }>) {
  if (!Array.isArray(lines) || !lines.length) throw new ApiError(400, 'Nothing to receive', 'invalid')
  tx(() => {
    const p = get<{ number: number; status: string }>('SELECT number, status FROM purchase_orders WHERE id = ?', id)
    if (!p) throw new ApiError(404, 'Purchase order not found', 'not_found')
    if (!['draft', 'ordered', 'partial'].includes(p.status)) throw new ApiError(409, `This purchase order is ${p.status}`, 'bad_state')
    const touched: number[] = []
    for (const l of lines) {
      const row = get<{ id: number; ingredient_id: number; unit_cost: number }>('SELECT id, ingredient_id, unit_cost FROM purchase_order_lines WHERE id = ? AND po_id = ?', Number(l.lineId), id)
      if (!row) throw new ApiError(404, 'Line not found on this purchase order', 'not_found')
      const qty = toQty(l.qty)
      if (qty < 0) throw new ApiError(400, 'Received quantity cannot be negative', 'invalid')
      if (qty === 0) continue
      const cost = l.unitCost === undefined || l.unitCost === null ? row.unit_cost : Number(l.unitCost)
      if (!Number.isFinite(cost) || cost < 0) throw new ApiError(400, 'Invalid cost', 'invalid')
      if (l.expiresOn && !/^\d{4}-\d{2}-\d{2}$/.test(l.expiresOn)) throw new ApiError(400, 'Expiry must be a date', 'invalid')
      move(row.ingredient_id, qty, 'purchase', { unitCost: cost, poId: id, staffId: staff.id, expiresOn: l.expiresOn || null, reason: `PO-${p.number}` })
      run('UPDATE purchase_order_lines SET received_qty = received_qty + ?, unit_cost = ? WHERE id = ?', qty, cost, row.id)
      touched.push(row.ingredient_id)
    }
    const open = get<{ c: number }>('SELECT COUNT(*) c FROM purchase_order_lines WHERE po_id = ? AND received_qty < qty', id)!.c
    run(`UPDATE purchase_orders SET status = ?, received_at = datetime('now') WHERE id = ?`, open ? 'partial' : 'received', id)
    refreshAvailability(touched)
  })
  audit(staff, staff.name, 'po.receive', String(id))
  publish('staff', 'stock', {})
  return listPurchaseOrders().find((p) => p.id === id)!
}
