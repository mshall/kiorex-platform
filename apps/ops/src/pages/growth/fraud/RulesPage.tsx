import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useFraudRules } from "@/api/growthFraud";
import { StatusChip } from "@/components/kit";
import { DataTable } from "@/components/DataTable";
import { CardSkeleton, ErrorState } from "@/components/states";
import { Section } from "@/components/growth/GrowthPage";

/** Rules, weights, caps, the enforce switch of each rule, the action per surface and the thresholds: read-only (the FRAUD_RULES configuration changes them with a second approver). */
export default function RulesPage() {
  const { t } = useTranslation(); const q = useFraudRules();
  if (q.isLoading) return <CardSkeleton rows={4} />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const { config: c } = q.data; const rows = q.data.ruleIds.map((id) => ({ id, ...c.rules[id]! }));
  return (
    <div className="space-y-5" data-testid="fraud-rules-tab">
      <p className="rounded-xl bg-muted/50 p-3 text-sm" data-testid="fraud-mode-banner">{c.enforce ? t("growth.fraudV2.enforceBanner") : t("growth.fraudV2.shadowBanner")}</p>
      <Section title={t("growth.fraudV2.rules.title")} id="fr-rules" hint={t("growth.fraudV2.rules.readOnly")}>
        <p className="mb-2 text-sm" data-testid="fraud-rules-source">{t("growth.fraudV2.rules.source", { source: q.data.source })} · {t("growth.fraudV2.rules.bands", { review: c.bands.review, hold: c.bands.hold, d: c.diminishing })}</p>
        <DataTable caption={t("growth.fraudV2.rules.caption")} rows={rows} rowKey={(r) => r.id} empty="—" columns={[
          { key: "r", header: t("growth.fraudV2.rule"), cell: (r) => <code className="text-xs">{r.id}</code> },
          { key: "w", header: t("growth.fraudV2.weight"), cell: (r) => <span className="kx-label-num">{r.weight}</span> }, { key: "c", header: t("growth.fraudV2.rules.cap"), cell: (r) => <span className="kx-label-num">{r.cap}</span> },
          { key: "o", header: t("growth.fraudV2.rules.enabled"), cell: (r) => (r.enabled ? "✓" : "—") },
          { key: "e", header: t("growth.fraudV2.rules.enforce"), cell: (r) => <StatusChip tone={c.enforce && r.enforce ? "info" : "neutral"}>{c.enforce && r.enforce ? t("growth.fraudV2.mode_ENFORCE") : t("growth.fraudV2.mode_SHADOW")}</StatusChip> },
        ]} />
        <Link className="mt-3 inline-flex min-h-11 items-center text-sm underline" to="/growth/config" data-testid="fraud-config-link">{t("growth.fraudV2.rules.link")}</Link>
      </Section>
      <Section title={t("growth.fraudV2.rules.actions")} id="fr-actions">
        <DataTable caption={t("growth.fraudV2.rules.actions")} rows={Object.entries(c.actions).map(([surface, a]) => ({ surface, ...a }))} rowKey={(r) => r.surface} empty="—" columns={[
          { key: "s", header: "surface", cell: (r) => <code className="text-xs">{r.surface}</code> }, { key: "r", header: t("growth.fraudV2.band_MEDIUM"), cell: (r) => <code className="text-xs">{(r as Record<string, string>).REVIEW ?? "—"}</code> }, { key: "h", header: t("growth.fraudV2.band_HIGH"), cell: (r) => <code className="text-xs">{(r as Record<string, string>).HOLD ?? "—"}</code> },
        ]} />
      </Section>
      <Section title={t("growth.fraudV2.rules.thresholds")} id="fr-thr">
        <dl className="grid gap-2 text-sm md:grid-cols-2">{Object.entries(c.thresholds).map(([k, v]) => <div key={k} className="flex justify-between gap-3 border-b border-border/50 py-1"><dt className="text-muted-foreground">{k}</dt><dd className="kx-label-num">{v}</dd></div>)}</dl>
      </Section>
    </div>
  );
}
