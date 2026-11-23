'use client'

import Link from 'next/link'
import { Flame, MapPin } from 'lucide-react'
import { OrderingProvider, useOrdering } from '@/components/ordering/provider'
import { FullMenu, CartBar } from '@/components/ordering/menu-section'
import { ItemSheet } from '@/components/ordering/item-sheet'
import { CartSheet } from '@/components/ordering/cart-sheet'
import { ServiceFab } from '@/components/ordering/service-fab'
import { TableBanner } from '@/components/ordering/table-gate'
import { tr, type Lang } from '@/components/ordering/i18n'
import { LANGS, useLang } from '@/components/ordering/use-lang'

/**
 * The table ordering app. A table QR lands here: a focused, full-screen menu with the cart and
 * table services, using the same ordering components and APIs as the website's menu section.
 */
export default function MenuApp() {
  const [lang, setLang] = useLang()
  return (
    <OrderingProvider lang={lang}>
      <App lang={lang} setLang={setLang} />
    </OrderingProvider>
  )
}

function App({ lang, setLang }: { lang: Lang; setLang: (l: Lang) => void }) {
  const { settings, session } = useOrdering()
  const rtl = lang !== 'EN'
  const table = session?.table
  return (
    <div className="am" dir={rtl ? 'rtl' : 'ltr'} lang={LANGS.find((l) => l.id === lang)!.html}>
      <header className="am-top">
        <Link href="/" className="am-brand" aria-label={tr(lang, 'website')}>
          <span className="brand-mark sm" aria-hidden="true"><Flame size={14} fill="currentColor" /></span>
          <b>{settings?.restaurantName ?? ''}</b>
        </Link>
        <div className="ui-seg am-lang" role="group" aria-label={tr(lang, 'language')}>
          {LANGS.map((l) => (
            <button key={l.id} type="button" aria-pressed={lang === l.id} onClick={() => setLang(l.id)} aria-label={l.label} lang={l.html}>{l.short}</button>
          ))}
        </div>
      </header>

      <section className="am-hero">
        <p className="am-eyebrow">{tr(lang, 'welcome')}</p>
        <h1>{table ? <>{tr(lang, 'table')} {table.number}</> : tr(lang, 'menuTitle')}</h1>
        <p className="am-sub">
          {table?.location && <span><MapPin size={14} aria-hidden="true" /> {table.location}</span>}
          {settings && <span className={`am-open ${settings.isOpen ? 'on' : ''}`}><i aria-hidden="true" />{settings.isOpen ? tr(lang, 'openNow') : tr(lang, 'closedNow')}</span>}
        </p>
        <p className="am-hint">{tr(lang, 'browseHint')}</p>
        {!table && <TableBanner />}
      </section>

      <FullMenu variant="app" eyebrow="" title="" />

      <ItemSheet />
      <CartSheet />
      <CartBar />
      <ServiceFab />
    </div>
  )
}
