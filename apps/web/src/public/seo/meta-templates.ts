import type { Locale, PageMeta, TemplateCtx } from "../types";
import { buildMeta } from "./meta";

/**
 * Title and description templates (GRW-P1-F). Defaults live here; the versioned `SEO` growth configuration (per market, per locale) overrides single
 * entries through `ctx.templates`, which the API validates (apps/api/src/growth/seo/seo-extensions.ts) before it reaches this bundle.
 *
 * Rules: placeholders are `{name}` style, an unknown or empty one renders as nothing (and the punctuation around it is tidied); a title template
 * NEVER contains the brand (buildTitle appends `| Kiorex` when it fits within 60 characters); no medical claims, no superlatives, no invented numbers:
 * every number comes from the page data (`{count}`, `{fees}`, `{rating}`). The Arabic copy is PROPOSED and needs CMO review before launch.
 */
export type TemplateKey = "home" | "hub" | "city" | "district" | "care-district" | "city-hub" | "district-hub" | "same-day" | "telemedicine" | "doctor" | "nurse" | "clinic" | "pharmacy" | "lab";
export interface Tpl { title: string; description: string }

export const DEFAULT_TEMPLATES: Record<Locale, Record<TemplateKey, Tpl>> = {
  en: {
    home: { title: "Book doctors in {country}", description: "Find verified doctors, clinics and home care across {country}. See real availability, read honest reviews and book a confirmed appointment on {brand}." },
    hub: { title: "{specialty} doctors", description: "{count} verified {specialty} doctors. {fees}Compare ratings and languages, then book a confirmed slot on {brand}." },
    city: { title: "{specialty} doctors in {city}", description: "{count} verified {specialty} doctors in {city}. {fees}{rating}Book a confirmed slot on {brand}." },
    district: { title: "{specialty} doctors in {district}, {city}", description: "{count} verified {specialty} doctors in {district}, {city}. {fees}{rating}Book a confirmed slot on {brand}." },
    "care-district": { title: "{care} in {district}, {city}", description: "{count} verified providers of {care} in {district}, {city}. {fees}Book a confirmed visit on {brand}." },
    "city-hub": { title: "Doctors and care in {city}", description: "{count} verified providers in {city}: doctors by specialty, home care and more. {fees}Book a confirmed slot on {brand}." },
    "district-hub": { title: "Doctors and care in {district}, {city}", description: "{count} verified providers in {district}, {city}. {fees}Book a confirmed slot on {brand}." },
    "same-day": { title: "{specialty} doctors available today", description: "{count} verified {specialty} doctors with a slot in the next 24 hours. {fees}Book a confirmed slot on {brand}." },
    telemedicine: { title: "{specialty} video consultations", description: "{count} verified {specialty} doctors who offer video consultations. {fees}Book a confirmed slot on {brand}." },
    doctor: { title: "{name}, {specialty}", description: "Book {name}, {specialty}{where}. {rating}Real availability and a confirmed appointment on {brand}." },
    nurse: { title: "{name}, home nursing", description: "Book {name} for care at home{where}. {rating}Real availability and a confirmed visit on {brand}." },
    clinic: { title: "{name}", description: "{name}: {count} doctors you can book online{where}. Real availability and honest reviews on {brand}." },
    pharmacy: { title: "{name}, pharmacy", description: "Order your prescription from {name} through {brand}. Track the order from your phone." },
    lab: { title: "{name}, medical lab", description: "Book lab tests with {name} through {brand}. See the result in the app when the lab publishes it." },
  },
  ar: {
    home: { title: "احجز طبيبك في {country}", description: "ابحث عن أطباء وعيادات ورعاية منزلية موثّقة في {country}. شاهد المواعيد الحقيقية واقرأ تقييمات صادقة واحجز موعدًا مؤكدًا على {brand}." },
    hub: { title: "أطباء {specialty}", description: "{count} من أطباء {specialty} الموثّقين. {fees}قارن التقييمات واللغات ثم احجز موعدًا مؤكدًا على {brand}." },
    city: { title: "أطباء {specialty} في {city}", description: "{count} من أطباء {specialty} الموثّقين في {city}. {fees}{rating}احجز موعدًا مؤكدًا على {brand}." },
    district: { title: "أطباء {specialty} في {district}، {city}", description: "{count} من أطباء {specialty} الموثّقين في {district}، {city}. {fees}{rating}احجز موعدًا مؤكدًا على {brand}." },
    "care-district": { title: "{care} في {district}، {city}", description: "{count} من مقدّمي {care} الموثّقين في {district}، {city}. {fees}احجز زيارة مؤكدة على {brand}." },
    "city-hub": { title: "أطباء ورعاية صحية في {city}", description: "{count} من مقدّمي الرعاية الموثّقين في {city}: أطباء بكل التخصصات ورعاية منزلية. {fees}احجز موعدًا مؤكدًا على {brand}." },
    "district-hub": { title: "أطباء ورعاية صحية في {district}، {city}", description: "{count} من مقدّمي الرعاية الموثّقين في {district}، {city}. {fees}احجز موعدًا مؤكدًا على {brand}." },
    "same-day": { title: "أطباء {specialty} متاحون اليوم", description: "{count} من أطباء {specialty} الموثّقين لديهم موعد خلال 24 ساعة. {fees}احجز موعدًا مؤكدًا على {brand}." },
    telemedicine: { title: "استشارات {specialty} بالفيديو", description: "{count} من أطباء {specialty} الموثّقين يقدّمون استشارات بالفيديو. {fees}احجز موعدًا مؤكدًا على {brand}." },
    doctor: { title: "{name}، {specialty}", description: "احجز {name}، {specialty}{where}. {rating}مواعيد حقيقية وحجز مؤكد على {brand}." },
    nurse: { title: "{name}، تمريض منزلي", description: "احجز {name} للرعاية في المنزل{where}. {rating}مواعيد حقيقية وزيارة مؤكدة على {brand}." },
    clinic: { title: "{name}", description: "{name}: {count} من الأطباء يمكنك الحجز عندهم أونلاين{where}. مواعيد حقيقية وتقييمات صادقة على {brand}." },
    pharmacy: { title: "{name}، صيدلية", description: "اطلب وصفتك من {name} عبر {brand} وتابع الطلب من هاتفك." },
    lab: { title: "{name}، معمل تحاليل", description: "احجز تحاليلك لدى {name} عبر {brand} واطّلع على النتيجة في التطبيق عندما ينشرها المعمل." },
  },
};

export const BRAND: Record<Locale, string> = { en: "Kiorex", ar: "كيوريكس" };
export const COUNTRY: Record<string, Bi> = { eg: { en: "Egypt", ar: "مصر" } };
interface Bi { en: string; ar: string }

export type MetaVars = Partial<Record<"name" | "specialty" | "city" | "district" | "country" | "clinic" | "count" | "fees" | "rating" | "where" | "care" | "brand", string | number>>;

/** `{x}` replaced; unknown/empty placeholders vanish; spaces before punctuation, doubled punctuation and dangling separators are tidied. */
export function renderTemplate(tpl: string, vars: MetaVars): string {
  return tpl
    .replace(/\{([a-zA-Z]+)\}/g, (_m, k: string) => String((vars as Record<string, string | number | undefined>)[k] ?? ""))
    .replace(/\s+([,.:;،؛])/g, "$1")
    .replace(/([.،,:;])(\s*[.،,:;])+/g, "$1")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,.،:;-]+|[\s,،:;-]+$/g, "")
    .trim();
}

/** Default template overlaid by the configured one (per field). */
export function templateFor(key: TemplateKey, ctx: Pick<TemplateCtx, "locale" | "templates">): Tpl {
  const base = DEFAULT_TEMPLATES[ctx.locale][key];
  const o = ctx.templates?.[ctx.locale]?.[key];
  return { title: o?.title ?? base.title, description: o?.description ?? base.description };
}

export function metaFromTemplate(key: TemplateKey, ctx: Pick<TemplateCtx, "locale" | "templates" | "cc">, vars: MetaVars, ogImage?: string | null): PageMeta {
  const t = templateFor(key, ctx);
  const all: MetaVars = { brand: BRAND[ctx.locale], country: COUNTRY[ctx.cc.toLowerCase()]?.[ctx.locale] ?? ctx.cc.toUpperCase(), ...vars };
  return buildMeta(renderTemplate(t.title, all), renderTemplate(t.description, all), ctx.locale, ogImage);
}
