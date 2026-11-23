'use client'

import { createContext, useContext } from 'react'
import Link from 'next/link'
import { Flame } from 'lucide-react'
import { RT, isRtl, type Lang } from './i18n'
import { LANGS, useLang } from '@/components/ordering/use-lang'

const Ctx = createContext<{ lang: Lang; t: (typeof RT)['EN'] }>({ lang: 'EN', t: RT.EN })
export const useT = () => useContext(Ctx)

/** Public page chrome in the site's brand, sharing the homepage's language choice (and RTL). */
export function PublicShell({ children }: { children: React.ReactNode }) {
  const [lang, setLang] = useLang()
  const t = RT[lang] as (typeof RT)['EN']
  return (
    <Ctx.Provider value={{ lang, t }}>
      <div className="pub" dir={isRtl(lang) ? 'rtl' : 'ltr'} lang={LANGS.find((l) => l.id === lang)!.html}>
        <header className="pub-top">
          <Link href="/" className="site-brand" aria-label="Smashed Burger home">
            <span className="brand-mark sm" aria-hidden="true"><Flame size={14} fill="currentColor" /></span>
            <b>Smashed Burger</b>
          </Link>
          <div className="ui-seg" role="group" aria-label="Language">
            {LANGS.map((l) => (
              <button key={l.id} type="button" aria-pressed={l.id === lang} onClick={() => setLang(l.id)} lang={l.html}>{l.label === 'English' ? 'EN' : l.label}</button>
            ))}
          </div>
        </header>
        {children}
      </div>
    </Ctx.Provider>
  )
}
