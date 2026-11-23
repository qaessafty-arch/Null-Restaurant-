'use client'

import { useCallback, useMemo, useState } from 'react'
import { CalendarPlus, ChevronLeft, ChevronRight, Phone, X, Cake, MessageSquare } from 'lucide-react'
import { api, ApiErr } from '@/components/staff/api'
import { useLive } from '@/components/staff/shell'

type Res = {
  id: string; code: string; name: string; phone: string; email: string; partySize: number; startsAt: string; endsAt: string; date: string; time: string
  tableId: number | null; tableNumber: string | null; sectionPref: number | null; section: string | null
  status: 'pending' | 'confirmed' | 'seated' | 'completed' | 'cancelled' | 'no_show'; occasion: string; requests: string; notes: string; source: string; cancelReason: string
}
type FTable = { id: number; number: string; capacity: number; sectionId: number | null; section: string | null }
type Section = { id: number; name: string }

const STATUS_LABEL: Record<Res['status'], string> = { pending: 'Needs confirming', confirmed: 'Confirmed', seated: 'Seated', completed: 'Completed', cancelled: 'Cancelled', no_show: 'No-show' }
const ACTIONS: Record<Res['status'], Array<{ to: Res['status']; label: string; primary?: boolean; ask?: boolean }>> = {
  pending: [{ to: 'confirmed', label: 'Confirm', primary: true }, { to: 'cancelled', label: 'Cancel', ask: true }],
  confirmed: [{ to: 'seated', label: 'Seat now', primary: true }, { to: 'no_show', label: 'No-show' }, { to: 'cancelled', label: 'Cancel', ask: true }],
  seated: [{ to: 'completed', label: 'Finished' }],
  completed: [], cancelled: [], no_show: [],
}
const OCCASIONS = ['', 'birthday', 'anniversary', 'date', 'business', 'celebration', 'other']
const shiftDay = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const minutes = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }
const prettyDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
const newKey = () => crypto.randomUUID()

export default function ReservationsPage() {
  const [day, setDay] = useState<string | null>(null)
  const [today, setToday] = useState('')
  const [list, setList] = useState<Res[]>([])
  const [tables, setTables] = useState<FTable[]>([])
  const [sections, setSections] = useState<Section[]>([])
  const [open, setOpen] = useState<Res | null>(null)
  const [form, setForm] = useState<Partial<Res> | 'new' | null>(null)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    try {
      const d = await api<{ reservations: Res[]; today: string }>('GET', `/api/staff/reservations${day ? `?from=${day}&to=${day}` : ''}`)
      setList(d.reservations); setToday(d.today); if (!day) setDay(d.today)
      const f = await api<{ tables: FTable[]; sections: Section[] }>('GET', '/api/staff/floor')
      setTables(f.tables); setSections(f.sections); setErr('')
    } catch (e) { setErr(e instanceof ApiErr ? e.message : 'Offline. Retrying…') }
  }, [day])
  useLive(load, 15000)

  const live = list.filter((r) => !['cancelled', 'no_show'].includes(r.status))
  const covers = live.reduce((a, r) => a + r.partySize, 0)
  const unassigned = live.filter((r) => !r.tableId && ['pending', 'confirmed'].includes(r.status))
  const range = useMemo(() => {
    const starts = live.map((r) => minutes(r.time))
    const lo = Math.min(11 * 60, ...starts.map((m) => Math.floor(m / 60) * 60))
    const hi = Math.max(23 * 60, ...starts.map((m) => Math.ceil((m + 120) / 60) * 60))
    return { lo, hi: Math.min(hi, 26 * 60) }
  }, [live])
  const span = range.hi - range.lo
  const hours = Array.from({ length: span / 60 + 1 }, (_, i) => range.lo + i * 60)
  const fresh = open ? list.find((r) => r.id === open.id) ?? open : null

  return (
    <div className="resv themed">
      <div className="ad-head floor-head">
        <h1>Reservations</h1>
        <div className="resv-nav">
          <button type="button" className="ui-icon-btn" onClick={() => day && setDay(shiftDay(day, -1))} aria-label="Previous day"><ChevronLeft size={18} /></button>
          <input type="date" className="ui-input" value={day ?? ''} onChange={(e) => e.target.value && setDay(e.target.value)} aria-label="Day" />
          <button type="button" className="ui-icon-btn" onClick={() => day && setDay(shiftDay(day, 1))} aria-label="Next day"><ChevronRight size={18} /></button>
          {day !== today && <button type="button" className="ui-btn sm ghost" onClick={() => setDay(today)}>Today</button>}
        </div>
        <button type="button" className="ui-btn primary" onClick={() => setForm('new')}><CalendarPlus size={16} /> New booking</button>
      </div>
      {day && <p className="resv-day">{prettyDay(day)}</p>}
      {err && <p className="ui-alert warning">{err}</p>}

      <div className="resv-stats">
        <div><b className="ui-num">{live.length}</b><span>bookings</span></div>
        <div><b className="ui-num">{covers}</b><span>guests</span></div>
        <div className={unassigned.length ? 'warn' : ''}><b className="ui-num">{unassigned.length}</b><span>without a table</span></div>
        <div className={live.some((r) => r.status === 'pending') ? 'warn' : ''}><b className="ui-num">{live.filter((r) => r.status === 'pending').length}</b><span>to confirm</span></div>
      </div>

      <section className="ui-card resv-timeline" aria-label="Timeline">
        <div className="resv-grid" style={{ '--cols': span } as React.CSSProperties}>
          <div className="resv-corner" />
          <div className="resv-hours">
            {hours.map((h) => <span key={h} style={{ left: `${((h - range.lo) / span) * 100}%` }}>{String(Math.floor(h / 60) % 24).padStart(2, '0')}:00</span>)}
          </div>
          {tables.map((t) => (
            <div key={t.id} className="resv-row">
              <div className="resv-table"><b>{t.number}</b><small>{t.capacity} · {t.section ?? '—'}</small></div>
              <div className="resv-track">
                {live.filter((r) => r.tableId === t.id).map((r) => {
                  const left = ((minutes(r.time) - range.lo) / span) * 100
                  const width = ((new Date(r.endsAt).getTime() - new Date(r.startsAt).getTime()) / 60000 / span) * 100
                  return (
                    <button key={r.id} type="button" className={`resv-block s-${r.status}`} style={{ left: `${left}%`, width: `${width}%` }} onClick={() => setOpen(r)}
                      aria-label={`${r.name}, ${r.partySize} guests at ${r.time}, ${STATUS_LABEL[r.status]}`}>
                      <b>{r.name}</b><small>{r.time} · {r.partySize}</small>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="resv-list" aria-label="All bookings">
        {!list.length && <p className="ui-muted resv-empty">No bookings for this day.</p>}
        {list.map((r) => (
          <button key={r.id} type="button" className={`resv-item s-${r.status}`} onClick={() => setOpen(r)}>
            <span className="resv-time ui-num">{r.time}</span>
            <span className="resv-who"><b>{r.name}</b><small>{r.partySize} guests · {r.tableNumber ? `Table ${r.tableNumber}` : 'No table yet'}{r.occasion ? ` · ${r.occasion}` : ''}</small></span>
            <span className={`resv-pill s-${r.status}`}>{STATUS_LABEL[r.status]}</span>
          </button>
        ))}
      </section>

      {fresh && <Detail r={fresh} onClose={() => setOpen(null)} onEdit={() => { setForm(fresh); setOpen(null) }} onChanged={load} />}
      {form && <BookingForm init={form === 'new' ? { date: day ?? today } : form} tables={tables} sections={sections} onClose={() => setForm(null)} onSaved={() => { setForm(null); void load() }} />}
    </div>
  )
}

function Detail({ r, onClose, onEdit, onChanged }: { r: Res; onClose: () => void; onEdit: () => void; onChanged: () => Promise<void> }) {
  const [err, setErr] = useState('')
  const [asking, setAsking] = useState<Res['status'] | null>(null)
  const [reason, setReason] = useState('')
  const [hist, setHist] = useState<Array<{ from: string | null; to: string; by: string; note: string; at: string }> | null>(null)
  const go = async (to: Res['status'], why = '') => {
    setErr('')
    try { await api('POST', `/api/staff/reservations/${r.id}/status`, { to, reason: why }); setAsking(null); setReason(''); await onChanged() }
    catch (e) { setErr(e instanceof ApiErr ? e.message : 'Failed') }
  }
  return (
    <div className="ui-overlay floor-drawer-wrap" onClick={onClose}>
      <aside className="floor-drawer" role="dialog" aria-modal="true" aria-label={`Booking ${r.code}`} onClick={(e) => e.stopPropagation()}>
        <header>
          <div><span className="ui-hint">Booking {r.code} · {r.source}</span><h2>{r.name}</h2><span className={`resv-pill s-${r.status}`}>{STATUS_LABEL[r.status]}</span></div>
          <button type="button" className="ui-icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>
        <dl className="floor-facts">
          <div><dt>When</dt><dd>{r.time}</dd></div>
          <div><dt>Guests</dt><dd>{r.partySize}</dd></div>
          <div><dt>Table</dt><dd>{r.tableNumber ?? 'Not assigned'}</dd></div>
          <div><dt>Seating</dt><dd>{r.section ?? 'Any'}</dd></div>
        </dl>
        <p className="resv-contact"><Phone size={15} /> <a href={`tel:${r.phone}`}>{r.phone}</a>{r.email && <> · {r.email}</>}</p>
        {r.occasion && <p className="resv-note"><Cake size={15} /> {r.occasion}</p>}
        {r.requests && <p className="resv-note"><MessageSquare size={15} /> {r.requests}</p>}
        {r.notes && <p className="resv-note internal">Staff note: {r.notes}</p>}
        {r.cancelReason && <p className="ui-hint">Reason: {r.cancelReason}</p>}
        {err && <p className="ui-alert danger">{err}</p>}
        {asking ? (
          <div className="floor-actions">
            <label className="ui-label">Reason<input className="ui-input" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></label>
            <button type="button" className="ui-btn danger" disabled={!reason.trim()} onClick={() => go(asking, reason)}>Cancel booking</button>
            <button type="button" className="ui-btn ghost" onClick={() => setAsking(null)}>Keep it</button>
          </div>
        ) : (
          <div className="floor-actions">
            {ACTIONS[r.status].map((a) => (
              <button key={a.to} type="button" className={`ui-btn ${a.primary ? 'primary' : a.ask ? 'danger' : ''}`} onClick={() => (a.ask ? setAsking(a.to) : go(a.to))}>{a.label}</button>
            ))}
            {['pending', 'confirmed', 'seated'].includes(r.status) && <button type="button" className="ui-btn ghost" onClick={onEdit}>Change time, party or table</button>}
          </div>
        )}
        <button type="button" className="ui-btn sm ghost" onClick={async () => setHist((await api<{ history: NonNullable<typeof hist> }>('GET', `/api/staff/reservations/${r.id}`)).history)}>History</button>
        {hist && (
          <ul className="resv-hist">
            {hist.map((h, i) => <li key={i}><b>{h.to.replace('_', ' ')}</b> · {h.by} · {new Date(h.at).toLocaleString('en-GB')}{h.note && <small>{h.note}</small>}</li>)}
          </ul>
        )}
      </aside>
    </div>
  )
}

function BookingForm({ init, tables, sections, onClose, onSaved }: { init: Partial<Res>; tables: FTable[]; sections: Section[]; onClose: () => void; onSaved: () => void }) {
  const editing = !!init.id
  const [f, setF] = useState({
    name: init.name ?? '', phone: init.phone ?? '', email: init.email ?? '', partySize: init.partySize ?? 2, date: init.date ?? '', time: init.time ?? '19:00',
    tableId: init.tableId ?? null as number | null, sectionId: init.sectionPref ?? null as number | null, occasion: init.occasion ?? '', requests: init.requests ?? '', notes: init.notes ?? '',
    source: 'phone' as 'phone' | 'walk_in' | 'staff',
  })
  const [key] = useState(newKey)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value })
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('')
    const payload = { ...f, partySize: Number(f.partySize), tableId: f.tableId ? Number(f.tableId) : null, sectionId: f.sectionId ? Number(f.sectionId) : null }
    try {
      if (editing) await api('PATCH', `/api/staff/reservations/${init.id}`, payload)
      else await api('POST', '/api/staff/reservations', { ...payload, idempotencyKey: key })
      onSaved()
    } catch (x) { setErr(x instanceof ApiErr ? x.message : 'Not saved') } finally { setBusy(false) }
  }
  return (
    <div className="ui-overlay" onClick={onClose}>
      <form className="ui-dialog" style={{ width: 'min(620px,100%)' }} onClick={(e) => e.stopPropagation()} onSubmit={save} aria-label={editing ? 'Edit booking' : 'New booking'}>
        <header><h2>{editing ? `Edit booking ${init.code}` : 'New booking'}</h2><button type="button" className="ui-icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button></header>
        <div className="ui-dialog-body resv-form">
          <label className="ui-label">Name<input className="ui-input" required minLength={2} value={f.name} onChange={set('name')} /></label>
          <label className="ui-label">Phone<input className="ui-input" required inputMode="tel" value={f.phone} onChange={set('phone')} /></label>
          <label className="ui-label">Guests<input className="ui-input" type="number" min={1} max={100} required value={f.partySize} onChange={set('partySize')} /></label>
          <label className="ui-label">Email<input className="ui-input" type="email" value={f.email} onChange={set('email')} /></label>
          <label className="ui-label">Date<input className="ui-input" type="date" required value={f.date} onChange={set('date')} /></label>
          <label className="ui-label">Time<input className="ui-input" type="time" required step={300} value={f.time} onChange={set('time')} /></label>
          <label className="ui-label">Table
            <select className="ui-select" value={f.tableId ?? ''} onChange={(e) => setF({ ...f, tableId: e.target.value ? Number(e.target.value) : null })}>
              <option value="">{editing ? 'Keep or find automatically' : 'Pick automatically'}</option>
              {tables.map((t) => <option key={t.id} value={t.id} disabled={t.capacity < Number(f.partySize)}>Table {t.number} · {t.capacity} seats{t.section ? ` · ${t.section}` : ''}</option>)}
            </select>
          </label>
          <label className="ui-label">Seating preference
            <select className="ui-select" value={f.sectionId ?? ''} onChange={(e) => setF({ ...f, sectionId: e.target.value ? Number(e.target.value) : null })}>
              <option value="">Any</option>{sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="ui-label">Occasion
            <select className="ui-select" value={f.occasion} onChange={set('occasion')}>{OCCASIONS.map((o) => <option key={o} value={o}>{o || 'None'}</option>)}</select>
          </label>
          {!editing && (
            <label className="ui-label">Taken by
              <select className="ui-select" value={f.source} onChange={set('source')}><option value="phone">Phone</option><option value="walk_in">Walk-in</option><option value="staff">Other</option></select>
            </label>
          )}
          <label className="ui-label wide">Guest requests<textarea className="ui-textarea" rows={2} value={f.requests} onChange={set('requests')} /></label>
          <label className="ui-label wide">Staff note (not shown to the guest)<textarea className="ui-textarea" rows={2} value={f.notes} onChange={set('notes')} /></label>
          {err && <p className="ui-alert danger wide" role="alert">{err}</p>}
        </div>
        <div className="ui-dialog-foot">
          <button type="button" className="ui-btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="ui-btn primary" style={{ marginInlineStart: 'auto' }} disabled={busy}>{editing ? 'Save changes' : 'Book'}</button>
        </div>
      </form>
    </div>
  )
}
