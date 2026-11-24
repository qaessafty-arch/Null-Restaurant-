'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Banknote, CreditCard, Landmark, Globe, Wallet, Check } from 'lucide-react'
import { api, ApiErr } from '@/components/staff/api'
import { formatMoney, fromBase, splitEvenly, toBase, toMajor, toMinor, type Currency } from '@/lib/money'
import type { PosConfig, Payment } from './types'

const METHOD_ICON = { cash: Banknote, card: CreditCard, transfer: Landmark, online: Globe, other: Wallet } as const

/** Quick cash amounts per currency (major units). */
const NOTES: Record<string, number[]> = { IQD: [5000, 10000, 25000, 50000], USD: [5, 10, 20, 50, 100] }

const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`)

/**
 * Takes one payment against a set of orders. Shows the due amount in every accepted currency, splits
 * evenly, works out change for cash, and sends the payment with an idempotency key so a double tap
 * or a retried request cannot charge twice. The server recomputes everything.
 */
export function PaymentPanel({ orderIds, due, config, onPaid }: {
  orderIds: string[]; due: number; config: PosConfig; onPaid: (p: Payment) => void
}) {
  const base = config.baseCurrency as Currency
  const [method, setMethod] = useState(config.methods[0]?.id ?? 'cash')
  const [currency, setCurrency] = useState<Currency>(base)
  const [split, setSplit] = useState(1)
  const [amount, setAmount] = useState('')
  const [tendered, setTendered] = useState('')
  const [reference, setReference] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const key = useRef(newKey())

  const kind = config.methods.find((m) => m.id === method)?.kind ?? 'other'
  const rate = currency === base ? 1 : config.rates[currency] ?? 0
  const share = splitEvenly(due, split)[0]
  const shareIn = (c: Currency) => fromBase(share, c, base, c === base ? 1 : config.rates[c] ?? 0)

  // Reset the amount to "this share, in this currency" whenever the bill, split or currency changes.
  useEffect(() => {
    setAmount(String(toMajor(shareIn(currency), currency)))
    setTendered('')
    key.current = newKey()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [due, split, currency])

  const amountMinor = toMinor(Number(amount) || 0, currency)
  const tenderedMinor = tendered === '' ? null : toMinor(Number(tendered) || 0, currency)
  // Same rule as the server: a foreign amount rounded up to the cent that lands just over the bill counts as the bill.
  const rawBase = rate > 0 ? toBase(amountMinor, currency, base, rate) : 0
  const oneMinor = currency === base ? 0 : Math.ceil(rate / 100)
  const amountBase = rawBase > due && rawBase - due <= oneMinor ? due : rawBase
  const change = useMemo(() => {
    if (kind !== 'cash' || tenderedMinor === null || rate <= 0) return null
    return toBase(tenderedMinor, currency, base, rate) - amountBase
  }, [kind, tenderedMinor, currency, base, rate, amountBase])
  const needsRef = kind === 'transfer' || kind === 'online'
  const short = tenderedMinor !== null && tenderedMinor < amountMinor
  const canPay = due > 0 && amountMinor > 0 && !short && (!needsRef || reference.trim()) && !busy

  const submit = async () => {
    if (!canPay) return
    setBusy(true); setError('')
    try {
      const r = await api<{ payment: Payment }>('POST', '/api/staff/payments', {
        orderIds, method, currency, amount: amountMinor, tendered: kind === 'cash' ? tenderedMinor : null,
        reference: needsRef ? reference.trim() : undefined, idempotencyKey: key.current,
      })
      key.current = newKey()
      setTendered(''); setReference('')
      onPaid(r.payment)
    } catch (e) {
      setError(e instanceof ApiErr ? e.message : 'Could not reach the server. Check the connection and try again; you will not be charged twice.')
    } finally {
      setBusy(false)
    }
  }

  if (due <= 0) return <p className="ui-alert success"><Check size={16} /> Fully paid</p>

  return (
    <div className="pay">
      <div className="pay-due">
        <span className="ui-muted">Due</span>
        <b className="ui-num">{formatMoney(due, base)}</b>
        {config.currencies.filter((c) => c !== base).map((c) => (
          <span key={c} className="ui-pill">{formatMoney(fromBase(due, c as Currency, base, config.rates[c]), c)}</span>
        ))}
      </div>

      <div className="pay-methods" role="group" aria-label="Payment method">
        {config.methods.map((m) => {
          const Icon = METHOD_ICON[m.kind]
          return (
            <button key={m.id} type="button" aria-pressed={m.id === method} onClick={() => { setMethod(m.id); key.current = newKey() }}>
              <Icon size={20} /><span>{m.label}</span>
            </button>
          )
        })}
      </div>

      <div className="pay-row">
        {config.currencies.length > 1 && (
          <div className="ui-seg" role="group" aria-label="Currency">
            {config.currencies.map((c) => (
              <button key={c} type="button" aria-pressed={c === currency} onClick={() => setCurrency(c as Currency)}>{c}</button>
            ))}
          </div>
        )}
        <div className="ui-seg" role="group" aria-label="Split the bill">
          {[1, 2, 3, 4].map((n) => (
            <button key={n} type="button" aria-pressed={n === split} onClick={() => setSplit(n)}>{n === 1 ? 'Full' : `÷ ${n}`}</button>
          ))}
        </div>
      </div>
      {currency !== base && (
        <p className="ui-hint">Rate {config.rates[currency]?.toLocaleString()} {base} per 1 {currency}
          {config.ratesUpdatedAt ? `, set ${new Date(config.ratesUpdatedAt).toLocaleString()}` : ''}</p>
      )}

      <label className="ui-label">
        Amount to pay ({currency}){split > 1 && <span className="ui-hint"> · one of {split} equal shares</span>}
        <input className="ui-input pay-amount" inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value.replace(/[^\d.]/g, '')); key.current = newKey() }} />
      </label>

      {kind === 'cash' && (
        <>
          <label className="ui-label">
            Cash received ({currency})
            <input className="ui-input pay-amount" inputMode="decimal" placeholder="Optional, to work out change" value={tendered}
              onChange={(e) => setTendered(e.target.value.replace(/[^\d.]/g, ''))} />
          </label>
          <div className="pay-notes">
            <button type="button" className="ui-btn sm" onClick={() => setTendered(amount)}>Exact</button>
            {(NOTES[currency] ?? []).filter((n) => toMinor(n, currency) >= amountMinor).slice(0, 4).map((n) => (
              <button key={n} type="button" className="ui-btn sm" onClick={() => setTendered(String(n))}>{formatMoney(toMinor(n, currency), currency)}</button>
            ))}
          </div>
          {change !== null && (
            <div className={`pay-change ${short ? 'short' : ''}`}>
              <span>{short ? 'Not enough' : 'Change'}</span>
              <b className="ui-num">{short ? formatMoney(amountMinor - (tenderedMinor ?? 0), currency) : formatMoney(Math.max(0, change), base)}</b>
            </div>
          )}
        </>
      )}

      {needsRef && (
        <label className="ui-label">
          Transaction reference
          <input className="ui-input" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="From the bank or payment app" />
        </label>
      )}

      {error && <p className="ui-alert danger" role="alert">{error}</p>}
      <button type="button" className="ui-btn primary lg block" disabled={!canPay} onClick={submit}>
        {busy ? 'Processing…' : `Charge ${amountMinor > 0 ? formatMoney(amountMinor, currency) : ''}`}
      </button>
    </div>
  )
}
