import { ApiError, route } from '@/lib/server/http'
import { audit, requirePerm } from '@/lib/server/auth'
import { parseRange, REPORTS, sheetsFor, type ReportName } from '@/lib/server/finance'
import { toCsv, toXlsx } from '@/lib/server/sheets'

export const dynamic = 'force-dynamic'

/** ?report=summary|daily|products|...|all&format=csv|xlsx&from=&to=. CSV is one report; xlsx can hold all. */
export const GET = route(async (req) => {
  const staff = await requirePerm('reports.view')
  const q = new URL(req.url).searchParams
  const name = (q.get('report') ?? 'summary') as ReportName | 'all'
  if (name !== 'all' && !(REPORTS as readonly string[]).includes(name)) throw new ApiError(400, 'Unknown report', 'invalid')
  const format = q.get('format') === 'xlsx' ? 'xlsx' : 'csv'
  if (format === 'csv' && name === 'all') throw new ApiError(400, 'CSV holds one report at a time; use Excel for all of them', 'invalid')
  const r = parseRange(q.get('from'), q.get('to'))
  const sheets = sheetsFor(name, r)
  audit(staff, staff.name, `export.${name}`, `${r.from}..${r.to}`, format)
  const file = `${name}-${r.from}${r.to !== r.from ? `_${r.to}` : ''}`
  if (format === 'xlsx') {
    return new Response(new Uint8Array(toXlsx(sheets)), { headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${file}.xlsx"`, 'Cache-Control': 'no-store' } })
  }
  return new Response(toCsv(sheets[0]), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${file}.csv"`, 'Cache-Control': 'no-store' } })
})
