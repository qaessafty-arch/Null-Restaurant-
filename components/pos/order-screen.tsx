'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Minus, Plus, Search, Trash2, X, Send, CreditCard } from 'lucide-react'
import { api, ApiErr } from '@/components/staff/api'
import { formatMoney } from '@/lib/money'
import type { Category, MenuItem, Quote } from '@/components/ordering/types'
import type { PosConfig } from './types'

type Line = { key: string; itemId: number; name: string; quantity: number; optionIds: number[]; optionNames: string[]; instructions: string; estUnit: number }
type OrderType = 'dine_in' | 'walk_in' | 'takeaway' | 'delivery'
const TYPES: Array<{ id: OrderType; label: string }> = [
  { id: 'dine_in', label: 'Table' }, { id: 'walk_in', label: 'Walk-in' }, { id: 'takeaway', label: 'Takeaway' }, { id: 'delivery', label: 'Delivery' },
]
const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`)

export function OrderScreen({ config, onCharge }: { config: PosConfig; onCharge: ((orderId: string) => void) | null }) {
  const [menu, setMenu] = useState<Category[]>([])
  const [cat, setCat] = useState<number | 'all'>('all')
  const [q, setQ] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [type, setType] = useState<OrderType>('walk_in')
  const [tableId, setTableId] = useState<number | ''>('')
  const [customer, setCustomer] = useState({ name: '', phone: '', address: '' })
  const [note, setNote] = useState('')
  const [quote, setQuote] = useState<Quote | null>(null)
  const [quoteErr, setQuoteErr] = useState('')
  const [picking, setPicking] = useState<MenuItem | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const key = useRef(newKey())
  const base = config.baseCurrency
  // Recognise a returning guest from their phone number (tier, points, allergies).
  const [known, setKnown] = useState<{ name: string; tier: string; points: number; visits: number; preferences: string; notes: string } | null>(null)
  useEffect(() => {
    const digits = customer.phone.replace(/\D/g, '')
    if (digits.length < 7) { setKnown(null); return }
    const t = window.setTimeout(() => {
      api<{ customers: Array<{ name: string; tier: string; points: number; visits: number; preferences: string; notes: string }> }>('GET', `/api/staff/customers?q=${encodeURIComponent(customer.phone)}`)
        .then((d) => {
          const c = d.customers.length === 1 ? d.customers[0] : null
          setKnown(c)
          if (c) setCustomer((x) => (x.name ? x : { ...x, name: c.name }))
        }).catch(() => setKnown(null))
    }, 300)
    return () => window.clearTimeout(t)
  }, [customer.phone])

  const loadMenu = () => api<{ categories: Category[] }>('GET', '/api/menu').then((d) => setMenu(d.categories)).catch(() => {})
  useEffect(() => { void loadMenu() }, [])

  // Server quote is the price; the tiles only show list prices.
  useEffect(() => {
    if (!lines.length) { setQuote(null); setQuoteErr(''); return }
    const t = window.setTimeout(() => {
      api<Quote>('POST', '/api/orders/quote', { lines: lines.map((l) => ({ itemId: l.itemId, quantity: l.quantity, optionIds: l.optionIds })) })
        .then((r) => { setQuote(r); setQuoteErr('') })
        .catch((e) => { setQuote(null); setQuoteErr(e instanceof ApiErr ? e.message : 'Could not price the order') })
    }, 200)
    return () => window.clearTimeout(t)
  }, [lines])

  const items = useMemo(() => {
    const all = menu.flatMap((c) => c.items)
    const needle = q.trim().toLowerCase()
    return (cat === 'all' ? all : menu.find((c) => c.id === cat)?.items ?? [])
      .filter((i) => !needle || i.name.en.toLowerCase().includes(needle) || i.name.ku.includes(needle) || i.name.ar.includes(needle))
  }, [menu, cat, q])

  const add = (item: MenuItem, optionIds: number[] = [], instructions = '', quantity = 1) => {
    const names = item.groups.flatMap((g) => g.options).filter((o) => optionIds.includes(o.id)).map((o) => o.name.en)
    const extra = item.groups.flatMap((g) => g.options).filter((o) => optionIds.includes(o.id)).reduce((a, o) => a + o.priceDelta, 0)
    setLines((ls) => {
      const same = ls.find((l) => l.itemId === item.id && l.instructions === instructions && l.optionIds.join() === [...optionIds].sort().join())
      if (same) return ls.map((l) => (l === same ? { ...l, quantity: Math.min(50, l.quantity + quantity) } : l))
      return [...ls, { key: newKey(), itemId: item.id, name: item.name.en, quantity, optionIds: [...optionIds].sort(), optionNames: names, instructions, estUnit: (item.offerPrice ?? item.price) + extra }]
    })
    key.current = newKey()
  }
  const tap = (item: MenuItem) => {
    if (!item.available) return
    const needsChoice = item.groups.some((g) => g.options.length > 0)
    if (needsChoice) setPicking(item)
    else add(item)
  }
  const setQty = (k: string, d: number) => { setLines((ls) => ls.flatMap((l) => (l.key !== k ? [l] : l.quantity + d <= 0 ? [] : [{ ...l, quantity: Math.min(50, l.quantity + d) }]))); key.current = newKey() }
  const clear = () => { setLines([]); setNote(''); setCustomer({ name: '', phone: '', address: '' }); setTableId(''); key.current = newKey() }

  const count = lines.reduce((a, l) => a + l.quantity, 0)
  // A quote for the current lines (it lags edits by a moment; until then show the list-price estimate).
  const fresh = !!quote && quote.lines.length === lines.length && quote.lines.every((ql, i) => ql.itemId === lines[i].itemId && ql.quantity === lines[i].quantity)
  const missing = type === 'dine_in' && !tableId ? 'Choose a table'
    : type === 'delivery' && (!customer.phone || !customer.address) ? 'Delivery needs a phone and an address' : ''

  const send = async (charge: boolean) => {
    if (!lines.length || missing || busy) return
    setBusy(true); setMsg(null)
    try {
      const r = await api<{ id: string; bill: { orders: Array<{ label: string }> } }>('POST', '/api/staff/pos/orders', {
        type, tableId: type === 'dine_in' ? tableId : null, note,
        customerName: customer.name, customerPhone: customer.phone, deliveryAddress: type === 'delivery' ? customer.address : '',
        lines: lines.map((l) => ({ itemId: l.itemId, quantity: l.quantity, optionIds: l.optionIds, instructions: l.instructions })),
        idempotencyKey: key.current,
      })
      setMsg({ kind: 'ok', text: `${r.bill.orders[0]?.label ?? 'Order'} sent to the kitchen` })
      clear()
      if (charge) onCharge?.(r.id)
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof ApiErr ? e.message : 'Not sent. Check the connection and try again; it will not be duplicated.' })
      if (e instanceof ApiErr && e.code === 'unavailable') void loadMenu()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pos-order">
      <section className="pos-menu" aria-label="Menu">
        <div className="pos-search">
          <Search size={18} aria-hidden />
          <input className="ui-input" placeholder="Search dishes" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search dishes" />
        </div>
        <div className="pos-cats" role="tablist" aria-label="Categories">
          <button type="button" role="tab" aria-selected={cat === 'all'} onClick={() => setCat('all')}>All</button>
          {menu.map((c) => <button key={c.id} type="button" role="tab" aria-selected={cat === c.id} onClick={() => setCat(c.id)}>{c.name.en}</button>)}
        </div>
        <div className="pos-grid">
          {items.map((i) => (
            <button key={i.id} type="button" className="pos-tile" disabled={!i.available} onClick={() => tap(i)}>
              {i.image ? <img src={i.image} alt="" loading="lazy" /> : <span className="pos-tile-ph" aria-hidden />}
              <span className="pos-tile-name">{i.name.en}</span>
              <span className="pos-tile-price">{i.available ? formatMoney(i.offerPrice ?? i.price, base) : 'Sold out'}</span>
            </button>
          ))}
          {!items.length && <p className="ui-muted pos-empty">{menu.length ? 'No dishes match.' : 'Loading menu…'}</p>}
        </div>
      </section>

      <aside className="pos-ticket" aria-label="Current order" id="pos-ticket">
        <div className="ui-seg" role="group" aria-label="Order type">
          {TYPES.filter((t) => t.id !== 'delivery' || config.deliveryEnabled).map((t) => (
            <button key={t.id} type="button" aria-pressed={type === t.id} onClick={() => { setType(t.id); key.current = newKey() }}>{t.label}</button>
          ))}
        </div>
        {type === 'dine_in' && (
          <select className="ui-select" value={tableId} onChange={(e) => setTableId(e.target.value ? Number(e.target.value) : '')} aria-label="Table">
            <option value="">Choose a table…</option>
            {config.tables.map((t) => <option key={t.id} value={t.id}>Table {t.number}{t.location ? ` · ${t.location}` : ''}</option>)}
          </select>
        )}
        {type === 'dine_in' && config.loyalty.enabled && (
          <input className="ui-input" placeholder="Loyalty phone (optional)" inputMode="tel" value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} aria-label="Loyalty phone" />
        )}
        {known && (
          <div className="pos-cust-lookup" role="status">
            <b>{known.name}</b><span>{known.tier} · {known.points.toLocaleString('en-US')} pts · {known.visits} visits</span>
            {(known.preferences || known.notes) && <small>{[known.preferences, known.notes].filter(Boolean).join(' · ')}</small>}
          </div>
        )}
        {type !== 'dine_in' && (
          <div className="pos-customer">
            <input className="ui-input" placeholder="Customer name" value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} />
            <input className="ui-input" placeholder={type === 'delivery' ? 'Phone (required)' : 'Phone'} inputMode="tel" value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} />
            {type === 'delivery' && <textarea className="ui-textarea" placeholder="Delivery address (required)" value={customer.address} onChange={(e) => setCustomer({ ...customer, address: e.target.value })} />}
          </div>
        )}

        <ul className="pos-lines">
          {lines.map((l, idx) => (
            <li key={l.key}>
              <div className="pos-line-main">
                <b>{l.name}</b>
                {l.optionNames.length > 0 && <small>{l.optionNames.join(' · ')}</small>}
                {l.instructions && <small className="pos-instr">“{l.instructions}”</small>}
              </div>
              <div className="pos-qty">
                <button type="button" className="ui-icon-btn" onClick={() => setQty(l.key, -1)} aria-label={`One less ${l.name}`}>{l.quantity === 1 ? <Trash2 size={16} /> : <Minus size={16} />}</button>
                <span className="ui-num">{l.quantity}</span>
                <button type="button" className="ui-icon-btn" onClick={() => setQty(l.key, 1)} aria-label={`One more ${l.name}`}><Plus size={16} /></button>
              </div>
              <span className="pos-line-price">{formatMoney(fresh ? quote!.lines[idx].lineTotal : l.estUnit * l.quantity, base)}</span>
            </li>
          ))}
          {!lines.length && <li className="pos-lines-empty">Tap dishes to add them.</li>}
        </ul>

        {lines.length > 0 && <textarea className="ui-textarea" placeholder="Note for the kitchen" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />}

        <dl className="pos-totals">
          {quote && quote.tax + quote.service > 0 && <div><dt>Subtotal</dt><dd>{formatMoney(quote.subtotal, base)}</dd></div>}
          {quote && quote.tax > 0 && <div><dt>Tax</dt><dd>{formatMoney(quote.tax, base)}</dd></div>}
          {quote && quote.service > 0 && <div><dt>Service</dt><dd>{formatMoney(quote.service, base)}</dd></div>}
          <div className="pos-total"><dt>Total</dt><dd className="ui-num">{quote ? formatMoney(quote.total, base) : lines.length ? '…' : formatMoney(0, base)}</dd></div>
        </dl>
        {quoteErr && <p className="ui-alert danger">{quoteErr}</p>}
        {msg && <p className={`ui-alert ${msg.kind === 'ok' ? 'success' : 'danger'}`} role="status">{msg.text}</p>}
        {missing && lines.length > 0 && <p className="ui-hint">{missing}</p>}
        <div className="pos-send">
          <button type="button" className="ui-btn lg" disabled={!lines.length || !!missing || !!quoteErr || busy} onClick={() => send(false)}><Send size={18} /> Send</button>
          {onCharge && <button type="button" className="ui-btn primary lg" disabled={!lines.length || !!missing || !!quoteErr || busy} onClick={() => send(true)}><CreditCard size={18} /> Send &amp; charge</button>}
        </div>
      </aside>

      {count > 0 && (
        <button type="button" className="pos-mobile-bar" onClick={() => document.getElementById('pos-ticket')?.scrollIntoView({ behavior: 'smooth' })}>
          {count} {count === 1 ? 'item' : 'items'} · Review order
          <b>{formatMoney(fresh ? quote!.total : lines.reduce((a, l) => a + l.estUnit * l.quantity, 0), base)}</b>
        </button>
      )}
      {picking && <OptionDialog item={picking} base={base} onClose={() => setPicking(null)} onAdd={(ids, instr, qty) => { add(picking, ids, instr, qty); setPicking(null) }} />}
    </div>
  )
}

function OptionDialog({ item, base, onClose, onAdd }: { item: MenuItem; base: string; onClose: () => void; onAdd: (ids: number[], instructions: string, qty: number) => void }) {
  const [picked, setPicked] = useState<Set<number>>(() => new Set(item.groups.flatMap((g) => g.options.filter((o) => o.isDefault && o.available).map((o) => o.id))))
  const [instructions, setInstructions] = useState('')
  const [qty, setQty] = useState(1)
  const toggle = (gId: number, oId: number) => {
    const g = item.groups.find((x) => x.id === gId)!
    setPicked((p) => {
      const n = new Set(p)
      if (g.kind === 'single') { g.options.forEach((o) => n.delete(o.id)); n.add(oId); return n }
      if (n.has(oId)) n.delete(oId)
      else if (g.options.filter((o) => n.has(o.id)).length < g.max) n.add(oId)
      return n
    })
  }
  const unit = (item.offerPrice ?? item.price) + item.groups.flatMap((g) => g.options).filter((o) => picked.has(o.id)).reduce((a, o) => a + o.priceDelta, 0)
  const unmet = item.groups.find((g) => (g.required || g.min > 0) && g.options.filter((o) => picked.has(o.id)).length < Math.max(1, g.min))

  return (
    <div className="ui-overlay" role="dialog" aria-modal="true" aria-label={item.name.en} onClick={onClose}>
      <div className="ui-dialog" onClick={(e) => e.stopPropagation()}>
        <header>
          <div><h2>{item.name.en}</h2><span className="ui-muted">{formatMoney(item.offerPrice ?? item.price, base)}</span></div>
          <button type="button" className="ui-icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>
        <div className="ui-dialog-body pos-opts">
          {item.groups.filter((g) => g.options.length).map((g) => (
            <fieldset key={g.id}>
              <legend>{g.name.en} <span className="ui-hint">{g.kind === 'single' ? 'choose one' : `up to ${g.max}`}{g.required ? ' · required' : ''}</span></legend>
              <div className="pos-opt-grid">
                {g.options.map((o) => (
                  <button key={o.id} type="button" aria-pressed={picked.has(o.id)} disabled={!o.available} onClick={() => toggle(g.id, o.id)}>
                    <span>{o.name.en}</span>{o.priceDelta !== 0 && <small>{o.priceDelta > 0 ? '+' : '−'}{formatMoney(Math.abs(o.priceDelta), base)}</small>}
                  </button>
                ))}
              </div>
            </fieldset>
          ))}
          <label className="ui-label">Instructions<input className="ui-input" value={instructions} maxLength={200} onChange={(e) => setInstructions(e.target.value)} placeholder="e.g. well done, no salt" /></label>
        </div>
        <div className="ui-dialog-foot">
          <div className="pos-qty">
            <button type="button" className="ui-icon-btn" disabled={qty <= 1} onClick={() => setQty(qty - 1)} aria-label="One less"><Minus size={16} /></button>
            <span className="ui-num">{qty}</span>
            <button type="button" className="ui-icon-btn" disabled={qty >= 50} onClick={() => setQty(qty + 1)} aria-label="One more"><Plus size={16} /></button>
          </div>
          <button type="button" className="ui-btn primary" style={{ marginInlineStart: 'auto' }} disabled={!!unmet} onClick={() => onAdd([...picked], instructions.trim(), qty)}>
            {unmet ? `Choose ${unmet.name.en}` : `Add · ${formatMoney(unit * qty, base)}`}
          </button>
        </div>
      </div>
    </div>
  )
}
