'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import Link from 'next/link'
import { Flame } from 'lucide-react'
import { RT, isRtl, type Lang } from './i18n'

const Ctx = createContext<{ lang: Lang; t: (typeof RT)['EN'] }>({ lang: 'EN', t: RT.EN })
export const useT = () => useContext(Ctx)

/** Public page chrome in the site's brand, sharing the homepage's language choice (and RTL). */
export function PublicShell({ children }: { children: React.ReactNode }) {
  const [lang, setLang] = useState<Lang>('EN')
  useEffect(() => {
    try { const s = localStorage.getItem('sb_lang'); if (s === 'EN' || s === 'KU' || s === 'AR') setLang(s) } catch { /* private mode */ }
  }, [])
  const pick = (l: Lang) => { setLang(l); try { localStorage.setItem('sb_lang', l) } catch { /* ignore */ } }
  const t = RT[lang] as (typeof RT)['EN']
  return (
    <Ctx.Provider value={{ lang, t }}>
      <div className="pub themed" dir={isRtl(lang) ? 'rtl' : 'ltr'} lang={lang === 'EN' ? 'en' : lang === 'KU' ? 'ckb' : 'ar'}>
        <header className="pub-top">
          <Link href="/" className="brand" aria-label="Smashed Burger home">
            <span className="brand-mark"><Flame size={19} fill="currentColor" /></span>
            <span>SMASHED<br /><b>BURGER</b></span>
          </Link>
          <div className="languages" role="group" aria-label="Language">
            {(['EN', 'KU', 'AR'] as const).map((l) => (
              <button key={l} type="button" className={l === lang ? 'active' : ''} aria-pressed={l === lang} onClick={() => pick(l)}>{l === 'KU' ? 'کوردی' : l === 'AR' ? 'عربي' : 'EN'}</button>
            ))}
          </div>
        </header>
        {children}
      </div>
    </Ctx.Provider>
  )
}
