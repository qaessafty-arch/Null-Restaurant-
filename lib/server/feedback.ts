import 'server-only'
import { all, get, run } from './db'
import { ApiError } from './http'
import { audit, type Staff } from './auth'
import { notify } from './notify'
import { sha256 } from './security'

/**
 * Guest feedback. Ratings from a served order (one per order, proven by its tracking token) and reviews
 * from the website. Comments appear publicly only after a manager publishes them. The public average is
 * taken over EVERY rating received, hidden ones included, so moderating comments cannot inflate the score.
 */
const iso = (s: string | null) => (s ? s.replace(' ', 'T') + 'Z' : null)
const clean = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

function rating(v: unknown) {
  const r = Number(v)
  if (!Number.isInteger(r) || r < 1 || r > 5) throw new ApiError(400, 'Choose 1 to 5 stars', 'invalid_rating')
  return r
}

export function feedbackForOrder(trackToken: string) {
  const o = get<{ id: number }>('SELECT id FROM orders WHERE track_token_hash = ?', sha256(String(trackToken)))
  if (!o) return null
  const f = get<{ rating: number; comment: string }>('SELECT rating, comment FROM feedback WHERE order_id = ?', o.id)
  return f ?? null
}

export function rateOrder(trackToken: string, input: { rating: unknown; comment?: unknown; name?: unknown }) {
  const o = get<{ id: number; number: number; status: string; customer_id: number | null; customer_name: string; table_number: string }>(
    'SELECT id, number, status, customer_id, customer_name, table_number FROM orders WHERE track_token_hash = ?', sha256(String(trackToken)))
  if (!o) throw new ApiError(404, 'Order not found', 'not_found')
  if (!['served', 'completed'].includes(o.status)) throw new ApiError(409, 'You can rate your order once it has been served', 'not_served')
  if (get('SELECT 1 FROM feedback WHERE order_id = ?', o.id)) throw new ApiError(409, 'Thanks, you already rated this order', 'already_rated')
  const r = rating(input.rating)
  const comment = clean(input.comment, 1000)
  run(`INSERT INTO feedback (order_id, customer_id, rating, comment, name, source) VALUES (?,?,?,?,?, 'order')`,
    o.id, o.customer_id, r, comment, clean(input.name, 60) || o.customer_name)
  if (r <= 2) notify('admin', 'feedback', `${r}-star rating for ORD-${o.number}`, comment || (o.table_number ? `Table ${o.table_number}` : ''), o.id)
  return { rating: r, comment }
}

export function submitReview(input: { rating: unknown; comment?: unknown; name?: unknown }) {
  const name = clean(input.name, 60)
  if (name.length < 2) throw new ApiError(400, 'Add your name', 'invalid')
  const comment = clean(input.comment, 1000)
  if (comment.length < 3) throw new ApiError(400, 'Write a few words', 'invalid')
  const r = rating(input.rating)
  run(`INSERT INTO feedback (rating, comment, name, source) VALUES (?,?,?, 'web')`, r, comment, name)
  return { pending: true }
}

/** What the public website shows: published comments, and the real average of all ratings. */
export function publicReviews(limit = 12) {
  const agg = get<{ n: number; avg: number | null }>('SELECT COUNT(*) n, AVG(rating) avg FROM feedback')!
  return {
    count: agg.n, average: agg.avg === null ? null : Math.round(agg.avg * 10) / 10,
    reviews: all<{ id: number; rating: number; comment: string; name: string; reply: string; created_at: string; source: string }>(
      `SELECT id, rating, comment, name, reply, created_at, source FROM feedback WHERE status = 'published' AND comment != '' ORDER BY id DESC LIMIT ?`, Math.min(limit, 50),
    ).map((f) => ({ id: f.id, rating: f.rating, comment: f.comment, name: f.name.split(' ')[0] || 'Guest', reply: f.reply, at: iso(f.created_at), verified: f.source === 'order' })),
  }
}

export function listFeedback(status?: string) {
  const ok = ['pending', 'published', 'hidden'].includes(status ?? '')
  return all<{ id: number; rating: number; comment: string; name: string; source: string; status: string; reply: string; created_at: string; number: number | null; table_number: string | null; customer_id: number | null }>(
    `SELECT f.*, o.number, o.table_number FROM feedback f LEFT JOIN orders o ON o.id = f.order_id ${ok ? 'WHERE f.status = ?' : ''} ORDER BY f.id DESC LIMIT 200`,
    ...(ok ? [status] : []),
  ).map((f) => ({ id: f.id, rating: f.rating, comment: f.comment, name: f.name, source: f.source, status: f.status, reply: f.reply, at: iso(f.created_at),
    order: f.number ? `ORD-${f.number}` : null, table: f.table_number, customerId: f.customer_id }))
}

export function moderate(staff: Staff, id: number, b: { status?: string; reply?: string }) {
  const f = get<{ id: number }>('SELECT id FROM feedback WHERE id = ?', id)
  if (!f) throw new ApiError(404, 'Feedback not found', 'not_found')
  if (b.status !== undefined) {
    if (!['pending', 'published', 'hidden'].includes(b.status)) throw new ApiError(400, 'Invalid status', 'invalid')
    run('UPDATE feedback SET status = ?, handled_by = ? WHERE id = ?', b.status, staff.id, id)
  }
  if (b.reply !== undefined) run('UPDATE feedback SET reply = ?, handled_by = ? WHERE id = ?', clean(b.reply, 500), staff.id, id)
  audit(staff, staff.name, 'feedback.moderate', String(id), `${b.status ?? ''} ${b.reply !== undefined ? 'reply' : ''}`.trim())
}
