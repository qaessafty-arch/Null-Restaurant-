// Schema migrations run against a real SQLite file. No server needed.
//   node --test tests/migrations.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { SCHEMA, SCHEMA_VERSION, migrate } from '../lib/server/migrations.ts'

function freshFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'))
  return path.join(dir, 'db.sqlite')
}

/** A database exactly as the original system left it: version 1 with live data. */
function versionOneWithData(file) {
  const c = new DatabaseSync(file)
  c.exec('PRAGMA foreign_keys = ON')
  c.exec(SCHEMA)
  c.exec('PRAGMA user_version = 1')
  c.exec(`
    INSERT INTO staff (id, username, name, role, password_hash) VALUES (1, 'boss', 'Boss', 'admin', 'x'), (2, 'wa', 'Wa', 'waiter', 'y');
    INSERT INTO staff_sessions (token_hash, staff_id, expires_at) VALUES ('h1', 2, datetime('now', '+1 hour'));
    INSERT INTO categories (id, name_en) VALUES (1, 'Burgers');
    INSERT INTO items (id, category_id, name_en, price) VALUES (1, 1, 'OG', 8500);
    INSERT INTO tables (id, public_id, number, qr_token, waiter_id) VALUES (1, 'p1', '7', 'q1', 2);
    INSERT INTO table_sessions (id, token_hash, table_id, source, trusted, expires_at) VALUES (1, 'ts', 1, 'qr', 1, datetime('now', '+1 hour'));
    INSERT INTO orders (id, public_id, number, table_id, table_number, session_id, idempotency_key, track_token_hash, status,
      verification_status, verified_by, subtotal, tax, service_charge, total, customer_note)
      VALUES (1, 'o1', 1001, 1, '7', 1, 'key-12345', 'tt', 'served', 'verified', 2, 17000, 0, 0, 17000, 'no onions');
    INSERT INTO order_items (id, order_id, item_id, name, unit_price, quantity, line_total) VALUES (1, 1, 1, 'OG', 8500, 2, 17000);
    INSERT INTO order_item_options (order_item_id, group_name, option_name, price_delta) VALUES (1, 'Size', 'Large', 0);
    INSERT INTO order_status_history (order_id, to_status, staff_id, actor) VALUES (1, 'served', 2, 'Wa');
    INSERT INTO notifications (audience, kind, title, order_id) VALUES ('waiter', 'ready', 't', 1);
  `)
  return c
}

test('fresh database migrates to the latest version', () => {
  const c = new DatabaseSync(freshFile())
  c.exec('PRAGMA foreign_keys = ON')
  migrate(c)
  assert.equal(c.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION)
  assert.deepEqual(c.prepare('PRAGMA foreign_key_check').all(), [])
})

test('existing version 1 data survives the upgrade untouched', () => {
  const file = freshFile()
  versionOneWithData(file).close()
  const c = new DatabaseSync(file)
  c.exec('PRAGMA foreign_keys = ON')
  migrate(c)
  assert.equal(c.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION)
  assert.equal(c.prepare('PRAGMA foreign_keys').get().foreign_keys, 1, 'foreign keys back on')
  assert.deepEqual(c.prepare('PRAGMA foreign_key_check').all(), [])

  const o = c.prepare('SELECT * FROM orders WHERE id = 1').get()
  assert.equal(o.public_id, 'o1')
  assert.equal(o.number, 1001)
  assert.equal(o.total, 17000)
  assert.equal(o.customer_note, 'no onions')
  assert.equal(o.verified_by, 2)
  assert.equal(o.type, 'dine_in')
  assert.equal(o.payment_status, 'unpaid')
  assert.equal(c.prepare('SELECT COUNT(*) n FROM order_items WHERE order_id = 1').get().n, 1)
  assert.equal(c.prepare('SELECT COUNT(*) n FROM order_item_options').get().n, 1)
  assert.equal(c.prepare('SELECT COUNT(*) n FROM order_status_history WHERE order_id = 1').get().n, 1)
  assert.equal(c.prepare('SELECT COUNT(*) n FROM notifications WHERE order_id = 1').get().n, 1)
  assert.equal(c.prepare('SELECT COUNT(*) n FROM staff').get().n, 2)
  assert.equal(c.prepare('SELECT COUNT(*) n FROM staff_sessions WHERE staff_id = 2').get().n, 1, 'sessions kept')
  assert.equal(c.prepare('SELECT waiter_id FROM tables WHERE id = 1').get().waiter_id, 2)

  // Cascades still point at the rebuilt tables.
  c.exec('DELETE FROM orders WHERE id = 1')
  assert.equal(c.prepare('SELECT COUNT(*) n FROM order_items').get().n, 0)
  c.exec('DELETE FROM staff WHERE id = 2')
  assert.equal(c.prepare('SELECT COUNT(*) n FROM staff_sessions').get().n, 0)
})

test('rebuilt schema enforces the new rules', () => {
  const c = new DatabaseSync(freshFile())
  c.exec('PRAGMA foreign_keys = ON')
  migrate(c)
  c.exec(`INSERT INTO staff (id, username, name, role, password_hash) VALUES (1, 'c', 'Cash', 'cashier', 'x')`)
  assert.throws(() => c.exec(`INSERT INTO staff (username, name, role, password_hash) VALUES ('z', 'z', 'pirate', 'x')`))
  const ins = (type, tableId, key) => c.prepare(`INSERT INTO orders (public_id, number, type, table_id, created_by, idempotency_key,
    track_token_hash, status, verification_status, subtotal, tax, service_charge, total) VALUES (?, ?, ?, ?, 1, ?, ?, 'confirmed', 'not_required', 1, 0, 0, 1)`)
    .run(`p${key}`, Math.floor(Math.random() * 1e9), type, tableId, key, `t${key}`)
  ins('takeaway', null, 'k1') // no table needed
  assert.throws(() => ins('dine_in', null, 'k2'), /CHECK/) // dine-in must have a table
  assert.throws(() => ins('takeaway', null, 'k1'), /UNIQUE/) // same cashier, same key = duplicate
})

test('migrating twice is a no-op', () => {
  const c = new DatabaseSync(freshFile())
  c.exec('PRAGMA foreign_keys = ON')
  migrate(c)
  migrate(c)
  assert.equal(c.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION)
})

test('customers with the same phone written differently are merged, keeping their history', () => {
  const c = new DatabaseSync(freshFile())
  c.exec('PRAGMA foreign_keys = ON')
  migrate(c, 7)
  c.exec(`
    INSERT INTO customers (id, name, phone, email, marketing_consent) VALUES (1, 'Shilan', '0750 123 4567', '', 0), (2, 'Shilan A.', '+964 750 123 4567', 's@example.com', 1), (3, 'Dara', '07709998877', '', 0);
    INSERT INTO reservations (public_id, code, manage_token_hash, customer_id, name, phone, party_size, starts_at, ends_at, status, idempotency_key)
      VALUES ('r1', 'AAAAAA', 'h1', 1, 'Shilan', '0750 123 4567', 2, '2030-01-01 18:00:00', '2030-01-01 19:30:00', 'confirmed', 'k1'),
             ('r2', 'BBBBBB', 'h2', 2, 'Shilan A.', '+964 750 123 4567', 4, '2030-02-01 18:00:00', '2030-02-01 19:30:00', 'confirmed', 'k2');
  `)
  migrate(c)
  const rows = c.prepare('SELECT id, name, phone, email, marketing_consent FROM customers ORDER BY id').all()
  assert.equal(rows.length, 2, 'the two spellings became one customer')
  assert.equal(rows[0].id, 1, 'the oldest record is kept')
  assert.equal(rows[0].phone, '07501234567')
  assert.equal(rows[0].email, 's@example.com', 'details from the duplicate are kept')
  assert.equal(rows[0].marketing_consent, 1)
  assert.equal(rows[1].phone, '07709998877')
  assert.deepEqual(c.prepare('SELECT customer_id FROM reservations ORDER BY id').all().map((r) => r.customer_id), [1, 1], 'both bookings point at the kept record')
  assert.deepEqual(c.prepare('PRAGMA foreign_key_check').all(), [])
})
