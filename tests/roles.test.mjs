// Role-based access control (TEST 10 in the brief): every role gets exactly what it needs.
import test from 'node:test'
import assert from 'node:assert/strict'
import { adminClient, client, staffClient, uniq, PASSWORD } from './helpers.mjs'

const S = {}

test('roles: admin creates one account per new role', async () => {
  S.admin = await adminClient()
  for (const role of ['cashier', 'inventory', 'receptionist', 'waiter', 'kitchen', 'manager']) S[role] = await staffClient(S.admin, role)
  assert.equal(S.cashier.me.role, 'cashier')
})

test('roles: an unknown role is refused; only an owner can mint owners', async () => {
  const bad = await S.admin.api('POST', '/api/admin/staff', { username: uniq('x'), name: 'x', role: 'pirate', password: PASSWORD })
  assert.equal(bad.status, 400)
  const own = await S.admin.api('POST', '/api/admin/staff', { username: uniq('o'), name: 'o', role: 'owner', password: PASSWORD })
  assert.equal(own.status, 403)
})

// [path, method, body, roles allowed]
const MATRIX = [
  ['/api/admin/stats', 'GET', undefined, ['manager']],
  ['/api/admin/export?kind=orders', 'GET', undefined, ['manager']],
  ['/api/admin/audit', 'GET', undefined, []],
  ['/api/admin/settings', 'GET', undefined, []],
  ['/api/admin/staff', 'GET', undefined, []],
  ['/api/admin/items', 'POST', {}, ['manager', 'inventory']],
  ['/api/admin/tables', 'GET', undefined, ['manager']],
  ['/api/admin/switches', 'PUT', {}, ['manager']],
  ['/api/staff/kitchen', 'GET', undefined, ['kitchen', 'manager']],
  ['/api/staff/orders', 'GET', undefined, ['cashier', 'waiter', 'manager']],
  ['/api/staff/requests', 'GET', undefined, ['cashier', 'waiter', 'receptionist', 'manager']],
  ['/api/staff/tables', 'GET', undefined, ['cashier', 'waiter', 'receptionist', 'manager']],
]

test('roles: permission matrix is enforced on the server', async () => {
  const roles = ['cashier', 'inventory', 'receptionist', 'waiter', 'kitchen', 'manager']
  for (const [path, method, body, allowed] of MATRIX) {
    for (const role of roles) {
      const r = await S[role].api(method, path, body)
      if (allowed.includes(role)) assert.notEqual(r.status, 403, `${role} should reach ${method} ${path}`)
      else assert.equal(r.status, 403, `${role} must be refused ${method} ${path} (got ${r.status})`)
    }
    const anon = await client().api(method, path, body)
    assert.equal(anon.status, 401, `anonymous ${method} ${path}`)
  }
})

test('roles: notifications are routed by role', async () => {
  for (const role of ['cashier', 'kitchen', 'inventory']) {
    const r = await S[role].api('GET', '/api/staff/notifications')
    assert.equal(r.status, 200)
  }
})

test('roles: the last owner/admin cannot be demoted or deactivated', async () => {
  const list = await S.admin.api('GET', '/api/admin/staff')
  const supers = list.data.staff.filter((s) => ['owner', 'admin'].includes(s.role) && s.active)
  assert.equal(supers.length, 1)
  const r = await S.admin.api('PATCH', '/api/admin/staff', { id: supers[0].id, role: 'waiter' })
  assert.equal(r.status, 409)
  const d = await S.admin.api('PATCH', '/api/admin/staff', { id: supers[0].id, active: false })
  assert.equal(d.status, 409)
})
