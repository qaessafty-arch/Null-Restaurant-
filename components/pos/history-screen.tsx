'use client'

import { useCallback, useState } from 'react'
import { Receipt as ReceiptIcon, Undo2, Ban } from 'lucide-react'
import { api, ApiErr, clock } from '@/components/staff/api'
import { useLive, useMe } from '@/components/staff/shell'
import { can } from '@/lib/permissions'
import { formatMoney } from '@/lib/money'
import { ReceiptDialog } from './receipt'
import type { Payment, PosConfig } from './types'

/** Start of the local day as a UTC "YYYY-MM-DD HH:MM:SS" bound for the API. */
function todayStartUtc() {
  const d = new Date(); d.setHours(0, 0, 0, 0)
  return d.toISOString().slice(0, 19).replace('T', ' ')
}

export function HistoryScreen({ config }: { config: PosConfig }) {
  const { me } = useMe()
  const [list, setList] = useState<Payment[]>([])
  const [err, setErr] = useState('')
  const [receiptFor, setReceiptFor] = useState<string[] | null>(null)
  const [acting, setActing] = useState<{ p: Payment; action: 'refund' | 'void' } | null>(null)
  const base = config.baseCurrency
  const load = useCallback(async () => {
    try { setList((await api<{ payments: Payment[] }>('GET', `/api/staff/payments?from=${encodeURIComponent(todayStartUtc())}`)).payments); setErr('') }
    catch (e) { setErr(e instanceof ApiErr ? e.message : 'Offline. Retrying…') }
  }, [])
  useLive(load, 15000)

  const done = list.filter((p) => p.status === 'completed')
  const takings = done.reduce((a, p) => a + (p.kind === 'payment' ? p.baseAmount : -p.baseAmount), 0)
  const byMethod = config.methods.map((m) => ({
    m, total: done.filter((p) => p.method === m.id).reduce((a, p) => a + (p.kind === 'payment' ? p.baseAmount : -p.baseAmount), 0),
  })).filter((x) => x.total !== 0)

  return (
    <div className="pos-history">
      <div className="pos-takings">
        <div><span className="ui-muted">Taken today</span><b className="ui-num">{formatMoney(takings, base)}</b></div>
        {byMethod.map(({ m, total }) => <div key={m.id}><span className="ui-muted">{m.label}</span><b>{formatMoney(total, base)}</b></div>)}
        <div><span className="ui-muted">Transactions</span><b>{done.filter((p) => p.kind === 'payment').length}</b></div>
      </div>
      {err && <p className="ui-alert warning">{err}</p>}
      <div className="ui-card pos-table-wrap">
        <table className="pos-table">
          <thead><tr><th>Time</th><th>Orders</th><th>Method</th><th className="num">Amount</th><th className="num">{base}</th><th>By</th><th /></tr></thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id} className={p.status === 'voided' ? 'voided' : p.kind === 'refund' ? 'refund' : ''}>
                <td>{clock(p.createdAt)}</td>
                <td>{p.orders.map((o) => o.label).join(', ')}</td>
                <td>
                  {config.methods.find((m) => m.id === p.method)?.label ?? p.method}
                  {p.kind === 'refund' && <span className="ui-pill danger">refund</span>}
                  {p.status === 'voided' && <span className="ui-pill">void · {p.voidReason}</span>}
                  {p.reference && <small className="ui-hint"> #{p.reference}</small>}
                </td>
                <td className="num">{formatMoney(p.amount, p.currency)}</td>
                <td className="num">{p.kind === 'refund' ? '−' : ''}{formatMoney(p.baseAmount, base)}</td>
                <td>{p.cashier}</td>
                <td className="pos-row-actions">
                  <button type="button" className="ui-btn sm ghost" onClick={() => setReceiptFor(p.orders.map((o) => o.id))} aria-label="Receipt"><ReceiptIcon size={15} /></button>
                  {can(me.role, 'payments.refund') && p.kind === 'payment' && p.status === 'completed' && (
                    <>
                      {p.refunded < p.baseAmount && <button type="button" className="ui-btn sm ghost" onClick={() => setActing({ p, action: 'refund' })}><Undo2 size={15} /> Refund</button>}
                      {p.refunded === 0 && <button type="button" className="ui-btn sm ghost" onClick={() => setActing({ p, action: 'void' })}><Ban size={15} /> Void</button>}
                    </>
                  )}
                </td>
              </tr>
            ))}
            {!list.length && <tr><td colSpan={7} className="ui-muted" style={{ textAlign: 'center', padding: 32 }}>No payments yet today.</td></tr>}
          </tbody>
        </table>
      </div>
      {receiptFor && <ReceiptDialog orderIds={receiptFor} onClose={() => setReceiptFor(null)} />}
      {acting && <ReverseDialog {...acting} base={base} onClose={() => setActing(null)} onDone={() => { setActing(null); void load() }} />}
    </div>
  )
}

function ReverseDialog({ p, action, base, onClose, onDone }: { p: Payment; action: 'refund' | 'void'; base: string; onClose: () => void; onDone: () => void }) {
  const left = p.baseAmount - p.refunded
  const [amount, setAmount] = useState(String(left))
  const [reason, setReason] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [key] = useState(() => crypto.randomUUID())
  const go = async () => {
    setBusy(true); setErr('')
    try {
      if (action === 'refund') await api('POST', `/api/staff/payments/${p.id}/refund`, { amount: Number(amount), reason, idempotencyKey: key })
      else await api('POST', `/api/staff/payments/${p.id}/void`, { reason })
      onDone()
    } catch (e) { setErr(e instanceof ApiErr ? e.message : 'Failed') } finally { setBusy(false) }
  }
  return (
    <div className="ui-overlay" role="dialog" aria-modal="true" aria-label={action} onClick={onClose}>
      <div className="ui-dialog" style={{ width: 'min(420px,100%)' }} onClick={(e) => e.stopPropagation()}>
        <header><h2>{action === 'refund' ? 'Refund payment' : 'Void payment'}</h2></header>
        <div className="ui-dialog-body" style={{ display: 'grid', gap: 12 }}>
          <p className="ui-muted">{p.orders.map((o) => o.label).join(', ')} · {formatMoney(p.baseAmount, base)}</p>
          {action === 'void' && <p className="ui-hint">Use void only for a payment entered by mistake. It stays in the history, marked void.</p>}
          {action === 'refund' && (
            <label className="ui-label">Amount to refund ({base}), up to {formatMoney(left, base)}
              <input className="ui-input" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} />
            </label>
          )}
          <label className="ui-label">Reason<input className="ui-input" value={reason} onChange={(e) => setReason(e.target.value)} /></label>
          {err && <p className="ui-alert danger">{err}</p>}
        </div>
        <div className="ui-dialog-foot">
          <button type="button" className="ui-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="ui-btn danger" style={{ marginInlineStart: 'auto' }} disabled={busy || !reason.trim()} onClick={go}>
            {action === 'refund' ? `Refund ${formatMoney(Number(amount) || 0, base)}` : 'Void payment'}
          </button>
        </div>
      </div>
    </div>
  )
}
