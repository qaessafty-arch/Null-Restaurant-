import { ApiError, body, bool, int, json, route, str } from '@/lib/server/http'
import { audit, requirePerm } from '@/lib/server/auth'
import { all, get, run } from '@/lib/server/db'
import { hashPassword } from '@/lib/server/security'
import { ROLES, SUPER_ROLES, type Role } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

/** Only owners can create or promote owners; nobody can grant a role that does not exist. */
function assertAssignable(actorRole: Role, role: string) {
  if (!(ROLES as readonly string[]).includes(role)) throw new ApiError(400, 'Invalid role', 'invalid')
  if (role === 'owner' && actorRole !== 'owner') throw new ApiError(403, 'Only an owner can grant the owner role', 'forbidden')
}

const checkPassword = (p: string) => {
  if (p.length < 8) throw new ApiError(400, 'Password must be at least 8 characters', 'weak_password')
  return p
}

export const GET = route(async () => {
  await requirePerm('staff.manage')
  const rows = all<{ id: number; username: string; name: string; role: string; active: number; created_at: string; last_login_at: string | null; actions: number }>(
    `SELECT s.id, s.username, s.name, s.role, s.active, s.created_at, s.last_login_at,
       (SELECT COUNT(*) FROM audit_log a WHERE a.staff_id = s.id) AS actions FROM staff s ORDER BY s.role, s.name`)
  return json({ staff: rows.map((r) => ({ id: r.id, username: r.username, name: r.name, role: r.role, active: !!r.active, createdAt: r.created_at, lastLoginAt: r.last_login_at, actions: r.actions })) })
})

export const POST = route(async (req) => {
  const staff = await requirePerm('staff.manage')
  const b = await body(req)
  const username = str(b.username, 'username', { required: true, min: 3, max: 40 })
  const role = str(b.role, 'role', { required: true, max: 20 })
  assertAssignable(staff.role, role)
  if (get('SELECT 1 FROM staff WHERE username = ?', username)) throw new ApiError(409, 'That username is taken', 'duplicate')
  const r = run('INSERT INTO staff (username, name, role, password_hash) VALUES (?,?,?,?)',
    username, str(b.name, 'name', { required: true, max: 80 }), role, hashPassword(checkPassword(str(b.password, 'password', { required: true, max: 200 }))))
  audit(staff, staff.name, 'staff.create', username, role)
  return json({ id: Number(r.lastInsertRowid) }, { status: 201 })
})

export const PATCH = route(async (req) => {
  const staff = await requirePerm('staff.manage')
  const b = await body(req)
  const id = int(b.id, 'id', { min: 1 })!
  const target = get<{ role: string; active: number }>('SELECT role, active FROM staff WHERE id = ?', id)
  if (!target) throw new ApiError(404, 'Staff member not found', 'not_found')
  if (target.role === 'owner' && staff.role !== 'owner') throw new ApiError(403, 'Only an owner can change an owner account', 'forbidden')
  const isSuper = (r: string) => (SUPER_ROLES as string[]).includes(r)
  const lastAdmin = () => get<{ c: number }>(
    `SELECT COUNT(*) c FROM staff WHERE role IN (${SUPER_ROLES.map(() => '?').join(',')}) AND active = 1 AND id != ?`, ...SUPER_ROLES, id)!.c === 0
  if (b.role !== undefined) {
    const role = str(b.role, 'role', { required: true, max: 20 })
    assertAssignable(staff.role, role)
    if (isSuper(target.role) && !isSuper(role) && lastAdmin()) throw new ApiError(409, 'There must be at least one active administrator', 'last_admin')
    run('UPDATE staff SET role = ? WHERE id = ?', role, id)
  }
  if (b.active !== undefined) {
    if (!bool(b.active) && isSuper(target.role) && lastAdmin()) throw new ApiError(409, 'There must be at least one active administrator', 'last_admin')
    run('UPDATE staff SET active = ? WHERE id = ?', bool(b.active), id)
    if (!bool(b.active)) run('DELETE FROM staff_sessions WHERE staff_id = ?', id)
  }
  if (b.name !== undefined) run('UPDATE staff SET name = ? WHERE id = ?', str(b.name, 'name', { required: true, max: 80 }), id)
  if (b.password) {
    run('UPDATE staff SET password_hash = ? WHERE id = ?', hashPassword(checkPassword(str(b.password, 'password', { max: 200 }))), id)
    run('DELETE FROM staff_sessions WHERE staff_id = ?', id)
  }
  audit(staff, staff.name, 'staff.update', String(id), Object.keys(b).filter((k) => k !== 'password').join(','))
  return json({ ok: true })
})
