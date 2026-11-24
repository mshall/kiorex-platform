import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useCatalogue, useSaveStep, type Plan } from "@/api/marketOnboarding";
import { Section } from "@/components/growth/GrowthPage";

/** Step 3: the subset of the global specialty catalogue the market enables, with its local display names (defaults to the catalogue names). */
export default function SpecialtiesStep({ plan, readOnly }: { plan: Plan; readOnly: boolean }) {
  const { t } = useTranslation(); const cat = useCatalogue(); const save = useSaveStep(plan.cc);
  const initial = ((plan.steps.specialties?.enabled ?? []) as Array<{ code: string; nameAr: string; nameEn: string }>);
  const [on, setOn] = useState<Record<string, { nameAr: string; nameEn: string }>>(Object.fromEntries(initial.map((s) => [s.code, { nameAr: s.nameAr, nameEn: s.nameEn }])));
  const list = cat.data?.specialties ?? [];
  return (
    <Section title={t("growth.marketWizard.specTitle")} id="mw-spec" hint={t("growth.marketWizard.specHint")}>
      <fieldset className="grid gap-2 sm:grid-cols-2" disabled={readOnly}><legend className="sr-only">{t("growth.marketWizard.specTitle")}</legend>
        {list.map((s) => { const cur = on[s.code]; return (
          <div key={s.code} className="rounded-xl border bg-card p-3 text-sm">
            <label className="flex min-h-11 items-center gap-2"><input type="checkbox" className="size-5" checked={!!cur} onChange={(e) => setOn((o) => { const n = { ...o }; if (e.target.checked) n[s.code] = { nameAr: s.ar, nameEn: s.en }; else delete n[s.code]; return n; })} data-testid={`spec-${s.code}`} /><span>{s.en} / <span dir="rtl">{s.ar}</span></span></label>
            {cur && <div className="mt-2 grid gap-2 sm:grid-cols-2"><label className="text-xs"><span className="block text-muted-foreground">{t("growth.marketWizard.nameAr")}</span><input className="h-11 w-full rounded-lg border bg-background px-2" dir="rtl" value={cur.nameAr} onChange={(e) => setOn((o) => ({ ...o, [s.code]: { ...cur, nameAr: e.target.value } }))} /></label><label className="text-xs"><span className="block text-muted-foreground">{t("growth.marketWizard.nameEn")}</span><input className="h-11 w-full rounded-lg border bg-background px-2" dir="ltr" value={cur.nameEn} onChange={(e) => setOn((o) => ({ ...o, [s.code]: { ...cur, nameEn: e.target.value } }))} /></label></div>}
          </div>); })}
      </fieldset>
      <button type="button" className="mt-3 h-11 rounded-xl border border-primary bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50" disabled={readOnly || save.isPending || Object.keys(on).length === 0} onClick={() => save.mutate({ step: "specialties", body: { enabled: Object.entries(on).map(([code, v]) => ({ code, ...v })) } })} data-testid="spec-save">{t("growth.marketWizard.save")}</button>
      {save.isError && <p className="mt-2 text-sm text-destructive" role="alert">{(save.error as Error).message}</p>}{save.isSuccess && <p className="mt-2 text-sm" role="status">{t("growth.marketWizard.saved")}</p>}
    </Section>
  );
}
