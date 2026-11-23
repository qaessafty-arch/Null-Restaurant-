'use client'

import { useCallback, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, BellRing, CalendarDays, ChefHat, ClipboardCheck, Receipt, ShieldCheck, TrendingDown, TrendingUp, Utensils } from 'lucide-react'
import { useLive } from '@/components/staff/shell'
import { api, ApiErr, clock, STATUS_LABEL } from '@/components/staff/api'
import { QuickSwitches } from '@/components/staff/quick-switches'
import { Columns } from '@/components/charts/columns'
import { formatMoney } from '@/lib/money'

type K = { netSales: number; orders: number; averageOrder: number; collected: number; cancelledOrders: number; outstanding: number; netProfit: number; recipeCoverage: number | null }
type D = {
  range: { from: string; to: string; days: number }; previous: { from: string; to: string; kpis: K }; currency: string; kpis: K
  chart: Array<{ key: string; label: string; value: number; orders: number }>
  best: Array<{ name: string; quantity: number; revenue: number }>
  live: {
    awaitingVerification: number; inKitchen: number; ready: number; late: number; openRequests: number; billRequests: number; unpaidOrders: number; unpaidValue: number
    tables: { total: number; inUse: number; available: number; reserved: number; cleaning: number }
    reservationsToday: { count: number; guests: number; next: Array<{ id: string; name: string; time: string; partySize: number; tableNumber: string | null; status: string }> }
    lowStock: Array<{ name: string; stock: number; unit: string; out: boolean }>
  }
  payments: Array<{ id: string; kind: string; method: string; currency: string; amount: number; baseAmount: number; status: string; orders: string; at: string; by: string | null }>
  activity: Array<{ order: string; status: string; by: string; where: string; at: string }>
}

const PERIODS: Array<[string, string]> = [['today', 'Today'], ['yesterday', 'Yesterday'], ['7', '7 days'], ['30', '30 days']]
const shift = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }

export default function Dashboard() {
  const [period, setPeriod] = useState('today')
  const [today, setToday] = useState('')
  const [d, setD] = useState<D | null>(null)
  const [err, setErr] = useState('')
  const load = useCallback(async () => {
    try {
      const t = today
      const q = !t ? '' : period === 'today' ? `?from=${t}` : period === 'yesterday' ? `?from=${shift(t, -1)}` : `?from=${shift(t, -Number(period) + 1)}&to=${t}`
      const r = await api<D>('GET', `/api/admin/dashboard${q}`)
      if (!t) setToday(r.range.to)
      setD(r); setErr('')
    } catch (e) { setErr(e instanceof ApiErr ? e.message : 'Offline. Retrying…') }
  }, [period, today])
  useLive(load, 15000)
  const m = (n: number) => formatMoney(Math.round(n), d?.currency ?? 'IQD')
  const prevName = period === 'today' ? 'yesterday' : period === 'yesterday' ? 'the day before' : 'the previous period'

  return (
    <div className="dash themed">
      <div className="ad-head fin-head">
        <h1>Dashboard</h1>
        <div className="ui-seg" role="group" aria-label="Period" style={{ marginInlineStart: 'auto' }}>
          {PERIODS.map(([id, label]) => <button key={id} type="button" aria-pressed={period === id} onClick={() => setPeriod(id)}>{label}</button>)}
        </div>
      </div>
      {err && <p className="ui-alert warning">{err}</p>}
      {d && (
        <>
          <section className="fin-kpis" aria-label="Money">
            <Kpi label="Net sales" value={m(d.kpis.netSales)} now={d.kpis.netSales} before={d.previous.kpis.netSales} vs={prevName} />
            <Kpi label="Orders" value={String(d.kpis.orders)} now={d.kpis.orders} before={d.previous.kpis.orders} vs={prevName} note={`avg ${m(d.kpis.averageOrder)}${d.kpis.cancelledOrders ? ` · ${d.kpis.cancelledOrders} cancelled` : ''}`} />
            <Kpi label="Collected" value={m(d.kpis.collected)} now={d.kpis.collected} before={d.previous.kpis.collected} vs={prevName} />
            <Kpi label="Estimated profit" value={m(d.kpis.netProfit)} now={d.kpis.netProfit} before={d.previous.kpis.netProfit} vs={prevName}
              note={d.kpis.recipeCoverage !== null && d.kpis.recipeCoverage < 100 ? `${d.kpis.recipeCoverage}% of items costed` : undefined} href="/admin/finance" />
          </section>

          <section className="dash-now" aria-label="Right now">
            <Now icon={ShieldCheck} label="To verify" n={d.live.awaitingVerification} tone={d.live.awaitingVerification ? 'warning' : ''} href="/staff/waiter" />
            <Now icon={ChefHat} label="In the kitchen" n={d.live.inKitchen} sub={d.live.late ? `${d.live.late} late` : undefined} tone={d.live.late ? 'danger' : ''} href="/staff/kitchen" />
            <Now icon={Utensils} label="Ready to serve" n={d.live.ready} tone={d.live.ready ? 'success' : ''} href="/staff/waiter" />
            <Now icon={BellRing} label="Guest requests" n={d.live.openRequests} sub={d.live.billRequests ? `${d.live.billRequests} want the bill` : undefined} tone={d.live.openRequests ? 'warning' : ''} href="/staff/waiter" />
            <Now icon={Receipt} label="Unpaid orders" n={d.live.unpaidOrders} sub={d.live.unpaidValue ? m(d.live.unpaidValue) : undefined} tone={d.live.unpaidOrders ? 'warning' : ''} href="/staff/pos" />
            <Now icon={ClipboardCheck} label="Tables in use" n={d.live.tables.inUse} sub={`of ${d.live.tables.total} · ${d.live.tables.available} free`} href="/admin/floor" />
            <Now icon={CalendarDays} label="Bookings today" n={d.live.reservationsToday.count} sub={`${d.live.reservationsToday.guests} guests`} href="/admin/reservations" />
          </section>

          <div className="fin-grid dash-main">
            <section className="ui-card fin-card">
              <h2>{d.range.days === 1 ? 'Sales by hour' : 'Sales by day'}</h2>
              <Columns data={d.chart.map((c) => ({ key: c.key, label: d.range.days === 1 ? c.label : c.label.slice(8), title: d.range.days === 1 ? `${c.label}:00` : new Date(`${c.label}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }), value: c.value, detail: `${c.orders} orders` }))}
                format={m} ariaLabel="Net sales" labelEvery={d.range.days === 1 ? 3 : Math.max(1, Math.ceil(d.chart.length / 10))} height={180} />
            </section>
            <section className="ui-card fin-card">
              <h2>Needs attention</h2>
              <ul className="fin-list">
                {d.live.lowStock.map((g) => <li key={g.name}><AlertTriangle size={16} className={g.out ? 'tone-danger' : 'tone-warning'} /><span><b>{g.name}</b><small>{g.out ? 'out of stock' : `low: ${g.stock.toLocaleString('en-US')} ${g.unit} left`}</small></span><Link href="/admin/inventory" className="ui-btn sm ghost">Stock</Link></li>)}
                {d.live.reservationsToday.next.map((r) => <li key={r.id}><CalendarDays size={16} /><span><b>{r.time} · {r.name}</b><small>{r.partySize} guests · {r.tableNumber ? `Table ${r.tableNumber}` : 'no table yet'}{r.status === 'pending' ? ' · needs confirming' : ''}</small></span></li>)}
                {!d.live.lowStock.length && !d.live.reservationsToday.next.length && <li className="ui-muted">Nothing needs attention.</li>}
              </ul>
            </section>
          </div>

          <div className="fin-grid two">
            <section className="ui-card fin-card">
              <h2>Best sellers</h2>
              <ol className="dash-rank">
                {d.best.map((b) => <li key={b.name}><b>{b.name}</b><span>{b.quantity} sold</span><span className="num">{m(b.revenue)}</span></li>)}
                {!d.best.length && <li className="ui-muted">Nothing sold yet.</li>}
              </ol>
            </section>
            <section className="ui-card fin-card">
              <h2>Recent payments</h2>
              <ul className="fin-list">
                {d.payments.map((p) => (
                  <li key={p.id} className={p.status === 'voided' ? 'void' : ''}>
                    <span><b>{p.orders || '—'}</b><small>{clock(p.at)} · {p.method}{p.by ? ` · ${p.by}` : ''}{p.kind === 'refund' ? ' · refund' : ''}{p.status === 'voided' ? ' · void' : ''}</small></span>
                    <span className="num">{p.kind === 'refund' ? '−' : ''}{m(p.baseAmount)}</span>
                  </li>
                ))}
                {!d.payments.length && <li className="ui-muted">No payments yet.</li>}
              </ul>
            </section>
          </div>

          <section className="ui-card fin-card">
            <h2>Latest activity</h2>
            <ul className="dash-feed">
              {d.activity.map((a, i) => <li key={i}><time>{clock(a.at)}</time><b>{a.order}</b><span>{STATUS_LABEL[a.status] ?? a.status}</span><small>{a.where} · {a.by}</small></li>)}
              {!d.activity.length && <li className="ui-muted">No orders yet today.</li>}
            </ul>
          </section>
        </>
      )}
      <details className="dash-switches">
        <summary>Quick switches</summary>
        <QuickSwitches />
      </details>
    </div>
  )
}

function Kpi({ label, value, now, before, vs, note, href }: { label: string; value: string; now: number; before: number; vs: string; note?: string; href?: string }) {
  const diff = now - before
  const pct = before ? Math.round((diff / Math.abs(before)) * 100) : null
  const body = (
    <>
      <span className="fin-tile-label">{label}</span>
      <b className="ui-num">{value}</b>
      <span className="fin-tile-meta">
        {pct === null ? <span className="ui-hint">{now ? `nothing ${vs}` : 'none yet'}</span> : diff === 0 ? <span className="ui-hint">same as {vs}</span>
          : <span className={`fin-delta ${diff > 0 ? 'up' : 'down'}`}>{diff > 0 ? <TrendingUp size={14} aria-hidden /> : <TrendingDown size={14} aria-hidden />}{diff > 0 ? '+' : ''}{pct}% <span className="ui-hint">vs {vs}</span></span>}
        {note && <span className="fin-warn">{note}</span>}
      </span>
    </>
  )
  return href ? <Link href={href} className="fin-tile ui-card dash-link">{body}</Link> : <div className="fin-tile ui-card">{body}</div>
}

function Now({ icon: Icon, label, n, sub, tone = '', href }: { icon: typeof ChefHat; label: string; n: number; sub?: string; tone?: string; href: string }) {
  return (
    <Link href={href} className={`dash-now-item ${tone}`}>
      <Icon size={18} aria-hidden />
      <span className="ui-num">{n}</span>
      <span className="dash-now-label">{label}{sub && <small>{sub}</small>}</span>
    </Link>
  )
}
