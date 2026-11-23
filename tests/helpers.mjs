// Shared helpers for the API test files. Each file runs against the same server (scripts/test-local.sh)
// and creates its own uniquely named staff, so files do not depend on each other.
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

export const BASE = process.env.BASE || 'http://localhost:3100'
export const ADMIN = { username: 'admin', password: process.env.ADMIN_PASSWORD || 'Admin#12345' }
export const PASSWORD = 'Password#1234'
export const sql = () => new DatabaseSync(process.env.DATABASE_PATH)
export const idem = () => crypto.randomUUID()
export const uniq = (p) => `${p}${crypto.randomBytes(3).toString('hex')}`

/** A cookie-keeping HTTP client. `ip` is sent as X-Forwarded-For (believed only with TRUST_PROXY=1). */
export function client(ip = `10.${rnd()}.${rnd()}.${rnd()}`) {
  const jar = new Map()
  const api = async (method, path, body, { headers = {}, raw = false, redirect = 'manual' } = {}) => {
    const h = { 'x-forwarded-for': ip, ...headers }
    if (jar.size) h.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
    let payload
    if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body) }
    const res = await fetch(BASE + path, { method, headers: h, body: payload, redirect })
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(';'); const i = pair.indexOf('=')
      const name = pair.slice(0, i), val = pair.slice(i + 1)
      if (/Max-Age=0|expires=Thu, 01 Jan 1970/i.test(c) || val === '') jar.delete(name); else jar.set(name, val)
    }
    if (raw) return res
    const text = await res.text()
    let data; try { data = JSON.parse(text) } catch { data = text }
    return { status: res.status, data, headers: res.headers }
  }
  return { api, jar }
}
const rnd = () => Math.floor(Math.random() * 250) + 1

export async function login(c, creds) {
  const r = await c.api('POST', '/api/staff/login', creds)
  assert.equal(r.status, 200, JSON.stringify(r.data))
  return r.data.staff
}

/** Signs the administrator in once per file. */
export async function adminClient() {
  const c = client()
  await login(c, ADMIN)
  return c
}

/** Creates a staff member with the given role and returns a signed-in client for them. */
export async function staffClient(admin, role, prefix = role) {
  const username = uniq(prefix)
  const r = await admin.api('POST', '/api/admin/staff', { username, name: username, role, password: PASSWORD })
  assert.equal(r.status, 201, JSON.stringify(r.data))
  const c = client()
  const me = await login(c, { username, password: PASSWORD })
  return Object.assign(c, { me, id: r.data.id, username })
}

export async function menu(c = client()) {
  const r = await c.api('GET', '/api/menu')
  assert.equal(r.status, 200)
  return r.data
}
export const itemByName = (m, name) => m.categories.flatMap((c) => c.items).find((i) => i.name.en === name)

/** Creates a table and returns it (with its QR URL) from the admin listing. */
export async function newTable(admin, extra = {}) {
  const number = uniq('T')
  const r = await admin.api('POST', '/api/admin/tables', { number, location: 'Test', ...extra })
  assert.equal(r.status, 201, JSON.stringify(r.data))
  const t = await admin.api('GET', '/api/admin/tables')
  return t.data.tables.find((x) => x.number === number)
}

/** A guest who scanned the table QR. */
export async function guestAt(table) {
  const c = client()
  const r = await c.api('GET', new URL(table.qrUrl).pathname)
  assert.equal(r.status, 307)
  return c
}
