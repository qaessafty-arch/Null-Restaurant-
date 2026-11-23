'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BellRing, CalendarClock, Move, Receipt, Users, X } from 'lucide-react'
import { api, ApiErr, agoText } from '@/components/staff/api'
import { useLive, useMe } from '@/components/staff/shell'
import { can } from '@/lib/permissions'
import { formatMoney } from '@/lib/money'

type Status = 'available' | 'occupied' | 'reserved' | 'ordering' | 'waiting_food' | 'waiting_payment' | 'cleaning' | 'out_of_service'
type FTable = {
  id: number; number: string; capacity: number; shape: 'square' | 'round' | 'rect'; x: number | null; y: number | null
  sectionId: number | null; section: string | null; waiterId: number | null; waiter: string | null; status: Status; manualState: string | null
  openOrders: number; due: number; openRequests: number; billRequested: boolean; since: string | null
  reservation: { id: string; name: string; partySize: number; startsAt: string; time: string; status: string } | null
}
type Section = { id: number; name: string }

const STATUS: Record<Status, { label: string; cls: string }> = {
  available: { label: 'Available', cls: 'st-available' },
  occupied: { label: 'Occupied', cls: 'st-occupied' },
  reserved: { label: 'Reserved', cls: 'st-reserved' },
  ordering: { label: 'Ordering', cls: 'st-ordering' },
  waiting_food: { label: 'Waiting for food', cls: 'st-food' },
  waiting_payment: { label: 'Waiting for payment', cls: 'st-pay' },
  cleaning: { label: 'Cleaning', cls: 'st-cleaning' },
  out_of_service: { label: 'Out of service', cls: 'st-oos' },
}

/** Where a table sits until someone drags it: a tidy grid per section. */
function autoPos(i: number) { return { x: 8 + (i % 6) * 16, y: 12 + Math.floor(i / 6) * 22 } }

export default function FloorPage() {
  const { me } = useMe()
  const [tables, setTables] = useState<FTable[]>([])
  const [sections, setSections] = useState<Section[]>([])
  const [waiters, setWaiters] = useState<Array<{ id: number; name: string }>>([])
  const [sec, setSec] = useState<number | 'all'>('all')
  const [edit, setEdit] = useState(false)
  const [open, setOpen] = useState<number | null>(null)
  const [err, setErr] = useState('')
  const [drag, setDrag] = useState<{ id: number; x: number; y: number } | null>(null)
  const room = useRef<HTMLDivElement>(null)
  const manage = can(me.role, 'tables.manage')
  const base = 'IQD'

  const load = useCallback(async () => {
    try {
      const d = await api<{ tables: FTable[]; sections: Section[] }>('GET', '/api/staff/floor')
      setTables(d.tables); setSections(d.sections); setErr('')
    } catch (e) { setErr(e instanceof ApiErr ? e.message : 'Offline. Retrying…') }
  }, [])
  useLive(load, 8000)
  useEffect(() => {
    if (manage) api<{ waiters: Array<{ id: number; name: string }> }>('GET', '/api/admin/tables').then((d) => setWaiters(d.waiters)).catch(() => {})
  }, [manage])

  const shown = useMemo(() => tables.filter((t) => sec === 'all' || t.sectionId === sec), [tables, sec])
  const counts = useMemo(() => {
    const c: Partial<Record<Status, number>> = {}
    for (const t of shown) c[t.status] = (c[t.status] ?? 0) + 1
    return c
  }, [shown])
  const seats = shown.reduce((a, t) => a + t.capacity, 0)
  const seated = shown.filter((t) => !['available', 'reserved', 'cleaning', 'out_of_service'].includes(t.status)).reduce((a, t) => a + t.capacity, 0)

  const pos = (t: FTable, i: number) => (drag?.id === t.id ? drag : t.x !== null && t.y !== null ? { x: t.x, y: t.y } : autoPos(i))

  const onDown = (e: React.PointerEvent, t: FTable, i: number) => {
    if (!edit) return
    e.preventDefault()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    setDrag({ id: t.id, ...pos(t, i) })
  }
  const onMove = (e: React.PointerEvent) => {
    if (!drag || !room.current) return
    const r = room.current.getBoundingClientRect()
    const x = Math.min(96, Math.max(4, ((e.clientX - r.left) / r.width) * 100))
    const y = Math.min(94, Math.max(6, ((e.clientY - r.top) / r.height) * 100))
    setDrag({ id: drag.id, x, y })
  }
  const onUp = async () => {
    if (!drag) return
    const d = drag
    setTables((ts) => ts.map((t) => (t.id === d.id ? { ...t, x: Math.round(d.x * 10) / 10, y: Math.round(d.y * 10) / 10 } : t)))
    setDrag(null)
    try { await api('PATCH', '/api/admin/tables', { id: d.id, x: d.x, y: d.y }) } catch (e) { setErr(e instanceof ApiErr ? e.message : 'Position not saved'); void load() }
  }

  const selected = tables.find((t) => t.id === open) ?? null

  return (
    <div className="floor themed">
      <div className="ad-head floor-head">
        <h1>Floor</h1>
        <p className="ui-muted floor-sum"><Users size={16} /> {seated} of {seats} seats in use</p>
        {manage && (
          <button type="button" className={`ui-btn ${edit ? 'primary' : ''}`} onClick={() => setEdit(!edit)} aria-pressed={edit}>
            <Move size={16} /> {edit ? 'Done arranging' : 'Arrange tables'}
          </button>
        )}
      </div>
      {err && <p className="ui-alert warning">{err}</p>}
      <div className="floor-bar">
        <div className="ui-seg" role="tablist" aria-label="Section">
          <button type="button" role="tab" aria-pressed={sec === 'all'} onClick={() => setSec('all')}>All</button>
          {sections.map((s) => <button key={s.id} type="button" role="tab" aria-pressed={sec === s.id} onClick={() => setSec(s.id)}>{s.name}</button>)}
        </div>
        <ul className="floor-legend" aria-label="Legend">
          {(Object.keys(STATUS) as Status[]).filter((s) => counts[s]).map((s) => (
            <li key={s}><i className={STATUS[s].cls} />{STATUS[s].label} <b>{counts[s]}</b></li>
          ))}
        </ul>
      </div>
      {edit && <p className="ui-hint">Drag tables to where they stand in the room. Positions save when you let go.</p>}

      <div ref={room} className={`floor-room ${edit ? 'editing' : ''}`} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        {shown.map((t, i) => {
          const p = pos(t, i)
          return (
            <button key={t.id} type="button"
              className={`floor-table shape-${t.shape} ${STATUS[t.status].cls} ${drag?.id === t.id ? 'dragging' : ''} ${open === t.id ? 'open' : ''}`}
              style={{ left: `${p.x}%`, top: `${p.y}%`, '--seats': Math.min(t.capacity, 12) } as React.CSSProperties}
              onPointerDown={(e) => onDown(e, t, i)}
              onClick={() => { if (!edit) setOpen(t.id) }}
              aria-label={`Table ${t.number}, ${t.capacity} seats, ${STATUS[t.status].label}`}>
              <b>{t.number}</b>
              <small>{t.capacity} seats</small>
              {(t.openRequests > 0 || t.billRequested) && <span className="floor-ping" aria-hidden>{t.billRequested ? <Receipt size={12} /> : <BellRing size={12} />}</span>}
              {t.status === 'reserved' && t.reservation && <span className="floor-tag">{t.reservation.time}</span>}
              {t.due > 0 && t.status !== 'reserved' && <span className="floor-tag">{formatMoney(t.due, base)}</span>}
            </button>
          )
        })}
        {!shown.length && <p className="floor-empty ui-muted">No tables in this section yet. Add them in Tables &amp; QR.</p>}
      </div>

      {selected && <TableDrawer t={selected} sections={sections} waiters={waiters} manage={manage} onClose={() => setOpen(null)} onChanged={load} />}
    </div>
  )
}

function TableDrawer({ t, sections, waiters, manage, onClose, onChanged }: {
  t: FTable; sections: Section[]; waiters: Array<{ id: number; name: string }>; manage: boolean; onClose: () => void; onChanged: () => Promise<void>
}) {
  const { me } = useMe()
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setErr('')
    try { await fn(); await onChanged() } catch (e) { setErr(e instanceof ApiErr ? e.message : 'Failed') } finally { setBusy(false) }
  }
  const state = (action: string) => act(() => api('POST', `/api/staff/floor/${t.id}`, { action }))
  const patch = (b: Record<string, unknown>) => act(() => api('PATCH', '/api/admin/tables', { id: t.id, ...b }))
  const canAct = can(me.role, 'orders.serve') || can(me.role, 'reservations.manage') || manage
  const hasMoney = t.due > 0 || t.openOrders > 0

  return (
    <div className="ui-overlay floor-drawer-wrap" onClick={onClose}>
      <aside className="floor-drawer" role="dialog" aria-modal="true" aria-label={`Table ${t.number}`} onClick={(e) => e.stopPropagation()}>
        <header>
          <div>
            <span className="ui-hint">{t.section ?? 'No section'}</span>
            <h2>Table {t.number}</h2>
            <span className={`floor-status ${STATUS[t.status].cls}`}>{STATUS[t.status].label}</span>
          </div>
          <button type="button" className="ui-icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>
        <dl className="floor-facts">
          <div><dt>Seats</dt><dd>{t.capacity}</dd></div>
          <div><dt>Waiter</dt><dd>{t.waiter ?? 'Unassigned'}</dd></div>
          {t.since && <div><dt>Seated</dt><dd>{agoText(t.since)}</dd></div>}
          {t.openOrders > 0 && <div><dt>Open orders</dt><dd>{t.openOrders}</dd></div>}
          {t.due > 0 && <div><dt>Still to pay</dt><dd>{formatMoney(t.due, 'IQD')}</dd></div>}
          {t.openRequests > 0 && <div><dt>Guest requests</dt><dd>{t.openRequests}{t.billRequested ? ' · asked for the bill' : ''}</dd></div>}
        </dl>
        {t.reservation && (
          <p className="floor-res"><CalendarClock size={16} /> {t.reservation.name}, {t.reservation.partySize} guests · {t.reservation.time}
            {t.reservation.status === 'seated' ? ' · seated' : ''}</p>
        )}
        {err && <p className="ui-alert danger">{err}</p>}
        {canAct && (
          <div className="floor-actions">
            {['available', 'reserved'].includes(t.status) && <button type="button" className="ui-btn primary" disabled={busy} onClick={() => state('seat')}>Seat walk-in guests</button>}
            {['occupied', 'waiting_payment', 'ordering', 'waiting_food'].includes(t.status) && (
              <button type="button" className="ui-btn" disabled={busy || hasMoney} onClick={() => state('clear')} title={hasMoney ? 'Settle the bill first' : ''}>Guests left · needs cleaning</button>
            )}
            {t.status === 'cleaning' && <button type="button" className="ui-btn primary" disabled={busy} onClick={() => state('cleaned')}>Cleaned · ready for guests</button>}
            {t.status === 'out_of_service'
              ? <button type="button" className="ui-btn" disabled={busy} onClick={() => state('back_in_service')}>Back in service</button>
              : !hasMoney && <button type="button" className="ui-btn ghost" disabled={busy} onClick={() => state('out_of_service')}>Out of service</button>}
            {hasMoney && <p className="ui-hint">The table can be cleared once every order is paid and finished.</p>}
          </div>
        )}
        {manage && (
          <div className="floor-edit">
            <h3>Table settings</h3>
            <label className="ui-label">Seats
              <select className="ui-select" value={t.capacity} onChange={(e) => patch({ capacity: Number(e.target.value) })}>
                {Array.from({ length: 20 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label className="ui-label">Section
              <select className="ui-select" value={t.sectionId ?? ''} onChange={(e) => patch({ sectionId: e.target.value ? Number(e.target.value) : null })}>
                <option value="">None</option>
                {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label className="ui-label">Shape
              <select className="ui-select" value={t.shape} onChange={(e) => patch({ shape: e.target.value })}>
                <option value="square">Square</option><option value="round">Round</option><option value="rect">Long</option>
              </select>
            </label>
            <label className="ui-label">Waiter
              <select className="ui-select" value={t.waiterId ?? ''} onChange={(e) => patch({ waiterId: e.target.value ? Number(e.target.value) : null })}>
                <option value="">Unassigned</option>
                {waiters.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </label>
          </div>
        )}
      </aside>
    </div>
  )
}
