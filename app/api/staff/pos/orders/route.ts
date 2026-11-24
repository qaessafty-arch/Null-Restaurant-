import { body, json, limit, route } from '@/lib/server/http'
import { requirePerm } from '@/lib/server/auth'
import { createStaffOrder, type StaffOrderInput } from '@/lib/server/pos'
import { orderBill } from '@/lib/server/payments'

export const dynamic = 'force-dynamic'

export const POST = route(async (req) => {
  const staff = await requirePerm('pos.order')
  limit(`pos:${staff.id}`, 120, 60_000)
  const r = createStaffOrder(staff, await body<StaffOrderInput>(req))
  return json({ id: r.publicId, duplicate: r.duplicate, trackToken: r.trackToken, bill: orderBill(r.publicId) }, { status: r.duplicate ? 200 : 201 })
})
