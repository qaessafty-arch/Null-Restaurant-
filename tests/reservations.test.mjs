// Reservations and the live floor (TEST 9: a reservation updates table availability and double-booking is prevented).
import test from 'node:test'
import assert from 'node:assert/strict'
import { adminClient, client, guestAt, idem, itemByName, menu, sql, staffClient, uniq } from './helpers.mjs'

const S = {}
const TZ = 'Asia/Baghdad'
const localDay = (offsetDays) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(Date.now() + offsetDays * 86400000))
const phone = () => `0750${Math.floor(1000000 + Math.random() * 8999999)}`
const book = (c, extra) => c.api('POST', '/api/reservations', { name: 'Shilan', phone: phone(), partySize: 10, date: S.day, time: '19:00', idempotencyKey: idem(), ...extra })
const tableStatus = async (id) => (await S.waiter.api('GET', '/api/staff/floor')).data.tables.find((t) => t.id === id)

test('setup: a section with the only ten-seat table', async () => {
  S.admin = await adminClient()
  for (const r of ['waiter', 'receptionist', 'cashier', 'kitchen']) S[r] = await staffClient(S.admin, r)
  S.menu = await menu()
  const sec = await S.admin.api('POST', '/api/admin/sections', { name: uniq('Terrace') })
  assert.equal(sec.status, 201)
  S.section = sec.data.sections.at(-1).id
  const number = uniq('BIG')
  assert.equal((await S.admin.api('POST', '/api/admin/tables', { number, capacity: 10, sectionId: S.section })).status, 201)
  const list = (await S.admin.api('GET', '/api/admin/tables')).data.tables
  S.big = list.find((t) => t.number === number)
  assert.equal(S.big.capacity, 10)
  assert.ok(!list.some((t) => t.capacity >= 9 && t.id !== S.big.id), 'no other table seats nine or more')
  S.day = localDay(3)
})

test('public form: options and availability', async () => {
  const o = await client().api('GET', '/api/reservations/options')
  assert.equal(o.status, 200)
  assert.ok(o.data.sections.some((s) => s.id === S.section))
  const a = await client().api('GET', `/api/reservations/availability?date=${S.day}&party=10`)
  assert.equal(a.status, 200)
  assert.equal(a.data.open, true)
  assert.ok(a.data.slots.find((s) => s.time === '19:00').available)
  assert.equal((await client().api('GET', `/api/reservations/availability?date=${S.day}&party=99`)).status, 400)
})

test('TEST 9: booking holds the table; overlapping requests are refused; the buffer is respected', async () => {
  const g = client()
  const r = await book(g, { occasion: 'birthday', requests: 'High chair please' })
  assert.equal(r.status, 201, JSON.stringify(r.data))
  assert.equal(r.data.reservation.status, 'confirmed')
  assert.equal(r.data.reservation.tableNumber, S.big.number)
  assert.match(r.data.reservation.code, /^[A-Z0-9]{6}$/)
  assert.ok(r.data.reservation.phone.includes('•'), 'guest view masks the phone')
  S.res = r.data
  // 90 min + 15 min buffer: 19:30 and 20:30 clash, 21:00 is free.
  assert.equal((await book(client(), { time: '19:30', partySize: 9 })).data.code, 'no_availability')
  const a = (await client().api('GET', `/api/reservations/availability?date=${S.day}&party=10`)).data.slots
  assert.equal(a.find((s) => s.time === '19:00').available, false)
  assert.equal(a.find((s) => s.time === '20:30').available, false)
  assert.equal(a.find((s) => s.time === '21:00').available, true)
  // A party of four still fits elsewhere at 19:00.
  assert.equal((await client().api('GET', `/api/reservations/availability?date=${S.day}&party=4`)).data.slots.find((s) => s.time === '19:00').available, true)
})

test('concurrency: two guests racing for the last big table get one booking', async () => {
  const results = await Promise.all([book(client(), { time: '22:00' }), book(client(), { time: '22:00' })])
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409])
  const n = sql().prepare(`SELECT COUNT(*) n FROM reservations WHERE table_id = ? AND status = 'confirmed' AND starts_at LIKE ?`).get(S.big.id, `${S.day}%`).n
  assert.equal(n, 2, '19:00 and one 22:00 booking, never two at 22:00')
})

test('duplicates and validation', async () => {
  const key = idem(), p = phone()
  const a = await book(client(), { time: '11:00', phone: p, idempotencyKey: key, partySize: 2 })
  assert.equal(a.status, 201)
  const again = await book(client(), { time: '11:00', phone: p, idempotencyKey: key, partySize: 2 })
  assert.equal(again.status, 200)
  assert.equal(again.data.reservation.code, a.data.reservation.code)
  assert.equal((await book(client(), { time: '11:00', phone: p, partySize: 2 })).data.code, 'duplicate_booking')
  assert.equal((await book(client(), { phone: '12', partySize: 2 })).data.code, 'invalid_phone')
  assert.equal((await book(client(), { time: '05:00', partySize: 2 })).data.code, 'closed')
  const soon = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(Date.now() + 10 * 60000))
  const tooSoon = await book(client(), { date: localDay(0), time: soon, partySize: 2 })
  assert.ok(['too_soon', 'closed'].includes(tooSoon.data.code), JSON.stringify(tooSoon.data))
  // Staff-only fields are ignored on the public endpoint.
  const sneaky = await book(client(), { time: '13:00', partySize: 2, tableId: S.big.id, notes: 'VIP' })
  assert.equal(sneaky.status, 201)
  assert.notEqual(sneaky.data.reservation.tableNumber, S.big.number, 'a party of 2 is not given the 10-top just by asking')
})

test('guest self-service: view and cancel frees the table', async () => {
  const view = await client().api('GET', `/api/reservations/${S.res.manageToken}`)
  assert.equal(view.status, 200)
  assert.equal(view.data.reservation.code, S.res.reservation.code)
  assert.equal((await client().api('GET', '/api/reservations/not-a-real-token-123456789')).status, 404)
  const c = await client().api('POST', `/api/reservations/${S.res.manageToken}/cancel`, { reason: 'Plans changed' })
  assert.equal(c.data.reservation.status, 'cancelled')
  assert.equal((await client().api('POST', `/api/reservations/${S.res.manageToken}/cancel`, {})).status, 409)
  const a = (await client().api('GET', `/api/reservations/availability?date=${S.day}&party=10`)).data.slots
  assert.equal(a.find((s) => s.time === '19:00').available, true, 'slot is free again')
})

test('staff: phone bookings, explicit tables, reschedules and the double-booking guard', async () => {
  assert.equal((await S.cashier.api('POST', '/api/staff/reservations', {})).status, 403)
  const mk = (extra) => S.receptionist.api('POST', '/api/staff/reservations', { name: 'Karwan', phone: phone(), partySize: 6, date: S.day, time: '18:00', source: 'phone', idempotencyKey: idem(), ...extra })
  const a = await mk({ tableId: S.big.id, notes: 'Regular, likes the corner' })
  assert.equal(a.status, 201, JSON.stringify(a.data))
  assert.equal(a.data.reservation.notes, 'Regular, likes the corner')
  const clash = await mk({ tableId: S.big.id, time: '19:00' })
  assert.equal(clash.data.code, 'double_booked')
  const tooSmall = await S.admin.api('GET', '/api/admin/tables')
  const four = tooSmall.data.tables.find((t) => t.capacity === 4 && t.active)
  assert.equal((await mk({ tableId: four.id, partySize: 6 })).data.code, 'too_small')
  // Move the 18:00 booking onto the 22:00 one's slot on the same table: refused.
  const move = await S.receptionist.api('PATCH', `/api/staff/reservations/${a.data.reservation.id}`, { time: '22:00', tableId: S.big.id })
  assert.equal(move.data.code, 'double_booked')
  const ok = await S.receptionist.api('PATCH', `/api/staff/reservations/${a.data.reservation.id}`, { time: '17:30', partySize: 8 })
  assert.equal(ok.status, 200, JSON.stringify(ok.data))
  assert.equal(ok.data.reservation.time, '17:30')
  const hist = await S.receptionist.api('GET', `/api/staff/reservations/${a.data.reservation.id}`)
  assert.ok(hist.data.history.some((h) => /rescheduled/.test(h.note)))
  const list = await S.receptionist.api('GET', `/api/staff/reservations?from=${S.day}&to=${S.day}`)
  assert.ok(list.data.reservations.some((r) => r.id === a.data.reservation.id && r.phone.length > 6), 'staff see the full phone')
})

test('floor: a booking soon shows the table as reserved; seating and the lifecycle', async () => {
  const number = uniq('R')
  await S.admin.api('POST', '/api/admin/tables', { number, capacity: 4, sectionId: S.section })
  const t = (await S.admin.api('GET', '/api/admin/tables')).data.tables.find((x) => x.number === number)
  assert.equal((await tableStatus(t.id)).status, 'available')
  const at = new Date(Date.now() + 30 * 60000)
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at)
  const r = await S.receptionist.api('POST', '/api/staff/reservations', { name: 'Dara', phone: phone(), partySize: 3, date: localDay(0) === new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(at) ? localDay(0) : localDay(1), time, tableId: t.id, idempotencyKey: idem() })
  assert.equal(r.status, 201, JSON.stringify(r.data))
  const st = await tableStatus(t.id)
  assert.equal(st.status, 'reserved')
  assert.equal(st.reservation.name, 'Dara')
  const id = r.data.reservation.id
  const status = (to, reason) => S.receptionist.api('POST', `/api/staff/reservations/${id}/status`, { to, reason })
  assert.equal((await status('no_show')).data.code, 'too_early')
  assert.equal((await status('cancelled')).data.code, 'reason_required')
  assert.equal((await status('completed')).data.code, 'bad_transition')
  assert.equal((await status('seated')).status, 200)
  assert.equal((await tableStatus(t.id)).status, 'occupied')
  assert.equal((await S.kitchen.api('GET', '/api/staff/floor')).status, 403)
})

test('floor: one visit from ordering to cleaned', async () => {
  const number = uniq('V')
  await S.admin.api('POST', '/api/admin/tables', { number, capacity: 2 })
  const table = (await S.admin.api('GET', '/api/admin/tables')).data.tables.find((x) => x.number === number)
  const g = await guestAt(table)
  assert.equal((await tableStatus(table.id)).status, 'occupied', 'guests scanned in')
  const o = await g.api('POST', '/api/orders', { lines: [{ itemId: itemByName(S.menu, 'OG Smash').id, quantity: 1 }], idempotencyKey: idem() })
  assert.equal(o.status, 201)
  assert.equal((await tableStatus(table.id)).status, 'ordering', 'waiting for the waiter to verify')
  const tracked = (await g.api('GET', `/api/orders/${o.data.trackToken}`)).data.order
  const oid = tracked.id
  assert.equal((await S.waiter.api('POST', `/api/staff/orders/${oid}/verify`, { code: tracked.verifyCode })).status, 200)
  assert.equal((await S.waiter.api('POST', `/api/staff/orders/${oid}/transition`, { to: 'confirmed' })).status, 200)
  assert.equal((await tableStatus(table.id)).status, 'waiting_food')
  assert.equal((await S.waiter.api('POST', `/api/staff/floor/${table.id}`, { action: 'clear' })).data.code, 'table_busy')
  await S.kitchen.api('POST', `/api/staff/orders/${oid}/transition`, { to: 'preparing' })
  await S.kitchen.api('POST', `/api/staff/orders/${oid}/transition`, { to: 'ready' })
  await S.waiter.api('POST', `/api/staff/orders/${oid}/transition`, { to: 'served' })
  const unpaid = await tableStatus(table.id)
  assert.equal(unpaid.status, 'waiting_payment')
  assert.equal(unpaid.due, 8500)
  assert.equal((await S.cashier.api('POST', '/api/staff/payments', { orderIds: [oid], method: 'card', currency: 'IQD', amount: 8500, idempotencyKey: idem() })).status, 201)
  await S.waiter.api('POST', `/api/staff/orders/${oid}/transition`, { to: 'completed' })
  assert.equal((await tableStatus(table.id)).status, 'occupied', 'paid, guests still seated')
  assert.equal((await S.waiter.api('POST', `/api/staff/floor/${table.id}`, { action: 'clear' })).status, 200)
  assert.equal((await tableStatus(table.id)).status, 'cleaning')
  const late = await g.api('POST', '/api/orders', { lines: [{ itemId: itemByName(S.menu, 'OG Smash').id, quantity: 1 }], idempotencyKey: idem() })
  assert.equal(late.status, 403, 'the old QR session ended when the table was cleared')
  assert.equal((await S.waiter.api('POST', `/api/staff/floor/${table.id}`, { action: 'cleaned' })).status, 200)
  assert.equal((await tableStatus(table.id)).status, 'available')
  assert.equal((await S.waiter.api('POST', `/api/staff/floor/${table.id}`, { action: 'out_of_service' })).status, 200)
  assert.equal((await tableStatus(table.id)).status, 'out_of_service')
  const blocked = await S.receptionist.api('POST', '/api/staff/reservations', { name: 'Xan', phone: phone(), partySize: 2, date: S.day, time: '15:00', tableId: table.id, idempotencyKey: idem() })
  assert.equal(blocked.data.code, 'out_of_service')
  await S.waiter.api('POST', `/api/staff/floor/${table.id}`, { action: 'back_in_service' })
})
