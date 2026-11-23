import 'server-only'
import { run } from './db'
import { publish } from './events'
import type { Audience } from '../permissions'

/** Stores a staff notification for one audience and pings live screens. Call inside the transaction that caused it. */
export function notify(audience: Audience, kind: string, title: string, body = '', orderId: number | null = null) {
  run('INSERT INTO notifications (audience, kind, title, body, order_id) VALUES (?, ?, ?, ?, ?)', audience, kind, title, body, orderId)
  publish(audience === 'kitchen' ? 'kitchen' : 'staff', 'notification', { audience, kind, title })
}
