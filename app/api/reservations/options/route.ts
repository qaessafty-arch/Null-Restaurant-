import { json, route } from '@/lib/server/http'
import { all } from '@/lib/server/db'
import { getSettings } from '@/lib/server/settings'
import { localDate } from '@/lib/time'

export const dynamic = 'force-dynamic'

/** What the public booking form needs. */
export const GET = route(async () => {
  const s = getSettings()
  return json({
    enabled: s.reservationsEnabled, maxParty: s.reservationMaxParty, maxDays: s.reservationMaxDays, durationMinutes: s.reservationDurationMinutes,
    today: localDate(new Date(), s.timezone), timezone: s.timezone, phone: s.whatsapp,
    sections: all<{ id: number; name: string }>(`SELECT DISTINCT sc.id, sc.name FROM sections sc JOIN tables t ON t.section_id = sc.id AND t.active = 1 ORDER BY sc.sort`),
  })
})
