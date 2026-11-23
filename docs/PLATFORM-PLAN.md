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
| 2 | Migration runner, orders rebuild, permissions and new roles | |
| 3 | Design system tokens, light/dark, staff/admin shell refresh | |
| 4 | Payments, bills, POS (walk-in/takeaway/delivery), receipts, IQD/USD | |
| 5 | Kitchen stations, item routing, timers, delay warnings | |
| 6 | Tables: sections, capacity, floor plan, statuses; reservations with double-booking guard | |
| 7 | Inventory: ingredients, recipes, stock movements, suppliers, purchase orders, alerts | |
| 8 | Finance: expenses, revenue vs profit, reports, CSV/Excel/PDF export | |
| 9 | CRM: customers, history, loyalty, consent | |
| 10 | Customer site: reservations page, offers, gallery, order history; staff/admin RTL | |
| 11 | Security and performance pass | |
| 12 | End-to-end workflow tests (the ten critical flows in the brief) | |

Every stage ends with typecheck, build, the full API suite, and a docs update.
