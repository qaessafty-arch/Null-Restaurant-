/**
 * Role-based access control. Shared by the server (enforcement) and the browser (hiding controls the
 * server would refuse anyway). Every protected API handler calls `requirePerm` with one of these.
 */

export const ROLES = ['owner', 'admin', 'manager', 'cashier', 'waiter', 'kitchen', 'inventory', 'receptionist'] as const
export type Role = (typeof ROLES)[number]

export const ROLE_LABEL: Record<Role, string> = {
  owner: 'Owner',
  admin: 'Administrator',
  manager: 'General manager',
  cashier: 'Cashier',
  waiter: 'Waiter',
  kitchen: 'Kitchen staff',
  inventory: 'Inventory manager',
  receptionist: 'Receptionist',
}

export const PERMISSIONS = {
  'orders.view': 'See live orders',
  'orders.serve': 'Verify, confirm, serve and complete orders',
  'orders.override': 'Cancel orders that are already cooking',
  'kitchen.operate': 'Use the kitchen display',
  'requests.handle': 'Handle guest requests',
  'pos.order': 'Create orders at the POS',
  'payments.take': 'Take payments and print receipts',
  'payments.refund': 'Void and refund payments',
  'discounts.apply': 'Apply discounts',
  'tables.view': 'See the floor and table status',
  'tables.manage': 'Add, move and configure tables and QR codes',
  'reservations.manage': 'Manage reservations',
  'menu.manage': 'Edit the menu, prices and availability',
  'inventory.manage': 'Manage stock, recipes, suppliers and purchases',
  'customers.view': 'Look up customers',
  'customers.manage': 'Edit customers and loyalty',
  'reports.view': 'See sales and financial reports',
  'finance.manage': 'Record expenses',
  'switches.manage': 'Pause ordering and guest requests',
  'staff.manage': 'Manage staff accounts and shifts',
  'settings.manage': 'Change restaurant settings',
  'audit.view': 'Read the activity log',
} as const
export type Permission = keyof typeof PERMISSIONS

const ALL = Object.keys(PERMISSIONS) as Permission[]

const GRANTS: Record<Role, Permission[]> = {
  owner: ALL,
  admin: ALL,
  manager: ALL.filter((p) => p !== 'settings.manage' && p !== 'staff.manage' && p !== 'audit.view'),
  cashier: [
    'orders.view', 'requests.handle', 'pos.order', 'payments.take', 'discounts.apply', 'tables.view',
    'customers.view', 'customers.manage',
  ],
  waiter: ['orders.view', 'orders.serve', 'requests.handle', 'pos.order', 'tables.view', 'reservations.manage', 'customers.view'],
  kitchen: ['kitchen.operate'],
  inventory: ['inventory.manage', 'menu.manage'],
  receptionist: ['reservations.manage', 'tables.view', 'customers.view', 'customers.manage', 'requests.handle'],
}

export function can(role: Role | string | undefined | null, perm: Permission): boolean {
  return !!role && (GRANTS[role as Role]?.includes(perm) ?? false)
}

export function permissionsOf(role: Role | string): Permission[] {
  return GRANTS[role as Role] ?? []
}

/** Roles that may hold the keys to everything; at least one must stay active. */
export const SUPER_ROLES: Role[] = ['owner', 'admin']

/** Where a role lands after signing in. */
export function homeFor(role: Role | string): string {
  if (can(role, 'reports.view') || can(role, 'settings.manage')) return '/admin'
  if (role === 'kitchen') return '/staff/kitchen'
  if (role === 'cashier') return '/staff/pos'
  if (role === 'waiter') return '/staff/waiter'
  if (role === 'inventory') return '/admin/inventory'
  if (role === 'receptionist') return '/admin/reservations'
  return '/staff/login'
}

/** Notification audiences. Each notification targets one audience; roles read the audiences listed here. */
export const AUDIENCES = ['waiter', 'kitchen', 'cashier', 'inventory', 'reception', 'admin'] as const
export type Audience = (typeof AUDIENCES)[number]

export function audiencesFor(role: Role | string): Audience[] {
  switch (role) {
    case 'owner': case 'admin': case 'manager': return [...AUDIENCES]
    case 'kitchen': return ['kitchen']
    case 'waiter': return ['waiter']
    case 'cashier': return ['cashier']
    case 'inventory': return ['inventory']
    case 'receptionist': return ['reception']
    default: return []
  }
}

/** Order workflow steps: holders of `orders.override` (managers) may also do any waiter or kitchen step. */
export function canDoStep(role: Role | string, needed: Permission) {
  return can(role, needed) || (needed !== 'orders.override' && can(role, 'orders.override'))
}
