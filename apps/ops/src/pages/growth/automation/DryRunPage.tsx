import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAutomationStatus, useJourney, useJourneyActions, type DryRun } from "@/api/automation";
import { GrowthPage, Section } from "@/components/growth/GrowthPage";
import { emptyModel, toGraph } from "./model";
import { StatusBanner, btnCls, errText, inputCls, primaryBtnCls } from "./shared";

/** Dry run of a saved journey (or of the starter example): volumes per step and the gate decisions on a synthetic cohort. Nobody is read, nothing is sent. */
export default function DryRunPage({ id }: { id: string | null }) {
  const { t } = useTranslation(); const q = useJourney(id); const st = useAutomationStatus(); const acts = useJourneyActions();
  const [size, setSize] = useState(1000); const [res, setRes] = useState<DryRun | null>(null); const [err, setErr] = useState("");
  const graph = q.data?.graph ?? (id ? null : toGraph(emptyModel()));
  const run = () => { if (!graph) return; setErr(""); acts.dryRun.mutate({ graph, size, seed: 20270128 }, { onSuccess: setRes, onError: (e) => setErr(errText(t, e)) }); };
  const r = res?.result;
  return (
    <GrowthPage section="automation" actions={<Link to={id ? `/growth/automation?id=${id}` : "/growth/automation"} className={btnCls} data-testid="dry-back">{t("growth.automation.back")}</Link>}>
      <StatusBanner status={st.data} />
      <Section title={t("growth.automation.dry.title")} hint={t("growth.automation.dry.hint")} id="dry-title">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block text-sm"><span className="font-medium">{t("growth.automation.dry.size")}</span><input type="number" min={10} max={5000} className={`${inputCls} mt-1 w-40`} value={size} onChange={(e) => setSize(Number(e.target.value))} data-testid="dry-size" /></label>
          <button className={primaryBtnCls} onClick={run} disabled={!graph || acts.dryRun.isPending} data-testid="dry-run">{t("growth.automation.dry.run")}</button>
        </div>
        {err && <p role="alert" className="mt-3 rounded-xl border border-destructive/40 p-3 text-sm" data-testid="dry-error">{err}</p>}
      </Section>
      {r && (
        <Section title={t("growth.automation.dry.total", { n: r.totalSent })} hint={t("growth.automation.dry.perPerson", { n: r.perPersonMax })} id="dry-result">
          {!r.marketingFlagOn && <p role="status" className="mb-3 rounded-xl border p-3 text-sm" data-testid="dry-flag-off">{t("growth.automation.dry.flagOff")}</p>}
          <ul className="space-y-3" data-testid="dry-steps">
            {r.steps.map((s) => (
              <li key={s.step} className="rounded-xl border bg-card p-3 text-sm" data-testid={`dry-step-${s.step}`}>
                <p className="font-semibold">{t("growth.automation.dry.step")} {s.step}: {t(`growth.automation.template.${s.template}`, { defaultValue: s.template })}</p>
                <dl className="mt-2 grid grid-cols-3 gap-2"><div><dt className="text-muted-foreground">{t("growth.automation.dry.reached")}</dt><dd data-testid={`dry-reached-${s.step}`}>{s.reached}</dd></div><div><dt className="text-muted-foreground">{t("growth.automation.dry.sent")}</dt><dd data-testid={`dry-sent-${s.step}`}>{s.sent}</dd></div><div><dt className="text-muted-foreground">{t("growth.automation.dry.deferred")}</dt><dd>{s.deferred}</dd></div></dl>
                <p className="mt-2 text-muted-foreground">{t("growth.automation.dry.skipped")}: {Object.keys(s.skipped).length ? Object.entries(s.skipped).map(([k, v]) => `${t(`growth.automation.dry.reason.${k}`, { defaultValue: k })} ${v}`).join(" · ") : t("growth.automation.dry.none")}</p>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm"><strong>{t("growth.automation.dry.exits")}:</strong> {Object.keys(r.exits).length ? Object.entries(r.exits).map(([k, v]) => `${t(`growth.automation.dry.exit.${k}`, { defaultValue: k })} ${v}`).join(" · ") : t("growth.automation.dry.none")}</p>
          <p className="mt-2 text-xs text-muted-foreground">{t("growth.automation.dry.hint")}</p>
        </Section>
      )}
    </GrowthPage>
  );
}
