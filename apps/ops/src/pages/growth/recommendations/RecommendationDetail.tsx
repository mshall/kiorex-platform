import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useGrowthAccess } from "@/api/growth";
import { useRecommendation, useRecommendationActions } from "@/api/recommendations";
import { GrowthPage, Section } from "@/components/growth/GrowthPage";
import { StatusChip } from "@/components/kit";
import { REC_TONE, errTextRec, textOf } from "./RecommendationsPage";

const btn = "inline-flex h-11 items-center justify-center rounded-xl border px-4 text-sm font-semibold disabled:opacity-50";
const show = (v: unknown): string => (v === null || v === undefined ? "—" : Array.isArray(v) ? v.join(", ") : typeof v === "object" ? Object.values(v as Record<string, unknown>).join(" .. ") : String(v));

/** One recommendation: why, the aggregate numbers, evidence, the AI-assisted summary (labelled), and the decision. Approving creates a DRAFT at most and says so. */
export default function RecommendationDetail({ id }: { id: string }) {
  const { t, i18n } = useTranslation(); const q = useRecommendation(id); const acts = useRecommendationActions();
  const access = useGrowthAccess(); const can = !!(access.data?.capabilities as Record<string, boolean> | undefined)?.manageCampaigns;
  const [note, setNote] = useState(""); const [err, setErr] = useState(""); const [result, setResult] = useState<{ ref: string | null; next: string | null; conversionError: string | null } | null>(null);
  const r = q.data;
  const decide = (decision: "APPROVE" | "REJECT") => { setErr(""); acts.decide.mutate({ id, decision, note: note.trim() || undefined }, { onSuccess: (x) => { setResult({ ref: x.convertedRef, next: x.next?.screen ?? null, conversionError: x.conversionError ?? null }); toast.success(t(`growth.recommendations.status.${x.status}`)); }, onError: (x) => setErr(errTextRec(t, x)) }); };
  const fb = (value: "USEFUL" | "NOT_USEFUL") => acts.feedback.mutate({ id, value }, { onError: (x) => setErr(errTextRec(t, x)) });
  return (
    <GrowthPage section="recommendations" actions={<Link to="/growth/recommendations" className={btn} data-testid="rec-back">{t("growth.recommendations.back")}</Link>}>
      {q.isLoading || !r ? <p className="text-sm text-muted-foreground">…</p> : (
        <>
          <div className="flex flex-wrap items-center gap-3"><h2 className="text-xl">{t(`growth.recommendations.kind.${r.kind}`)}</h2><StatusChip tone={REC_TONE[r.status]} data-testid="rec-status">{t(`growth.recommendations.status.${r.status}`)}</StatusChip>{r.aiAssisted && <StatusChip tone="brand" data-testid="rec-ai">{t("growth.recommendations.ai")}</StatusChip>}</div>
          <Section title={t("growth.recommendations.detail.rationale")} id="rec-why"><p className="text-sm" data-testid="rec-rationale">{textOf(r, i18n.language)}</p>
            {r.aiSummary && <div className="mt-3 rounded-xl border bg-card p-3 text-sm" data-testid="rec-summary"><p className="mb-1 text-xs font-semibold text-muted-foreground">{t("growth.recommendations.detail.summary")} · {r.aiSummary.label}</p><p>{i18n.language.startsWith("ar") ? r.aiSummary.ar : r.aiSummary.en}</p></div>}
            <p className="mt-2 text-xs text-muted-foreground">{t("growth.recommendations.confidence", { n: r.confidence })} · {t("growth.recommendations.expires", { date: new Date(r.expiresAt).toLocaleDateString() })}</p></Section>
          <Section title={t("growth.recommendations.detail.numbers")} id="rec-numbers">
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2" data-testid="rec-numbers">
              {Object.entries(r.payload).map(([k, v]) => <div key={k}><dt className="text-muted-foreground">{t(`growth.recommendations.num.${k}`, { defaultValue: k })}</dt><dd dir="ltr" className="break-all text-start">{show(v)}</dd></div>)}
            </dl>
            <h3 className="mt-4 text-sm font-semibold">{t("growth.recommendations.detail.evidence")}</h3>
            <ul className="mt-1 list-disc space-y-1 ps-5 text-sm" data-testid="rec-evidence">{r.evidenceRefs.map((e, k) => <li key={k} dir="ltr" className="text-start">{e.source} · {e.ref}{e.window ? ` · ${e.window}` : ""}</li>)}</ul>
          </Section>
          <Section title={t("growth.recommendations.detail.decision")} id="rec-decision">
            {r.status !== "PROPOSED" ? (
              <div className="space-y-2 text-sm" data-testid="rec-decided">
                {r.decidedBy && <p>{t("growth.recommendations.detail.decidedBy", { who: r.decidedBy })}{r.decisionNote ? ` · ${r.decisionNote}` : ""}</p>}
                {r.convertedRef && <p data-testid="rec-created">{t("growth.recommendations.detail.created", { ref: r.convertedRef })}</p>}
                {!r.convertedRef && r.next && <p data-testid="rec-next">{t("growth.recommendations.detail.next", { screen: r.next.screen })} <Link className="underline" to={r.next.screen}>{r.next.screen}</Link></p>}
              </div>
            ) : !can ? <p className="text-sm text-muted-foreground">{t("growth.automation.builder.needsRole")}</p> : (
              <div className="space-y-3">
                <label className="block text-sm"><span className="font-medium">{t("growth.recommendations.detail.note")}</span><input className="mt-1 h-11 w-full rounded-xl border border-input bg-card px-3 text-sm" value={note} onChange={(e) => setNote(e.target.value)} data-testid="rec-note" maxLength={300} /></label>
                <p className="text-xs text-muted-foreground">{t("growth.recommendations.detail.approveHint")}</p>
                <div className="flex flex-wrap gap-2"><button className={`${btn} bg-primary text-primary-foreground`} onClick={() => decide("APPROVE")} disabled={acts.decide.isPending} data-testid="rec-approve">{t("growth.recommendations.detail.approve")}</button><button className={btn} onClick={() => decide("REJECT")} disabled={acts.decide.isPending || note.trim().length < 3} data-testid="rec-reject">{t("growth.recommendations.detail.reject")}</button></div>
              </div>
            )}
            {result && <div role="status" className="mt-3 space-y-1 rounded-xl border p-3 text-sm" data-testid="rec-result">
              {result.ref && <p>{t("growth.recommendations.detail.created", { ref: result.ref })}</p>}{!result.ref && result.next && <p>{t("growth.recommendations.detail.next", { screen: result.next })}</p>}
              {result.conversionError && <p>{t("growth.recommendations.detail.conversionError", { code: result.conversionError })}</p>}</div>}
            {err && <p role="alert" className="mt-3 rounded-xl border border-destructive/40 p-3 text-sm" data-testid="rec-error">{err}</p>}
            {can && <div className="mt-4 flex flex-wrap items-center gap-2" role="group" aria-label={t("growth.recommendations.detail.feedback")}><span className="text-sm">{t("growth.recommendations.detail.feedback")}</span>
              <button className={btn} aria-pressed={r.feedback === "USEFUL"} onClick={() => fb("USEFUL")} data-testid="rec-useful">{t("growth.recommendations.detail.useful")}</button><button className={btn} aria-pressed={r.feedback === "NOT_USEFUL"} onClick={() => fb("NOT_USEFUL")} data-testid="rec-not-useful">{t("growth.recommendations.detail.notUseful")}</button></div>}
          </Section>
        </>
      )}
    </GrowthPage>
  );
}
