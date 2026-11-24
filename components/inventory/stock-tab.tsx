'use client'

import { useMemo, useState } from 'react'
import { Plus, Search, PackagePlus, Trash2, ClipboardCheck, SlidersHorizontal, Pencil, Archive } from 'lucide-react'
import { api, ApiErr } from '@/components/staff/api'
import { formatMoney } from '@/lib/money'
import { qty, type Ingredient, type Supplier } from './types'

type Filter = 'all' | 'low' | 'out' | 'expiring' | 'archived'
type MoveKind = 'purchase' | 'waste' | 'count' | 'adjustment'

export function StockTab({ list, suppliers, reload, onHistory }: { list: Ingredient[]; suppliers: Supplier[]; reload: () => Promise<void>; onHistory: (id: number) => void }) {
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [moving, setMoving] = useState<{ g: Ingredient; kind: MoveKind } | null>(null)
  const [editing, setEditing] = useState<Ingredient | 'new' | null>(null)
  const shown = useMemo(() => list.filter((g) => {
    if (filter === 'archived' ? g.active : !g.active) return false
    if (filter === 'low' && !g.low) return false
    if (filter === 'out' && !g.out) return false
    if (filter === 'expiring' && !g.expiringQty) return false
    const n = q.trim().toLowerCase()
    return !n || g.name.toLowerCase().includes(n) || (g.sku ?? '').toLowerCase().includes(n)
  }), [list, q, filter])
  const value = list.filter((g) => g.active).reduce((a, g) => a + g.value, 0)
  const count = (f: Filter) => list.filter((g) => (f === 'archived' ? !g.active : g.active && (f === 'low' ? g.low : f === 'out' ? g.out : f === 'expiring' ? g.expiringQty > 0 : true))).length

  return (
    <>
      <div className="inv-bar">
        <div className="pos-search"><Search size={18} aria-hidden /><input className="ui-input" placeholder="Search name or SKU" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search stock" /></div>
        <div className="ui-seg" role="group" aria-label="Filter">
          {(['all', 'low', 'out', 'expiring', 'archived'] as Filter[]).map((f) => (
            <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>{f[0].toUpperCase() + f.slice(1)} <span className="ui-hint">{count(f)}</span></button>
          ))}
        </div>
        <span className="ui-muted inv-value">Stock value <b>{formatMoney(value, 'IQD')}</b></span>
        <button type="button" className="ui-btn primary" onClick={() => setEditing('new')}><Plus size={16} /> Ingredient</button>
      </div>

      {!list.length && (
        <div className="inv-empty ui-card">
          <b>No ingredients yet</b>
          <p className="ui-muted">Add what you buy and cook with, then give dishes a recipe on the Recipes tab. Stock is taken automatically when orders go to the kitchen. Dishes without a recipe are not tracked.</p>
          <button type="button" className="ui-btn primary" onClick={() => setEditing('new')}><Plus size={16} /> Add the first ingredient</button>
        </div>
      )}

      {list.length > 0 && (
        <div className="ui-card pos-table-wrap">
          <table className="pos-table inv-table">
            <thead><tr><th>Ingredient</th><th className="num">In stock</th><th className="num">Minimum</th><th className="num">Cost / unit</th><th className="num">Value</th><th>Supplier</th><th>Expiry</th><th /></tr></thead>
            <tbody>
              {shown.map((g) => (
                <tr key={g.id} className={!g.active ? 'voided' : ''}>
                  <td><button type="button" className="inv-name" onClick={() => onHistory(g.id)}><b>{g.name}</b><small>{[g.sku, g.category, g.usedBy ? `in ${g.usedBy} recipe${g.usedBy > 1 ? 's' : ''}` : 'not in a recipe'].filter(Boolean).join(' · ')}</small></button></td>
                  <td className="num"><b>{qty(g.stock, g.unit)}</b>{g.out ? <span className="ui-pill danger">out</span> : g.low ? <span className="ui-pill warning">low</span> : null}</td>
                  <td className="num">{g.minLevel ? qty(g.minLevel, g.unit) : '—'}</td>
                  <td className="num">{g.unitCost.toLocaleString('en-US', { maximumFractionDigits: 2 })} / {g.unit}</td>
                  <td className="num">{formatMoney(g.value, 'IQD')}</td>
                  <td>{g.supplier ?? '—'}</td>
                  <td>{g.nextExpiry ? <span className={g.expiringQty ? 'ui-pill warning' : 'ui-hint'}>{g.nextExpiry}</span> : '—'}</td>
                  <td className="pos-row-actions">
                    {g.active && <>
                      <button type="button" className="ui-btn sm ghost" onClick={() => setMoving({ g, kind: 'purchase' })} title="Receive"><PackagePlus size={15} /> Receive</button>
                      <button type="button" className="ui-btn sm ghost" onClick={() => setMoving({ g, kind: 'waste' })} title="Waste" aria-label={`Waste ${g.name}`}><Trash2 size={15} /></button>
                      <button type="button" className="ui-btn sm ghost" onClick={() => setMoving({ g, kind: 'count' })} title="Count" aria-label={`Count ${g.name}`}><ClipboardCheck size={15} /></button>
                      <button type="button" className="ui-btn sm ghost" onClick={() => setMoving({ g, kind: 'adjustment' })} title="Adjust" aria-label={`Adjust ${g.name}`}><SlidersHorizontal size={15} /></button>
                    </>}
                    <button type="button" className="ui-btn sm ghost" onClick={() => setEditing(g)} aria-label={`Edit ${g.name}`}><Pencil size={15} /></button>
                  </td>
                </tr>
              ))}
              {!shown.length && <tr><td colSpan={8} className="ui-muted" style={{ textAlign: 'center', padding: 28 }}>Nothing matches.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {moving && <MoveDialog {...moving} onClose={() => setMoving(null)} onDone={async () => { setMoving(null); await reload() }} />}
      {editing && <IngredientDialog g={editing === 'new' ? null : editing} suppliers={suppliers} onClose={() => setEditing(null)} onDone={async () => { setEditing(null); await reload() }} />}
    </>
  )
}

const MOVE_COPY: Record<MoveKind, { title: string; field: string; hint: string; button: string }> = {
  purchase: { title: 'Receive stock', field: 'Amount received', hint: 'For deliveries without a purchase order. Use Purchases to book an order you placed.', button: 'Add to stock' },
  waste: { title: 'Record waste', field: 'Amount thrown away', hint: 'Spoiled, dropped, burnt. It is taken off stock and shows in the waste report.', button: 'Record waste' },
  count: { title: 'Stock count', field: 'Amount on the shelf now', hint: 'Enter what you counted. The difference is recorded.', button: 'Save count' },
  adjustment: { title: 'Adjust stock', field: 'Change (use a minus sign to remove)', hint: 'For corrections that are not waste or a count.', button: 'Adjust' },
}

function MoveDialog({ g, kind, onClose, onDone }: { g: Ingredient; kind: MoveKind; onClose: () => void; onDone: () => Promise<void> }) {
  const [amount, setAmount] = useState(kind === 'count' ? String(g.stock) : '')
  const [cost, setCost] = useState(String(g.unitCost))
  const [expires, setExpires] = useState('')
  const [reason, setReason] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const c = MOVE_COPY[kind]
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('')
    try {
      await api('POST', '/api/admin/inventory/movements', {
        ingredientId: g.id, kind, quantity: Number(amount), reason,
        unitCost: kind === 'purchase' ? Number(cost) : undefined, expiresOn: kind === 'purchase' && expires ? expires : undefined,
      })
      await onDone()
    } catch (x) { setErr(x instanceof ApiErr ? x.message : 'Not saved') } finally { setBusy(false) }
  }
  return (
    <div className="ui-overlay" onClick={onClose}>
      <form className="ui-dialog" style={{ width: 'min(440px,100%)' }} onSubmit={save} onClick={(e) => e.stopPropagation()} aria-label={c.title}>
        <header><div><h2>{c.title}</h2><span className="ui-muted">{g.name} · {qty(g.stock, g.unit)} in stock</span></div></header>
        <div className="ui-dialog-body" style={{ display: 'grid', gap: 12 }}>
          <label className="ui-label">{c.field} ({g.unit})<input className="ui-input" inputMode="decimal" required autoFocus value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.-]/g, ''))} /></label>
          {kind === 'purchase' && <label className="ui-label">Cost per {g.unit} (IQD)<input className="ui-input" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value.replace(/[^\d.]/g, ''))} /></label>}
          {kind === 'purchase' && <label className="ui-label">Use-by date {g.trackExpiry ? '' : '(optional)'}<input className="ui-input" type="date" required={g.trackExpiry} value={expires} onChange={(e) => setExpires(e.target.value)} /></label>}
          <label className="ui-label">Reason {kind === 'waste' || kind === 'adjustment' ? '' : '(optional)'}<input className="ui-input" required={kind === 'waste' || kind === 'adjustment'} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
          <p className="ui-hint">{c.hint}</p>
          {err && <p className="ui-alert danger" role="alert">{err}</p>}
        </div>
        <div className="ui-dialog-foot">
          <button type="button" className="ui-btn" onClick={onClose}>Cancel</button>
          <button type="submit" className={`ui-btn ${kind === 'waste' ? 'danger' : 'primary'}`} style={{ marginInlineStart: 'auto' }} disabled={busy || amount === ''}>{c.button}</button>
        </div>
      </form>
    </div>
  )
}

function IngredientDialog({ g, suppliers, onClose, onDone }: { g: Ingredient | null; suppliers: Supplier[]; onClose: () => void; onDone: () => Promise<void> }) {
  const [f, setF] = useState({
    name: g?.name ?? '', sku: g?.sku ?? '', category: g?.category ?? 'ingredient', unit: g?.unit ?? 'g', minLevel: String(g?.minLevel ?? ''),
    unitCost: String(g?.unitCost ?? ''), supplierId: g?.supplierId ?? null as number | null, trackExpiry: g?.trackExpiry ?? false, openingStock: '',
  })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value })
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('')
    const payload = { ...f, minLevel: Number(f.minLevel || 0), unitCost: Number(f.unitCost || 0), openingStock: f.openingStock === '' ? undefined : Number(f.openingStock) }
    try {
      if (g) await api('PATCH', '/api/admin/inventory/ingredients', { id: g.id, ...payload })
      else await api('POST', '/api/admin/inventory/ingredients', payload)
      await onDone()
    } catch (x) { setErr(x instanceof ApiErr ? x.message : 'Not saved') } finally { setBusy(false) }
  }
  const archive = async () => {
    if (!g) return
    try { await api('PATCH', '/api/admin/inventory/ingredients', { id: g.id, active: !g.active }); await onDone() } catch (x) { setErr(x instanceof ApiErr ? x.message : 'Failed') }
  }
  return (
    <div className="ui-overlay" onClick={onClose}>
      <form className="ui-dialog" style={{ width: 'min(560px,100%)' }} onSubmit={save} onClick={(e) => e.stopPropagation()} aria-label={g ? 'Edit ingredient' : 'New ingredient'}>
        <header><h2>{g ? `Edit ${g.name}` : 'New ingredient'}</h2></header>
        <div className="ui-dialog-body resv-form">
          <label className="ui-label">Name<input className="ui-input" required value={f.name} onChange={set('name')} /></label>
          <label className="ui-label">SKU (optional)<input className="ui-input" value={f.sku} onChange={set('sku')} /></label>
          <label className="ui-label">Category
            <select className="ui-select" value={f.category} onChange={set('category')}>
              {['ingredient', 'drink', 'packaging', 'finished', 'cleaning', 'other'].map((c) => <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>)}
            </select>
          </label>
          <label className="ui-label">Unit
            <select className="ui-select" value={f.unit} onChange={set('unit')} disabled={!!g && g.usedBy > 0}>
              <option value="g">grams (g)</option><option value="kg">kilograms (kg)</option><option value="ml">millilitres (ml)</option><option value="l">litres (l)</option><option value="pcs">pieces</option>
            </select>
          </label>
          <label className="ui-label">Minimum level ({f.unit})<input className="ui-input" inputMode="decimal" value={f.minLevel} onChange={set('minLevel')} placeholder="Alert below this" /></label>
          <label className="ui-label">Cost per {f.unit} (IQD)<input className="ui-input" inputMode="decimal" value={f.unitCost} onChange={set('unitCost')} /></label>
          <label className="ui-label">Supplier
            <select className="ui-select" value={f.supplierId ?? ''} onChange={(e) => setF({ ...f, supplierId: e.target.value ? Number(e.target.value) : null })}>
              <option value="">None</option>{suppliers.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          {!g && <label className="ui-label">Opening stock ({f.unit})<input className="ui-input" inputMode="decimal" value={f.openingStock} onChange={set('openingStock')} placeholder="What you have now" /></label>}
          <label className="inv-check wide"><input type="checkbox" checked={f.trackExpiry} onChange={(e) => setF({ ...f, trackExpiry: e.target.checked })} /> Ask for a use-by date when it arrives</label>
          {err && <p className="ui-alert danger wide" role="alert">{err}</p>}
        </div>
        <div className="ui-dialog-foot">
          {g && <button type="button" className="ui-btn ghost" onClick={archive}><Archive size={15} /> {g.active ? 'Archive' : 'Restore'}</button>}
          <button type="button" className="ui-btn" style={{ marginInlineStart: 'auto' }} onClick={onClose}>Cancel</button>
          <button type="submit" className="ui-btn primary" disabled={busy}>Save</button>
        </div>
      </form>
    </div>
  )
}
