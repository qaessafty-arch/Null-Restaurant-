import 'server-only'
import { all, get, run } from './db'
import { ApiError } from './http'
import { audit, type Staff } from './auth'
import { publish } from './events'
import { paidFor } from './payments'
import { getSettings } from './settings'
import { fromSql, localClock } from '../time'

/**
 * Live table status, derived from orders, payments, guest requests, sessions and reservations so it can
 * never drift from reality. Only "seated", "cleaning" and "out of service" are set by hand.
 */
export const TABLE_STATUSES = ['available', 'occupied', 'reserved', 'ordering', 'waiting_food', 'waiting_payment', 'cleaning', 'out_of_service'] as const
export type TableStatus = (typeof TABLE_STATUSES)[number]

const iso = (s: string | null) => (s ? s.replace(' ', 'T') + 'Z' : null)
const RESERVED_LOOKAHEAD_MIN = 60

type TRow = {
  id: number; number: string; location: string; capacity: number; shape: string; pos_x: number | null; pos_y: number | null
  section_id: number | null; section: string | null; waiter_id: number | null; waiter: string | null; manual_state: string | null; manual_state_at: string | null
  active: number; live_session: number; open_requests: number; bill_requested: number
}
type ORow = { id: number; public_id: string; number: number; table_id: number; status: string; total: number; payment_status: string; created_at: string }
type RRow = { id: number; public_id: string; table_id: number; name: string; party_size: number; starts_at: string; status: string }

export function floor() {
  const tables = all<TRow>(
    `SELECT t.id, t.number, t.location, t.capacity, t.shape, t.pos_x, t.pos_y, t.section_id, sc.name AS section, t.waiter_id, s.name AS waiter,
       t.manual_state, t.manual_state_at, t.active,
       EXISTS (SELECT 1 FROM table_sessions ts WHERE ts.table_id = t.id AND ts.closed_at IS NULL AND ts.expires_at > datetime('now')) AS live_session,
       (SELECT COUNT(*) FROM service_requests r WHERE r.table_id = t.id AND r.status != 'completed') AS open_requests,
       EXISTS (SELECT 1 FROM service_requests r WHERE r.table_id = t.id AND r.type = 'bill' AND r.status != 'completed') AS bill_requested
     FROM tables t LEFT JOIN staff s ON s.id = t.waiter_id LEFT JOIN sections sc ON sc.id = t.section_id
     WHERE t.active = 1 ORDER BY sc.sort, CAST(t.number AS INTEGER), t.number`)
  // "Open" for the floor: not cancelled, and either still in service or not yet fully paid.
  const orders = all<ORow>(
    `SELECT id, public_id, number, table_id, status, total, payment_status, created_at FROM orders
     WHERE table_id IS NOT NULL AND status NOT IN ('cancelled','rejected') AND (status != 'completed' OR payment_status NOT IN ('paid'))`)
  const paid = paidFor(orders.map((o) => o.id))
  const res = all<RRow>(
    `SELECT id, public_id, table_id, name, party_size, starts_at, status FROM reservations
     WHERE table_id IS NOT NULL AND (status = 'seated' OR (status IN ('pending','confirmed') AND starts_at <= datetime('now', '+${RESERVED_LOOKAHEAD_MIN} minutes') AND ends_at > datetime('now')))
     ORDER BY starts_at`)

  const tz = getSettings().timezone
  return tables.map((t) => {
    const mine = orders.filter((o) => o.table_id === t.id)
    const due = mine.reduce((a, o) => a + Math.max(0, o.total - (paid.get(o.id) ?? 0)), 0)
    const seatedRes = res.find((r) => r.table_id === t.id && r.status === 'seated')
    const upcoming = res.find((r) => r.table_id === t.id && r.status !== 'seated')
    let status: TableStatus
    // Real orders outrank a forgotten "cleaning" flag; only out-of-service outranks orders.
    if (t.manual_state === 'out_of_service') status = 'out_of_service'
    else if (mine.length) {
      const inKitchen = mine.some((o) => ['verified', 'confirmed', 'preparing', 'ready'].includes(o.status))
      const ordering = mine.some((o) => o.status === 'awaiting_verification')
      const eaten = mine.every((o) => ['served', 'completed'].includes(o.status))
      status = t.bill_requested || (eaten && due > 0) ? 'waiting_payment' : ordering ? 'ordering' : inKitchen ? 'waiting_food' : 'occupied'
    } else if (t.manual_state === 'cleaning') status = 'cleaning'
    else if (t.manual_state === 'seated' || seatedRes || t.live_session) status = 'occupied'
    else if (upcoming) status = 'reserved'
    else status = 'available'
    return {
      id: t.id, number: t.number, location: t.location, capacity: t.capacity, shape: t.shape, x: t.pos_x, y: t.pos_y,
      sectionId: t.section_id, section: t.section, waiterId: t.waiter_id, waiter: t.waiter, status,
      manualState: t.manual_state, manualStateAt: iso(t.manual_state_at),
      openOrders: mine.filter((o) => o.status !== 'completed').length, due, openRequests: t.open_requests, billRequested: !!t.bill_requested,
      since: iso(mine[0]?.created_at ?? null),
      reservation: (seatedRes ?? upcoming)
        ? { id: (seatedRes ?? upcoming)!.public_id, name: (seatedRes ?? upcoming)!.name, partySize: (seatedRes ?? upcoming)!.party_size, startsAt: iso((seatedRes ?? upcoming)!.starts_at), time: localClock(fromSql((seatedRes ?? upcoming)!.starts_at), tz), status: (seatedRes ?? upcoming)!.status }
        : null,
    }
  })
}

/** Manual table actions from the floor. */
export function setTableState(staff: Staff, tableId: number, action: 'seat' | 'clear' | 'cleaned' | 'out_of_service' | 'back_in_service') {
  const t = get<{ id: number; number: string; manual_state: string | null }>('SELECT id, number, manual_state FROM tables WHERE id = ? AND active = 1', tableId)
  if (!t) throw new ApiError(404, 'Table not found', 'not_found')
  const open = get<{ c: number }>(
    `SELECT COUNT(*) c FROM orders WHERE table_id = ? AND status NOT IN ('cancelled','rejected') AND (status != 'completed' OR payment_status != 'paid')`, tableId)!.c
  const set = (state: string | null) => run(`UPDATE tables SET manual_state = ?, manual_state_at = datetime('now') WHERE id = ?`, state, tableId)
  switch (action) {
    case 'seat':
      if (t.manual_state === 'out_of_service') throw new ApiError(409, 'This table is out of service', 'out_of_service')
      set('seated'); break
    case 'clear':
      // Guests left: their QR sessions end (so nobody keeps ordering to this table) and it needs cleaning.
      if (open) throw new ApiError(409, 'This table still has unpaid or unfinished orders', 'table_busy')
      run(`UPDATE table_sessions SET closed_at = datetime('now') WHERE table_id = ? AND closed_at IS NULL`, tableId)
      run(`UPDATE service_requests SET status = 'completed', handled_by = ?, updated_at = datetime('now') WHERE table_id = ? AND status != 'completed'`, staff.id, tableId)
      run(`UPDATE reservations SET status = 'completed', updated_at = datetime('now') WHERE table_id = ? AND status = 'seated'`, tableId)
      run('UPDATE tables SET occupied = 0 WHERE id = ?', tableId)
      set('cleaning'); break
    case 'cleaned':
      if (t.manual_state !== 'cleaning') throw new ApiError(409, 'This table is not marked for cleaning', 'bad_state')
      set(null); break
    case 'out_of_service':
      if (open) throw new ApiError(409, 'This table still has unpaid or unfinished orders', 'table_busy')
      set('out_of_service'); break
    case 'back_in_service':
      if (t.manual_state !== 'out_of_service') throw new ApiError(409, 'This table is in service', 'bad_state')
      set(null); break
    default:
      throw new ApiError(400, 'Unknown action', 'invalid')
  }
  audit(staff, staff.name, `table.${action}`, t.number)
  publish('staff', 'table', { id: tableId })
}
