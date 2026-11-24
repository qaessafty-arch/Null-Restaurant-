import { ApiError, body, bool, int, json, route, str } from '@/lib/server/http'
import { audit, requirePerm } from '@/lib/server/auth'
import { all, get, run, tx } from '@/lib/server/db'
import { randomToken } from '@/lib/server/security'
import { originOf } from '@/lib/server/origin'

export const dynamic = 'force-dynamic'

export const GET = route(async (req) => {
  await requirePerm('tables.manage')
  const origin = originOf(req)
  const rows = all<{ id: number; public_id: string; number: string; location: string; qr_token: string; active: number; occupied: number; waiter_id: number | null; waiter: string | null; open_orders: number
    section_id: number | null; capacity: number; shape: string; pos_x: number | null; pos_y: number | null }>(
    `SELECT t.*, s.name AS waiter,
       (SELECT COUNT(*) FROM orders o WHERE o.table_id = t.id AND o.status NOT IN ('completed','rejected','cancelled')) AS open_orders
     FROM tables t LEFT JOIN staff s ON s.id = t.waiter_id ORDER BY CAST(t.number AS INTEGER), t.number`)
  return json({
    tables: rows.map((t) => ({
      id: t.id, number: t.number, location: t.location, active: !!t.active, occupied: !!t.occupied,
      waiterId: t.waiter_id, waiter: t.waiter, openOrders: t.open_orders, qrUrl: `${origin}/t/${t.qr_token}`,
      sectionId: t.section_id, capacity: t.capacity, shape: t.shape, x: t.pos_x, y: t.pos_y,
    })),
    sections: all<{ id: number; name: string; sort: number }>('SELECT id, name, sort FROM sections ORDER BY sort, id'),
    waiters: all<{ id: number; name: string }>(`SELECT id, name FROM staff WHERE role = 'waiter' AND active = 1 ORDER BY name`),
  })
})

const SHAPES = ['square', 'round', 'rect']
const section = (v: unknown) => {
  const id = int(v, 'section', { min: 1, required: false })
  if (id && !get('SELECT 1 FROM sections WHERE id = ?', id)) throw new ApiError(404, 'Section not found', 'not_found')
  return id
}
const capacityOf = (v: unknown) => int(v ?? 4, 'seats', { min: 1, max: 40 })!
const newTable = (number: string, location: string, waiterId: number | null, sectionId: number | null = null, capacity = 4) =>
  run('INSERT INTO tables (public_id, number, location, qr_token, waiter_id, section_id, capacity) VALUES (?,?,?,?,?,?,?)',
    randomToken(9), number, location, randomToken(18), waiterId, sectionId, capacity)

export const POST = route(async (req) => {
  const staff = await requirePerm('tables.manage')
  const b = await body(req)
  const created: string[] = []
  tx(() => {
    if (b.count !== undefined) {
      // Bulk: "add 12 tables starting at 1"
      const count = int(b.count, 'count', { min: 1, max: 200 })!
      const start = int(b.start ?? 1, 'start', { min: 1, max: 9999 })!
      const location = str(b.location, 'location', { max: 60 })
      const sec = section(b.sectionId), cap = capacityOf(b.capacity)
      for (let n = start; n < start + count; n++) {
        if (get('SELECT 1 FROM tables WHERE number = ?', String(n))) continue
        newTable(String(n), location, null, sec, cap)
        created.push(String(n))
      }
    } else {
      const number = str(b.number, 'table number', { required: true, max: 20 })
      if (get('SELECT 1 FROM tables WHERE number = ?', number)) throw new ApiError(409, `Table ${number} already exists`, 'duplicate')
      newTable(number, str(b.location, 'location', { max: 60 }), int(b.waiterId, 'waiter', { min: 1, required: false }), section(b.sectionId), capacityOf(b.capacity))
      created.push(number)
    }
  })
  audit(staff, staff.name, 'table.create', created.join(','))
  return json({ created }, { status: 201 })
})

export const PATCH = route(async (req) => {
  const staff = await requirePerm('tables.manage')
  const b = await body(req)
  const id = int(b.id, 'id', { min: 1 })!
  const t = get<{ number: string }>('SELECT number FROM tables WHERE id = ?', id)
  if (!t) throw new ApiError(404, 'Table not found', 'not_found')
  if (b.number !== undefined) {
    const number = str(b.number, 'table number', { required: true, max: 20 })
    const clash = get('SELECT 1 FROM tables WHERE number = ? AND id != ?', number, id)
    if (clash) throw new ApiError(409, `Table ${number} already exists`, 'duplicate')
    run('UPDATE tables SET number = ? WHERE id = ?', number, id)
  }
  if (b.location !== undefined) run('UPDATE tables SET location = ? WHERE id = ?', str(b.location, 'location', { max: 60 }), id)
  if (b.active !== undefined) {
    run('UPDATE tables SET active = ? WHERE id = ?', bool(b.active), id)
    if (!bool(b.active)) run(`UPDATE table_sessions SET closed_at = datetime('now') WHERE table_id = ? AND closed_at IS NULL`, id)
  }
  if (b.occupied !== undefined) run('UPDATE tables SET occupied = ? WHERE id = ?', bool(b.occupied), id)
  if (b.capacity !== undefined) run('UPDATE tables SET capacity = ? WHERE id = ?', capacityOf(b.capacity), id)
  if (b.sectionId !== undefined) run('UPDATE tables SET section_id = ? WHERE id = ?', section(b.sectionId), id)
  if (b.shape !== undefined) {
    if (!SHAPES.includes(b.shape as string)) throw new ApiError(400, 'Shape must be square, round or rect', 'invalid')
    run('UPDATE tables SET shape = ? WHERE id = ?', b.shape, id)
  }
  if (b.x !== undefined || b.y !== undefined) {
    // Floor plan position, as a percentage of the room's width and height.
    const pct = (v: unknown, k: string) => { const n = Number(v); if (!Number.isFinite(n) || n < 0 || n > 100) throw new ApiError(400, `${k} must be 0-100`, 'invalid'); return Math.round(n * 10) / 10 }
    run('UPDATE tables SET pos_x = ?, pos_y = ? WHERE id = ?', pct(b.x, 'x'), pct(b.y, 'y'), id)
  }
  if (b.waiterId !== undefined) {
    const w = int(b.waiterId, 'waiter', { min: 1, required: false })
    if (w && !get(`SELECT 1 FROM staff WHERE id = ? AND role = 'waiter' AND active = 1`, w)) throw new ApiError(400, 'Choose an active waiter', 'invalid')
    run('UPDATE tables SET waiter_id = ? WHERE id = ?', w, id)
  }
  if (b.regenerateQr === true) {
    // Old printed QR codes stop working immediately and open sessions are closed.
    run('UPDATE tables SET qr_token = ? WHERE id = ?', randomToken(18), id)
    run(`UPDATE table_sessions SET closed_at = datetime('now') WHERE table_id = ? AND closed_at IS NULL`, id)
  }
  audit(staff, staff.name, 'table.update', String(id), JSON.stringify(b).slice(0, 200))
  return json({ ok: true })
})

export const DELETE = route(async (req) => {
  const staff = await requirePerm('tables.manage')
  const id = int(new URL(req.url).searchParams.get('id'), 'id', { min: 1 })!
  const used = get<{ c: number }>('SELECT COUNT(*) c FROM orders WHERE table_id = ?', id)!.c
  if (used) throw new ApiError(409, 'This table has order history. Disable it instead of deleting it.', 'has_history')
  run('DELETE FROM tables WHERE id = ?', id)
  audit(staff, staff.name, 'table.delete', String(id))
  return json({ ok: true })
})
