import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CHANNELS, OBJECTIVES, useCampaignActions } from "@/api/campaigns";
import { useGrowthAccess } from "@/api/growth";
import { FormField, Stepper } from "@/components/kit";
import { GrowthPage, selectCls, useGrowthMarket } from "@/components/growth/GrowthPage";
import { toMinor, useErrorText } from "@/components/growth/campaign-parts";
import { UtmBuilder, previewLinks, utmErrors, type UtmForm } from "./UtmBuilder";

const inputCls = "h-11 w-full rounded-xl border border-input bg-card px-3 text-sm";
const KEY = /^[a-z0-9][a-z0-9-]{1,47}$/;
const list = (v: string) => v.split(",").map((x) => x.trim()).filter(Boolean);
const SENSITIVE = ["WHATSAPP", "SMS"];

/** Five steps: basics, budget and channels, audience (non-clinical allowlist), tracking (UTM builder with a live preview), review. The server validates everything again; this form only helps. */
export default function CampaignWizard({ section = "campaigns" }: { section?: "campaigns" | "promotions" }) {
  const { t } = useTranslation(); const nav = useNavigate(); const [sp] = useSearchParams(); const g = useGrowthMarket(); const acts = useCampaignActions(); const errText = useErrorText();
  const access = useGrowthAccess(); const can = !!access.data?.capabilities.manageCampaigns;
  const [step, setStep] = useState(0); const [serverError, setServerError] = useState<string>("");
  const [f, setF] = useState({ name: "", key: "", objective: sp.get("objective") === "PROMOTION" || section === "promotions" ? "PROMOTION" : "ACQUISITION", startsAt: "", endsAt: "", total: "", daily: "", channels: ["EMAIL"] as string[], patientType: "ANY", cities: "", districts: "", platforms: [] as string[], languages: [] as string[], careTypes: [] as string[] });
  const [utm, setUtm] = useState<UtmForm>({ source: "", medium: "", content: "", term: "", targetPath: "" });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const toggle = (k: "channels" | "platforms" | "languages" | "careTypes", v: string) => set(k, f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v]);
  const steps = (["basics", "budget", "audience", "tracking", "review"] as const).map((s) => t(`growth.campaigns.wizard.steps.${s}`));
  const total = toMinor(f.total || "0"); const daily = f.daily ? toMinor(f.daily) : undefined;
  const stepErrors: string[][] = [
    [!f.name.trim() || f.name.trim().length < 2 ? "name" : "", !KEY.test(f.key) ? "key" : "", f.startsAt && f.endsAt && new Date(f.endsAt) <= new Date(f.startsAt) ? "dates" : ""].filter(Boolean),
    [!(total > 0) ? "total" : "", daily !== undefined && (daily <= 0 || daily > total) ? "daily" : "", !f.channels.length ? "channels" : ""].filter(Boolean),
    [], Object.entries(utmErrors(utm)).filter(([, v]) => v).map(([k]) => k), [],
  ];
  const needsApproval = f.channels.some((c) => SENSITIVE.includes(c));
  const links = previewLinks({ market: g.market, key: f.key, channels: f.channels, form: utm });
  const submit = () => {
    setServerError("");
    const eligibility: Record<string, unknown> = {};
    if (f.patientType !== "ANY") eligibility.patientType = f.patientType; if (list(f.cities).length) eligibility.cities = list(f.cities); if (list(f.districts).length) eligibility.districts = list(f.districts);
    if (f.platforms.length) eligibility.platforms = f.platforms; if (f.languages.length) eligibility.languages = f.languages; if (f.careTypes.length) eligibility.careTypes = f.careTypes;
    const utmConfig: Record<string, string> = {}; for (const [k, v] of Object.entries(utm)) if (v) utmConfig[k] = v;
    acts.create.mutate({ key: f.key, name: f.name.trim(), objective: f.objective, budgetTotalMinor: total, budgetDailyMinor: daily, channels: f.channels, startsAt: f.startsAt ? new Date(f.startsAt).toISOString() : undefined, endsAt: f.endsAt ? new Date(f.endsAt).toISOString() : undefined, eligibility, utmConfig }, {
      onSuccess: (c) => { toast.success(t("growth.campaigns.wizard.created")); nav(`/growth/campaigns/${c.id}`); },
      onError: (e) => setServerError(errText(e)),
    });
  };
  const err = (k: string) => stepErrors[step]!.includes(k) ? t("growth.campaigns.wizard.invalid") : undefined;
  return (
    <GrowthPage section={section} actions={null}>
      <div className="kx-card space-y-5 p-4 md:p-6" data-testid="campaign-wizard">
        <h2 className="text-lg">{t("growth.campaigns.wizard.title")}</h2>
        {!can && <p role="status" className="rounded-xl bg-warning-soft p-3 text-sm" data-testid="wizard-readonly">{t("growth.campaigns.detail.readOnly")}</p>}
        <Stepper steps={steps} current={step} label={t("growth.campaigns.wizard.title")} />
        {step === 0 && (
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t("growth.campaigns.wizard.name")} hint={t("growth.campaigns.wizard.nameHint")} error={err("name")} required><input className={inputCls} value={f.name} onChange={(e) => set("name", e.target.value)} maxLength={120} data-testid="cw-name" /></FormField>
            <FormField label={t("growth.campaigns.wizard.key")} hint={t("growth.campaigns.wizard.keyHint")} error={err("key")} required><input className={inputCls} dir="ltr" value={f.key} onChange={(e) => set("key", e.target.value.toLowerCase())} maxLength={48} placeholder="ramadan-checkup" data-testid="cw-key" /></FormField>
            <FormField label={t("growth.campaigns.wizard.objective")}><select className={`${selectCls} w-full`} value={f.objective} onChange={(e) => set("objective", e.target.value)} data-testid="cw-objective">{OBJECTIVES.map((o) => <option key={o} value={o}>{t(`growth.campaigns.objective.${o}`)}</option>)}</select></FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label={t("growth.campaigns.wizard.startsAt")}><input type="datetime-local" className={inputCls} value={f.startsAt} onChange={(e) => set("startsAt", e.target.value)} data-testid="cw-starts" /></FormField>
              <FormField label={t("growth.campaigns.wizard.endsAt")} error={err("dates")}><input type="datetime-local" className={inputCls} value={f.endsAt} onChange={(e) => set("endsAt", e.target.value)} data-testid="cw-ends" /></FormField>
            </div>
          </div>)}
        {step === 1 && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label={t("growth.campaigns.wizard.total")} hint={t("growth.campaigns.wizard.totalHint")} error={err("total")} required><input inputMode="decimal" className={inputCls} dir="ltr" value={f.total} onChange={(e) => set("total", e.target.value)} data-testid="cw-total" /></FormField>
              <FormField label={t("growth.campaigns.wizard.daily")} hint={t("growth.campaigns.wizard.dailyHint")} error={err("daily")}><input inputMode="decimal" className={inputCls} dir="ltr" value={f.daily} onChange={(e) => set("daily", e.target.value)} data-testid="cw-daily" /></FormField>
            </div>
            <fieldset><legend className="text-sm font-medium">{t("growth.campaigns.wizard.channels")}</legend><p className="text-xs text-muted-foreground">{t("growth.campaigns.wizard.channelsHint")}</p>
              <div className="mt-2 flex flex-wrap gap-2">{CHANNELS.map((c) => (<label key={c} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm ${f.channels.includes(c) ? "border-primary bg-accent" : "bg-card"}`}><input type="checkbox" checked={f.channels.includes(c)} onChange={() => toggle("channels", c)} data-testid={`cw-channel-${c}`} />{t(`growth.campaigns.channel.${c}`)}</label>))}</div>
              {err("channels") && <p role="alert" className="mt-1 text-xs font-medium text-destructive">{err("channels")}</p>}
              {needsApproval && <p className="mt-2 text-xs text-warning" data-testid="cw-sensitive">{t("growth.campaigns.wizard.sensitive")}</p>}
            </fieldset>
          </div>)}
        {step === 2 && (
          <div className="space-y-4" data-testid="cw-audience">
            <p className="text-sm text-muted-foreground">{t("growth.campaigns.wizard.audienceHint")}</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label={t("growth.campaigns.wizard.patientType")}><select className={`${selectCls} w-full`} value={f.patientType} onChange={(e) => set("patientType", e.target.value)} data-testid="cw-patient-type">{["ANY", "NEW", "RETURNING"].map((p) => <option key={p} value={p}>{t(`growth.campaigns.wizard.patientTypes.${p}`)}</option>)}</select></FormField>
              <FormField label={t("growth.campaigns.wizard.cities")}><input className={inputCls} value={f.cities} onChange={(e) => set("cities", e.target.value)} data-testid="cw-cities" /></FormField>
              <FormField label={t("growth.campaigns.wizard.districts")}><input className={inputCls} value={f.districts} onChange={(e) => set("districts", e.target.value)} data-testid="cw-districts" /></FormField>
            </div>
            {([["platforms", ["web", "ios", "android"], "platform"], ["languages", ["ar", "en"], "language"], ["careTypes", ["IN_CLINIC", "VIDEO", "HOME_VISIT"], "careType"]] as const).map(([k, opts, ns]) => (
              <fieldset key={k}><legend className="text-sm font-medium">{t(`growth.campaigns.wizard.${k}`)}</legend><div className="mt-2 flex flex-wrap gap-2">{opts.map((o) => (<label key={o} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm ${f[k].includes(o) ? "border-primary bg-accent" : "bg-card"}`}><input type="checkbox" checked={f[k].includes(o)} onChange={() => toggle(k, o)} />{t(`growth.campaigns.wizard.${ns}.${o}`)}</label>))}</div></fieldset>))}
          </div>)}
        {step === 3 && <UtmBuilder value={utm} onChange={setUtm} market={g.market} keyValue={f.key} channels={f.channels} />}
        {step === 4 && (
          <div className="space-y-3 text-sm" data-testid="cw-review">
            <p className="text-muted-foreground">{t("growth.campaigns.wizard.reviewHint")}</p>
            <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
              <div><dt className="text-muted-foreground">{t("growth.campaigns.wizard.name")}</dt><dd className="font-medium">{f.name}</dd></div>
              <div><dt className="text-muted-foreground">{t("growth.campaigns.wizard.objective")}</dt><dd>{t(`growth.campaigns.objective.${f.objective}`)}</dd></div>
              <div><dt className="text-muted-foreground">{t("growth.campaigns.wizard.total")}</dt><dd dir="ltr">{f.total} EGP</dd></div>
              <div><dt className="text-muted-foreground">{t("growth.campaigns.wizard.channels")}</dt><dd>{f.channels.map((c) => t(`growth.campaigns.channel.${c}`)).join(", ")}</dd></div>
              <div className="sm:col-span-2"><dt className="text-muted-foreground">{t("growth.campaigns.wizard.webUrl")}</dt><dd><code dir="ltr" className="break-all text-xs">{links.url}</code></dd></div>
            </dl>
            <p className="rounded-xl bg-muted p-3" data-testid="cw-approval-note">{needsApproval ? t("growth.campaigns.wizard.needsApproval") : t("growth.campaigns.wizard.noApproval")}</p>
            {!f.startsAt || !f.endsAt ? <p className="text-xs text-warning">{t("growth.campaigns.wizard.datesRequired")}</p> : null}
            {serverError && <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-destructive" data-testid="cw-error">{serverError}</p>}
          </div>)}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <button type="button" className="h-11 rounded-xl border px-4 text-sm font-semibold hover:bg-accent disabled:opacity-50" disabled={step === 0} onClick={() => setStep((s) => s - 1)} data-testid="cw-back">{t("growth.campaigns.wizard.back")}</button>
          {step < 4
            ? <button type="button" className="h-11 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50" disabled={stepErrors[step]!.length > 0} onClick={() => setStep((s) => s + 1)} data-testid="cw-next">{t("growth.campaigns.wizard.next")}</button>
            : <button type="button" className="h-11 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50" disabled={!can || acts.create.isPending} onClick={submit} data-testid="cw-create">{acts.create.isPending ? t("growth.campaigns.wizard.creating") : t("growth.campaigns.wizard.create")}</button>}
        </div>
      </div>
    </GrowthPage>
  );
}
