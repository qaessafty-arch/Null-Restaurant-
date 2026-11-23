import { ApiError, body, bool, int, json, route, str } from '@/lib/server/http'
import { audit, requirePerm } from '@/lib/server/auth'
import { all, get, run } from '@/lib/server/db'

export const dynamic = 'force-dynamic'

const list = () => all<{ id: number; name: string; contact: string; phone: string; email: string; notes: string; active: number; ingredients: number }>(
  `SELECT s.*, (SELECT COUNT(*) FROM ingredients g WHERE g.supplier_id = s.id) AS ingredients FROM suppliers s ORDER BY s.active DESC, s.name`,
).map((s) => ({ ...s, active: !!s.active }))

function fields(b: Record<string, unknown>) {
  const email = str(b.email, 'email', { max: 120 })
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, 'Check the email address', 'invalid')
  return { name: str(b.name, 'name', { required: true, max: 80 }), contact: str(b.contact, 'contact', { max: 80 }), phone: str(b.phone, 'phone', { max: 30 }), email, notes: str(b.notes, 'notes', { max: 500 }) }
}

export const GET = route(async () => {
  await requirePerm('inventory.manage')
  return json({ suppliers: list() })
})

export const POST = route(async (req) => {
  const staff = await requirePerm('inventory.manage')
  const f = fields(await body(req))
  if (get('SELECT 1 FROM suppliers WHERE name = ?', f.name)) throw new ApiError(409, 'A supplier with that name exists', 'duplicate')
  run('INSERT INTO suppliers (name, contact, phone, email, notes) VALUES (?,?,?,?,?)', f.name, f.contact, f.phone, f.email, f.notes)
  audit(staff, staff.name, 'supplier.create', f.name)
  return json({ suppliers: list() }, { status: 201 })
})

export const PATCH = route(async (req) => {
  const staff = await requirePerm('inventory.manage')
  const b = await body(req)
  const id = int(b.id, 'id', { min: 1 })!
  if (!get('SELECT 1 FROM suppliers WHERE id = ?', id)) throw new ApiError(404, 'Supplier not found', 'not_found')
  if (b.active !== undefined && Object.keys(b).length === 2) run('UPDATE suppliers SET active = ? WHERE id = ?', bool(b.active), id)
  else {
    const f = fields(b)
    if (get('SELECT 1 FROM suppliers WHERE name = ? AND id != ?', f.name, id)) throw new ApiError(409, 'A supplier with that name exists', 'duplicate')
    run('UPDATE suppliers SET name=?, contact=?, phone=?, email=?, notes=? WHERE id=?', f.name, f.contact, f.phone, f.email, f.notes, id)
  }
  audit(staff, staff.name, 'supplier.update', String(id))
  return json({ suppliers: list() })
})
