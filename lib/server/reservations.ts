import 'server-only'
import crypto from 'node:crypto'
import { all, get, run, tx } from './db'
import { ApiError } from './http'
import { audit, type Staff } from './auth'
import { publish } from './events'
import { getSettings } from './settings'
import { notify } from './orders'
import { randomToken, sha256 } from './security'
import { fromSql, hhmm, localDate, localToUtc, openingWindow, toSql } from '../time'

/**
 * Reservations. A booking holds one table for [start, start + duration); two bookings on the same
 * table may not come within the buffer of each other. The availability check and the insert/update
 * run in one immediate (serialised) transaction, so two guests cannot take the same table.
 */

export const RES_STATUSES = ['pending', 'confirmed', 'seated', 'completed', 'cancelled', 'no_show'] as const
export type ResStatus = (typeof RES_STATUSES)[number]
const HOLDING = `('pending','confirmed','seated')`
export const OCCASIONS = ['', 'birthday', 'anniversary', 'date', 'business', 'celebration', 'other'] as const

const NEXT: Record<ResStatus, ResStatus[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['seated', 'cancelled', 'no_show', 'pending'],
  seated: ['completed'],
  completed: [], cancelled: [], no_show: [],
}

const iso = (s: string | null) => (s ? s.replace(' ', 'T') + 'Z' : null)
const clean = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max)
const addMin = (d: Date, m: number) => new Date(d.getTime() + m * 60000)

type TableRow = { id: number; number: string; capacity: number; section_id: number | null; manual_state: string | null; busy: number }
type ResRow = {
  id: number; public_id: string; code: string; customer_id: number | null; name: string; phone: string; email: string; party_size: number
  starts_at: string; ends_at: string; table_id: number | null; section_pref: number | null; status: ResStatus; occasion: string; requests: string
  notes: string; source: string; cancel_reason: string; created_at: string; updated_at: string; table_number?: string | null; section?: string | null
}

function view(r: ResRow, staffView: boolean) {
  const tz = getSettings().timezone
  const start = fromSql(r.starts_at)
  return {
    id: r.public_id, code: r.code, name: r.name, phone: staffView ? r.phone : r.phone.replace(/.(?=.{3})/g, '•'), email: staffView ? r.email : '',
    partySize: r.party_size, startsAt: iso(r.starts_at), endsAt: iso(r.ends_at), date: localDate(start, tz),
    time: new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(start),
    tableId: staffView ? r.table_id : undefined, tableNumber: r.table_number ?? null, sectionPref: r.section_pref, section: r.section ?? null,
    status: r.status, occasion: r.occasion, requests: r.requests, notes: staffView ? r.notes : undefined, source: r.source,
    cancelReason: r.cancel_reason, createdAt: iso(r.created_at),
  }
}

function load(where: string, ...args: unknown[]) {
  return get<ResRow>(
    `SELECT r.*, t.number AS table_number, sc.name AS section FROM reservations r
     LEFT JOIN tables t ON t.id = r.table_id LEFT JOIN sections sc ON sc.id = r.section_pref WHERE ${where}`, ...args)
}

// ---------------------------------------------------------------- availability

/** Tables that can take `party` from start to end. Ordered best first (preferred section, smallest fit). */
function freeTables(start: Date, end: Date, party: number, sectionPref: number | null, excludeResId: number | null) {
  const s = getSettings()
  const buffer = s.reservationBufferMinutes
  // A booking starting soon cannot use a table that has guests sitting at it right now.
  const soon = start.getTime() < Date.now() + s.reservationDurationMinutes * 60000
  const tables = all<TableRow>(
    `SELECT t.id, t.number, t.capacity, t.section_id, t.manual_state,
       (EXISTS (SELECT 1 FROM orders o WHERE o.table_id = t.id AND o.status NOT IN ('cancelled','rejected') AND (o.status != 'completed' OR o.payment_status != 'paid'))
        OR EXISTS (SELECT 1 FROM table_sessions ts WHERE ts.table_id = t.id AND ts.closed_at IS NULL AND ts.expires_at > datetime('now'))
        OR t.manual_state IN ('seated','cleaning')) AS busy
     FROM tables t WHERE t.active = 1 AND COALESCE(t.manual_state, '') != 'out_of_service' AND t.capacity >= ?`, party)
  if (!tables.length) return []
  const clash = new Set(all<{ table_id: number }>(
    `SELECT DISTINCT table_id FROM reservations WHERE table_id IS NOT NULL AND status IN ${HOLDING} AND id != ?
       AND starts_at < ? AND ends_at > ?`,
    excludeResId ?? 0, toSql(addMin(end, buffer)), toSql(addMin(start, -buffer))).map((r) => r.table_id))
  return tables
    .filter((t) => !clash.has(t.id) && !(soon && t.busy))
    .sort((a, b) => Number(b.section_id === sectionPref) - Number(a.section_id === sectionPref) || a.capacity - b.capacity || a.id - b.id)
}

function checkTable(tableId: number, start: Date, end: Date, party: number, excludeResId: number | null) {
  const t = get<{ id: number; capacity: number; active: number; manual_state: string | null }>('SELECT id, capacity, active, manual_state FROM tables WHERE id = ?', tableId)
  if (!t || !t.active) throw new ApiError(404, 'Table not found', 'not_found')
  if (t.manual_state === 'out_of_service') throw new ApiError(409, 'That table is out of service', 'out_of_service')
  if (t.capacity < party) throw new ApiError(409, `That table seats ${t.capacity}`, 'too_small')
  const buffer = getSettings().reservationBufferMinutes
  const other = get<{ code: string; name: string }>(
    `SELECT code, name FROM reservations WHERE table_id = ? AND status IN ${HOLDING} AND id != ? AND starts_at < ? AND ends_at > ?`,
    tableId, excludeResId ?? 0, toSql(addMin(end, buffer)), toSql(addMin(start, -buffer)))
  if (other) throw new ApiError(409, `That table is already booked then (${other.name}, ${other.code})`, 'double_booked')
}

function parseDay(date: unknown) {
  const d = clean(date, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d))) throw new ApiError(400, 'Choose a date', 'invalid_date')
  return d
}

/** Public slot list for a local date. */
export function availability(dateIn: unknown, partyIn: unknown, sectionIn?: unknown) {
  const s = getSettings()
  if (!s.reservationsEnabled) throw new ApiError(403, 'Online reservations are not available right now', 'reservations_disabled')
  const date = parseDay(dateIn)
  const party = Number(partyIn)
  if (!Number.isInteger(party) || party < 1 || party > s.reservationMaxParty)
    throw new ApiError(400, `For more than ${s.reservationMaxParty} guests please call us`, 'party_size')
  const section = sectionIn ? Number(sectionIn) || null : null
  const today = localDate(new Date(), s.timezone)
  const last = localDate(addMin(new Date(), s.reservationMaxDays * 1440), s.timezone)
  if (date < today || date > last) return { date, open: false, slots: [] as Array<{ time: string; available: boolean }> }
  const win = openingWindow(date, s.hours, s.timezone)
  if (!win) return { date, open: false, slots: [] }
  const earliest = Date.now() + s.reservationLeadMinutes * 60000
  const slots: Array<{ time: string; available: boolean }> = []
  for (let t = win.open; addMin(t, s.reservationDurationMinutes) <= win.close; t = addMin(t, s.reservationSlotMinutes)) {
    const label = new Intl.DateTimeFormat('en-GB', { timeZone: s.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(t)
    const ok = t.getTime() >= earliest && freeTables(t, addMin(t, s.reservationDurationMinutes), party, section, null).length > 0
    slots.push({ time: label, available: ok })
  }
  return { date, open: true, slots }
}

// ---------------------------------------------------------------- create

export type ReservationInput = {
  name: string; phone: string; email?: string; partySize: number; date: string; time: string; sectionId?: number | null
  occasion?: string; requests?: string; idempotencyKey: string
  // staff only
  tableId?: number | null; notes?: string; source?: 'phone' | 'walk_in' | 'staff'
}

function newCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  for (let i = 0; i < 20; i++) {
    const c = Array.from(crypto.randomBytes(6), (b) => A[b % A.length]).join('')
    if (!get('SELECT 1 FROM reservations WHERE code = ?', c)) return c
  }
  throw new ApiError(503, 'Please try again', 'busy')
}

function upsertCustomer(name: string, phone: string, email: string) {
  const c = get<{ id: number; email: string }>('SELECT id, email FROM customers WHERE phone = ?', phone)
  if (c) {
    if (!c.email && email) run(`UPDATE customers SET email = ?, updated_at = datetime('now') WHERE id = ?`, email, c.id)
    return c.id
  }
  return Number(run('INSERT INTO customers (name, phone, email) VALUES (?,?,?)', name, phone, email).lastInsertRowid)
}

function validated(input: ReservationInput, staff: Staff | null) {
  const s = getSettings()
  const name = clean(input.name, 80)
  if (name.length < 2) throw new ApiError(400, 'Enter a name for the booking', 'invalid_name')
  const phone = clean(input.phone, 30).replace(/[\s-]/g, '')
  if (!/^\+?\d{7,15}$/.test(phone)) throw new ApiError(400, 'Enter a phone number we can reach you on', 'invalid_phone')
  const email = clean(input.email, 120)
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, 'Check the email address', 'invalid_email')
  const party = Number(input.partySize)
  const maxParty = staff ? 100 : s.reservationMaxParty
  if (!Number.isInteger(party) || party < 1 || party > maxParty) throw new ApiError(400, `Party size must be 1 to ${maxParty}`, 'party_size')
  const date = parseDay(input.date)
  const time = clean(input.time, 5)
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new ApiError(400, 'Choose a time', 'invalid_time')
  const start = localToUtc(date, hhmm(time), s.timezone)
  const end = addMin(start, s.reservationDurationMinutes)
  const occasion = clean(input.occasion, 20)
  if (!(OCCASIONS as readonly string[]).includes(occasion)) throw new ApiError(400, 'Unknown occasion', 'invalid')
  const sectionId = input.sectionId ? Number(input.sectionId) : null
  if (sectionId && !get('SELECT 1 FROM sections WHERE id = ?', sectionId)) throw new ApiError(400, 'Unknown seating area', 'invalid')
  if (!staff) {
    // Guests book within opening hours, with notice, not too far ahead.
    const win = openingWindow(date, s.hours, s.timezone)
    if (!win || start < win.open || end > win.close) throw new ApiError(409, 'We are not open for a full booking at that time', 'closed')
    if (start.getTime() < Date.now() + s.reservationLeadMinutes * 60000) throw new ApiError(409, 'That time is too soon to book online. Please call us.', 'too_soon')
    if (start.getTime() > Date.now() + s.reservationMaxDays * 86400000) throw new ApiError(409, `Bookings open ${s.reservationMaxDays} days ahead`, 'too_far')
  } else if (start.getTime() < Date.now() - 6 * 3600000) throw new ApiError(409, 'That time has passed', 'in_past')
  return { name, phone, email, party, start, end, occasion, sectionId, requests: clean(input.requests, 500) }
}

export function createReservation(input: ReservationInput, staff: Staff | null) {
  const s = getSettings()
  if (!staff && !s.reservationsEnabled) throw new ApiError(403, 'Online reservations are not available right now', 'reservations_disabled')
  const key = clean(input.idempotencyKey, 80)
  if (key.length < 8) throw new ApiError(400, 'Missing idempotency key', 'invalid')
  const v = validated(input, staff)
  const manageToken = randomToken(24)

  const out = tx(() => {
    const dup = get<{ id: number }>('SELECT id FROM reservations WHERE idempotency_key = ?', key)
    if (dup) return { id: dup.id, duplicate: true }
    // One live booking per phone per time: stops accidental double submissions with fresh keys too.
    if (get(`SELECT 1 FROM reservations WHERE phone = ? AND status IN ${HOLDING} AND starts_at < ? AND ends_at > ?`, v.phone, toSql(v.end), toSql(v.start)))
      throw new ApiError(409, 'There is already a booking for this phone number at that time', 'duplicate_booking')

    let tableId: number | null = null
    if (staff && input.tableId) { checkTable(Number(input.tableId), v.start, v.end, v.party, null); tableId = Number(input.tableId) }
    else tableId = freeTables(v.start, v.end, v.party, v.sectionId, null)[0]?.id ?? null
    if (!tableId && !staff) throw new ApiError(409, 'Sorry, that time just filled up. Please pick another.', 'no_availability')
    const status: ResStatus = staff ? (tableId ? 'confirmed' : 'pending') : s.reservationAutoConfirm ? 'confirmed' : 'pending'

    const customerId = upsertCustomer(v.name, v.phone, v.email)
    const r = run(
      `INSERT INTO reservations (public_id, code, manage_token_hash, customer_id, name, phone, email, party_size, starts_at, ends_at, table_id,
         section_pref, status, occasion, requests, notes, source, created_by, idempotency_key)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      randomToken(9), newCode(), sha256(manageToken), customerId, v.name, v.phone, v.email, v.party, toSql(v.start), toSql(v.end), tableId,
      v.sectionId, status, v.occasion, v.requests, staff ? clean(input.notes, 500) : '', staff ? (input.source ?? 'staff') : 'web', staff?.id ?? null, key)
    const id = Number(r.lastInsertRowid)
    run('INSERT INTO reservation_history (reservation_id, from_status, to_status, actor) VALUES (?,?,?,?)', id, null, status, staff ? staff.name : 'guest (web)')
    const when = new Intl.DateTimeFormat('en-GB', { timeZone: s.timezone, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(v.start)
    if (!staff) notify('reception', 'reservation', `New booking: ${v.name}, ${v.party} guests`, `${when}${status === 'pending' ? ' · needs confirming' : ''}`)
    return { id, duplicate: false }
  })

  const res = load('r.id = ?', out.id)!
  if (!out.duplicate) {
    if (staff) audit(staff, staff.name, 'reservation.create', res.code, `${res.party_size} @ ${res.starts_at}`)
    publish('staff', 'reservation', { id: res.public_id })
  }
  return { reservation: view(res, !!staff), manageToken: out.duplicate ? null : manageToken, duplicate: out.duplicate }
}

// ---------------------------------------------------------------- guest self-service

export function byManageToken(token: string) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 80) return null
  const r = load('r.manage_token_hash = ?', sha256(token))
  return r ? view(r, false) : null
}

export function cancelByGuest(token: string, reason: string) {
  const r = get<ResRow>('SELECT * FROM reservations WHERE manage_token_hash = ?', sha256(String(token)))
  if (!r) throw new ApiError(404, 'Booking not found', 'not_found')
  if (!['pending', 'confirmed'].includes(r.status)) throw new ApiError(409, `This booking is ${r.status.replace('_', ' ')}`, 'bad_state')
  if (fromSql(r.starts_at).getTime() < Date.now()) throw new ApiError(409, 'This booking has already started. Please call us.', 'started')
  tx(() => {
    run(`UPDATE reservations SET status = 'cancelled', cancel_reason = ?, updated_at = datetime('now') WHERE id = ?`, clean(reason, 200) || 'Cancelled by guest', r.id)
    run('INSERT INTO reservation_history (reservation_id, from_status, to_status, actor, note) VALUES (?,?,?,?,?)', r.id, r.status, 'cancelled', 'guest (web)', clean(reason, 200))
    notify('reception', 'reservation', `Booking cancelled: ${r.name}`, r.code)
  })
  publish('staff', 'reservation', { id: r.public_id })
  return byManageToken(token)
}

// ---------------------------------------------------------------- staff

export function listReservations(fromDate: string, toDate: string) {
  const tz = getSettings().timezone
  const from = toSql(localToUtc(parseDay(fromDate), 0, tz))
  const to = toSql(localToUtc(parseDay(toDate), 24 * 60, tz))
  return all<ResRow>(
    `SELECT r.*, t.number AS table_number, sc.name AS section FROM reservations r
     LEFT JOIN tables t ON t.id = r.table_id LEFT JOIN sections sc ON sc.id = r.section_pref
     WHERE r.starts_at >= ? AND r.starts_at < ? ORDER BY r.starts_at, r.id`, from, to).map((r) => view(r, true))
}

export function reservationHistory(publicId: string) {
  return all<{ from_status: string | null; to_status: string; actor: string; note: string; created_at: string }>(
    `SELECT h.* FROM reservation_history h JOIN reservations r ON r.id = h.reservation_id WHERE r.public_id = ? ORDER BY h.id`, publicId,
  ).map((h) => ({ from: h.from_status, to: h.to_status, by: h.actor, note: h.note, at: iso(h.created_at) }))
}

export function updateReservation(staff: Staff, publicId: string, input: Partial<ReservationInput>) {
  const s = getSettings()
  tx(() => {
    const r = get<ResRow>('SELECT * FROM reservations WHERE public_id = ?', publicId)
    if (!r) throw new ApiError(404, 'Reservation not found', 'not_found')
    if (!['pending', 'confirmed', 'seated'].includes(r.status)) throw new ApiError(409, `This booking is ${r.status.replace('_', ' ')}`, 'bad_state')
    const tz = s.timezone
    const cur = fromSql(r.starts_at)
    const merged: ReservationInput = {
      name: input.name ?? r.name, phone: input.phone ?? r.phone, email: input.email ?? r.email, partySize: input.partySize ?? r.party_size,
      date: input.date ?? localDate(cur, tz), time: input.time ?? new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(cur),
      sectionId: input.sectionId === undefined ? r.section_pref : input.sectionId, occasion: input.occasion ?? r.occasion,
      requests: input.requests ?? r.requests, idempotencyKey: 'unused-update',
    }
    const v = validated(merged, staff)
    let tableId: number | null = r.table_id
    if (input.tableId !== undefined) tableId = input.tableId ? Number(input.tableId) : null
    if (tableId) {
      try { checkTable(tableId, v.start, v.end, v.party, r.id) }
      catch (e) {
        // Moving the time/party with no table chosen: find another table rather than fail.
        if (input.tableId !== undefined) throw e
        tableId = freeTables(v.start, v.end, v.party, v.sectionId, r.id)[0]?.id ?? null
        if (!tableId) throw new ApiError(409, 'No table is free for that change', 'no_availability')
      }
    } else if (input.tableId === undefined) {
      tableId = freeTables(v.start, v.end, v.party, v.sectionId, r.id)[0]?.id ?? null
    }
    if (!tableId && r.status === 'seated') throw new ApiError(409, 'A seated booking needs a table', 'no_table')
    run(`UPDATE reservations SET name=?, phone=?, email=?, party_size=?, starts_at=?, ends_at=?, table_id=?, section_pref=?, occasion=?, requests=?,
           notes=?, updated_at=datetime('now') WHERE id = ?`,
      v.name, v.phone, v.email, v.party, toSql(v.start), toSql(v.end), tableId, v.sectionId, v.occasion, v.requests,
      input.notes === undefined ? r.notes : clean(input.notes, 500), r.id)
    if (r.starts_at !== toSql(v.start)) run('INSERT INTO reservation_history (reservation_id, from_status, to_status, actor, note) VALUES (?,?,?,?,?)',
      r.id, r.status, r.status, staff.name, `rescheduled from ${iso(r.starts_at)}`)
  })
  audit(staff, staff.name, 'reservation.update', publicId, Object.keys(input).join(','))
  publish('staff', 'reservation', { id: publicId })
  return view(load('r.public_id = ?', publicId)!, true)
}

export function setReservationStatus(staff: Staff, publicId: string, to: ResStatus, reasonIn = '') {
  const reason = clean(reasonIn, 300)
  tx(() => {
    const r = get<ResRow>('SELECT * FROM reservations WHERE public_id = ?', publicId)
    if (!r) throw new ApiError(404, 'Reservation not found', 'not_found')
    if (!NEXT[r.status]?.includes(to)) throw new ApiError(409, `A ${r.status.replace('_', '-')} booking cannot become ${to.replace('_', '-')}`, 'bad_transition')
    if (to === 'cancelled' && !reason) throw new ApiError(400, 'Please give a reason', 'reason_required')
    if (to === 'seated' && !r.table_id) throw new ApiError(409, 'Assign a table first', 'no_table')
    if (to === 'no_show' && fromSql(r.starts_at).getTime() > Date.now()) throw new ApiError(409, 'A booking can only be a no-show after its start time', 'too_early')
    if (to === 'seated') {
      const busy = get(`SELECT 1 FROM orders WHERE table_id = ? AND status NOT IN ('cancelled','rejected') AND (status != 'completed' OR payment_status != 'paid')`, r.table_id)
      if (busy) throw new ApiError(409, 'Guests are still at that table. Move the booking to another table.', 'table_busy')
      run(`UPDATE tables SET manual_state = NULL WHERE id = ? AND manual_state = 'cleaning'`, r.table_id)
    }
    run(`UPDATE reservations SET status = ?, cancel_reason = CASE WHEN ? = 'cancelled' THEN ? ELSE cancel_reason END, updated_at = datetime('now') WHERE id = ?`,
      to, to, reason, r.id)
    run('INSERT INTO reservation_history (reservation_id, from_status, to_status, actor, note) VALUES (?,?,?,?,?)', r.id, r.status, to, staff.name, reason)
  })
  audit(staff, staff.name, `reservation.${to}`, publicId, reason)
  publish('staff', 'reservation', { id: publicId })
  return view(load('r.public_id = ?', publicId)!, true)
}
