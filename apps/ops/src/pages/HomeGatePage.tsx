import { useTranslation } from "react-i18next";
import { CheckCircle2, CircleAlert, Hourglass } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useHomeGateMetric } from "@/api/home";
import { CardSkeleton, ErrorState } from "@/components/states";
import { DataTable } from "@/components/DataTable";
import { PageHeader, StatTile } from "@/components/PageHeader";

/** Wire shape of `gates[GHV1]`: the flags this gate is required for and those a human has already recorded it for. */
type GateState = { recordedFor?: string[]; requiredFor?: string[] } | null | undefined;
const isRecorded = (g: GateState) => !!g && (g.requiredFor?.length ?? 0) > 0 && g.requiredFor!.every((k) => g.recordedFor?.includes(k));

/** KXMOP06: home-enabled provider count per launch cluster (>= 50) next to the human-recorded gate evidence. The metric NEVER satisfies a gate (ADR-024): only a human records GHV1/GHV2. */
export default function HomeGatePage() {
  const { t } = useTranslation();
  const q = useHomeGateMetric();
  return (
    <div className="space-y-5">
      <PageHeader title={t("homeGate.title")} hint={t("homeGate.hint")} />
      {q.isLoading ? <CardSkeleton rows={2} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : (() => {
        const m = q.data!; const gates = m.gates as Record<string, GateState>;
        return (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="gate-tiles">
              <StatTile label={t("homeGate.threshold")} value={m.threshold} />
              <StatTile label={t("homeGate.anyMet")} value={m.anyMet ? t("common.yes") : t("common.no")} tone={m.anyMet ? "ok" : "warn"} />
              <StatTile label={t("homeGate.allMet")} value={m.allMet ? t("common.yes") : t("common.no")} tone={m.allMet ? "ok" : "warn"} />
              <StatTile label={t("homeGate.safetyConsole")} value={m.safetyConsoleLive ? t("homeGate.live") : t("homeGate.notLive")} tone={m.safetyConsoleLive ? "ok" : "warn"} />
            </div>
            <section className="kx-card space-y-3 p-5" aria-labelledby="gev">
              <h2 id="gev" className="text-lg">{t("homeGate.evidence")}</h2>
              <p className="text-sm text-muted-foreground">{t("homeGate.evidenceHint")}</p>
              <ul className="flex flex-wrap gap-3" data-testid="gate-evidence">
                {Object.entries(gates).map(([id, g]) => (
                  <li key={id} className="flex items-center gap-2 rounded-xl border p-3" data-testid={`gate-${id}`} data-recorded={isRecorded(g)}>
                    {isRecorded(g) ? <CheckCircle2 className="h-5 w-5 text-success" aria-hidden="true" /> : <Hourglass className="h-5 w-5 text-warning" aria-hidden="true" />}
                    <b>{id}</b><Badge variant={isRecorded(g) ? "success" : "warning"}>{isRecorded(g) ? t("homeGate.recorded") : t("homeGate.awaitingHuman")}</Badge><span className="text-xs text-muted-foreground">{g?.recordedFor?.length ?? 0}/{g?.requiredFor?.length ?? 0}</span>
                  </li>
                ))}
              </ul>
            </section>
            <DataTable caption={t("homeGate.clusters", { basis: m.clusterBasis })} rows={m.clusters} rowKey={(c) => c.cluster} empty={t("homeGate.noClusters")} columns={[
              { key: "c", header: t("homeGate.cluster", { basis: m.clusterBasis }), cell: (c) => <b>{c.cluster}</b> },
              { key: "n", header: t("homeGate.providers"), cell: (c) => (
                <div className="w-56 space-y-1"><div className="flex justify-between text-xs"><span className="kx-label-num">{c.homeEnabledProviders} / {c.threshold}</span><span>{Math.min(100, Math.round((c.homeEnabledProviders / c.threshold) * 100))}%</span></div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={c.threshold} aria-valuenow={c.homeEnabledProviders} aria-label={c.cluster}><div className={c.met ? "h-full bg-success" : "h-full bg-warning"} style={{ width: `${Math.min(100, (c.homeEnabledProviders / c.threshold) * 100)}%` }} /></div></div>) },
              { key: "t", header: t("homeGate.byCareType"), cell: (c) => <span className="text-xs">{Object.entries(c.byCareType).map(([k, v]) => `${k}: ${String(v)}`).join(" · ") || "—"}</span> },
              { key: "m", header: t("homeGate.status"), cell: (c) => c.met ? <Badge variant="success" data-testid="cluster-met">{t("homeGate.met")}</Badge> : <Badge variant="warning" data-testid="cluster-short"><CircleAlert className="me-1 h-3 w-3" aria-hidden="true" />{t("homeGate.short", { n: Math.max(0, c.threshold - c.homeEnabledProviders) })}</Badge> },
            ]} />
          </>
        );
      })()}
    </div>
  );
}
