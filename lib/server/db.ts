import 'server-only'
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { bootstrap } from './bootstrap'
import { migrate } from './migrations'

export { SCHEMA_VERSION } from './migrations'

/**
 * SQLite via Node's built-in `node:sqlite` (Node >= 22.13). No native build step,
 * no external service. One process owns the file; WAL keeps readers fast.
 */

export function dbPath() {
  return process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'restaurant.db')
}

type G = typeof globalThis & { __sbDb?: DatabaseSync }

export function db(): DatabaseSync {
  const g = globalThis as G
  if (g.__sbDb) return g.__sbDb
  const file = dbPath()
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true })
  const conn = new DatabaseSync(file)
  conn.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
  migrate(conn)
  g.__sbDb = conn
  bootstrap(conn) // first boot only: seed menu, settings, admin account
  return conn
}

/** Run fn inside an immediate transaction (serialises writers, rolls back on throw). */
export function tx<T>(fn: () => T): T {
  const conn = db()
  conn.exec('BEGIN IMMEDIATE')
  try {
    const out = fn()
    conn.exec('COMMIT')
    return out
  } catch (e) {
    conn.exec('ROLLBACK')
    throw e
  }
}

export function all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T[] {
  return db().prepare(sql).all(...(params as never[])) as T[]
}
export function get<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T | undefined {
  return db().prepare(sql).get(...(params as never[])) as T | undefined
}
export function run(sql: string, ...params: unknown[]) {
  return db().prepare(sql).run(...(params as never[]))
}
