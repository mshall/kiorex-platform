/**
 * Public plans of the Kiorly site (pure logic, no I/O).
 *
 * Where each module's plans come from (LLM_HANDOFF section 19):
 *  - Clinic: the Clinic owns the plan catalogue (Plan, PlanEntitlement, effective-dated PlanPrice per market). This module only maps what the Clinic publishes.
 *  - Pharmacy and Lab: the products have edition definitions in code (LITE, PRO, CHAIN) and an EMPTY PlanPrice table with no editing surface (NEEDS_HUMAN LG-SUB-1). The
 *    site text of those editions is a Kiorex setting edited in the Kiorly admin. It carries NO price: a price is shown only when the product itself holds one.
 * A public field is whitelisted here, never "everything the source has": unknown entitlement keys are dropped, cohort prices are dropped, nothing internal leaves.
 */

export type L10n<T = string> = { en: T; ar: T };
export const MODULES = ['clinic', 'pharmacy', 'lab'] as const;
export type ModuleId = (typeof MODULES)[number];
export const CONTENT_MODULES = ['pharmacy', 'lab'] as const;
export type ContentModule = (typeof CONTENT_MODULES)[number];

export interface PublicPrice { interval: 'MONTHLY' | 'ANNUAL'; unit: 'PER_TENANT' | 'PER_CLINICIAN'; amount: string; currency: string; includedClinicians: number; extraClinicianAmount: string | null }
export interface PublicPlan {
  id: string;
  name: L10n;
  summary: L10n | null;
  /** short limit lines (users, branches ...) */
  limits: L10n<string[]>;
  features: L10n<string[]>;
  /** SET: at least one active price; TO_BE_ANNOUNCED: none (the site says so, it never shows a number of its own) */
  priceStatus: 'SET' | 'TO_BE_ANNOUNCED';
  prices: PublicPrice[];
}
export interface PublicModule { id: ModuleId; status: 'OK' | 'UNAVAILABLE'; plans: PublicPlan[] }
export interface PublicPlansResponse {
  contract: 'kiorly.public-plans.v1';
  generatedAt: string;
  market: { code: string; currency: string } | null;
  modules: PublicModule[];
}

// ───────────── Clinic: entitlement allow-list (key -> label), in display order ─────────────
const F: Array<[string, L10n]> = [
  ['mod_clinical', { en: 'Clinical records', ar: 'السجلات السريرية' }],
  ['mod_front_desk', { en: 'Front desk and appointments', ar: 'الاستقبال والمواعيد' }],
  ['mod_invoices', { en: 'Invoices', ar: 'الفواتير' }],
  ['mod_revenue', { en: 'Revenue view', ar: 'متابعة الإيرادات' }],
  ['mod_reports', { en: 'Reports', ar: 'التقارير' }],
  ['mod_messaging', { en: 'Messaging', ar: 'المراسلة' }],
  ['mod_expenses', { en: 'Expenses', ar: 'المصروفات' }],
  ['mod_hr', { en: 'Staff management', ar: 'إدارة الفريق' }],
  ['mod_payroll', { en: 'Payroll', ar: 'الرواتب' }],
  ['mod_operations', { en: 'Operations', ar: 'العمليات' }],
  ['mod_integrations', { en: 'Integrations', ar: 'التكاملات' }],
  ['mod_data_explorer', { en: 'Data explorer', ar: 'مستكشف البيانات' }],
  ['telehealth_video', { en: 'Video visits', ar: 'زيارات بالفيديو' }],
  ['mobile_staff_app', { en: 'Staff mobile app', ar: 'تطبيق الفريق على الهاتف' }],
  ['whatsapp_reminders', { en: 'WhatsApp reminders', ar: 'تذكيرات واتساب' }],
  ['ai_assistant', { en: 'AI assistant', ar: 'مساعد ذكي' }],
  ['ai_scribe', { en: 'AI note scribe', ar: 'كاتب ذكي للملاحظات' }],
  ['card_payments', { en: 'Card payments', ar: 'الدفع بالبطاقة' }],
  ['instapay', { en: 'InstaPay', ar: 'إنستاباي' }],
  ['fawry', { en: 'Fawry', ar: 'فوري' }],
  ['deposits', { en: 'Booking deposits', ar: 'عربون الحجز' }],
  ['home_dispatch', { en: 'Home-visit dispatch', ar: 'توزيع الزيارات المنزلية' }],
  ['multi_branch', { en: 'Several branches', ar: 'فروع متعددة' }],
  ['pack_dental', { en: 'Dental pack', ar: 'حزمة الأسنان' }],
  ['pack_physio', { en: 'Physiotherapy pack', ar: 'حزمة العلاج الطبيعي' }],
  ['pack_aesthetics', { en: 'Aesthetics pack', ar: 'حزمة التجميل' }],
  ['dedicated_support', { en: 'Dedicated support', ar: 'دعم مخصص' }],
];
const LIMITS: Array<[string, (n: number) => L10n]> = [
  ['max_clinicians', (n) => (n < 0 ? { en: 'Unlimited clinicians', ar: 'عدد غير محدود من الأطباء' } : { en: `Up to ${n} clinicians`, ar: `حتى ${n} من الأطباء` })],
  ['max_branches', (n) => (n < 0 ? { en: 'Unlimited branches', ar: 'عدد غير محدود من الفروع' } : { en: n === 1 ? '1 branch' : `Up to ${n} branches`, ar: n === 1 ? 'فرع واحد' : `حتى ${n} فروع` })],
  ['max_assistant_seats', (n) => (n < 0 ? { en: 'Unlimited assistant seats', ar: 'مقاعد مساعدين غير محدودة' } : { en: `Up to ${n} assistant seats`, ar: `حتى ${n} من المساعدين` })],
];

interface ClinicPublicPlan { key?: unknown; nameEn?: unknown; nameAr?: unknown; sortOrder?: unknown; entitlements?: unknown; prices?: unknown }
const str = (v: unknown, max = 80): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const money = (v: unknown): string | null => { const s = typeof v === 'number' ? String(v) : typeof v === 'string' ? v.trim() : ''; return /^\d{1,12}(\.\d{1,2})?$/.test(s) ? s : null; };

/** Maps the Clinic's public payload (`GET /api/v1/public/plans?market=`) to the public contract. Anything malformed is dropped, never guessed. */
export function mapClinicPlans(raw: unknown): { market: { code: string; currency: string } | null; plans: PublicPlan[] } {
  const r = (raw && typeof raw === 'object' ? raw : {}) as { market?: { code?: unknown; currency?: unknown }; plans?: unknown };
  const code = str(r.market?.code, 8).toUpperCase(); const cur = str(r.market?.currency, 8).toUpperCase();
  const market = /^[A-Z]{2}$/.test(code) && /^[A-Z]{3}$/.test(cur) ? { code, currency: cur } : null;
  const list = Array.isArray(r.plans) ? (r.plans as ClinicPublicPlan[]) : [];
  const plans = list
    .filter((p) => p && typeof p === 'object' && /^[A-Z][A-Z_]{1,30}$/.test(str(p.key, 32)))
    .sort((a, b) => (num(a.sortOrder) ?? 0) - (num(b.sortOrder) ?? 0))
    .map((p): PublicPlan => {
      const ent = new Map<string, unknown>((Array.isArray(p.entitlements) ? p.entitlements : []).filter((e: any) => e && typeof e.key === 'string').map((e: any) => [e.key as string, e.value]));
      const limits: L10n<string[]> = { en: [], ar: [] };
      for (const [k, f] of LIMITS) { const n = num(ent.get(k)); if (n !== null) { const l = f(n); limits.en.push(l.en); limits.ar.push(l.ar); } }
      const features: L10n<string[]> = { en: [], ar: [] };
      for (const [k, l] of F) if (ent.get(k) === true) { features.en.push(l.en); features.ar.push(l.ar); }
      const prices = (Array.isArray(p.prices) ? p.prices : [])
        .filter((x: any) => x && x.cohortKey == null && ['MONTHLY', 'ANNUAL'].includes(x.interval) && ['PER_TENANT', 'PER_CLINICIAN'].includes(x.unit) && money(x.amount) !== null && /^[A-Z]{3}$/.test(str(x.currency, 3).toUpperCase()))
        .map((x: any): PublicPrice => ({ interval: x.interval, unit: x.unit, amount: money(x.amount)!, currency: str(x.currency, 3).toUpperCase(), includedClinicians: Math.max(0, Math.floor(num(x.includedClinicians) ?? 1)), extraClinicianAmount: x.extraClinicianAmount == null ? null : money(x.extraClinicianAmount) }))
        .sort((a, b) => (a.interval === b.interval ? 0 : a.interval === 'MONTHLY' ? -1 : 1));
      const key = str(p.key, 32);
      return { id: key.toLowerCase(), name: { en: str(p.nameEn) || key, ar: str(p.nameAr) || str(p.nameEn) || key }, summary: null, limits, features, priceStatus: prices.length ? 'SET' : 'TO_BE_ANNOUNCED', prices };
    });
  return { market, plans };
}

// ───────────── Pharmacy and Lab: the site text of the editions (a Kiorex setting) ─────────────
export interface ContentPlan { id: string; visible: boolean; name: L10n; summary: L10n; limits: L10n<string[]>; features: L10n<string[]> }
export interface ContentConfig { pharmacy: { plans: ContentPlan[] }; lab: { plans: ContentPlan[] } }

const l = (en: string, ar: string): L10n => ({ en, ar });
const ll = (en: string[], ar: string[]): L10n<string[]> => ({ en, ar });
/**
 * Defaults = what the products' own edition definitions say today (Pharmacy `kernel-adapter/local/local-kernel.ts`, Lab `kernel-adapter/local-kernel.ts`):
 * names are the edition names, the lines are the capabilities and limits in code. Lab has NO decided limits (NEEDS_HUMAN LG-SUB-6), so it lists none. No prices.
 */
export const DEFAULT_CONTENT: ContentConfig = {
  pharmacy: { plans: [
    { id: 'lite', visible: true, name: l('Lite', 'لايت'), summary: l('For a single pharmacy that wants Kiorex orders.', 'لصيدلية واحدة تريد طلبات كيوريكس.'), limits: ll(['Up to 2 users', '1 branch'], ['حتى 2 من المستخدمين', 'فرع واحد']), features: ll(['Receive and fulfil Kiorex orders'], ['استقبال طلبات كيوريكس وتنفيذها']) },
    { id: 'pro', visible: true, name: l('Pro', 'برو'), summary: l('Purchasing and forecasting for a busy pharmacy.', 'مشتريات وتوقعات لصيدلية نشطة.'), limits: ll(['Up to 5 users'], ['حتى 5 مستخدمين']), features: ll(['Everything in Lite', 'Purchasing', 'Stock forecasting', 'Insurer claims as an add-on'], ['كل ما في لايت', 'المشتريات', 'توقع المخزون', 'مطالبات شركات التأمين كإضافة']) },
    { id: 'chain', visible: true, name: l('Chain', 'سلسلة'), summary: l('For pharmacy groups with several branches.', 'لمجموعات الصيدليات متعددة الفروع.'), limits: ll(['Unlimited users', 'Unlimited branches'], ['مستخدمون غير محدودين', 'فروع غير محدودة']), features: ll(['Everything in Pro', 'Stock transfers between branches', 'Central price book', 'Insurer claims included'], ['كل ما في برو', 'تحويلات المخزون بين الفروع', 'قائمة أسعار مركزية', 'مطالبات التأمين مشمولة']) },
  ] },
  lab: { plans: [
    { id: 'lite', visible: true, name: l('Lite', 'لايت'), summary: l('For a single lab that wants Kiorex bookings.', 'لمعمل واحد يريد حجوزات كيوريكس.'), limits: ll([], []), features: ll(['Receive Kiorex bookings'], ['استقبال حجوزات كيوريكس']) },
    { id: 'pro', visible: true, name: l('Pro', 'برو'), summary: l('Analyzer interfaces and home collection.', 'ربط الأجهزة والسحب المنزلي.'), limits: ll([], []), features: ll(['Everything in Lite', 'Analyzer interfaces', 'Home sample collection', 'Referral labs'], ['كل ما في لايت', 'ربط أجهزة التحليل', 'سحب العينات من المنزل', 'معامل الإحالة']) },
    { id: 'chain', visible: true, name: l('Chain', 'سلسلة'), summary: l('For lab groups with several branches.', 'لمجموعات المعامل متعددة الفروع.'), limits: ll([], []), features: ll(['Everything in Pro', 'Several branches'], ['كل ما في برو', 'فروع متعددة']) },
  ] },
};

const FORBIDDEN_PRICE_KEY = /price|pricing|amount|fee|cost|currency|egp|usd|tariff|rate|discount|tax|vat/i;
const MAX_PLANS = 6, MAX_LINES = 14, MAX_TEXT = 200;

/** Validates the saved document. Strict on purpose: unknown keys are refused, and a price-like key is refused (this setting carries no price). */
export function validateContent(raw: unknown): { ok: true; config: ContentConfig } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  const text = (v: unknown, p: string, required = true): string => {
    if (typeof v !== 'string') { errors.push(`${p}: text required`); return ''; }
    const s = v.trim();
    if (required && !s) errors.push(`${p}: must not be empty`);
    if (s.length > MAX_TEXT) errors.push(`${p}: at most ${MAX_TEXT} characters`);
    if (/[<>]/.test(s)) errors.push(`${p}: no markup`);
    return s;
  };
  const loc = (v: unknown, p: string, required = true): L10n => (obj(v) ? { en: text(v.en, `${p}.en`, required), ar: text(v.ar, `${p}.ar`, required) } : (errors.push(`${p}: { en, ar } required`), { en: '', ar: '' }));
  const lines = (v: unknown, p: string): L10n<string[]> => {
    if (!obj(v)) { errors.push(`${p}: { en: [], ar: [] } required`); return { en: [], ar: [] }; }
    const one = (a: unknown, q: string) => (Array.isArray(a) ? (a.length > MAX_LINES ? (errors.push(`${q}: at most ${MAX_LINES} lines`), []) : a.map((x, i) => text(x, `${q}[${i}]`))) : (errors.push(`${q}: list required`), []));
    const en = one(v.en, `${p}.en`), ar = one(v.ar, `${p}.ar`);
    if (en.length !== ar.length) errors.push(`${p}: the English and Arabic lists must have the same number of lines`);
    return { en, ar };
  };
  const scan = (o: unknown, path: string) => { if (obj(o)) for (const [k, v] of Object.entries(o)) { if (FORBIDDEN_PRICE_KEY.test(k)) errors.push(`${path}${k}: this setting carries no price, prices live in the product`); scan(v, `${path}${k}.`); } else if (Array.isArray(o)) o.forEach((x, i) => scan(x, `${path}${i}.`)); };
  if (!obj(raw)) return { ok: false, errors: ['document must be an object'] };
  scan(raw, '');
  for (const k of Object.keys(raw)) if (!(CONTENT_MODULES as readonly string[]).includes(k)) errors.push(`${k}: unknown module`);
  const config = {} as ContentConfig;
  for (const m of CONTENT_MODULES) {
    const mod = raw[m];
    if (!obj(mod) || !Array.isArray(mod.plans)) { errors.push(`${m}.plans: list required`); config[m] = { plans: [] }; continue; }
    if (mod.plans.length > MAX_PLANS) errors.push(`${m}.plans: at most ${MAX_PLANS} plans`);
    const seen = new Set<string>();
    config[m] = { plans: mod.plans.slice(0, MAX_PLANS).map((p, i): ContentPlan => {
      const at = `${m}.plans[${i}]`;
      if (!obj(p)) { errors.push(`${at}: object required`); return { id: '', visible: false, name: { en: '', ar: '' }, summary: { en: '', ar: '' }, limits: { en: [], ar: [] }, features: { en: [], ar: [] } }; }
      for (const k of Object.keys(p)) if (!['id', 'visible', 'name', 'summary', 'limits', 'features'].includes(k)) errors.push(`${at}.${k}: unknown field`);
      const id = typeof p.id === 'string' ? p.id.trim().toLowerCase() : '';
      if (!/^[a-z][a-z0-9-]{0,23}$/.test(id)) errors.push(`${at}.id: lowercase letters, digits and dashes`);
      if (seen.has(id)) errors.push(`${at}.id: duplicate`); seen.add(id);
      if (typeof p.visible !== 'boolean') errors.push(`${at}.visible: true or false`);
      return { id, visible: p.visible === true, name: loc(p.name, `${at}.name`), summary: loc(p.summary, `${at}.summary`, false), limits: lines(p.limits, `${at}.limits`), features: lines(p.features, `${at}.features`) };
    }) };
  }
  return errors.length ? { ok: false, errors: errors.slice(0, 30) } : { ok: true, config };
}

/** Active prices (in force now) of a product's editions for one market, as the public contract carries them. Only what the product holds and has published; nothing else. */
export function productPublicPrices(o: { prices: Array<{ edition: string; marketCode: string; interval: string; currency: string; amount: string; validFrom: string; validTo: string | null }> } | null, market: string, now: Date = new Date()): Map<string, PublicPrice[]> {
  const out = new Map<string, PublicPrice[]>();
  for (const x of o?.prices ?? []) {
    if (x.marketCode !== market || !['MONTHLY', 'ANNUAL'].includes(x.interval) || money(x.amount) === null || !/^[A-Z]{3}$/.test(x.currency)) continue;
    if (new Date(x.validFrom) > now || (x.validTo && new Date(x.validTo) <= now)) continue;
    const list = out.get(x.edition.toLowerCase()) ?? [];
    list.push({ interval: x.interval as PublicPrice['interval'], unit: 'PER_TENANT', amount: money(x.amount)!, currency: x.currency, includedClinicians: 0, extraClinicianAmount: null });
    out.set(x.edition.toLowerCase(), list.sort((a, b) => (a.interval === b.interval ? 0 : a.interval === 'MONTHLY' ? -1 : 1)));
  }
  return out;
}

/** The public plans of a Pharmacy or Lab edition list. A price shows only when the product has published one that is in force now; otherwise the plan says so (the tables start empty, LG-SUB-1/6/7). */
export function contentToPublic(module: ContentModule, c: ContentConfig, prices: Map<string, PublicPrice[]> = new Map()): PublicPlan[] {
  return c[module].plans.filter((p) => p.visible).map((p): PublicPlan => {
    const mine = prices.get(p.id) ?? [];
    return { id: p.id, name: p.name, summary: p.summary.en || p.summary.ar ? p.summary : null, limits: p.limits, features: p.features, priceStatus: mine.length ? 'SET' : 'TO_BE_ANNOUNCED', prices: mine };
  });
}
