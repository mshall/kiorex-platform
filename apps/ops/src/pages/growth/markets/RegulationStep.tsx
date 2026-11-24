import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSaveStep, type Plan } from "@/api/marketOnboarding";
import { Section } from "@/components/growth/GrowthPage";

const DEFAULTS = { marketingLicenceRequired: true, marketingLicenceHeld: false, consentRegimeId: "", minimumAge: 18, healthAdvertisingRestricted: true, reviewMarkupAllowed: false, dataExportRuleId: "" };
const BOOLS = ["marketingLicenceRequired", "marketingLicenceHeld", "healthAdvertisingRestricted", "reviewMarkupAllowed"] as const;
/** Step 4: regulation switches as booleans and ids. The legal wording itself is never typed here (counsel owns it); a held licence is recorded only as what a person confirmed. */
export default function RegulationStep({ plan, readOnly }: { plan: Plan; readOnly: boolean }) {
  const { t } = useTranslation(); const save = useSaveStep(plan.cc); const [f, setF] = useState({ ...DEFAULTS, ...(plan.steps.regulation ?? {}) } as typeof DEFAULTS);
  return (
    <Section title={t("growth.marketWizard.regTitle")} id="mw-reg" hint={t("growth.marketWizard.regHint")}>
      <p className="mb-3 rounded-xl border bg-card p-3 text-sm" data-testid="reg-human">{t("growth.marketWizard.regHuman")}</p>
      <fieldset className="grid gap-3 sm:grid-cols-2" disabled={readOnly}><legend className="sr-only">{t("growth.marketWizard.regTitle")}</legend>
        {BOOLS.map((k) => <label key={k} className="flex min-h-11 items-center gap-2 rounded-xl border bg-card p-3 text-sm"><input type="checkbox" className="size-5" checked={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.checked })} data-testid={`reg-${k}`} />{t(`growth.marketWizard.reg.${k}`)}</label>)}
        <label className="text-sm"><span className="block text-muted-foreground">{t("growth.marketWizard.reg.consentRegimeId")}</span><input className="h-11 w-full rounded-xl border bg-card px-3 font-mono" dir="ltr" value={f.consentRegimeId} maxLength={32} onChange={(e) => setF({ ...f, consentRegimeId: e.target.value })} data-testid="reg-consentRegimeId" /></label>
        <label className="text-sm"><span className="block text-muted-foreground">{t("growth.marketWizard.reg.dataExportRuleId")}</span><input className="h-11 w-full rounded-xl border bg-card px-3 font-mono" dir="ltr" value={f.dataExportRuleId} maxLength={32} onChange={(e) => setF({ ...f, dataExportRuleId: e.target.value })} data-testid="reg-dataExportRuleId" /></label>
        <label className="text-sm"><span className="block text-muted-foreground">{t("growth.marketWizard.reg.minimumAge")}</span><input type="number" min={0} max={25} className="h-11 w-full rounded-xl border bg-card px-3" value={f.minimumAge} onChange={(e) => setF({ ...f, minimumAge: Number(e.target.value) })} data-testid="reg-minimumAge" /></label>
      </fieldset>
      <button type="button" className="mt-3 h-11 rounded-xl border border-primary bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50" disabled={readOnly || save.isPending} onClick={() => save.mutate({ step: "regulation", body: f })} data-testid="reg-save">{t("growth.marketWizard.save")}</button>
      {save.isError && <p className="mt-2 text-sm text-destructive" role="alert" data-testid="reg-error">{(save.error as Error & { details?: { errors?: string[] } }).details?.errors?.[0] ?? (save.error as Error).message}</p>}{save.isSuccess && <p className="mt-2 text-sm" role="status">{t("growth.marketWizard.saved")}</p>}
    </Section>
  );
}
