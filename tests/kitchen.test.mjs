// Kitchen display and stations (TEST 2 + the routing example from the brief: burger, drink and a side
// each go to their own station, and the order is ready only when every station is done).
import test from 'node:test'
import assert from 'node:assert/strict'
import { adminClient, idem, itemByName, menu, sql, staffClient } from './helpers.mjs'

const S = {}
const line = (name, quantity = 1) => ({ itemId: itemByName(S.menu, name).id, quantity })
const board = async (stationName) => {
  const st = stationName ? S.stations.find((s) => s.name === stationName).id : null
  const r = await S.kitchen.api('GET', `/api/staff/kitchen${st ? `?station=${st}` : ''}`)
  assert.equal(r.status, 200, JSON.stringify(r.data))
  return r.data
}
const ticket = (b, id) => b.orders.find((o) => o.id === id)
const lines = (c, body) => c.api('POST', '/api/staff/kitchen/lines', body)

test('setup: default stations exist and categories are routed', async () => {
  S.admin = await adminClient()
  for (const r of ['kitchen', 'waiter', 'cashier']) S[r] = await staffClient(S.admin, r)
  S.menu = await menu()
  S.stations = (await S.admin.api('GET', '/api/admin/stations')).data.stations
  assert.deepEqual(S.stations.map((s) => s.name), ['Grill', 'Fryer', 'Drinks'])
})

test('routing: each line goes to its station; stations only see their own lines', async () => {
  const r = await S.cashier.api('POST', '/api/staff/pos/orders', {
    type: 'walk_in', lines: [line('OG Smash'), line('Classic Fries'), line('Pepsi', 2)], idempotencyKey: idem(),
  })
  assert.equal(r.status, 201)
  S.o = r.data.id
  const grill = ticket(await board('Grill'), S.o)
  assert.deepEqual(grill.lines.map((l) => l.name), ['OG Smash'])
  assert.deepEqual(grill.otherStationsPending.sort(), ['Drinks', 'Fryer'])
  assert.deepEqual(ticket(await board('Drinks'), S.o).lines.map((l) => [l.name, l.quantity]), [['Pepsi', 2]])
  assert.equal(ticket(await board(), S.o).lines.length, 3, 'whole-kitchen view shows everything')
  assert.equal(ticket(await board('Grill'), S.o).status, 'confirmed')
})

test('TEST 2: stations work independently; the order follows its lines', async () => {
  const drinks = S.stations.find((s) => s.name === 'Drinks').id
  // Drinks are poured first: whole station's lines straight to ready.
  assert.equal((await lines(S.kitchen, { orderId: S.o, stationId: drinks, status: 'ready' })).status, 200)
  let all = ticket(await board(), S.o)
  assert.equal(all.status, 'preparing', 'first station working moves the order to preparing')
  assert.equal(all.lines.find((l) => l.name === 'Pepsi').status, 'ready')
  assert.equal(all.lines.find((l) => l.name === 'OG Smash').status, 'new', 'other stations untouched')

  const burger = all.lines.find((l) => l.name === 'OG Smash').id
  const fries = all.lines.find((l) => l.name === 'Classic Fries').id
  assert.equal((await lines(S.kitchen, { orderId: S.o, lineIds: [burger], status: 'preparing' })).status, 200)
  assert.equal((await lines(S.kitchen, { orderId: S.o, lineIds: [burger], status: 'ready' })).status, 200)
  assert.equal(ticket(await board(), S.o).status, 'preparing', 'not ready while the fries are not')

  // The customer's tracking view follows too.
  const track = sql().prepare('SELECT status FROM orders WHERE public_id = ?').get(S.o)
  assert.equal(track.status, 'preparing')

  assert.equal((await lines(S.kitchen, { orderId: S.o, lineIds: [fries], status: 'ready' })).status, 200)
  const ready = ticket(await board(), S.o)
  assert.equal(ready.status, 'ready', 'every station done -> order ready')
  const notes = await S.waiter.api('GET', '/api/staff/notifications')
  assert.ok(notes.data.notifications.some((n) => n.kind === 'ready' && n.title.includes(ready.label)), 'waiter told it is ready')
  const done = await lines(S.kitchen, { orderId: S.o, lineIds: [fries], status: 'preparing' })
  assert.equal(done.status, 409, 'a ready order is no longer edited from the line view')
})

test('kitchen lines: validation and permissions', async () => {
  const r = await S.cashier.api('POST', '/api/staff/pos/orders', { type: 'walk_in', lines: [line('OG Smash')], idempotencyKey: idem() })
  assert.equal((await lines(S.kitchen, { orderId: r.data.id, lineIds: [999999], status: 'ready' })).status, 404)
  assert.equal((await lines(S.kitchen, { orderId: r.data.id, status: 'new' })).status, 400)
  assert.equal((await lines(S.waiter, { orderId: r.data.id, status: 'ready' })).status, 403)
  assert.equal((await lines(S.kitchen, { orderId: 'nope', status: 'ready' })).status, 404)
})

test('whole-order buttons still work and move every line', async () => {
  const r = await S.cashier.api('POST', '/api/staff/pos/orders', { type: 'walk_in', lines: [line('OG Smash'), line('Pepsi')], idempotencyKey: idem() })
  assert.equal((await S.kitchen.api('POST', `/api/staff/orders/${r.data.id}/transition`, { to: 'preparing' })).status, 200)
  assert.ok(ticket(await board(), r.data.id).lines.every((l) => l.status === 'preparing'))
  assert.equal((await S.kitchen.api('POST', `/api/staff/orders/${r.data.id}/transition`, { to: 'ready' })).status, 200)
  assert.ok(ticket(await board(), r.data.id).lines.every((l) => l.status === 'ready'))
})

test('rush: a waiter can push an order to the front of the queue', async () => {
  const a = await S.cashier.api('POST', '/api/staff/pos/orders', { type: 'walk_in', lines: [line('OG Smash')], idempotencyKey: idem() })
  const b = await S.cashier.api('POST', '/api/staff/pos/orders', { type: 'walk_in', lines: [line('OG Smash')], idempotencyKey: idem() })
  assert.equal((await S.kitchen.api('POST', `/api/staff/orders/${b.data.id}/rush`, { rush: true })).status, 403, 'kitchen does not reprioritise')
  assert.equal((await S.waiter.api('POST', `/api/staff/orders/${b.data.id}/rush`, { rush: true })).status, 200)
  const order = (await board('Grill')).orders.map((o) => o.id)
  assert.ok(order.indexOf(b.data.id) < order.indexOf(a.data.id), 'rushed order first')
  assert.equal(ticket(await board(), b.data.id).rush, true)
})

test('delays: a late order is flagged and the waiter is told once', async () => {
  const r = await S.cashier.api('POST', '/api/staff/pos/orders', { type: 'walk_in', lines: [line('OG Smash')], idempotencyKey: idem() })
  assert.equal(ticket(await board(), r.data.id).delayed, false)
  const db = sql()
  db.prepare(`UPDATE orders SET confirmed_at = datetime('now', '-40 minutes') WHERE public_id = ?`).run(r.data.id)
  const t = ticket(await board(), r.data.id)
  assert.equal(t.delayed, true)
  assert.ok(t.ageMinutes >= 40)
  await board(); await board()
  const label = t.label
  const n = db.prepare(`SELECT COUNT(*) n FROM notifications WHERE kind = 'delayed' AND audience = 'waiter' AND title LIKE ?`).get(`${label} %`).n
  assert.equal(n, 1, 'one alert, not one per refresh')
})

test('routing changes: a category or a single item can move to another station', async () => {
  const fryer = S.stations.find((s) => s.name === 'Fryer').id
  const drinks = S.stations.find((s) => s.name === 'Drinks').id
  const og = itemByName(S.menu, 'OG Smash')
  assert.equal((await S.kitchen.api('PUT', '/api/admin/stations', { itemId: og.id, stationId: fryer })).status, 403)
  assert.equal((await S.admin.api('PUT', '/api/admin/stations', { itemId: og.id, stationId: fryer })).status, 200)
  const r = await S.cashier.api('POST', '/api/staff/pos/orders', { type: 'walk_in', lines: [line('OG Smash'), line('All American')], idempotencyKey: idem() })
  const all = ticket(await board(), r.data.id)
  assert.equal(all.lines.find((l) => l.name === 'OG Smash').station.name, 'Fryer', 'item override wins')
  assert.equal(all.lines.find((l) => l.name === 'All American').station.name, 'Grill', 'rest of the category unchanged')
  await S.admin.api('PUT', '/api/admin/stations', { itemId: og.id, stationId: null })
  const cat = S.menu.categories.find((c) => c.name.en === 'Sides')
  assert.equal((await S.admin.api('PUT', '/api/admin/stations', { categoryId: cat.id, stationId: drinks })).status, 200)
  await S.admin.api('PUT', '/api/admin/stations', { categoryId: cat.id, stationId: fryer })
  const created = await S.admin.api('POST', '/api/admin/stations', { name: 'Desserts', color: '#8a5cf6' })
  assert.equal(created.status, 201)
  assert.equal((await S.admin.api('POST', '/api/admin/stations', { name: 'desserts' })).status, 409)
  assert.equal((await S.admin.api('POST', '/api/admin/stations', { name: 'Pastry', color: 'red' })).status, 400)
})

test('tickets show only what differs from the standard dish', async () => {
  const og = itemByName(S.menu, 'OG Smash')
  const extra = og.groups.flatMap((g) => g.options).find((o) => o.name.en.includes('Extra Patty'))
  const defaults = og.groups.flatMap((g) => g.options).filter((o) => o.isDefault)
  assert.ok(extra && defaults.length, 'menu has a default and an extra to compare')
  const r = await S.cashier.api('POST', '/api/staff/pos/orders', {
    type: 'walk_in', lines: [{ itemId: og.id, quantity: 1, optionIds: [extra.id] }], idempotencyKey: idem(),
  })
  assert.equal(r.status, 201, JSON.stringify(r.data))
  const l = ticket(await board('Grill'), r.data.id).lines[0]
  assert.ok(l.options.includes(extra.name.en), 'the extra patty is on the ticket')
  for (const d of defaults) assert.ok(!l.options.includes(d.name.en), `default "${d.name.en}" is not`)
  // The bill and receipt still list every choice.
  const bill = await S.cashier.api('GET', `/api/staff/bills/order/${r.data.id}`)
  assert.ok(defaults.some((d) => bill.data.orders[0].items[0].options.includes(d.name.en)))
})
