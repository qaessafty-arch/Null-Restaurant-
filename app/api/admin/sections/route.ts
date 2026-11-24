import { ApiError, body, int, json, route, str } from '@/lib/server/http'
import { audit, requirePerm } from '@/lib/server/auth'
import { all, get, run } from '@/lib/server/db'

export const dynamic = 'force-dynamic'

const list = () => all<{ id: number; name: string; sort: number }>('SELECT id, name, sort FROM sections ORDER BY sort, id')

export const GET = route(async () => {
  await requirePerm('tables.view', 'reservations.manage')
  return json({ sections: list() })
})

export const POST = route(async (req) => {
  const staff = await requirePerm('tables.manage')
  const name = str((await body(req)).name, 'name', { required: true, max: 40 })
  if (get('SELECT 1 FROM sections WHERE name = ?', name)) throw new ApiError(409, 'A section with that name exists', 'duplicate')
  const sort = (get<{ m: number | null }>('SELECT MAX(sort) m FROM sections')!.m ?? -1) + 1
  run('INSERT INTO sections (name, sort) VALUES (?, ?)', name, sort)
  audit(staff, staff.name, 'section.create', name)
  return json({ sections: list() }, { status: 201 })
})

export const PATCH = route(async (req) => {
  const staff = await requirePerm('tables.manage')
  const b = await body(req)
  const id = int(b.id, 'id', { min: 1 })!
  const name = str(b.name, 'name', { required: true, max: 40 })
  if (get('SELECT 1 FROM sections WHERE name = ? AND id != ?', name, id)) throw new ApiError(409, 'A section with that name exists', 'duplicate')
  if (!run('UPDATE sections SET name = ? WHERE id = ?', name, id).changes) throw new ApiError(404, 'Section not found', 'not_found')
  audit(staff, staff.name, 'section.update', String(id), name)
  return json({ sections: list() })
})

export const DELETE = route(async (req) => {
  const staff = await requirePerm('tables.manage')
  const id = int(new URL(req.url).searchParams.get('id'), 'id', { min: 1 })!
  const n = get<{ c: number }>('SELECT COUNT(*) c FROM tables WHERE section_id = ? AND active = 1', id)!.c
  if (n) throw new ApiError(409, `Move the ${n} table(s) in this section first`, 'not_empty')
  run('DELETE FROM sections WHERE id = ?', id)
  audit(staff, staff.name, 'section.delete', String(id))
  return json({ sections: list() })
})
