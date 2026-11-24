'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Bell, BellRing, Check, ChevronDown, LogOut, Monitor, Moon, Search, Sun, Volume2, VolumeX } from 'lucide-react'
import { getTheme, setTheme, type ThemePref } from '@/lib/theme'
import { ROLE_LABEL } from '@/lib/permissions'
import { agoText, type Me } from './api'

/** Close a popover on outside pointer-down or Escape. */
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const down = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close() }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('pointerdown', down)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('pointerdown', down); document.removeEventListener('keydown', key) }
  }, [open, close])
  return ref
}

function usePopover() {
  const [open, setOpen] = useState(false)
  const close = useMemo(() => () => setOpen(false), [])
  const ref = useDismiss(open, close)
  return { open, setOpen, close, ref }
}

const THEMES: Array<{ id: ThemePref; label: string; icon: typeof Sun }> = [
  { id: 'system', label: 'Match device', icon: Monitor },
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
]

export function ThemeMenu() {
  const p = usePopover()
  const [pref, setPref] = useState<ThemePref>('system')
  useEffect(() => setPref(getTheme()), [])
  const Icon = THEMES.find((t) => t.id === pref)!.icon
  return (
    <div className="tb-pop" ref={p.ref}>
      <button type="button" className="ui-icon-btn" aria-haspopup="menu" aria-expanded={p.open} aria-label="Appearance" title="Appearance" onClick={() => p.setOpen(!p.open)}><Icon size={18} /></button>
      {p.open && (
        <div className="tb-menu" role="menu" aria-label="Appearance">
          <p className="tb-menu-title">Appearance</p>
          {THEMES.map((t) => (
            <button key={t.id} type="button" role="menuitemradio" aria-checked={pref === t.id} onClick={() => { setTheme(t.id); setPref(t.id); p.close() }}>
              <t.icon size={16} /><span>{t.label}</span>{pref === t.id && <Check size={16} className="tb-check" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export type Note = { id: number; kind: string; title: string; body: string; created_at: string }

/** The staff notification feed (the same one that raises toasts), with unread tracked per device. */
export function NotificationsMenu({ items, seen, onSeen, sound, onSound, alerts, onAlerts }: {
  items: Note[]; seen: number; onSeen: (id: number) => void
  sound: boolean; onSound: (v: boolean) => void; alerts: boolean; onAlerts: () => void
}) {
  const p = usePopover()
  const unread = items.filter((n) => n.id > seen).length
  const toggle = () => {
    const next = !p.open
    p.setOpen(next)
    if (next && items[0]) onSeen(items[0].id)
  }
  return (
    <div className="tb-pop" ref={p.ref}>
      <button type="button" className="ui-icon-btn tb-bell" aria-haspopup="dialog" aria-expanded={p.open} aria-label={unread ? `Notifications, ${unread} new` : 'Notifications'} title="Notifications" onClick={toggle}>
        {unread ? <BellRing size={18} /> : <Bell size={18} />}
        {unread > 0 && <i>{unread > 9 ? '9+' : unread}</i>}
      </button>
      {p.open && (
        <div className="tb-menu tb-notes" role="dialog" aria-label="Notifications">
          <header>
            <p className="tb-menu-title">Notifications</p>
            <button type="button" className="ui-icon-btn" onClick={() => onSound(!sound)} aria-pressed={sound} title={sound ? 'Sound on' : 'Sound off'} aria-label={sound ? 'Turn sound off' : 'Turn sound on'}>
              {sound ? <Volume2 size={16} /> : <VolumeX size={16} />}
            </button>
          </header>
          {items.length === 0
            ? <p className="tb-empty">Nothing yet. New orders, requests and alerts for your role appear here.</p>
            : (
              <ul>
                {items.slice(0, 20).map((n) => (
                  <li key={n.id} className={n.id > seen ? 'new' : ''}>
                    <span className={`tb-dot ${n.kind}`} aria-hidden="true" />
                    <div><b>{n.title}</b>{n.body && <span>{n.body}</span>}<small>{agoText(n.created_at)}</small></div>
                  </li>
                ))}
              </ul>
            )}
          {!alerts && typeof Notification !== 'undefined' && (
            <button type="button" className="ui-btn sm block tb-enable" onClick={onAlerts}>Show alerts when this tab is in the background</button>
          )}
        </div>
      )}
    </div>
  )
}

export function ProfileMenu({ me, restaurant, onLogout }: { me: Me; restaurant: string; onLogout: () => void }) {
  const p = usePopover()
  const initials = me.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('')
  return (
    <div className="tb-pop" ref={p.ref}>
      <button type="button" className="tb-profile" aria-haspopup="menu" aria-expanded={p.open} onClick={() => p.setOpen(!p.open)}>
        <span className="tb-avatar" aria-hidden="true">{initials || '?'}</span>
        <span className="tb-profile-name">{me.name}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {p.open && (
        <div className="tb-menu end" role="menu">
          <div className="tb-who">
            <span className="tb-avatar lg" aria-hidden="true">{initials || '?'}</span>
            <div><b>{me.name}</b><small>{ROLE_LABEL[me.role] ?? me.role} · {restaurant}</small><small>@{me.username}</small></div>
          </div>
          <button type="button" role="menuitem" onClick={onLogout}><LogOut size={16} /><span>Sign out</span></button>
        </div>
      )}
    </div>
  )
}

export type Destination = { href: string; label: string; group: string; icon: typeof Sun }

/** Quick jump to any screen this person can open. Opens with ⌘K / Ctrl+K or the search field. */
export function QuickSearch({ items }: { items: Destination[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [i, setI] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen(true) } }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [])
  useEffect(() => { if (open) { setQ(''); setI(0); window.setTimeout(() => input.current?.focus(), 10) } }, [open])
  const hits = items.filter((d) => `${d.label} ${d.group}`.toLowerCase().includes(q.trim().toLowerCase()))
  const go = (d?: Destination) => { if (!d) return; setOpen(false); router.push(d.href) }
  return (
    <>
      <button type="button" className="tb-search" onClick={() => setOpen(true)} aria-label="Search screens">
        <Search size={15} aria-hidden="true" /><span>Search</span><kbd>⌘K</kbd>
      </button>
      {open && (
        <div className="ui-overlay tb-palette-wrap" onClick={() => setOpen(false)}>
          <div className="tb-palette" role="dialog" aria-modal="true" aria-label="Go to" onClick={(e) => e.stopPropagation()}>
            <label className="tb-palette-input">
              <Search size={18} aria-hidden="true" />
              <input ref={input} value={q} placeholder="Go to a screen…" aria-label="Go to a screen" role="combobox" aria-expanded="true" aria-controls="tb-hits"
                aria-activedescendant={hits[i] ? `tb-hit-${i}` : undefined}
                onChange={(e) => { setQ(e.target.value); setI(0) }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') { e.preventDefault(); setI((x) => Math.min(x + 1, hits.length - 1)) }
                  else if (e.key === 'ArrowUp') { e.preventDefault(); setI((x) => Math.max(x - 1, 0)) }
                  else if (e.key === 'Enter') { e.preventDefault(); go(hits[i]) }
                  else if (e.key === 'Escape') setOpen(false)
                }} />
            </label>
            <ul id="tb-hits" role="listbox">
              {hits.length === 0 && <li className="tb-empty">No screen matches “{q}”.</li>}
              {hits.map((d, k) => (
                <li key={d.href} id={`tb-hit-${k}`} role="option" aria-selected={k === i} onMouseEnter={() => setI(k)} onClick={() => go(d)}>
                  <d.icon size={16} aria-hidden="true" /><span>{d.label}</span><small>{d.group}</small>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  )
}
