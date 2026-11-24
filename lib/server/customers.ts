import 'server-only'
import { all, get, run, tx } from './db'
import { ApiError } from './http'
import { audit, type Staff } from './auth'
import { publish } from './events'
import { getSettings } from './settings'
import { can } from '../permissions'
import { maskPhone, normalizePhone } from '../phone'
import { orderTotals } from '../money'
import { localDate } from '../time'

/**
 * Customers and loyalty.
 *  - One record per phone number (normalised), created by bookings, the POS, or staff.
 *  - Points are earned once, when an order becomes fully paid, and taken back if it stops being paid
 *    (refund). Redeeming points is a discount on the order (it lowers net sales, it is not cash);
 *    cancelling the order returns them. Every change is a loyalty_transactions row.
 *  - Staff who may only look customers up see a masked phone and no spend; contact details and money
 *    are for customers.manage. Marketing lists contain only people who opted in.
 */

const iso = (s: string | null) => (s ? s.replace(' ', 'T') + 'Z' : null)
const SOLD = `o.confirmed_at IS NOT NULL AND o.status NOT IN ('cancelled','rejected')`

type Cust = {
  id: number; name: string; phone: string | null; email: string; birthday: string | null; notes: string; preferences: string
  marketing_consent: number; consent_at: string | null; loyalty_points: number; tier: string; source: string; forgotten_at: string | null
  created_at: string; updated_at: string
}

export function findOrCreate(nameIn: string, phoneIn: unknown, source: 'pos' | 'reservation' | 'manual' | 'web', email = '') {
  const phone = normalizePhone(phoneIn)
  if (!phone) return null
  const c = get<{ id: number; name: string; email: string }>('SELECT id, name, email FROM customers WHERE phone = ?', phone)
  if (c) {
    if (!c.email && email) run(`UPDATE customers SET email = ?, updated_at = datetime('now') WHERE id = ?`, email, c.id)
    return c.id
  }
  const name = String(nameIn ?? '').trim().slice(0, 80) || 'Guest'
  return Number(run('INSERT INTO customers (name, phone, email, source) VALUES (?,?,?,?)', name, phone, email, source).lastInsertRowid)
}

// ---------------------------------------------------------------- stats, tiers

function spendOf(customerId: number) {
  return get<{ visits: number; spend: number | null; last: string | null; first: string | null }>(
    `SELECT COUNT(*) visits, SUM(o.subtotal - o.discount - o.loyalty_discount) spend, MAX(o.created_at) last, MIN(o.created_at) first
     FROM orders o WHERE o.customer_id = ? AND ${SOLD}`, customerId)!
}

export function tierFor(spend: number) {
  const tiers = getSettings().loyaltyTiers
  return [...tiers].reverse().find((t) => spend >= t.minSpend) ?? tiers[0]
}

function setBalance(customerId: number, delta: number, kind: 'earn' | 'redeem' | 'reverse' | 'return' | 'adjust', o: { orderId?: number | null; reason?: string; staffId?: number | null }) {
  const c = get<{ loyalty_points: number }>('SELECT loyalty_points FROM customers WHERE id = ?', customerId)
  if (!c) throw new ApiError(404, 'Customer not found', 'not_found')
  const next = c.loyalty_points + delta
  if (next < 0) throw new ApiError(409, `Only ${c.loyalty_points} points available`, 'not_enough_points')
  if (delta === 0) return next
  run(`UPDATE customers SET loyalty_points = ?, updated_at = datetime('now') WHERE id = ?`, next, customerId)
  run('INSERT INTO loyalty_transactions (customer_id, kind, points, balance_after, order_id, reason, staff_id) VALUES (?,?,?,?,?,?,?)',
    customerId, kind, delta, next, o.orderId ?? null, (o.reason ?? '').slice(0, 200), o.staffId ?? null)
  return next
}

/**
 * Keeps an order's earned points in line with its payment state. Called inside the transaction that
 * changed the payment status (payments.refreshPaymentStatus).
 */
export function syncLoyalty(orderId: number) {
  const o = get<{ customer_id: number | null; payment_status: string; status: string; subtotal: number; discount: number; loyalty_discount: number; loyalty_points_earned: number; number: number }>(
    'SELECT customer_id, payment_status, status, subtotal, discount, loyalty_discount, loyalty_points_earned, number FROM orders WHERE id = ?', orderId)
  if (!o || !o.customer_id) return
  const s = getSettings()
  const paid = o.payment_status === 'paid' && !['cancelled', 'rejected'].includes(o.status)
  if (paid && !o.loyalty_points_earned && s.loyaltyEnabled && s.loyaltyEarnPer > 0) {
    const before = spendOf(o.customer_id).spend ?? 0
    const net = Math.max(0, o.subtotal - o.discount - o.loyalty_discount)
    const tier = tierFor(before - net) // the tier they had when they paid
    const points = Math.floor((net / s.loyaltyEarnPer) * tier.multiplier)
    if (points > 0) {
      setBalance(o.customer_id, points, 'earn', { orderId, reason: `ORD-${o.number}` })
      run('UPDATE orders SET loyalty_points_earned = ? WHERE id = ?', points, orderId)
    }
    run(`UPDATE customers SET tier = ? WHERE id = ?`, tierFor(before).name, o.customer_id)
  } else if (!paid && o.loyalty_points_earned) {
    // Refunded or voided after earning: take back what is still there.
    const have = get<{ loyalty_points: number }>('SELECT loyalty_points FROM customers WHERE id = ?', o.customer_id)!.loyalty_points
    const back = Math.min(have, o.loyalty_points_earned)
    if (back > 0) setBalance(o.customer_id, -back, 'reverse', { orderId, reason: `ORD-${o.number} no longer fully paid` })
    run('UPDATE orders SET loyalty_points_earned = 0 WHERE id = ?', orderId)
  }
}

/** Points used on a cancelled order go back to the guest. Call inside the cancelling transaction. */
export function returnRedeemed(orderId: number, staffId: number | null) {
  const o = get<{ customer_id: number | null; loyalty_points_used: number; number: number }>('SELECT customer_id, loyalty_points_used, number FROM orders WHERE id = ?', orderId)
  if (!o?.customer_id || !o.loyalty_points_used) return
  setBalance(o.customer_id, o.loyalty_points_used, 'return', { orderId, staffId, reason: `ORD-${o.number} cancelled` })
  run('UPDATE orders SET loyalty_points_used = 0, loyalty_discount = 0 WHERE id = ?', orderId)
}

// ---------------------------------------------------------------- attach to orders, redeem

type OrderRow = { id: number; number: number; status: string; customer_id: number | null; subtotal: number; discount: number; loyalty_discount: number; loyalty_points_used: number; tax_rate: number; service_rate: number; total: number; payment_status: string }

export function attachCustomer(staff: Staff, orderPublicId: string, input: { customerId?: number | null; phone?: string; name?: string }) {
  const out = tx(() => {
    const o = get<OrderRow>('SELECT * FROM orders WHERE public_id = ?', orderPublicId)
    if (!o) throw new ApiError(404, 'Order not found', 'not_found')
    if (['cancelled', 'rejected'].includes(o.status)) throw new ApiError(409, 'This order was cancelled', 'order_cancelled')
    if (o.loyalty_points_used) throw new ApiError(409, 'Undo the points used on this order before changing the customer', 'points_used')
    let id: number | null = null
    if (input.customerId) {
      const c = get<{ id: number; forgotten_at: string | null }>('SELECT id, forgotten_at FROM customers WHERE id = ?', Number(input.customerId))
      if (!c || c.forgotten_at) throw new ApiError(404, 'Customer not found', 'not_found')
      id = c.id
    } else if (input.phone) {
      id = findOrCreate(String(input.name ?? ''), input.phone, 'pos')
      if (!id) throw new ApiError(400, 'Check the phone number', 'invalid_phone')
    }
    if (o.customer_id && o.customer_id !== id) {
      const earned = get<{ e: number }>('SELECT loyalty_points_earned e FROM orders WHERE id = ?', o.id)!.e
      if (earned) throw new ApiError(409, 'Points were already earned on this order', 'points_earned')
    }
    const c = id ? get<{ name: string; phone: string }>('SELECT name, phone FROM customers WHERE id = ?', id)! : null
    run(`UPDATE orders SET customer_id = ?, customer_name = CASE WHEN ? IS NULL THEN customer_name ELSE ? END,
         customer_phone = CASE WHEN ? IS NULL THEN customer_phone ELSE ? END, updated_at = datetime('now') WHERE id = ?`,
      id, c?.name ?? null, c?.name ?? null, c?.phone ?? null, c?.phone ?? null, o.id)
    syncLoyalty(o.id) // attaching after payment still earns
    return id
  })
  audit(staff, staff.name, out ? 'order.customer' : 'order.customer_removed', orderPublicId, String(out ?? ''))
  publish('staff', 'order', { id: orderPublicId })
  return out
}

/** Uses points as a discount on one order (replacing any earlier redemption on it). 0 undoes it. */
export function redeemPoints(staff: Staff, orderPublicId: string, pointsIn: number) {
  const s = getSettings()
  if (!s.loyaltyEnabled) throw new ApiError(403, 'Loyalty is switched off', 'loyalty_disabled')
  const points = Number(pointsIn)
  if (!Number.isInteger(points) || points < 0) throw new ApiError(400, 'Enter whole points', 'invalid')
  const res = tx(() => {
    const o = get<OrderRow>('SELECT * FROM orders WHERE public_id = ?', orderPublicId)
    if (!o) throw new ApiError(404, 'Order not found', 'not_found')
    if (!o.customer_id) throw new ApiError(409, 'Add the customer to the order first', 'no_customer')
    if (['cancelled', 'rejected'].includes(o.status)) throw new ApiError(409, 'This order was cancelled', 'order_cancelled')
    if (points && points < s.loyaltyMinRedeem) throw new ApiError(400, `At least ${s.loyaltyMinRedeem} points at a time`, 'below_minimum')
    // Put back what this order already used, then take the new amount.
    if (o.loyalty_points_used) setBalance(o.customer_id, o.loyalty_points_used, 'return', { orderId: o.id, staffId: staff.id, reason: `ORD-${o.number} redemption changed` })
    const value = Math.round(points * s.loyaltyPointValue)
    const cap = Math.floor(((o.subtotal - o.discount) * s.loyaltyMaxRedeemPercent) / 100)
    if (value > cap) throw new ApiError(409, `Points can pay for at most ${s.loyaltyMaxRedeemPercent}% of this order (${cap})`, 'over_cap')
    const t = orderTotals(o.subtotal, o.discount + value, o.tax_rate, o.service_rate)
    const paid = get<{ p: number | null }>(`SELECT SUM(CASE p.kind WHEN 'payment' THEN a.amount ELSE -a.amount END) p FROM payment_allocations a JOIN payments p ON p.id = a.payment_id WHERE a.order_id = ? AND p.status = 'completed'`, o.id)!.p ?? 0
    if (t.total < paid) throw new ApiError(409, 'More has already been paid than the order would cost. Use points before paying.', 'below_paid')
    if (points) setBalance(o.customer_id, -points, 'redeem', { orderId: o.id, staffId: staff.id, reason: `ORD-${o.number}` })
    run(`UPDATE orders SET loyalty_points_used = ?, loyalty_discount = ?, tax = ?, service_charge = ?, total = ?, updated_at = datetime('now') WHERE id = ?`,
      points, value, t.tax, t.service, t.total, o.id)
    return { value, total: t.total, orderId: o.id }
  })
  audit(staff, staff.name, 'loyalty.redeem', orderPublicId, `${points} points = ${res.value}`)
  publish('staff', 'order', { id: orderPublicId })
  return res
}

// ---------------------------------------------------------------- read models

function birthdaySoon(b: string | null, days = 7) {
  if (!b || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return false
  const today = localDate(new Date(), getSettings().timezone)
  for (let i = 0; i <= days; i++) {
    const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + i)
    if (d.toISOString().slice(5, 10) === b.slice(5, 10)) return true
  }
  return false
}

function card(c: Cust & { visits?: number; spend?: number | null; last?: string | null }, full: boolean) {
  return {
    id: c.id, name: c.name, phone: c.phone ? (full ? c.phone : maskPhone(c.phone)) : null, email: full ? c.email : undefined,
    tier: c.tier, points: c.loyalty_points, visits: c.visits ?? 0, spend: full ? c.spend ?? 0 : undefined, lastVisit: iso(c.last ?? null),
    notes: c.notes, preferences: c.preferences, birthdaySoon: birthdaySoon(c.birthday), marketingConsent: full ? !!c.marketing_consent : undefined,
    forgotten: !!c.forgotten_at,
  }
}

export function searchCustomers(staff: Staff, q: string, limit = 50) {
  const full = can(staff.role, 'customers.manage')
  const needle = String(q ?? '').trim()
  const digits = needle.replace(/\D/g, '')
  const where: string[] = ['c.forgotten_at IS NULL']
  const args: unknown[] = []
  if (needle) {
    // Phones match on their last digits, so "4567" or "0750 123 4567" both find 07501234567.
    const normal = normalizePhone(needle)
    where.push(`(c.name LIKE ? ${digits.length >= 4 ? 'OR c.phone LIKE ?' : ''} ${normal ? 'OR c.phone = ?' : ''})`)
    args.push(`%${needle}%`)
    if (digits.length >= 4) args.push(`%${digits.slice(-7)}%`)
    if (normal) args.push(normal)
  }
  return all<Cust & { visits: number; spend: number | null; last: string | null }>(
    `SELECT c.*, (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id AND ${SOLD}) visits,
       (SELECT SUM(o.subtotal - o.discount - o.loyalty_discount) FROM orders o WHERE o.customer_id = c.id AND ${SOLD}) spend,
       (SELECT MAX(o.created_at) FROM orders o WHERE o.customer_id = c.id AND ${SOLD}) last
     FROM customers c WHERE ${where.join(' AND ')} ORDER BY COALESCE(last, c.created_at) DESC LIMIT ?`, ...args, Math.min(limit, 200),
  ).map((c) => card(c, full))
}

export function customerProfile(staff: Staff, id: number) {
  const full = can(staff.role, 'customers.manage')
  const c = get<Cust>('SELECT * FROM customers WHERE id = ?', id)
  if (!c || c.forgotten_at) throw new ApiError(404, 'Customer not found', 'not_found')
  const st = spendOf(id)
  const s = getSettings()
  const tier = tierFor(st.spend ?? 0)
  const next = s.loyaltyTiers.find((t) => t.minSpend > (st.spend ?? 0))
  return {
    ...card({ ...c, visits: st.visits, spend: st.spend, last: st.last }, full),
    birthday: full ? c.birthday : undefined, consentAt: full ? iso(c.consent_at) : undefined, source: c.source, since: iso(c.created_at),
    tier: tier.name, nextTier: full && next ? { name: next.name, spendToGo: next.minSpend - (st.spend ?? 0) } : null,
    averageOrder: full && st.visits ? Math.round((st.spend ?? 0) / st.visits) : undefined,
    pointsValue: c.loyalty_points * s.loyaltyPointValue,
    favourites: all<{ name: string; qty: number }>(
      `SELECT oi.name, SUM(oi.quantity) qty FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.customer_id = ? AND ${SOLD}
       GROUP BY oi.name ORDER BY qty DESC LIMIT 5`, id),
    orders: all<{ public_id: string; number: number; created_at: string; type: string; table_number: string; total: number; status: string; payment_status: string; loyalty_points_earned: number; loyalty_points_used: number }>(
      `SELECT public_id, number, created_at, type, table_number, total, status, payment_status, loyalty_points_earned, loyalty_points_used FROM orders
       WHERE customer_id = ? ORDER BY id DESC LIMIT 25`, id)
      .map((o) => ({ id: o.public_id, label: `ORD-${o.number}`, at: iso(o.created_at), type: o.type, table: o.table_number, total: full ? o.total : undefined, status: o.status, paymentStatus: o.payment_status, earned: o.loyalty_points_earned, used: o.loyalty_points_used })),
    reservations: all<{ code: string; starts_at: string; party_size: number; status: string; occasion: string }>(
      `SELECT code, starts_at, party_size, status, occasion FROM reservations WHERE customer_id = ? ORDER BY starts_at DESC LIMIT 15`, id)
      .map((r) => ({ code: r.code, at: iso(r.starts_at), partySize: r.party_size, status: r.status, occasion: r.occasion })),
    ledger: all<{ kind: string; points: number; balance_after: number; reason: string; created_at: string; staff: string | null }>(
      `SELECT t.kind, t.points, t.balance_after, t.reason, t.created_at, s.name AS staff FROM loyalty_transactions t LEFT JOIN staff s ON s.id = t.staff_id
       WHERE t.customer_id = ? ORDER BY t.id DESC LIMIT 30`, id)
      .map((t) => ({ kind: t.kind, points: t.points, balance: t.balance_after, reason: t.reason, at: iso(t.created_at), by: t.staff })),
    feedback: all<{ rating: number; comment: string; created_at: string }>('SELECT rating, comment, created_at FROM feedback WHERE customer_id = ? ORDER BY id DESC LIMIT 10', id)
      .map((f) => ({ rating: f.rating, comment: f.comment, at: iso(f.created_at) })),
  }
}

// ---------------------------------------------------------------- writes

export function createCustomer(staff: Staff, b: Record<string, unknown>) {
  const phone = normalizePhone(b.phone)
  if (!phone) throw new ApiError(400, 'Enter a phone number', 'invalid_phone')
  if (get('SELECT 1 FROM customers WHERE phone = ?', phone)) throw new ApiError(409, 'A customer with that phone number exists', 'duplicate')
  const name = String(b.name ?? '').trim().slice(0, 80)
  if (name.length < 2) throw new ApiError(400, 'Enter a name', 'invalid')
  const id = Number(run('INSERT INTO customers (name, phone, source) VALUES (?,?,?)', name, phone, 'manual').lastInsertRowid)
  updateCustomer(staff, id, b)
  audit(staff, staff.name, 'customer.create', String(id))
  return id
}

export function updateCustomer(staff: Staff, id: number, b: Record<string, unknown>) {
  tx(() => {
    const c = get<Cust>('SELECT * FROM customers WHERE id = ?', id)
    if (!c || c.forgotten_at) throw new ApiError(404, 'Customer not found', 'not_found')
    const set = (col: string, v: unknown) => run(`UPDATE customers SET ${col} = ?, updated_at = datetime('now') WHERE id = ?`, v, id)
    if (b.name !== undefined) { const n = String(b.name).trim().slice(0, 80); if (n.length < 2) throw new ApiError(400, 'Enter a name', 'invalid'); set('name', n) }
    if (b.phone !== undefined) {
      const p = normalizePhone(b.phone)
      if (!p) throw new ApiError(400, 'Check the phone number', 'invalid_phone')
      if (get('SELECT 1 FROM customers WHERE phone = ? AND id != ?', p, id)) throw new ApiError(409, 'Another customer has that phone number', 'duplicate')
      set('phone', p)
    }
    if (b.email !== undefined) {
      const e = String(b.email).trim().slice(0, 120)
      if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new ApiError(400, 'Check the email address', 'invalid')
      set('email', e)
    }
    if (b.birthday !== undefined) {
      const d = b.birthday ? String(b.birthday) : null
      if (d && (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d)))) throw new ApiError(400, 'Birthday must be a date', 'invalid')
      set('birthday', d)
    }
    if (b.notes !== undefined) set('notes', String(b.notes).slice(0, 1000))
    if (b.preferences !== undefined) set('preferences', String(b.preferences).slice(0, 500))
    if (b.marketingConsent !== undefined) {
      const on = b.marketingConsent === true
      // Consent is recorded with its time, and only changes when someone actually changes it.
      if (on !== !!c.marketing_consent) {
        run(`UPDATE customers SET marketing_consent = ?, consent_at = ${on ? "datetime('now')" : 'NULL'} WHERE id = ?`, on ? 1 : 0, id)
        audit(staff, staff.name, on ? 'customer.consent_given' : 'customer.consent_withdrawn', String(id))
      }
    }
  })
  audit(staff, staff.name, 'customer.update', String(id), Object.keys(b).join(','))
}

export function adjustPoints(staff: Staff, id: number, pointsIn: number, reasonIn: string) {
  const points = Number(pointsIn)
  const reason = String(reasonIn ?? '').trim().slice(0, 200)
  if (!Number.isInteger(points) || points === 0) throw new ApiError(400, 'Enter a whole number of points', 'invalid')
  if (!reason) throw new ApiError(400, 'Please give a reason', 'reason_required')
  const balance = tx(() => {
    const c = get<{ forgotten_at: string | null }>('SELECT forgotten_at FROM customers WHERE id = ?', id)
    if (!c || c.forgotten_at) throw new ApiError(404, 'Customer not found', 'not_found')
    return setBalance(id, points, 'adjust', { staffId: staff.id, reason })
  })
  audit(staff, staff.name, 'loyalty.adjust', String(id), `${points}: ${reason}`)
  return balance
}

/**
 * "Forget me": removes personal details everywhere while keeping the sales history the business must
 * keep. The record stays (so totals add up) as an anonymous "Former guest".
 */
export function forgetCustomer(staff: Staff, id: number) {
  tx(() => {
    const c = get<Cust>('SELECT * FROM customers WHERE id = ?', id)
    if (!c || c.forgotten_at) throw new ApiError(404, 'Customer not found', 'not_found')
    if (c.loyalty_points) setBalance(id, -c.loyalty_points, 'adjust', { staffId: staff.id, reason: 'Customer asked to be forgotten' })
    run(`UPDATE customers SET name = 'Former guest', phone = NULL, email = '', birthday = NULL, notes = '', preferences = '', marketing_consent = 0,
         consent_at = NULL, forgotten_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`, id)
    run(`UPDATE orders SET customer_name = '', customer_phone = '', delivery_address = '' WHERE customer_id = ?`, id)
    run(`UPDATE reservations SET name = 'Former guest', phone = '', email = '', requests = '', notes = '' WHERE customer_id = ?`, id)
    run(`UPDATE feedback SET name = '' WHERE customer_id = ?`, id)
  })
  audit(staff, staff.name, 'customer.forget', String(id))
}

/** People who opted in to marketing, for a campaign tool. Nobody else is ever exported. */
export function marketingList() {
  return all<{ name: string; phone: string; email: string; birthday: string | null; tier: string; consent_at: string }>(
    `SELECT name, phone, email, birthday, tier, consent_at FROM customers WHERE marketing_consent = 1 AND forgotten_at IS NULL AND phone IS NOT NULL ORDER BY name`)
}

export function birthdaysThisWeek() {
  return all<{ id: number; name: string; birthday: string; marketing_consent: number }>(
    `SELECT id, name, birthday, marketing_consent FROM customers WHERE birthday IS NOT NULL AND forgotten_at IS NULL`,
  ).filter((c) => birthdaySoon(c.birthday)).map((c) => ({ id: c.id, name: c.name, day: c.birthday.slice(5), consent: !!c.marketing_consent }))
}

export function loyaltySettings() {
  const s = getSettings()
  return { enabled: s.loyaltyEnabled, earnPer: s.loyaltyEarnPer, pointValue: s.loyaltyPointValue, minRedeem: s.loyaltyMinRedeem, maxRedeemPercent: s.loyaltyMaxRedeemPercent, tiers: s.loyaltyTiers }
}
