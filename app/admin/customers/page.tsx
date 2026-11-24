'use client'

import { useCallback, useEffect, useState } from 'react'
import { Cake, Download, Plus, Search, Star, X, ShieldAlert } from 'lucide-react'
import { api, ApiErr, agoText, clock } from '@/components/staff/api'
import { useLive, useMe } from '@/components/staff/shell'
import { can } from '@/lib/permissions'
import { formatMoney } from '@/lib/money'

type Card = { id: number; name: string; phone: string | null; email?: string; tier: string; points: number; visits: number; spend?: number; lastVisit: string | null; notes: string; preferences: string; birthdaySoon: boolean; marketingConsent?: boolean }
type Profile = Card & {
  birthday?: string | null; consentAt?: string | null; source: string; since: string; nextTier: { name: string; spendToGo: number } | null; averageOrder?: number; pointsValue: number
  favourites: Array<{ name: string; qty: number }>
  orders: Array<{ id: string; label: string; at: string; type: string; table: string; total?: number; status: string; paymentStatus: string; earned: number; used: number }>
  reservations: Array<{ code: string; at: string; partySize: number; status: string; occasion: string }>
  ledger: Array<{ kind: string; points: number; balance: number; reason: string; at: string; by: string | null }>
  feedback: Array<{ rating: number; comment: string; at: string }>
}
type Loyalty = { enabled: boolean; earnPer: number; pointValue: number; minRedeem: number; maxRedeemPercent: number; tiers: Array<{ name: string; minSpend: number; multiplier: number }> }
type Fb = { id: number; rating: number; comment: string; name: string; source: string; status: 'pending' | 'published' | 'hidden'; reply: string; at: string; order: string | null; table: string | null }

const m = (n: number) => formatMoney(n, 'IQD')
const stars = (n: number) => '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n)

export default function CustomersPage() {
  const { me } = useMe()
  const [tab, setTab] = useState<'customers' | 'feedback' | 'programme'>('customers')
  const manage = can(me.role, 'customers.manage')
  return (
    <div className="crm themed">
      <div className="ad-head fin-head">
        <h1>Customers</h1>
        {manage && <a className="ui-btn" href="/api/admin/customers/marketing" download style={{ marginInlineStart: 'auto' }}><Download size={16} /> Opted-in list</a>}
      </div>
      <nav className="pos-tabs" role="tablist" aria-label="Customers">
        <button type="button" role="tab" aria-selected={tab === 'customers'} onClick={() => setTab('customers')}>Customers</button>
        {manage && <button type="button" role="tab" aria-selected={tab === 'feedback'} onClick={() => setTab('feedback')}>Feedback</button>}
        {can(me.role, 'settings.manage') && <button type="button" role="tab" aria-selected={tab === 'programme'} onClick={() => setTab('programme')}>Loyalty programme</button>}
      </nav>
      {tab === 'customers' && <CustomersTab />}
      {tab === 'feedback' && <FeedbackTab />}
      {tab === 'programme' && <ProgrammeTab />}
    </div>
  )
}

function CustomersTab() {
  const { me } = useMe()
  const manage = can(me.role, 'customers.manage')
  const [q, setQ] = useState('')
  const [list, setList] = useState<Card[]>([])
  const [birthdays, setBirthdays] = useState<Array<{ id: number; name: string; day: string; consent: boolean }>>([])
  const [open, setOpen] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  const [err, setErr] = useState('')
  const load = useCallback(async () => {
    try {
      const d = await api<{ customers: Card[]; birthdays: typeof birthdays }>('GET', `/api/admin/customers?q=${encodeURIComponent(q)}`)
      setList(d.customers); setBirthdays(d.birthdays); setErr('')
    } catch (e) { setErr(e instanceof ApiErr ? e.message : 'Offline') }
  }, [q])
  useEffect(() => { const t = window.setTimeout(() => void load(), 200); return () => window.clearTimeout(t) }, [load])

  return (
    <>
      <div className="inv-bar">
        <div className="pos-search"><Search size={18} aria-hidden /><input className="ui-input" placeholder="Name or phone (last digits work)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search customers" /></div>
        {manage && <button type="button" className="ui-btn primary" onClick={() => setCreating(true)}><Plus size={16} /> Customer</button>}
      </div>
      {err && <p className="ui-alert warning">{err}</p>}
      {birthdays.length > 0 && (
        <p className="crm-bdays"><Cake size={16} /> Birthdays this week: {birthdays.map((b, i) => <button key={b.id} type="button" onClick={() => setOpen(b.id)}>{b.name} ({b.day.slice(3)}/{b.day.slice(0, 2)}){i < birthdays.length - 1 ? ',' : ''}</button>)}
          <span className="ui-hint"> · only contact those who opted in to messages</span></p>
      )}
      <div className="ui-card pos-table-wrap">
        <table className="pos-table">
          <thead><tr><th>Customer</th><th>Phone</th><th>Tier</th><th className="num">Points</th><th className="num">Visits</th>{manage && <th className="num">Spent</th>}<th>Last visit</th></tr></thead>
          <tbody>
            {list.map((c) => (
              <tr key={c.id} className="crm-row" onClick={() => setOpen(c.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpen(c.id)}>
                <td><b>{c.name}</b>{c.birthdaySoon && <Cake size={14} className="tone-warning" aria-label="birthday this week" />}{(c.notes || c.preferences) && <small className="crm-note">{[c.preferences, c.notes].filter(Boolean).join(' · ')}</small>}</td>
                <td className="crm-phone">{c.phone}</td>
                <td><span className="ui-pill">{c.tier}</span></td>
                <td className="num">{c.points.toLocaleString('en-US')}</td>
                <td className="num">{c.visits}</td>
                {manage && <td className="num">{m(c.spend ?? 0)}</td>}
                <td>{c.lastVisit ? agoText(c.lastVisit) : '—'}</td>
              </tr>
            ))}
            {!list.length && <tr><td colSpan={7} className="ui-muted" style={{ textAlign: 'center', padding: 28 }}>{q ? 'No customer matches.' : 'Customers appear here from bookings, the POS, or when you add them.'}</td></tr>}
          </tbody>
        </table>
      </div>
      {open !== null && <ProfileDrawer id={open} onClose={() => setOpen(null)} onChanged={load} />}
      {creating && <CreateDialog onClose={() => setCreating(false)} onDone={(id) => { setCreating(false); void load(); setOpen(id) }} />}
    </>
  )
}

function ProfileDrawer({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => Promise<void> }) {
  const { me } = useMe()
  const manage = can(me.role, 'customers.manage')
  const manager = can(me.role, 'orders.override')
  const [c, setC] = useState<Profile | null>(null)
  const [edit, setEdit] = useState<Record<string, unknown> | null>(null)
  const [adjust, setAdjust] = useState({ points: '', reason: '' })
  const [forgetting, setForgetting] = useState(false)
  const [err, setErr] = useState('')
  const load = useCallback(async () => {
    try { setC((await api<{ customer: Profile }>('GET', `/api/admin/customers/${id}`)).customer); setErr('') } catch (e) { setErr(e instanceof ApiErr ? e.message : 'Could not load') }
  }, [id])
  useEffect(() => { void load() }, [load])
  const act = async (fn: () => Promise<unknown>) => { setErr(''); try { await fn(); await load(); await onChanged() } catch (e) { setErr(e instanceof ApiErr ? e.message : 'Failed') } }

  return (
    <div className="ui-overlay floor-drawer-wrap" onClick={onClose}>
      <aside className="floor-drawer crm-drawer" role="dialog" aria-modal="true" aria-label={c?.name ?? 'Customer'} onClick={(e) => e.stopPropagation()}>
        <header>
          <div>
            <span className="ui-hint">{c ? `Since ${new Date(c.since).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })} · from ${c.source}` : ''}</span>
            <h2>{c?.name ?? '…'}</h2>
            {c && <span className="ui-pill accent">{c.tier}</span>}
          </div>
          <button type="button" className="ui-icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>
        {err && <p className="ui-alert danger">{err}</p>}
        {c && (
          <>
            <dl className="floor-facts">
              <div><dt>Points</dt><dd>{c.points.toLocaleString('en-US')} <small className="ui-hint">= {m(c.pointsValue)}</small></dd></div>
              <div><dt>Visits</dt><dd>{c.visits}</dd></div>
              {manage && <div><dt>Spent</dt><dd>{m(c.spend ?? 0)}</dd></div>}
              {manage && <div><dt>Average order</dt><dd>{m(c.averageOrder ?? 0)}</dd></div>}
            </dl>
            {c.nextTier && <p className="ui-hint">{m(c.nextTier.spendToGo)} more to reach {c.nextTier.name}.</p>}
            {(c.preferences || c.notes) && <p className="resv-note internal"><ShieldAlert size={15} /> {[c.preferences, c.notes].filter(Boolean).join(' · ')}</p>}
            {c.favourites.length > 0 && <p className="crm-favs">Usually orders: {c.favourites.map((f) => `${f.name} (${f.qty})`).join(', ')}</p>}

            {manage && !edit && (
              <section className="crm-sec">
                <h3>Contact</h3>
                <p>{c.phone}{c.email ? ` · ${c.email}` : ''}{c.birthday ? ` · born ${c.birthday}` : ''}</p>
                <p className="ui-hint">{c.marketingConsent ? `Agreed to messages on ${new Date(c.consentAt!).toLocaleDateString('en-GB')}` : 'Has not agreed to marketing messages'}</p>
                <button type="button" className="ui-btn sm" onClick={() => setEdit({ name: c.name, phone: c.phone, email: c.email ?? '', birthday: c.birthday ?? '', preferences: c.preferences, notes: c.notes, marketingConsent: !!c.marketingConsent })}>Edit details</button>
              </section>
            )}
            {edit && (
              <form className="crm-sec crm-form" onSubmit={async (e) => { e.preventDefault(); await act(() => api('PATCH', `/api/admin/customers/${id}`, { ...edit, birthday: edit.birthday || null })); setEdit(null) }}>
                {(['name', 'phone', 'email'] as const).map((k) => <label key={k} className="ui-label">{k[0].toUpperCase() + k.slice(1)}<input className="ui-input" value={String(edit[k] ?? '')} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} /></label>)}
                <label className="ui-label">Birthday<input className="ui-input" type="date" value={String(edit.birthday ?? '')} onChange={(e) => setEdit({ ...edit, birthday: e.target.value })} /></label>
                <label className="ui-label">Allergies and preferences<input className="ui-input" value={String(edit.preferences ?? '')} onChange={(e) => setEdit({ ...edit, preferences: e.target.value })} placeholder="Shown to waiters and the POS" /></label>
                <label className="ui-label">Notes<textarea className="ui-textarea" rows={2} value={String(edit.notes ?? '')} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></label>
                <label className="inv-check"><input type="checkbox" checked={!!edit.marketingConsent} onChange={(e) => setEdit({ ...edit, marketingConsent: e.target.checked })} /> The guest agreed to receive offers (ask them first)</label>
                <div className="crm-row-actions"><button type="button" className="ui-btn" onClick={() => setEdit(null)}>Cancel</button><button type="submit" className="ui-btn primary">Save</button></div>
              </form>
            )}

            <section className="crm-sec">
              <h3>Orders</h3>
              <ul className="fin-list">
                {c.orders.map((o) => (
                  <li key={o.id}><span><b>{o.label}</b><small>{new Date(o.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} {clock(o.at)} · {o.table ? `Table ${o.table}` : o.type.replace('_', '-')} · {o.status}{o.earned ? ` · +${o.earned} pts` : ''}{o.used ? ` · used ${o.used} pts` : ''}</small></span>{o.total !== undefined && <span className="num">{m(o.total)}</span>}</li>
                ))}
                {!c.orders.length && <li className="ui-muted">No orders yet.</li>}
              </ul>
            </section>
            {c.reservations.length > 0 && (
              <section className="crm-sec"><h3>Bookings</h3>
                <ul className="fin-list">{c.reservations.map((r) => <li key={r.code}><span><b>{new Date(r.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</b><small>{r.partySize} guests · {r.status.replace('_', '-')}{r.occasion ? ` · ${r.occasion}` : ''}</small></span><span className="ui-hint">{r.code}</span></li>)}</ul>
              </section>
            )}
            {c.feedback.length > 0 && (
              <section className="crm-sec"><h3>Feedback</h3>
                <ul className="fin-list">{c.feedback.map((f, i) => <li key={i}><span><b aria-label={`${f.rating} of 5`}>{stars(f.rating)}</b><small>{f.comment || 'No comment'}</small></span></li>)}</ul>
              </section>
            )}
            <section className="crm-sec">
              <h3>Points history</h3>
              <ul className="fin-list">
                {c.ledger.map((t, i) => <li key={i}><span><b>{t.kind}</b><small>{t.reason}{t.by ? ` · ${t.by}` : ''} · {agoText(t.at)}</small></span><span className={`num ${t.points < 0 ? 'tone-danger' : ''}`}>{t.points > 0 ? '+' : ''}{t.points}</span></li>)}
                {!c.ledger.length && <li className="ui-muted">No points yet.</li>}
              </ul>
              {manager && (
                <form className="crm-adjust" onSubmit={async (e) => { e.preventDefault(); await act(() => api('POST', `/api/admin/customers/${id}/points`, { points: Number(adjust.points), reason: adjust.reason })); setAdjust({ points: '', reason: '' }) }}>
                  <input className="ui-input" inputMode="numeric" placeholder="+/− points" value={adjust.points} onChange={(e) => setAdjust({ ...adjust, points: e.target.value.replace(/[^\d-]/g, '') })} aria-label="Points" />
                  <input className="ui-input" placeholder="Reason" value={adjust.reason} onChange={(e) => setAdjust({ ...adjust, reason: e.target.value })} aria-label="Reason" />
                  <button type="submit" className="ui-btn sm" disabled={!adjust.points || !adjust.reason.trim()}>Adjust</button>
                </form>
              )}
            </section>
            {manager && (
              <section className="crm-sec crm-danger">
                {!forgetting ? <button type="button" className="ui-btn sm ghost" onClick={() => setForgetting(true)}>Forget this customer…</button> : (
                  <>
                    <p>Removes their name, phone, email, birthday and notes from every order and booking, and clears their points. Sales totals are kept. This cannot be undone.</p>
                    <div className="crm-row-actions"><button type="button" className="ui-btn" onClick={() => setForgetting(false)}>Keep</button>
                      <button type="button" className="ui-btn danger" onClick={async () => { await act(() => api('POST', `/api/admin/customers/${id}/forget`, {})); onClose() }}>Forget permanently</button></div>
                  </>
                )}
              </section>
            )}
          </>
        )}
      </aside>
    </div>
  )
}

function CreateDialog({ onClose, onDone }: { onClose: () => void; onDone: (id: number) => void }) {
  const [f, setF] = useState({ name: '', phone: '', email: '', preferences: '', marketingConsent: false })
  const [err, setErr] = useState('')
  return (
    <div className="ui-overlay" onClick={onClose}>
      <form className="ui-dialog" style={{ width: 'min(460px,100%)' }} onClick={(e) => e.stopPropagation()} aria-label="New customer"
        onSubmit={async (e) => { e.preventDefault(); setErr(''); try { onDone((await api<{ id: number }>('POST', '/api/admin/customers', f)).id) } catch (x) { setErr(x instanceof ApiErr ? x.message : 'Not saved') } }}>
        <header><h2>New customer</h2></header>
        <div className="ui-dialog-body" style={{ display: 'grid', gap: 12 }}>
          <label className="ui-label">Name<input className="ui-input" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label className="ui-label">Phone<input className="ui-input" required inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
          <label className="ui-label">Email<input className="ui-input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
          <label className="ui-label">Allergies and preferences<input className="ui-input" value={f.preferences} onChange={(e) => setF({ ...f, preferences: e.target.value })} /></label>
          <label className="inv-check"><input type="checkbox" checked={f.marketingConsent} onChange={(e) => setF({ ...f, marketingConsent: e.target.checked })} /> The guest agreed to receive offers</label>
          {err && <p className="ui-alert danger">{err}</p>}
        </div>
        <div className="ui-dialog-foot"><button type="button" className="ui-btn" onClick={onClose}>Cancel</button><button type="submit" className="ui-btn primary" style={{ marginInlineStart: 'auto' }}>Add</button></div>
      </form>
    </div>
  )
}

function FeedbackTab() {
  const [status, setStatus] = useState<'pending' | 'published' | 'hidden'>('pending')
  const [list, setList] = useState<Fb[]>([])
  const [summary, setSummary] = useState<{ count: number; average: number | null } | null>(null)
  const [reply, setReply] = useState<Record<number, string>>({})
  const load = useCallback(async () => {
    const d = await api<{ feedback: Fb[]; summary: { count: number; average: number | null } }>('GET', `/api/admin/feedback?status=${status}`)
    setList(d.feedback); setSummary(d.summary)
  }, [status])
  useLive(load, 30000)
  const set = async (id: number, b: Record<string, unknown>) => { await api('PATCH', '/api/admin/feedback', { id, ...b }); await load() }
  return (
    <>
      <div className="inv-bar">
        <div className="ui-seg" role="group" aria-label="Status">
          {(['pending', 'published', 'hidden'] as const).map((s) => <button key={s} type="button" aria-pressed={status === s} onClick={() => setStatus(s)}>{s[0].toUpperCase() + s.slice(1)}</button>)}
        </div>
        {summary && summary.count > 0 && <span className="ui-muted"><Star size={14} /> {summary.average} average from {summary.count} ratings (all of them, published or not)</span>}
      </div>
      <div className="crm-fb">
        {list.map((f) => (
          <article key={f.id} className="ui-card crm-fb-item">
            <header><b aria-label={`${f.rating} of 5`} className={f.rating <= 2 ? 'tone-danger' : ''}>{stars(f.rating)}</b><span>{f.name || 'Guest'}</span>
              <span className="ui-hint">{f.source === 'order' ? `${f.order}${f.table ? ` · Table ${f.table}` : ''}` : 'website'} · {agoText(f.at)}</span></header>
            <p>{f.comment || <span className="ui-hint">No comment, rating only.</span>}</p>
            {f.reply && <p className="crm-reply">Reply: {f.reply}</p>}
            <footer>
              {f.status !== 'published' && f.comment && <button type="button" className="ui-btn sm primary" onClick={() => set(f.id, { status: 'published' })}>Publish</button>}
              {f.status !== 'hidden' && <button type="button" className="ui-btn sm" onClick={() => set(f.id, { status: 'hidden' })}>Hide</button>}
              <input className="ui-input" placeholder="Public reply (optional)" value={reply[f.id] ?? ''} onChange={(e) => setReply({ ...reply, [f.id]: e.target.value })} aria-label="Reply" />
              <button type="button" className="ui-btn sm ghost" disabled={!reply[f.id]?.trim()} onClick={() => set(f.id, { reply: reply[f.id] })}>Save reply</button>
            </footer>
          </article>
        ))}
        {!list.length && <div className="inv-empty ui-card"><b>Nothing {status}</b><p className="ui-muted">Guests rate their order from the order page once it is served; website reviews arrive here too.</p></div>}
      </div>
    </>
  )
}

function ProgrammeTab() {
  const [l, setL] = useState<Loyalty | null>(null)
  const [saved, setSaved] = useState('')
  const [err, setErr] = useState('')
  useEffect(() => {
    api<{ settings: Record<string, unknown> }>('GET', '/api/admin/settings').then((d) => {
      const s = d.settings
      setL({ enabled: s.loyaltyEnabled as boolean, earnPer: s.loyaltyEarnPer as number, pointValue: s.loyaltyPointValue as number, minRedeem: s.loyaltyMinRedeem as number, maxRedeemPercent: s.loyaltyMaxRedeemPercent as number, tiers: s.loyaltyTiers as Loyalty['tiers'] })
    }).catch(() => {})
  }, [])
  if (!l) return null
  const back = l.earnPer ? Math.round((l.pointValue / l.earnPer) * 1000) / 10 : 0
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(''); setSaved('')
    try {
      await api('PUT', '/api/admin/settings', { loyaltyEnabled: l.enabled, loyaltyEarnPer: Number(l.earnPer), loyaltyPointValue: Number(l.pointValue), loyaltyMinRedeem: Number(l.minRedeem), loyaltyMaxRedeemPercent: Number(l.maxRedeemPercent),
        loyaltyTiers: l.tiers.map((t) => ({ name: t.name, minSpend: Number(t.minSpend), multiplier: Number(t.multiplier) })) })
      setSaved('Saved. New rules apply to the next payment.')
    } catch (x) { setErr(x instanceof ApiErr ? x.message : 'Not saved') }
  }
  const n = (k: keyof Loyalty) => (e: React.ChangeEvent<HTMLInputElement>) => setL({ ...l, [k]: e.target.value.replace(/[^\d.]/g, '') as unknown as number })
  return (
    <form className="ui-card fin-card crm-prog" onSubmit={save}>
      <label className="inv-check"><input type="checkbox" checked={l.enabled} onChange={(e) => setL({ ...l, enabled: e.target.checked })} /> Loyalty points are on</label>
      <div className="resv-form">
        <label className="ui-label">Spend per point (IQD)<input className="ui-input" inputMode="numeric" value={l.earnPer} onChange={n('earnPer')} /></label>
        <label className="ui-label">A point is worth (IQD)<input className="ui-input" inputMode="decimal" value={l.pointValue} onChange={n('pointValue')} /></label>
        <label className="ui-label">Smallest redemption (points)<input className="ui-input" inputMode="numeric" value={l.minRedeem} onChange={n('minRedeem')} /></label>
        <label className="ui-label">Points can pay up to (% of a bill)<input className="ui-input" inputMode="numeric" value={l.maxRedeemPercent} onChange={n('maxRedeemPercent')} /></label>
      </div>
      <p className="ui-hint">Guests get back about {back}% of what they spend, before tier bonuses.</p>
      <h3>Tiers (by lifetime spend)</h3>
      {l.tiers.map((t, i) => (
        <div key={i} className="inv-recipe-row crm-tier">
          <input className="ui-input" value={t.name} onChange={(e) => setL({ ...l, tiers: l.tiers.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} aria-label="Tier name" />
          <div className="inv-qty"><input className="ui-input" inputMode="numeric" disabled={i === 0} value={t.minSpend} onChange={(e) => setL({ ...l, tiers: l.tiers.map((x, j) => (j === i ? { ...x, minSpend: e.target.value.replace(/\D/g, '') as unknown as number } : x)) })} aria-label="From spend" /><span>IQD</span></div>
          <div className="inv-qty"><input className="ui-input" inputMode="decimal" value={t.multiplier} onChange={(e) => setL({ ...l, tiers: l.tiers.map((x, j) => (j === i ? { ...x, multiplier: e.target.value.replace(/[^\d.]/g, '') as unknown as number } : x)) })} aria-label="Points multiplier" /><span>×</span></div>
          <button type="button" className="ui-icon-btn" disabled={i === 0} onClick={() => setL({ ...l, tiers: l.tiers.filter((_, j) => j !== i) })} aria-label="Remove tier"><X size={15} /></button>
        </div>
      ))}
      <button type="button" className="ui-btn sm ghost" style={{ justifySelf: 'start' }} disabled={l.tiers.length >= 6} onClick={() => setL({ ...l, tiers: [...l.tiers, { name: 'New tier', minSpend: (l.tiers.at(-1)?.minSpend ?? 0) + 1000000, multiplier: 1 }] })}><Plus size={14} /> Tier</button>
      {err && <p className="ui-alert danger">{err}</p>}
      {saved && <p className="ui-alert success">{saved}</p>}
      <div className="inv-save"><button type="submit" className="ui-btn primary">Save programme</button></div>
    </form>
  )
}
