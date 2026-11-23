'use client'

import { useEffect, useState } from 'react'
import type { Lang } from './i18n'

/** The guest's language, shared by the website, the table menu and order tracking (saved per device). */
export function useLang(): [Lang, (l: Lang) => void] {
  const [lang, setState] = useState<Lang>('EN')
  useEffect(() => {
    try {
      const saved = localStorage.getItem('sb_lang')
      if (saved === 'EN' || saved === 'KU' || saved === 'AR') setState(saved)
    } catch { /* private mode */ }
  }, [])
  const set = (l: Lang) => {
    setState(l)
    try { localStorage.setItem('sb_lang', l) } catch { /* private mode */ }
  }
  return [lang, set]
}

export const LANGS: Array<{ id: Lang; short: string; label: string; html: string }> = [
  { id: 'EN', short: 'EN', label: 'English', html: 'en' },
  { id: 'KU', short: 'کو', label: 'کوردی', html: 'ckb' },
  { id: 'AR', short: 'ع', label: 'العربية', html: 'ar' },
]
