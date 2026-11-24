import 'server-only'
import { all, get, run, tx } from './db'
import { ApiError } from './http'
import { audit, type Staff } from './auth'
import { publish } from './events'
import { getSettings } from './settings'
import { notify, transition } from './orders'

/**
 * Kitchen display. Every order line was routed to a station when the order was placed
 * (item override, else its category's station). A station sees and moves only its own lines;
 * the order's status follows: first line started -> preparing, every line ready -> ready.
 */

const iso = (s: string | null) => (s ? s.replace(' ', 'T') + 'Z' : null)
export const LINE_STATUSES = ['new', 'preparing', 'ready'] as const
export type LineStatus = (typeof LINE_STATUSES)[number]

export type Station = { id: number; name: string; color: string; sort: number; active: boolean }

export function listStations(activeOnly = false): Station[] {
  return all<{ id: number; name: string; color: string; sort: number; active: number }>(
    `SELECT * FROM kitchen_stations ${activeOnly ? 'WHERE active = 1' : ''} ORDER BY sort, id`,
  ).map((s) => ({ ...s, active: !!s.active }))
}

type Row = {
  id: number; public_id: string; number: number; type: string; table_number: string; customer_name: string; status: string
  priority: number; customer_note: string; est_ready_minutes: number | null; confirmed_at: string | null; created_at: string
  delay_notified_at: string | null; age_min: number
}
type LineRow = {
  id: number; order_id: number; name: string; quantity: number; instructions: string; station_id: number | null
  kitchen_status: LineStatus; started_at: string | null; ready_at: string | null; allergens: string | null
}

/** Board for one station (or every station when stationId is null). Also raises late-order alerts once. */
export function kitchenBoard(stationId: number | null) {
  const s = getSettings()
  const orders = all<Row>(
    `SELECT id, public_id, number, type, table_number, customer_name, status, priority, customer_note, est_ready_minutes,
       confirmed_at, created_at, delay_notified_at,
       CAST((julianday('now') - julianday(COALESCE(confirmed_at, created_at))) * 1440 AS INTEGER) AS age_min
     FROM orders WHERE status IN ('confirmed','preparing','ready')
     ORDER BY priority DESC, COALESCE(confirmed_at, created_at), id`)
  if (!orders.length) return { orders: [], stations: listStations(true), delayMinutes: s.kitchenDelayMinutes }

  const ids = orders.map((o) => o.id)
  const lines = all<LineRow>(
    `SELECT oi.id, oi.order_id, oi.name, oi.quantity, oi.instructions, oi.station_id, oi.kitchen_status, oi.started_at, oi.ready_at,
       i.allergens
     FROM order_items oi LEFT JOIN items i ON i.id = oi.item_id
     WHERE oi.order_id IN (${ids.map(() => '?').join(',')}) ORDER BY oi.id`, ...ids)
  const opts = all<{ order_item_id: number; option_name: string }>(
    `SELECT oio.order_item_id, oio.option_name FROM order_item_options oio JOIN order_items oi ON oi.id = oio.order_item_id
     WHERE oi.order_id IN (${ids.map(() => '?').join(',')}) AND oio.is_default = 0 ORDER BY oio.id`, ...ids)
  const stations = new Map(listStations().map((st) => [st.id, st]))

  const late: Row[] = []
  const out = orders.map((o) => {
    const target = Math.max(o.est_ready_minutes ?? 0, s.kitchenDelayMinutes)
    const delayed = o.status !== 'ready' && o.age_min >= target
    if (delayed && !o.delay_notified_at) late.push(o)
    const mine = lines.filter((l) => l.order_id === o.id && (stationId === null || l.station_id === stationId))
    return {
      id: o.public_id, label: `ORD-${o.number}`, type: o.type, tableNumber: o.table_number, customerName: o.customer_name,
      status: o.status, rush: o.priority > 0, note: o.customer_note, confirmedAt: iso(o.confirmed_at ?? o.created_at),
      ageMinutes: o.age_min, targetMinutes: target, delayed,
      // Other stations still working on this order (so the grill knows the fries are not ready yet).
      otherStationsPending: stationId === null ? [] : [...new Set(lines.filter((l) => l.order_id === o.id && l.station_id !== stationId && l.kitchen_status !== 'ready')
        .map((l) => (l.station_id ? stations.get(l.station_id)?.name : 'Unassigned') ?? 'Unassigned'))],
      lines: mine.map((l) => ({
        id: l.id, name: l.name, quantity: l.quantity, instructions: l.instructions, status: l.kitchen_status,
        station: l.station_id ? { id: l.station_id, name: stations.get(l.station_id)?.name ?? '', color: stations.get(l.station_id)?.color ?? '' } : null,
        options: opts.filter((x) => x.order_item_id === l.id).map((x) => x.option_name),
        allergens: parseList(l.allergens),
        startedAt: iso(l.started_at), readyAt: iso(l.ready_at),
      })),
    }
  }).filter((o) => o.lines.length > 0)

  if (late.length) {
    tx(() => {
      for (const o of late) {
        const r = run(`UPDATE orders SET delay_notified_at = datetime('now') WHERE id = ? AND delay_notified_at IS NULL`, o.id)
        if (!r.changes) continue // another screen already raised it
        const where = o.table_number ? `Table ${o.table_number}` : o.customer_name || o.type.replace('_', '-')
        notify('waiter', 'delayed', `ORD-${o.number} is running late`, `${where} · ${o.age_min} min`, o.id)
        notify('admin', 'delayed', `ORD-${o.number} is running late`, `${where} · ${o.age_min} min`, o.id)
      }
    })
  }
  return { orders: out, stations: listStations(true), delayMinutes: s.kitchenDelayMinutes }
}

const parseList = (v: string | null): string[] => { try { const x = JSON.parse(v ?? '[]'); return Array.isArray(x) ? x : [] } catch { return [] } }

/**
 * Moves kitchen lines of one order. `lineIds` null = every line of `stationId` (or of the whole order).
 * Lines only move forward, except a line can be taken back from ready while the order is still cooking.
 */
export function setLines(staff: Staff, orderPublicId: string, input: { lineIds?: number[] | null; stationId?: number | null; status: LineStatus }) {
  if (!(LINE_STATUSES as readonly string[]).includes(input.status) || input.status === 'new') throw new ApiError(400, 'Invalid status', 'invalid')
  const to = input.status
  const result = tx(() => {
    const o = get<{ id: number; status: string; number: number }>('SELECT id, status, number FROM orders WHERE public_id = ?', orderPublicId)
    if (!o) throw new ApiError(404, 'Order not found', 'not_found')
    if (!['confirmed', 'preparing'].includes(o.status)) throw new ApiError(409, `This order is ${o.status.replace('_', ' ')}`, 'bad_transition')
    const all_ = all<{ id: number; station_id: number | null; kitchen_status: LineStatus }>('SELECT id, station_id, kitchen_status FROM order_items WHERE order_id = ?', o.id)
    let target = all_
    if (input.lineIds?.length) {
      const want = new Set(input.lineIds.map(Number))
      target = all_.filter((l) => want.has(l.id))
      if (target.length !== want.size) throw new ApiError(404, 'That item is not on this order', 'not_found')
    } else if (input.stationId) {
      target = all_.filter((l) => l.station_id === Number(input.stationId))
    }
    if (!target.length) throw new ApiError(400, 'Nothing to update', 'invalid')
    for (const l of target) {
      if (l.kitchen_status === to) continue
      if (to === 'preparing') run(`UPDATE order_items SET kitchen_status = 'preparing', started_at = COALESCE(started_at, datetime('now')), ready_at = NULL WHERE id = ?`, l.id)
      else run(`UPDATE order_items SET kitchen_status = 'ready', started_at = COALESCE(started_at, datetime('now')), ready_at = datetime('now') WHERE id = ?`, l.id)
    }
    const after = all<{ kitchen_status: LineStatus }>('SELECT kitchen_status FROM order_items WHERE order_id = ?', o.id)
    return { status: o.status, allReady: after.every((l) => l.kitchen_status === 'ready'), label: `ORD-${o.number}` }
  })
  const actor = { staff, label: `${staff.name} (${staff.role})` }
  // The order follows its lines. transition() re-checks permissions and the workflow.
  if (result.status === 'confirmed') transition(orderPublicId, 'preparing', actor)
  if (result.allReady) transition(orderPublicId, 'ready', actor)
  else publish('kitchen', 'order', { id: orderPublicId, status: 'preparing' })
  audit(staff, staff.name, `kitchen.lines.${to}`, orderPublicId, input.lineIds?.join(',') ?? (input.stationId ? `station ${input.stationId}` : 'all'))
  return { ok: true }
}

export function setRush(staff: Staff, orderPublicId: string, rush: boolean) {
  const r = run(`UPDATE orders SET priority = ?, updated_at = datetime('now') WHERE public_id = ? AND status NOT IN ('completed','cancelled','rejected')`, rush ? 1 : 0, orderPublicId)
  if (!r.changes) throw new ApiError(404, 'Order not found or already closed', 'not_found')
  audit(staff, staff.name, rush ? 'order.rush' : 'order.unrush', orderPublicId)
  publish('kitchen', 'order', { id: orderPublicId })
  publish('staff', 'order', { id: orderPublicId })
}
