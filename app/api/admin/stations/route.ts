import { ApiError, body, bool, int, json, route, str } from '@/lib/server/http'
import { audit, requirePerm } from '@/lib/server/auth'
import { get, run } from '@/lib/server/db'
import { listStations } from '@/lib/server/kitchen'

export const dynamic = 'force-dynamic'

const color = (v: unknown) => {
  const c = str(v, 'colour', { max: 7 }) || '#d95b32'
  if (!/^#[0-9a-f]{6}$/i.test(c)) throw new ApiError(400, 'Colour must look like #d95b32', 'invalid')
  return c
}

export const GET = route(async () => {
  await requirePerm('menu.manage', 'kitchen.operate')
  return json({ stations: listStations() })
})

export const POST = route(async (req) => {
  const staff = await requirePerm('menu.manage')
  const b = await body(req)
  const name = str(b.name, 'name', { required: true, max: 40 })
  if (get('SELECT 1 FROM kitchen_stations WHERE name = ?', name)) throw new ApiError(409, 'A station with that name exists', 'duplicate')
  const sort = (get<{ m: number | null }>('SELECT MAX(sort) m FROM kitchen_stations')!.m ?? -1) + 1
  const r = run('INSERT INTO kitchen_stations (name, color, sort) VALUES (?,?,?)', name, color(b.color), sort)
  audit(staff, staff.name, 'station.create', String(r.lastInsertRowid), name)
  return json({ id: Number(r.lastInsertRowid) }, { status: 201 })
})

export const PATCH = route(async (req) => {
  const staff = await requirePerm('menu.manage')
  const b = await body(req)
  const id = int(b.id, 'id', { min: 1 })!
  if (!get('SELECT 1 FROM kitchen_stations WHERE id = ?', id)) throw new ApiError(404, 'Station not found', 'not_found')
  if (b.name !== undefined) {
    const name = str(b.name, 'name', { required: true, max: 40 })
    if (get('SELECT 1 FROM kitchen_stations WHERE name = ? AND id != ?', name, id)) throw new ApiError(409, 'A station with that name exists', 'duplicate')
    run('UPDATE kitchen_stations SET name = ? WHERE id = ?', name, id)
  }
  if (b.color !== undefined) run('UPDATE kitchen_stations SET color = ? WHERE id = ?', color(b.color), id)
  if (b.active !== undefined) run('UPDATE kitchen_stations SET active = ? WHERE id = ?', bool(b.active), id)
  audit(staff, staff.name, 'station.update', String(id))
  return json({ stations: listStations() })
})

/** Routing: send a category (and, optionally, one item) to a station. stationId null = unassigned. */
export const PUT = route(async (req) => {
  const staff = await requirePerm('menu.manage')
  const b = await body(req)
  const stationId = b.stationId === null || b.stationId === '' ? null : int(b.stationId, 'station', { min: 1 })
  if (stationId && !get('SELECT 1 FROM kitchen_stations WHERE id = ?', stationId)) throw new ApiError(404, 'Station not found', 'not_found')
  if (b.categoryId !== undefined) {
    const r = run('UPDATE categories SET station_id = ? WHERE id = ?', stationId, int(b.categoryId, 'category', { min: 1 }))
    if (!r.changes) throw new ApiError(404, 'Category not found', 'not_found')
  } else if (b.itemId !== undefined) {
    const r = run('UPDATE items SET station_id = ? WHERE id = ?', stationId, int(b.itemId, 'item', { min: 1 }))
    if (!r.changes) throw new ApiError(404, 'Item not found', 'not_found')
  } else throw new ApiError(400, 'Give a category or an item', 'invalid')
  audit(staff, staff.name, 'station.route', String(b.categoryId ?? `item ${b.itemId}`), String(stationId ?? 'none'))
  return json({ ok: true })
})
