import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useReferralOverview, type Masked } from "@/api/referrals";
import { StatCard, StatusChip } from "@/components/kit";
import { DataTable } from "@/components/DataTable";
import { CardSkeleton, ErrorState } from "@/components/states";
import { GrowthPage, Section } from "@/components/growth/GrowthPage";
import { fmtN, fmtPct } from "@/lib/growthFormat";
import { formatDateTime } from "@/lib/format";

const val = (m: Masked) => (m === "<10" ? "<10" : fmtN(m));
const num = (m: Masked) => (m === "<10" ? null : m);
/** A rate is printed only when numerator and denominator are both visible (k >= 10); otherwise it is "<10". */
const rate = (a: Masked, b: Masked) => { const x = num(a); const y = num(b); return x === null || y === null ? "<10" : y === 0 ? "—" : fmtPct((x / y) * 100, 1); };

/** Referral overview (GRW-P2-B3): funnel counts, qualified rate, fraud hold rate, all with k >= 10 masking, the review queue and a lookup by relationship id. No contact data anywhere. */
export default function ReferralsPage() {
  const { t, i18n } = useTranslation(); const q = useReferralOverview(); const nav = useNavigate(); const [id, setId] = useState("");
  return (
    <GrowthPage section="referrals">
      <p className="rounded-xl border bg-card p-3 text-sm" data-testid="referrals-privacy">{t("growth.referrals.privacy")}</p>
      {q.isLoading ? <CardSkeleton rows={3} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : q.data && (() => { const f = q.data.funnel; return (
        <>
          <section aria-label={t("growth.referrals.funnel")} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="referrals-funnel">
            <StatCard label={t("growth.referrals.relationships")} value={val(f.relationships)} />
            <StatCard label={t("growth.referrals.signedUp")} value={val(f.signedUp)} />
            <StatCard label={t("growth.referrals.booked")} value={val(f.booked)} />
            <StatCard label={t("growth.referrals.qualified")} value={val(f.qualified)} tone="ok" />
          </section>
          <section aria-label={t("growth.referrals.rates")} className="grid gap-3 sm:grid-cols-3">
            <StatCard label={t("growth.referrals.qualifiedRate")} value={<span data-testid="rate-qualified">{rate(f.qualified, f.relationships)}</span>} hint={t("growth.referrals.qualifiedRateHint")} />
            <StatCard label={t("growth.referrals.holdRate")} value={<span data-testid="rate-hold">{rate(f.onHold, f.relationships)}</span>} hint={t("growth.referrals.holdRateHint")} tone={num(f.onHold) !== null && (num(f.onHold) ?? 0) > 0 ? "warn" : undefined} />
            <StatCard label={t("growth.referrals.rejected")} value={val(f.rejected)} hint={t("growth.referrals.expiredCount", { count: num(f.expired) ?? 0, masked: f.expired === "<10" ? "<10" : "" })} />
          </section>
          <Section title={t("growth.referrals.queue")} id="rf-queue" hint={t("growth.referrals.queueHint")}>
            <DataTable caption={t("growth.referrals.queue")} rows={q.data.queue} rowKey={(r) => r.id} empty={t("growth.referrals.queueEmpty")} columns={[
              { key: "id", header: t("growth.referrals.colId"), cell: (r) => <Link className="font-mono text-xs text-primary hover:underline" dir="ltr" to={`/growth/referrals/${r.id}`}>{r.id}</Link> },
              { key: "s", header: t("growth.referrals.colStatus"), cell: (r) => <StatusChip tone="warning">{t(`growth.referrals.status.${r.status}`, r.status)}</StatusChip> },
              { key: "c", header: t("growth.referrals.colCreated"), cell: (r) => <span className="text-xs">{formatDateTime(r.createdAt, i18n.language)}</span> },
              { key: "h", header: t("growth.referrals.colHold"), cell: (r) => <span className="text-xs">{r.holdUntil ? formatDateTime(r.holdUntil, i18n.language) : "—"}</span> },
            ]} />
            <p className="mt-2 text-xs text-muted-foreground">{t("growth.referrals.p3d")}</p>
          </Section>
          <Section title={t("growth.referrals.lookup")} id="rf-lookup" hint={t("growth.referrals.lookupHint")}>
            <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (id.trim()) nav(`/growth/referrals/${encodeURIComponent(id.trim())}`); }}>
              <label className="text-sm"><span className="block text-muted-foreground">{t("growth.referrals.colId")}</span><input className="h-11 w-72 max-w-full rounded-xl border bg-card px-3 font-mono text-sm" dir="ltr" value={id} onChange={(e) => setId(e.target.value)} data-testid="referral-lookup" /></label>
              <button type="submit" className="inline-flex h-11 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50" disabled={!id.trim()} data-testid="referral-lookup-go">{t("growth.referrals.open")}</button>
            </form>
            <Link to="/growth/config" className="mt-3 inline-block text-sm font-semibold text-primary hover:underline" data-testid="referral-rules-link">{t("growth.referrals.rulesLink")}</Link>
          </Section>
        </>); })()}
    </GrowthPage>
  );
}
