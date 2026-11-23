import 'server-only'
import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { rateLimit } from './security'

export class ApiError extends Error {
  constructor(public status: number, message: string, public code = 'error') {
    super(message)
  }
}

export const json = <T,>(data: T, init?: ResponseInit) => NextResponse.json(data, init)

/**
 * The caller's IP, or null when it cannot be known. Forwarding headers are set by whoever sends the
 * request, so they are only believed when TRUST_PROXY=1 says a reverse proxy overwrites them.
 */
export function ipFrom(h: Headers): string | null {
  if (process.env.TRUST_PROXY !== '1') return null
  const ip = (h.get('x-forwarded-for')?.split(',')[0] ?? h.get('x-real-ip') ?? '').trim()
  return ip || null
}
export async function clientIp() {
  return ipFrom(await headers())
}

/** Throttle by key; throws 429 when exceeded. */
export function limit(key: string, max: number, windowMs: number) {
  if (!rateLimit(key, max, windowMs)) throw new ApiError(429, 'Too many requests. Please slow down.', 'rate_limited')
}

/** Per-IP throttle. Skipped when the IP is unknown: one shared bucket would let a busy room lock itself out. */
export async function limitIp(name: string, max: number, windowMs: number) {
  const ip = await clientIp()
  if (ip) limit(`${name}:${ip}`, max, windowMs)
}

/**
 * Wraps a route handler: CSRF origin check for mutating requests, JSON error mapping,
 * and no stack/SQL leakage to clients.
 */
export function route<A extends unknown[]>(
  fn: (req: Request, ...args: A) => Promise<Response> | Response,
) {
  return async (req: Request, ...args: A) => {
    try {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        const origin = req.headers.get('origin')
        const host = req.headers.get('host')
        if (origin && host) {
          let ok = false
          try { ok = new URL(origin).host === host } catch {}
          if (!ok) throw new ApiError(403, 'Cross-origin request blocked', 'csrf')
        }
      }
      return await fn(req, ...args)
    } catch (e) {
      if (e instanceof ApiError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status })
      console.error('[api]', req.method, new URL(req.url).pathname, e)
      return NextResponse.json({ error: 'Something went wrong', code: 'internal' }, { status: 500 })
    }
  }
}

export async function body<T = Record<string, unknown>>(req: Request): Promise<T> {
  const ct = req.headers.get('content-type') ?? ''
  if (!ct.includes('application/json')) throw new ApiError(415, 'Expected JSON', 'bad_content_type')
  try {
    const parsed = await req.json()
    if (parsed === null || typeof parsed !== 'object') throw new Error()
    return parsed as T
  } catch {
    throw new ApiError(400, 'Invalid JSON body', 'bad_json')
  }
}

// ---- validation helpers ----
export function str(v: unknown, field: string, { min = 0, max = 500, required = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw new ApiError(400, `${field} is required`, 'invalid')
    return ''
  }
  if (typeof v !== 'string') throw new ApiError(400, `${field} must be text`, 'invalid')
  const s = v.trim()
  if (s.length < min || s.length > max) throw new ApiError(400, `${field} must be ${min}-${max} characters`, 'invalid')
  return s
}
export function int(v: unknown, field: string, { min = 0, max = 100_000_000, required = true } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw new ApiError(400, `${field} is required`, 'invalid')
    return null
  }
  const n = typeof v === 'string' ? Number(v) : v
  if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max)
    throw new ApiError(400, `${field} must be a whole number between ${min} and ${max}`, 'invalid')
  return n
}
export const bool = (v: unknown) => (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0)
