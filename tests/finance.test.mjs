// Finance and reports. Other test files share the database, so this file checks exact CHANGES in
// today's report caused by a known set of operations, rather than absolute totals.
import test from 'node:test'
import assert from 'node:assert/strict'
import { adminClient, idem, staffClient, uniq } from './helpers.mjs'

const S = {}
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baghdad' }).format(new Date())
const report = async (c = S.manager) => {
  const r = await c.api('GET', `/api/admin/finance/report?from=${today}&to=${today}`)
  assert.equal(r.status, 200, JSON.stringify(r.data))
  return r.data
}
const pos = (lines) => S.cashier.api('POST', '/api/staff/pos/orders', { type: 'walk_in', lines, idempotencyKey: idem() })
const pay = (orderId, method, amount) => S.cashier.api('POST', '/api/staff/payments', { orderIds: [orderId], method, currency: 'IQD', amount, idempotencyKey: idem() })

test('setup: a priced dish with a known recipe cost', async () => {
  S.admin = await adminClient()
  for (const r of ['manager', 'cashier', 'waiter', 'inventory', 'kitchen']) S[r] = await staffClient(S.admin, r)
  const cat = await S.admin.api('POST', '/api/admin/categories', { nameEn: uniq('Finance ') })
  S.cat = cat.data.id
  S.name = uniq('Ledger burger ')
  S.item = (await S.admin.api('POST', '/api/admin/items', { categoryId: S.cat, name: { en: S.name }, price: 10000 })).data.id
  const beef = await S.inventory.api('POST', '/api/admin/inventory/ingredients', { name: uniq('Ledger beef '), unit: 'g', unitCost: 10, openingStock: 5000 })
  S.beef = beef.data.id
  assert.equal((await S.inventory.api('PUT', '/api/admin/inventory/recipes', { itemId: S.item, lines: [{ ingredientId: S.beef, qty: 100 }] })).status, 200)
})

test('permissions: only managers and owners see the money', async () => {
  for (const r of ['waiter', 'cashier', 'inventory', 'kitchen']) {
    assert.equal((await S[r].api('GET', `/api/admin/finance/report?from=${today}&to=${today}`)).status, 403, r)
    assert.equal((await S[r].api('GET', `/api/admin/finance/export?report=products&from=${today}`)).status, 403, r)
  }
  assert.equal((await S.cashier.api('POST', '/api/admin/finance/expenses', { date: today, category: 'rent', description: 'x', amount: 1 })).status, 403)
  assert.equal((await S.manager.api('GET', `/api/admin/finance/report?from=${today}&to=2000-01-01`)).status, 400)
})

test('the report moves by exactly what happened: sales, discounts, collections, refunds, cost, waste, expenses', async () => {
  const before = await report()
  const line = (q) => [{ itemId: S.item, quantity: q }]
  const a = await pos(line(2)) // 20000, paid in cash, later 5000 refunded
  const b = await pos(line(1)) // 10000 with 10% off, paid by card
  const c = await pos(line(1)) // cancelled before cooking: not a sale, stock returned
  const d = await pos(line(1)) // never paid
  for (const o of [a, b, c, d]) assert.equal(o.status, 201, JSON.stringify(o.data))
  assert.equal((await S.manager.api('POST', `/api/staff/orders/${b.data.id}/discount`, { kind: 'percent', value: 10, reason: 'Regular' })).status, 200)
  const pa = await pay(a.data.id, 'cash', 20000)
  assert.equal((await pay(b.data.id, 'card', 9000)).status, 201)
  assert.equal((await S.manager.api('POST', `/api/staff/orders/${c.data.id}/transition`, { to: 'cancelled', reason: 'Wrong table' })).status, 200)
  assert.equal((await S.manager.api('POST', `/api/staff/payments/${pa.data.payment.id}/refund`, { amount: 5000, reason: 'Cold food', idempotencyKey: idem() })).status, 201)
  assert.equal((await S.inventory.api('POST', '/api/admin/inventory/movements', { ingredientId: S.beef, kind: 'waste', quantity: 50, reason: 'Dropped' })).status, 201)
  const exp = await S.manager.api('POST', '/api/admin/finance/expenses', { date: today, category: 'salaries', description: 'Part-time cook', amount: 30000, method: 'cash' })
  assert.equal(exp.status, 201, JSON.stringify(exp.data))

  const after = await report()
  const dk = (k) => after.kpis[k] - before.kpis[k]
  assert.equal(dk('orders'), 3, 'A, B and D are sales; the cancelled one is not')
  assert.equal(dk('cancelledOrders'), 1)
  assert.equal(dk('subtotal'), 40000)
  assert.equal(dk('discounts'), 1000)
  assert.equal(dk('netSales'), 39000)
  assert.equal(dk('collected'), 20000 + 9000 - 5000)
  assert.equal(dk('refunds'), 5000)
  assert.equal(dk('outstanding'), 10000 + 5000, 'D unpaid, and A owes again what was refunded')
  assert.equal(dk('cogs'), 4 * 1000, '100 g at 10 IQD per burger; the cancelled order gave its beef back')
  assert.equal(dk('waste'), 500)
  assert.equal(dk('expenses'), 30000)
  assert.equal(dk('netProfit'), 39000 - 4000 - 500 - 30000)
  assert.ok(after.kpis.recipeCoverage !== null)

  const p = after.products.find((x) => x.name === S.name)
  assert.equal(p.quantity, 4)
  assert.equal(p.revenue, 40000)
  assert.equal(p.estimatedCost, 4000)
  assert.equal(p.marginPercent, 90)
  const m = (rep, method) => rep.methods.filter((x) => x.method === method).reduce((s, x) => s + x.net, 0)
  assert.equal(m(after, 'cash') - m(before, 'cash'), 15000)
  assert.equal(m(after, 'card') - m(before, 'card'), 9000)
  const day = (rep) => rep.daily.find((x) => x.date === today)
  assert.equal(day(after).netSales - day(before).netSales, 39000)
  assert.equal(after.daily.length, 1)
  assert.ok(after.previous.from < today, 'compared with the day before')
  assert.ok(after.refunds.some((x) => x.reason === 'Cold food'))
  assert.ok(after.waste.some((w) => w.value >= 500))
  S.expenseId = exp.data.id
})

test('expenses: validation and voiding (never deleted)', async () => {
  const bad = (b) => S.manager.api('POST', '/api/admin/finance/expenses', { date: today, category: 'rent', description: 'Rent', amount: 100, ...b })
  assert.equal((await bad({ category: 'yacht' })).status, 400)
  assert.equal((await bad({ amount: 12.5 })).status, 400)
  assert.equal((await bad({ date: '2999-01-01' })).status, 400)
  const before = (await report()).kpis.expenses
  assert.equal((await S.manager.api('PATCH', '/api/admin/finance/expenses', { id: S.expenseId })).status, 400, 'reason required')
  assert.equal((await S.manager.api('PATCH', '/api/admin/finance/expenses', { id: S.expenseId, reason: 'Entered twice' })).status, 200)
  assert.equal((await report()).kpis.expenses, before - 30000)
  const list = await S.manager.api('GET', `/api/admin/finance/expenses?from=${today}`)
  assert.ok(list.data.expenses.some((e) => e.id === S.expenseId && e.status === 'voided'))
})

test('exports: CSV keeps numbers as numbers and neutralises formulas; Excel is a real workbook', async () => {
  await S.manager.api('POST', '/api/admin/finance/expenses', { date: today, category: 'other', description: '=HYPERLINK("http://evil","x")', amount: 1234 })
  const csv = await S.manager.api('GET', `/api/admin/finance/export?report=expenses&format=csv&from=${today}`, undefined, { raw: true })
  assert.equal(csv.status, 200)
  assert.match(csv.headers.get('content-disposition'), /expenses-.*\.csv/)
  const text = await csv.text()
  assert.ok(text.includes(`"'=HYPERLINK(""http://evil"",""x"")"`), 'formula is quoted as text')
  assert.ok(/,1234,/.test(text), 'amount stays a plain number')
  const prod = await (await S.manager.api('GET', `/api/admin/finance/export?report=products&from=${today}`, undefined, { raw: true })).text()
  assert.ok(prod.includes(S.name))
  assert.equal((await S.manager.api('GET', `/api/admin/finance/export?report=all&format=csv&from=${today}`)).status, 400)
  const x = await S.manager.api('GET', `/api/admin/finance/export?report=all&format=xlsx&from=${today}`, undefined, { raw: true })
  assert.equal(x.status, 200)
  const buf = Buffer.from(await x.arrayBuffer())
  assert.equal(buf.subarray(0, 4).toString('hex'), '504b0304', 'zip signature')
  for (const part of ['[Content_Types].xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet10.xml']) assert.ok(buf.includes(Buffer.from(part)), part)
  assert.equal((await S.manager.api('GET', `/api/admin/finance/export?report=nope&from=${today}`)).status, 400)
})

test('dashboard: managers only; money matches the finance report; live counts present', async () => {
  for (const r of ['waiter', 'cashier', 'kitchen']) assert.equal((await S[r].api('GET', '/api/admin/dashboard')).status, 403, r)
  const d = await S.manager.api('GET', `/api/admin/dashboard?from=${today}`)
  assert.equal(d.status, 200, JSON.stringify(d.data))
  const f = await report()
  assert.equal(d.data.kpis.netSales, f.kpis.netSales)
  assert.equal(d.data.kpis.netProfit, f.kpis.netProfit)
  assert.equal(d.data.chart.length, 24, 'one day = by hour')
  for (const k of ['awaitingVerification', 'inKitchen', 'ready', 'openRequests', 'unpaidOrders']) assert.equal(typeof d.data.live[k], 'number', k)
  assert.ok(d.data.live.unpaidValue >= 15000, 'this file left 15000 unpaid')
  assert.ok(d.data.best.length > 0)
  assert.ok(d.data.activity.length > 0)
})
