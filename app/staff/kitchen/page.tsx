'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, ChefHat, Flame, Maximize2, MessageSquare, Minimize2, Zap } from 'lucide-react'
import { StaffShell, useLive } from '@/components/staff/shell'
import { api, ApiErr } from '@/components/staff/api'

export default function KitchenPage() {
  return <StaffShell perm="kitchen.operate" title="Kitchen" wide><Display /></StaffShell>
}

type LineStatus = 'new' | 'preparing' | 'ready'
type KLine = {
  id: number; name: string; quantity: number; instructions: string; status: LineStatus; options: string[]; allergens: string[]
  station: { id: number; name: string; color: string } | null
}
type KTicket = {
  id: string; label: string; type: string; tableNumber: string; customerName: string; status: string; rush: boolean; note: string
  confirmedAt: string; ageMinutes: number; targetMinutes: number; delayed: boolean; otherStationsPending: string[]; lines: KLine[]
}
type Station = { id: number; name: string; color: string }
type Board = { orders: KTicket[]; stations: Station[]; delayMinutes: number }

const NEXT: Record<LineStatus, LineStatus> = { new: 'preparing', preparing: 'ready', ready: 'preparing' }
const STORE = 'kds-station'

function timer(fromIso: string, now: number) {
  const s = Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 1000))
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

function Display() {
  const [station, setStation] = useState<number | 'all'>('all')
  const [board, setBoard] = useState<Board | null>(null)
  const [now, setNow] = useState(Date.now())
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')
  const [full, setFull] = useState(false)

  useEffect(() => {
    try { const v = localStorage.getItem(STORE); if (v && v !== 'all') setStation(Number(v)) } catch { /* private mode */ }
  }, [])
  const pick = (s: number | 'all') => { setStation(s); try { localStorage.setItem(STORE, String(s)) } catch { /* ignore */ } }

  const refresh = useCallback(async () => {
    try {
      setBoard(await api<Board>('GET', `/api/staff/kitchen${station === 'all' ? '' : `?station=${station}`}`))
      setErr('')
    } catch (e) { setErr(e instanceof ApiErr ? e.message : 'Connection lost. Retrying…') }
  }, [station])
  useLive(refresh, 4000)
  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(t) }, [])
  useEffect(() => {
    const on = () => setFull(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', on)
    return () => document.removeEventListener('fullscreenchange', on)
  }, [])

  const act = async (key: string, body: Record<string, unknown>) => {
    setBusy(key)
    try { await api('POST', '/api/staff/kitchen/lines', body); await refresh() }
    catch (e) { setErr(e instanceof ApiErr ? e.message : 'Not saved. Try again.'); await refresh() }
    finally { setBusy('') }
  }

  const cooking = useMemo(() => (board?.orders ?? []).filter((o) => o.status !== 'ready' && o.lines.some((l) => l.status !== 'ready')), [board])
  const waiting = useMemo(() => (board?.orders ?? []).filter((o) => o.status !== 'ready' && o.lines.every((l) => l.status === 'ready')), [board])
  const ready = useMemo(() => (board?.orders ?? []).filter((o) => o.status === 'ready'), [board])
  // Lanes are only a view of the same tickets: late first claims a ticket, then whether any line has started.
  const delayed = cooking.filter((o) => o.delayed)
  const fresh = cooking.filter((o) => !o.delayed && o.lines.every((l) => l.status === 'new'))
  const preparing = cooking.filter((o) => !o.delayed && !o.lines.every((l) => l.status === 'new'))
  const stationName = station === 'all' ? 'All stations' : board?.stations.find((s) => s.id === station)?.name ?? 'Station'

  const ticket = (o: KTicket) => {
    const late = o.delayed
    const warn = !late && o.ageMinutes >= o.targetMinutes * 0.75
    const anyNew = o.lines.some((l) => l.status === 'new')
    const k = (x: string) => `${o.id}:${x}`
    return (
      <article key={o.id} className={`kds-ticket ${late ? 'late' : warn ? 'warn' : ''} ${o.rush ? 'rush' : ''}`} aria-label={`${o.label} ${o.tableNumber ? `table ${o.tableNumber}` : o.type}`}>
        <header>
          <div className="kds-where">
            {o.tableNumber ? <><small>Table</small><b>{o.tableNumber}</b></> : <><small>{o.type.replace('_', '-')}</small><b className="kds-name">{o.customerName || '—'}</b></>}
          </div>
          <div className="kds-meta">
            <span className="kds-label">{o.label}</span>
            <span className="kds-timer" aria-label={`Waiting ${o.ageMinutes} minutes`}>{timer(o.confirmedAt, now)}</span>
          </div>
          {o.rush && <span className="kds-flag rush"><Zap size={14} /> Rush</span>}
          {late && <span className="kds-flag late"><AlertTriangle size={14} /> Late</span>}
        </header>
        <ul>
          {o.lines.map((l) => (
            <li key={l.id}>
              <button type="button" className={`kds-line s-${l.status}`} disabled={busy === k(String(l.id))}
                onClick={() => act(k(String(l.id)), { orderId: o.id, lineIds: [l.id], status: NEXT[l.status] })}
                aria-label={`${l.quantity} ${l.name}, ${l.status}. Tap to mark ${NEXT[l.status]}`}>
                <span className="kds-qty">{l.quantity}</span>
                <span className="kds-item">
                  <b>{l.name}</b>
                  {station === 'all' && l.station && <small className="kds-st" style={{ color: l.station.color }}>{l.station.name}</small>}
                  {l.options.length > 0 && <span className="kds-opts">{l.options.map((x, i) => <em key={i} className={/^no\b|without/i.test(x) ? 'no' : ''}>{x}</em>)}</span>}
                  {l.instructions && <span className="kds-instr"><MessageSquare size={14} /> {l.instructions}</span>}
                  {l.allergens.length > 0 && <span className="kds-allergen"><AlertTriangle size={14} /> {l.allergens.join(', ')}</span>}
                </span>
                <span className="kds-state" aria-hidden>{l.status === 'ready' ? <Check size={20} /> : l.status === 'preparing' ? <Flame size={18} /> : null}</span>
              </button>
            </li>
          ))}
        </ul>
        {o.note && <p className="kds-note"><MessageSquare size={15} /> {o.note}</p>}
        {o.otherStationsPending.length > 0 && <p className="kds-others">Also waiting on: {o.otherStationsPending.join(', ')}</p>}
        <footer>
          {anyNew
            ? <button type="button" className="kds-btn start" disabled={!!busy} onClick={() => act(k('start'), { orderId: o.id, lineIds: o.lines.filter((l) => l.status === 'new').map((l) => l.id), status: 'preparing' })}><Flame size={20} /> Start</button>
            : <button type="button" className="kds-btn done" disabled={!!busy} onClick={() => act(k('done'), { orderId: o.id, lineIds: o.lines.map((l) => l.id), status: 'ready' })}><Check size={20} /> {station === 'all' ? 'Order ready' : 'Done'}</button>}
        </footer>
      </article>
    )
  }

  return (
    <main className="kds themed">
      <div className="kds-bar">
        <div className="kds-stations" role="tablist" aria-label="Station">
          <button type="button" role="tab" aria-selected={station === 'all'} onClick={() => pick('all')}>All</button>
          {board?.stations.map((s) => (
            <button key={s.id} type="button" role="tab" aria-selected={station === s.id} onClick={() => pick(s.id)} style={{ '--st': s.color } as React.CSSProperties}>
              <i aria-hidden />{s.name}
            </button>
          ))}
        </div>
        <div className="kds-counts" aria-live="polite">
          <span><b>{cooking.length}</b> cooking</span>
          {cooking.filter((o) => o.delayed).length > 0 && <span className="late"><AlertTriangle size={16} /><b>{cooking.filter((o) => o.delayed).length}</b> late</span>}
        </div>
        <button type="button" className="kds-full" aria-label={full ? 'Exit full screen' : 'Full screen'}
          onClick={() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {})}>
          {full ? <Minimize2 size={20} /> : <Maximize2 size={20} />}
        </button>
      </div>
      {err && <p className="kds-err" role="alert">{err}</p>}

      {board && !cooking.length && !waiting.length && (
        <div className="kds-idle"><ChefHat size={40} /><b>{stationName}: nothing to cook</b><span>New tickets appear here with a sound.</span></div>
      )}

      {board && (cooking.length > 0 || waiting.length > 0 || ready.length > 0) && (
        <div className="kds-board">
          <Lane title="New" tone="new" list={fresh} render={ticket} empty="No new tickets" />
          <Lane title="Preparing" tone="prep" list={preparing} render={ticket} empty="Nothing on the grill" />
          <Lane title="Delayed" tone="late" list={delayed} render={ticket} empty={`Nothing over ${board.delayMinutes} min`} />
          <section className="kds-lane done" aria-label={station === 'all' ? 'Ready for pickup' : 'Done here'}>
            <h2>{station === 'all' ? 'Ready' : 'Done here'}<i>{waiting.length + ready.length}</i></h2>
            {waiting.length + ready.length === 0 && <p className="kds-lane-empty">Finished orders wait here for pickup</p>}
            {[...waiting, ...ready].map((o) => (
              <div key={o.id} className={`kds-chip ${o.status === 'ready' ? 'ready' : ''}`}>
                <b>{o.tableNumber ? `Table ${o.tableNumber}` : o.customerName || o.label}</b>
                <span>{o.label}</span>
                {o.status !== 'ready' && o.otherStationsPending.length > 0 && <small>Waiting on {o.otherStationsPending.join(', ')}</small>}
                {o.status === 'ready' && <small>Ready · {timer(o.confirmedAt, now)}</small>}
              </div>
            ))}
          </section>
        </div>
      )}
    </main>
  )
}

function Lane({ title, tone, list, render, empty }: { title: string; tone: string; list: KTicket[]; render: (o: KTicket) => React.ReactNode; empty: string }) {
  return (
    <section className={`kds-lane ${tone}`} aria-label={title}>
      <h2>{title}<i className={list.length ? 'on' : undefined}>{list.length}</i></h2>
      {list.length === 0 ? <p className="kds-lane-empty">{empty}</p> : list.map(render)}
    </section>
  )
}
