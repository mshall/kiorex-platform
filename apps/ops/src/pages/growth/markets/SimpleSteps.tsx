import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSaveStep, type Plan, type StepId } from "@/api/marketOnboarding";
import { Section } from "@/components/growth/GrowthPage";

const input = "h-11 w-full rounded-xl border bg-card px-3 text-sm";
const Save = ({ step, body, plan, readOnly }: { step: StepId; body: () => Record<string, unknown>; plan: Plan; readOnly: boolean }) => {
  const { t } = useTranslation(); const save = useSaveStep(plan.cc);
  const msg = save.isError ? ((save.error as Error & { details?: { errors?: string[] } }).details?.errors?.[0] ?? (save.error as Error).message) : null;
  return (<>
    <button type="button" className="mt-3 h-11 rounded-xl border border-primary bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50" disabled={readOnly || save.isPending} onClick={() => save.mutate({ step, body: body() })} data-testid={`save-${step}`}>{t("growth.marketWizard.save")}</button>
    {msg && <p className="mt-2 text-sm text-destructive" role="alert" data-testid={`error-${step}`}>{msg}</p>}{save.isSuccess && <p className="mt-2 text-sm" role="status">{t("growth.marketWizard.saved")}</p>}
  </>);
};

/** Step 1: identity. Names in both languages, currency and minor units, phone code, IANA time zone, languages, working week and quiet hours. */
export function IdentityStep({ plan, readOnly }: { plan: Plan; readOnly: boolean }) {
  const { t } = useTranslation(); // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the plan answers are validated by the API; this form only reads known keys
  const s = (plan.steps.identity ?? {}) as Record<string, any>;
  const [nameAr, setNameAr] = useState<string>(s.name?.ar ?? ""); const [nameEn, setNameEn] = useState<string>(s.name?.en ?? ""); const [currency, setCurrency] = useState<string>(s.currency ?? ""); const [minor, setMinor] = useState<number>(s.minorUnits ?? 2);
  const [phone, setPhone] = useState<string>(s.phoneCode ?? ""); const [tz, setTz] = useState<string>(s.timezone ?? ""); const [locales, setLocales] = useState<string[]>(s.locales ?? ["ar", "en"]); const [def, setDef] = useState<string>(s.defaultLocale ?? "ar");
  const [qs, setQs] = useState<string>(s.quietHours?.start ?? "21:00"); const [qe, setQe] = useState<string>(s.quietHours?.end ?? "09:00"); const [week, setWeek] = useState<number[]>(s.workingWeek ?? [0, 1, 2, 3, 4]);
  const toggle = <T,>(a: T[], v: T) => (a.includes(v) ? a.filter((x) => x !== v) : [...a, v]);
  return (
    <Section title={t("growth.marketWizard.idTitle")} id="mw-id" hint={t("growth.marketWizard.idHint")}>
      <fieldset className="grid gap-3 sm:grid-cols-2" disabled={readOnly}><legend className="sr-only">{t("growth.marketWizard.idTitle")}</legend>
        <label className="text-sm"><span className="block text-muted-foreground">{t("growth.marketWizard.nameAr")}</span><input className={input} dir="rtl" value={nameAr} onChange={(e) => setNameAr(e.target.value)} data-testid="id-nameAr" /></label>
        <label className="text-sm"><span className="block text-muted-foreground">{t("growth.marketWizard.nameEn")}</span><input className={input} dir="ltr" value={nameEn} onChange={(e) => setNameEn(e.target.value)} data-testid="id-nameEn" /></label>
        <label className="text-sm"><span className="block text-muted-foreground">{t("growth.marketWizard.currency")}</span><input className={`${input} font-mono`} dir="ltr" maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} data-testid="id-currency" /></label>
        <label className="text-sm"><span className="block text-muted-foreground">{t("growth.marketWizard.minorUnits")}</span><input type="number" min={0} max={4} className={input} value={minor} onChange={(e) => setMinor(Number(e.target.value))} data-testid="id-minor" /></label>
        <label className="text-sm"><span className="block text-muted-foreground">{t("growth.marketWizard.phoneCode")}</span><input className={`${input} font-mono`} dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} data-testid="id-phone" /></label>
        <label className="text-sm"><span className="block text-muted-foreground">{t("growth.marketWizard.timezone")}</span><input className={`${input} font-mono`} dir="ltr" value={tz} placeholder="Asia/Amman" onChange={(e) => setTz(e.target.value)} data-testid="id-tz" /></label>
        <label className="text-sm"><span className="block text-muted-foreground">{t("growth.marketWizard.quietStart")}</span><input type="time" className={input} value={qs} onChange={(e) => setQs(e.target.value)} data-testid="id-qs" /></label>
        <label className="text-sm"><span className="block text-muted-foreground">{t("growth.marketWizard.quietEnd")}</span><input type="time" className={input} value={qe} onChange={(e) => setQe(e.target.value)} data-testid="id-qe" /></label>
        <div className="flex flex-wrap gap-3 text-sm sm:col-span-2"><span className="w-full text-muted-foreground">{t("growth.marketWizard.locales")}</span>{["ar", "en"].map((l) => <label key={l} className="flex min-h-11 items-center gap-2"><input type="checkbox" className="size-5" checked={locales.includes(l)} onChange={() => setLocales(toggle(locales, l))} />{l.toUpperCase()}</label>)}
          <label className="flex min-h-11 items-center gap-2">{t("growth.marketWizard.defaultLocale")}<select className="h-11 rounded-xl border border-input bg-card px-3" value={def} onChange={(e) => setDef(e.target.value)}><option value="ar">AR</option><option value="en">EN</option></select></label></div>
        <div className="flex flex-wrap gap-3 text-sm sm:col-span-2"><span className="w-full text-muted-foreground">{t("growth.marketWizard.workingWeek")}</span>{[0, 1, 2, 3, 4, 5, 6].map((d) => <label key={d} className="flex min-h-11 items-center gap-2"><input type="checkbox" className="size-5" checked={week.includes(d)} onChange={() => setWeek(toggle(week, d))} />{t(`growth.marketWizard.day.${d}`)}</label>)}</div>
      </fieldset>
      <Save plan={plan} readOnly={readOnly} step="identity" body={() => ({ name: { ar: nameAr, en: nameEn }, currency, minorUnits: minor, phoneCode: phone, timezone: tz, locales, defaultLocale: def, quietHours: { start: qs, end: qe }, workingWeek: [...week].sort() })} />
    </Section>
  );
}

/** Step 5: providers. The id of the onboarding import batch (two-person import) used for the market. */
export function ProvidersStep({ plan, readOnly }: { plan: Plan; readOnly: boolean }) {
  const { t } = useTranslation(); const [id, setId] = useState<string>((plan.steps.providers?.importBatchId as string | undefined) ?? "");
  return (<Section title={t("growth.marketWizard.provTitle")} id="mw-prov" hint={t("growth.marketWizard.provHint")}>
    <label className="block text-sm"><span className="block text-muted-foreground">{t("growth.marketWizard.batchId")}</span><input className={`${input} max-w-md font-mono`} dir="ltr" value={id} onChange={(e) => setId(e.target.value)} disabled={readOnly} data-testid="prov-batch" /></label>
    <Save plan={plan} readOnly={readOnly} step="providers" body={() => ({ importBatchId: id })} /></Section>);
}

/** Step 6: consent defaults. Text VERSION ids per purpose and the marketing caps; the wording is counsel's and shows as NEEDS_HUMAN until a real id replaces the placeholder. */
export function ConsentStep({ plan, readOnly }: { plan: Plan; readOnly: boolean }) {
  const { t } = useTranslation(); // eslint-disable-next-line @typescript-eslint/no-explicit-any -- same as above
  const s = (plan.steps.consent ?? {}) as Record<string, any>;
  const [a, setA] = useState<string>(s.textVersionIds?.analytics ?? "TODO_NEEDS_HUMAN_v0"); const [m, setM] = useState<string>(s.textVersionIds?.marketing ?? "TODO_NEEDS_HUMAN_v0"); const [d, setD] = useState<number>(s.maxMarketingPerDay ?? 1); const [w, setW] = useState<number>(s.maxMarketingPerWeek ?? 3);
  return (<Section title={t("growth.marketWizard.consentTitle")} id="mw-consent" hint={t("growth.marketWizard.consentHint")}>
    <fieldset className="grid gap-3 sm:grid-cols-2" disabled={readOnly}><legend className="sr-only">{t("growth.marketWizard.consentTitle")}</legend>
      <label className="text-sm"><span className="block text-muted-foreground">{t("growth.marketWizard.textAnalytics")}</span><input className={`${input} font-mono`} dir="ltr" value={a} onChange={(e) => setA(e.target.value)} data-testid="consent-analytics" /></label>
      <label className="text-sm"><span className="block text-muted-foreground">{t("growth.marketWizard.textMarketing")}</span><input className={`${input} font-mono`} dir="ltr" value={m} onChange={(e) => setM(e.target.value)} data-testid="consent-marketing" /></label>
      <label className="text-sm"><span className="block text-muted-foreground">{t("growth.marketWizard.capDay")}</span><input type="number" min={0} max={20} className={input} value={d} onChange={(e) => setD(Number(e.target.value))} data-testid="consent-day" /></label>
      <label className="text-sm"><span className="block text-muted-foreground">{t("growth.marketWizard.capWeek")}</span><input type="number" min={0} max={20} className={input} value={w} onChange={(e) => setW(Number(e.target.value))} data-testid="consent-week" /></label>
    </fieldset>
    <Save plan={plan} readOnly={readOnly} step="consent" body={() => ({ textVersionIds: { analytics: a, marketing: m }, maxMarketingPerDay: d, maxMarketingPerWeek: w })} /></Section>);
}

/** Step 8: integrations. Everything stays in mock mode; only the name of a WhatsApp number reference can be set here, never a value or a secret. */
export function IntegrationsStep({ plan, readOnly }: { plan: Plan; readOnly: boolean }) {
  const { t } = useTranslation(); const [ref, setRef] = useState<string>((plan.steps.integrations?.whatsappPhoneNumberIdRef as string | null | undefined) ?? "");
  return (<Section title={t("growth.marketWizard.intTitle")} id="mw-int" hint={t("growth.marketWizard.intHint")}>
    <label className="block text-sm"><span className="block text-muted-foreground">{t("growth.marketWizard.waRef")}</span><input className={`${input} max-w-md font-mono`} dir="ltr" value={ref} onChange={(e) => setRef(e.target.value)} disabled={readOnly} data-testid="int-wa" /></label>
    <Save plan={plan} readOnly={readOnly} step="integrations" body={() => ({ whatsappPhoneNumberIdRef: ref.trim() ? ref.trim() : null })} /></Section>);
}
