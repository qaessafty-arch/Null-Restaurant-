import { int, json, route } from '@/lib/server/http'
import { requireStaff } from '@/lib/server/auth'
import { audiencesFor } from '@/lib/permissions'
import { all } from '@/lib/server/db'
import { iso } from '@/lib/server/orders'

export const dynamic = 'force-dynamic'

export const GET = route(async (req) => {
  const staff = await requireStaff()
  const after = int(new URL(req.url).searchParams.get('after') ?? 0, 'after', { min: 0 })!
  const audiences = audiencesFor(staff.role)
  if (!audiences.length) return json({ notifications: [] })
  const rows = all<{ id: number; audience: string; kind: string; title: string; body: string; created_at: string }>(
    `SELECT id, audience, kind, title, body, created_at FROM notifications
     WHERE id > ? AND audience IN (${audiences.map(() => '?').join(',')}) ORDER BY id DESC LIMIT 30`, after, ...audiences)
  return json({ notifications: rows.map((r) => ({ ...r, created_at: iso(r.created_at) })) })
})
