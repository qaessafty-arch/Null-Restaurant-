import 'server-only'
import { all, get, run, tx } from './db'
import { ApiError } from './http'
import { audit, type Staff } from './auth'
import { publish } from './events'
import { getSettings } from './settings'
import { randomToken } from './security'
import { can } from '../permissions'
import { isCurrency, orderTotals, toBase, type Currency } from '../money'
import { syncLoyalty } from './customers'

/**
 * Payments. The only way an order becomes paid is a completed payment row allocated to it.
 * Every write runs in one immediate transaction that re-reads balances first, so two cashiers
 * cannot both settle the same bill, and a retried request (same idempotency key) returns the
 * original payment instead of charging twice.
 */

const iso = (s: string | null) => (s ? s.replace(' ', 'T') + 'Z' : null)
const UNPAYABLE = ['cancelled', 'rejected']

type OrderMoney = {
  id: number; public_id: string; number: number; type: string; table_id: number | null; table_number: string; status: string
  subtotal: number; discount: number; discount_reason: string; tax: number; service_charge: number; total: number
  payment_status: string; tax_rate: number; service_rate: number; customer_name: string; created_at: string
  loyalty_discount: number; loyalty_points_used: number; loyalty_points_earned: number; customer_id: number | null
}

/** Net amount paid per order (payments minus refunds, completed rows only). */
export function paidFor(orderIds: number[]): Map<number, number> {
  if (!orderIds.length) return new Map()
  const rows = all<{ order_id: number; paid: number }>(
    `SELECT a.order_id, SUM(CASE p.kind WHEN 'payment' THEN a.amount ELSE -a.amount END) paid
     FROM payment_allocations a JOIN payments p ON p.id = a.payment_id
     WHERE p.status = 'completed' AND a.order_id IN (${orderIds.map(() => '?').join(',')}) GROUP BY a.order_id`, ...orderIds)
  return new Map(rows.map((r) => [r.order_id, r.paid]))
}

function hasRefunds(orderId: number) {
  return !!get(`SELECT 1 FROM payment_allocations a JOIN payments p ON p.id = a.payment_id
    WHERE a.order_id = ? AND p.kind = 'refund' AND p.status = 'completed' LIMIT 1`, orderId)
}

/** Recomputes the cached payment_status from the ledger. Call inside the transaction that changed it. */
export function refreshPaymentStatus(orderId: number) {
  const o = get<{ total: number }>('SELECT total FROM orders WHERE id = ?', orderId)
  if (!o) return
  const paid = paidFor([orderId]).get(orderId) ?? 0
  const status = paid >= o.total && (o.total > 0 || !hasRefunds(orderId)) ? 'paid'
    : paid > 0 ? 'partial'
    : hasRefunds(orderId) ? 'refunded'
    : 'unpaid'
  run(`UPDATE orders SET payment_status = ?, updated_at = datetime('now') WHERE id = ?`, status, orderId)
  syncLoyalty(orderId) // points follow payment: earned when fully paid, taken back if refunded
}

function customerOf(id: number | null) {
  if (!id) return null
  const c = get<{ id: number; name: string; tier: string; loyalty_points: number; preferences: string; forgotten_at: string | null }>(
    'SELECT id, name, tier, loyalty_points, preferences, forgotten_at FROM customers WHERE id = ?', id)
  return c && !c.forgotten_at ? { id: c.id, name: c.name, tier: c.tier, points: c.loyalty_points, preferences: c.preferences } : null
}

function view(o: OrderMoney, paid: number) {
  return {
    id: o.public_id, number: o.number, label: `ORD-${o.number}`, type: o.type, tableNumber: o.table_number, status: o.status,
    customerName: o.customer_name, customerId: o.customer_id, subtotal: o.subtotal, discount: o.discount, discountReason: o.discount_reason,
    loyaltyDiscount: o.loyalty_discount, loyaltyPoints: o.loyalty_points_used, pointsEarned: o.loyalty_points_earned, customer: customerOf(o.customer_id),
    tax: o.tax, serviceCharge: o.service_charge, total: o.total, paid, due: Math.max(0, o.total - paid),
    paymentStatus: o.payment_status, createdAt: iso(o.created_at),
    items: all<{ name: string; quantity: number; line_total: number; options: string | null }>(
      `SELECT oi.name, oi.quantity, oi.line_total,
         (SELECT GROUP_CONCAT(option_name, ', ') FROM order_item_options WHERE order_item_id = oi.id) AS options
       FROM order_items oi WHERE oi.order_id = ? ORDER BY oi.id`, o.id,
    ).map((i) => ({ name: i.name, quantity: i.quantity, lineTotal: i.line_total, options: i.options ?? '' })),
  }
}

function summarise(orders: OrderMoney[]) {
  const paid = paidFor(orders.map((o) => o.id))
  const list = orders.map((o) => view(o, paid.get(o.id) ?? 0))
  const sum = (k: 'subtotal' | 'discount' | 'loyaltyDiscount' | 'tax' | 'serviceCharge' | 'total' | 'paid' | 'due') => list.reduce((a, o) => a + o[k], 0)
  return {
    orders: list,
    subtotal: sum('subtotal'), discount: sum('discount'), loyaltyDiscount: sum('loyaltyDiscount'), tax: sum('tax'), serviceCharge: sum('serviceCharge'),
    total: sum('total'), paid: sum('paid'), due: sum('due'),
  }
}

/** Everything a table still owes: every non-cancelled order that is not fully paid. */
export function tableBill(tableId: number) {
  const t = get<{ id: number; number: string; location: string }>('SELECT id, number, location FROM tables WHERE id = ?', tableId)
  if (!t) throw new ApiError(404, 'Table not found', 'not_found')
  const orders = all<OrderMoney>(
    `SELECT * FROM orders WHERE table_id = ? AND status NOT IN ('cancelled','rejected') AND payment_status != 'paid' ORDER BY id`, tableId)
  const billRequest = get<{ id: number; created_at: string }>(
    `SELECT id, created_at FROM service_requests WHERE table_id = ? AND type = 'bill' AND status != 'completed' ORDER BY id DESC LIMIT 1`, tableId)
  return { table: { id: t.id, number: t.number, location: t.location }, billRequestedAt: iso(billRequest?.created_at ?? null), ...summarise(orders) }
}

export function orderBill(publicId: string) {
  const o = get<OrderMoney>('SELECT * FROM orders WHERE public_id = ?', publicId)
  if (!o) throw new ApiError(404, 'Order not found', 'not_found')
  return summarise([o])
}

/** Tables and walk-in/takeaway/delivery orders with money still due, bill requests first. */
export function openBills() {
  const orders = all<OrderMoney & { bill_requested: string | null }>(
    `SELECT o.*, (SELECT MAX(r.created_at) FROM service_requests r WHERE r.table_id = o.table_id AND r.type = 'bill' AND r.status != 'completed') AS bill_requested
     FROM orders o WHERE o.status NOT IN ('cancelled','rejected') AND o.payment_status != 'paid' ORDER BY o.id`)
  const paid = paidFor(orders.map((o) => o.id))
  const groups = new Map<string, { key: string; kind: 'table' | 'order'; tableId: number | null; label: string; orders: number; total: number; due: number; billRequestedAt: string | null; since: string | null }>()
  for (const o of orders) {
    const key = o.table_id ? `t${o.table_id}` : `o${o.public_id}`
    const g = groups.get(key) ?? {
      key, kind: o.table_id ? 'table' as const : 'order' as const, tableId: o.table_id,
      label: o.table_id ? `Table ${o.table_number}` : `${o.type.replace('_', '-')} ORD-${o.number}${o.customer_name ? ` · ${o.customer_name}` : ''}`,
      orders: 0, total: 0, due: 0, billRequestedAt: iso(o.bill_requested), since: iso(o.created_at),
    }
    g.orders += 1; g.total += o.total; g.due += Math.max(0, o.total - (paid.get(o.id) ?? 0))
    groups.set(key, g)
  }
  return [...groups.values()].filter((g) => g.due > 0 || g.total === 0)
    .sort((a, b) => Number(!!b.billRequestedAt) - Number(!!a.billRequestedAt) || (a.since ?? '').localeCompare(b.since ?? ''))
}

// ---------------------------------------------------------------- take a payment

export type PaymentInput = {
  orderIds: string[]           // public ids of the orders this payment settles (oldest are filled first)
  method: string
  currency: string
  amount: number               // in the payment currency's minor units: what is applied to the bill
  tendered?: number | null     // cash only, same currency: what the guest handed over
  reference?: string
  note?: string
  idempotencyKey: string
}

function rateFor(currency: Currency) {
  const s = getSettings()
  const base = (isCurrency(s.currency) ? s.currency : 'IQD') as Currency
  if (!s.acceptedCurrencies.includes(currency)) throw new ApiError(400, `${currency} is not accepted`, 'currency_not_accepted')
  if (currency === base) return { base, rate: 1 }
  const rate = s.exchangeRates[currency]
  if (!(rate > 0)) throw new ApiError(409, `Set the ${currency} exchange rate in Settings before accepting ${currency}`, 'no_rate')
  return { base, rate }
}

function paymentView(id: number) {
  const p = get<{
    id: number; public_id: string; kind: string; method: string; currency: string; amount: number; rate: number; base_amount: number
    tendered: number | null; change_base: number; reference: string; note: string; status: string; void_reason: string
    created_at: string; cashier: string | null; refund_of: number | null
  }>(`SELECT p.*, s.name AS cashier FROM payments p LEFT JOIN staff s ON s.id = p.created_by WHERE p.id = ?`, id)!
  const orders = all<{ public_id: string; number: number; amount: number }>(
    `SELECT o.public_id, o.number, a.amount FROM payment_allocations a JOIN orders o ON o.id = a.order_id WHERE a.payment_id = ? ORDER BY o.id`, id)
  const refunded = p.kind === 'payment'
    ? get<{ s: number | null }>(`SELECT SUM(base_amount) s FROM payments WHERE refund_of = ? AND status = 'completed'`, id)!.s ?? 0 : 0
  return {
    id: p.public_id, kind: p.kind, method: p.method, currency: p.currency, amount: p.amount, rate: p.rate, baseAmount: p.base_amount,
    tendered: p.tendered, change: p.change_base, reference: p.reference, note: p.note, status: p.status, voidReason: p.void_reason,
    cashier: p.cashier, createdAt: iso(p.created_at), refunded,
    orders: orders.map((o) => ({ id: o.public_id, label: `ORD-${o.number}`, amount: o.amount })),
  }
}

export function takePayment(staff: Staff, input: PaymentInput) {
  const key = String(input.idempotencyKey ?? '')
  if (key.length < 8 || key.length > 80) throw new ApiError(400, 'Missing idempotency key', 'invalid')
  const s = getSettings()
  const method = s.paymentMethods.find((m) => m.id === input.method && m.enabled)
  if (!method) throw new ApiError(400, 'That payment method is not available', 'invalid_method')
  if (!isCurrency(input.currency)) throw new ApiError(400, 'Unknown currency', 'invalid_currency')
  const currency = input.currency
  const amount = Number(input.amount)
  if (!Number.isInteger(amount) || amount <= 0 || amount > 1_000_000_000) throw new ApiError(400, 'Enter an amount to pay', 'invalid_amount')
  const ids = [...new Set((input.orderIds ?? []).map(String))]
  if (!ids.length || ids.length > 50) throw new ApiError(400, 'Choose what is being paid', 'invalid')
  const cash = method.kind === 'cash'
  const tendered = input.tendered === undefined || input.tendered === null ? null : Number(input.tendered)
  if (tendered !== null && (!cash || !Number.isInteger(tendered) || tendered < amount))
    throw new ApiError(400, cash ? 'Cash received must cover the amount' : 'Only cash payments take a received amount', 'invalid_tendered')
  const reference = String(input.reference ?? '').trim().slice(0, 80)
  if ((method.kind === 'transfer' || method.kind === 'online') && !reference)
    throw new ApiError(400, 'Enter the transaction reference so this payment can be checked', 'reference_required')

  const out = tx(() => {
    const dup = get<{ id: number }>('SELECT id FROM payments WHERE created_by = ? AND idempotency_key = ?', staff.id, key)
    if (dup) return { id: dup.id, duplicate: true }

    const orders = all<OrderMoney>(`SELECT * FROM orders WHERE public_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`, ...ids)
    if (orders.length !== ids.length) throw new ApiError(404, 'An order on this bill no longer exists', 'not_found')
    if (orders.some((o) => UNPAYABLE.includes(o.status))) throw new ApiError(409, 'A cancelled order cannot be paid', 'order_cancelled')
    const paid = paidFor(orders.map((o) => o.id))
    const dues = orders.map((o) => ({ o, due: Math.max(0, o.total - (paid.get(o.id) ?? 0)) }))
    const totalDue = dues.reduce((a, d) => a + d.due, 0)
    if (totalDue <= 0) throw new ApiError(409, 'This bill is already paid', 'already_paid')

    const { base, rate } = rateFor(currency)
    let applied = toBase(amount, currency, base, rate)
    // Paying a foreign-currency amount rounded up to the cent may land a few dinars over: absorb that.
    const oneMinor = currency === base ? 0 : Math.ceil(rate / 10 ** (currency === 'USD' ? 2 : 0))
    if (applied > totalDue && applied - totalDue <= oneMinor) applied = totalDue
    if (applied > totalDue) throw new ApiError(409, 'That is more than the bill. Enter the cash received to give change.', 'overpayment')
    if (applied <= 0) throw new ApiError(400, 'Enter an amount to pay', 'invalid_amount')
    // Change is what was handed over minus what was actually applied to the bill.
    const change = tendered !== null ? toBase(tendered, currency, base, rate) - applied : 0

    const tableId = orders.every((o) => o.table_id === orders[0].table_id) ? orders[0].table_id : null
    const r = run(
      `INSERT INTO payments (public_id, kind, method, currency, amount, rate, base_amount, tendered, change_base, reference, note, table_id, created_by, idempotency_key)
       VALUES (?, 'payment', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      randomToken(9), method.id, currency, amount, rate, applied, tendered, Math.max(0, change), reference,
      String(input.note ?? '').trim().slice(0, 200), tableId, staff.id, key)
    const paymentId = Number(r.lastInsertRowid)
    let left = applied
    for (const { o, due } of dues) {
      if (left <= 0) break
      const part = Math.min(due, left)
      if (part <= 0) continue
      run('INSERT INTO payment_allocations (payment_id, order_id, amount) VALUES (?,?,?)', paymentId, o.id, part)
      left -= part
      refreshPaymentStatus(o.id)
    }
    // A table that now owes nothing has had its bill handled.
    if (tableId && totalDue - applied <= 0) {
      const stillOwed = all<{ id: number }>(`SELECT id FROM orders WHERE table_id = ? AND status NOT IN ('cancelled','rejected') AND payment_status != 'paid'`, tableId)
      if (!stillOwed.length) run(`UPDATE service_requests SET status = 'completed', handled_by = ?, updated_at = datetime('now')
        WHERE table_id = ? AND type = 'bill' AND status != 'completed'`, staff.id, tableId)
    }
    return { id: paymentId, duplicate: false }
  })

  const p = paymentView(out.id)
  if (!out.duplicate) {
    audit(staff, staff.name, 'payment.take', p.id, `${p.method} ${p.currency} ${p.amount} -> ${p.baseAmount} base; ${p.orders.map((o) => o.label).join(',')}`)
    publish('staff', 'payment', { id: p.id })
  }
  return { payment: p, duplicate: out.duplicate }
}

// ---------------------------------------------------------------- refunds and voids

export function refundPayment(staff: Staff, paymentPublicId: string, input: { amount?: number; reason: string; idempotencyKey: string }) {
  const reason = String(input.reason ?? '').trim().slice(0, 300)
  if (!reason) throw new ApiError(400, 'Please give a reason', 'reason_required')
  const key = String(input.idempotencyKey ?? '')
  if (key.length < 8 || key.length > 80) throw new ApiError(400, 'Missing idempotency key', 'invalid')
  const out = tx(() => {
    const dup = get<{ id: number }>('SELECT id FROM payments WHERE created_by = ? AND idempotency_key = ?', staff.id, key)
    if (dup) return { id: dup.id, duplicate: true }
    const p = get<{ id: number; kind: string; status: string; base_amount: number; method: string; table_id: number | null }>(
      'SELECT id, kind, status, base_amount, method, table_id FROM payments WHERE public_id = ?', paymentPublicId)
    if (!p || p.kind !== 'payment') throw new ApiError(404, 'Payment not found', 'not_found')
    if (p.status !== 'completed') throw new ApiError(409, 'This payment was voided', 'voided')
    const already = get<{ s: number | null }>(`SELECT SUM(base_amount) s FROM payments WHERE refund_of = ? AND status = 'completed'`, p.id)!.s ?? 0
    const refundable = p.base_amount - already
    const amount = input.amount === undefined ? refundable : Number(input.amount)
    if (!Number.isInteger(amount) || amount <= 0) throw new ApiError(400, 'Enter an amount to refund', 'invalid_amount')
    if (amount > refundable) throw new ApiError(409, `At most ${refundable} can still be refunded`, 'over_refund')

    const base = getSettings().currency
    const r = run(
      `INSERT INTO payments (public_id, kind, method, currency, amount, rate, base_amount, note, refund_of, table_id, created_by, idempotency_key)
       VALUES (?, 'refund', ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
      randomToken(9), p.method, base, amount, amount, reason, p.id, p.table_id, staff.id, key)
    const refundId = Number(r.lastInsertRowid)
    // Reverse the original allocations, newest order first.
    const allocs = all<{ order_id: number; amount: number }>('SELECT order_id, amount FROM payment_allocations WHERE payment_id = ? ORDER BY order_id DESC', p.id)
    const prior = new Map(all<{ order_id: number; s: number }>(
      `SELECT a.order_id, SUM(a.amount) s FROM payment_allocations a JOIN payments r ON r.id = a.payment_id
       WHERE r.refund_of = ? AND r.status = 'completed' GROUP BY a.order_id`, p.id).map((x) => [x.order_id, x.s]))
    let left = amount
    for (const a of allocs) {
      const room = a.amount - (prior.get(a.order_id) ?? 0)
      const part = Math.min(room, left)
      if (part <= 0) continue
      run('INSERT INTO payment_allocations (payment_id, order_id, amount) VALUES (?,?,?)', refundId, a.order_id, part)
      left -= part
      refreshPaymentStatus(a.order_id)
      if (left <= 0) break
    }
    return { id: refundId, duplicate: false }
  })
  const v = paymentView(out.id)
  if (!out.duplicate) {
    audit(staff, staff.name, 'payment.refund', paymentPublicId, `${v.baseAmount}: ${reason}`)
    publish('staff', 'payment', { id: v.id })
  }
  return { refund: v, duplicate: out.duplicate }
}

/** Voids a payment entered by mistake (nothing refunded against it yet). The row stays, marked void. */
export function voidPayment(staff: Staff, paymentPublicId: string, reasonIn: string) {
  const reason = String(reasonIn ?? '').trim().slice(0, 300)
  if (!reason) throw new ApiError(400, 'Please give a reason', 'reason_required')
  tx(() => {
    const p = get<{ id: number; kind: string; status: string }>('SELECT id, kind, status FROM payments WHERE public_id = ?', paymentPublicId)
    if (!p) throw new ApiError(404, 'Payment not found', 'not_found')
    if (p.status === 'voided') throw new ApiError(409, 'Already voided', 'voided')
    if (p.kind === 'payment' && get(`SELECT 1 FROM payments WHERE refund_of = ? AND status = 'completed'`, p.id))
      throw new ApiError(409, 'This payment has refunds; refund instead of voiding', 'has_refunds')
    run(`UPDATE payments SET status = 'voided', void_reason = ?, voided_by = ?, voided_at = datetime('now') WHERE id = ?`, reason, staff.id, p.id)
    for (const a of all<{ order_id: number }>('SELECT order_id FROM payment_allocations WHERE payment_id = ?', p.id)) refreshPaymentStatus(a.order_id)
  })
  audit(staff, staff.name, 'payment.void', paymentPublicId, reason)
  publish('staff', 'payment', { id: paymentPublicId })
  return paymentView(get<{ id: number }>('SELECT id FROM payments WHERE public_id = ?', paymentPublicId)!.id)
}

export function listPayments(f: { from?: string; to?: string; limit?: number } = {}) {
  const where: string[] = []
  const args: unknown[] = []
  if (f.from) { where.push('created_at >= ?'); args.push(f.from) }
  if (f.to) { where.push('created_at < ?'); args.push(f.to) }
  const ids = all<{ id: number }>(`SELECT id FROM payments ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`,
    ...args, Math.min(Math.max(f.limit ?? 100, 1), 500))
  return ids.map((r) => paymentView(r.id))
}

export function paymentByPublicId(id: string) {
  const r = get<{ id: number }>('SELECT id FROM payments WHERE public_id = ?', id)
  return r ? paymentView(r.id) : null
}

// ---------------------------------------------------------------- discounts

export function applyDiscount(staff: Staff, orderPublicId: string, input: { kind: 'percent' | 'amount'; value: number; reason: string }) {
  const reason = String(input.reason ?? '').trim().slice(0, 200)
  const value = Number(input.value)
  if (!['percent', 'amount'].includes(input.kind) || !Number.isFinite(value) || value < 0) throw new ApiError(400, 'Invalid discount', 'invalid')
  if (value > 0 && !reason) throw new ApiError(400, 'Please give a reason for the discount', 'reason_required')
  const s = getSettings()
  const result = tx(() => {
    const o = get<OrderMoney>('SELECT * FROM orders WHERE public_id = ?', orderPublicId)
    if (!o) throw new ApiError(404, 'Order not found', 'not_found')
    if (UNPAYABLE.includes(o.status)) throw new ApiError(409, 'This order was cancelled', 'order_cancelled')
    const discount = input.kind === 'percent' ? Math.round((o.subtotal * Math.min(value, 100)) / 100) : Math.min(Math.round(value), o.subtotal)
    const pct = o.subtotal ? (discount * 100) / o.subtotal : 0
    if (!can(staff.role, 'orders.override') && pct > s.maxCashierDiscountPercent + 1e-9)
      throw new ApiError(403, `Discounts above ${s.maxCashierDiscountPercent}% need a manager`, 'discount_limit')
    const t = orderTotals(o.subtotal, discount + o.loyalty_discount, o.tax_rate, o.service_rate)
    const paid = paidFor([o.id]).get(o.id) ?? 0
    if (t.total < paid) throw new ApiError(409, 'The discount would make the order cost less than what was already paid. Refund first.', 'below_paid')
    run(`UPDATE orders SET discount = ?, discount_reason = ?, tax = ?, service_charge = ?, total = ?, updated_at = datetime('now') WHERE id = ?`,
      discount, discount ? reason : '', t.tax, t.service, t.total, o.id)
    refreshPaymentStatus(o.id)
    return { discount, total: t.total }
  })
  audit(staff, staff.name, 'order.discount', orderPublicId, `${result.discount}: ${reason}`)
  publish('staff', 'order', { id: orderPublicId })
  return orderBill(orderPublicId)
}

// ---------------------------------------------------------------- receipts

export function receipt(staff: Staff, opts: { orderIds: string[]; paymentId?: string }) {
  const ids = [...new Set(opts.orderIds.map(String))].slice(0, 50)
  if (!ids.length) throw new ApiError(400, 'Nothing to print', 'invalid')
  const orders = all<OrderMoney>(`SELECT * FROM orders WHERE public_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`, ...ids)
  if (orders.length !== ids.length) throw new ApiError(404, 'Order not found', 'not_found')
  const bill = summarise(orders)
  const payments = all<{ id: number }>(
    `SELECT DISTINCT p.id FROM payments p JOIN payment_allocations a ON a.payment_id = p.id
     WHERE a.order_id IN (${orders.map(() => '?').join(',')}) AND p.status = 'completed' ORDER BY p.id`, ...orders.map((o) => o.id))
    .map((r) => paymentView(r.id))
  const pay = opts.paymentId ? get<{ id: number }>('SELECT id FROM payments WHERE public_id = ?', opts.paymentId) : undefined
  const printed = get<{ c: number }>(`SELECT COUNT(*) c FROM receipt_prints WHERE order_id = ?`, orders[0].id)!.c
  run('INSERT INTO receipt_prints (order_id, payment_id, staff_id, reprint) VALUES (?,?,?,?)', orders[0].id, pay?.id ?? null, staff.id, printed ? 1 : 0)
  if (printed) audit(staff, staff.name, 'receipt.reprint', ids.join(','))
  const s = getSettings()
  return {
    loyalty: { enabled: s.loyaltyEnabled, pointValue: s.loyaltyPointValue, minRedeem: s.loyaltyMinRedeem, maxRedeemPercent: s.loyaltyMaxRedeemPercent },
    restaurant: { name: s.restaurantName, header: s.receiptHeader, footer: s.receiptFooter, currency: s.currency },
    reprint: printed > 0, printedAt: new Date().toISOString(), cashier: staff.name,
    tableNumber: orders.every((o) => o.table_number === orders[0].table_number) ? orders[0].table_number : '',
    ...bill, payments,
  }
}
