/**
 * One spelling per phone number, so "+964 750 123 4567", "00964-750-123-4567" and "0750 123 4567"
 * are the same customer. Iraqi numbers are stored in local form (07XXXXXXXXX); anything else keeps
 * its international form (+CC...). Returns null when it cannot be a phone number.
 */
export function normalizePhone(input: unknown): string | null {
  if (typeof input !== 'string' && typeof input !== 'number') return null
  let s = String(input).trim()
  const plus = s.startsWith('+')
  s = s.replace(/\D/g, '')
  if (!plus && s.startsWith('00')) s = s.slice(2)
  else if (!plus && s.startsWith('0')) return /^0\d{6,14}$/.test(s) ? s : null
  if (s.startsWith('964')) {
    const local = `0${s.slice(3).replace(/^0/, '')}`
    return /^0\d{9,11}$/.test(local) ? local : null
  }
  if (!plus && !/^\d{8,15}$/.test(s)) return null
  return /^\d{7,15}$/.test(s) ? `+${s}` : null
}

/** "0750•••4567" for staff who may know a guest is a regular but need not read their number. */
export const maskPhone = (p: string) => (p.length > 6 ? `${p.slice(0, 4)}${'•'.repeat(Math.max(3, p.length - 7))}${p.slice(-3)}` : '•••')
