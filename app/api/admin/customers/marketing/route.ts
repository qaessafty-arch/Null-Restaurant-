import { route } from '@/lib/server/http'
import { audit, requirePerm } from '@/lib/server/auth'
import { marketingList } from '@/lib/server/customers'
import { toCsv } from '@/lib/server/sheets'

export const dynamic = 'force-dynamic'

/** Only customers who opted in to marketing, with when they did. */
export const GET = route(async () => {
  const staff = await requirePerm('customers.manage')
  const rows = marketingList()
  audit(staff, staff.name, 'export.marketing', '', `${rows.length} opted-in customers`)
  return new Response(toCsv({ name: 'Marketing', head: ['Name', 'Phone', 'Email', 'Birthday', 'Tier', 'Consent given (UTC)'], rows: rows.map((r) => [r.name, r.phone, r.email, r.birthday, r.tier, r.consent_at]) }),
    { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="opted-in-customers.csv"', 'Cache-Control': 'no-store' } })
})
