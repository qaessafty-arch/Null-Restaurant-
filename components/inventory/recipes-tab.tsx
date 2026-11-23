'use client'

import { useEffect, useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { api, ApiErr } from '@/components/staff/api'
import { formatMoney } from '@/lib/money'
import type { Ingredient, RecipeLine } from './types'

type Opt = { id: number; name: { en: string } }
type Item = { id: number; name: { en: string }; price: number; offerPrice: number | null; available: boolean; groups: Array<{ id: number; name: { en: string }; options: Opt[] }> }
type Cat = { id: number; name: { en: string }; items: Item[] }
type Row = { key: string; optionId: number | null; ingredientId: number | ''; qty: string }

const key = () => Math.random().toString(36).slice(2)

export function RecipesTab({ ingredients }: { ingredients: Ingredient[] }) {
  const [cats, setCats] = useState<Cat[]>([])
  const [itemId, setItemId] = useState<number | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [costs, setCosts] = useState<Record<number, number>>({})
  const [err, setErr] = useState('')
  const [saved, setSaved] = useState('')
  const [busy, setBusy] = useState(false)
  const active = ingredients.filter((g) => g.active)

  useEffect(() => {
    api<{ categories: Cat[] }>('GET', '/api/admin/categories').then((d) => { setCats(d.categories); setItemId((x) => x ?? d.categories[0]?.items[0]?.id ?? null) }).catch(() => {})
  }, [])
  const item = useMemo(() => cats.flatMap((c) => c.items).find((i) => i.id === itemId) ?? null, [cats, itemId])
  useEffect(() => {
    if (!itemId) return
    setSaved(''); setErr('')
    api<{ lines: RecipeLine[] }>('GET', `/api/admin/inventory/recipes?item=${itemId}`).then((d) => {
      setRows(d.lines.map((l) => ({ key: key(), optionId: l.optionId, ingredientId: l.ingredientId, qty: String(l.qty) })))
      setCosts((c) => ({ ...c, [itemId]: d.lines.filter((l) => !l.optionId).reduce((a, l) => a + l.cost, 0) }))
    }).catch((e) => setErr(e instanceof ApiErr ? e.message : 'Could not load the recipe'))
  }, [itemId])

  const ing = (id: number | '') => active.find((g) => g.id === id)
  const lineCost = (r: Row) => { const g = ing(r.ingredientId); return g ? Math.round((Number(r.qty) || 0) * g.unitCost) : 0 }
  const base = rows.filter((r) => !r.optionId)
  const dishCost = base.reduce((a, r) => a + lineCost(r), 0)
  const price = item ? item.offerPrice ?? item.price : 0
  const pct = price ? Math.round((dishCost / price) * 100) : 0
  const options = item?.groups.flatMap((g) => g.options.map((o) => ({ id: o.id, label: `${g.name.en}: ${o.name.en}` }))) ?? []

  const save = async () => {
    if (!itemId) return
    setBusy(true); setErr(''); setSaved('')
    try {
      const lines = rows.filter((r) => r.ingredientId !== '' && r.qty !== '').map((r) => ({ ingredientId: Number(r.ingredientId), qty: Number(r.qty), optionId: r.optionId }))
      const d = await api<{ lines: RecipeLine[] }>('PUT', '/api/admin/inventory/recipes', { itemId, lines })
      setCosts((c) => ({ ...c, [itemId]: d.lines.filter((l) => !l.optionId).reduce((a, l) => a + l.cost, 0) }))
      setSaved('Recipe saved. Stock will be taken for this dish from the next order.')
    } catch (e) { setErr(e instanceof ApiErr ? e.message : 'Not saved') } finally { setBusy(false) }
  }

  const rowEditor = (r: Row) => {
    const g = ing(r.ingredientId)
    return (
      <div key={r.key} className="inv-recipe-row">
        <select className="ui-select" value={r.ingredientId} onChange={(e) => setRows(rows.map((x) => (x.key === r.key ? { ...x, ingredientId: e.target.value ? Number(e.target.value) : '' } : x)))} aria-label="Ingredient">
          <option value="">Choose ingredient…</option>
          {active.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.unit})</option>)}
        </select>
        <div className="inv-qty">
          <input className="ui-input" inputMode="decimal" value={r.qty} placeholder={r.optionId ? '+/−' : '0'} aria-label="Quantity"
            onChange={(e) => setRows(rows.map((x) => (x.key === r.key ? { ...x, qty: e.target.value.replace(/[^\d.-]/g, '') } : x)))} />
          <span>{g?.unit ?? ''}</span>
        </div>
        <span className="inv-cost">{g ? formatMoney(lineCost(r), 'IQD') : ''}</span>
        <button type="button" className="ui-icon-btn" onClick={() => setRows(rows.filter((x) => x.key !== r.key))} aria-label="Remove line"><Trash2 size={15} /></button>
      </div>
    )
  }

  return (
    <div className="inv-recipes">
      <aside className="ui-card inv-dishes" aria-label="Dishes">
        {cats.map((c) => (
          <div key={c.id}>
            <h4>{c.name.en}</h4>
            {c.items.map((i) => (
              <button key={i.id} type="button" aria-current={i.id === itemId} onClick={() => setItemId(i.id)}>
                <span>{i.name.en}</span>
                {costs[i.id] !== undefined && costs[i.id] > 0 && <small>{Math.round((costs[i.id] / (i.offerPrice ?? i.price)) * 100)}%</small>}
              </button>
            ))}
          </div>
        ))}
      </aside>
      <section className="ui-card inv-editor">
        {!item && <p className="ui-muted">Choose a dish.</p>}
        {item && (
          <>
            <header className="inv-editor-head">
              <div><h3>{item.name.en}</h3><span className="ui-muted">Sells for {formatMoney(price, 'IQD')}</span></div>
              <div className="inv-foodcost">
                <span className="ui-muted">Ingredient cost</span>
                <b className="ui-num">{formatMoney(dishCost, 'IQD')}</b>
                {dishCost > 0 && <span className={`ui-pill ${pct > 40 ? 'danger' : pct > 30 ? 'warning' : 'success'}`}>{pct}% of price</span>}
              </div>
            </header>
            {!active.length && <p className="ui-alert warning">Add ingredients on the Stock tab first.</p>}
            <h4>One portion uses</h4>
            {base.map(rowEditor)}
            <button type="button" className="ui-btn sm ghost" disabled={!active.length} onClick={() => setRows([...rows, { key: key(), optionId: null, ingredientId: '', qty: '' }])}><Plus size={14} /> Ingredient</button>
            {options.length > 0 && (
              <>
                <h4>When a guest picks an option <span className="ui-hint">extra or less, per portion (use − to remove, e.g. no cheese)</span></h4>
                {options.filter((o) => rows.some((r) => r.optionId === o.id)).map((o) => {
                  const mine = rows.filter((r) => r.optionId === o.id)
                  return (
                    <div key={o.id} className="inv-opt">
                      <div className="inv-opt-head"><b>{o.label}</b>
                        <button type="button" className="ui-btn sm ghost" disabled={!active.length} onClick={() => setRows([...rows, { key: key(), optionId: o.id, ingredientId: '', qty: '' }])}><Plus size={14} /></button>
                      </div>
                      {mine.map(rowEditor)}
                    </div>
                  )
                })}
                <select className="ui-select inv-add-opt" value="" disabled={!active.length} aria-label="Add a line for an option"
                  onChange={(e) => e.target.value && setRows([...rows, { key: key(), optionId: Number(e.target.value), ingredientId: '', qty: '' }])}>
                  <option value="">+ Add a line for an option…</option>
                  {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
              </>
            )}
            {err && <p className="ui-alert danger" role="alert">{err}</p>}
            {saved && <p className="ui-alert success" role="status">{saved}</p>}
            <div className="inv-save"><button type="button" className="ui-btn primary" disabled={busy} onClick={save}>Save recipe</button></div>
          </>
        )}
      </section>
    </div>
  )
}
