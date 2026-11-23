'use client'

import { useEffect, useState } from 'react'
import { Star } from 'lucide-react'
import type { Lang } from './i18n'

const T = {
  EN: { title: 'How was your meal?', placeholder: 'Anything we should know? (optional)', send: 'Send', thanks: 'Thank you for your feedback.', yours: 'Your rating', star: (n: number) => `${n} of 5 stars` },
  KU: { title: 'خواردنەکەت چۆن بوو؟', placeholder: 'شتێک هەیە بیزانین؟ (ئارەزوومەندانە)', send: 'ناردن', thanks: 'سوپاس بۆ ڕاکەت.', yours: 'هەڵسەنگاندنەکەت', star: (n: number) => `${n} لە ٥ ئەستێرە` },
  AR: { title: 'كيف كانت وجبتك؟', placeholder: 'هل هناك ما يجب أن نعرفه؟ (اختياري)', send: 'إرسال', thanks: 'شكرًا على رأيك.', yours: 'تقييمك', star: (n: number) => `${n} من ٥ نجوم` },
}

/** One rating per served order, proven by the tracking token in the URL. */
export function RateOrder({ token, lang }: { token: string; lang: Lang }) {
  const t = T[lang] ?? T.EN
  const [done, setDone] = useState<{ rating: number; comment: string } | null | undefined>(undefined)
  const [rating, setRating] = useState(0)
  const [hover, setHover] = useState(0)
  const [comment, setComment] = useState('')
  const [err, setErr] = useState('')
  useEffect(() => {
    fetch(`/api/orders/${token}/feedback`).then((r) => r.json()).then((d) => setDone(d.feedback ?? null)).catch(() => setDone(null))
  }, [token])
  if (done === undefined) return null
  const send = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('')
    const r = await fetch(`/api/orders/${token}/feedback`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rating, comment }) })
    const d = await r.json()
    if (!r.ok && d.code !== 'already_rated') { setErr(d.error ?? 'Error'); return }
    setDone({ rating, comment })
  }
  return (
    <section className="ot-card ot-rate">
      <h2>{done ? t.yours : t.title}</h2>
      {done ? (
        <>
          <p className="ot-stars" aria-label={t.star(done.rating)}>{[1, 2, 3, 4, 5].map((n) => <Star key={n} size={26} fill={n <= done.rating ? 'currentColor' : 'none'} />)}</p>
          <p>{t.thanks}</p>
        </>
      ) : (
        <form onSubmit={send}>
          <div className="ot-stars" role="radiogroup" aria-label={t.title} onMouseLeave={() => setHover(0)}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={t.star(n)} onMouseEnter={() => setHover(n)} onClick={() => setRating(n)}>
                <Star size={32} fill={n <= (hover || rating) ? 'currentColor' : 'none'} />
              </button>
            ))}
          </div>
          {rating > 0 && (
            <>
              <textarea className="ot-comment" rows={3} maxLength={1000} placeholder={t.placeholder} value={comment} onChange={(e) => setComment(e.target.value)} />
              <button type="submit" className="ot-btn primary">{t.send}</button>
            </>
          )}
          {err && <p role="alert">{err}</p>}
        </form>
      )}
    </section>
  )
}
