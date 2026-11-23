'use client'

import { useCallback, useEffect, useState } from 'react'
import { ShoppingBag, ReceiptText, History } from 'lucide-react'
import { StaffShell, useLive, useMe } from '@/components/staff/shell'
import { api, ApiErr } from '@/components/staff/api'
import { can } from '@/lib/permissions'
import { OrderScreen } from '@/components/pos/order-screen'
import { BillsScreen, type BillRef } from '@/components/pos/bills-screen'
import { HistoryScreen } from '@/components/pos/history-screen'
import type { OpenBill, PosConfig } from '@/components/pos/types'

export default function PosPage() {
  return <StaffShell perm={['pos.order', 'payments.take']} title="Point of sale" wide><Pos /></StaffShell>
}

type Tab = 'order' | 'bills' | 'history'

function Pos() {
  const { me } = useMe()
  const [config, setConfig] = useState<PosConfig | null>(null)
  const [err, setErr] = useState('')
  const [tab, setTab] = useState<Tab>(can(me.role, 'pos.order') ? 'order' : 'bills')
  const [openBill, setOpenBill] = useState<BillRef | null>(null)
  const [asking, setAsking] = useState(0)

  useEffect(() => {
    api<PosConfig>('GET', '/api/staff/pos/config').then(setConfig).catch((e) => setErr(e instanceof ApiErr ? e.message : 'Could not load the POS'))
  }, [])
  const countAsking = useCallback(async () => {
    if (!can(me.role, 'payments.take')) return
    try { setAsking((await api<{ bills: OpenBill[] }>('GET', '/api/staff/bills')).bills.filter((b) => b.billRequestedAt).length) } catch { /* shown in tab */ }
  }, [me.role])
  useLive(countAsking, 10000)

  if (err) return <main className="pos themed"><p className="ui-alert danger">{err}</p></main>
  if (!config) return <main className="pos themed"><p className="ui-muted">Loading…</p></main>

  const tabs: Array<{ id: Tab; label: string; icon: typeof ShoppingBag; show: boolean; badge?: number }> = [
    { id: 'order', label: 'New order', icon: ShoppingBag, show: can(me.role, 'pos.order') },
    { id: 'bills', label: 'Bills', icon: ReceiptText, show: can(me.role, 'payments.take'), badge: asking },
    { id: 'history', label: 'Transactions', icon: History, show: can(me.role, 'payments.take') },
  ]
  return (
    <main className="pos themed">
      <nav className="pos-tabs" role="tablist" aria-label="Point of sale">
        {tabs.filter((t) => t.show).map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => { setTab(t.id); if (t.id !== 'bills') setOpenBill(null) }}>
            <t.icon size={18} /> {t.label}{t.badge ? <i aria-label={`${t.badge} asking for the bill`}>{t.badge}</i> : null}
          </button>
        ))}
      </nav>
      {tab === 'order' && <OrderScreen config={config} onCharge={can(me.role, 'payments.take') ? (id) => { setOpenBill({ kind: 'order', orderId: id }); setTab('bills') } : null} />}
      {tab === 'bills' && <BillsScreen config={config} open={openBill} setOpen={setOpenBill} />}
      {tab === 'history' && <HistoryScreen config={config} />}
    </main>
  )
}
