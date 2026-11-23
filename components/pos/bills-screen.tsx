'use client'

import { useCallback, useEffect, useState } from 'react'
import { BellRing, Receipt as ReceiptIcon, Percent, ChevronLeft, Check } from 'lucide-react'
import { api, ApiErr, ago, agoText } from '@/components/staff/api'
import { useLive, useMe } from '@/components/staff/shell'
import { can } from '@/lib/permissions'
import { formatMoney } from '@/lib/money'
import { PaymentPanel } from './payment-panel'
import { ReceiptDialog } from './receipt'
import type { Bill, OpenBill, Payment, PosConfig } from './types'

export type BillRef = { kind: 'table'; tableId: number } | { kind: 'order'; orderId: string }

export function BillsScreen({ config, open, setOpen }: { config: PosConfig; open: BillRef | null; setOpen: (b: BillRef | null) => void }) {
  const [bills, setBills] = useState<OpenBill[]>([])
  const [err, setErr] = useState('')
  const load = useCallback(async () => {
    try { setBills((await api<{ bills: OpenBill[] }>('GET', '/api/staff/bills')).bills); setErr('') }
    catch (e) { setErr(e instanceof ApiErr ? e.message : 'Offline. Retrying…') }
  }, [])
  useLive(load, 8000)
  const base = config.baseCurrency

  if (open) return <BillDetail config={config} bref={open} onBack={() => { setOpen(null); void load() }} />

  return (
    <div className="pos-bills">
      {err && <p className="ui-alert warning">{err}</p>}
      {!bills.length && !err && <div className="pos-empty-state"><Check size={28} /><b>No open bills</b><span className="ui-muted">Every table and order is paid.</span></div>}
      <div className="pos-bill-grid">
        {bills.map((b) => (
          <button key={b.key} type="button" className={`pos-bill ${b.billRequestedAt ? 'asking' : ''}`}
            onClick={() => setOpen(b.tableId ? { kind: 'table', tableId: b.tableId } : { kind: 'order', orderId: b.key.slice(1) })}>
            <span className="pos-bill-label">{b.label}</span>
            {b.billRequestedAt && <span className="ui-pill accent"><BellRing size={12} /> Bill asked {agoText(b.billRequestedAt)}</span>}
            <span className="ui-num pos-bill-due">{formatMoney(b.due, base)}</span>
            <span className="ui-hint">{b.orders} order{b.orders > 1 ? 's' : ''}{b.since ? ` · open ${ago(b.since)}` : ''}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function BillDetail({ config, bref, onBack }: { config: PosConfig; bref: BillRef; onBack: () => void }) {
  const { me } = useMe()
  const [bill, setBill] = useState<Bill | null>(null)
  const [err, setErr] = useState('')
  const [last, setLast] = useState<Payment | null>(null)
  const [receiptFor, setReceiptFor] = useState<string[] | null>(null)
  const [discountFor, setDiscountFor] = useState<string | null>(null)
  const [paidIds, setPaidIds] = useState<string[]>([])
  const base = config.baseCurrency
  const url = bref.kind === 'table' ? `/api/staff/bills/table/${bref.tableId}` : `/api/staff/bills/order/${bref.orderId}`
  const load = useCallback(async () => {
    try { setBill(await api<Bill>('GET', url)); setErr('') } catch (e) { setErr(e instanceof ApiErr ? e.message : 'Could not load the bill') }
  }, [url])
  useEffect(() => { void load() }, [load])

  const ids = bill?.orders.map((o) => o.id) ?? []
  // Paid orders drop off a table bill; keep them for the final receipt.
  const receiptIds = [...new Set([...paidIds, ...ids])]
  const onPaid = (p: Payment) => { setLast(p); setPaidIds((x) => [...new Set([...x, ...p.orders.map((o) => o.id)])]); void load() }

  return (
    <div className="pos-bill-detail">
      <div className="pos-bill-head">
        <button type="button" className="ui-btn ghost" onClick={onBack}><ChevronLeft size={18} /> Bills</button>
        <h2>{bill?.table ? `Table ${bill.table.number}` : bill?.orders[0]?.label ?? 'Bill'}</h2>
        {bill?.billRequestedAt && <span className="ui-pill accent"><BellRing size={12} /> Guest asked for the bill</span>}
        <button type="button" className="ui-btn" style={{ marginInlineStart: 'auto' }} disabled={!receiptIds.length} onClick={() => setReceiptFor(receiptIds)}>
          <ReceiptIcon size={18} /> {bill && bill.due > 0 ? 'Print bill' : 'Receipt'}
        </button>
      </div>
      {err && <p className="ui-alert danger">{err}</p>}
      {last && (
        <p className="ui-alert success" role="status">
          Paid {formatMoney(last.amount, last.currency)}{last.change > 0 ? ` · give ${formatMoney(last.change, base)} change` : ''}
        </p>
      )}
      {bill && (
        <div className="pos-bill-cols">
          <section className="ui-card pos-bill-items">
            {!bill.orders.length && <p className="ui-muted">Nothing left to pay on this bill.</p>}
            {bill.orders.map((o) => (
              <div key={o.id} className="pos-bill-order">
                <div className="pos-bill-order-head">
                  <b>{o.label}</b>
                  <span className="ui-pill">{o.status.replace('_', ' ')}</span>
                  {o.paid > 0 && <span className="ui-pill success">paid {formatMoney(o.paid, base)}</span>}
                  {can(me.role, 'discounts.apply') && (
                    <button type="button" className="ui-btn sm ghost" style={{ marginInlineStart: 'auto' }} onClick={() => setDiscountFor(o.id)}><Percent size={14} /> Discount</button>
                  )}
                </div>
                {o.items.map((i, k) => (
                  <div key={k} className="pos-bill-line"><span>{i.quantity} × {i.name}{i.options && <small>{i.options}</small>}</span><span>{formatMoney(i.lineTotal, base)}</span></div>
                ))}
                {o.discount > 0 && <div className="pos-bill-line discount"><span>Discount · {o.discountReason}</span><span>−{formatMoney(o.discount, base)}</span></div>}
              </div>
            ))}
            <dl className="pos-totals">
              <div><dt>Subtotal</dt><dd>{formatMoney(bill.subtotal, base)}</dd></div>
              {bill.discount > 0 && <div><dt>Discounts</dt><dd>−{formatMoney(bill.discount, base)}</dd></div>}
              {bill.tax > 0 && <div><dt>Tax</dt><dd>{formatMoney(bill.tax, base)}</dd></div>}
              {bill.serviceCharge > 0 && <div><dt>Service</dt><dd>{formatMoney(bill.serviceCharge, base)}</dd></div>}
              <div><dt>Total</dt><dd>{formatMoney(bill.total, base)}</dd></div>
              {bill.paid > 0 && <div><dt>Already paid</dt><dd>−{formatMoney(bill.paid, base)}</dd></div>}
              <div className="pos-total"><dt>Due</dt><dd className="ui-num">{formatMoney(bill.due, base)}</dd></div>
            </dl>
          </section>
          <section className="ui-card pos-pay-card">
            {can(me.role, 'payments.take')
              ? <PaymentPanel orderIds={ids} due={bill.due} config={config} onPaid={onPaid} />
              : <p className="ui-muted">A cashier takes the payment.</p>}
          </section>
        </div>
      )}
      {receiptFor && <ReceiptDialog orderIds={receiptFor} onClose={() => setReceiptFor(null)} />}
      {discountFor && <DiscountDialog orderId={discountFor} config={config} onClose={() => setDiscountFor(null)} onDone={() => { setDiscountFor(null); void load() }} />}
    </div>
  )
}

function DiscountDialog({ orderId, config, onClose, onDone }: { orderId: string; config: PosConfig; onClose: () => void; onDone: () => void }) {
  const { me } = useMe()
  const [kind, setKind] = useState<'percent' | 'amount'>('percent')
  const [value, setValue] = useState('')
  const [reason, setReason] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const limited = !can(me.role, 'orders.override')
  const save = async () => {
    setBusy(true); setErr('')
    try { await api('POST', `/api/staff/orders/${orderId}/discount`, { kind, value: Number(value) || 0, reason }); onDone() }
    catch (e) { setErr(e instanceof ApiErr ? e.message : 'Failed') } finally { setBusy(false) }
  }
  return (
    <div className="ui-overlay" role="dialog" aria-modal="true" aria-label="Discount" onClick={onClose}>
      <div className="ui-dialog" style={{ width: 'min(420px,100%)' }} onClick={(e) => e.stopPropagation()}>
        <header><h2>Discount</h2></header>
        <div className="ui-dialog-body" style={{ display: 'grid', gap: 12 }}>
          <div className="ui-seg" role="group" aria-label="Discount type">
            <button type="button" aria-pressed={kind === 'percent'} onClick={() => setKind('percent')}>Percent</button>
            <button type="button" aria-pressed={kind === 'amount'} onClick={() => setKind('amount')}>Amount ({config.baseCurrency})</button>
          </div>
          <label className="ui-label">{kind === 'percent' ? 'Percent off' : 'Amount off'}
            <input className="ui-input" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, ''))} />
          </label>
          <label className="ui-label">Reason<input className="ui-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Shown on the bill and in the log" /></label>
          {limited && <p className="ui-hint">You can give up to {config.maxCashierDiscountPercent}%. Larger discounts need a manager.</p>}
          <p className="ui-hint">Enter 0 to remove a discount.</p>
          {err && <p className="ui-alert danger">{err}</p>}
        </div>
        <div className="ui-dialog-foot">
          <button type="button" className="ui-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="ui-btn primary" style={{ marginInlineStart: 'auto' }} disabled={busy || value === ''} onClick={save}>Apply</button>
        </div>
      </div>
    </div>
  )
}
