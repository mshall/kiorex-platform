import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { KeyRound, PlugZap, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/api/errors";
import { useGrowthAccess } from "@/api/growth";
import { useIntegrationActions, useIntegrationRuns, useIntegrationStatus, type IntegrationRow } from "@/api/integrations";
import { StatusChip } from "@/components/kit";
import { DataTable } from "@/components/DataTable";
import { CardSkeleton, ErrorState } from "@/components/states";
import { Section } from "@/components/growth/GrowthPage";
import { formatDateTime } from "@/lib/format";

const circuitTone = { CLOSED: "success", HALF_OPEN: "warning", OPEN: "danger" } as const;
const err = (e: unknown, fb: string) => (e instanceof ApiError ? `${e.code}: ${e.message}` : fb);

/** GRW-P2-F marketing integrations: mode, circuit, last run, secretRef presence (a boolean), test connection, run history and pull now (real mode: a second super admin confirms). */
export function IntegrationsPanel({ market }: { market: string }) {
  const { t, i18n } = useTranslation(); const q = useIntegrationStatus(market); const [kind, setKind] = useState<string | undefined>(undefined);
  const runs = useIntegrationRuns(market, kind); const act = useIntegrationActions(market); const can = useGrowthAccess().data?.capabilities.manage;
  const [pending, setPending] = useState<Record<string, string>>({}); const [confirmId, setConfirmId] = useState<Record<string, string>>({});
  const test = (k: string) => act.test.mutate(k, { onSuccess: (r) => toast[r.ok ? "success" : "error"](`${k}: ${r.ok ? t("growth.integrations2.testOk") : t("growth.integrations2.testFail")} (${r.detail})`), onError: (e) => toast.error(err(e, t("states.errorTitle"))) });
  const pull = (r: IntegrationRow) => {
    if (r.mode === "mock") return act.run.mutate({ kind: r.kind }, { onSuccess: (x) => toast.success(`${r.label}: ${x.status} (${x.rows})`), onError: (e) => toast.error(err(e, t("states.errorTitle"))) });
    if (!pending[r.kind]) return act.request.mutate(r.kind, { onSuccess: (x) => { setPending((p) => ({ ...p, [r.kind]: x.requestId })); toast.info(t("growth.integrations2.requested")); }, onError: (e) => toast.error(err(e, t("states.errorTitle"))) });
  };
  const confirm = (r: IntegrationRow) => act.run.mutate({ kind: r.kind, requestId: confirmId[r.kind]?.trim() }, { onSuccess: (x) => toast.success(`${r.label}: ${x.status}${x.reason ? ` (${x.reason})` : ""}`), onError: (e) => toast.error(err(e, t("states.errorTitle"))) });
  return (
    <>
      <p className="flex items-start gap-2 rounded-xl border bg-card p-3 text-sm" data-testid="integration-rules"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />{t("growth.integrations2.rules")}</p>
      <Section title={t("growth.integrations2.title")} id="ig2-status" hint={t("growth.integrations2.hint")}>
        {q.isLoading ? <CardSkeleton rows={3} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : q.data && (
          <DataTable caption={t("growth.integrations2.title")} rows={q.data.integrations} rowKey={(r) => r.kind} columns={[
            { key: "k", header: t("growth.integrations.kind"), cell: (r) => <div><b>{r.label}</b><div className="text-xs text-muted-foreground" dir="ltr">{r.kind}</div></div> },
            { key: "m", header: t("growth.integrations.mode"), cell: (r) => <div className="flex flex-wrap gap-1"><StatusChip tone={r.mode === "real" ? "warning" : "info"} data-testid={`ig-mode-${r.kind}`}>{r.mode === "real" ? t("growth.integrations.real") : t("growth.integrations.mock")}</StatusChip>{r.synthetic && <StatusChip tone="neutral" dot={false}>{t("growth.integrations2.synthetic")}</StatusChip>}</div> },
            { key: "f", header: t("growth.integrations2.flag"), cell: (r) => <StatusChip tone={r.flagEffective ? "success" : "neutral"}>{r.flagEffective ? t("growth.common.on") : t("growth.common.off")}</StatusChip> },
            { key: "c", header: t("growth.integrations2.circuit"), cell: (r) => <div><StatusChip tone={circuitTone[r.circuit]} data-testid={`ig-circuit-${r.kind}`}>{t(`growth.integrations2.circuits.${r.circuit}`)}</StatusChip>{r.consecutiveFailures > 0 && <div className="text-xs text-muted-foreground">{t("growth.integrations2.failures", { count: r.consecutiveFailures })}</div>}</div> },
            { key: "s", header: t("growth.integrations2.secret"), cell: (r) => <span className="flex items-center gap-1 text-xs"><KeyRound className="h-3 w-3" aria-hidden="true" />{r.secretRefConfigured ? (r.secretRefSet ? t("growth.integrations.refSet") : t("growth.integrations.refUnset")) : t("growth.integrations2.noRef")}</span> },
            { key: "l", header: t("growth.integrations2.lastRun"), cell: (r) => r.lastRun ? <div className="text-xs"><StatusChip tone={r.lastRun.status === "OK" ? "success" : r.lastRun.status === "PARTIAL" ? "warning" : "danger"}>{r.lastRun.status}</StatusChip><div>{formatDateTime(r.lastRun.startedAt, i18n.language)}</div></div> : <span className="text-xs text-muted-foreground">{t("growth.integrations2.notConnected")}</span> },
            { key: "r", header: t("growth.integrations2.retention"), cell: (r) => <div className="text-xs"><div>{t("growth.integrations2.months", { count: r.retentionMonths })}</div><div className="text-muted-foreground">{r.location}</div></div> },
            { key: "a", header: t("growth.integrations2.actions"), cell: (r) => (
              <div className="flex flex-col items-start gap-1">
                <Button size="sm" variant="outline" onClick={() => test(r.kind)} disabled={act.test.isPending} data-testid={`ig-test-${r.kind}`}><PlugZap className="me-1 h-3 w-3" aria-hidden="true" />{t("growth.integrations2.test")}</Button>
                {can && <Button size="sm" variant="outline" onClick={() => pull(r)} disabled={act.run.isPending || act.request.isPending || !!pending[r.kind]} data-testid={`ig-pull-${r.kind}`}>{r.mode === "real" ? (pending[r.kind] ? t("growth.integrations2.awaiting") : t("growth.integrations2.requestPull")) : t("growth.integrations2.pullNow")}</Button>}
                {can && r.mode === "real" && pending[r.kind] && <div className="flex flex-col gap-1"><p className="text-xs text-muted-foreground">{t("growth.integrations2.shareId")} <code dir="ltr" data-testid={`ig-request-${r.kind}`}>{pending[r.kind]}</code></p>
                  <label className="text-xs"><span className="sr-only">{t("growth.integrations2.requestId")}</span><input className="h-9 w-44 rounded-lg border bg-card px-2 text-xs" dir="ltr" placeholder={t("growth.integrations2.requestId")} value={confirmId[r.kind] ?? ""} onChange={(e) => setConfirmId((p) => ({ ...p, [r.kind]: e.target.value }))} /></label>
                  <Button size="sm" onClick={() => confirm(r)} disabled={!confirmId[r.kind]} data-testid={`ig-confirm-${r.kind}`}>{t("growth.integrations2.confirmPull")}</Button></div>}
              </div>) },
          ]} />)}
      </Section>
      <Section title={t("growth.integrations2.history")} id="ig2-runs" hint={t("growth.integrations2.historyHint")}>
        <label className="mb-2 flex items-center gap-2 text-sm"><span className="text-muted-foreground">{t("growth.integrations.kind")}</span>
          <select className="h-11 rounded-xl border border-input bg-card px-3 text-sm" value={kind ?? ""} onChange={(e) => setKind(e.target.value || undefined)} data-testid="ig-runs-kind"><option value="">{t("growth.integrations2.allKinds")}</option>{q.data?.integrations.map((i) => <option key={i.kind} value={i.kind}>{i.label}</option>)}</select></label>
        {runs.isLoading ? <CardSkeleton rows={2} /> : runs.error ? <ErrorState error={runs.error} onRetry={() => void runs.refetch()} /> : (
          <DataTable caption={t("growth.integrations2.history")} rows={runs.data ?? []} rowKey={(r) => r.id} empty={t("growth.integrations2.noRuns")} columns={[
            { key: "k", header: t("growth.integrations.kind"), cell: (r) => <code className="text-xs" dir="ltr">{r.kind}</code> },
            { key: "s", header: t("growth.integrations2.status"), cell: (r) => <StatusChip tone={r.status === "OK" ? "success" : r.status === "PARTIAL" ? "warning" : "danger"}>{r.status}</StatusChip> },
            { key: "m", header: t("growth.integrations.mode"), cell: (r) => r.mode },
            { key: "w", header: t("growth.integrations2.window"), cell: (r) => <span className="text-xs" dir="ltr">{r.windowFrom} → {r.windowTo}</span> },
            { key: "n", header: t("growth.integrations2.rows"), cell: (r) => r.rows },
            { key: "e", header: t("growth.integrations2.error"), cell: (r) => (r.error ? <code className="text-xs">{r.error}</code> : "—") },
            { key: "t", header: t("growth.integrations2.started"), cell: (r) => <span className="text-xs">{formatDateTime(r.startedAt, i18n.language)}</span> },
          ]} />)}
      </Section>
    </>
  );
}
