import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ApiError } from "@/api/errors";
import { useExperiment, useExperimentActions, type MaskedN } from "@/api/experiments";
import { useGrowthAccess } from "@/api/growth";
import { GrowthPage, Section } from "@/components/growth/GrowthPage";
import { StatusChip, type Tone } from "@/components/kit";
import ExperimentHistoryPage from "./ExperimentHistoryPage";
import { STATUS_TONE } from "./ExperimentsPage";

const VERDICT_TONE: Record<string, Tone> = { COLLECTING: "neutral", SRM_DETECTED: "danger", GUARDRAIL_BREACH: "danger", NO_WINNER: "info", WINNER: "success", INCONCLUSIVE: "warning" };
const pct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${(v * 100).toFixed(2)}%`);
const num = (v: MaskedN) => (v === "<10" ? "<10" : String(v));

/** One experiment: design, the actions the state allows, the result (hidden while SRM or a blocker stands) and the append-only history in a second tab. */
export default function ExperimentDetailPage({ id, tab }: { id: string; tab: "overview" | "history" }) {
  const { t } = useTranslation(); const q = useExperiment(id); const acts = useExperimentActions(); const access = useGrowthAccess();
  const can = !!(access.data?.capabilities as Record<string, boolean> | undefined)?.manageExperiments;
  const [reason, setReason] = useState(""); const [msg, setMsg] = useState("");
  const e = q.data;
  const errText = (x: unknown) => (x instanceof ApiError ? t(`growth.experiments.err.${x.code}`, { defaultValue: x.message }) : t("growth.experiments.err.generic"));
  const run = <T,>(m: { mutate: (v: T, o: { onSuccess: () => void; onError: (x: unknown) => void }) => void }, v: T, ok?: string) => { setMsg(""); m.mutate(v, { onSuccess: () => { toast.success(ok ?? t("growth.experiments.detail.done")); }, onError: (x) => setMsg(errText(x)) }); };
  const btn = "h-11 rounded-xl border px-4 text-sm font-semibold disabled:opacity-50";
  const r = e?.latestResult; const p = r?.payload;
  return (
    <GrowthPage section="experiments" actions={<Link to="/growth/experiments" className="inline-flex h-11 items-center rounded-xl border px-4 text-sm font-semibold" data-testid="exp-back">{t("growth.experiments.back")}</Link>}>
      {q.isLoading || !e ? <p className="text-sm text-muted-foreground">…</p> : (
        <>
          <div className="flex flex-wrap items-center gap-3"><h2 className="text-xl">{e.name}</h2><StatusChip tone={STATUS_TONE[e.status]} data-testid="exp-status">{t(`growth.experiments.status.${e.status}`)}</StatusChip></div>
          <div role="tablist" aria-label={t("growth.experiments.tabs")} className="flex gap-2">
            {(["overview", "history"] as const).map((k) => <Link key={k} role="tab" aria-selected={tab === k} to={`/growth/experiments?id=${id}${k === "history" ? "&tab=history" : ""}`} className={`inline-flex h-11 items-center rounded-xl border px-4 text-sm font-semibold ${tab === k ? "border-primary bg-primary text-primary-foreground" : "bg-card"}`} data-testid={`exp-tab-${k}`}>{t(`growth.experiments.tab.${k}`)}</Link>)}
          </div>
          {tab === "history" ? <Section title={t("growth.experiments.history.title")} id="exp-hist"><ExperimentHistoryPage id={id} /></Section> : (
            <>
              <Section title={t("growth.experiments.detail.design")} id="exp-design">
                <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2" data-testid="exp-design">
                  <Row k={t("growth.experiments.detail.surface")} v={<span dir="ltr" className="break-all">{e.surface}</span>} /><Row k={t("growth.experiments.detail.metric")} v={<span dir="ltr">{e.primaryMetric}</span>} />
                  <Row k={t("growth.experiments.detail.hypothesis")} v={e.hypothesis} wide /><Row k={t("growth.experiments.wizard.fields.mode")} v={t(`growth.experiments.mode.${e.mode}`)} />
                  <Row k={t("growth.experiments.detail.allocation")} v={`${e.allocationBp / 100}% · ${e.variants.map((v) => `${v.key} ${v.weightBp / 100}%`).join(" / ")}`} /><Row k={t("growth.experiments.detail.sample")} v={e.minSample.toLocaleString()} />
                  <Row k={t("growth.experiments.detail.days")} v={String(e.plannedDays)} /><Row k={t("growth.experiments.detail.started")} v={e.startedAt ? new Date(e.startedAt).toLocaleString() : "—"} />
                  <Row k={t("growth.experiments.detail.author")} v={<span dir="ltr" className="break-all">{e.createdBy}</span>} /><Row k={t("growth.experiments.detail.approver")} v={e.approvedBy ? <span dir="ltr" className="break-all">{e.approvedBy}</span> : "—"} />
                  {e.stopReason && <Row k={t("growth.experiments.detail.stopReason")} v={e.stopReason} wide />}
                </dl>
              </Section>
              <Section title={t("growth.experiments.detail.actions")} id="exp-actions">
                {!can ? <p className="text-sm text-muted-foreground">{t("growth.experiments.wizard.needsRole")}</p> : (
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                      {e.status === "DRAFT" && <button className={btn} onClick={() => run(acts.submit, e.id)} data-testid="act-submit">{t("growth.experiments.detail.submit")}</button>}
                      {e.status === "PENDING_APPROVAL" && <button className={btn} onClick={() => run(acts.approve, e.id)} data-testid="act-approve">{t("growth.experiments.detail.approve")}</button>}
                      {(e.status === "STOPPED" || e.status === "CONCLUDED") && <button className={btn} onClick={() => run(acts.archive, e.id)} data-testid="act-archive">{t("growth.experiments.detail.archive")}</button>}
                      {e.status === "CONCLUDED" && r?.verdict === "WINNER" && <button className={btn} onClick={() => run(acts.ship, e.id, t("growth.experiments.detail.shipped"))} data-testid="act-ship">{t("growth.experiments.detail.ship")}</button>}
                    </div>
                    {e.status === "PENDING_APPROVAL" && <p className="text-xs text-muted-foreground">{t("growth.experiments.detail.approveHint")}</p>}
                    {e.status === "CONCLUDED" && r?.verdict === "WINNER" && <p className="text-xs text-muted-foreground">{t("growth.experiments.detail.shipHint")}</p>}
                    {e.status === "RUNNING" && (
                      <div className="space-y-2"><label className="block text-sm"><span className="font-medium">{t("growth.experiments.detail.stopReason2")}</span><input className="mt-1 h-11 w-full rounded-xl border border-input bg-card px-3 text-sm" value={reason} onChange={(x) => setReason(x.target.value)} data-testid="stop-reason" /></label>
                        <p className="text-xs text-muted-foreground">{t("growth.experiments.detail.stopHint")}</p>
                        <button className={btn} disabled={reason.trim().length < 3} onClick={() => run(acts.stop, { id: e.id, reason: reason.trim() })} data-testid="act-stop">{t("growth.experiments.detail.stopConfirm")}</button></div>)}
                    {msg && <p role="alert" className="rounded-xl border border-destructive/40 p-3 text-sm" data-testid="exp-action-error">{msg}</p>}
                  </div>
                )}
              </Section>
              <Section title={t("growth.experiments.detail.results")} id="exp-results" hint={r ? t("growth.experiments.detail.dayN", { n: r.dayNumber }) : undefined}>
                {!r ? <p className="text-sm text-muted-foreground" data-testid="exp-no-result">{t("growth.experiments.detail.noResult")}</p> : (
                  <div className="space-y-4">
                    <StatusChip tone={VERDICT_TONE[r.verdict] ?? "neutral"} data-testid="exp-verdict">{t(`growth.experiments.verdict.${r.verdict}`)}</StatusChip>
                    {p?.hidden && <div role="status" className="rounded-xl border bg-card p-3 text-sm" data-testid="exp-hidden"><strong>{t("growth.experiments.detail.hiddenTitle")}</strong><ul className="mt-1 list-disc ps-5">{(p.blockers ?? []).map((b) => <li key={b}>{t(`growth.experiments.detail.blocker.${b.split(":")[0]}`, { defaultValue: b })}</li>)}</ul></div>}
                    {p?.srm && <p className="text-xs text-muted-foreground" data-testid="exp-srm">{t("growth.experiments.detail.srmLine")}: p = {p.srm.pValue.toExponential(2)}</p>}
                    {p?.arms && (
                      <div className="overflow-x-auto"><table className="w-full min-w-[22rem] text-sm" data-testid="exp-arms"><caption className="sr-only">{t("growth.experiments.detail.arms")}</caption>
                        <thead><tr className="text-start"><th scope="col" className="py-2 text-start">{t("growth.experiments.detail.arms")}</th><th scope="col" className="text-start">{t("growth.experiments.detail.units")}</th><th scope="col" className="text-start">{t("growth.experiments.detail.conversions")}</th><th scope="col" className="text-start">{t("growth.experiments.detail.rate")}</th></tr></thead>
                        <tbody>{p.arms.map((a) => <tr key={a.variant} className="border-t" data-testid={`arm-${a.variant}`}><th scope="row" className="py-2 text-start font-medium" dir="ltr">{a.variant}</th><td>{num(a.n)}</td><td>{num(a.x)}</td><td>{pct(a.rate)}</td></tr>)}</tbody></table></div>)}
                    {!p?.hidden && p?.treatments && p.treatments.length > 0 && (
                      <div className="overflow-x-auto"><table className="w-full min-w-[28rem] text-sm" data-testid="exp-treatments">
                        <thead><tr><th scope="col" className="py-2 text-start">{t("growth.experiments.detail.arms")}</th><th scope="col" className="text-start">{t("growth.experiments.detail.diff")}</th><th scope="col" className="text-start">{t("growth.experiments.detail.interval")}</th><th scope="col" className="text-start">{t("growth.experiments.detail.p")}</th></tr></thead>
                        <tbody>{p.treatments.map((x) => <tr key={x.variant} className="border-t"><th scope="row" className="py-2 text-start font-medium" dir="ltr">{x.variant}{p.winner === x.variant ? <StatusChip tone="success" className="ms-2">{t("growth.experiments.detail.winner")}</StatusChip> : null}</th><td dir="ltr">{pct(x.diff)}</td><td dir="ltr">{pct(x.ci.low)} to {pct(x.ci.high)}</td><td dir="ltr">{x.pAlwaysValid !== null ? x.pAlwaysValid.toFixed(4) : x.pAdjusted.toFixed(4)}</td></tr>)}</tbody></table></div>)}
                    {p?.guardrails && p.guardrails.length > 0 && <div data-testid="exp-guardrails"><h3 className="text-sm font-semibold">{t("growth.experiments.detail.guardrails")}</h3><ul className="mt-1 space-y-1 text-sm">{p.guardrails.map((g) => <li key={g.metric} className="flex items-center gap-2"><span dir="ltr">{g.metric}</span><StatusChip tone={g.breach ? "danger" : "success"}>{g.breach ? t("growth.experiments.detail.guardrailBreach") : t("growth.experiments.detail.guardrailOk")}</StatusChip></li>)}</ul></div>}
                  </div>
                )}
              </Section>
            </>
          )}
        </>
      )}
    </GrowthPage>
  );
}
const Row = ({ k, v, wide }: { k: string; v: ReactNode; wide?: boolean }) => <div className={wide ? "sm:col-span-2" : ""}><dt className="text-muted-foreground">{k}</dt><dd>{v}</dd></div>;
