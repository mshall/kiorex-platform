import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useCreatePlan, usePlans, usePublishPlan, type Plan, type StepId } from "@/api/marketOnboarding";
import { useGrowthAccess } from "@/api/growth";
import { StatusChip } from "@/components/kit";
import { CardSkeleton, ErrorState } from "@/components/states";
import { GrowthPage, Section } from "@/components/growth/GrowthPage";
import DataCellStep from "./DataCellStep";
import GeographyImport from "./GeographyImport";
import MarketReadinessPage from "./MarketReadinessPage";
import RegulationStep from "./RegulationStep";
import SpecialtiesStep from "./SpecialtiesStep";
import { ConsentStep, IdentityStep, IntegrationsStep, ProvidersStep } from "./SimpleSteps";

const ORDER: StepId[] = ["identity", "geography", "specialties", "regulation", "providers", "consent", "residency", "integrations"];

function Publish({ plan, canManage }: { plan: Plan; canManage: boolean }) {
  const { t } = useTranslation(); const pub = usePublishPlan(plan.cc);
  return (
    <Section title={t("growth.marketWizard.publishTitle")} id="mw-publish" hint={t("growth.marketWizard.publishHint")}>
      {plan.status === "PUBLISHED" ? <p className="text-sm" data-testid="publish-done">{t("growth.marketWizard.published")} <Link className="font-semibold underline" to="/growth/config">{t("growth.marketWizard.openConfig")}</Link></p> : (
        <>
          <button type="button" className="h-11 rounded-xl border border-primary bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50" disabled={!canManage || pub.isPending} onClick={() => pub.mutate()} data-testid="publish">{t("growth.marketWizard.publish")}</button>
          {pub.isError && <p className="mt-2 text-sm text-destructive" role="alert" data-testid="publish-error">{(pub.error as Error).message}</p>}
        </>)}
      {pub.isSuccess && <p className="mt-2 text-sm" role="status" data-testid="publish-ok">{pub.data.next}</p>}
    </Section>
  );
}

/** Market onboarding wizard (GRW-P3-G): eight steps, a readiness checklist and a publish that only DRAFTS the configuration (a second super admin approves; going live stays a human gate). */
export default function MarketWizardPage() {
  const { t } = useTranslation(); const [sp, setSp] = useSearchParams(); const plans = usePlans(); const access = useGrowthAccess(); const create = useCreatePlan();
  const [cc, setCc] = useState(""); const [step, setStep] = useState<StepId>("identity");
  const canManage = !!access.data?.capabilities.manage; const current = sp.get("cc"); const plan = (plans.data ?? []).find((p) => p.cc === current) ?? null;
  const done = (s: StepId) => !!plan?.steps[s];
  const ro = !canManage || plan?.status === "PUBLISHED" || plan?.status === "CANCELLED";
  return (
    <GrowthPage section="markets" actions={<Link to="/growth/markets" className="inline-flex h-11 items-center rounded-xl border border-input bg-card px-4 text-sm font-semibold">{t("growth.marketWizard.back")}</Link>}>
      <p className="rounded-xl border bg-card p-3 text-sm" data-testid="wizard-human">{t("growth.marketWizard.humanGate")}</p>
      {plans.isLoading ? <CardSkeleton rows={2} /> : plans.error ? <ErrorState error={plans.error} onRetry={() => void plans.refetch()} /> : (
        <>
          <Section title={t("growth.marketWizard.plans")} id="mw-plans">
            <ul className="flex flex-wrap gap-2" data-testid="plan-list">{(plans.data ?? []).map((p) => <li key={p.cc}><button type="button" className={`h-11 rounded-xl border px-4 text-sm font-semibold ${p.cc === current ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card"}`} aria-pressed={p.cc === current} onClick={() => setSp({ cc: p.cc })} data-testid={`plan-${p.cc}`}>{p.cc} <StatusChip tone={p.status === "PUBLISHED" ? "success" : "neutral"} dot={false}>{t(`growth.marketWizard.planStatus.${p.status}`)}</StatusChip></button></li>)}{(plans.data ?? []).length === 0 && <li className="text-sm text-muted-foreground">{t("growth.marketWizard.noPlans")}</li>}</ul>
            {canManage && <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); create.mutate(cc, { onSuccess: () => { setSp({ cc }); setCc(""); } }); }}>
              <label className="text-sm"><span className="block text-muted-foreground">{t("growth.marketWizard.newCc")}</span><input className="h-11 w-24 rounded-xl border bg-card px-3 font-mono uppercase" dir="ltr" maxLength={2} value={cc} onChange={(e) => setCc(e.target.value.toUpperCase())} data-testid="new-cc" /></label>
              <button type="submit" className="h-11 rounded-xl border border-primary bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50" disabled={!/^[A-Z]{2}$/.test(cc) || create.isPending} data-testid="create-plan">{t("growth.marketWizard.createPlan")}</button>
              {create.isError && <p className="w-full text-sm text-destructive" role="alert" data-testid="create-error">{(create.error as Error).message}</p>}
            </form>}
          </Section>
          {plan && (
            <>
              <div role="tablist" aria-label={t("growth.marketWizard.steps")} className="flex flex-wrap gap-2" data-testid="step-tabs">
                {ORDER.map((s, i) => <button key={s} role="tab" type="button" id={`mw-tab-${s}`} aria-selected={step === s} aria-controls="mw-step" className={`h-11 rounded-xl border px-3 text-sm font-semibold ${step === s ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card"}`} onClick={() => setStep(s)} data-testid={`tab-${s}`}>{i + 1}. {t(`growth.marketWizard.step.${s}`)}{done(s) ? <span aria-label={t("growth.marketWizard.answered")}> ✓</span> : null}</button>)}
              </div>
              <div id="mw-step" role="tabpanel" aria-labelledby={`mw-tab-${step}`} data-testid="step-panel">
                {step === "identity" && <IdentityStep key={plan.cc + plan.updatedAt} plan={plan} readOnly={ro} />}
                {step === "geography" && <GeographyImport cc={plan.cc} readOnly={ro} />}
                {step === "specialties" && <SpecialtiesStep key={plan.cc + plan.updatedAt} plan={plan} readOnly={ro} />}
                {step === "regulation" && <RegulationStep key={plan.cc + plan.updatedAt} plan={plan} readOnly={ro} />}
                {step === "providers" && <ProvidersStep key={plan.cc + plan.updatedAt} plan={plan} readOnly={ro} />}
                {step === "consent" && <ConsentStep key={plan.cc + plan.updatedAt} plan={plan} readOnly={ro} />}
                {step === "residency" && <DataCellStep key={plan.cc + plan.updatedAt} plan={plan} readOnly={ro} />}
                {step === "integrations" && <IntegrationsStep key={plan.cc + plan.updatedAt} plan={plan} readOnly={ro} />}
              </div>
              <Publish plan={plan} canManage={canManage} />
              <MarketReadinessPage cc={plan.cc} />
            </>)}
        </>)}
    </GrowthPage>
  );
}
