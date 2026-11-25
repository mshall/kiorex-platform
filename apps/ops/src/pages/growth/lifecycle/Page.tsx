import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useLifecycle, useLifecycleFunnel, useLifecycleTemplates, type JourneyRow, type MessageClass, type TemplateRow } from "@/api/lifecycle";
import { DataTable, type Column } from "@/components/DataTable";
import { CardSkeleton, EmptyState, ErrorState } from "@/components/states";
import { GrowthPage, MarketSelect, useGrowthMarket } from "@/components/growth/GrowthPage";
import { StatCard, StatusChip, type Tone } from "@/components/kit";

export const classTone = (c: MessageClass): Tone => (c === "MARKETING" ? "warning" : c === "SECURITY" ? "danger" : c === "CLINICAL" ? "info" : "neutral");

export function ClassBadge({ c }: { c: MessageClass }) {
  const { t } = useTranslation();
  return <StatusChip tone={classTone(c)} data-testid={`class-${c}`}>{t(`growth.lifecycle.class.${c}`)}</StatusChip>;
}

/** GRW-P2-E: the journeys, their classes and steps, the policy in force, the stage funnel (k >= 10) and the template catalogue with a class badge and AR and EN preview. */
export default function LifecyclePage() {
  const { t, i18n } = useTranslation(); const g = useGrowthMarket();
  const ov = useLifecycle(g.market); const funnel = useLifecycleFunnel(g.market); const tpl = useLifecycleTemplates();
  const ar = i18n.language.startsWith("ar");
  const o = ov.data;
  const cols: Column<JourneyRow>[] = [
    { key: "key", header: t("growth.lifecycle.colJourney"), cell: (j) => <div><Link className="font-semibold text-primary hover:underline" to={`/growth/lifecycle/${j.key}`}>{t(`growth.lifecycle.journey.${j.key}`, { defaultValue: j.key })}</Link><p className="text-xs text-muted-foreground">{ar ? j.describe.ar : j.describe.en}</p></div> },
    { key: "classes", header: t("growth.lifecycle.colClass"), cell: (j) => <div className="flex flex-wrap gap-1">{[...new Set(j.steps.map((s) => s.messageClass))].map((c) => <ClassBadge key={c} c={c} />)}</div> },
    { key: "state", header: t("growth.lifecycle.colState"), cell: (j) => <StatusChip tone={j.enabled ? "success" : "neutral"}>{j.enabled ? t("growth.lifecycle.on") : t("growth.lifecycle.off")}</StatusChip> },
    { key: "active", header: t("growth.lifecycle.colActive"), cell: (j) => <span className="tabular-nums">{j.activeEnrolments}</span> },
  ];
  const tcols: Column<TemplateRow>[] = [
    { key: "kind", header: t("growth.lifecycle.colTemplate"), cell: (x) => <div><span className="font-mono text-xs">{x.kind}</span><p className="text-xs text-muted-foreground">{x.templateId}</p></div> },
    { key: "class", header: t("growth.lifecycle.colClass"), cell: (x) => <ClassBadge c={x.messageClass} /> },
    { key: "review", header: t("growth.lifecycle.colReview"), cell: (x) => <StatusChip tone={x.copyReview === "APPROVED" ? "success" : "warning"}>{t(`growth.lifecycle.review.${x.copyReview}`, { defaultValue: x.copyReview })}</StatusChip> },
    { key: "en", header: "EN", cell: (x) => <span dir="ltr" lang="en" className="text-xs">{x.en}</span> },
    { key: "ar", header: "AR", cell: (x) => <span dir="rtl" lang="ar" className="text-xs">{x.ar}</span> },
  ];
  return (
    <GrowthPage section="lifecycle" toolbar={<MarketSelect g={g} />}
      actions={<><Link to="/growth/lifecycle/send-gate" className="inline-flex h-11 items-center rounded-xl border px-4 text-sm font-semibold hover:bg-accent" data-testid="lifecycle-gate-link">{t("growth.lifecycle.sendGate")}</Link><Link to="/growth/lifecycle/suppression" className="inline-flex h-11 items-center rounded-xl border px-4 text-sm font-semibold hover:bg-accent" data-testid="lifecycle-suppression-link">{t("growth.lifecycle.suppression")}</Link></>}>
      <p className="rounded-xl bg-info-soft p-3 text-sm text-info" data-testid="lifecycle-privacy">{t("growth.lifecycle.privacy")}</p>
      {ov.isLoading ? <CardSkeleton rows={3} /> : ov.isError ? <ErrorState error={ov.error} onRetry={() => void ov.refetch()} /> : o ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="lifecycle-policy">
            <StatCard label={t("growth.lifecycle.flagJourneys")} value={o.flags.lifecycleJourneys ? t("growth.lifecycle.on") : t("growth.lifecycle.off")} tone={o.flags.lifecycleJourneys ? "ok" : "warn"} />
            <StatCard label={t("growth.lifecycle.flagMarketing")} value={o.flags.marketingMessaging ? t("growth.lifecycle.on") : t("growth.lifecycle.lockedOff")} hint={t("growth.lifecycle.flagMarketingHint")} tone={o.flags.marketingMessaging ? "ok" : "warn"} />
            <StatCard label={t("growth.lifecycle.caps")} value={`${o.policy.caps.perDay} / ${o.policy.caps.perWeek}`} hint={t("growth.lifecycle.capsHint")} />
            <StatCard label={t("growth.lifecycle.quiet")} value={`${o.policy.quietHours.start} - ${o.policy.quietHours.end}`} hint={`${o.policy.quietHours.timezone} · ${t("growth.lifecycle.holdout", { pct: (o.policy.holdoutBps / 100).toFixed(1) })} · v${o.policy.version} ${o.policy.source === "PROPOSED_DEFAULT" ? t("growth.lifecycle.proposed") : ""}`} />
          </div>
          <p className="text-xs text-muted-foreground">{t("growth.lifecycle.policyChange")} <Link className="text-primary underline underline-offset-2" to="/growth/config">{t("growth.lifecycle.policyLink")}</Link></p>
          <DataTable columns={cols} rows={o.journeys} rowKey={(j) => j.key} caption={t("growth.lifecycle.journeys")} empty={<EmptyState title={t("growth.lifecycle.empty")} />} />
        </>
      ) : null}
      <section aria-labelledby="lc-funnel" className="space-y-2">
        <h2 id="lc-funnel" className="text-base font-semibold">{t("growth.lifecycle.funnel")}</h2>
        <p className="text-xs text-muted-foreground">{t("growth.lifecycle.funnelHint")}</p>
        {funnel.isLoading ? <CardSkeleton rows={1} /> : funnel.isError ? <ErrorState error={funnel.error} onRetry={() => void funnel.refetch()} /> : (
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-7" data-testid="lifecycle-funnel">
            {(funnel.data ?? []).map((f) => <StatCard key={f.stage} label={t(`growth.lifecycle.stage.${f.stage}`, { defaultValue: f.stage })} value={f.count === null ? "<10" : f.count.toLocaleString(ar ? "ar-EG" : "en-GB")} />)}
          </div>
        )}
      </section>
      <section aria-labelledby="lc-templates" className="space-y-2">
        <h2 id="lc-templates" className="text-base font-semibold">{t("growth.lifecycle.templates")}</h2>
        <p className="text-xs text-muted-foreground">{t("growth.lifecycle.templatesHint")}</p>
        {tpl.isLoading ? <CardSkeleton rows={3} /> : tpl.isError ? <ErrorState error={tpl.error} onRetry={() => void tpl.refetch()} /> : <DataTable columns={tcols} rows={tpl.data ?? []} rowKey={(x) => x.kind} caption={t("growth.lifecycle.templates")} />}
      </section>
    </GrowthPage>
  );
}
