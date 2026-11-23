'use client'

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import { PublicShell, useT } from '@/components/reserve/shell'
import { LOCALE } from '@/components/reserve/i18n'

type R = { code: string; name: string; partySize: number; date: string; time: string; status: string; tableNumber: string | null; occasion: string; requests: string }

export default function ManageBooking({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  return <PublicShell><Manage token={token} /></PublicShell>
}

function Manage({ token }: { token: string }) {
  const { lang, t } = useT()
  const [r, setR] = useState<R | null>(null)
  const [missing, setMissing] = useState(false)
  const [asking, setAsking] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => {
    fetch(`/api/reservations/${encodeURIComponent(token)}`).then(async (x) => { if (!x.ok) { setMissing(true); return } setR((await x.json()).reservation) }).catch(() => setMissing(true))
  }, [token])
  const cancel = async () => {
    setErr('')
    const x = await fetch(`/api/reservations/${encodeURIComponent(token)}/cancel`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    const d = await x.json()
    if (!x.ok) { setErr(d.error ?? 'Error'); return }
    setR(d.reservation); setAsking(false)
  }
  if (missing) return <main className="pub-main"><p className="ui-alert warning">{t.notFound}</p><Link href="/reserve" className="pub-back">{t.title}</Link></main>
  if (!r) return <main className="pub-main"><p className="ui-muted">…</p></main>
  return (
    <main className="pub-main">
      <div className="pub-card pub-done">
        <h1 className="pub-title">{r.name}</h1>
        <span className={`resv-pill s-${r.status}`}>{t.status[r.status] ?? r.status}</span>
        <dl className="pub-summary">
          <div><dt>{t.code}</dt><dd className="ui-num">{r.code}</dd></div>
          <div><dt>{t.date}</dt><dd>{new Date(`${r.date}T12:00:00Z`).toLocaleDateString(LOCALE[lang], { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })}</dd></div>
          <div><dt>{t.time}</dt><dd>{r.time}</dd></div>
          <div><dt>{t.guests}</dt><dd>{r.partySize}</dd></div>
        </dl>
        {r.status === 'cancelled' && <p className="ui-muted">{t.cancelled}</p>}
        {err && <p className="ui-alert danger">{err}</p>}
        {['pending', 'confirmed'].includes(r.status) && (asking
          ? <div className="pub-confirm"><p>{t.cancelAsk}</p><button type="button" className="ui-btn danger" onClick={cancel}>{t.cancel}</button><button type="button" className="ui-btn ghost" onClick={() => setAsking(false)}>{t.back}</button></div>
          : <button type="button" className="ui-btn danger" onClick={() => setAsking(true)}>{t.cancel}</button>)}
        <Link href="/" className="pub-back">{t.back}</Link>
      </div>
    </main>
  )
}
