'use client'

import { useEffect, useState } from 'react'
import { Printer, X } from 'lucide-react'
import { api, ApiErr } from '@/components/staff/api'
import { formatMoney } from '@/lib/money'
import type { Receipt } from './types'

/**
 * Receipt preview + print. Sized for 80mm thermal paper; the print stylesheet hides everything
 * else on the page. Opening it records a print (and logs reprints) on the server.
 */
export function ReceiptDialog({ orderIds, onClose }: { orderIds: string[]; onClose: () => void }) {
  const [r, setR] = useState<Receipt | null>(null)
  const [error, setError] = useState('')
  const ids = orderIds.join(',')
  useEffect(() => {
    api<Receipt>('POST', '/api/staff/receipts', { orderIds: ids.split(',') })
      .then(setR).catch((e) => setError(e instanceof ApiErr ? e.message : 'Could not load the receipt'))
  }, [ids])
  const c = r?.restaurant.currency ?? 'IQD'
  const m = (n: number) => formatMoney(n, c)

  return (
    <div className="ui-overlay" role="dialog" aria-modal="true" aria-label="Receipt" onClick={onClose}>
      <div className="ui-dialog receipt-dialog" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>Receipt</h2>
          <button type="button" className="ui-icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>
        <div className="ui-dialog-body">
          {error && <p className="ui-alert danger">{error}</p>}
          {!r && !error && <p className="ui-muted">Preparing…</p>}
          {r && (
            <article className="receipt" id="receipt-print">
              <h3>{r.restaurant.name}</h3>
              {r.restaurant.header && <p className="rc-center">{r.restaurant.header}</p>}
              {r.reprint && <p className="rc-center rc-strong">REPRINT</p>}
              <p className="rc-meta">
                <span>{new Date(r.printedAt).toLocaleString('en-GB')}</span>
                {r.tableNumber && <span>Table {r.tableNumber}</span>}
                <span>{r.orders.map((o) => o.label).join(', ')}</span>
                <span>Served by {r.cashier}</span>
              </p>
              <hr />
              {r.orders.flatMap((o) => o.items.map((i, k) => (
                <div key={`${o.id}-${k}`} className="rc-line">
                  <span>{i.quantity} × {i.name}{i.options && <small>{i.options}</small>}</span>
                  <span>{m(i.lineTotal)}</span>
                </div>
              )))}
              <hr />
              <div className="rc-line"><span>Subtotal</span><span>{m(r.subtotal)}</span></div>
              {r.discount > 0 && <div className="rc-line"><span>Discount</span><span>−{m(r.discount)}</span></div>}
              {r.loyaltyDiscount > 0 && <div className="rc-line"><span>Loyalty points ({r.orders.reduce((a, o) => a + o.loyaltyPoints, 0)})</span><span>−{m(r.loyaltyDiscount)}</span></div>}
              {r.tax > 0 && <div className="rc-line"><span>Tax</span><span>{m(r.tax)}</span></div>}
              {r.serviceCharge > 0 && <div className="rc-line"><span>Service</span><span>{m(r.serviceCharge)}</span></div>}
              <div className="rc-line rc-total"><span>Total</span><span>{m(r.total)}</span></div>
              {r.payments.length > 0 && <hr />}
              {r.payments.map((p) => (
                <div key={p.id} className="rc-line">
                  <span>{p.kind === 'refund' ? 'Refund' : 'Paid'} · {p.method}{p.currency !== c ? ` (${formatMoney(p.amount, p.currency)} @ ${p.rate})` : ''}</span>
                  <span>{p.kind === 'refund' ? '−' : ''}{m(p.baseAmount)}</span>
                </div>
              ))}
              {r.payments.some((p) => p.change > 0) && (
                <div className="rc-line"><span>Change given</span><span>{m(r.payments.reduce((a, p) => a + p.change, 0))}</span></div>
              )}
              <div className="rc-line rc-total"><span>{r.due > 0 ? 'Balance due' : 'Paid in full'}</span><span>{m(r.due)}</span></div>
              {r.orders.some((o) => o.customer) && (
                <p className="rc-center">{r.orders.find((o) => o.customer)!.customer!.name}: {r.orders.reduce((a, o) => a + o.pointsEarned, 0)} points earned · balance {r.orders.find((o) => o.customer)!.customer!.points}</p>
              )}
              {r.restaurant.footer && <p className="rc-center">{r.restaurant.footer}</p>}
            </article>
          )}
        </div>
        <div className="ui-dialog-foot">
          <button type="button" className="ui-btn" onClick={onClose}>Close</button>
          <button type="button" className="ui-btn primary" style={{ marginInlineStart: 'auto' }} disabled={!r} onClick={() => window.print()}>
            <Printer size={18} /> Print
          </button>
        </div>
      </div>
    </div>
  )
}
