import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ApiError } from "@/api/errors";
import { useExperimentActions, useExperimentCatalog } from "@/api/experiments";
import { useGrowthAccess } from "@/api/growth";
import { FormField } from "@/components/kit";
import { GrowthPage, Section, selectCls } from "@/components/growth/GrowthPage";

const inputCls = "h-11 w-full rounded-xl border border-input bg-card px-3 text-sm";
const KEY = /^[a-z0-9][a-z0-9_-]{1,62}$/;

/** One form. The surface list is the server's closed allowlist (never free text); the server checks everything again, and its refusal (for example a forbidden surface) is shown in words. */
export default function ExperimentWizard() {
  const { t } = useTranslation(); const nav = useNavigate(); const cat = useExperimentCatalog(); const acts = useExperimentActions();
  const access = useGrowthAccess(); const can = !!(access.data?.capabilities as Record<string, boolean> | undefined)?.manageExperiments;
  const [f, setF] = useState({ key: "", name: "", surface: "", hypothesis: "", variantB: "b", controlPct: "50", allocationPct: "100", metric: "booking_started", mode: "FIXED" as "FIXED" | "SEQUENTIAL", days: "14", baseline: "", mde: "" });
  const [guard, setGuard] = useState<Record<string, string>>({}); const [serverError, setServerError] = useState(""); const [touched, setTouched] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const errText = (e: unknown) => { if (e instanceof ApiError) { const known = t(`growth.experiments.err.${e.code}`, { defaultValue: "" }); return [known || e.message].filter(Boolean).join(" "); } return t("growth.experiments.err.generic"); };
  const control = Number(f.controlPct); const alloc = Number(f.allocationPct); const days = Number(f.days);
  const errors = { key: !KEY.test(f.key), name: f.name.trim().length < 2, surface: !f.surface, hypothesis: f.hypothesis.trim().length < 10, variantB: !/^[a-z0-9_-]{1,32}$/.test(f.variantB) || f.variantB === "control", weights: !(control >= 1 && control <= 99), allocation: !(alloc >= 1 && alloc <= 100), days: !(days >= (cat.data?.policy.minRunDays ?? 7) && days <= 90) };
  const invalid = Object.values(errors).some(Boolean);
  const primary = (cat.data?.metrics ?? []).filter((m) => m.kind !== "GUARDRAIL"); const guards = (cat.data?.metrics ?? []).filter((m) => m.kind !== "PRIMARY");
  const submit = () => {
    setTouched(true); setServerError(""); if (invalid) return;
    const weightControl = Math.round(control * 100);
    acts.create.mutate({ key: f.key, name: f.name.trim(), surface: f.surface, hypothesis: f.hypothesis.trim(), variants: [{ key: "control", weightBp: weightControl }, { key: f.variantB, weightBp: 10000 - weightControl }], allocationBp: Math.round(alloc * 100), primaryMetric: f.metric,
      guardrails: Object.entries(guard).filter(([, v]) => Number(v) > 0).map(([metric, v]) => ({ metric, marginAbs: Number(v) / 100 })), mode: f.mode, plannedDays: days, ...(f.baseline && f.mde ? { baselineRate: Number(f.baseline) / 100, mdeAbs: Number(f.mde) / 100 } : {}) }, {
      onSuccess: (e) => { toast.success(t("growth.experiments.wizard.created")); nav(`/growth/experiments?id=${e.id}`); }, onError: (e) => setServerError(errText(e)),
    });
  };
  const err = (k: keyof typeof errors) => (touched && errors[k] ? t("growth.experiments.wizard.invalid") : undefined);
  return (
    <GrowthPage section="experiments" actions={<Link to="/growth/experiments" className="inline-flex h-11 items-center rounded-xl border px-4 text-sm font-semibold" data-testid="exp-back">{t("growth.experiments.back")}</Link>}>
      <Section title={t("growth.experiments.wizard.title")} id="exp-wizard">
        {access.isSuccess && !can && <p role="alert" className="mb-3 rounded-xl border border-destructive/40 p-3 text-sm" data-testid="exp-needs-role">{t("growth.experiments.wizard.needsRole")}</p>}
        <form className="grid gap-4 md:grid-cols-2" data-testid="exp-wizard" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
          <FormField label={t("growth.experiments.wizard.fields.key")} hint={t("growth.experiments.wizard.hints.key")} error={err("key")} required><input className={inputCls} dir="ltr" value={f.key} onChange={(e) => set("key", e.target.value)} data-testid="exp-key" /></FormField>
          <FormField label={t("growth.experiments.wizard.fields.name")} error={err("name")} required><input className={inputCls} value={f.name} onChange={(e) => set("name", e.target.value)} data-testid="exp-name" /></FormField>
          <FormField label={t("growth.experiments.wizard.fields.surface")} hint={t("growth.experiments.wizard.hints.surface")} error={err("surface")} required className="md:col-span-2">
            <select className={`${selectCls} w-full`} value={f.surface} onChange={(e) => set("surface", e.target.value)} data-testid="exp-surface"><option value="" />{(cat.data?.surfaces ?? []).map((s) => <option key={s.key} value={s.key}>{s.label} ({s.key})</option>)}</select></FormField>
          <FormField label={t("growth.experiments.wizard.fields.hypothesis")} error={err("hypothesis")} required className="md:col-span-2"><textarea className="min-h-24 w-full rounded-xl border border-input bg-card p-3 text-sm" value={f.hypothesis} onChange={(e) => set("hypothesis", e.target.value)} data-testid="exp-hypothesis" /></FormField>
          <FormField label={t("growth.experiments.wizard.fields.variantB")} hint={t("growth.experiments.wizard.hints.variants")} error={err("variantB")}><input className={inputCls} dir="ltr" value={f.variantB} onChange={(e) => set("variantB", e.target.value)} data-testid="exp-variant-b" /></FormField>
          <FormField label={t("growth.experiments.wizard.fields.weights")} error={err("weights")}><input className={inputCls} inputMode="numeric" value={f.controlPct} onChange={(e) => set("controlPct", e.target.value)} data-testid="exp-weights" /></FormField>
          <FormField label={t("growth.experiments.wizard.fields.allocation")} error={err("allocation")}><input className={inputCls} inputMode="numeric" value={f.allocationPct} onChange={(e) => set("allocationPct", e.target.value)} data-testid="exp-allocation" /></FormField>
          <FormField label={t("growth.experiments.wizard.fields.metric")}><select className={`${selectCls} w-full`} value={f.metric} onChange={(e) => set("metric", e.target.value)} data-testid="exp-metric">{primary.map((m) => <option key={m.key} value={m.key}>{m.key}</option>)}</select></FormField>
          <FormField label={t("growth.experiments.wizard.fields.mode")}><select className={`${selectCls} w-full`} value={f.mode} onChange={(e) => set("mode", e.target.value as "FIXED" | "SEQUENTIAL")} data-testid="exp-mode"><option value="FIXED">{t("growth.experiments.mode.FIXED")}</option><option value="SEQUENTIAL">{t("growth.experiments.mode.SEQUENTIAL")}</option></select></FormField>
          <FormField label={t("growth.experiments.wizard.fields.days")} error={err("days")}><input className={inputCls} inputMode="numeric" value={f.days} onChange={(e) => set("days", e.target.value)} data-testid="exp-days" /></FormField>
          <FormField label={t("growth.experiments.wizard.fields.baseline")} hint={t("growth.experiments.wizard.hints.sample")}><input className={inputCls} inputMode="decimal" value={f.baseline} onChange={(e) => set("baseline", e.target.value)} data-testid="exp-baseline" /></FormField>
          <FormField label={t("growth.experiments.wizard.fields.mde")}><input className={inputCls} inputMode="decimal" value={f.mde} onChange={(e) => set("mde", e.target.value)} data-testid="exp-mde" /></FormField>
          <fieldset className="md:col-span-2"><legend className="text-sm font-medium">{t("growth.experiments.wizard.fields.guardrails")}</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">{guards.map((g) => (
              <label key={g.key} className="flex items-center justify-between gap-3 rounded-xl border bg-card p-3 text-sm"><span dir="ltr">{g.key}</span>
                <input aria-label={`${g.key} ${t("growth.experiments.wizard.fields.margin")}`} className="h-11 w-24 rounded-lg border border-input bg-card px-2 text-sm" inputMode="decimal" placeholder="0.5" value={guard[g.key] ?? ""} onChange={(e) => setGuard((x) => ({ ...x, [g.key]: e.target.value }))} data-testid={`exp-guard-${g.key}`} /></label>))}</div>
          </fieldset>
          {serverError && <p role="alert" className="rounded-xl border border-destructive/40 p-3 text-sm md:col-span-2" data-testid="exp-error">{serverError}</p>}
          <div className="md:col-span-2"><button type="submit" disabled={!can || acts.create.isPending} className="h-11 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-50" data-testid="exp-create">{t("growth.experiments.wizard.create")}</button></div>
        </form>
      </Section>
    </GrowthPage>
  );
}
