'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { CalendarCheck, Check, Copy, Minus, Plus } from 'lucide-react'
import { PublicShell, useT } from '@/components/reserve/shell'
import { LOCALE } from '@/components/reserve/i18n'

type Options = { enabled: boolean; maxParty: number; maxDays: number; today: string; sections: Array<{ id: number; name: string }>; phone: string }
type Slot = { time: string; available: boolean }
type Booked = { reservation: { code: string; status: string; date: string; time: string; partySize: number; tableNumber: string | null }; manageToken: string }

const addDays = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`)

export default function ReservePage() {
  return <PublicShell><Reserve /></PublicShell>
}

function Reserve() {
  const { lang, t } = useT()
  const [opt, setOpt] = useState<Options | null>(null)
  const [party, setParty] = useState(2)
  const [date, setDate] = useState('')
  const [section, setSection] = useState<number | null>(null)
  const [slots, setSlots] = useState<Slot[] | null>(null)
  const [open, setOpen] = useState(true)
  const [time, setTime] = useState('')
  const [f, setF] = useState({ name: '', phone: '', email: '', occasion: '', requests: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState<Booked | null>(null)
  const [key, setKey] = useState(newKey)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    fetch('/api/reservations/options').then((r) => r.json()).then((o: Options) => { setOpt(o); setDate(o.today) }).catch(() => setErr('Offline'))
  }, [])
  useEffect(() => {
    if (!date || !opt?.enabled) return
    setSlots(null); setTime('')
    const q = new URLSearchParams({ date, party: String(party), ...(section ? { section: String(section) } : {}) })
    fetch(`/api/reservations/availability?${q}`).then((r) => r.json()).then((a) => { setSlots(a.slots ?? []); setOpen(a.open !== false) }).catch(() => setSlots([]))
  }, [date, party, section, opt?.enabled, reload])

  const days = useMemo(() => (opt ? Array.from({ length: 10 }, (_, i) => addDays(opt.today, i)) : []), [opt])
  const dayLabel = (d: string, i: number) => i === 0 ? t.today : i === 1 ? t.tomorrow
    : new Date(`${d}T12:00:00Z`).toLocaleDateString(LOCALE[lang], { weekday: 'short', day: 'numeric', timeZone: 'UTC' })

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!time) { setErr(t.pickTime); return }
    setBusy(true); setErr('')
    try {
      const r = await fetch('/api/reservations', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...f, partySize: party, date, time, sectionId: section, idempotencyKey: key }),
      })
      const d = await r.json()
      if (!r.ok) {
        setErr(d.error ?? 'Error')
        // That time just filled up: fetch fresh slots and use a new key for the next attempt.
        if (d.code === 'no_availability') { setKey(newKey()); setReload((n) => n + 1) }
        return
      }
      setDone(d)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch { setErr('Could not reach us. Check your connection and try again; you will not be booked twice.') }
    finally { setBusy(false) }
  }

  if (done) return <Confirmation b={done} />
  if (opt && !opt.enabled) return <main className="pub-main"><h1 className="pub-title">{t.title}</h1><p className="ui-alert warning">{t.unavailable}</p></main>

  return (
    <main className="pub-main">
      <p className="eyebrow dark"><span />{t.sub}</p>
      <h1 className="pub-title">{t.title}</h1>
      <form className="pub-card" onSubmit={submit}>
        <fieldset className="pub-step">
          <legend>{t.guests}</legend>
          <div className="pub-party">
            <button type="button" className="ui-icon-btn" disabled={party <= 1} onClick={() => setParty(party - 1)} aria-label="−"><Minus size={18} /></button>
            <output className="ui-num" aria-live="polite">{party}</output>
            <button type="button" className="ui-icon-btn" disabled={!opt || party >= opt.maxParty} onClick={() => setParty(party + 1)} aria-label="+"><Plus size={18} /></button>
            <span className="ui-hint">{opt && party >= opt.maxParty ? t.callUs : t.guestsN(party)}</span>
          </div>
        </fieldset>

        <fieldset className="pub-step">
          <legend>{t.date}</legend>
          <div className="pub-chips">
            {days.map((d, i) => <button key={d} type="button" aria-pressed={d === date} onClick={() => setDate(d)}>{dayLabel(d, i)}</button>)}
            <label className="pub-other">{t.otherDate}
              <input type="date" min={opt?.today} max={opt ? addDays(opt.today, opt.maxDays) : undefined} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
            </label>
          </div>
        </fieldset>

        {opt && opt.sections.length > 1 && (
          <fieldset className="pub-step">
            <legend>{t.seating}</legend>
            <div className="pub-chips">
              <button type="button" aria-pressed={section === null} onClick={() => setSection(null)}>{t.any}</button>
              {opt.sections.map((s) => <button key={s.id} type="button" aria-pressed={section === s.id} onClick={() => setSection(s.id)}>{s.name}</button>)}
            </div>
          </fieldset>
        )}

        <fieldset className="pub-step">
          <legend>{t.time}</legend>
          {!slots && <div className="pub-slots skeleton" aria-busy="true">{Array.from({ length: 8 }, (_, i) => <span key={i} />)}</div>}
          {slots && !open && <p className="ui-muted">{t.closed}</p>}
          {slots && open && !slots.some((s) => s.available) && <p className="ui-muted">{t.noTimes}</p>}
          {slots && slots.some((s) => s.available) && (
            <div className="pub-slots" role="radiogroup" aria-label={t.time}>
              {slots.map((s) => (
                <button key={s.time} type="button" role="radio" aria-checked={s.time === time} disabled={!s.available} onClick={() => setTime(s.time)}>{s.time}</button>
              ))}
            </div>
          )}
        </fieldset>

        <fieldset className="pub-step pub-details">
          <legend>{t.details}</legend>
          <label className="ui-label">{t.name}<input className="ui-input" required minLength={2} autoComplete="name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label className="ui-label">{t.phone}<input className="ui-input" required type="tel" autoComplete="tel" dir="ltr" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
          <label className="ui-label">{t.email}<input className="ui-input" type="email" autoComplete="email" dir="ltr" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
          <label className="ui-label">{t.occasion}
            <select className="ui-select" value={f.occasion} onChange={(e) => setF({ ...f, occasion: e.target.value })}>
              {Object.entries(t.occasions).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="ui-label wide">{t.requests}<textarea className="ui-textarea" rows={2} maxLength={500} placeholder={t.requestsPh} value={f.requests} onChange={(e) => setF({ ...f, requests: e.target.value })} /></label>
        </fieldset>

        {err && <p className="ui-alert danger" role="alert">{err}</p>}
        <button type="submit" className="button button-orange pub-submit" disabled={busy || !time}>
          <CalendarCheck size={18} /> {busy ? t.booking : time ? `${t.book} · ${time}` : t.pickTime}
        </button>
      </form>
    </main>
  )
}

function Confirmation({ b }: { b: Booked }) {
  const { lang, t } = useT()
  const [copied, setCopied] = useState(false)
  const link = typeof window !== 'undefined' ? `${window.location.origin}/reserve/${b.manageToken}` : ''
  const r = b.reservation
  return (
    <main className="pub-main">
      <div className="pub-card pub-done">
        <span className="pub-done-icon"><Check size={28} /></span>
        <h1 className="pub-title">{t.doneTitle}</h1>
        <p>{r.status === 'confirmed' ? t.confirmed : t.pending}</p>
        <dl className="pub-summary">
          <div><dt>{t.code}</dt><dd className="ui-num">{r.code}</dd></div>
          <div><dt>{t.date}</dt><dd>{new Date(`${r.date}T12:00:00Z`).toLocaleDateString(LOCALE[lang], { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })}</dd></div>
          <div><dt>{t.time}</dt><dd>{r.time}</dd></div>
          <div><dt>{t.guests}</dt><dd>{r.partySize}</dd></div>
        </dl>
        <p className="ui-hint">{t.keepLink}</p>
        <div className="pub-link">
          <code dir="ltr">{link}</code>
          <button type="button" className="ui-btn sm" onClick={() => { void navigator.clipboard?.writeText(link); setCopied(true) }}><Copy size={14} /> {copied ? t.copied : t.copy}</button>
        </div>
        <Link href="/" className="text-link">{t.back}</Link>
      </div>
    </main>
  )
}
