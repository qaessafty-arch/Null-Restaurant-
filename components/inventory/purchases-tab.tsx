'use client'

import { useState } from 'react'
import { Plus, Trash2, Truck, Send, X } from 'lucide-react'
import { api, ApiErr } from '@/components/staff/api'
import { formatMoney } from '@/lib/money'
import { qty, type Ingredient, type PO, type Supplier } from './types'

const PILL: Record<PO['status'], string> = { draft: '', ordered: 'info', partial: 'warning', received: 'success', cancelled: 'danger' }

export function PurchasesTab({ pos, ingredients, suppliers, reload }: { pos: PO[]; ingredients: Ingredient[]; suppliers: Supplier[]; reload: () => Promise<void> }) {
  const [creating, setCreating] = useState(false)
  const [receiving, setReceiving] = useState<PO | null>(null)
  const [err, setErr] = useState('')
  const status = async (p: PO, s: 'ordered' | 'cancelled') => {
    setErr('')
    try { await api('PATCH', `/api/admin/inventory/purchase-orders/${p.id}`, { status: s }); await reload() } catch (e) { setErr(e instanceof ApiErr ? e.message : 'Failed') }
  }
  return (
    <>
      <div className="inv-bar"><span className="ui-muted" style={{ marginInlineEnd: 'auto' }}>Orders to suppliers. Receiving one adds the stock at the invoiced cost.</span>
        <button type="button" className="ui-btn primary" disabled={!ingredients.length} onClick={() => setCreating(true)}><Plus size={16} /> Purchase order</button></div>
      {err && <p className="ui-alert danger">{err}</p>}
      {!pos.length && <div className="inv-empty ui-card"><b>No purchase orders</b><p className="ui-muted">{ingredients.length ? 'Create one when you order from a supplier.' : 'Add ingredients first.'}</p></div>}
      <div className="inv-pos">
        {pos.map((p) => (
          <article key={p.id} className="ui-card inv-po">
            <header>
              <b>{p.label}</b><span className={`ui-pill ${PILL[p.status]}`}>{p.status}</span>
              <span className="ui-muted">{p.supplier ?? 'No supplier'}{p.expectedOn ? ` · expected ${p.expectedOn}` : ''}</span>
              <b className="inv-po-total">{formatMoney(p.total, 'IQD')}</b>
            </header>
            <ul>
              {p.lines.map((l) => (
                <li key={l.id}><span>{l.ingredient}</span><span>{qty(l.qty, l.unit)}{l.received ? <small> · {qty(l.received, l.unit)} received</small> : null}</span><span>{formatMoney(l.total, 'IQD')}</span></li>
              ))}
            </ul>
            {p.notes && <p className="ui-hint">{p.notes}</p>}
            {['draft', 'ordered', 'partial'].includes(p.status) && (
              <footer>
                {p.status === 'draft' && <button type="button" className="ui-btn sm" onClick={() => status(p, 'ordered')}><Send size={14} /> Mark as ordered</button>}
                <button type="button" className="ui-btn sm primary" onClick={() => setReceiving(p)}><Truck size={14} /> Receive delivery</button>
                {p.status !== 'partial' && <button type="button" className="ui-btn sm ghost" onClick={() => status(p, 'cancelled')}><X size={14} /> Cancel</button>}
              </footer>
            )}
          </article>
        ))}
      </div>
      {creating && <CreatePO ingredients={ingredients.filter((g) => g.active)} suppliers={suppliers.filter((s) => s.active)} onClose={() => setCreating(false)} onDone={async () => { setCreating(false); await reload() }} />}
      {receiving && <Receive p={receiving} ingredients={ingredients} onClose={() => setReceiving(null)} onDone={async () => { setReceiving(null); await reload() }} />}
    </>
  )
}

function CreatePO({ ingredients, suppliers, onClose, onDone }: { ingredients: Ingredient[]; suppliers: Supplier[]; onClose: () => void; onDone: () => Promise<void> }) {
  const [supplierId, setSupplierId] = useState<number | null>(null)
  const [expectedOn, setExpectedOn] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<Array<{ ingredientId: number | ''; qty: string; unitCost: string }>>([{ ingredientId: '', qty: '', unitCost: '' }])
  const [err, setErr] = useState('')
  const pick = (sid: number | null) => {
    setSupplierId(sid)
    // Start with what this supplier delivers and is running low.
    if (sid && lines.every((l) => l.ingredientId === '')) {
      const low = ingredients.filter((g) => g.supplierId === sid && g.low)
      if (low.length) setLines(low.map((g) => ({ ingredientId: g.id, qty: String(Math.max(g.minLevel * 2 - g.stock, g.minLevel)), unitCost: String(g.unitCost) })))
    }
  }
  const total = lines.reduce((a, l) => a + (Number(l.qty) || 0) * (Number(l.unitCost) || 0), 0)
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('')
    try {
      await api('POST', '/api/admin/inventory/purchase-orders', { supplierId, expectedOn: expectedOn || null, notes,
        lines: lines.filter((l) => l.ingredientId !== '').map((l) => ({ ingredientId: Number(l.ingredientId), qty: Number(l.qty), unitCost: l.unitCost === '' ? undefined : Number(l.unitCost) })) })
      await onDone()
    } catch (x) { setErr(x instanceof ApiErr ? x.message : 'Not saved') }
  }
  return (
    <div className="ui-overlay" onClick={onClose}>
      <form className="ui-dialog" style={{ width: 'min(680px,100%)' }} onSubmit={save} onClick={(e) => e.stopPropagation()} aria-label="New purchase order">
        <header><h2>New purchase order</h2></header>
        <div className="ui-dialog-body" style={{ display: 'grid', gap: 12 }}>
          <div className="resv-form">
            <label className="ui-label">Supplier
              <select className="ui-select" value={supplierId ?? ''} onChange={(e) => pick(e.target.value ? Number(e.target.value) : null)}>
                <option value="">None</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label className="ui-label">Expected delivery<input className="ui-input" type="date" value={expectedOn} onChange={(e) => setExpectedOn(e.target.value)} /></label>
          </div>
          {lines.map((l, i) => {
            const g = ingredients.find((x) => x.id === l.ingredientId)
            const upd = (k: 'qty' | 'unitCost', v: string) => setLines(lines.map((x, j) => (j === i ? { ...x, [k]: v.replace(/[^\d.]/g, '') } : x)))
            return (
              <div key={i} className="inv-recipe-row">
                <select className="ui-select" value={l.ingredientId} aria-label="Ingredient" onChange={(e) => {
                  const ng = ingredients.find((x) => x.id === Number(e.target.value))
                  setLines(lines.map((x, j) => (j === i ? { ...x, ingredientId: e.target.value ? Number(e.target.value) : '', unitCost: ng ? String(ng.unitCost) : x.unitCost } : x)))
                }}>
                  <option value="">Choose…</option>{ingredients.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
                <div className="inv-qty"><input className="ui-input" inputMode="decimal" placeholder="Qty" value={l.qty} onChange={(e) => upd('qty', e.target.value)} aria-label="Quantity" /><span>{g?.unit}</span></div>
                <div className="inv-qty"><input className="ui-input" inputMode="decimal" placeholder="Cost" value={l.unitCost} onChange={(e) => upd('unitCost', e.target.value)} aria-label="Cost per unit" /><span>/{g?.unit ?? 'unit'}</span></div>
                <button type="button" className="ui-icon-btn" onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label="Remove line" disabled={lines.length === 1}><Trash2 size={15} /></button>
              </div>
            )
          })}
          <button type="button" className="ui-btn sm ghost" style={{ justifySelf: 'start' }} onClick={() => setLines([...lines, { ingredientId: '', qty: '', unitCost: '' }])}><Plus size={14} /> Line</button>
          <label className="ui-label">Notes<input className="ui-input" value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
          <p className="ui-muted">Estimated total <b>{formatMoney(Math.round(total), 'IQD')}</b></p>
          {err && <p className="ui-alert danger" role="alert">{err}</p>}
        </div>
        <div className="ui-dialog-foot"><button type="button" className="ui-btn" onClick={onClose}>Cancel</button><button type="submit" className="ui-btn primary" style={{ marginInlineStart: 'auto' }}>Save draft</button></div>
      </form>
    </div>
  )
}

function Receive({ p, ingredients, onClose, onDone }: { p: PO; ingredients: Ingredient[]; onClose: () => void; onDone: () => Promise<void> }) {
  const [lines, setLines] = useState(p.lines.map((l) => ({ lineId: l.id, qty: String(Math.max(0, Math.round((l.qty - l.received) * 1000) / 1000)), unitCost: String(l.unitCost), expiresOn: '' })))
  const [err, setErr] = useState('')
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('')
    try {
      await api('POST', `/api/admin/inventory/purchase-orders/${p.id}/receive`, { lines: lines.map((l) => ({ lineId: l.lineId, qty: Number(l.qty) || 0, unitCost: Number(l.unitCost), expiresOn: l.expiresOn || null })) })
      await onDone()
    } catch (x) { setErr(x instanceof ApiErr ? x.message : 'Not saved') }
  }
  return (
    <div className="ui-overlay" onClick={onClose}>
      <form className="ui-dialog" style={{ width: 'min(720px,100%)' }} onSubmit={save} onClick={(e) => e.stopPropagation()} aria-label="Receive delivery">
        <header><div><h2>Receive {p.label}</h2><span className="ui-muted">Enter what actually arrived and what the invoice says it cost.</span></div></header>
        <div className="ui-dialog-body" style={{ display: 'grid', gap: 10 }}>
          {p.lines.map((pl, i) => {
            const g = ingredients.find((x) => x.id === pl.ingredientId)
            const l = lines[i]
            const upd = (k: 'qty' | 'unitCost' | 'expiresOn', v: string) => setLines(lines.map((x, j) => (j === i ? { ...x, [k]: v } : x)))
            return (
              <div key={pl.id} className="inv-receive-row">
                <span><b>{pl.ingredient}</b><small>ordered {qty(pl.qty, pl.unit)}{pl.received ? `, ${qty(pl.received, pl.unit)} already in` : ''}</small></span>
                <div className="inv-qty"><input className="ui-input" inputMode="decimal" value={l.qty} onChange={(e) => upd('qty', e.target.value.replace(/[^\d.]/g, ''))} aria-label={`Received ${pl.ingredient}`} /><span>{pl.unit}</span></div>
                <div className="inv-qty"><input className="ui-input" inputMode="decimal" value={l.unitCost} onChange={(e) => upd('unitCost', e.target.value.replace(/[^\d.]/g, ''))} aria-label={`Cost of ${pl.ingredient}`} /><span>/{pl.unit}</span></div>
                <input className="ui-input" type="date" value={l.expiresOn} required={!!g?.trackExpiry && Number(l.qty) > 0} onChange={(e) => upd('expiresOn', e.target.value)} aria-label={`Use-by date for ${pl.ingredient}`} />
              </div>
            )
          })}
          {err && <p className="ui-alert danger" role="alert">{err}</p>}
        </div>
        <div className="ui-dialog-foot"><button type="button" className="ui-btn" onClick={onClose}>Cancel</button><button type="submit" className="ui-btn primary" style={{ marginInlineStart: 'auto' }}><Truck size={16} /> Add to stock</button></div>
      </form>
    </div>
  )
}
