import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { TIERS, useLoyaltyRules, useLoyaltySummary, useTierPreview, type Cell } from "@/api/loyalty";
import { Section } from "@/components/growth/GrowthPage";
import { FormField, StatusChip } from "@/components/kit";
import { DataTable } from "@/components/DataTable";
import { CardSkeleton, ErrorState } from "@/components/states";
import { fmtN } from "@/lib/growthFormat";
import { formatMinor } from "@/lib/format";

const MASK = "<10";
const inputCls = "h-11 w-full rounded-xl border border-input bg-card px-3 text-sm";
const cell = (v: Cell | undefined) => (v === null || v === undefined ? MASK : fmtN(v));

/** The tier ladder and the points rules in force (GRW-P4-D), read only: the rules are edited in the config console (kind LOYALTY_RULES) with a second approver. A tier whose threshold is 0 is not defined: nobody reaches it. */
export default function TiersPage() {
  const { t, i18n } = useTranslation(); const r = useLoyaltyRules(); const s = useLoyaltySummary(); const [n, setN] = useState(""); const preview = useTierPreview(n === "" ? null : Number(n));
  const R = r.data?.rules;
  return (
    <div className="space-y-5">
      <Section title={t("growth.loyalty.tiersTitle")} id="loy-tiers" hint={t("growth.loyalty.tiersHint", { months: R?.windowMonths ?? 12 })}>
        {r.isLoading ? <CardSkeleton rows={3} /> : r.error || !R ? <ErrorState error={r.error} onRetry={() => void r.refetch()} /> : (
          <div className="space-y-4">
            <DataTable caption={t("growth.loyalty.tiersTitle")} rows={[...TIERS]} rowKey={(x) => x} empty="" columns={[
              { key: "t", header: t("growth.loyalty.colTier"), cell: (x) => <span className="font-semibold">{t(`growth.loyalty.tier.${x}`)}</span> },
              { key: "m", header: t("growth.loyalty.colMin"), cell: (x) => R.tiers[x].minCompletedBookings > 0 ? <span className="tabular-nums" data-testid={`loy-min-${x}`}>{fmtN(R.tiers[x].minCompletedBookings)}</span> : <StatusChip tone="neutral" dot={false}>{t("growth.loyalty.notDefined")}</StatusChip> },
              { key: "b", header: t("growth.loyalty.colBonus"), cell: (x) => <span className="tabular-nums">{fmtN(R.tiers[x].bonusPoints)}</span> },
              { key: "p", header: t("growth.loyalty.colPeople"), cell: (x) => <span className="tabular-nums" data-testid={`loy-people-${x}`}>{cell(s.data?.tiers[x])}</span> },
            ]} />
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="loy-rules">
              {([["perBooking", fmtN(R.pointsPerCompletedBooking)], ["annualCap", fmtN(R.annualCapPoints)], ["expiry", t("growth.loyalty.months", { count: R.expiryMonths })], ["window", t("growth.loyalty.months", { count: R.windowMonths })],
                ["convPoints", fmtN(R.conversion.pointsRequired)], ["convValue", formatMinor(R.conversion.valueMinor, i18n.language)], ["convMax", fmtN(R.conversion.maxBlocksPerYear)]] as const).map(([k, v]) => (
                <div key={k} className="kx-card p-3"><dt className="text-xs text-muted-foreground">{t(`growth.loyalty.rule.${k}`)}</dt><dd className="mt-1 text-lg font-semibold tabular-nums" data-testid={`loy-rule-${k}`}>{v}</dd></div>))}
            </dl>
            <p className="rounded-xl border bg-card p-3 text-sm" data-testid="loy-edit-note">{t("growth.loyalty.editNote")} <Link className="font-semibold text-primary hover:underline" to="/growth/config">{t("growth.loyalty.openConfig")}</Link></p>
            <p className="rounded-xl border border-warning/40 bg-warning/5 p-3 text-sm" data-needs-human="true" data-testid="loy-needs-human">{t("growth.loyalty.needsHuman")}</p>
          </div>)}
      </Section>
      <Section title={t("growth.loyalty.calcTitle")} id="loy-calc" hint={t("growth.loyalty.calcHint")}>
        <div className="flex flex-wrap items-end gap-3">
          <FormField label={t("growth.loyalty.calcLabel")} className="w-56"><input className={inputCls} inputMode="numeric" value={n} onChange={(e) => setN(e.target.value.replace(/\D/g, "").slice(0, 4))} data-testid="loy-calc-input" /></FormField>
          <p className="h-11 content-center text-sm" aria-live="polite" data-testid="loy-calc-result">{preview.data ? t("growth.loyalty.calcResult", { count: preview.data.completed, tier: t(`growth.loyalty.tier.${preview.data.tier}`) }) : ""}</p>
        </div>
      </Section>
    </div>
  );
}
