// Customers, loyalty and feedback.
import test from 'node:test'
import assert from 'node:assert/strict'
import { adminClient, client, idem, sql, staffClient, uniq } from './helpers.mjs'

const S = {}
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baghdad' }).format(new Date())
const inDays = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baghdad' }).format(new Date(Date.now() + n * 86400000))
const rnd = () => String(Math.floor(1000000 + Math.random() * 8999999))
const pos = (lines, extra = {}) => S.cashier.api('POST', '/api/staff/pos/orders', { type: 'takeaway', lines, idempotencyKey: idem(), ...extra })
const pay = (id, amount, method = 'card') => S.cashier.api('POST', '/api/staff/payments', { orderIds: [id], method, currency: 'IQD', amount, idempotencyKey: idem() })
const profile = async (id, c = S.manager) => (await c.api('GET', `/api/admin/customers/${id}`)).data.customer
const dish = (q) => [{ itemId: S.item, quantity: q }]

test('setup', async () => {
  S.admin = await adminClient()
  for (const r of ['cashier', 'waiter', 'manager', 'receptionist', 'kitchen']) S[r] = await staffClient(S.admin, r)
  const cat = await S.admin.api('POST', '/api/admin/categories', { nameEn: uniq('Loyalty ') })
  S.item = (await S.admin.api('POST', '/api/admin/items', { categoryId: cat.data.id, name: { en: uniq('Loyal burger ') }, price: 10000 })).data.id
  S.phone = `0750${rnd()}`
})

test('one customer per phone, however it is written: POS orders and bookings share the record', async () => {
  const a = await pos(dish(2), { customerName: 'Hawre', customerPhone: `+964 ${S.phone.slice(1, 4)} ${S.phone.slice(4)}` })
  assert.equal(a.status, 201, JSON.stringify(a.data))
  S.o1 = a.data.id
  const found = await S.manager.api('GET', `/api/admin/customers?q=${S.phone}`)
  assert.equal(found.data.customers.length, 1)
  S.cust = found.data.customers[0].id
  assert.equal(found.data.customers[0].phone, S.phone, 'stored in local form')
  const r = await client().api('POST', '/api/reservations', { name: 'Hawre', phone: `00964${S.phone.slice(1)}`, partySize: 2, date: inDays(4), time: '20:00', idempotencyKey: idem() })
  assert.equal(r.status, 201, JSON.stringify(r.data))
  const p = await profile(S.cust)
  assert.equal(p.reservations.length, 1, 'the booking landed on the same customer')
  assert.equal((await S.manager.api('GET', `/api/admin/customers?q=${S.phone.slice(-4)}`)).data.customers.some((c) => c.id === S.cust), true, 'last digits find them')
})

test('points are earned once, when the order is fully paid, and taken back by a refund', async () => {
  assert.equal((await profile(S.cust)).points, 0, 'nothing for an unpaid order')
  const p1 = await pay(S.o1, 10000)
  assert.equal((await profile(S.cust)).points, 0, 'half paid: still nothing')
  const p2 = await pay(S.o1, 10000)
  assert.equal(p2.status, 201)
  let c = await profile(S.cust)
  assert.equal(c.points, 20, '20000 IQD at 1 point per 1000')
  assert.equal(c.orders.find((o) => o.id === S.o1).earned, 20)
  const ref = await S.manager.api('POST', `/api/staff/payments/${p2.data.payment.id}/refund`, { amount: 5000, reason: 'Wrong burger', idempotencyKey: idem() })
  assert.equal(ref.status, 201)
  c = await profile(S.cust)
  assert.equal(c.points, 0, 'no longer fully paid: points taken back')
  await pay(S.o1, 5000)
  c = await profile(S.cust)
  assert.equal(c.points, 20, 'paid in full again: earned again, once')
  assert.deepEqual(c.ledger.map((t) => `${t.kind}:${t.points}`).reverse(), ['earn:20', 'reverse:-20', 'earn:20'])
  assert.ok(p1.status === 201)
})

test('manual points: managers only, with a reason', async () => {
  assert.equal((await S.cashier.api('POST', `/api/admin/customers/${S.cust}/points`, { points: 500, reason: 'x' })).status, 403)
  assert.equal((await S.manager.api('POST', `/api/admin/customers/${S.cust}/points`, { points: 500 })).status, 400)
  const r = await S.manager.api('POST', `/api/admin/customers/${S.cust}/points`, { points: 500, reason: 'Welcome gift' })
  assert.equal(r.data.balance, 520)
  assert.equal((await S.manager.api('POST', `/api/admin/customers/${S.cust}/points`, { points: -9999, reason: 'oops' })).data.code, 'not_enough_points')
})

test('redeeming points is a discount within limits, earns on what is paid, and shows in finance', async () => {
  const before = (await S.manager.api('GET', `/api/admin/finance/report?from=${today}`)).data.kpis
  const o = await pos(dish(4), { customerPhone: S.phone })
  const id = o.data.id
  const redeem = (points) => S.cashier.api('POST', `/api/staff/orders/${id}/redeem`, { points })
  assert.equal((await redeem(50)).data.code, 'below_minimum')
  assert.equal((await redeem(1000)).data.code, 'over_cap', '1000 points = 25000 > 50% of 40000')
  assert.equal((await S.waiter.api('POST', `/api/staff/orders/${id}/redeem`, { points: 400 })).status, 403)
  const r = await redeem(400)
  assert.equal(r.status, 200, JSON.stringify(r.data))
  assert.equal(r.data.total, 30000)
  assert.equal(r.data.loyaltyDiscount, 10000)
  assert.equal((await profile(S.cust)).points, 120)
  // Changing the redemption puts the old points back first.
  assert.equal((await redeem(200)).data.total, 35000)
  assert.equal((await profile(S.cust)).points, 320)
  assert.equal((await redeem(400)).data.total, 30000)
  await pay(id, 30000)
  const c = await profile(S.cust)
  assert.equal(c.points, 120 + 30, 'earned on the 30000 actually charged')
  const after = (await S.manager.api('GET', `/api/admin/finance/report?from=${today}`)).data.kpis
  assert.equal(after.loyaltyRedeemed - before.loyaltyRedeemed, 10000)
  assert.equal(after.netSales - before.netSales, 30000, 'points reduce net sales; they are not cash')
  assert.equal(after.collected - before.collected, 30000)
  // Too late to use points once money exceeds the new total.
  const paidFirst = await pos(dish(2), { customerPhone: S.phone })
  await pay(paidFirst.data.id, 20000)
  assert.equal((await S.cashier.api('POST', `/api/staff/orders/${paidFirst.data.id}/redeem`, { points: 100 })).data.code, 'below_paid')
})

test('cancelling an order gives back the points used on it', async () => {
  const pts = (await profile(S.cust)).points
  const o = await pos(dish(2), { customerPhone: S.phone })
  await S.cashier.api('POST', `/api/staff/orders/${o.data.id}/redeem`, { points: 100 })
  assert.equal((await profile(S.cust)).points, pts - 100)
  assert.equal((await S.manager.api('POST', `/api/staff/orders/${o.data.id}/transition`, { to: 'cancelled', reason: 'Guest left' })).status, 200)
  assert.equal((await profile(S.cust)).points, pts)
})

test('a customer can be attached at the bill, even after paying, and earns', async () => {
  const phone = `0770${rnd()}`
  const o = await pos(dish(1))
  await pay(o.data.id, 10000)
  const r = await S.cashier.api('POST', `/api/staff/orders/${o.data.id}/customer`, { phone, name: 'Late joiner' })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  assert.equal((await profile(r.data.customerId)).points, 10)
  assert.equal((await S.cashier.api('POST', `/api/staff/orders/${o.data.id}/customer`, { phone: `0771${rnd()}` })).data.code, 'points_earned')
})

test('tiers: lifetime spend upgrades the multiplier', async () => {
  const s0 = (await S.admin.api('GET', '/api/admin/settings')).data.settings.loyaltyTiers
  assert.equal((await S.admin.api('PUT', '/api/admin/settings', { loyaltyTiers: [{ name: 'Member', minSpend: 0, multiplier: 1 }, { name: 'Silver', minSpend: 20000, multiplier: 2 }] })).status, 200)
  const phone = `0751${rnd()}`
  const a = await pos(dish(2), { customerPhone: phone })
  await pay(a.data.id, 20000)
  const cid = (await S.manager.api('GET', `/api/admin/customers?q=${phone}`)).data.customers[0].id
  let c = await profile(cid)
  assert.equal(c.points, 20, 'first order at Member rate')
  assert.equal(c.tier, 'Silver')
  const b = await pos(dish(1), { customerPhone: phone })
  await pay(b.data.id, 10000)
  c = await profile(cid)
  assert.equal(c.points, 20 + 20, 'now Silver: double points')
  await S.admin.api('PUT', '/api/admin/settings', { loyaltyTiers: s0 })
  assert.equal((await S.admin.api('PUT', '/api/admin/settings', { loyaltyTiers: [{ name: 'X', minSpend: 5, multiplier: 1 }] })).status, 400)
})

test('privacy: waiters see a masked phone and no spend; kitchen sees nothing', async () => {
  const w = await S.waiter.api('GET', `/api/admin/customers?q=${S.phone}`)
  assert.equal(w.status, 200)
  const c = w.data.customers.find((x) => x.id === S.cust)
  assert.notEqual(c.phone, S.phone)
  assert.ok(c.phone.includes('•'))
  assert.equal(c.spend, undefined)
  assert.equal(c.email, undefined)
  assert.equal((await S.waiter.api('GET', `/api/admin/customers/${S.cust}`)).data.customer.orders[0].total, undefined)
  assert.equal((await S.kitchen.api('GET', '/api/admin/customers')).status, 403)
  assert.equal((await S.waiter.api('PATCH', `/api/admin/customers/${S.cust}`, { notes: 'x' })).status, 403)
})

test('marketing: only people who opted in are exported, with when they did', async () => {
  const csv = async () => (await S.manager.api('GET', '/api/admin/customers/marketing', undefined, { raw: true })).text()
  assert.ok(!(await csv()).includes(S.phone), 'no consent, not exported')
  const u = await S.receptionist.api('PATCH', `/api/admin/customers/${S.cust}`, { marketingConsent: true, birthday: `1990-${today.slice(5)}`, preferences: 'No onions', notes: 'Allergic to sesame' })
  assert.equal(u.status, 200, JSON.stringify(u.data))
  assert.ok(u.data.customer.consentAt)
  assert.equal(u.data.customer.birthdaySoon, true)
  assert.ok((await csv()).includes(S.phone))
  assert.equal((await S.waiter.api('GET', '/api/admin/customers/marketing')).status, 403)
  const list = await S.manager.api('GET', '/api/admin/customers')
  assert.ok(list.data.birthdays.some((b) => b.id === S.cust))
})

test('forget: personal details are removed everywhere, sales history stays', async () => {
  const phone = `0752${rnd()}`
  const o = await pos(dish(1), { customerPhone: phone, customerName: 'Private Person' })
  await pay(o.data.id, 10000)
  const id = (await S.manager.api('GET', `/api/admin/customers?q=${phone}`)).data.customers[0].id
  assert.equal((await S.cashier.api('POST', `/api/admin/customers/${id}/forget`, {})).status, 403)
  assert.equal((await S.manager.api('POST', `/api/admin/customers/${id}/forget`, {})).status, 200)
  assert.equal((await S.manager.api('GET', `/api/admin/customers?q=${phone}`)).data.customers.length, 0)
  const row = sql().prepare('SELECT o.customer_phone, o.customer_name, o.total, c.name, c.phone, c.loyalty_points FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.public_id = ?').get(o.data.id)
  assert.deepEqual([row.customer_phone, row.customer_name, row.name, row.phone, row.loyalty_points], ['', '', 'Former guest', null, 0])
  assert.equal(row.total, 10000, 'the sale is kept')
})

test('feedback: rate a served order once; reviews wait for approval; the average counts every rating', async () => {
  const o = await pos(dish(1), { customerPhone: S.phone })
  const token = o.data.trackToken
  assert.equal((await client().api('POST', `/api/orders/${token}/feedback`, { rating: 5 })).data.code, 'not_served')
  for (const to of ['preparing', 'ready']) await S.kitchen.api('POST', `/api/staff/orders/${o.data.id}/transition`, { to })
  await S.manager.api('POST', `/api/staff/orders/${o.data.id}/transition`, { to: 'served' })
  assert.equal((await client().api('POST', `/api/orders/${token}/feedback`, { rating: 9 })).status, 400)
  assert.equal((await client().api('POST', `/api/orders/${token}/feedback`, { rating: 1, comment: 'Cold and late' })).status, 201)
  assert.equal((await client().api('POST', `/api/orders/${token}/feedback`, { rating: 5 })).data.code, 'already_rated')
  assert.ok(sql().prepare(`SELECT COUNT(*) n FROM notifications WHERE kind = 'feedback' AND title LIKE '1-star%'`).get().n >= 1, 'a bad rating alerts managers')
  assert.ok((await profile(S.cust)).feedback.some((f) => f.comment === 'Cold and late'), 'linked to the customer')

  const text = uniq('Great smash burgers ')
  assert.equal((await client().api('POST', '/api/feedback', { name: 'Aso', rating: 5, comment: text })).status, 201)
  let pub = (await client().api('GET', '/api/feedback')).data
  assert.ok(!pub.reviews.some((r) => r.comment === text), 'not public before approval')
  const pending = (await S.manager.api('GET', '/api/admin/feedback?status=pending')).data.feedback
  const mine = pending.find((f) => f.comment === text)
  const bad = pending.find((f) => f.comment === 'Cold and late')
  assert.equal((await S.waiter.api('PATCH', '/api/admin/feedback', { id: mine.id, status: 'published' })).status, 403)
  await S.manager.api('PATCH', '/api/admin/feedback', { id: mine.id, status: 'published', reply: 'Thank you!' })
  await S.manager.api('PATCH', '/api/admin/feedback', { id: bad.id, status: 'hidden' })
  pub = (await client().api('GET', '/api/feedback')).data
  const shown = pub.reviews.find((r) => r.comment === text)
  assert.equal(shown.reply, 'Thank you!')
  assert.ok(!pub.reviews.some((r) => r.comment === 'Cold and late'), 'hidden comment is not shown')
  const all = sql().prepare('SELECT COUNT(*) n, AVG(rating) a FROM feedback').get()
  assert.equal(pub.count, all.n, 'every rating counts')
  assert.equal(pub.average, Math.round(all.a * 10) / 10, 'hiding a comment does not change the average')
})
