import 'server-only'
import { get, run, tx } from './db'
import { ApiError } from './http'
import { audit, type Staff } from './auth'
import { publish } from './events'
import { getSettings } from './settings'
import { randomToken, sha256 } from './security'
import { insertLines, nextOrderNumber, notify, priceCart, type CartLine } from './orders'

/**
 * Orders entered by staff at the POS: walk-in, takeaway, delivery, or for a table. Staff are trusted,
 * so the order skips guest verification and goes straight to the kitchen. Prices still come only
 * from priceCart; the POS screen's numbers are display only.
 */

export const ORDER_TYPES = ['dine_in', 'walk_in', 'takeaway', 'delivery'] as const
export type OrderType = (typeof ORDER_TYPES)[number]

export type StaffOrderInput = {
  type: OrderType
  tableId?: number | null
  lines: CartLine[]
  note?: string
  customerName?: string
  customerPhone?: string
  deliveryAddress?: string
  idempotencyKey: string
}

const clean = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max)

export function createStaffOrder(staff: Staff, input: StaffOrderInput) {
  const type = input.type
  if (!(ORDER_TYPES as readonly string[]).includes(type)) throw new ApiError(400, 'Choose an order type', 'invalid_type')
  const key = clean(input.idempotencyKey, 80)
  if (key.length < 8) throw new ApiError(400, 'Missing idempotency key', 'invalid')
  const name = clean(input.customerName, 80)
  const phone = clean(input.customerPhone, 30)
  const address = clean(input.deliveryAddress, 300)
  if (type === 'delivery' && (!phone || !address)) throw new ApiError(400, 'Delivery orders need a phone number and an address', 'missing_customer')
  if (type === 'delivery' && !getSettings().deliveryEnabled) throw new ApiError(403, 'Delivery is switched off', 'delivery_disabled')
  if (phone && !/^[+\d][\d\s-]{5,}$/.test(phone)) throw new ApiError(400, 'Check the phone number', 'invalid_phone')

  const created = tx(() => {
    const dup = get<{ public_id: string }>('SELECT public_id FROM orders WHERE created_by = ? AND idempotency_key = ? AND session_id IS NULL', staff.id, key)
    if (dup) return { publicId: dup.public_id, trackToken: null as string | null, duplicate: true }

    let table: { id: number; number: string } | undefined
    if (type === 'dine_in') {
      if (!input.tableId) throw new ApiError(400, 'Choose a table', 'no_table')
      table = get<{ id: number; number: string }>('SELECT id, number FROM tables WHERE id = ? AND active = 1', Number(input.tableId))
      if (!table) throw new ApiError(404, 'Table not found', 'not_found')
    }
    const priced = priceCart(input.lines)
    const number = nextOrderNumber()
    const publicId = randomToken(9)
    const trackToken = randomToken(24)
    const r = run(
      `INSERT INTO orders (public_id, number, type, channel, table_id, table_number, customer_name, customer_phone, delivery_address,
         created_by, idempotency_key, track_token_hash, status, verification_status, subtotal, tax, service_charge, total,
         customer_note, est_ready_minutes, confirmed_at, tax_rate, service_rate)
       VALUES (?, ?, ?, 'pos', ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', 'not_required', ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?)`,
      publicId, number, type, table?.id ?? null, table?.number ?? '', name, phone, address, staff.id, key, sha256(trackToken),
      priced.subtotal, priced.tax, priced.service, priced.total, clean(input.note, 300), priced.estMinutes, priced.taxRate, priced.serviceRate)
    const orderId = Number(r.lastInsertRowid)
    insertLines(orderId, priced.lines)
    run('INSERT INTO order_status_history (order_id, from_status, to_status, staff_id, actor, note) VALUES (?,?,?,?,?,?)',
      orderId, null, 'confirmed', staff.id, `${staff.name} (${staff.role})`, `POS ${type.replace('_', '-')}`)
    if (table) run('UPDATE tables SET occupied = 1 WHERE id = ?', table.id)
    const where = table ? `Table ${table.number}` : `${type.replace('_', '-')}${name ? ` · ${name}` : ''}`
    notify('kitchen', 'confirmed', `New order ORD-${number}`, where, orderId)
    return { publicId, trackToken, duplicate: false }
  })

  if (!created.duplicate) {
    audit(staff, staff.name, 'pos.order', created.publicId, type)
    publish('staff', 'order', { id: created.publicId })
    publish('kitchen', 'order', { id: created.publicId, status: 'confirmed' })
  }
  return created
}
