// Inventory (TEST 8: stock is updated by the configured recipes and stock rules). Uses its own dishes so
// recipes here never sell out dishes other test files order.
import test from 'node:test'
import assert from 'node:assert/strict'
import { adminClient, guestAt, idem, menu, newTable, sql, staffClient, uniq } from './helpers.mjs'

const S = {}
const I = '/api/admin/inventory'
const stock = async (id) => (await S.inv.api('GET', `${I}/ingredients`)).data.ingredients.find((g) => g.id === id)
const ingredient = async (body) => {
  const name = uniq(body.name)
  const r = await S.inv.api('POST', `${I}/ingredients`, { ...body, name })
  assert.equal(r.status, 201, JSON.stringify(r.data))
  return r.data.id
}
const pos = (lines, key = idem()) => S.cashier.api('POST', '/api/staff/pos/orders', { type: 'walk_in', lines, idempotencyKey: key })
const itemIn = (m, id) => m.categories.flatMap((c) => c.items).find((i) => i.id === id)

test('setup: an inventory manager, a test category and a burger with an "extra patty" option', async () => {
  S.admin = await adminClient()
  S.inv = await staffClient(S.admin, 'inventory')
  S.cashier = await staffClient(S.admin, 'cashier')
  S.waiter = await staffClient(S.admin, 'waiter')
  S.kitchen = await staffClient(S.admin, 'kitchen')
  const cat = await S.admin.api('POST', '/api/admin/categories', { nameEn: uniq('Stock test ') })
  S.cat = cat.data.id
  const mk = async (name, groups = []) => {
    const r = await S.admin.api('POST', '/api/admin/items', { categoryId: S.cat, name: { en: uniq(name) }, price: 10000, groups })
    assert.equal(r.status, 201, JSON.stringify(r.data))
    return r.data.id
  }
  S.burger = await mk('Test burger', [{ name: { en: 'Extras' }, kind: 'multi', options: [{ name: { en: 'Extra patty' }, priceDelta: 2000 }, { name: { en: 'No cheese' }, priceDelta: 0 }] }])
  S.fries = await mk('Test fries')
  const it = itemIn(await menu(), S.burger)
  S.extra = it.groups[0].options.find((o) => o.name.en === 'Extra patty').id
  S.noCheese = it.groups[0].options.find((o) => o.name.en === 'No cheese').id
})

test('ingredients: opening stock is a recorded movement; validation', async () => {
  S.beef = await ingredient({ name: 'Beef', unit: 'g', unitCost: 12.5, minLevel: 500, openingStock: 1000 })
  S.bun = await ingredient({ name: 'Bun', unit: 'pcs', unitCost: 250, openingStock: 10 })
  S.cheese = await ingredient({ name: 'Cheese', unit: 'pcs', unitCost: 150, openingStock: 20 })
  S.potato = await ingredient({ name: 'Potato', unit: 'kg', unitCost: 1200, openingStock: 2, trackExpiry: true })
  const b = await stock(S.beef)
  assert.equal(b.stock, 1000)
  assert.equal(b.value, 12500)
  const mv = (await S.inv.api('GET', `${I}/movements?ingredient=${S.beef}`)).data.movements
  assert.equal(mv[0].kind, 'opening')
  assert.equal((await S.inv.api('POST', `${I}/ingredients`, { name: uniq('x'), unit: 'bucket' })).status, 400)
  assert.equal((await S.cashier.api('GET', `${I}/ingredients`)).status, 403, 'cashiers do not manage stock')
})

test('recipes: dish lines, option lines (an option may remove an ingredient), validation', async () => {
  const put = (itemId, lines) => S.inv.api('PUT', `${I}/recipes`, { itemId, lines })
  assert.equal((await put(S.burger, [{ ingredientId: S.beef, qty: -1 }])).status, 400, 'only options can remove')
  assert.equal((await put(S.burger, [{ ingredientId: S.beef, qty: 150 }, { ingredientId: S.beef, qty: 10 }])).status, 400, 'no duplicates')
  assert.equal((await put(S.fries, [{ ingredientId: S.beef, qty: 1, optionId: S.extra }])).status, 400, 'option of another dish')
  const r = await put(S.burger, [
    { ingredientId: S.beef, qty: 150 }, { ingredientId: S.bun, qty: 1 }, { ingredientId: S.cheese, qty: 1 },
    { ingredientId: S.beef, qty: 150, optionId: S.extra }, { ingredientId: S.cheese, qty: -1, optionId: S.noCheese },
  ])
  assert.equal(r.status, 200, JSON.stringify(r.data))
  assert.equal(r.data.lines.find((l) => !l.optionId && l.ingredientId === S.beef).cost, 1875, '150 g x 12.5')
  assert.equal((await put(S.fries, [{ ingredientId: S.potato, qty: 0.25 }])).status, 200)
})

test('TEST 8: a POS order deducts by recipe, including options', async () => {
  const r = await pos([{ itemId: S.burger, quantity: 2, optionIds: [S.extra] }, { itemId: S.burger, quantity: 1, optionIds: [S.noCheese] }])
  assert.equal(r.status, 201, JSON.stringify(r.data))
  S.o1 = r.data.id
  assert.equal((await stock(S.beef)).stock, 1000 - (2 * 300 + 150), 'two doubles and a single')
  assert.equal((await stock(S.bun)).stock, 7)
  assert.equal((await stock(S.cheese)).stock, 18, 'the "no cheese" burger used none')
  const mv = (await S.inv.api('GET', `${I}/movements?ingredient=${S.beef}`)).data.movements[0]
  assert.equal(mv.kind, 'sale')
  assert.equal(mv.change, -750)
  assert.match(mv.order, /^ORD-\d+$/)
  // Moving the order through the kitchen does not deduct again.
  await S.kitchen.api('POST', `/api/staff/orders/${S.o1}/transition`, { to: 'preparing' })
  await S.kitchen.api('POST', `/api/staff/orders/${S.o1}/transition`, { to: 'ready' })
  assert.equal((await stock(S.beef)).stock, 250)
})

test('low stock: crossing the minimum alerts once', async () => {
  const db = sql()
  const n = () => db.prepare(`SELECT COUNT(*) n FROM notifications WHERE kind = 'low_stock' AND audience = 'inventory' AND title LIKE ?`).get(`%${'Beef'}%`).n
  assert.ok(n() >= 1, 'beef went from 1000 g to 250 g, under its 500 g minimum')
  const before = n()
  assert.equal((await S.inv.api('POST', `${I}/movements`, { ingredientId: S.beef, kind: 'waste', quantity: 10, reason: 'Dropped' })).status, 201)
  assert.equal(n(), before, 'still low: no second alert')
  assert.ok((await S.inv.api('GET', `${I}/alerts`)).data.low.some((g) => g.id === S.beef))
})

test('negative stock is refused; the dish sells out by itself and returns on restock', async () => {
  // 240 g of beef left: one plain burger (150 g) fits, a double (300 g) does not.
  const double = await pos([{ itemId: S.burger, quantity: 1, optionIds: [S.extra] }])
  assert.equal(double.status, 409)
  assert.equal(double.data.code, 'out_of_stock')
  assert.equal((await stock(S.beef)).stock, 240, 'nothing deducted by the refused order')
  assert.equal((await pos([{ itemId: S.burger, quantity: 1 }])).status, 201)
  assert.equal((await stock(S.beef)).stock, 90)
  let it = itemIn(await menu(), S.burger)
  assert.equal(it.available, false, 'under 150 g left: the burger is sold out')
  const notes = await S.inv.api('GET', '/api/staff/notifications')
  assert.ok(notes.data.notifications.some((x) => x.kind === 'soldout'))
  // A guest cannot order it either.
  assert.equal((await pos([{ itemId: S.burger, quantity: 1 }])).status, 409)
  // Restock through a purchase order: back on the menu, at a weighted average cost.
  const po = await S.inv.api('POST', `${I}/purchase-orders`, { lines: [{ ingredientId: S.beef, qty: 2000, unitCost: 14 }] })
  assert.equal(po.status, 201, JSON.stringify(po.data))
  assert.equal(po.data.purchaseOrder.status, 'draft')
  assert.equal((await S.inv.api('PATCH', `${I}/purchase-orders/${po.data.purchaseOrder.id}`, { status: 'ordered' })).status, 200)
  const line = po.data.purchaseOrder.lines[0].id
  const rec = await S.inv.api('POST', `${I}/purchase-orders/${po.data.purchaseOrder.id}/receive`, { lines: [{ lineId: line, qty: 1500, unitCost: 14 }] })
  assert.equal(rec.data.purchaseOrder.status, 'partial')
  const b = await stock(S.beef)
  assert.equal(b.stock, 1590)
  assert.ok(Math.abs(b.unitCost - (90 * 12.5 + 1500 * 14) / 1590) < 0.001, 'weighted average cost')
  it = itemIn(await menu(), S.burger)
  assert.equal(it.available, true, 'restocked: back on the menu')
  const rest = await S.inv.api('POST', `${I}/purchase-orders/${po.data.purchaseOrder.id}/receive`, { lines: [{ lineId: line, qty: 500 }] })
  assert.equal(rest.data.purchaseOrder.status, 'received')
  assert.equal((await S.inv.api('PATCH', `${I}/purchase-orders/${po.data.purchaseOrder.id}`, { status: 'cancelled' })).status, 409)
})

test('a dish a manager marked sold out by hand stays sold out after restocking', async () => {
  await S.admin.api('PATCH', `/api/admin/items/${S.burger}`, { available: false })
  await S.inv.api('POST', `${I}/movements`, { ingredientId: S.beef, kind: 'purchase', quantity: 100, unitCost: 14 })
  assert.equal(itemIn(await menu(), S.burger).available, false)
  await S.admin.api('PATCH', `/api/admin/items/${S.burger}`, { available: true })
})

test('cancelling before cooking puts stock back; after cooking it stays used', async () => {
  const before = (await stock(S.bun)).stock
  const a = await pos([{ itemId: S.burger, quantity: 2 }])
  assert.equal((await stock(S.bun)).stock, before - 2)
  assert.equal((await S.admin.api('POST', `/api/staff/orders/${a.data.id}/transition`, { to: 'cancelled', reason: 'Guest left' })).status, 200)
  assert.equal((await stock(S.bun)).stock, before, 'returned')
  const b = await pos([{ itemId: S.burger, quantity: 1 }])
  await S.kitchen.api('POST', `/api/staff/orders/${b.data.id}/transition`, { to: 'preparing' })
  assert.equal((await S.admin.api('POST', `/api/staff/orders/${b.data.id}/transition`, { to: 'cancelled', reason: 'Burnt' })).status, 200)
  assert.equal((await stock(S.bun)).stock, before - 1, 'the bun was already on the grill')
})

test('QR orders deduct when the waiter sends them to the kitchen, not before', async () => {
  const table = await newTable(S.admin)
  const g = await guestAt(table)
  const before = (await stock(S.bun)).stock
  const o = await g.api('POST', '/api/orders', { lines: [{ itemId: S.burger, quantity: 1 }], idempotencyKey: idem() })
  assert.equal(o.status, 201, JSON.stringify(o.data))
  assert.equal((await stock(S.bun)).stock, before, 'awaiting verification: nothing taken yet')
  const tr = (await g.api('GET', `/api/orders/${o.data.trackToken}`)).data.order
  await S.waiter.api('POST', `/api/staff/orders/${tr.id}/verify`, { code: tr.verifyCode })
  await S.waiter.api('POST', `/api/staff/orders/${tr.id}/transition`, { to: 'confirmed' })
  assert.equal((await stock(S.bun)).stock, before - 1)
  // A guest cannot even put in an order the kitchen could not make.
  // 0.3 kg of potatoes: one portion (0.25 kg) can be made, two cannot.
  await S.inv.api('POST', `${I}/movements`, { ingredientId: S.potato, kind: 'count', quantity: 0.3 })
  assert.equal((await g.api('POST', '/api/orders/quote', { lines: [{ itemId: S.fries, quantity: 1 }] })).status, 200)
  const q = await g.api('POST', '/api/orders/quote', { lines: [{ itemId: S.fries, quantity: 2 }] })
  assert.equal(q.data.code, 'out_of_stock')
  // Under one portion left: the fries sell out by themselves.
  await S.inv.api('POST', `${I}/movements`, { ingredientId: S.potato, kind: 'count', quantity: 0.1 })
  assert.equal((await g.api('POST', '/api/orders/quote', { lines: [{ itemId: S.fries, quantity: 1 }] })).data.code, 'unavailable')
})

test('counts, waste and expiry batches', async () => {
  assert.equal((await S.inv.api('POST', `${I}/movements`, { ingredientId: S.cheese, kind: 'waste', quantity: 2 })).data.code, 'reason_required')
  const c = await S.inv.api('POST', `${I}/movements`, { ingredientId: S.cheese, kind: 'count', quantity: 11, reason: 'Weekly count' })
  assert.equal(c.data.balance, 11)
  const today = new Date().toISOString().slice(0, 10)
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
  const later = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10)
  await S.inv.api('POST', `${I}/movements`, { ingredientId: S.potato, kind: 'purchase', quantity: 1, unitCost: 1200, expiresOn: later })
  await S.inv.api('POST', `${I}/movements`, { ingredientId: S.potato, kind: 'purchase', quantity: 1, unitCost: 1200, expiresOn: tomorrow })
  let al = (await S.inv.api('GET', `${I}/alerts`)).data
  assert.ok(al.expiring.some((b) => b.expiresOn === tomorrow && b.qty === 1), 'tomorrow’s batch is flagged')
  assert.ok(!al.expiring.some((b) => b.expiresOn === later))
  await S.inv.api('GET', `${I}/alerts`)
  const n = sql().prepare(`SELECT COUNT(*) n FROM notifications WHERE kind = 'expiry' AND body LIKE '1 kg'`).get().n
  assert.ok(n >= 1)
  // Using stock takes the batch that expires first.
  const fries = await pos([{ itemId: S.fries, quantity: 2 }]) // 0.5 kg
  assert.equal(fries.status, 201, JSON.stringify(fries.data))
  al = (await S.inv.api('GET', `${I}/alerts`)).data
  assert.equal(al.expiring.find((b) => b.expiresOn === tomorrow).qty, 0.5)
  assert.ok(today)
})

test('settings: allowing negative stock lets orders through', async () => {
  assert.equal((await S.admin.api('PUT', '/api/admin/settings', { allowNegativeStock: true })).status, 200)
  const cheeseNow = (await stock(S.cheese)).stock
  const r = await pos([{ itemId: S.burger, quantity: Math.ceil(cheeseNow) + 2 }])
  assert.equal(r.status, 201, JSON.stringify(r.data))
  assert.ok((await stock(S.cheese)).stock < 0)
  await S.admin.api('PUT', '/api/admin/settings', { allowNegativeStock: false })
  // Put things back so nothing else is affected.
  await S.admin.api('PATCH', `/api/admin/categories`, { id: S.cat, visible: false })
})
