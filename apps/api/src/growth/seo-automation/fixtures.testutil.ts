import type { PageContent, PageLocale } from './page-model';
import type { TemplateKey } from '../seo/seo-public';

export const HOST = 'https://kiorex.test';
const EN_BODY = (n: string, extra = '') => `${n} is a cardiologist listed on Kiorex in Maadi, Cairo. Fees start at 300 EGP. Languages spoken: Arabic and English. The next available appointment is tomorrow afternoon. Patients rated this doctor 4.6 out of 5 across 38 visits. Book a visit online, pay the deposit securely, and receive a reminder before your appointment. Reviews come from patients who completed a visit and are shown as written after a check by our team. ${extra}`;
const AR_BODY = (n: string, extra = '') => `${n} أخصائي أمراض القلب مدرج على كيوريكس في المعادي بالقاهرة. تبدأ الرسوم من ٣٠٠ جنيه. اللغات المتاحة العربية والإنجليزية. أقرب موعد متاح غدا بعد الظهر. قيّم المرضى هذا الطبيب ٤٫٦ من ٥ عبر ٣٨ زيارة. احجز زيارتك عبر الإنترنت وادفع العربون بأمان واستلم تذكيرا قبل موعدك. تأتي التقييمات من مرضى أتموا زيارتهم وتظهر كما كُتبت بعد مراجعة فريقنا للتأكد من صحتها. ${extra}`;

export function page(o: Partial<PageContent> & { name?: string; key?: string; locale?: PageLocale; type?: TemplateKey }): PageContent {
  const locale = o.locale ?? 'en'; const type = o.type ?? 'doctor'; const slug = o.key?.split(':')[1] ?? (o.name ?? 'sara-hassan').toLowerCase().replace(/\s+/g, '-');
  const pageKey = o.key ?? `${type}:${slug}`;
  const tail = type === 'home' ? '' : `/${type}/${slug}`;
  const canonical = `${HOST}/${locale}/eg${tail}`;
  const name = o.name ?? 'Dr Sara Hassan';
  return {
    pageKey, templateKind: type, locale, expectedCanonical: canonical,
    title: locale === 'en' ? `${name}, cardiologist in Maadi, Cairo | Kiorex` : `${name}، أخصائي قلب في المعادي، القاهرة | كيوريكس`,
    description: locale === 'en' ? `Book ${name}, cardiologist in Maadi, Cairo. See fees, languages and the next available appointment on Kiorex.` : `احجز مع ${name}، أخصائي قلب في المعادي بالقاهرة. تعرّف على الرسوم واللغات وأقرب موعد على كيوريكس.`,
    h1: [name], text: locale === 'en' ? EN_BODY(name) : AR_BODY(name),
    jsonLd: [{ '@context': 'https://schema.org', '@type': 'Physician', name, url: canonical }, { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Kiorex', item: `${HOST}/${locale}/eg` }, { '@type': 'ListItem', position: 2, name, item: canonical }] }],
    canonical, alternates: [{ hreflang: 'ar', href: `${HOST}/ar/eg${tail}` }, { hreflang: 'en', href: `${HOST}/en/eg${tail}` }, { hreflang: 'x-default', href: `${HOST}/ar/eg${tail}` }],
    robots: 'index,follow', links: [], reviewMarkupRendered: false, visibleReviews: 0, ...o,
  };
}
export const bothLocales = (o: Parameters<typeof page>[0] = {}): PageContent[] => [page({ ...o, locale: 'en' }), page({ ...o, locale: 'ar' })];
