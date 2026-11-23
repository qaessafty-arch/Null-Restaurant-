'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { BarChart3, ClipboardList, Grid2x2, History, Settings, UtensilsCrossed, Users, ChefHat, ConciergeBell, LayoutDashboard, CalendarDays, ShoppingBag, Boxes, Wallet } from 'lucide-react'
import { StaffShell, useMe } from '@/components/staff/shell'
import { can, homeFor, type Permission } from '@/lib/permissions'

const NAV: Array<{ href: string; label: string; icon: typeof BarChart3; perm: Permission }> = [
  { href: '/admin', label: 'Dashboard', icon: BarChart3, perm: 'reports.view' },
  { href: '/admin/finance', label: 'Finance', icon: Wallet, perm: 'reports.view' },
  { href: '/admin/floor', label: 'Floor', icon: LayoutDashboard, perm: 'tables.view' },
  { href: '/admin/reservations', label: 'Reservations', icon: CalendarDays, perm: 'reservations.manage' },
  { href: '/admin/orders', label: 'Orders', icon: ClipboardList, perm: 'orders.view' },
  { href: '/admin/menu', label: 'Menu', icon: UtensilsCrossed, perm: 'menu.manage' },
  { href: '/admin/inventory', label: 'Inventory', icon: Boxes, perm: 'inventory.manage' },
  { href: '/admin/tables', label: 'Tables & QR', icon: Grid2x2, perm: 'tables.manage' },
  { href: '/admin/staff', label: 'Staff', icon: Users, perm: 'staff.manage' },
  { href: '/admin/settings', label: 'Settings', icon: Settings, perm: 'settings.manage' },
  { href: '/admin/audit', label: 'Activity log', icon: History, perm: 'audit.view' },
]

function Nav() {
  const path = usePathname()
  const router = useRouter()
  const { me } = useMe()
  // A page this role cannot use goes to the role's own home instead of a screen full of errors.
  const here = NAV.find((n) => n.href === path)
  useEffect(() => { if (here && !can(me.role, here.perm)) router.replace(homeFor(me.role)) }, [here, me.role, router])
  return (
    <nav className="ad-nav" aria-label="Admin">
      {NAV.filter((n) => can(me.role, n.perm)).map((n) => (
        <Link key={n.href} href={n.href} aria-current={path === n.href ? 'page' : undefined}><n.icon size={18} /><span>{n.label}</span></Link>
      ))}
      <hr />
      {can(me.role, 'orders.serve') && <Link href="/staff/waiter"><ConciergeBell size={18} /><span>Waiter view</span></Link>}
      {can(me.role, 'kitchen.operate') && <Link href="/staff/kitchen"><ChefHat size={18} /><span>Kitchen view</span></Link>}
      {(can(me.role, 'pos.order') || can(me.role, 'payments.take')) && <Link href="/staff/pos"><ShoppingBag size={18} /><span>Point of sale</span></Link>}
    </nav>
  )
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <StaffShell perm={['reports.view', 'menu.manage', 'tables.manage', 'tables.view', 'staff.manage', 'settings.manage', 'inventory.manage', 'reservations.manage']} title="Restaurant admin" wide>
      <div className="ad-layout">
        <Nav />
        <main className="ad-main">{children}</main>
      </div>
    </StaffShell>
  )
}
