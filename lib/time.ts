/**
 * Restaurant-local time <-> UTC. The database stores UTC as "YYYY-MM-DD HH:MM:SS" (SQLite's datetime()
 * format); opening hours and reservation slots are in the restaurant's timezone setting.
 * No dependencies, so tests can import it directly.
 */

/** Minutes the zone is ahead of UTC at that instant (Asia/Baghdad -> 180). */
export function tzOffsetMinutes(at: Date, timeZone: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(at).filter((x) => x.type !== 'literal').map((x) => [x.type, Number(x.value)]),
  ) as Record<string, number>
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000)
}

/** Local wall-clock date + "HH:MM" (minutes may exceed 24h for after-midnight closing) -> UTC instant. */
export function localToUtc(date: string, minutesOfDay: number, timeZone: string) {
  const [y, m, d] = date.split('-').map(Number)
  const guess = Date.UTC(y, m - 1, d, 0, minutesOfDay)
  let utc = guess - tzOffsetMinutes(new Date(guess), timeZone) * 60000
  const second = guess - tzOffsetMinutes(new Date(utc), timeZone) * 60000 // settles DST edges
  if (second !== utc) utc = second
  return new Date(utc)
}

export const toSql = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ')
export const fromSql = (s: string) => new Date(s.replace(' ', 'T') + 'Z')
export const hhmm = (t: string) => { const [a, b] = t.split(':').map(Number); return a * 60 + (b || 0) }

/** The restaurant's local date ("YYYY-MM-DD") at an instant. */
export function localDate(at: Date, timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
}
/** Local "HH:MM" at an instant. */
export function localClock(at: Date, timeZone: string) {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at)
}

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
export function weekdayOf(date: string) {
  const [y, m, d] = date.split('-').map(Number)
  return DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
}

/** Opening window for a local date as UTC instants, or null when closed. Handles closing after midnight. */
export function openingWindow(date: string, hours: Array<{ day: string; open: string; close: string; closed: boolean }>, timeZone: string) {
  const h = hours.find((x) => x.day === weekdayOf(date))
  if (!h || h.closed) return null
  const open = hhmm(h.open)
  let close = hhmm(h.close)
  if (close <= open) close += 24 * 60
  return { open: localToUtc(date, open, timeZone), close: localToUtc(date, close, timeZone) }
}
