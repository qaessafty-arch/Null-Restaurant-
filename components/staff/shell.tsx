'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Flame, Menu, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react'
import { api, ApiErr, type Me } from './api'
import { can, type Permission } from '@/lib/permissions'
import { NotificationsMenu, ProfileMenu, QuickSearch, ThemeMenu, type Destination, type Note } from './chrome'

const MeCtx = createContext<{ me: Me; restaurant: string } | null>(null)
export const useMe = () => useContext(MeCtx)!

/** Re-run `fn` on server events and on a timer, so the UI stays correct even if the stream drops. */
export function useLive(fn: () => void, intervalMs = 8000) {
  const ref = useRef(fn)
  useEffect(() => { ref.current = fn })
  // A new fn (its inputs changed: a filter, a date, a period) fetches at once instead of at the next tick.
  // Callers pass a useCallback, so this runs only when those inputs change.
  const first = useRef(true)
  useEffect(() => {
    if (first.current) { first.current = false; return }
    fn()
  }, [fn])
  useEffect(() => {
    const run = () => ref.current()
    run()
    const iv = window.setInterval(run, intervalMs)
    let es: EventSource | null = null
    let debounce = 0
    try {
      es = new EventSource('/api/staff/events')
      const kick = () => { window.clearTimeout(debounce); debounce = window.setTimeout(run, 250) }
      for (const ev of ['order', 'request', 'notification', 'payment', 'table', 'reservation']) es.addEventListener(ev, kick)
    } catch { /* polling only */ }
    const vis = () => { if (document.visibilityState === 'visible') run() }
    document.addEventListener('visibilitychange', vis)
    return () => { window.clearInterval(iv); es?.close(); document.removeEventListener('visibilitychange', vis) }
  }, [intervalMs])
}

let audio: AudioContext | null = null
function beep() {
  try {
    audio ??= new AudioContext()
    const o = audio.createOscillator(), g = audio.createGain()
    o.type = 'sine'; o.frequency.value = 880; g.gain.value = 0.12
    o.connect(g); g.connect(audio.destination); o.start(); o.stop(audio.currentTime + 0.18)
  } catch { /* audio blocked until the user interacts */ }
}

type Toast = { id: number; title: string; body: string; kind: string }

type ShellProps = {
  perm: Permission | Permission[]
  title: string
  children: React.ReactNode
  wide?: boolean
  /** Admin frame: a sidebar (given a callback that closes it on phones), breadcrumbs and quick search. */
  sidebar?: (close: () => void) => React.ReactNode
  crumbs?: React.ReactNode
  search?: (me: Me) => Destination[]
}

const readFlag = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const writeFlag = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } }

export function StaffShell({ perm, title, children, wide = false, sidebar, crumbs, search }: ShellProps) {
  const perms = Array.isArray(perm) ? perm.join(',') : perm
  const router = useRouter()
  const [me, setMe] = useState<Me | null>(null)
  const [restaurant, setRestaurant] = useState('')
  const [sound, setSound] = useState(true)
  const [alerts, setAlerts] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [feed, setFeed] = useState<Note[]>([])
  const [seen, setSeen] = useState(0)
  const [navOpen, setNavOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const lastId = useRef<number | null>(null)

  useEffect(() => {
    api<{ staff: Me | null; restaurantName: string; soundAlerts: boolean }>('GET', '/api/staff/me').then((d) => {
      if (!d.staff) { router.replace(`/staff/login?next=${encodeURIComponent(location.pathname + location.search)}`); return }
      if (!perms.split(',').some((p) => can(d.staff!.role, p as Permission))) { router.replace('/staff'); return }
      const local = readFlag('staff-sound')
      setMe(d.staff); setRestaurant(d.restaurantName); setSound(local === null ? d.soundAlerts : local === '1')
    }).catch(() => router.replace('/staff/login'))
    setAlerts(typeof Notification !== 'undefined' && Notification.permission === 'granted')
    setSeen(Number(readFlag('staff-notes-seen') ?? 0))
    setCollapsed(readFlag('admin-nav') === 'rail')
  }, [router, perms])

  const poll = useCallback(async () => {
    if (!me) return
    try {
      const d = await api<{ notifications: Note[] }>('GET', `/api/staff/notifications?after=${lastId.current ?? 0}`)
      const list = d.notifications
      if (lastId.current === null) { lastId.current = list[0]?.id ?? 0; setFeed(list); return } // first load: list it, don't toast it
      const fresh = list.filter((n) => n.id > (lastId.current ?? 0)).reverse()
      if (!fresh.length) return
      lastId.current = list[0].id
      setFeed((f) => [...list, ...f.filter((x) => !list.some((n) => n.id === x.id))].slice(0, 40))
      setToasts((t) => [...t, ...fresh.map((n) => ({ id: n.id, title: n.title, body: n.body, kind: n.kind }))].slice(-4))
      if (sound) beep()
      if (alerts && document.visibilityState !== 'visible') fresh.forEach((n) => new Notification(n.title, { body: n.body }))
      window.setTimeout(() => setToasts((t) => t.filter((x) => !fresh.some((f) => f.id === x.id))), 7000)
    } catch (e) {
      if (e instanceof ApiErr && e.status === 401) router.replace('/staff/login')
    }
  }, [me, sound, alerts, router])
  useLive(poll, 6000)

  const logout = async () => { await api('POST', '/api/staff/logout'); router.replace('/staff/login') }
  const enableAlerts = async () => {
    beep()
    if (typeof Notification !== 'undefined') setAlerts((await Notification.requestPermission()) === 'granted')
  }
  const markSeen = (id: number) => { setSeen(id); writeFlag('staff-notes-seen', String(id)) }
  const toggleSound = (v: boolean) => { setSound(v); writeFlag('staff-sound', v ? '1' : '0'); if (v) beep() }
  const toggleRail = () => setCollapsed((c) => { writeFlag('admin-nav', c ? 'full' : 'rail'); return !c })
  const closeNav = useCallback(() => setNavOpen(false), [])

  if (!me) return <div className="st-boot" role="status"><span className="st-spinner" aria-hidden="true" />Loading…</div>
  const bar = (
    <header className="st-top">
      {sidebar && (
        <button type="button" className="ui-icon-btn st-menu-btn" onClick={() => setNavOpen(true)} aria-label="Open navigation"><Menu size={20} /></button>
      )}
      {sidebar
        ? <div className="st-crumbs">{crumbs}</div>
        : <Link href="/staff" className="st-brand"><span className="brand-mark sm" aria-hidden="true"><Flame size={14} fill="currentColor" /></span><b>{title}</b><small>{restaurant}</small></Link>}
      <div className="st-top-tools">
        {search && <QuickSearch items={search(me)} />}
        <NotificationsMenu items={feed} seen={seen} onSeen={markSeen} sound={sound} onSound={toggleSound} alerts={alerts} onAlerts={enableAlerts} />
        <ThemeMenu />
        <ProfileMenu me={me} restaurant={restaurant} onLogout={logout} />
      </div>
    </header>
  )
  const toastList = (
    <div className="st-toasts" aria-live="polite">
      {toasts.map((t) => <div key={t.id} className={`st-toast ${t.kind}`}><b>{t.title}</b>{t.body && <span>{t.body}</span>}</div>)}
    </div>
  )
  return (
    <MeCtx.Provider value={{ me, restaurant }}>
      {sidebar ? (
        <div className={`st-app ad-shell ${collapsed ? 'rail' : ''} ${navOpen ? 'nav-open' : ''}`}>
          <aside className="ad-side" aria-label="Main navigation">
            <div className="ad-side-head">
              <Link href="/admin" className="st-brand"><span className="brand-mark sm" aria-hidden="true"><Flame size={14} fill="currentColor" /></span><b>{restaurant || title}</b></Link>
              <button type="button" className="ui-icon-btn ad-rail-btn" onClick={toggleRail} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
                {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
              </button>
              <button type="button" className="ui-icon-btn ad-close-btn" onClick={closeNav} aria-label="Close navigation"><X size={20} /></button>
            </div>
            {sidebar(closeNav)}
          </aside>
          <div className="ad-scrim" onClick={closeNav} aria-hidden="true" />
          <div className="ad-col">
            {bar}
            {toastList}
            {children}
          </div>
        </div>
      ) : (
        <div className={`st-app ${wide ? 'wide' : ''}`}>
          {bar}
          {toastList}
          {children}
        </div>
      )}
    </MeCtx.Provider>
  )
}
