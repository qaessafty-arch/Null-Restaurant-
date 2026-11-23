'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CalendarClock } from 'lucide-react'
import { api, ApiErr, clock } from '@/components/staff/api'
import { useLive } from '@/components/staff/shell'
import { formatMoney } from '@/lib/money'
import { StockTab } from '@/components/inventory/stock-tab'
import { RecipesTab } from '@/components/inventory/recipes-tab'
import { PurchasesTab } from '@/components/inventory/purchases-tab'
import { KIND_LABEL, qty, type Ingredient, type Movement, type PO, type Supplier } from '@/components/inventory/types'

type Tab = 'stock' | 'recipes' | 'purchases' | 'suppliers' | 'history'
type Alerts = { low: Ingredient[]; expiring: Array<{ batchId: number; ingredient: string; unit: string; qty: number; expiresOn: string; expired: boolean }> }

export default function InventoryPage() {
  const [tab, setTab] = useState<Tab>('stock')
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [pos, setPos] = useState<PO[]>([])
  const [alerts, setAlerts] = useState<Alerts | null>(null)
  const [historyFor, setHistoryFor] = useState<number | null>(null)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    try {
      const [g, s, p, a] = await Promise.all([
        api<{ ingredients: Ingredient[] }>('GET', '/api/admin/inventory/ingredients'),
        api<{ suppliers: Supplier[] }>('GET', '/api/admin/inventory/suppliers'),
        api<{ purchaseOrders: PO[] }>('GET', '/api/admin/inventory/purchase-orders'),
        api<Alerts>('GET', '/api/admin/inventory/alerts'),
      ])
      setIngredients(g.ingredients); setSuppliers(s.suppliers); setPos(p.purchaseOrders); setAlerts(a); setErr('')
    } catch (e) { setErr(e instanceof ApiErr ? e.message : 'Offline. Retrying…') }
  }, [])
  useLive(load, 30000)

  const tabs: Array<{ id: Tab; label: string; n?: number }> = [
    { id: 'stock', label: 'Stock' }, { id: 'recipes', label: 'Recipes' },
    { id: 'purchases', label: 'Purchases', n: pos.filter((p) => ['ordered', 'partial'].includes(p.status)).length },
    { id: 'suppliers', label: 'Suppliers' }, { id: 'history', label: 'History' },
  ]
  return (
    <div className="inv themed">
      <div className="ad-head"><h1>Inventory</h1></div>
      {err && <p className="ui-alert warning">{err}</p>}
      {alerts && (alerts.low.length > 0 || alerts.expiring.length > 0) && (
        <div className="inv-alerts">
          {alerts.low.length > 0 && (
            <div className="ui-alert warning"><AlertTriangle size={16} /> <b>Low:</b> {alerts.low.map((g) => `${g.name} (${qty(g.stock, g.unit)})`).join(', ')}</div>
          )}
          {alerts.expiring.length > 0 && (
            <div className="ui-alert danger"><CalendarClock size={16} /> <b>Use soon:</b> {alerts.expiring.map((b) => `${b.ingredient} ${qty(b.qty, b.unit)} ${b.expired ? 'expired' : 'by'} ${b.expiresOn}`).join(', ')}</div>
          )}
        </div>
      )}
      <nav className="pos-tabs" role="tablist" aria-label="Inventory">
        {tabs.map((t) => <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>{t.label}{t.n ? <i>{t.n}</i> : null}</button>)}
      </nav>
      {tab === 'stock' && <StockTab list={ingredients} suppliers={suppliers} reload={load} onHistory={(id) => { setHistoryFor(id); setTab('history') }} />}
      {tab === 'recipes' && <RecipesTab ingredients={ingredients} />}
      {tab === 'purchases' && <PurchasesTab pos={pos} ingredients={ingredients} suppliers={suppliers} reload={load} />}
      {tab === 'suppliers' && <SuppliersTab suppliers={suppliers} reload={load} />}
      {tab === 'history' && <HistoryTab ingredients={ingredients} ingredientId={historyFor} setIngredientId={setHistoryFor} />}
    </div>
  )
}

function HistoryTab({ ingredients, ingredientId, setIngredientId }: { ingredients: Ingredient[]; ingredientId: number | null; setIngredientId: (n: number | null) => void }) {
  const [list, setList] = useState<Movement[]>([])
  useEffect(() => {
    api<{ movements: Movement[] }>('GET', `/api/admin/inventory/movements${ingredientId ? `?ingredient=${ingredientId}` : ''}`).then((d) => setList(d.movements)).catch(() => {})
  }, [ingredientId])
  return (
    <>
      <div className="inv-bar">
        <select className="ui-select" style={{ width: 'auto' }} value={ingredientId ?? ''} onChange={(e) => setIngredientId(e.target.value ? Number(e.target.value) : null)} aria-label="Ingredient">
          <option value="">All ingredients</option>{ingredients.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      </div>
      <div className="ui-card pos-table-wrap">
        <table className="pos-table">
          <thead><tr><th>When</th><th>Ingredient</th><th>What</th><th className="num">Change</th><th className="num">Balance</th><th className="num">Value</th><th>By</th></tr></thead>
          <tbody>
            {list.map((m) => (
              <tr key={m.id} className={m.change < 0 && m.kind === 'waste' ? 'refund' : ''}>
                <td>{new Date(m.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} {clock(m.at)}</td>
                <td>{m.ingredient}</td>
                <td>{KIND_LABEL[m.kind] ?? m.kind}{m.order && <small className="ui-hint"> {m.order}</small>}{m.po && <small className="ui-hint"> {m.po}</small>}{m.reason && m.kind !== 'sale' && m.reason !== m.po && m.reason !== m.order && <small className="ui-hint"> · {m.reason}</small>}</td>
                <td className="num">{m.change > 0 ? '+' : ''}{qty(m.change, m.unit)}</td>
                <td className="num">{qty(m.balance, m.unit)}</td>
                <td className="num">{formatMoney(m.value, 'IQD')}</td>
                <td>{m.by ?? (m.kind === 'sale' ? 'System' : '')}</td>
              </tr>
            ))}
            {!list.length && <tr><td colSpan={7} className="ui-muted" style={{ textAlign: 'center', padding: 28 }}>No stock movements yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}

function SuppliersTab({ suppliers, reload }: { suppliers: Supplier[]; reload: () => Promise<void> }) {
  const [form, setForm] = useState<Partial<Supplier> | null>(null)
  const [err, setErr] = useState('')
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); if (!form) return; setErr('')
    try { await api(form.id ? 'PATCH' : 'POST', '/api/admin/inventory/suppliers', form); setForm(null); await reload() }
    catch (x) { setErr(x instanceof ApiErr ? x.message : 'Not saved') }
  }
  return (
    <>
      <div className="inv-bar"><span style={{ marginInlineEnd: 'auto' }} /><button type="button" className="ui-btn primary" onClick={() => setForm({ name: '' })}>New supplier</button></div>
      <div className="inv-suppliers">
        {suppliers.map((s) => (
          <button key={s.id} type="button" className={`ui-card inv-supplier ${s.active ? '' : 'dim'}`} onClick={() => setForm(s)}>
            <b>{s.name}</b><span className="ui-muted">{[s.contact, s.phone, s.email].filter(Boolean).join(' · ') || 'No contact details'}</span>
            <span className="ui-hint">{s.ingredients} ingredient{s.ingredients === 1 ? '' : 's'}{s.active ? '' : ' · archived'}</span>
          </button>
        ))}
        {!suppliers.length && <div className="inv-empty ui-card"><b>No suppliers yet</b><p className="ui-muted">Add who you buy from to link ingredients and purchase orders.</p></div>}
      </div>
      {form && (
        <div className="ui-overlay" onClick={() => setForm(null)}>
          <form className="ui-dialog" style={{ width: 'min(520px,100%)' }} onSubmit={save} onClick={(e) => e.stopPropagation()} aria-label="Supplier">
            <header><h2>{form.id ? form.name : 'New supplier'}</h2></header>
            <div className="ui-dialog-body resv-form">
              <label className="ui-label wide">Name<input className="ui-input" required value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
              <label className="ui-label">Contact person<input className="ui-input" value={form.contact ?? ''} onChange={(e) => setForm({ ...form, contact: e.target.value })} /></label>
              <label className="ui-label">Phone<input className="ui-input" value={form.phone ?? ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
              <label className="ui-label wide">Email<input className="ui-input" type="email" value={form.email ?? ''} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
              <label className="ui-label wide">Notes<textarea className="ui-textarea" rows={2} value={form.notes ?? ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
              {err && <p className="ui-alert danger wide">{err}</p>}
            </div>
            <div className="ui-dialog-foot">
              {form.id && <button type="button" className="ui-btn ghost" onClick={async () => { await api('PATCH', '/api/admin/inventory/suppliers', { id: form.id, active: !form.active }); setForm(null); await reload() }}>{form.active ? 'Archive' : 'Restore'}</button>}
              <button type="button" className="ui-btn" style={{ marginInlineStart: 'auto' }} onClick={() => setForm(null)}>Cancel</button>
              <button type="submit" className="ui-btn primary">Save</button>
            </div>
          </form>
        </div>
      )}
    </>
  )
}
