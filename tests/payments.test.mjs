// Payments, bills and the POS. Covers TEST 4 (bill request -> cashier -> payment recorded) and
// TEST 6 (walk-in order -> payment -> receipt) from the brief, plus the money edge cases.
import test from 'node:test'
import assert from 'node:assert/strict'
import { adminClient, guestAt, idem, itemByName, menu, newTable, staffClient } from './helpers.mjs'

const S = {}
const line = (name, quantity = 1) => ({ itemId: itemByName(S.menu, name).id, quantity })
const pay = (c, body) => c.api('POST', '/api/staff/payments', { idempotencyKey: idem(), ...body })

test('setup', async () => {
  S.admin = await adminClient()
  for (const r of ['cashier', 'waiter', 'kitchen', 'manager']) S[r] = await staffClient(S.admin, r)
  S.menu = await menu()
  S.table = await newTable(S.admin)
})

test('POS: walk-in order is priced by the server and goes straight to the kitchen', async () => {
  const r = await S.cashier.api('POST', '/api/staff/pos/orders', {
    type: 'walk_in', lines: [{ ...line('OG Smash', 2), price: 1, unitPrice: 1 }], idempotencyKey: (S.walkKey = idem()),
  })
  assert.equal(r.status, 201, JSON.stringify(r.data))
  assert.equal(r.data.bill.total, 17000) // client price fields ignored
  S.walk = r.data.id
  const k = await S.kitchen.api('GET', '/api/staff/kitchen')
  assert.ok(JSON.stringify(k.data).includes(S.walk), 'kitchen sees the POS order')
  const again = await S.cashier.api('POST', '/api/staff/pos/orders', { type: 'walk_in', lines: [line('OG Smash', 2)], idempotencyKey: S.walkKey })
  assert.equal(again.status, 200)
  assert.equal(again.data.id, S.walk, 'double tap returns the same order')
})

test('POS: order types validate their own requirements', async () => {
  const noTable = await S.cashier.api('POST', '/api/staff/pos/orders', { type: 'dine_in', lines: [line('OG Smash')], idempotencyKey: idem() })
  assert.equal(noTable.status, 400)
  const noAddr = await S.cashier.api('POST', '/api/staff/pos/orders', { type: 'delivery', lines: [line('OG Smash')], customerPhone: '07501234567', idempotencyKey: idem() })
  assert.equal(noAddr.status, 400)
  const kitchen = await S.kitchen.api('POST', '/api/staff/pos/orders', { type: 'walk_in', lines: [line('OG Smash')], idempotencyKey: idem() })
  assert.equal(kitchen.status, 403)
})

test('TEST 6: cash payment with change, idempotent, then a receipt', async () => {
  const key = idem()
  const r = await S.cashier.api('POST', '/api/staff/payments', { orderIds: [S.walk], method: 'cash', currency: 'IQD', amount: 17000, tendered: 20000, idempotencyKey: key })
  assert.equal(r.status, 201, JSON.stringify(r.data))
  assert.equal(r.data.payment.baseAmount, 17000)
  assert.equal(r.data.payment.change, 3000)
  const again = await S.cashier.api('POST', '/api/staff/payments', { orderIds: [S.walk], method: 'cash', currency: 'IQD', amount: 17000, tendered: 20000, idempotencyKey: key })
  assert.equal(again.status, 200)
  assert.equal(again.data.payment.id, r.data.payment.id, 'retry returns the original payment')
  const bill = await S.cashier.api('GET', `/api/staff/bills/order/${S.walk}`)
  assert.equal(bill.data.due, 0)
  assert.equal(bill.data.orders[0].paymentStatus, 'paid')
  const more = await pay(S.cashier, { orderIds: [S.walk], method: 'cash', currency: 'IQD', amount: 1000 })
  assert.equal(more.status, 409, 'cannot pay a paid bill')
  const rc = await S.cashier.api('POST', '/api/staff/receipts', { orderIds: [S.walk] })
  assert.equal(rc.status, 200)
  assert.equal(rc.data.total, 17000)
  assert.equal(rc.data.payments.length, 1)
  assert.equal(rc.data.reprint, false)
  const rc2 = await S.cashier.api('POST', '/api/staff/receipts', { orderIds: [S.walk] })
  assert.equal(rc2.data.reprint, true, 'second print is marked as a reprint')
})

test('payments: validation of method, cash received, reference and roles', async () => {
  const o = await S.cashier.api('POST', '/api/staff/pos/orders', { type: 'takeaway', lines: [line('OG Smash')], customerName: 'Lana', idempotencyKey: idem() })
  S.take = o.data.id
  assert.equal((await pay(S.cashier, { orderIds: [S.take], method: 'bitcoin', currency: 'IQD', amount: 8500 })).status, 400)
  assert.equal((await pay(S.cashier, { orderIds: [S.take], method: 'cash', currency: 'IQD', amount: 8500, tendered: 5000 })).status, 400)
  assert.equal((await pay(S.cashier, { orderIds: [S.take], method: 'card', currency: 'IQD', amount: 8500, tendered: 9000 })).status, 400)
  assert.equal((await pay(S.cashier, { orderIds: [S.take], method: 'transfer', currency: 'IQD', amount: 8500 })).data.code, 'reference_required')
  assert.equal((await pay(S.cashier, { orderIds: [S.take], method: 'cash', currency: 'IQD', amount: 9000 })).data.code, 'overpayment')
  assert.equal((await pay(S.waiter, { orderIds: [S.take], method: 'cash', currency: 'IQD', amount: 8500 })).status, 403, 'waiters do not take money')
  assert.equal((await pay(S.cashier, { orderIds: [S.take], method: 'card', currency: 'IQD', amount: 8500 })).status, 201)
})

test('currency: USD is refused until a rate is set, then converted at that rate', async () => {
  const o = await S.cashier.api('POST', '/api/staff/pos/orders', { type: 'walk_in', lines: [line('OG Smash', 2)], idempotencyKey: idem() })
  S.usd = o.data.id // 17000 IQD
  const before = await pay(S.cashier, { orderIds: [S.usd], method: 'cash', currency: 'USD', amount: 1000 })
  assert.equal(before.status, 409)
  assert.equal(before.data.code, 'no_rate')
  const cfg0 = await S.cashier.api('GET', '/api/staff/pos/config')
  assert.deepEqual(cfg0.data.currencies, ['IQD'])
  const set = await S.admin.api('PUT', '/api/admin/settings', { exchangeRates: { USD: 1310 } })
  assert.equal(set.status, 200)
  assert.ok(set.data.settings.exchangeRatesUpdatedAt, 'rate change is timestamped by the server')
  assert.equal((await S.admin.api('PUT', '/api/admin/settings', { exchangeRatesUpdatedAt: '2000-01-01' })).status, 400)
  const cfg = await S.cashier.api('GET', '/api/staff/pos/config')
  assert.deepEqual(cfg.data.currencies, ['IQD', 'USD'])
  // $10.00 at 1310 = 13100 IQD, leaving 3900; guest hands over $20 -> change in IQD
  const p = await pay(S.cashier, { orderIds: [S.usd], method: 'cash', currency: 'USD', amount: 1000, tendered: 2000 })
  assert.equal(p.status, 201, JSON.stringify(p.data))
  assert.equal(p.data.payment.baseAmount, 13100)
  assert.equal(p.data.payment.rate, 1310)
  assert.equal(p.data.payment.change, 13100)
  const bill = await S.cashier.api('GET', `/api/staff/bills/order/${S.usd}`)
  assert.equal(bill.data.due, 3900)
  assert.equal(bill.data.orders[0].paymentStatus, 'partial')
  // Rest in USD rounded up to the cent ($2.98 = 3903.8 IQD) is absorbed, not rejected as an overpayment.
  const rest = await pay(S.cashier, { orderIds: [S.usd], method: 'card', currency: 'USD', amount: 298 })
  assert.equal(rest.status, 201, JSON.stringify(rest.data))
  assert.equal(rest.data.payment.baseAmount, 3900)
  assert.equal((await S.cashier.api('GET', `/api/staff/bills/order/${S.usd}`)).data.orders[0].paymentStatus, 'paid')
  // Change is computed from what was applied, not from the rounded-up USD amount.
  const o2 = await S.cashier.api('POST', '/api/staff/pos/orders', { type: 'walk_in', lines: [line('OG Smash', 2), line('Loaded Fries')], idempotencyKey: idem() })
  // 24500 IQD = $18.71 rounded up (24510.1 IQD); guest hands over $50 = 65500 IQD -> change 41000, not 40990
  const c = await pay(S.cashier, { orderIds: [o2.data.id], method: 'cash', currency: 'USD', amount: 1871, tendered: 5000 })
  assert.equal(c.status, 201, JSON.stringify(c.data))
  assert.equal(c.data.payment.baseAmount, 24500)
  assert.equal(c.data.payment.change, 41000)
})

test('TEST 4 + TEST 5: table orders twice, asks for the bill, cashier settles the whole table', async () => {
  const g = await guestAt(S.table)
  for (const name of ['OG Smash', 'All American']) {
    const r = await g.api('POST', '/api/orders', { lines: [line(name)], idempotencyKey: idem() })
    assert.equal(r.status, 201, JSON.stringify(r.data))
  }
  const req = await g.api('POST', '/api/requests', { type: 'bill' })
  assert.ok([200, 201].includes(req.status), JSON.stringify(req.data))
  const notes = await S.cashier.api('GET', '/api/staff/notifications')
  assert.ok(notes.data.notifications.some((n) => n.kind === 'bill' && n.title.includes(S.table.number)), 'cashier is notified')
  const bills = await S.cashier.api('GET', '/api/staff/bills')
  const mine = bills.data.bills.find((b) => b.tableId === S.table.id)
  assert.ok(mine?.billRequestedAt, 'table is flagged as asking for the bill')
  assert.equal(mine.orders, 2, 'both orders from the session are on one bill')
  const bill = await S.cashier.api('GET', `/api/staff/bills/table/${S.table.id}`)
  assert.equal(bill.data.total, 17000)
  assert.equal(bill.data.paid, 0, 'asking for the bill does not mark anything paid')
  S.tableOrders = bill.data.orders.map((o) => o.id)

  // Split three ways: the shares add up exactly.
  const shares = [5667, 5667, 5666]
  for (const amount of shares) assert.equal((await pay(S.cashier, { orderIds: S.tableOrders, method: 'cash', currency: 'IQD', amount })).status, 201)
  const after = await S.cashier.api('GET', `/api/staff/bills/table/${S.table.id}`)
  assert.equal(after.data.due, 0)
  assert.equal(after.data.orders.length, 0, 'nothing left on the table bill')
  const reqs = await S.waiter.api('GET', '/api/staff/requests')
  assert.ok(!reqs.data.requests.some((r) => r.table === S.table.number && r.type === 'bill' && r.status !== 'completed'), 'bill request closed')
})

test('concurrency: two cashiers paying the same bill at once charge it only once', async () => {
  const o = await S.cashier.api('POST', '/api/staff/pos/orders', { type: 'walk_in', lines: [line('OG Smash')], idempotencyKey: idem() })
  const cashier2 = await staffClient(S.admin, 'cashier', 'cash2')
  const results = await Promise.all([
    pay(S.cashier, { orderIds: [o.data.id], method: 'card', currency: 'IQD', amount: 8500 }),
    pay(cashier2, { orderIds: [o.data.id], method: 'card', currency: 'IQD', amount: 8500 }),
  ])
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409])
  const bill = await S.cashier.api('GET', `/api/staff/bills/order/${o.data.id}`)
  assert.equal(bill.data.paid, 8500)
})

test('refunds: money must be refunded before an order can be cancelled; only managers refund', async () => {
  const o = await S.cashier.api('POST', '/api/staff/pos/orders', { type: 'walk_in', lines: [line('OG Smash')], idempotencyKey: idem() })
  const p = await pay(S.cashier, { orderIds: [o.data.id], method: 'cash', currency: 'IQD', amount: 8500 })
  const cancel = await S.manager.api('POST', `/api/staff/orders/${o.data.id}/transition`, { to: 'cancelled', reason: 'Guest left' })
  assert.equal(cancel.status, 409)
  assert.equal(cancel.data.code, 'refund_first')
  const byCashier = await S.cashier.api('POST', `/api/staff/payments/${p.data.payment.id}/refund`, { reason: 'x', idempotencyKey: idem() })
  assert.equal(byCashier.status, 403)
  const noReason = await S.manager.api('POST', `/api/staff/payments/${p.data.payment.id}/refund`, { idempotencyKey: idem() })
  assert.equal(noReason.status, 400)
  const part = await S.manager.api('POST', `/api/staff/payments/${p.data.payment.id}/refund`, { amount: 3000, reason: 'Cold fries', idempotencyKey: idem() })
  assert.equal(part.status, 201, JSON.stringify(part.data))
  assert.equal((await S.manager.api('GET', `/api/staff/bills/order/${o.data.id}`)).data.orders[0].paymentStatus, 'partial')
  const over = await S.manager.api('POST', `/api/staff/payments/${p.data.payment.id}/refund`, { amount: 6000, reason: 'x', idempotencyKey: idem() })
  assert.equal(over.data.code, 'over_refund')
  const rest = await S.manager.api('POST', `/api/staff/payments/${p.data.payment.id}/refund`, { reason: 'Guest left', idempotencyKey: idem() })
  assert.equal(rest.status, 201)
  assert.equal(rest.data.refund.baseAmount, 5500)
  assert.equal((await S.manager.api('GET', `/api/staff/bills/order/${o.data.id}`)).data.orders[0].paymentStatus, 'refunded')
  const ok = await S.manager.api('POST', `/api/staff/orders/${o.data.id}/transition`, { to: 'cancelled', reason: 'Guest left' })
  assert.equal(ok.status, 200, JSON.stringify(ok.data))
})

test('void: a mistaken payment is voided, not deleted, and the order owes again', async () => {
  const o = await S.cashier.api('POST', '/api/staff/pos/orders', { type: 'walk_in', lines: [line('OG Smash')], idempotencyKey: idem() })
  const p = await pay(S.cashier, { orderIds: [o.data.id], method: 'card', currency: 'IQD', amount: 8500 })
  const v = await S.manager.api('POST', `/api/staff/payments/${p.data.payment.id}/void`, { reason: 'Card declined after all' })
  assert.equal(v.status, 200)
  assert.equal(v.data.payment.status, 'voided')
  const bill = await S.cashier.api('GET', `/api/staff/bills/order/${o.data.id}`)
  assert.equal(bill.data.due, 8500)
  const hist = await S.cashier.api('GET', '/api/staff/payments')
  assert.ok(hist.data.payments.some((x) => x.id === p.data.payment.id && x.status === 'voided'), 'voided payment stays in history')
})

test('discounts: cashier limit, manager override, never below what was paid', async () => {
  const o = await S.cashier.api('POST', '/api/staff/pos/orders', { type: 'walk_in', lines: [line('OG Smash', 2)], idempotencyKey: idem() })
  const id = o.data.id
  assert.equal((await S.cashier.api('POST', `/api/staff/orders/${id}/discount`, { kind: 'percent', value: 10 })).status, 400, 'reason required')
  const ten = await S.cashier.api('POST', `/api/staff/orders/${id}/discount`, { kind: 'percent', value: 10, reason: 'Regular' })
  assert.equal(ten.status, 200)
  assert.equal(ten.data.total, 15300)
  assert.equal((await S.cashier.api('POST', `/api/staff/orders/${id}/discount`, { kind: 'percent', value: 50, reason: 'Friend' })).data.code, 'discount_limit')
  assert.equal((await S.waiter.api('POST', `/api/staff/orders/${id}/discount`, { kind: 'percent', value: 5, reason: 'x' })).status, 403)
  await pay(S.cashier, { orderIds: [id], method: 'card', currency: 'IQD', amount: 10000 })
  const below = await S.manager.api('POST', `/api/staff/orders/${id}/discount`, { kind: 'percent', value: 50, reason: 'Complaint' })
  assert.equal(below.data.code, 'below_paid')
  const ok = await S.manager.api('POST', `/api/staff/orders/${id}/discount`, { kind: 'amount', value: 5000, reason: 'Complaint' })
  assert.equal(ok.status, 200)
  assert.equal(ok.data.total, 12000)
  assert.equal(ok.data.due, 2000)
})
