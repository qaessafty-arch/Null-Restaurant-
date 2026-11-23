# Restaurant platform: audit and implementation plan

This document is the Stage 1 output for turning the Smashed Burger ordering system into a complete
restaurant platform (website, QR ordering, POS, KDS, tables, reservations, inventory, staff, CRM,
finance). It records what exists, the architecture decisions, and the order of work. Each stage
updates the "Status" column when it lands.

## 1. Audit of the imported project (smash-d-burger @ 03ca6a4)

Verified by running it: `tsc --noEmit` clean, `next build` clean, **25/25 API tests pass** against a
production build on a fresh database (`scripts/test-local.sh`).

### Stack (kept)

Next.js 16 App Router, React 19, TypeScript, Tailwind 4 (plus hand-written CSS), SQLite through Node's
built-in `node:sqlite`, Server-Sent Events for live updates. Single Node process, persistent disk.

**Decision: keep SQLite.** The existing backend is real and well tested; the brief says not to change
the stack because another is available. One restaurant fits SQLite comfortably (WAL, `BEGIN IMMEDIATE`
transactions). All SQL goes through `lib/server/db.ts`, so a later move to Postgres stays a contained
change. Multi-branch is modelled in data (`branch` setting) but not as separate tenants.

### What works (keep, extend)

| Area | Notes |
|---|---|
| Server-side pricing | `priceCart` recomputes every price, option rule and availability; client numbers ignored |
| Order creation | Idempotency key per session, open-order cap, order number allocated in a write transaction |
| Order workflow | Role-checked transition map, full status history with actor, reasons required for cancel/reject |
| Table QR identity | Random secret per table (`/t/<secret>`), rotatable; hashed session cookie; waiter-started one-time links |
| Waiter verification | 6-digit code or QR token, single use, expiring, brute-force lockout |
| Service requests | Call waiter / water / utensils / napkins / bill; de-duplicated per table and type |
| Live updates | SSE bus for staff, kitchen and per-order topics, polling fallback |
| Menu | Categories, items, option groups (single/multi, min/max, defaults, price deltas), EN/KU/AR names, allergens, ingredients, offers, sold-out |
| Security | scrypt passwords, hashed bearer tokens, origin (CSRF) check, rate limits, upload sniffing, CSV injection guard, audit log |
| Customer site | Branded landing page, menu, item sheet, tray, tracking page, EN/KU/AR with RTL on the customer side |

### Partially working

| Area | Gap |
|---|---|
| Tables | No sections, capacity, floor position or rich status; `occupied` is a single flag |
| Kitchen display | Three status columns; no stations, item routing, timers, delay warnings or priorities |
| Dashboard | Real numbers, but sales = served/completed totals (no payments exist), no comparisons or date ranges |
| Roles | Only admin / manager / waiter / kitchen; checks are role lists per handler, no permission map |
| Waiter assignment | Stored, not used for routing |
| i18n | Customer side only; staff and admin are English, LTR |
| Schema migrations | Runner only knows "create version 1"; nothing can evolve the schema yet |

### Missing

Payments and POS (no way to record that an order was paid), walk-in / takeaway / delivery orders
(orders require a table session), cashier role, IQD/USD with exchange rate, receipts, split and
partial payments, reservations, inventory (ingredients, recipes, stock movements, suppliers,
purchase orders), expenses and profit, CRM and loyalty, report exports beyond CSV, dark theme.

### Should be redesigned

- `app/globals.css`: dense one-line rules, an appended "restored colors" block full of `!important`.
  Replace with a token-based design system (light + dark) while keeping the brand.
- Admin dashboard cards are oversized for the information they hold.

### Leave alone

The order engine, verification flow, table-session security, menu pricing and the test suite. New
features extend them; nothing working is replaced.

## 2. Architecture decisions

1. **Migrations.** `db.ts` gets an ordered list of migrations keyed by `PRAGMA user_version`. Version 1
   is the existing schema, so existing databases upgrade in place and no record is touched.
2. **Orders without a table.** POS orders (walk-in, takeaway, delivery) need `table_id` and
   `session_id` to be optional. SQLite cannot drop `NOT NULL`, so migration 2 rebuilds `orders` with
   foreign keys off, copies every row, and runs `foreign_key_check` before committing.
3. **Payments are the only source of "paid".** A `payments` table records each transaction (method,
   currency, amount, rate used, amount in base currency, cashier, status). An order's payment state is
   derived from completed payments. Requesting the bill never marks anything paid. Each payment
   carries an idempotency key, so a double tap cannot charge twice.
4. **Money.** Integers in the restaurant's base currency (IQD by default). USD payments store the
   amount in USD cents and the exchange rate in force; the rate is a setting, never hard-coded.
5. **Permissions.** A permission map (`lib/server/permissions.ts`) replaces scattered role lists. New
   roles: owner, cashier, inventory manager, receptionist. Server checks use permissions; the UI only
   hides what the server already denies.
6. **Kitchen stations.** Each category has a default station, and an item can override it. Order lines
   copy their station at order time; the KDS shows per-station tickets and the order becomes ready
   when all of its lines are ready.
7. **Inventory deduction.** Recipes link items (and options) to ingredients. Stock is deducted once,
   when an order is sent to the kitchen, inside the same transaction, as `stock_movements` rows.
   Cancelling before preparation reverses it. Negative stock is blocked unless the setting allows it;
   an ingredient at zero can mark dependent items sold out automatically.
8. **Reservations.** Availability is computed from table capacity, configured duration and buffer.
   The overlap check and insert run in one write transaction, so two bookings cannot take the same table.

## 3. Stages

| # | Stage | Status |
|---|---|---|
| 1 | Audit, plan, reproducible test harness | Done |
| 2 | Migration runner, orders rebuild, permissions and new roles | Done |
| 3 | Design system tokens, light/dark, staff/admin shell refresh | Tokens done; older screens move over in the design pass |
| 4 | Payments, bills, POS (walk-in/takeaway/delivery), receipts, IQD/USD | Done |
| 5 | Kitchen stations, item routing, timers, delay warnings | Done |
| 6 | Tables: sections, capacity, floor plan, statuses; reservations with double-booking guard | |
| 7 | Inventory: ingredients, recipes, stock movements, suppliers, purchase orders, alerts | |
| 8 | Finance: expenses, revenue vs profit, reports, CSV/Excel/PDF export | |
| 9 | CRM: customers, history, loyalty, consent | |
| 10 | Customer site: reservations page, offers, gallery, order history; staff/admin RTL | |
| 11 | Security and performance pass | |
| 12 | End-to-end workflow tests (the ten critical flows in the brief) | |

Every stage ends with typecheck, build, the full API suite, and a docs update.

## 4. Stage notes

### Stage 2 (done)

- `lib/server/migrations.ts` holds the frozen v1 schema and every later migration; `db.ts` just runs them.
  `tests/migrations.test.mjs` builds a real v1 database with orders, history and sessions, upgrades it,
  and checks every row, foreign key and cascade.
- Migration 2 rebuilds `staff` (8 roles, phone/email/notes) and `orders` (type, channel, optional table
  and session, customer, discount, payment status, priority, assignee) and adds `customers`.
- `lib/permissions.ts` is the single permission map. Handlers call `requirePerm(...)`; the client uses
  `can()` only to hide controls. Only an owner can create an owner; the last owner/admin is protected.
- Security fix found in the audit: rate limits keyed on `X-Forwarded-For`, which any client can forge
  (unlimited password guesses by rotating fake IPs). That header is now believed only with
  `TRUST_PROXY=1`; without it, per-IP limits are skipped and per-user / per-session limits remain.
- Tests: 34/34 (25 original + 4 migration + 5 role matrix).

### Stage 4 (done)

- **Ledger.** `payments` + `payment_allocations` (migration 3). A payment settles one or more orders,
  oldest first; a refund is a separate row pointing at the payment it reverses; a void marks a mistaken
  payment and keeps it. `orders.payment_status` is a cache recomputed from the ledger in the same
  transaction. Requesting the bill changes nothing financially.
- **Rules enforced on the server** (`lib/server/payments.ts`): enabled methods only; USD refused until a
  rate is set (the rate is stored on each payment, and its update time is stamped by the server);
  transfer/online payments need a reference; cash received must cover the amount; no overpayment;
  change = cash received - amount applied; idempotency key per cashier; an order with money on it cannot
  be cancelled until refunded; refunds need `payments.refund` and a reason; cashier discounts capped by
  `maxCashierDiscountPercent`; a discount can never push the total below what was paid. Tax and service
  are recomputed at the rates stored on the order.
- **Online payment** is recorded with its reference after the restaurant confirms it. There is no card
  gateway integration: that needs a payment provider account and is out of scope until one is chosen.
- **POS** (`/staff/pos`): menu grid with options dialog, ticket priced by the server quote, order types
  (table / walk-in / takeaway / delivery), Bills tab (tables asking for the bill first, discounts, split
  evenly, IQD/USD with change), Transactions tab (today's takings by method, reprint, refund, void),
  80mm receipt printing with reprints logged.
- Bug found in browser testing and fixed: change was computed from the USD amount rounded up to the cent
  instead of the amount applied, short-changing the guest by a few dinars. Regression test added.
- Tests: 45/45 (adds `tests/payments.test.mjs`: TEST 4, TEST 6, concurrency, currency, refunds, voids, discounts).

### Stage 5 (done)

- **Stations** (migration 4): `kitchen_stations`; categories route to a station, an item can override it.
  Seeded for this menu: Grill (burgers), Fryer (sides, fries), Drinks. Managed in Admin > Menu.
- **Routing.** Each order line stores its station at order time (later re-routing does not move tickets
  already in the kitchen) and its own `kitchen_status` (new / preparing / ready).
- **Order follows lines** (`lib/server/kitchen.ts`): first line started -> order preparing; every line
  ready -> order ready and the waiter is notified. Whole-order buttons still work and cascade to lines.
  The order transition still goes through the role-checked workflow.
- **Late orders**: flagged when cooking longer than max(prep estimate, `kitchenDelayMinutes`, default 15).
  The waiter and managers are notified once per order (a conditional update makes it once across screens).
- **Rush**: waiters and managers can push an order to the front; the kitchen cannot reprioritise.
- **KDS** (`/staff/kitchen`): always dark, large type; station picker remembered per screen; live
  timers (amber at 75% of target, red and pulsing when late); tap a line to advance it, one button for
  the station's whole ticket; only options that differ from the standard dish are shown (defaults are
  snapshotted per order line); instructions, allergens and order notes highlighted; "also waiting on"
  other stations; ready-for-pickup strip; full-screen button.
- Bug found in testing and fixed: on a fresh install the migration ran before the menu was seeded, so
  categories had no station. The seed now applies the same routing.
- Tests: 54/54 (adds `tests/kitchen.test.mjs`).
