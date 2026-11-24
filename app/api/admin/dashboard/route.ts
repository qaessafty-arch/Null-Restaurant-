import { json, route } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/auth'
import { all, get } from '@/lib/server/db'
import { parseRange, report } from '@/lib/server/finance'
import { floor } from '@/lib/server/floor'
import { listIngredients } from '@/lib/server/inventory'
import { listReservations } from '@/lib/server/reservations'
import { listPayments } from '@/lib/server/payments'
import { getSettings } from '@/lib/server/settings'
import { localDate } from '@/lib/time'

export const dynamic = 'force-dynamic'

/** Owner's overview: the period's money (vs the period before) plus what needs attention right now. */
export const GET = route(async (req) => {
  await requirePerm('reports.view')
  const q = new URL(req.url).searchParams
  const r = parseRange(q.get('from'), q.get('to'))
  const rep = report(r)
  const tables = floor()
  const today = localDate(new Date(), getSettings().timezone)
  const count = (where: string) => get<{ c: number }>(`SELECT COUNT(*) c FROM orders WHERE ${where}`)!.c
  const unpaid = get<{ n: number; v: number | null }>(
    `SELECT COUNT(*) n, SUM(o.total - COALESCE((SELECT SUM(CASE p.kind WHEN 'payment' THEN a.amount ELSE -a.amount END) FROM payment_allocations a JOIN payments p ON p.id = a.payment_id WHERE a.order_id = o.id AND p.status = 'completed'), 0)) v
     FROM orders o WHERE o.confirmed_at IS NOT NULL AND o.status NOT IN ('cancelled','rejected') AND o.payment_status != 'paid'`)!
  const res = listReservations(today, today).filter((x) => !['cancelled', 'no_show'].includes(x.status))
  return json({
    range: rep.range, previous: rep.previous, currency: rep.currency,
    kpis: rep.kpis,
    chart: r.days === 1 ? rep.hourly.map((h) => ({ key: String(h.hour), label: String(h.hour).padStart(2, '0'), value: h.netSales, orders: h.orders }))
      : rep.daily.map((d) => ({ key: d.date, label: d.date, value: d.netSales, orders: d.orders })),
    best: rep.products.slice(0, 5).map((p) => ({ name: p.name, quantity: p.quantity, revenue: p.revenue })),
    live: {
      awaitingVerification: count(`status = 'awaiting_verification'`),
      inKitchen: count(`status IN ('verified','confirmed','preparing')`),
      ready: count(`status = 'ready'`),
      late: count(`status IN ('confirmed','preparing') AND delay_notified_at IS NOT NULL`),
      openRequests: get<{ c: number }>(`SELECT COUNT(*) c FROM service_requests WHERE status != 'completed'`)!.c,
      billRequests: get<{ c: number }>(`SELECT COUNT(*) c FROM service_requests WHERE status != 'completed' AND type = 'bill'`)!.c,
      unpaidOrders: unpaid.n, unpaidValue: unpaid.v ?? 0,
      tables: {
        total: tables.length,
        inUse: tables.filter((t) => !['available', 'reserved', 'cleaning', 'out_of_service'].includes(t.status)).length,
        available: tables.filter((t) => t.status === 'available').length,
        reserved: tables.filter((t) => t.status === 'reserved').length,
        cleaning: tables.filter((t) => t.status === 'cleaning').length,
      },
      reservationsToday: { count: res.length, guests: res.reduce((a, x) => a + x.partySize, 0), next: res.filter((x) => ['pending', 'confirmed'].includes(x.status)).slice(0, 4).map((x) => ({ id: x.id, name: x.name, time: x.time, partySize: x.partySize, tableNumber: x.tableNumber, status: x.status })) },
      lowStock: listIngredients().filter((g) => g.active && g.low).slice(0, 6).map((g) => ({ name: g.name, stock: g.stock, unit: g.unit, out: g.out })),
    },
    payments: listPayments({ limit: 8 }).map((p) => ({ id: p.id, kind: p.kind, method: p.method, currency: p.currency, amount: p.amount, baseAmount: p.baseAmount, status: p.status, orders: p.orders.map((o) => o.label).join(', '), at: p.createdAt, by: p.cashier })),
    activity: all<{ number: number; to_status: string; actor: string; staff: string | null; created_at: string; table_number: string; type: string }>(
      `SELECT o.number, h.to_status, h.actor, s.name AS staff, h.created_at, o.table_number, o.type FROM order_status_history h JOIN orders o ON o.id = h.order_id
       LEFT JOIN staff s ON s.id = h.staff_id ORDER BY h.id DESC LIMIT 10`)
      .map((h) => ({ order: `ORD-${h.number}`, status: h.to_status, by: h.staff ?? h.actor, where: h.table_number ? `Table ${h.table_number}` : h.type.replace('_', '-'), at: h.created_at.replace(' ', 'T') + 'Z' })),
  })
})
