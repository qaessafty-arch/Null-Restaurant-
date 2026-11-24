'use client'

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { ReviewModal } from '@/components/review-modal'
import { OrderingProvider, useOrdering } from '@/components/ordering/provider'
import { FeaturedSection, FullMenu, CartBar } from '@/components/ordering/menu-section'
import { ItemSheet } from '@/components/ordering/item-sheet'
import { CartSheet } from '@/components/ordering/cart-sheet'
import { ServiceFab } from '@/components/ordering/service-fab'
import { LANGS, useLang } from '@/components/ordering/use-lang'
import { tr, type Lang } from '@/components/ordering/i18n'
import { BASE_PATH, STATIC_SITE } from '@/lib/utils'
import {
  ArrowUp, ArrowUpRight, Beef, ChevronRight, Clock3, Flame, MapPin, Menu as MenuIcon, MessageCircle, Phone,
  ShoppingBag, Star, Timer, X, Zap, BadgeCheck, CalendarDays,
} from 'lucide-react'

const LocationMap = dynamic(() => import('@/components/location-map').then((m) => m.LocationMap), {
  ssr: false,
  loading: () => <div className="site-map-loading" />,
})

const MAPS_URL = 'https://maps.google.com/?q=Smash%27d+Burger,+Gulan+Street,+The+Boulevard,+Erbil,+Iraq'
const DEFAULT_WA = '9647500000000'

// Kurdish (Sorani) and Arabic strings were written without a native review; the restaurant should proof them.
const copy = {
  EN: {
    home: 'Home', menu: 'Menu', about: 'Story', reviews: 'Reviews', contact: 'Visit', reserve: 'Book a table',
    order: 'Order now', viewMenu: 'View the menu', myOrder: 'My order', tray: 'Tray', openMenu: 'Open menu', closeMenu: 'Close menu',
    eyebrowLocation: 'Erbil · Kurdistan',
    heroTitle: 'Erbil’s boldest smash burger.',
    heroCopy: 'Fresh beef smashed on a screaming-hot grill. Crispy edges. Oozing cheese. In your hands in 5 minutes.',
    ratings: 'guest ratings', delivery: 'delivery', beef: 'fresh beef',
    systemTitle: 'The Smashed system', systemHead: 'Built like a good product.',
    systemCopy: 'A small-batch burger workflow with a big-screen attitude. Every layer is intentional: crisp edges, warm bread, sharp contrast and zero wasted motion.',
    step1: '100% local beef', step2: 'Cast-iron smash', step3: 'Hot in 5 minutes', today: 'Today',
    featuredEyebrow: 'The good stuff', featuredHead: 'Built for big cravings.', seeFullMenu: 'See the full menu',
    whyTitle: 'Why we smash', whyHead: 'No shortcuts. Just flavour.',
    whyCopy: 'We start with 100% fresh local beef, a screaming hot cast-iron grill and a few minutes to let the magic happen. That’s it. That’s the secret.',
    fullMenuTitle: 'The full lineup', fullMenuHead: 'Make it a meal.',
    aboutTitle: 'Our story', aboutHead: 'The smash matters.',
    aboutP1: 'Smashed Burger started with one obsession: the perfect smash. We hand-press 100% fresh local beef, smash it hard on cast iron, and let the Maillard reaction do the magic.',
    aboutP2: 'No fillers. No shortcuts. Just Erbil’s crispiest, juiciest burger — served fast, served hot, served with pride.',
    aboutQuote: '“Good burgers don’t need explaining.”', aboutAuthor: 'The Smashed Burger crew', aboutAlt: 'Smashed burger on the grill', estYear: 'Est. 2024 · Erbil',
    reviewsEyebrow: 'The word on the street', reviewsHead: 'Love at first bite.', writeReview: 'Write a review',
    noReviews: 'No published reviews yet. Be the first to write one.', verified: 'Verified order', reply: 'Reply from the restaurant', outOf: 'out of 5',
    contactEyebrow: 'Find us in Erbil', contactHead: 'Come hungry.', getDirections: 'Get directions', closed: 'Closed',
    orderDelivery: 'Order delivery', deliveryPaused: 'Delivery paused', whatsapp: 'WhatsApp',
    tagline: 'Bold burgers. Big flavour. Made in Erbil.', staff: 'Staff', rights: 'All rights reserved.', backTop: 'Back to top',
  },
  KU: {
    home: 'سەرەتا', menu: 'مینیۆ', about: 'چیرۆک', reviews: 'هەڵسەنگاندن', contact: 'سەردان', reserve: 'گرتنی مێز',
    order: 'داواکاری بکە', viewMenu: 'مێنیو ببینە', myOrder: 'داواکارییەکەم', tray: 'سەبەتە', openMenu: 'کردنەوەی لیست', closeMenu: 'داخستنی لیست',
    eyebrowLocation: 'هەولێر · کوردستان',
    heroTitle: 'بەهێزترین سمەش بەرگەری هەولێر.',
    heroCopy: 'گۆشتی فرێش لەسەر گریڵی زۆر داغ دەکرێتە سمەش. لێواری کڕیسپی، پەنیری تواوە. لە ٥ خولەکدا لە دەستتایە.',
    ratings: 'هەڵسەنگاندنی میوان', delivery: 'گەیاندنی خێرا', beef: 'گۆشتی خۆماڵی فرێش',
    systemTitle: 'سیستەمی سمەشد', systemHead: 'دروستکراو بە بەرزترین کوالیتی.',
    systemCopy: 'هەموو چینێک لە بەرگەرەکەمان بە بەرنامەیە: لێواری کڕیسپی، نانی گەرم، پەنیری ئەمریکی ئەسڵی و خێرایی لە ئامادەکردن.',
    step1: 'گۆشتی خۆماڵی ١٠٠٪', step2: 'سمەش لەسەر ئاسنی داغ', step3: 'گەرم لە ٥ خولەکدا', today: 'ئەمڕۆ',
    featuredEyebrow: 'باشترینەکانمان', featuredHead: 'بۆ ئارەزووی تامی ڕاستەقینە.', seeFullMenu: 'بینینی هەموو مێنیو',
    whyTitle: 'بۆچی سمەش؟', whyHead: 'بەبێ فێڵ و تەڵەکە. تەنها تامی ئەسڵ.',
    whyCopy: 'بە گۆشتی خۆماڵی ١٠٠٪ دەست پێدەکەین، لەسەر گریڵی ئاسن بە هێز دەیپەستێوین. ئەوەیە نهێنی بەرگەرە بەتامەکەمان.',
    fullMenuTitle: 'تەواوی مێنیو', fullMenuHead: 'ژەمەکەت بکە بە تەواو و بێ وێنە.',
    aboutTitle: 'چیرۆکی ئێمە', aboutHead: 'سمەشکردن گرنگە.',
    aboutP1: 'سمەش بەرگەر بە یەک ئامانج دەستیپێکرد: باشترین سمەش. ئێمە ١٠٠٪ گۆشتی فرێشی خۆماڵی بەکاردەهێنین، لەسەر ئاسنی داغ دەیپەستێوین.',
    aboutP2: 'بێ فێڵ. بێ کورتکردنەوە. تەنها کڕیسپیترین و بەتامترین بەرگەری هەولێر — بە خێرایی و گەرمی پێشکەشتان دەکرێت.',
    aboutQuote: '“بەرگەری باش پێویستی بە ڕوونکردنەوە نییە.”', aboutAuthor: 'ستافی سمەش بەرگەر', aboutAlt: 'سمەش بەرگەر لەسەر گریڵ', estYear: 'دامەزراوی ٢٠٢٤ · هەولێر',
    reviewsEyebrow: 'ڕای کڕیارانمان', reviewsHead: 'خۆشەویستی لە یەکەم پارووەوە.', writeReview: 'هەڵسەنگاندن بنووسە',
    noReviews: 'هێشتا هیچ هەڵسەنگاندنێک بڵاونەکراوەتەوە. یەکەم کەس بە بینووسە.', verified: 'داواکاری پشتڕاستکراو', reply: 'وەڵامی چێشتخانە', outOf: 'لە ٥',
    contactEyebrow: 'سەردانمان بکە لە هەولێر', contactHead: 'بە برسێتی وەرن.', getDirections: 'نیشاندانی ڕێگا', closed: 'داخراوە',
    orderDelivery: 'داواکاری گەیاندن', deliveryPaused: 'گەیاندن وەستێنراوە', whatsapp: 'واتسئاپ',
    tagline: 'بەرگەری بەهێز. تامی گەورە. دروستکراو لە هەولێر.', staff: 'ستاف', rights: 'هەموو مافەکان پارێزراون.', backTop: 'گەڕانەوە بۆ سەرەوە',
  },
  AR: {
    home: 'الرئيسية', menu: 'القائمة', about: 'قصتنا', reviews: 'التقييمات', contact: 'زورونا', reserve: 'احجز طاولة',
    order: 'اطلب الآن', viewMenu: 'شاهد القائمة', myOrder: 'طلبي', tray: 'السلة', openMenu: 'فتح القائمة', closeMenu: 'إغلاق القائمة',
    eyebrowLocation: 'أربيل · كوردستان',
    heroTitle: 'أقوى برجر سماش في أربيل.',
    heroCopy: 'لحم طازج يُكبس على شواية كاست آيرون حارة جداً. أطراف مقرمشة وجبنة ذائبة. جاهز بين يديك في 5 دقائق.',
    ratings: 'تقييم من الضيوف', delivery: 'توصيل سريع', beef: 'لحم بقري محلي',
    systemTitle: 'نظام سماش المتقن', systemHead: 'صُنع بدقة وعناية فائقة.',
    systemCopy: 'كل طبقة مدروسة بعناية: قرمشة الحواف، دفء الخبز، وتوازن الصوصات الأمريكية بدون أي هدر.',
    step1: 'لحم محلي 100%', step2: 'كبس على الحديد الساخن', step3: 'ساخن خلال 5 دقائق', today: 'اليوم',
    featuredEyebrow: 'الأكثر طلباً', featuredHead: 'مصمم خصيصاً لإرضاء شهيتك.', seeFullMenu: 'مشاهدة كامل القائمة',
    whyTitle: 'لماذا سماش؟', whyHead: 'بدون مقدمات، طعم حقيقي فقط.',
    whyCopy: 'نبدأ بلحم محلي طازج 100%، كبس قوي على الصاج الحار، ودقائق معدودة لتكتمل المعادلة.',
    fullMenuTitle: 'القائمة الكاملة', fullMenuHead: 'اجعلها وجبة متكاملة.',
    aboutTitle: 'قصتنا', aboutHead: 'السماش يصنع الفرق.',
    aboutP1: 'بدأت سماش برجر بشغف واحد: السماش المثالي. نستخدم لحم بقري محلي طازج 100%، نكبسه بقوة على مقلاة الحديد الزهر، وندع تفاعل ميلارد يصنع السحر.',
    aboutP2: 'بدون إضافات. بدون اختصارات. فقط ألذ وأكثر برجر مقرمش وعصاري في أربيل — يُقدم سريعاً، وساخناً، وبكل فخر.',
    aboutQuote: '“البرجر الجيد لا يحتاج إلى شرح.”', aboutAuthor: 'فريق سماش برجر', aboutAlt: 'سماش برجر على الشواية', estYear: 'تأسس ٢٠٢٤ · أربيل',
    reviewsEyebrow: 'آراء زبائننا', reviewsHead: 'حب من أول قضمة.', writeReview: 'أضف تقييمك',
    noReviews: 'لا توجد تقييمات منشورة بعد. كن أول من يكتب تقييماً.', verified: 'طلب مؤكد', reply: 'رد المطعم', outOf: 'من 5',
    contactEyebrow: 'موقعنا في أربيل', contactHead: 'تعال وأنت جائع.', getDirections: 'الاتجاهات على الخريطة', closed: 'مغلق',
    orderDelivery: 'طلب توصيل', deliveryPaused: 'التوصيل متوقف مؤقتاً', whatsapp: 'واتساب',
    tagline: 'برجر جريء. نكهة كبيرة. صُنع في أربيل.', staff: 'الموظفون', rights: 'جميع الحقوق محفوظة.', backTop: 'العودة للأعلى',
  },
} satisfies Record<Lang, Record<string, string>>

type Review = { id: number; rating: number; comment: string; name: string; reply: string; at: string; verified: boolean }
type ReviewData = { count: number; average: number | null; reviews: Review[] }

export default function Page() {
  const [lang, setLang] = useLang()
  return (
    <OrderingProvider lang={lang}>
      <Site lang={lang} setLang={setLang} />
    </OrderingProvider>
  )
}

const DAY_INDEX: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }
function dayName(day: string, lang: Lang) {
  const d = new Date(Date.UTC(2024, 0, 7 + (DAY_INDEX[day] ?? 0))) // 7 Jan 2024 was a Sunday
  return d.toLocaleDateString(LANGS.find((l) => l.id === lang)!.html, { weekday: 'long', timeZone: 'UTC' })
}
const hhmm = (s: string) => (s === '24:00' ? '00:00' : s)

function useReviews() {
  const [data, setData] = useState<ReviewData | null>(null)
  useEffect(() => {
    if (STATIC_SITE) return
    fetch('/api/feedback', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then(setData).catch(() => setData(null))
  }, [])
  return data
}

function Site({ lang, setLang }: { lang: Lang; setLang: (l: Lang) => void }) {
  const ordering = useOrdering()
  const { settings } = ordering
  const t = copy[lang]
  const rtl = lang !== 'EN'
  const [navOpen, setNavOpen] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const reviews = useReviews()
  const wa = `https://wa.me/${(settings?.whatsapp || DEFAULT_WA).replace(/\D/g, '')}`
  const phone = (settings?.whatsapp || DEFAULT_WA).replace(/\D/g, '')

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8)
    on(); window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [])
  useEffect(() => { document.body.style.overflow = navOpen ? 'hidden' : ''; return () => { document.body.style.overflow = '' } }, [navOpen])

  // Reveal sections as they scroll into view (skipped entirely with reduced motion).
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'))
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { els.forEach((e) => e.classList.add('in')); return }
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target) } }), { rootMargin: '0px 0px -10% 0px' })
    els.forEach((e) => io.observe(e))
    return () => io.disconnect()
  }, [])

  const goOrder = () => {
    setNavOpen(false)
    if (ordering.cartCount > 0) ordering.setCartOpen(true)
    else document.getElementById('full-menu')?.scrollIntoView({ behavior: 'smooth' })
  }
  const links: Array<[string, string]> = [['#menu', t.menu], ['#about', t.about], ['#reviews', t.reviews], ['#contact', t.contact]]
  const todayKey = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date().getDay()]
  const today = settings?.hours.find((h) => h.day === todayKey)

  return (
    <div className="site" dir={rtl ? 'rtl' : 'ltr'} lang={LANGS.find((l) => l.id === lang)!.html}>
      <header className={`site-nav ${scrolled ? 'scrolled' : ''} ${navOpen ? 'open' : ''}`}>
        <nav className="site-nav-in" aria-label="Main">
          <a href="#home" className="site-brand" aria-label={settings?.restaurantName || 'Smashed Burger'}>
            <span className="brand-mark sm" aria-hidden="true"><Flame size={14} fill="currentColor" /></span>
            <b>{settings?.restaurantName || 'Smashed Burger'}</b>
          </a>
          <div className="site-links">
            {links.map(([href, label]) => <a key={href} href={href}>{label}</a>)}
            <a href={`${BASE_PATH}/reserve`}>{t.reserve}</a>
          </div>
          <div className="site-actions">
            <div className="ui-seg site-lang" role="group" aria-label={tr(lang, 'language')}>
              {LANGS.map((l) => <button key={l.id} type="button" aria-pressed={lang === l.id} onClick={() => setLang(l.id)} aria-label={l.label} lang={l.html}>{l.short}</button>)}
            </div>
            {ordering.orders.length > 0 && <a className="site-pill ghost" href={`${BASE_PATH}/order/${ordering.orders[0].token}`}>{t.myOrder}</a>}
            <button type="button" className="site-tray" onClick={() => ordering.setCartOpen(true)} aria-label={`${t.tray}: ${ordering.cartCount}`}>
              <ShoppingBag size={18} />{ordering.cartCount > 0 && <i>{ordering.cartCount}</i>}
            </button>
            <button type="button" className="site-pill desk" onClick={goOrder}>{t.order}</button>
            <button type="button" className="site-burger" onClick={() => setNavOpen(!navOpen)} aria-expanded={navOpen} aria-label={navOpen ? t.closeMenu : t.openMenu}>
              {navOpen ? <X size={20} /> : <MenuIcon size={20} />}
            </button>
          </div>
        </nav>
        {navOpen && (
          <div className="site-sheet">
            {links.map(([href, label]) => <a key={href} href={href} onClick={() => setNavOpen(false)}>{label}</a>)}
            <a href={`${BASE_PATH}/reserve`}>{t.reserve}</a>
            <div className="ui-seg site-lang" role="group" aria-label={tr(lang, 'language')}>
              {LANGS.map((l) => <button key={l.id} type="button" aria-pressed={lang === l.id} onClick={() => setLang(l.id)} lang={l.html}>{l.label}</button>)}
            </div>
            <button type="button" className="site-pill lg" onClick={goOrder}>{t.order}</button>
          </div>
        )}
      </header>

      <main>
        {/* Hero: one statement, two actions, the product */}
        <section id="home" className="site-hero">
          <div className="site-hero-text">
            <p className="site-eyebrow">{t.eyebrowLocation}</p>
            <h1>{t.heroTitle}</h1>
            <p className="site-lede">{t.heroCopy}</p>
            <div className="site-ctas">
              <button type="button" className="site-pill lg" onClick={goOrder}>{t.order}</button>
              <a className="site-more" href="#menu">{t.viewMenu} <ChevronRight size={18} className="flip" /></a>
            </div>
          </div>
          <div className="site-hero-media">
            <img src={`${BASE_PATH}/menu-photo.jpg`} alt="" fetchPriority="high" />
          </div>
          <ul className="site-facts">
            {reviews?.average != null && reviews.count > 0 && (
              <li><a href="#reviews"><Star size={16} fill="currentColor" /><b>{reviews.average.toFixed(1)}</b><span>{reviews.count} {t.ratings}</span></a></li>
            )}
            {settings?.deliveryEnabled !== false && <li><Zap size={16} /><b>30 min</b><span>{t.delivery}</span></li>}
            <li><Beef size={16} /><b>100%</b><span>{t.beef}</span></li>
            {settings && (
              <li className={settings.isOpen ? 'open' : ''}><Clock3 size={16} /><b>{settings.isOpen ? tr(lang, 'openNow') : tr(lang, 'closedNow')}</b>
                {today && <span dir="ltr">{today.closed ? t.closed : `${hhmm(today.open)} – ${hhmm(today.close)}`}</span>}</li>
            )}
          </ul>
        </section>

        {/* How it's made */}
        <section className="site-band" data-reveal>
          <div className="site-wrap">
            <p className="site-eyebrow">{t.systemTitle}</p>
            <h2 className="site-h2">{t.systemHead}</h2>
            <p className="site-copy">{t.systemCopy}</p>
            <div className="site-steps">
              {[[Beef, t.step1], [Flame, t.step2], [Timer, t.step3]].map(([Icon, label], i) => {
                const I = Icon as typeof Beef
                return <div key={i} className="site-step"><span>{String(i + 1).padStart(2, '0')}</span><I size={28} aria-hidden="true" /><b>{label as string}</b></div>
              })}
            </div>
          </div>
        </section>

        <FeaturedSection
          eyebrow={t.featuredEyebrow}
          title={t.featuredHead}
          link={<a href="#full-menu" className="site-more">{t.seeFullMenu} <ChevronRight size={18} className="flip" /></a>}
        />

        {/* Statement */}
        <section className="site-statement" data-reveal>
          <div className="site-wrap narrow">
            <p className="site-eyebrow">{t.whyTitle}</p>
            <h2>{t.whyHead}</h2>
            <p>{t.whyCopy}</p>
          </div>
        </section>

        <FullMenu eyebrow={t.fullMenuTitle} title={t.fullMenuHead} />

        {/* Story */}
        <section id="about" className="site-story" data-reveal>
          <div className="site-wrap site-story-grid">
            <figure>
              <img src={`${BASE_PATH}/smashed-burger-hero.png`} alt={t.aboutAlt} loading="lazy" />
              <figcaption>{t.estYear}</figcaption>
            </figure>
            <div>
              <p className="site-eyebrow">{t.aboutTitle}</p>
              <h2 className="site-h2">{t.aboutHead}</h2>
              <p className="site-copy">{t.aboutP1}</p>
              <p className="site-copy">{t.aboutP2}</p>
              <blockquote>{t.aboutQuote}<cite>{t.aboutAuthor}</cite></blockquote>
            </div>
          </div>
        </section>

        {/* Reviews: only real, published guest reviews and the real average of all ratings */}
        <section id="reviews" className="site-reviews" data-reveal>
          <div className="site-wrap">
            <div className="site-head">
              <div>
                <p className="site-eyebrow">{t.reviewsEyebrow}</p>
                <h2 className="site-h2">{t.reviewsHead}</h2>
              </div>
              <div className="site-rating">
                {reviews?.average != null && reviews.count > 0 && (
                  <p><b>{reviews.average.toFixed(1)}</b><span><span className="site-stars" aria-label={`${reviews.average} ${t.outOf}`}>{[1, 2, 3, 4, 5].map((n) => <Star key={n} size={14} fill={reviews.average! >= n - 0.25 ? 'currentColor' : 'none'} />)}</span>{reviews.count} {t.ratings}</span></p>
                )}
                {!STATIC_SITE && <button type="button" className="site-pill" onClick={() => setReviewOpen(true)}><Star size={15} /> {t.writeReview}</button>}
              </div>
            </div>
            {reviews && reviews.reviews.length > 0 ? (
              <div className="site-review-grid">
                {reviews.reviews.map((r) => (
                  <article key={r.id} className="site-review">
                    <span className="site-stars" aria-label={`${r.rating} ${t.outOf}`}>{[1, 2, 3, 4, 5].map((n) => <Star key={n} size={14} fill={r.rating >= n ? 'currentColor' : 'none'} />)}</span>
                    <p>“{r.comment}”</p>
                    <footer><b>{r.name}</b>{r.verified && <span><BadgeCheck size={14} /> {t.verified}</span>}<time dateTime={r.at}>{new Date(r.at).toLocaleDateString(LANGS.find((l) => l.id === lang)!.html, { month: 'short', day: 'numeric', year: 'numeric' })}</time></footer>
                    {r.reply && <div className="site-reply"><small>{t.reply}</small><p>{r.reply}</p></div>}
                  </article>
                ))}
              </div>
            ) : (
              !STATIC_SITE && <p className="site-empty">{t.noReviews}</p>
            )}
          </div>
        </section>

        {/* Visit */}
        <section id="contact" className="site-visit" data-reveal>
          <div className="site-wrap site-visit-grid">
            <div>
              <p className="site-eyebrow">{t.contactEyebrow}</p>
              <h2 className="site-h2">{t.contactHead}</h2>
              <ul className="site-details">
                <li><MapPin size={18} /><a href={MAPS_URL} target="_blank" rel="noopener noreferrer">Smash&apos;d Burger, Gulan Street<small>The Boulevard, Erbil 44001</small></a></li>
                <li><Phone size={18} /><a href={`tel:+${phone}`} dir="ltr">+{phone.replace(/^(\d{3})(\d{3})(\d{3})(\d+)$/, '$1 $2 $3 $4')}</a></li>
                <li><MessageCircle size={18} /><a href={wa} target="_blank" rel="noopener noreferrer">{t.whatsapp}</a></li>
              </ul>
              {settings && settings.hours.length > 0 && (
                <dl className="site-hours">
                  <dt><Clock3 size={16} /> {tr(lang, 'hours')}</dt>
                  {settings.hours.map((h) => (
                    <div key={h.day} className={h.day === todayKey ? 'today' : ''}>
                      <dd>{dayName(h.day, lang)}</dd>
                      <dd dir="ltr">{h.closed ? t.closed : `${hhmm(h.open)} – ${hhmm(h.close)}`}</dd>
                    </div>
                  ))}
                </dl>
              )}
              <div className="site-ctas">
                <a className="site-pill" href={MAPS_URL} target="_blank" rel="noopener noreferrer">{t.getDirections} <ArrowUpRight size={16} /></a>
                <a className="site-pill ghost" href={`${BASE_PATH}/reserve`}><CalendarDays size={16} /> {t.reserve}</a>
                {settings?.deliveryEnabled === false
                  ? <span className="site-pill ghost" aria-disabled="true">{t.deliveryPaused}</span>
                  : <a className="site-pill ghost" href={wa} target="_blank" rel="noopener noreferrer">{t.orderDelivery}</a>}
              </div>
            </div>
            <div className="site-map">
              <LocationMap />
            </div>
          </div>
        </section>
      </main>

      <footer className="site-foot">
        <div className="site-wrap">
          <div className="site-foot-top">
            <a href="#home" className="site-brand"><span className="brand-mark sm" aria-hidden="true"><Flame size={14} fill="currentColor" /></span><b>{settings?.restaurantName || 'Smashed Burger'}</b></a>
            <p>{t.tagline}</p>
            <nav aria-label="Footer">
              {links.map(([href, label]) => <a key={href} href={href}>{label}</a>)}
              <a href={`${BASE_PATH}/reserve`}>{t.reserve}</a>
            </nav>
            <div className="site-social">
              <a href="https://instagram.com/smashedburger.erbil" target="_blank" rel="noopener noreferrer">Instagram</a>
              <a href="https://tiktok.com/@smashedburger.erbil" target="_blank" rel="noopener noreferrer">TikTok</a>
              <a href="https://facebook.com/smashedburger.erbil" target="_blank" rel="noopener noreferrer">Facebook</a>
            </div>
          </div>
          <div className="site-foot-bottom">
            <span>© 2024–{new Date().getFullYear()} {settings?.restaurantName || 'Smashed Burger'} · {t.rights}{!STATIC_SITE && <> · <a href="/staff/login">{t.staff}</a></>}</span>
            <button type="button" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}><ArrowUp size={14} /> {t.backTop}</button>
          </div>
        </div>
      </footer>

      {!ordering.session?.table && (
        <a className="site-wa" href={wa} target="_blank" rel="noopener noreferrer" aria-label={t.whatsapp}><MessageCircle size={22} fill="currentColor" /></a>
      )}

      <ItemSheet />
      <CartSheet />
      <CartBar />
      <ServiceFab />
      <ReviewModal isOpen={reviewOpen} onClose={() => setReviewOpen(false)} lang={lang} />
    </div>
  )
}
