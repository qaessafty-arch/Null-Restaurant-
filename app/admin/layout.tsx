'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect } from 'react'
import {
  LayoutGrid, ClipboardList, ShoppingBag, ChefHat, Map as MapIcon, CalendarDays, ConciergeBell,
  UtensilsCrossed, Boxes, Contact, Users, QrCode, Wallet, Settings, History,
} from 'lucide-react'
import { StaffShell, useMe } from '@/components/staff/shell'
import type { Destination } from '@/components/staff/chrome'
import { can, homeFor, type Permission, type Role } from '@/lib/permissions'

type Item = { href: string; label: string; icon: Destination['icon']; ok: (role: Role) => boolean }
const p = (perm: Permission) => (role: Role) => can(role, perm)

/** The admin map. Screens outside /admin (POS, kitchen, waiter) open in their own full-screen apps. */
const GROUPS: Array<{ label: string; items: Item[] }> = [
  { label: 'Overview', items: [
    { href: '/admin', label: 'Dashboard', icon: LayoutGrid, ok: p('reports.view') },
  ] },
  { label: 'Operations', items: [
    { href: '/admin/orders', label: 'Orders', icon: ClipboardList, ok: p('orders.view') },
    { href: '/staff/pos', label: 'Point of sale', icon: ShoppingBag, ok: (r) => can(r, 'pos.order') || can(r, 'payments.take') },
    { href: '/staff/kitchen', label: 'Kitchen display', icon: ChefHat, ok: p('kitchen.operate') },
    { href: '/staff/waiter', label: 'Waiter view', icon: ConciergeBell, ok: p('orders.serve') },
    { href: '/admin/floor', label: 'Floor plan', icon: MapIcon, ok: p('tables.view') },
    { href: '/admin/reservations', label: 'Reservations', icon: CalendarDays, ok: p('reservations.manage') },
  ] },
  { label: 'Management', items: [
    { href: '/admin/menu', label: 'Menu', icon: UtensilsCrossed, ok: p('menu.manage') },
    { href: '/admin/inventory', label: 'Inventory', icon: Boxes, ok: p('inventory.manage') },
    { href: '/admin/customers', label: 'Customers', icon: Contact, ok: p('customers.view') },
    { href: '/admin/staff', label: 'Staff', icon: Users, ok: p('staff.manage') },
    { href: '/admin/tables', label: 'Tables & QR codes', icon: QrCode, ok: p('tables.manage') },
  ] },
  { label: 'Business', items: [
    { href: '/admin/finance', label: 'Finance & reports', icon: Wallet, ok: p('reports.view') },
  ] },
  { label: 'System', items: [
    { href: '/admin/settings', label: 'Settings', icon: Settings, ok: p('settings.manage') },
    { href: '/admin/audit', label: 'Activity log', icon: History, ok: p('audit.view') },
  ] },
]
const ALL = GROUPS.flatMap((g) => g.items.map((i) => ({ ...i, group: g.label })))

function Sidebar({ close }: { close: () => void }) {
  const path = usePathname()
  const { me } = useMe()
  return (
    <nav className="ad-nav">
      {GROUPS.map((g) => {
        const items = g.items.filter((i) => i.ok(me.role))
        if (!items.length) return null
        return (
          <div key={g.label} className="ad-nav-group">
            <p>{g.label}</p>
            {items.map((i) => (
              <Link key={i.href} href={i.href} onClick={close} aria-current={path === i.href ? 'page' : undefined} data-tip={i.label}>
                <i.icon size={18} aria-hidden="true" /><span>{i.label}</span>
              </Link>
            ))}
          </div>
        )
      })}
    </nav>
  )
}

function Guard() {
  const path = usePathname()
  const router = useRouter()
  const { me } = useMe()
  // A page this role cannot use goes to the role's own home instead of a screen full of errors.
  const here = ALL.find((n) => n.href === path)
  useEffect(() => { if (here && !here.ok(me.role)) router.replace(homeFor(me.role)) }, [here, me.role, router])
  return null
}

function Crumbs() {
  const path = usePathname()
  const here = ALL.find((n) => n.href === path)
  if (!here) return null
  return (
    <nav aria-label="Breadcrumb" className="ad-crumbs">
      <span>{here.group}</span><span aria-hidden="true">/</span><b aria-current="page">{here.label}</b>
    </nav>
  )
}

const destinations = (me: { role: Role }): Destination[] =>
  ALL.filter((i) => i.ok(me.role)).map(({ href, label, group, icon }) => ({ href, label, group, icon }))

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <StaffShell
      perm={['reports.view', 'menu.manage', 'tables.manage', 'tables.view', 'staff.manage', 'settings.manage', 'inventory.manage', 'reservations.manage', 'customers.view']}
      title="Restaurant admin" wide
      sidebar={(close) => <Sidebar close={close} />}
      crumbs={<Crumbs />}
      search={destinations}
    >
      <Guard />
      <main className="ad-main">{children}</main>
    </StaffShell>
  )
}
