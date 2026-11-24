'use client'

import { useState } from 'react'
import { Check, Star, X } from 'lucide-react'
import type { Lang } from '@/components/ordering/i18n'

// Kurdish (Sorani) and Arabic strings were written without a native review; the restaurant should proof them.
const T = {
  title: ['Write a review', 'هەڵسەنگاندن بنووسە', 'أضف تقييمك'],
  rating: ['Your rating', 'هەڵسەنگاندنەکەت', 'تقييمك'],
  name: ['Your name', 'ناوت', 'اسمك'],
  comment: ['Your review', 'ڕاکەت', 'رأيك'],
  placeholder: ['What did you order, and how was it?', 'چیت داوا کرد و چۆن بوو؟', 'ماذا طلبت وكيف كانت التجربة؟'],
  send: ['Send review', 'ناردن', 'إرسال التقييم'],
  sending: ['Sending…', 'دەنێردرێت…', 'جارٍ الإرسال…'],
  cancel: ['Cancel', 'پاشگەزبوونەوە', 'إلغاء'],
  thanks: ['Thank you', 'سوپاس', 'شكراً لك'],
  pending: ['Your review was received. It appears on the site once the restaurant has read it.', 'هەڵسەنگاندنەکەت وەرگیرا. دوای ئەوەی چێشتخانە خوێندییەوە لە ماڵپەڕ دەردەکەوێت.', 'وصلنا تقييمك، وسيظهر على الموقع بعد أن يطّلع عليه المطعم.'],
  done: ['Done', 'تەواو', 'تم'],
  error: ['Could not send. Please try again.', 'نەنێردرا. دووبارە هەوڵبدەوە.', 'تعذّر الإرسال. حاول مرة أخرى.'],
} as const
const ix = (lang: Lang) => (lang === 'KU' ? 1 : lang === 'AR' ? 2 : 0)

/** Website review form. Posts to /api/feedback, where it waits for a manager to publish it. */
export function ReviewModal({ isOpen, onClose, lang = 'EN' }: { isOpen: boolean; onClose: () => void; lang?: Lang }) {
  const [name, setName] = useState('')
  const [stars, setStars] = useState(0)
  const [hover, setHover] = useState(0)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [sent, setSent] = useState(false)
  const t = (k: keyof typeof T) => T[k][ix(lang)]

  if (!isOpen) return null
  const close = () => { setSent(false); setErr(''); onClose() }
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!stars || busy) return
    setBusy(true); setErr('')
    try {
      const r = await fetch('/api/feedback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rating: stars, name, comment }) })
      if (!r.ok) { setErr((await r.json().catch(() => ({}))).error ?? t('error')); return }
      setSent(true); setName(''); setComment(''); setStars(0)
    } catch { setErr(t('error')) } finally { setBusy(false) }
  }

  return (
    <div className="ui-overlay" role="dialog" aria-modal="true" aria-label={t('title')} onClick={close} dir={lang === 'EN' ? 'ltr' : 'rtl'}>
      <div className="ui-dialog" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>{sent ? t('thanks') : t('title')}</h2>
          <button type="button" className="ui-icon-btn" onClick={close} aria-label={t('cancel')}><X size={18} /></button>
        </header>
        {sent ? (
          <>
            <div className="ui-dialog-body rv-done">
              <span className="rv-check" aria-hidden="true"><Check size={26} strokeWidth={3} /></span>
              <p>{t('pending')}</p>
            </div>
            <div className="ui-dialog-foot"><button type="button" className="ui-btn primary block" onClick={close}>{t('done')}</button></div>
          </>
        ) : (
          <form onSubmit={submit}>
            <div className="ui-dialog-body rv-form">
              <fieldset className="rv-stars" onMouseLeave={() => setHover(0)}>
                <legend>{t('rating')}</legend>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" aria-label={`${n} / 5`} aria-pressed={stars === n} onMouseEnter={() => setHover(n)} onClick={() => setStars(n)}>
                    <Star size={30} fill={(hover || stars) >= n ? 'currentColor' : 'none'} strokeWidth={1.6} />
                  </button>
                ))}
              </fieldset>
              <label className="ui-label">{t('name')}
                <input className="ui-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required minLength={2} autoComplete="given-name" />
              </label>
              <label className="ui-label">{t('comment')}
                <textarea className="ui-textarea" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} required minLength={3} rows={4} placeholder={t('placeholder')} />
              </label>
              {err && <p className="ui-alert danger" role="alert">{err}</p>}
            </div>
            <div className="ui-dialog-foot">
              <button type="button" className="ui-btn" onClick={close}>{t('cancel')}</button>
              <button type="submit" className="ui-btn primary" style={{ marginInlineStart: 'auto' }} disabled={!stars || busy} aria-busy={busy}>{busy ? t('sending') : t('send')}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
