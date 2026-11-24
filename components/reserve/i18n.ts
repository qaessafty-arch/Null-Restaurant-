export type Lang = 'EN' | 'KU' | 'AR'

/** Booking page strings. Kurdish (Sorani) and Arabic were written without native review; see docs. */
export const RT = {
  EN: {
    title: 'Book a table', sub: 'Choose a time and we will keep a table for you.', guests: 'Guests', date: 'Date', otherDate: 'Other date',
    seating: 'Seating', any: 'Any', time: 'Time', noTimes: 'No free tables on this day. Try another date.', closed: 'We are closed on this day.',
    details: 'Your details', name: 'Name', phone: 'Phone', email: 'Email (optional)', occasion: 'Occasion', requests: 'Requests (optional)',
    requestsPh: 'High chair, allergies, quiet corner…', book: 'Book table', booking: 'Booking…', pickTime: 'Pick a time first',
    doneTitle: 'You are booked', pending: 'We received your request and will confirm it shortly.', confirmed: 'Your table is confirmed.',
    code: 'Booking code', keepLink: 'Keep this link to view or cancel your booking:', copy: 'Copy link', copied: 'Copied',
    cancel: 'Cancel booking', cancelAsk: 'Cancel this booking?', cancelled: 'This booking is cancelled.', back: 'Back to the restaurant',
    callUs: 'For larger groups please call us', guestsN: (n: number) => `${n} ${n === 1 ? 'guest' : 'guests'}`, today: 'Today', tomorrow: 'Tomorrow',
    status: { pending: 'Waiting for confirmation', confirmed: 'Confirmed', seated: 'Seated', completed: 'Completed', cancelled: 'Cancelled', no_show: 'Missed' } as Record<string, string>,
    occasions: { '': 'None', birthday: 'Birthday', anniversary: 'Anniversary', date: 'Date night', business: 'Business', celebration: 'Celebration', other: 'Other' } as Record<string, string>,
    unavailable: 'Online booking is not available right now.', notFound: 'We could not find this booking.',
  },
  KU: {
    title: 'گرتنی مێز', sub: 'کاتێک هەڵبژێرە و مێزێکت بۆ ڕادەگرین.', guests: 'میوان', date: 'بەروار', otherDate: 'بەرواری تر',
    seating: 'شوێن', any: 'هەر شوێنێک', time: 'کات', noTimes: 'لەم ڕۆژەدا مێزی بەتاڵ نییە. ڕۆژێکی تر تاقی بکەرەوە.', closed: 'لەم ڕۆژەدا داخراوین.',
    details: 'زانیارییەکانت', name: 'ناو', phone: 'ژمارەی مۆبایل', email: 'ئیمەیڵ (ئارەزوومەندانە)', occasion: 'بۆنە', requests: 'داواکاری (ئارەزوومەندانە)',
    requestsPh: 'کورسی منداڵ، هەستیاری، گۆشەیەکی هێمن…', book: 'مێز بگرە', booking: 'چاوەڕێ بکە…', pickTime: 'سەرەتا کاتێک هەڵبژێرە',
    doneTitle: 'مێزەکەت گیرا', pending: 'داواکارییەکەت گەیشت و بەم زووانە پشتڕاستی دەکەینەوە.', confirmed: 'مێزەکەت پشتڕاستکرایەوە.',
    code: 'کۆدی گرتن', keepLink: 'ئەم بەستەرە بپارێزە بۆ بینین یان هەڵوەشاندنەوە:', copy: 'لەبەرگرتنەوە', copied: 'لەبەرگیرایەوە',
    cancel: 'هەڵوەشاندنەوە', cancelAsk: 'ئەم گرتنە هەڵبوەشێنرێتەوە؟', cancelled: 'ئەم گرتنە هەڵوەشێنرایەوە.', back: 'گەڕانەوە بۆ چێشتخانە',
    callUs: 'بۆ گرووپی گەورەتر پەیوەندیمان پێوە بکە', guestsN: (n: number) => `${n} میوان`, today: 'ئەمڕۆ', tomorrow: 'سبەینێ',
    status: { pending: 'چاوەڕێی پشتڕاستکردنەوە', confirmed: 'پشتڕاستکراوە', seated: 'دانیشتوون', completed: 'تەواوبوو', cancelled: 'هەڵوەشاوە', no_show: 'نەهاتن' } as Record<string, string>,
    occasions: { '': 'هیچ', birthday: 'ڕۆژی لەدایکبوون', anniversary: 'ساڵیادی', date: 'ئێوارەیەکی تایبەت', business: 'کار', celebration: 'ئاهەنگ', other: 'تر' } as Record<string, string>,
    unavailable: 'گرتنی ئۆنلاین ئێستا بەردەست نییە.', notFound: 'ئەم گرتنە نەدۆزرایەوە.',
  },
  AR: {
    title: 'احجز طاولة', sub: 'اختر الوقت وسنحجز لك طاولة.', guests: 'الضيوف', date: 'التاريخ', otherDate: 'تاريخ آخر',
    seating: 'المكان', any: 'أي مكان', time: 'الوقت', noTimes: 'لا توجد طاولات متاحة في هذا اليوم. جرّب يومًا آخر.', closed: 'نحن مغلقون في هذا اليوم.',
    details: 'بياناتك', name: 'الاسم', phone: 'رقم الهاتف', email: 'البريد الإلكتروني (اختياري)', occasion: 'المناسبة', requests: 'طلبات (اختياري)',
    requestsPh: 'كرسي أطفال، حساسية، زاوية هادئة…', book: 'احجز الطاولة', booking: 'جارٍ الحجز…', pickTime: 'اختر الوقت أولًا',
    doneTitle: 'تم الحجز', pending: 'وصلنا طلبك وسنؤكده قريبًا.', confirmed: 'تم تأكيد طاولتك.',
    code: 'رمز الحجز', keepLink: 'احتفظ بهذا الرابط لعرض الحجز أو إلغائه:', copy: 'نسخ الرابط', copied: 'تم النسخ',
    cancel: 'إلغاء الحجز', cancelAsk: 'هل تريد إلغاء هذا الحجز؟', cancelled: 'تم إلغاء هذا الحجز.', back: 'العودة إلى المطعم',
    callUs: 'للمجموعات الأكبر يرجى الاتصال بنا', guestsN: (n: number) => `${n} ${n === 1 ? 'ضيف' : 'ضيوف'}`, today: 'اليوم', tomorrow: 'غدًا',
    status: { pending: 'بانتظار التأكيد', confirmed: 'مؤكد', seated: 'تم الجلوس', completed: 'منتهٍ', cancelled: 'ملغى', no_show: 'لم يحضر' } as Record<string, string>,
    occasions: { '': 'لا شيء', birthday: 'عيد ميلاد', anniversary: 'ذكرى سنوية', date: 'موعد', business: 'عمل', celebration: 'احتفال', other: 'أخرى' } as Record<string, string>,
    unavailable: 'الحجز عبر الإنترنت غير متاح حاليًا.', notFound: 'لم نتمكن من العثور على هذا الحجز.',
  },
}

export const LOCALE: Record<Lang, string> = { EN: 'en-GB', KU: 'ckb-IQ', AR: 'ar-IQ' }
export const isRtl = (l: Lang) => l !== 'EN'
