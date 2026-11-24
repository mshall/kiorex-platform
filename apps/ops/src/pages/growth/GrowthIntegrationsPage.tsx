import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { KeyRound } from "lucide-react";
import { useIntegrations } from "@/api/growth";
import { StatusChip } from "@/components/kit";
import { DataTable } from "@/components/DataTable";
import { CardSkeleton, ErrorState } from "@/components/states";
import { GrowthPage, MarketSelect, Section, useGrowthMarket } from "@/components/growth/GrowthPage";

/** Integration management: mode and readiness per provider. Secrets appear only as REFERENCES (the variable name and whether it is set); there is no field that can show or accept a secret value. */
export default function GrowthIntegrationsPage() {
  const { t } = useTranslation(); const g = useGrowthMarket(); const q = useIntegrations(g.market);
  return (
    <GrowthPage section="integrations" toolbar={<MarketSelect g={g} />}>
      {q.isLoading ? <CardSkeleton rows={2} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : q.data && (
        <>
          <p className="flex items-start gap-2 rounded-xl border bg-card p-3 text-sm" data-testid="secret-rule"><KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />{t("growth.integrations.secretRule")}</p>
          <Section title={t("growth.integrations.providers")} id="ig-providers" hint={t("growth.integrations.providersHint")}>
            <DataTable caption={t("growth.integrations.providers")} rows={q.data.providers} rowKey={(r) => r.kind} columns={[
              { key: "k", header: t("growth.integrations.kind"), cell: (r) => <b>{r.kind}</b> },
              { key: "m", header: t("growth.integrations.mode"), cell: (r) => <StatusChip tone={r.mode === "real" ? "warning" : "info"} data-testid={`mode-${r.kind}`}>{r.mode === "real" ? t("growth.integrations.real") : t("growth.integrations.mock")}</StatusChip> },
              { key: "p", header: t("growth.integrations.provider"), cell: (r) => r.provider },
              { key: "r", header: t("growth.integrations.ready"), cell: (r) => <StatusChip tone={r.ready ? "success" : "danger"}>{r.ready ? t("growth.integrations.readyYes") : t("growth.integrations.readyNo")}</StatusChip> },
              { key: "s", header: t("growth.integrations.secretRefs"), cell: (r) => <ul className="space-y-0.5">{r.secretRefs.map((s) => <li key={s.name} className="flex items-center gap-2"><code className="text-xs" dir="ltr">{s.name}</code><StatusChip tone={s.set ? "success" : "neutral"} dot={false}>{s.set ? t("growth.integrations.refSet") : t("growth.integrations.refUnset")}</StatusChip></li>)}</ul> },
              { key: "sel", header: t("growth.integrations.selected"), cell: (r) => r.selected === null ? "—" : r.selected ? t("growth.common.on") : t("growth.common.off") },
              { key: "pr", header: t("growth.integrations.problems"), cell: (r) => r.problems.length ? <ul className="text-xs text-destructive">{r.problems.map((p) => <li key={p}>{p}</li>)}</ul> : "—" },
            ]} />
          </Section>
          <Section title={t("growth.integrations.selection")} id="ig-selection" hint={t("growth.integrations.selectionHint")}>
            <p className="text-sm" data-testid="integration-selection">{Object.keys(q.data.selection).length === 0 ? t("growth.integrations.noSelection") : Object.entries(q.data.selection).map(([k, v]) => `${k}: ${v ? t("growth.common.on") : t("growth.common.off")}`).join(" · ")}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t("growth.integrations.waRef")}: <code dir="ltr">{q.data.whatsappPhoneNumberIdRef ?? "—"}</code></p>
            <Link to="/growth/markets" className="mt-2 inline-block text-sm font-semibold text-primary hover:underline">{t("growth.integrations.editSelection")}</Link>
          </Section>
          <Section title={t("growth.integrations.flags")} id="ig-flags" hint={t("growth.integrations.flagsHint")}>
            <ul className="space-y-1 text-sm">{q.data.flags.map((f) => <li key={f.key} className="flex flex-wrap items-center gap-2"><code className="text-xs">{f.key}</code><StatusChip tone={f.effective ? "success" : "neutral"}>{f.effective ? t("growth.common.on") : t("growth.common.off")}</StatusChip>{!f.effective && <span className="text-xs text-muted-foreground">{f.reason}</span>}</li>)}</ul>
            <Link to="/flags" className="mt-2 inline-block text-sm font-semibold text-primary hover:underline">{t("growth.integrations.openFlags")}</Link>
          </Section>
          <Section title={t("growth.integrations.planned")} id="ig-planned" hint={t("growth.integrations.plannedHint")}>
            <DataTable caption={t("growth.integrations.planned")} rows={q.data.planned} rowKey={(r) => r.key} columns={[
              { key: "l", header: t("growth.integrations.kind"), cell: (r) => r.label }, { key: "ph", header: t("growth.integrations.phase"), cell: (r) => <StatusChip tone="warning">{t("growth.planned.badge", { phase: r.phase })}</StatusChip> },
              { key: "d", header: t("growth.integrations.direction"), cell: (r) => <span className="text-xs">{r.direction}</span> }, { key: "n", header: t("growth.integrations.note"), cell: (r) => <span className="text-xs">{r.note}</span> },
            ]} />
          </Section>
        </>)}
    </GrowthPage>
  );
}
