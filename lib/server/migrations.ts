import type { DatabaseSync } from 'node:sqlite'

/**
 * Schema changes after the original (version 1) schema. Append only: never edit a migration that has
 * shipped. Each one runs once, in its own transaction, recorded in PRAGMA user_version.
 * This file has no Next.js imports so tests can run it directly against a real SQLite file.
 */

/** Version 1: the schema the ordering system shipped with. Frozen. */
export const SCHEMA = `
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE staff (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','manager','waiter','kitchen')),
  password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

CREATE TABLE staff_sessions (
  token_hash TEXT PRIMARY KEY,
  staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE categories (
  id INTEGER PRIMARY KEY,
  name_en TEXT NOT NULL,
  name_ku TEXT NOT NULL DEFAULT '',
  name_ar TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0,
  visible INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE items (
  id INTEGER PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  name_en TEXT NOT NULL,
  name_ku TEXT NOT NULL DEFAULT '',
  name_ar TEXT NOT NULL DEFAULT '',
  desc_en TEXT NOT NULL DEFAULT '',
  desc_ku TEXT NOT NULL DEFAULT '',
  desc_ar TEXT NOT NULL DEFAULT '',
  price INTEGER NOT NULL CHECK (price >= 0),
  image TEXT NOT NULL DEFAULT '',
  prep_minutes INTEGER,
  badge TEXT NOT NULL DEFAULT '',
  spicy INTEGER NOT NULL DEFAULT 0,
  featured INTEGER NOT NULL DEFAULT 0,
  popular INTEGER NOT NULL DEFAULT 0,
  offer_price INTEGER CHECK (offer_price IS NULL OR offer_price >= 0),
  offer_label TEXT NOT NULL DEFAULT '',
  ingredients TEXT NOT NULL DEFAULT '[]',
  allergens TEXT NOT NULL DEFAULT '[]',
  available INTEGER NOT NULL DEFAULT 1,
  visible INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_items_category ON items(category_id, sort);

CREATE TABLE option_groups (
  id INTEGER PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  name_en TEXT NOT NULL,
  name_ku TEXT NOT NULL DEFAULT '',
  name_ar TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL CHECK (kind IN ('single','multi')),
  required INTEGER NOT NULL DEFAULT 0,
  min_select INTEGER NOT NULL DEFAULT 0,
  max_select INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_groups_item ON option_groups(item_id, sort);

CREATE TABLE options (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES option_groups(id) ON DELETE CASCADE,
  name_en TEXT NOT NULL,
  name_ku TEXT NOT NULL DEFAULT '',
  name_ar TEXT NOT NULL DEFAULT '',
  price_delta INTEGER NOT NULL DEFAULT 0,
  is_default INTEGER NOT NULL DEFAULT 0,
  available INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_options_group ON options(group_id, sort);

CREATE TABLE tables (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  number TEXT NOT NULL UNIQUE,
  location TEXT NOT NULL DEFAULT '',
  qr_token TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1,
  occupied INTEGER NOT NULL DEFAULT 0,
  waiter_id INTEGER REFERENCES staff(id) ON DELETE SET NULL
);

CREATE TABLE table_sessions (
  id INTEGER PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  table_id INTEGER NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('qr','manual','waiter')),
  trusted INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  closed_at TEXT
);
CREATE INDEX idx_tsessions_table ON table_sessions(table_id);

CREATE TABLE waiter_links (
  token_hash TEXT PRIMARY KEY,
  table_id INTEGER NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
  created_by INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE orders (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  number INTEGER NOT NULL UNIQUE,
  table_id INTEGER NOT NULL REFERENCES tables(id) ON DELETE RESTRICT,
  table_number TEXT NOT NULL,
  session_id INTEGER NOT NULL REFERENCES table_sessions(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL,
  track_token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  verification_status TEXT NOT NULL CHECK (verification_status IN ('pending','verified','not_required','rejected')),
  verify_code TEXT,
  verify_token_hash TEXT UNIQUE,
  verify_token TEXT,
  verify_expires_at TEXT,
  verify_failures INTEGER NOT NULL DEFAULT 0,
  verified_by INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  verified_at TEXT,
  subtotal INTEGER NOT NULL,
  tax INTEGER NOT NULL,
  service_charge INTEGER NOT NULL,
  total INTEGER NOT NULL,
  customer_note TEXT NOT NULL DEFAULT '',
  internal_note TEXT NOT NULL DEFAULT '',
  cancel_reason TEXT NOT NULL DEFAULT '',
  est_ready_minutes INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  confirmed_at TEXT,
  UNIQUE (session_id, idempotency_key)
);
CREATE INDEX idx_orders_status ON orders(status, created_at);
CREATE INDEX idx_orders_table ON orders(table_id, created_at);
CREATE UNIQUE INDEX idx_orders_pending_code ON orders(verify_code) WHERE verification_status = 'pending' AND verify_code IS NOT NULL;

CREATE TABLE order_items (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  item_id INTEGER REFERENCES items(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  unit_price INTEGER NOT NULL,
  options_total INTEGER NOT NULL DEFAULT 0,
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 50),
  line_total INTEGER NOT NULL,
  instructions TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_order_items_order ON order_items(order_id);

CREATE TABLE order_item_options (
  id INTEGER PRIMARY KEY,
  order_item_id INTEGER NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  group_name TEXT NOT NULL,
  option_name TEXT NOT NULL,
  price_delta INTEGER NOT NULL
);

CREATE TABLE order_status_history (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  actor TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_history_order ON order_status_history(order_id);

CREATE TABLE service_requests (
  id INTEGER PRIMARY KEY,
  table_id INTEGER NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
  session_id INTEGER REFERENCES table_sessions(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('waiting','received','on_the_way','completed')),
  handled_by INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_requests_open ON service_requests(status, table_id);

CREATE TABLE notifications (
  id INTEGER PRIMARY KEY,
  audience TEXT NOT NULL,
  staff_id INTEGER REFERENCES staff(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_notifications_audience ON notifications(audience, read, id);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '',
  ip TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_audit_created ON audit_log(id);
`


type Migration = { version: number; rebuild?: boolean; up: (conn: DatabaseSync) => void }

const LATER_MIGRATIONS: Migration[] = [
  {
    // Stage 2. New roles; orders that are not tied to a table (walk-in, takeaway, delivery);
    // customers. `staff` and `orders` are rebuilt because SQLite cannot alter CHECK / NOT NULL.
    version: 2,
    rebuild: true,
    up: (c) => {
      c.exec(`
CREATE TABLE customers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT UNIQUE,
  email TEXT NOT NULL DEFAULT '',
  birthday TEXT,
  notes TEXT NOT NULL DEFAULT '',
  preferences TEXT NOT NULL DEFAULT '',
  marketing_consent INTEGER NOT NULL DEFAULT 0,
  consent_at TEXT,
  loyalty_points INTEGER NOT NULL DEFAULT 0 CHECK (loyalty_points >= 0),
  tier TEXT NOT NULL DEFAULT 'member',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_customers_name ON customers(name);

CREATE TABLE staff_new (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','admin','manager','cashier','waiter','kitchen','inventory','receptionist')),
  password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  hired_on TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);
INSERT INTO staff_new (id, username, name, role, password_hash, active, created_at, last_login_at)
  SELECT id, username, name, role, password_hash, active, created_at, last_login_at FROM staff;
DROP TABLE staff;
ALTER TABLE staff_new RENAME TO staff;

CREATE TABLE orders_new (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  number INTEGER NOT NULL UNIQUE,
  type TEXT NOT NULL DEFAULT 'dine_in' CHECK (type IN ('dine_in','walk_in','takeaway','delivery')),
  channel TEXT NOT NULL DEFAULT 'qr' CHECK (channel IN ('qr','pos','web')),
  table_id INTEGER REFERENCES tables(id) ON DELETE RESTRICT,
  table_number TEXT NOT NULL DEFAULT '',
  session_id INTEGER REFERENCES table_sessions(id) ON DELETE RESTRICT,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL DEFAULT '',
  customer_phone TEXT NOT NULL DEFAULT '',
  delivery_address TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  assigned_to INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  idempotency_key TEXT NOT NULL,
  track_token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  verification_status TEXT NOT NULL CHECK (verification_status IN ('pending','verified','not_required','rejected')),
  verify_code TEXT,
  verify_token_hash TEXT UNIQUE,
  verify_token TEXT,
  verify_expires_at TEXT,
  verify_failures INTEGER NOT NULL DEFAULT 0,
  verified_by INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  verified_at TEXT,
  subtotal INTEGER NOT NULL,
  discount INTEGER NOT NULL DEFAULT 0 CHECK (discount >= 0),
  discount_reason TEXT NOT NULL DEFAULT '',
  tax INTEGER NOT NULL,
  service_charge INTEGER NOT NULL,
  total INTEGER NOT NULL CHECK (total >= 0),
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','partial','paid','refunded')),
  priority INTEGER NOT NULL DEFAULT 0,
  customer_note TEXT NOT NULL DEFAULT '',
  internal_note TEXT NOT NULL DEFAULT '',
  cancel_reason TEXT NOT NULL DEFAULT '',
  est_ready_minutes INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  confirmed_at TEXT,
  CHECK (type != 'dine_in' OR table_id IS NOT NULL)
);
INSERT INTO orders_new (id, public_id, number, type, channel, table_id, table_number, session_id, idempotency_key, track_token_hash,
  status, verification_status, verify_code, verify_token_hash, verify_token, verify_expires_at, verify_failures, verified_by,
  verified_at, subtotal, tax, service_charge, total, customer_note, internal_note, cancel_reason, est_ready_minutes, created_at,
  updated_at, confirmed_at)
  SELECT id, public_id, number, 'dine_in', 'qr', table_id, table_number, session_id, idempotency_key, track_token_hash,
  status, verification_status, verify_code, verify_token_hash, verify_token, verify_expires_at, verify_failures, verified_by,
  verified_at, subtotal, tax, service_charge, total, customer_note, internal_note, cancel_reason, est_ready_minutes, created_at,
  updated_at, confirmed_at FROM orders;
DROP TABLE orders;
ALTER TABLE orders_new RENAME TO orders;
CREATE UNIQUE INDEX idx_orders_session_key ON orders(session_id, idempotency_key) WHERE session_id IS NOT NULL;
CREATE UNIQUE INDEX idx_orders_staff_key ON orders(created_by, idempotency_key) WHERE session_id IS NULL;
CREATE INDEX idx_orders_status ON orders(status, created_at);
CREATE INDEX idx_orders_table ON orders(table_id, created_at);
CREATE INDEX idx_orders_created ON orders(created_at);
CREATE INDEX idx_orders_customer ON orders(customer_id);
CREATE UNIQUE INDEX idx_orders_pending_code ON orders(verify_code) WHERE verification_status = 'pending' AND verify_code IS NOT NULL;
`)
    },
  },
  {
    // Stage 4. Payments are the only record that money changed hands. A payment is split across one or
    // more orders by allocations; a refund is its own row pointing at the payment it reverses.
    version: 3,
    up: (c) => {
      c.exec(`
CREATE TABLE payments (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('payment','refund')),
  method TEXT NOT NULL,
  currency TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  rate REAL NOT NULL DEFAULT 1 CHECK (rate > 0),
  base_amount INTEGER NOT NULL CHECK (base_amount > 0),
  tendered INTEGER,
  change_base INTEGER NOT NULL DEFAULT 0 CHECK (change_base >= 0),
  reference TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','voided')),
  void_reason TEXT NOT NULL DEFAULT '',
  voided_by INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  voided_at TEXT,
  refund_of INTEGER REFERENCES payments(id) ON DELETE RESTRICT,
  table_id INTEGER REFERENCES tables(id) ON DELETE SET NULL,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  idempotency_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (created_by, idempotency_key),
  CHECK (kind = 'payment' OR refund_of IS NOT NULL)
);
CREATE INDEX idx_payments_created ON payments(created_at);
CREATE INDEX idx_payments_refund_of ON payments(refund_of);

CREATE TABLE payment_allocations (
  payment_id INTEGER NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  amount INTEGER NOT NULL CHECK (amount > 0),
  PRIMARY KEY (payment_id, order_id)
);
CREATE INDEX idx_allocations_order ON payment_allocations(order_id);

-- Rates the order was priced with, so a later discount recomputes tax/service at the same rates.
ALTER TABLE orders ADD COLUMN tax_rate REAL NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN service_rate REAL NOT NULL DEFAULT 0;
UPDATE orders SET tax_rate = CASE WHEN subtotal > 0 THEN ROUND(tax * 100.0 / subtotal, 4) ELSE 0 END,
  service_rate = CASE WHEN subtotal > 0 THEN ROUND(service_charge * 100.0 / subtotal, 4) ELSE 0 END;

CREATE TABLE receipt_prints (
  id INTEGER PRIMARY KEY,
  order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
  payment_id INTEGER REFERENCES payments(id) ON DELETE CASCADE,
  staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  reprint INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`)
    },
  },
]

/**
 * Ordered schema migrations keyed by PRAGMA user_version. Version 1 is the original schema, so an
 * existing database upgrades in place. A migration that rebuilds a table runs with foreign keys off
 * (SQLite cannot change that inside a transaction) and must leave `foreign_key_check` clean.
 */
const MIGRATIONS: Migration[] = [
  { version: 1, up: (c) => c.exec(SCHEMA) },
  ...LATER_MIGRATIONS,
]
export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version

export function migrate(conn: DatabaseSync) {
  const current = (conn.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue
    if (m.rebuild) conn.exec('PRAGMA foreign_keys = OFF')
    conn.exec('BEGIN IMMEDIATE')
    try {
      m.up(conn)
      if (m.rebuild) {
        const bad = conn.prepare('PRAGMA foreign_key_check').all()
        if (bad.length) throw new Error(`migration ${m.version} broke ${bad.length} foreign key(s)`)
      }
      conn.exec(`PRAGMA user_version = ${m.version}`)
      conn.exec('COMMIT')
    } catch (e) {
      conn.exec('ROLLBACK')
      throw e
    } finally {
      if (m.rebuild) conn.exec('PRAGMA foreign_keys = ON')
    }
  }
}
