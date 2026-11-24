import 'server-only'
import { all, get, run, tx } from './db'
import { ApiError } from './http'
import { audit, type Staff } from './auth'
import { getSettings } from './settings'
import { paidFor } from './payments'
import { fromSql, localDate, localToUtc, toSql, tzOffsetMinutes } from '../time'
import type { Sheet } from './sheets'

/**
 * Finance. Every number is computed from the ledger tables; nothing is estimated except where named.
 *  - Sales: orders that reached the kitchen and were not cancelled (awaiting-verification is not a sale).
 *  - Net sales = subtotal - discounts. Tax and service charge are reported separately (not income).
 *  - Collected: completed payments minus refunds, by when the money moved.
 *  - Cost of goods: the value of stock that orders used (stock movements at the cost at the time).
 *  - Inventory purchases are cash out, not an expense: that cost reaches profit as cost of goods when used.
 *  - Profit is an estimate: net sales - cost of goods - waste - recorded expenses. Dishes without a recipe
 *    carry no ingredient cost, so the report states how much of what was sold has a recipe.
 */

export const EXPENSE_CATEGORIES = ['rent', 'salaries', 'utilities', 'supplies', 'marketing', 'maintenance', 'equipment', 'fees', 'taxes', 'other'] as const
const DAY = /^\d{4}-\d{2}-\d{2}$/
const SOLD = `o.confirmed_at IS NOT NULL AND o.status NOT IN ('cancelled','rejected')`

export function parseRange(fromIn: unknown, toIn: unknown) {
  const tz = getSettings().timezone
  const today = localDate(new Date(), tz)
  const from = typeof fromIn === 'string' && DAY.test(fromIn) ? fromIn : today
  const to = typeof toIn === 'string' && DAY.test(toIn) ? toIn : from
  if (to < from) throw new ApiError(400, 'The end date is before the start date', 'invalid_range')
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1
  if (days > 400) throw new ApiError(400, 'Choose at most about a year at a time', 'invalid_range')
  return { from, to, days, tz, fromUtc: toSql(localToUtc(from, 0, tz)), toUtc: toSql(localToUtc(to, 24 * 60, tz)) }
}
type Range = ReturnType<typeof parseRange>

const shiftDay = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
export function previousRange(r: Range) { return parseRange(shiftDay(r.from, -r.days), shiftDay(r.from, -1)) }

type ORow = { id: number; number: number; type: string; table_number: string; subtotal: number; discount: number; loyalty_discount: number; tax: number; service_charge: number; total: number; created_at: string; status: string; confirmed_at: string | null }

function soldOrders(r: Range) {
  return all<ORow>(`SELECT o.id, o.number, o.type, o.table_number, o.subtotal, o.discount, o.loyalty_discount, o.tax, o.service_charge, o.total, o.created_at, o.status, o.confirmed_at
    FROM orders o WHERE o.created_at >= ? AND o.created_at < ? AND ${SOLD}`, r.fromUtc, r.toUtc)
}

/** Headline numbers for a range. */
export function kpis(r: Range) {
  const orders = soldOrders(r)
  const cancelled = get<{ n: number; v: number | null }>(`SELECT COUNT(*) n, SUM(total) v FROM orders WHERE created_at >= ? AND created_at < ? AND status IN ('cancelled','rejected')`, r.fromUtc, r.toUtc)!
  const sum = (k: keyof ORow) => orders.reduce((a, o) => a + (o[k] as number), 0)
  const subtotal = sum('subtotal'), discounts = sum('discount'), loyaltyRedeemed = sum('loyalty_discount'), netSales = subtotal - discounts - loyaltyRedeemed
  const pay = get<{ inflow: number | null; refunds: number | null; cash: number | null }>(
    `SELECT SUM(CASE WHEN kind = 'payment' THEN base_amount END) inflow, SUM(CASE WHEN kind = 'refund' THEN base_amount END) refunds,
       SUM(CASE WHEN method = 'cash' THEN (CASE kind WHEN 'payment' THEN base_amount ELSE -base_amount END) END) cash
     FROM payments WHERE status = 'completed' AND created_at >= ? AND created_at < ?`, r.fromUtc, r.toUtc)!
  const stock = get<{ cogs: number | null; waste: number | null; purchases: number | null }>(
    `SELECT SUM(CASE WHEN kind IN ('sale','sale_reversal') THEN -change * unit_cost END) / 1000.0 cogs,
       SUM(CASE WHEN kind = 'waste' THEN -change * unit_cost END) / 1000.0 waste,
       SUM(CASE WHEN kind = 'purchase' THEN change * unit_cost END) / 1000.0 purchases
     FROM stock_movements WHERE created_at >= ? AND created_at < ?`, r.fromUtc, r.toUtc)!
  const expenses = get<{ v: number | null }>(`SELECT SUM(amount) v FROM expenses WHERE status = 'recorded' AND spent_on >= ? AND spent_on <= ?`, r.from, r.to)!.v ?? 0
  const paid = paidFor(orders.map((o) => o.id))
  const outstanding = orders.reduce((a, o) => a + Math.max(0, o.total - (paid.get(o.id) ?? 0)), 0)
  const cov = orders.length ? get<{ all: number | null; costed: number | null }>(
    `SELECT SUM(oi.quantity) "all", SUM(CASE WHEN EXISTS (SELECT 1 FROM recipe_lines rl WHERE rl.item_id = oi.item_id AND rl.option_id IS NULL) THEN oi.quantity END) costed
     FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.created_at >= ? AND o.created_at < ? AND ${SOLD}`, r.fromUtc, r.toUtc)! : { all: 0, costed: 0 }
  const cogs = Math.round(stock.cogs ?? 0), waste = Math.round(stock.waste ?? 0)
  const refunds = pay.refunds ?? 0
  return {
    orders: orders.length, cancelledOrders: cancelled.n, cancelledValue: cancelled.v ?? 0,
    grossSales: sum('total'), subtotal, discounts, loyaltyRedeemed, netSales, tax: sum('tax'), service: sum('service_charge'),
    averageOrder: orders.length ? Math.round(netSales / orders.length) : 0,
    collected: (pay.inflow ?? 0) - refunds, refunds, cashTaken: pay.cash ?? 0, outstanding,
    cogs, waste, expenses, inventoryPurchases: Math.round(stock.purchases ?? 0),
    grossProfit: netSales - cogs, netProfit: netSales - cogs - waste - expenses,
    foodCostPercent: netSales ? Math.round((cogs / netSales) * 1000) / 10 : null,
    recipeCoverage: cov.all ? Math.round(((cov.costed ?? 0) / cov.all) * 100) : null,
  }
}

/** Full report for the finance page. */
export function report(r: Range) {
  const s = getSettings()
  const tz = r.tz
  const orders = soldOrders(r)
  const byDay = new Map<string, { date: string; orders: number; netSales: number; collected: number; cogs: number; expenses: number }>()
  for (let d = r.from; d <= r.to; d = shiftDay(d, 1)) byDay.set(d, { date: d, orders: 0, netSales: 0, collected: 0, cogs: 0, expenses: 0 })
  const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, orders: 0, netSales: 0 }))
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => ({ day: d, orders: 0, netSales: 0 }))
  const hourFmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' })
  const types = new Map<string, { type: string; orders: number; netSales: number }>()
  const tables = new Map<string, { table: string; orders: number; netSales: number }>()
  for (const o of orders) {
    const at = fromSql(o.created_at)
    const day = byDay.get(localDate(at, tz))
    const net = o.subtotal - o.discount - o.loyalty_discount
    if (day) { day.orders++; day.netSales += net }
    const h = hours[Number(hourFmt.format(at)) % 24]; h.orders++; h.netSales += net
    const wd = weekdays[new Date(`${localDate(at, tz)}T12:00:00Z`).getUTCDay()]; wd.orders++; wd.netSales += net
    const t = types.get(o.type) ?? { type: o.type, orders: 0, netSales: 0 }; t.orders++; t.netSales += net; types.set(o.type, t)
    if (o.table_number) { const tb = tables.get(o.table_number) ?? { table: o.table_number, orders: 0, netSales: 0 }; tb.orders++; tb.netSales += net; tables.set(o.table_number, tb) }
  }
  for (const p of all<{ created_at: string; v: number }>(`SELECT created_at, CASE kind WHEN 'payment' THEN base_amount ELSE -base_amount END v FROM payments WHERE status = 'completed' AND created_at >= ? AND created_at < ?`, r.fromUtc, r.toUtc)) {
    const d = byDay.get(localDate(fromSql(p.created_at), tz)); if (d) d.collected += p.v
  }
  for (const m of all<{ created_at: string; v: number }>(`SELECT created_at, -change * unit_cost / 1000.0 v FROM stock_movements WHERE kind IN ('sale','sale_reversal') AND created_at >= ? AND created_at < ?`, r.fromUtc, r.toUtc)) {
    const d = byDay.get(localDate(fromSql(m.created_at), tz)); if (d) d.cogs += m.v
  }
  for (const e of all<{ spent_on: string; amount: number }>(`SELECT spent_on, amount FROM expenses WHERE status = 'recorded' AND spent_on >= ? AND spent_on <= ?`, r.from, r.to)) {
    const d = byDay.get(e.spent_on); if (d) d.expenses += e.amount
  }

  const ids = orders.map((o) => o.id)
  const lines = ids.length ? all<{ item_id: number | null; name: string; category: string | null; qty: number; revenue: number; unit_cost: number | null }>(
    `SELECT oi.item_id, oi.name, c.name_en AS category, SUM(oi.quantity) qty, SUM(oi.line_total) revenue,
       (SELECT SUM(rl.qty * g.unit_cost) / 1000.0 FROM recipe_lines rl JOIN ingredients g ON g.id = rl.ingredient_id WHERE rl.item_id = oi.item_id AND rl.option_id IS NULL) AS unit_cost
     FROM order_items oi JOIN orders o ON o.id = oi.order_id LEFT JOIN items i ON i.id = oi.item_id LEFT JOIN categories c ON c.id = i.category_id
     WHERE o.created_at >= ? AND o.created_at < ? AND ${SOLD} GROUP BY COALESCE(oi.item_id, -1), oi.name ORDER BY revenue DESC`, r.fromUtc, r.toUtc) : []
  const products = lines.map((l) => {
    const cost = l.unit_cost === null ? null : Math.round(l.unit_cost * l.qty)
    return { itemId: l.item_id, name: l.name, category: l.category ?? '—', quantity: l.qty, revenue: l.revenue, estimatedCost: cost,
      margin: cost === null ? null : l.revenue - cost, marginPercent: cost === null || !l.revenue ? null : Math.round(((l.revenue - cost) / l.revenue) * 100) }
  })
  const sold = new Set(products.map((p) => p.itemId))
  const unsold = all<{ id: number; name_en: string }>('SELECT id, name_en FROM items WHERE visible = 1 ORDER BY name_en').filter((i) => !sold.has(i.id)).map((i) => i.name_en)
  const categories = [...products.reduce((m, p) => { const c = m.get(p.category) ?? { category: p.category, quantity: 0, revenue: 0 }; c.quantity += p.quantity; c.revenue += p.revenue; return m.set(p.category, c) }, new Map<string, { category: string; quantity: number; revenue: number }>()).values()]
    .sort((a, b) => b.revenue - a.revenue)

  const methodLabel = new Map(s.paymentMethods.map((m) => [m.id, m.label]))
  const methods = all<{ method: string; currency: string; n: number; inflow: number | null; refunds: number | null; amount: number | null }>(
    `SELECT method, currency, COUNT(*) n, SUM(CASE WHEN kind = 'payment' THEN base_amount END) inflow, SUM(CASE WHEN kind = 'refund' THEN base_amount END) refunds,
       SUM(CASE WHEN kind = 'payment' THEN amount ELSE -amount END) amount
     FROM payments WHERE status = 'completed' AND created_at >= ? AND created_at < ? GROUP BY method, currency ORDER BY inflow DESC`, r.fromUtc, r.toUtc)
    .map((m) => ({ method: m.method, label: methodLabel.get(m.method) ?? m.method, currency: m.currency, payments: m.n, amount: m.amount ?? 0,
      inflow: m.inflow ?? 0, refunds: m.refunds ?? 0, net: (m.inflow ?? 0) - (m.refunds ?? 0) }))

  const expenseRows = all<{ category: string; v: number; n: number }>(
    `SELECT category, SUM(amount) v, COUNT(*) n FROM expenses WHERE status = 'recorded' AND spent_on >= ? AND spent_on <= ? GROUP BY category ORDER BY v DESC`, r.from, r.to)
  const wasteRows = all<{ name: string; unit: string; qty: number; v: number }>(
    `SELECT g.name, g.unit, SUM(-m.change) / 1000.0 qty, SUM(-m.change * m.unit_cost) / 1000.0 v FROM stock_movements m JOIN ingredients g ON g.id = m.ingredient_id
     WHERE m.kind = 'waste' AND m.created_at >= ? AND m.created_at < ? GROUP BY g.id ORDER BY v DESC`, r.fromUtc, r.toUtc)
  const discountRows = all<{ number: number; discount: number; discount_reason: string; created_at: string }>(
    `SELECT o.number, o.discount, o.discount_reason, o.created_at FROM orders o WHERE o.discount > 0 AND o.created_at >= ? AND o.created_at < ? AND ${SOLD} ORDER BY o.discount DESC LIMIT 50`, r.fromUtc, r.toUtc)
  const refundRows = all<{ public_id: string; base_amount: number; note: string; created_at: string; staff: string | null; method: string }>(
    `SELECT p.public_id, p.base_amount, p.note, p.created_at, s.name AS staff, p.method FROM payments p LEFT JOIN staff s ON s.id = p.created_by
     WHERE p.kind = 'refund' AND p.status = 'completed' AND p.created_at >= ? AND p.created_at < ? ORDER BY p.id DESC LIMIT 50`, r.fromUtc, r.toUtc)

  const prev = previousRange(r)
  return {
    range: { from: r.from, to: r.to, days: r.days, timezone: tz, utcOffsetMinutes: tzOffsetMinutes(new Date(), tz) },
    previous: { from: prev.from, to: prev.to, kpis: kpis(prev) },
    currency: s.currency,
    kpis: kpis(r),
    daily: [...byDay.values()].map((d) => ({ ...d, cogs: Math.round(d.cogs) })),
    hourly: hours, weekdays,
    types: [...types.values()].sort((a, b) => b.netSales - a.netSales),
    tables: [...tables.values()].map((t) => ({ ...t, average: Math.round(t.netSales / t.orders) })).sort((a, b) => b.netSales - a.netSales),
    products, categories, unsold, methods,
    expenses: expenseRows.map((e) => ({ category: e.category, amount: e.v, count: e.n })),
    waste: wasteRows.map((w) => ({ ingredient: w.name, unit: w.unit, quantity: Math.round(w.qty * 1000) / 1000, value: Math.round(w.v) })),
    discounts: discountRows.map((d) => ({ order: `ORD-${d.number}`, amount: d.discount, reason: d.discount_reason, at: d.created_at.replace(' ', 'T') + 'Z' })),
    refunds: refundRows.map((x) => ({ id: x.public_id, amount: x.base_amount, reason: x.note, by: x.staff, method: x.method, at: x.created_at.replace(' ', 'T') + 'Z' })),
  }
}
export type Report = ReturnType<typeof report>

// ---------------------------------------------------------------- expenses

export function listExpenses(r: Range) {
  return all<{ id: number; spent_on: string; category: string; description: string; amount: number; method: string; supplier: string | null; reference: string; status: string; void_reason: string; staff: string | null }>(
    `SELECT e.*, s.name AS supplier, st.name AS staff FROM expenses e LEFT JOIN suppliers s ON s.id = e.supplier_id LEFT JOIN staff st ON st.id = e.created_by
     WHERE e.spent_on >= ? AND e.spent_on <= ? ORDER BY e.spent_on DESC, e.id DESC`, r.from, r.to,
  ).map((e) => ({ id: e.id, date: e.spent_on, category: e.category, description: e.description, amount: e.amount, method: e.method, supplier: e.supplier,
    reference: e.reference, status: e.status, voidReason: e.void_reason, by: e.staff }))
}

export function addExpense(staff: Staff, b: Record<string, unknown>) {
  const date = String(b.date ?? '')
  if (!DAY.test(date)) throw new ApiError(400, 'Choose the date it was paid', 'invalid')
  const category = String(b.category ?? '')
  if (!(EXPENSE_CATEGORIES as readonly string[]).includes(category)) throw new ApiError(400, 'Choose a category', 'invalid')
  const description = String(b.description ?? '').trim().slice(0, 200)
  if (description.length < 2) throw new ApiError(400, 'Describe the expense', 'invalid')
  const amount = Number(b.amount)
  if (!Number.isInteger(amount) || amount <= 0 || amount > 10_000_000_000) throw new ApiError(400, 'Enter the amount in whole dinars', 'invalid')
  const supplierId = b.supplierId ? Number(b.supplierId) : null
  if (supplierId && !get('SELECT 1 FROM suppliers WHERE id = ?', supplierId)) throw new ApiError(400, 'Unknown supplier', 'invalid')
  if (date > localDate(new Date(Date.now() + 86400000), getSettings().timezone)) throw new ApiError(400, 'That date is in the future', 'invalid')
  const id = Number(run('INSERT INTO expenses (spent_on, category, description, amount, method, supplier_id, reference, created_by) VALUES (?,?,?,?,?,?,?,?)',
    date, category, description, amount, String(b.method ?? '').slice(0, 30), supplierId, String(b.reference ?? '').trim().slice(0, 80), staff.id).lastInsertRowid)
  audit(staff, staff.name, 'expense.create', String(id), `${category} ${amount}: ${description}`)
  return id
}

export function voidExpense(staff: Staff, id: number, reason: string) {
  const why = String(reason ?? '').trim().slice(0, 200)
  if (!why) throw new ApiError(400, 'Please give a reason', 'reason_required')
  tx(() => {
    const e = get<{ status: string }>('SELECT status FROM expenses WHERE id = ?', id)
    if (!e) throw new ApiError(404, 'Expense not found', 'not_found')
    if (e.status === 'voided') throw new ApiError(409, 'Already voided', 'voided')
    run(`UPDATE expenses SET status = 'voided', void_reason = ? WHERE id = ?`, why, id)
  })
  audit(staff, staff.name, 'expense.void', String(id), why)
}

// ---------------------------------------------------------------- exports

export const REPORTS = ['summary', 'daily', 'products', 'categories', 'payments', 'expenses', 'orders', 'hours', 'tables', 'waste'] as const
export type ReportName = (typeof REPORTS)[number]

export function sheetsFor(name: ReportName | 'all', r: Range): Sheet[] {
  const rep = report(r)
  const k = rep.kpis
  const out: Record<ReportName, () => Sheet> = {
    summary: () => ({ name: 'Summary', head: ['Measure', `${r.from} to ${r.to}`, `${rep.previous.from} to ${rep.previous.to}`], rows: ([
      ['Orders', 'orders'], ['Net sales', 'netSales'], ['Discounts', 'discounts'], ['Paid with loyalty points', 'loyaltyRedeemed'], ['Tax', 'tax'], ['Service charge', 'service'], ['Gross sales (incl. tax/service)', 'grossSales'],
      ['Average order (net)', 'averageOrder'], ['Collected (payments - refunds)', 'collected'], ['Refunds', 'refunds'], ['Unpaid from these orders', 'outstanding'],
      ['Cost of goods (from recipes)', 'cogs'], ['Gross profit', 'grossProfit'], ['Waste', 'waste'], ['Expenses', 'expenses'], ['Estimated net profit', 'netProfit'],
      ['Inventory purchases (cash out)', 'inventoryPurchases'], ['Food cost %', 'foodCostPercent'], ['Sold items with a recipe %', 'recipeCoverage'],
      ['Cancelled orders', 'cancelledOrders'], ['Cancelled value', 'cancelledValue'],
    ] as Array<[string, keyof typeof k]>).map(([label, key]) => [label, k[key] as number | null, rep.previous.kpis[key] as number | null]) }),
    daily: () => ({ name: 'Daily', head: ['Date', 'Orders', 'Net sales', 'Collected', 'Cost of goods', 'Expenses'], rows: rep.daily.map((d) => [d.date, d.orders, d.netSales, d.collected, d.cogs, d.expenses]) }),
    products: () => ({ name: 'Products', head: ['Product', 'Category', 'Quantity', 'Revenue', 'Estimated cost', 'Margin', 'Margin %'], rows: rep.products.map((p) => [p.name, p.category, p.quantity, p.revenue, p.estimatedCost, p.margin, p.marginPercent]) }),
    categories: () => ({ name: 'Categories', head: ['Category', 'Quantity', 'Revenue'], rows: rep.categories.map((c) => [c.category, c.quantity, c.revenue]) }),
    payments: () => ({ name: 'Payments', head: ['Method', 'Currency', 'Payments', 'Amount (currency)', `In (${rep.currency})`, `Refunds (${rep.currency})`, `Net (${rep.currency})`], rows: rep.methods.map((m) => [m.label, m.currency, m.payments, m.currency === 'USD' ? m.amount / 100 : m.amount, m.inflow, m.refunds, m.net]) }),
    expenses: () => ({ name: 'Expenses', head: ['Date', 'Category', 'Description', 'Amount', 'Method', 'Supplier', 'Reference', 'Status', 'Recorded by'], rows: listExpenses(r).map((e) => [e.date, e.category, e.description, e.amount, e.method, e.supplier, e.reference, e.status, e.by]) }),
    orders: () => ({ name: 'Orders', head: ['Order', 'Created (UTC)', 'Type', 'Table', 'Status', 'Subtotal', 'Discount', 'Tax', 'Service', 'Total', 'Payment', 'Items'],
      rows: all<{ number: number; created_at: string; type: string; table_number: string; status: string; subtotal: number; discount: number; tax: number; service_charge: number; total: number; payment_status: string; items: string | null }>(
        `SELECT o.number, o.created_at, o.type, o.table_number, o.status, o.subtotal, o.discount, o.tax, o.service_charge, o.total, o.payment_status,
           (SELECT GROUP_CONCAT(quantity || ' x ' || name, '; ') FROM order_items WHERE order_id = o.id) AS items
         FROM orders o WHERE o.created_at >= ? AND o.created_at < ? ORDER BY o.id`, r.fromUtc, r.toUtc)
        .map((o) => [`ORD-${o.number}`, o.created_at, o.type, o.table_number, o.status, o.subtotal, o.discount, o.tax, o.service_charge, o.total, o.payment_status, o.items]) }),
    hours: () => ({ name: 'Hours', head: ['Hour', 'Orders', 'Net sales'], rows: rep.hourly.map((h) => [`${String(h.hour).padStart(2, '0')}:00`, h.orders, h.netSales]) }),
    tables: () => ({ name: 'Tables', head: ['Table', 'Orders', 'Net sales', 'Average'], rows: rep.tables.map((t) => [t.table, t.orders, t.netSales, t.average]) }),
    waste: () => ({ name: 'Waste', head: ['Ingredient', 'Quantity', 'Unit', 'Value'], rows: rep.waste.map((w) => [w.ingredient, w.quantity, w.unit, w.value]) }),
  }
  return name === 'all' ? REPORTS.map((n) => out[n]()) : [out[name]()]
}
