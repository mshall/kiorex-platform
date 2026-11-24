import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useExperiments, type ExperimentStatus } from "@/api/experiments";
import { useGrowthAccess } from "@/api/growth";
import { GrowthPage, Section, selectCls } from "@/components/growth/GrowthPage";
import { StatusChip, type Tone } from "@/components/kit";

export const STATUS_TONE: Record<ExperimentStatus, Tone> = { DRAFT: "neutral", PENDING_APPROVAL: "warning", RUNNING: "success", STOPPED: "danger", CONCLUDED: "info", ARCHIVED: "neutral" };
const STATUSES: ExperimentStatus[] = ["DRAFT", "PENDING_APPROVAL", "RUNNING", "STOPPED", "CONCLUDED", "ARCHIVED"];

/** The list of experiments with a status filter. Plain table on wide screens, cards on narrow ones (no horizontal scroll at 320 px). */
export default function ExperimentsPage() {
  const { t } = useTranslation(); const [status, setStatus] = useState(""); const list = useExperiments({ status: status || undefined });
  const access = useGrowthAccess(); const can = !!(access.data?.capabilities as Record<string, boolean> | undefined)?.manageExperiments;
  const rows = list.data ?? [];
  return (
    <GrowthPage section="experiments" actions={can ? <Link to="/growth/experiments?new=1" className="inline-flex h-11 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground" data-testid="exp-new">{t("growth.experiments.new")}</Link> : null}
      toolbar={<label className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">{t("growth.experiments.filters.status")}</span>
        <select className={selectCls} value={status} onChange={(e) => setStatus(e.target.value)} data-testid="exp-status-filter"><option value="">{t("growth.experiments.filters.all")}</option>{STATUSES.map((s) => <option key={s} value={s}>{t(`growth.experiments.status.${s}`)}</option>)}</select></label>}>
      <p className="rounded-xl border bg-card p-3 text-sm" data-testid="exp-policy">{t("growth.experiments.policyLine")}</p>
      <Section title={t("growth.experiments.title")} id="exp-list">
        {list.isLoading ? <p className="text-sm text-muted-foreground">…</p> : rows.length === 0 ? <p className="text-sm text-muted-foreground" data-testid="exp-empty">{t("growth.experiments.list.empty")}</p> : (
          <ul className="space-y-3" data-testid="exp-list">
            {rows.map((e) => (
              <li key={e.id} className="rounded-xl border bg-card p-3" data-testid={`exp-row-${e.key}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0"><Link to={`/growth/experiments?id=${e.id}`} className="font-semibold underline-offset-4 hover:underline" data-testid={`exp-open-${e.key}`}>{e.name}</Link><p className="break-all text-xs text-muted-foreground" dir="ltr">{e.key}</p></div>
                  <StatusChip tone={STATUS_TONE[e.status]}>{t(`growth.experiments.status.${e.status}`)}</StatusChip>
                </div>
                <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
                  <div><dt className="text-muted-foreground">{t("growth.experiments.list.surface")}</dt><dd className="break-all" dir="ltr">{e.surface}</dd></div>
                  <div><dt className="text-muted-foreground">{t("growth.experiments.list.mode")}</dt><dd>{t(`growth.experiments.mode.${e.mode}`)}</dd></div>
                  <div><dt className="text-muted-foreground">{t("growth.experiments.list.started")}</dt><dd>{e.startedAt ? new Date(e.startedAt).toLocaleDateString() : "—"}</dd></div>
                </dl>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </GrowthPage>
  );
}
