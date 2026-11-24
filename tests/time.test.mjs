// Restaurant-local time conversions. No server needed.
import test from 'node:test'
import assert from 'node:assert/strict'
import { localToUtc, openingWindow, localDate, tzOffsetMinutes } from '../lib/time.ts'

test('local wall-clock time converts to the right UTC instant', () => {
  assert.equal(localToUtc('2026-03-01', 19 * 60, 'Asia/Baghdad').toISOString(), '2026-03-01T16:00:00.000Z')
  assert.equal(tzOffsetMinutes(new Date('2026-07-01T00:00:00Z'), 'Asia/Baghdad'), 180)
  // Across a DST change: London is UTC+0 in January, UTC+1 in July.
  assert.equal(localToUtc('2026-01-15', 12 * 60, 'Europe/London').toISOString(), '2026-01-15T12:00:00.000Z')
  assert.equal(localToUtc('2026-07-15', 12 * 60, 'Europe/London').toISOString(), '2026-07-15T11:00:00.000Z')
})

test('opening hours that end at or after midnight stay on the same business day', () => {
  const hours = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((day) => ({ day, open: '18:00', close: '02:00', closed: day === 'mon' }))
  const w = openingWindow('2026-03-01', hours, 'Asia/Baghdad') // a Sunday
  assert.equal(w.open.toISOString(), '2026-03-01T15:00:00.000Z')
  assert.equal(w.close.toISOString(), '2026-03-01T23:00:00.000Z') // 02:00 local next day
  assert.equal(openingWindow('2026-03-02', hours, 'Asia/Baghdad'), null) // Monday closed
  const midnight = openingWindow('2026-03-01', hours.map((h) => ({ ...h, open: '11:00', close: '24:00' })), 'Asia/Baghdad')
  assert.equal(midnight.close.toISOString(), '2026-03-01T21:00:00.000Z')
})

test('local date follows the restaurant, not the server', () => {
  assert.equal(localDate(new Date('2026-03-01T22:30:00Z'), 'Asia/Baghdad'), '2026-03-02')
  assert.equal(localDate(new Date('2026-03-01T22:30:00Z'), 'UTC'), '2026-03-01')
})
