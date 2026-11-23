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
| 3 | Design system tokens, light/dark, staff/admin shell refresh | Done (Apple-inspired design pass, see notes) |
| 4 | Payments, bills, POS (walk-in/takeaway/delivery), receipts, IQD/USD | Done |
| 5 | Kitchen stations, item routing, timers, delay warnings | Done |
| 6 | Tables: sections, capacity, floor plan, statuses; reservations with double-booking guard | Done |
| 7 | Inventory: ingredients, recipes, stock movements, suppliers, purchase orders, alerts | Done (transfers deferred, see notes) |
| 8 | Finance: expenses, revenue vs profit, reports, CSV/Excel/PDF export | Done |
| 9 | CRM: customers, history, loyalty, consent | Done |
| 10 | Customer site: reservations page, offers, gallery, order history; staff/admin RTL | Site, table menu app and booking redesigned; staff/admin RTL still open |
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

### Stage 6 (done)

- **Tables** (migration 5): sections (Indoor/Outdoor/VIP seeded, editable), capacity, shape, floor
  position (percent of the room), and a manual state for what only staff know: seated, cleaning, out
  of service.
- **Live status is derived** (`lib/server/floor.ts`) from orders, payments, bill requests, QR sessions
  and bookings: available, occupied, reserved (booking within 60 min), ordering, waiting for food,
  waiting for payment, cleaning, out of service. Orders outrank a stale "cleaning" flag. Clearing a
  table is refused while money is owed; it ends the table's QR sessions so departed guests cannot keep
  ordering to it.
- **Reservations** (`lib/server/reservations.ts`): slots from opening hours in the restaurant's
  timezone (after-midnight closing handled, `lib/time.ts`), configurable duration, buffer, slot interval,
  notice, horizon, party limit and auto-confirm. Best table = preferred section, smallest that fits; a
  table with guests at it is not offered for a booking that starts soon. Overlap check + write in one
  immediate transaction (tested with two concurrent guests). Guests get a code and a private link to
  view or cancel; staff see full contact details, guests see a masked phone. Lifecycle:
  pending -> confirmed -> seated -> completed, plus cancelled (reason required) and no-show (only after
  the start time); every change is in `reservation_history`. Each booking links to a customer record by phone.
- **Screens**: Admin > Floor (drag to arrange, live colours, table drawer with the actions that fit
  the state), Admin > Reservations (day timeline by table, list, create/edit, lifecycle), public
  `/reserve` and `/reserve/<token>` in EN / Kurdish / Arabic with RTL, linked from the site navigation.
- Bugs found in browser testing and fixed: booking times on the floor were shown in the browser's
  timezone (now formatted on the server in the restaurant's); "now ago" in several staff screens.
- Tests: 66/66 (adds `tests/time.test.mjs`, `tests/reservations.test.mjs`).

### Stage 7 (done)

- **Model** (migration 6): suppliers, ingredients, recipe lines (per dish, and per option: an option
  can add or remove an ingredient), purchase orders with lines, expiry batches, stock movements.
  Quantities are integer thousandths of the ingredient's unit (no float drift); unit cost is a decimal
  (IQD per gram is often fractional) and is a weighted average updated on every receipt.
- **One way to change stock** (`move()` in `lib/server/inventory.ts`): writes a movement row (kind,
  reason, person, order or PO, unit cost at the time, balance after), draws expiry batches earliest
  first, raises a low-stock alert once per crossing of the minimum, refuses to go below zero unless
  `allowNegativeStock` is on.
- **Deduction policy**: stock is taken when an order reaches the kitchen (POS orders at once; QR orders
  when confirmed, or at creation when verification is off), exactly once per order. Cancelling while
  "sent to kitchen" returns it; once cooking has started it stays used. Guests and the POS are warned
  at the quote if the kitchen cannot make the cart. Dishes without a recipe are not tracked.
- **Automatic sold out** (`autoSoldOut`): a dish whose recipe cannot be made is marked sold out and
  returns when restocked. A dish someone marked sold out by hand is never switched back on.
- **Purchase orders**: draft -> ordered -> partial / received, or cancelled. Receiving books what
  actually arrived at the invoiced cost, with a use-by date for tracked items. Creating one for a
  supplier pre-fills their low items.
- **Screens**: Admin > Inventory with Stock (filters, value, receive / waste / count / adjust),
  Recipes (food cost % against the menu price), Purchases, Suppliers, History; low-stock and
  use-soon banners. The inventory role lands here.
- **Not built**: stock transfers between locations. They need storage locations or branches, which the
  platform does not model yet; adding them means stock per location on every movement. Recorded here
  rather than faked.
- No ingredients or stock are seeded: inventing stock levels would be fake data. The restaurant enters
  its own.
- Bugs found in browser testing and fixed: table action cells broke the row layout (POS transactions
  too); the admin input style hid the search icon; duplicated PO labels in the history.
- Tests: 77/77 (adds `tests/inventory.test.mjs`, TEST 8).

### Stage 8 (done)

- **Definitions** (`lib/server/finance.ts`, stated on screen too): a sale is an order that reached the
  kitchen and was not cancelled; net sales = subtotal - discounts; tax and service charge are reported,
  not counted as income; collected = payments - refunds by when the money moved; cost of goods = value
  of stock that orders used (stock movements, cost at the time); stock bought is cash out, not an
  expense (it becomes cost of goods when used, so counting both would double the cost); estimated profit
  = net sales - cost of goods - waste - expenses, with the share of sold items that have a recipe shown
  next to it.
- **Expenses** (migration 7): rent, salaries, utilities, etc.; recorded by people with `finance.manage`,
  voided with a reason, never deleted.
- **Reports**: any local-date range up to about a year, compared with the previous period of the same
  length; by day (or by hour for one day), busiest hours, weekday, category, product with margin from
  recipe cost, slowest and unsold dishes, payment method and currency, order type, table, discounts,
  refunds, waste.
- **Exports**: CSV per report (UTF-8 with BOM for Excel; numbers stay numbers; text starting with
  = + - @ tab or CR is neutralised); Excel `.xlsx` with every report as a sheet, written by a small
  dependency-free generator (`lib/server/sheets.ts`; checked with a zip/XML parser: valid CRCs,
  well-formed XML, typed cells, Arabic text intact); PDF via the print stylesheet (browser "Save as PDF",
  which renders Kurdish and Arabic correctly where server PDF fonts would not).
- **Dashboard** rebuilt on the same engine: today / yesterday / 7 / 30 days vs the previous period; right
  now (to verify, in kitchen with late count, ready, guest requests and bill requests, unpaid orders and
  amount, tables in use, bookings today); sales chart; needs attention (low stock, next bookings); best
  sellers; recent payments; activity feed. Quick switches kept.
- Charts: single-series SVG columns and labelled share bars, no chart library; accent colour validated
  against light and dark surfaces; hover tooltip with the full date; every chart has a table view.
- Bugs found and fixed: the receipt print rules applied to every page, so printing anything else
  produced a blank page; `useLive` refetched only on its timer, so changing a period, date or filter took
  up to 15 s to show (this also affected the original Orders page filters); new token pages sat as a dark
  island inside a light admin frame in dark mode, and the admin shell forced white inputs on them.
- Tests: 83/83 (adds `tests/finance.test.mjs`: exact deltas for sales, discounts, collections, refunds,
  outstanding, cost of goods, waste, expenses and profit; permissions; exports; dashboard).

### Stage 9 (done)

- **Customers** (migration 8): one record per phone number (`lib/phone.ts`; existing duplicates merged);
  created by bookings, POS orders with a phone, attaching a customer to a bill, or staff.
- **Loyalty** (`lib/server/customers.ts`): points earned once when an order is fully paid (tier
  multiplier by lifetime spend), taken back if it stops being fully paid; redeeming is a discount
  (minimum, share-of-bill cap, balance, never below what was paid), returned if the order is cancelled;
  manual adjustments by managers with a reason; every change in `loyalty_transactions`. Finance reports
  points redeemed separately and they reduce net sales, not cash collected.
- **Privacy**: roles that only look customers up see a masked phone and no spend; marketing consent
  is stored with its time and only opted-in customers are exported; "forget" anonymises the customer
  everywhere and keeps the sales.
- **Feedback** (`lib/server/feedback.ts`): one rating per served order from its tracking page, website
  reviews pending until a manager publishes them, public replies; the public average counts every
  rating, so hiding comments cannot raise it.
- **Screens**: Admin > Customers (list, birthdays this week, profile with history, points, edit,
  consent, forget; feedback moderation; loyalty programme settings), POS recognises returning guests
  by phone and shows allergies, bills attach customers and use points, receipts show points.
- Not done here: the homepage's hard-coded reviews ("500+ reviews", "Google rating") and its "Write a
  review" button, which only keeps the review in that browser. Left for the website redesign; the
  owner should confirm whether the hard-coded figures are real.
- Tests: 96/96 (adds `tests/customers.test.mjs`, a v7 -> v8 merge test).

### Design pass: Apple-inspired system (done)

One visual language across the website, the table menu, staff tools and admin. Visual and UX change
only: no API, schema, auth, payment or business-rule changes; all 96 API tests pass after each step.

- **Tokens** (`app/tokens.css`): neutral surfaces (#F5F5F7 / #FFFFFF, dark #161617 / #1D1D1F / #2C2C2E),
  text #1D1D1F / #6E6E73, one accent (#0071E3, dark #2997FF) for the action that matters, status colours
  only for status, `--brand` (#D95B32) only for the restaurant's own mark. Type: the system SF Pro stack
  with self-hosted Inter and Noto Sans Arabic (SIL OFL, `public/fonts`) as fallbacks; Google Fonts removed.
  Scale, radii, spacing (4/8/12/16/24/32/48/64/80) and motion durations (150/190/260/320 ms) are tokens;
  `prefers-reduced-motion` turns motion off globally. Dialogs become bottom sheets on phones.
- **Theme**: device / light / dark, chosen in the top bar, saved per device, applied before first paint
  (`lib/theme.ts`). The kitchen display is always dark, including its top bar.
- **Admin frame**: grouped sidebar (Overview, Operations, Management, Business, System) that collapses
  to an icon rail with tooltips and becomes an off-canvas drawer on phones; top bar with breadcrumbs,
  quick screen search (Cmd/Ctrl+K, only screens the role can open), a notification centre over the real
  staff feed with per-device unread state and a sound toggle, appearance and profile menus.
  Not added: a staff language switch (staff screens are English only; a switch would do nothing yet),
  a branch selector (single-branch data model).
- **Kitchen display**: tickets grouped into New, Preparing, Delayed and Ready lanes. Same tickets,
  same tap actions; a ticket's lane comes from its real state (late first, then whether any line started).
- **Table ordering app** (`/menu`): table QR codes and waiter links now land here instead of the homepage
  anchor. Welcome with the table, language switch, search, category chips, featured rail, product tiles,
  item and cart sheets, cart bar, table services. It reuses the website's ordering components and APIs.
- **Order tracking**: a pass-style card; timeline Submitted, Confirmed, Preparing, Ready, Served from the
  real status history; the empty "Table" label for counter orders is gone.
- **Website**: editorial homepage (dark hero, how-it's-made, featured, statement, menu, story, reviews,
  visit, footer). Reviews show only published reviews from the review system and the real average of all
  ratings; the template's hard-coded sample reviews and the "500+ reviews" / "Google rating" claims are no
  longer displayed because nothing backed them (owner: publish real reviews from Customers → Feedback).
  "Write a review" now posts to `/api/feedback` (held for moderation). Opening hours, open/closed and the
  WhatsApp number come from settings; the fake "GRILL ONLINE" status is replaced by the real state.
- **Fixes found on the way**: the menu chips scrolled the whole page to the menu on load; waiter cards
  showed an empty table badge for counter orders; legacy admin field rules overrode the shared inputs.
- **Owner to confirm**: marketing copy kept as written by the owner ("30 min delivery", "100% fresh beef",
  "in your hands in 5 minutes", the street address). Kurdish and Arabic strings added in this pass were
  written without a native review.
