'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, FileSpreadsheet, Info, Plus, Printer, TrendingDown, TrendingUp } from 'lucide-react'
import { api, ApiErr } from '@/components/staff/api'
import { useMe } from '@/components/staff/shell'
import { can } from '@/lib/permissions'
import { formatMoney } from '@/lib/money'
import { Columns, ShareBars } from '@/components/charts/columns'

type K = {
  orders: number; cancelledOrders: number; cancelledValue: number; grossSales: number; subtotal: number; discounts: number; netSales: number; tax: number; service: number
  averageOrder: number; collected: number; refunds: number; cashTaken: number; outstanding: number; cogs: number; waste: number; expenses: number; inventoryPurchases: number
  grossProfit: number; netProfit: number; foodCostPercent: number | null; recipeCoverage: number | null
}
type Report = {
  range: { from: string; to: string; days: number; timezone: string }; previous: { from: string; to: string; kpis: K }; currency: string; kpis: K
  daily: Array<{ date: string; orders: number; netSales: number; collected: number; cogs: number; expenses: number }>
  hourly: Array<{ hour: number; orders: number; netSales: number }>; weekdays: Array<{ day: string; orders: number; netSales: number }>
  types: Array<{ type: string; orders: number; netSales: number }>; tables: Array<{ table: string; orders: number; netSales: number; average: number }>
  products: Array<{ itemId: number | null; name: string; category: string; quantity: number; revenue: number; estimatedCost: number | null; margin: number | null; marginPercent: number | null }>
  categories: Array<{ category: string; quantity: number; revenue: number }>; unsold: string[]
  methods: Array<{ method: string; label: string; currency: string; payments: number; amount: number; inflow: number; refunds: number; net: number }>
  expenses: Array<{ category: string; amount: number; count: number }>
  waste: Array<{ ingredient: string; unit: string; quantity: number; value: number }>
  discounts: Array<{ order: string; amount: number; reason: string; at: string }>
  refunds: Array<{ id: string; amount: number; reason: string; by: string | null; method: string; at: string }>
}
type Expense = { id: number; date: string; category: string; description: string; amount: number; method: string; supplier: string | null; reference: string; status: string; voidReason: string; by: string | null }

const EXPENSE_CATS = ['rent', 'salaries', 'utilities', 'supplies', 'marketing', 'maintenance', 'equipment', 'fees', 'taxes', 'other']
const REPORTS: Array<[string, string]> = [['summary', 'Summary'], ['daily', 'Daily'], ['products', 'Products'], ['categories', 'Categories'], ['payments', 'Payment methods'],
  ['expenses', 'Expenses'], ['orders', 'All orders'], ['hours', 'Peak hours'], ['tables', 'Tables'], ['waste', 'Waste']]
const shift = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const monthStart = (d: string) => `${d.slice(0, 8)}01`
const prettyDay = (d: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { ...opts, timeZone: 'UTC' })

export default function FinancePage() {
  const { me } = useMe()
  const [today, setToday] = useState('')
  const [range, setRange] = useState<{ from: string; to: string } | null>(null)
  const [preset, setPreset] = useState('today')
  const [rep, setRep] = useState<Report | null>(null)
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [err, setErr] = useState('')
  const [exportName, setExportName] = useState('summary')
  const [adding, setAdding] = useState(false)
  const m = useCallback((n: number) => formatMoney(Math.round(n), rep?.currency ?? 'IQD'), [rep?.currency])

  const load = useCallback(async () => {
    try {
      const q = range ? `?from=${range.from}&to=${range.to}` : ''
      const r = await api<Report>('GET', `/api/admin/finance/report${q}`)
      setRep(r); setErr('')
      if (!range) { setToday(r.range.from); setRange({ from: r.range.from, to: r.range.to }) }
      setExpenses((await api<{ expenses: Expense[] }>('GET', `/api/admin/finance/expenses?from=${r.range.from}&to=${r.range.to}`)).expenses)
    } catch (e) { setErr(e instanceof ApiErr ? e.message : 'Could not load the report') }
  }, [range])
  useEffect(() => { void load() }, [load])

  const presets: Array<[string, string, () => { from: string; to: string }]> = today ? [
    ['today', 'Today', () => ({ from: today, to: today })],
    ['yesterday', 'Yesterday', () => ({ from: shift(today, -1), to: shift(today, -1) })],
    ['7', 'Last 7 days', () => ({ from: shift(today, -6), to: today })],
    ['30', 'Last 30 days', () => ({ from: shift(today, -29), to: today })],
    ['month', 'This month', () => ({ from: monthStart(today), to: today })],
    ['lastmonth', 'Last month', () => { const end = shift(monthStart(today), -1); return { from: monthStart(end), to: end } }],
  ] : []

  const k = rep?.kpis
  const p = rep?.previous.kpis
  const chart = useMemo(() => {
    if (!rep) return []
    if (rep.range.days === 1) return rep.hourly.map((h) => ({ key: String(h.hour), title: `${String(h.hour).padStart(2, '0')}:00–${String((h.hour + 1) % 24).padStart(2, '0')}:00`, label: String(h.hour).padStart(2, '0'), value: h.netSales, detail: `${h.orders} orders` }))
    return rep.daily.map((d) => ({ key: d.date, title: prettyDay(d.date, { weekday: 'short', day: 'numeric', month: 'short' }), label: prettyDay(d.date, rep.range.days > 14 ? { day: 'numeric' } : { day: 'numeric', month: 'short' }), value: d.netSales, detail: `${d.orders} orders · ${m(d.collected)} collected` }))
  }, [rep, m])
  const peak = rep ? rep.hourly.reduce((a, h) => (h.netSales > a.netSales ? h : a), rep.hourly[0]) : null
  const exportUrl = (format: 'csv' | 'xlsx', name = exportName) => `/api/admin/finance/export?report=${name}&format=${format}&from=${range?.from}&to=${range?.to}`

  return (
    <div className="fin themed">
      <div className="ad-head fin-head">
        <h1>Finance</h1>
        <div className="fin-actions no-print">
          <select className="ui-select" value={exportName} onChange={(e) => setExportName(e.target.value)} aria-label="Report to export">
            {REPORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <a className="ui-btn" href={exportUrl('csv')} download><Download size={16} /> CSV</a>
          <a className="ui-btn" href={exportUrl('xlsx', 'all')} download><FileSpreadsheet size={16} /> Excel (all)</a>
          <button type="button" className="ui-btn" onClick={() => window.print()}><Printer size={16} /> PDF</button>
        </div>
      </div>
      <div className="fin-range no-print">
        <div className="ui-seg" role="group" aria-label="Period">
          {presets.map(([id, label, fn]) => <button key={id} type="button" aria-pressed={preset === id} onClick={() => { setPreset(id); setRange(fn()) }}>{label}</button>)}
        </div>
        {range && (
          <div className="fin-custom">
            <input type="date" className="ui-input" value={range.from} max={range.to} onChange={(e) => { if (e.target.value) { setPreset('custom'); setRange({ ...range, from: e.target.value }) } }} aria-label="From" />
            <span>to</span>
            <input type="date" className="ui-input" value={range.to} min={range.from} onChange={(e) => { if (e.target.value) { setPreset('custom'); setRange({ ...range, to: e.target.value }) } }} aria-label="To" />
          </div>
        )}
      </div>
      {rep && <p className="fin-sub">{rep.range.from === rep.range.to ? prettyDay(rep.range.from, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : `${prettyDay(rep.range.from, { day: 'numeric', month: 'long' })} – ${prettyDay(rep.range.to, { day: 'numeric', month: 'long', year: 'numeric' })}`}
        <span className="ui-hint"> · compared with {rep.previous.from === rep.previous.to ? prettyDay(rep.previous.from) : `${prettyDay(rep.previous.from)} – ${prettyDay(rep.previous.to)}`}</span></p>}
      {err && <p className="ui-alert danger">{err}</p>}

      {k && p && (
        <>
          <section className="fin-kpis" aria-label="Headline numbers">
            <Tile label="Net sales" value={m(k.netSales)} now={k.netSales} before={p.netSales} />
            <Tile label="Orders" value={k.orders.toLocaleString('en-US')} now={k.orders} before={p.orders} note={`avg ${m(k.averageOrder)}`} />
            <Tile label="Collected" value={m(k.collected)} now={k.collected} before={p.collected} note={k.outstanding ? `${m(k.outstanding)} unpaid` : 'nothing unpaid'} warn={k.outstanding > 0} />
            <Tile label="Estimated profit" value={m(k.netProfit)} now={k.netProfit} before={p.netProfit} note={k.recipeCoverage === null ? undefined : `${k.recipeCoverage}% of items costed`} warn={k.recipeCoverage !== null && k.recipeCoverage < 100} />
          </section>

          <div className="fin-grid">
            <section className="ui-card fin-card fin-pl" aria-label="Profit and loss">
              <h2>Profit and loss</h2>
              <dl>
                <div><dt>Sales before discounts</dt><dd>{m(k.subtotal)}</dd></div>
                <div className="neg"><dt>Discounts</dt><dd>{k.discounts ? `−${m(k.discounts)}` : m(0)}</dd></div>
                <div className="sum"><dt>Net sales</dt><dd>{m(k.netSales)}</dd></div>
                <div className="neg"><dt>Cost of goods{k.foodCostPercent !== null ? ` · ${k.foodCostPercent}% food cost` : ''}</dt><dd>{k.cogs ? `−${m(k.cogs)}` : m(0)}</dd></div>
                <div className="sum"><dt>Gross profit</dt><dd>{m(k.grossProfit)}</dd></div>
                <div className="neg"><dt>Waste</dt><dd>{k.waste ? `−${m(k.waste)}` : m(0)}</dd></div>
                <div className="neg"><dt>Expenses</dt><dd>{k.expenses ? `−${m(k.expenses)}` : m(0)}</dd></div>
                <div className={`total ${k.netProfit < 0 ? 'loss' : ''}`}><dt>Estimated net profit</dt><dd>{m(k.netProfit)}</dd></div>
              </dl>
              <div className="fin-aside">
                <span>Tax collected <b>{m(k.tax)}</b></span><span>Service charge <b>{m(k.service)}</b></span>
                <span>Refunds <b>{m(k.refunds)}</b></span><span>Stock bought <b>{m(k.inventoryPurchases)}</b></span>
                <span>Cancelled <b>{k.cancelledOrders} · {m(k.cancelledValue)}</b></span><span>Cash in drawer <b>{m(k.cashTaken)}</b></span>
              </div>
              <p className="fin-note"><Info size={14} /> Profit is an estimate. Cost of goods comes from recipes and the stock actually used{k.recipeCoverage !== null && k.recipeCoverage < 100 ? `; ${100 - k.recipeCoverage}% of items sold have no recipe yet, so their ingredients are not counted` : ''}. Stock bought is not an expense: it is counted when it is used. Tax and service charge are not income.</p>
            </section>

            <section className="ui-card fin-card" aria-label={rep!.range.days === 1 ? 'Net sales by hour' : 'Net sales by day'}>
              <h2>{rep!.range.days === 1 ? 'Net sales by hour' : 'Net sales by day'}</h2>
              <Columns data={chart} format={m} ariaLabel="Net sales" labelEvery={rep!.range.days === 1 ? 3 : Math.max(1, Math.ceil(chart.length / 12))} />
            </section>
          </div>

          <div className="fin-grid two">
            {rep!.range.days > 1 && (
              <section className="ui-card fin-card">
                <h2>Busiest hours</h2>
                {peak && peak.netSales > 0 && <p className="ui-hint">Peak: {String(peak.hour).padStart(2, '0')}:00–{String((peak.hour + 1) % 24).padStart(2, '0')}:00 · {m(peak.netSales)}</p>}
                <Columns data={rep!.hourly.map((h) => ({ key: String(h.hour), label: String(h.hour).padStart(2, '0'), value: h.netSales, detail: `${h.orders} orders` }))} format={m} labelEvery={3} height={160} ariaLabel="Net sales by hour of day" />
              </section>
            )}
            <section className="ui-card fin-card">
              <h2>Sales by category</h2>
              <ShareBars rows={rep!.categories.map((c) => ({ key: c.category, label: c.category, value: c.revenue, note: `${c.quantity} sold` }))} format={m} />
            </section>
            <section className="ui-card fin-card">
              <h2>Payment methods</h2>
              <ShareBars rows={rep!.methods.map((x) => ({ key: `${x.method}-${x.currency}`, label: `${x.label}${x.currency !== rep!.currency ? ` (${x.currency})` : ''}`, value: x.net, note: `${x.payments} payments${x.refunds ? ` · ${m(x.refunds)} refunded` : ''}` }))} format={m} />
            </section>
            <section className="ui-card fin-card">
              <h2>Order types</h2>
              <ShareBars rows={rep!.types.map((t) => ({ key: t.type, label: t.type.replace('_', '-').replace(/^./, (c) => c.toUpperCase()), value: t.netSales, note: `${t.orders} orders` }))} format={m} />
            </section>
          </div>

          <section className="ui-card fin-card">
            <h2>Products</h2>
            <div className="pos-table-wrap">
              <table className="pos-table">
                <thead><tr><th>Product</th><th>Category</th><th className="num">Sold</th><th className="num">Revenue</th><th className="num">Ingredient cost</th><th className="num">Margin</th></tr></thead>
                <tbody>
                  {rep!.products.slice(0, 15).map((x) => (
                    <tr key={`${x.itemId}-${x.name}`}>
                      <td>{x.name}</td><td>{x.category}</td><td className="num">{x.quantity}</td><td className="num">{m(x.revenue)}</td>
                      <td className="num">{x.estimatedCost === null ? <span className="ui-hint">no recipe</span> : m(x.estimatedCost)}</td>
                      <td className="num">{x.marginPercent === null ? '—' : <span className={`ui-pill ${x.marginPercent < 60 ? 'warning' : 'success'}`}>{x.marginPercent}%</span>}</td>
                    </tr>
                  ))}
                  {!rep!.products.length && <tr><td colSpan={6} className="ui-muted" style={{ textAlign: 'center', padding: 24 }}>Nothing sold in this period.</td></tr>}
                </tbody>
              </table>
            </div>
            {rep!.products.length > 3 && (
              <p className="fin-slow"><b>Slowest sellers:</b> {rep!.products.slice(-3).reverse().map((x) => `${x.name} (${x.quantity})`).join(', ')}
                {rep!.unsold.length > 0 && <> · <b>Not sold at all:</b> {rep!.unsold.slice(0, 8).join(', ')}{rep!.unsold.length > 8 ? ` and ${rep!.unsold.length - 8} more` : ''}</>}</p>
            )}
          </section>

          <div className="fin-grid two">
            <section className="ui-card fin-card">
              <div className="fin-card-head"><h2>Expenses</h2>{can(me.role, 'finance.manage') && <button type="button" className="ui-btn sm no-print" onClick={() => setAdding(true)}><Plus size={14} /> Record expense</button>}</div>
              <ul className="fin-list">
                {expenses.map((e) => (
                  <li key={e.id} className={e.status === 'voided' ? 'void' : ''}>
                    <span><b>{e.description}</b><small>{prettyDay(e.date)} · {e.category}{e.method ? ` · ${e.method}` : ''}{e.status === 'voided' ? ` · void: ${e.voidReason}` : ''}</small></span>
                    <span className="num">{m(e.amount)}</span>
                    {e.status !== 'voided' && can(me.role, 'finance.manage') && <VoidButton id={e.id} onDone={load} />}
                  </li>
                ))}
                {!expenses.length && <li className="ui-muted">No expenses recorded for this period.</li>}
              </ul>
            </section>
            <section className="ui-card fin-card">
              <h2>Tables</h2>
              <ShareBars rows={rep!.tables.slice(0, 8).map((t) => ({ key: t.table, label: `Table ${t.table}`, value: t.netSales, note: `${t.orders} orders · avg ${m(t.average)}` }))} format={m} />
            </section>
            <section className="ui-card fin-card">
              <h2>Discounts and refunds</h2>
              <ul className="fin-list">
                {rep!.discounts.slice(0, 8).map((d) => <li key={d.order}><span><b>{d.order}</b><small>discount · {d.reason}</small></span><span className="num">−{m(d.amount)}</span></li>)}
                {rep!.refunds.slice(0, 8).map((r) => <li key={r.id}><span><b>Refund</b><small>{r.reason}{r.by ? ` · ${r.by}` : ''}</small></span><span className="num">−{m(r.amount)}</span></li>)}
                {!rep!.discounts.length && !rep!.refunds.length && <li className="ui-muted">None in this period.</li>}
              </ul>
            </section>
            <section className="ui-card fin-card">
              <h2>Waste</h2>
              <ul className="fin-list">
                {rep!.waste.map((w) => <li key={w.ingredient}><span><b>{w.ingredient}</b><small>{w.quantity.toLocaleString('en-US')} {w.unit}</small></span><span className="num">{m(w.value)}</span></li>)}
                {!rep!.waste.length && <li className="ui-muted">No waste recorded.</li>}
              </ul>
            </section>
          </div>
        </>
      )}
      {adding && <ExpenseDialog today={today} onClose={() => setAdding(false)} onDone={async () => { setAdding(false); await load() }} />}
    </div>
  )
}

function Tile({ label, value, now, before, note, warn }: { label: string; value: string; now: number; before: number; note?: string; warn?: boolean }) {
  const diff = now - before
  const pct = before ? Math.round((diff / Math.abs(before)) * 100) : null
  const up = diff > 0
  return (
    <div className="fin-tile ui-card">
      <span className="fin-tile-label">{label}</span>
      <b className="ui-num">{value}</b>
      <span className="fin-tile-meta">
        {before === 0 && now !== 0 ? <span className="ui-hint">nothing in the previous period</span>
          : diff === 0 ? <span className="ui-hint">same as before</span>
          : <span className={`fin-delta ${up ? 'up' : 'down'}`}>{up ? <TrendingUp size={14} aria-hidden /> : <TrendingDown size={14} aria-hidden />}{`${up ? '+' : ''}${pct}%`}<span className="sr-only">{up ? ' up' : ' down'} on the previous period</span></span>}
        {note && <span className={warn ? 'fin-warn' : 'ui-hint'}>{note}</span>}
      </span>
    </div>
  )
}

function VoidButton({ id, onDone }: { id: number; onDone: () => Promise<void> }) {
  const [asking, setAsking] = useState(false)
  const [reason, setReason] = useState('')
  if (!asking) return <button type="button" className="ui-btn sm ghost no-print" onClick={() => setAsking(true)}>Void</button>
  return (
    <form className="fin-void no-print" onSubmit={async (e) => { e.preventDefault(); await api('PATCH', '/api/admin/finance/expenses', { id, reason }); await onDone() }}>
      <input className="ui-input" placeholder="Why?" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus aria-label="Reason" />
      <button type="submit" className="ui-btn sm danger" disabled={!reason.trim()}>Void</button>
    </form>
  )
}

function ExpenseDialog({ today, onClose, onDone }: { today: string; onClose: () => void; onDone: () => Promise<void> }) {
  const [f, setF] = useState({ date: today, category: 'supplies', description: '', amount: '', method: 'cash', reference: '' })
  const [err, setErr] = useState('')
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('')
    try { await api('POST', '/api/admin/finance/expenses', { ...f, amount: Number(f.amount) }); await onDone() } catch (x) { setErr(x instanceof ApiErr ? x.message : 'Not saved') }
  }
  return (
    <div className="ui-overlay" onClick={onClose}>
      <form className="ui-dialog" style={{ width: 'min(520px,100%)' }} onSubmit={save} onClick={(e) => e.stopPropagation()} aria-label="Record expense">
        <header><div><h2>Record an expense</h2><span className="ui-muted">Rent, salaries, bills. Stock you buy goes in Inventory, not here.</span></div></header>
        <div className="ui-dialog-body resv-form">
          <label className="ui-label">Date paid<input className="ui-input" type="date" required max={today} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
          <label className="ui-label">Category<select className="ui-select" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{EXPENSE_CATS.map((c) => <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>)}</select></label>
          <label className="ui-label wide">Description<input className="ui-input" required minLength={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
          <label className="ui-label">Amount (IQD)<input className="ui-input" required inputMode="numeric" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/\D/g, '') })} /></label>
          <label className="ui-label">Paid by<select className="ui-select" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}><option value="cash">Cash</option><option value="transfer">Bank transfer</option><option value="card">Card</option><option value="other">Other</option></select></label>
          <label className="ui-label wide">Reference (optional)<input className="ui-input" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} placeholder="Invoice or receipt number" /></label>
          {err && <p className="ui-alert danger wide">{err}</p>}
        </div>
        <div className="ui-dialog-foot"><button type="button" className="ui-btn" onClick={onClose}>Cancel</button><button type="submit" className="ui-btn primary" style={{ marginInlineStart: 'auto' }}>Save</button></div>
      </form>
    </div>
  )
}
