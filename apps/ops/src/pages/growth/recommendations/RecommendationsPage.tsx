import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { toast } from "sonner";
import { ApiError } from "@/api/errors";
import { useGrowthAccess } from "@/api/growth";
import { useRecCatalog, useRecommendationActions, useRecommendations, type RecStatus, type Recommendation } from "@/api/recommendations";
import { GrowthPage, Section, selectCls } from "@/components/growth/GrowthPage";
import { StatusChip, type Tone } from "@/components/kit";

export const REC_TONE: Record<RecStatus, Tone> = { PROPOSED: "warning", APPROVED: "success", REJECTED: "neutral", EXPIRED: "neutral", CONVERTED: "info" };
const STATUSES: RecStatus[] = ["PROPOSED", "APPROVED", "CONVERTED", "REJECTED", "EXPIRED"];
export const textOf = (r: Recommendation, lang: string) => (lang.startsWith("ar") ? r.rationale.ar : r.rationale.en);
export const errTextRec = (t: TFunction, x: unknown) => (x instanceof ApiError ? t(`growth.recommendations.err.${x.code}`, { defaultValue: t("growth.recommendations.err.generic") }) : t("growth.recommendations.err.generic"));

/** The recommendation inbox: proposals with kind, confidence, the AI-assisted label, expiry and status. Cards at every width. */
export default function RecommendationsPage() {
  const { t, i18n } = useTranslation(); const [status, setStatus] = useState(""); const [kind, setKind] = useState("");
  const list = useRecommendations({ status: status || undefined, kind: kind || undefined }); const cat = useRecCatalog(); const acts = useRecommendationActions();
  const access = useGrowthAccess(); const can = !!(access.data?.capabilities as Record<string, boolean> | undefined)?.manageCampaigns;
  const rows = list.data ?? []; const [err, setErr] = useState("");
  const run = () => { setErr(""); acts.run.mutate(undefined, { onSuccess: (r) => toast.success(t("growth.recommendations.ran", { created: r.created, existing: r.existing })), onError: (x) => setErr((x instanceof ApiError ? t(`growth.recommendations.err.${x.code}`, { defaultValue: "" }) : "") || t("growth.recommendations.err.generic")) }); };
  return (
    <GrowthPage section="recommendations" actions={can ? <button className="inline-flex h-11 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50" onClick={run} disabled={acts.run.isPending} data-testid="rec-run">{t("growth.recommendations.run")}</button> : null}
      toolbar={<>
        <label className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">{t("growth.recommendations.filters.status")}</span><select className={selectCls} value={status} onChange={(e) => setStatus(e.target.value)} data-testid="rec-status-filter"><option value="">{t("growth.recommendations.filters.all")}</option>{STATUSES.map((s) => <option key={s} value={s}>{t(`growth.recommendations.status.${s}`)}</option>)}</select></label>
        <label className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">{t("growth.recommendations.filters.kind")}</span><select className={selectCls} value={kind} onChange={(e) => setKind(e.target.value)} data-testid="rec-kind-filter"><option value="">{t("growth.recommendations.filters.all")}</option>{(cat.data?.kinds ?? []).map((k) => <option key={k} value={k}>{t(`growth.recommendations.kind.${k}`)}</option>)}</select></label></>}>
      <p className="rounded-xl border bg-card p-3 text-sm" data-testid="rec-banner">{t("growth.recommendations.banner")}</p>
      {err && <p role="alert" className="rounded-xl border border-destructive/40 p-3 text-sm" data-testid="rec-error">{err}</p>}
      <Section title={t("growth.sections.recommendations.title")} id="rec-list">
        {list.isLoading ? <p className="text-sm text-muted-foreground">…</p> : rows.length === 0 ? <p className="text-sm text-muted-foreground" data-testid="rec-empty">{t("growth.recommendations.empty")}</p> : (
          <ul className="space-y-3" data-testid="rec-list">
            {rows.map((r) => (
              <li key={r.id} className="rounded-xl border bg-card p-3" data-testid={`rec-row-${r.id}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link to={`/growth/recommendations?id=${r.id}`} className="font-semibold underline-offset-4 hover:underline" data-testid={`rec-open-${r.id}`}>{t(`growth.recommendations.kind.${r.kind}`)}</Link>
                  <span className="flex flex-wrap gap-2"><StatusChip tone={REC_TONE[r.status]}>{t(`growth.recommendations.status.${r.status}`)}</StatusChip><StatusChip tone={r.aiAssisted ? "brand" : "neutral"} data-testid={`rec-ai-${r.id}`}>{r.aiAssisted ? t("growth.recommendations.ai") : t("growth.recommendations.rulesOnly")}</StatusChip></span>
                </div>
                <p className="mt-2 text-sm">{textOf(r, i18n.language)}</p>
                <p className="mt-2 text-xs text-muted-foreground">{t("growth.recommendations.confidence", { n: r.confidence })} · {t("growth.recommendations.expires", { date: new Date(r.expiresAt).toLocaleDateString() })}</p>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </GrowthPage>
  );
}
