import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Download } from "lucide-react";
import { ApiError } from "@/api/errors";
import { downloadFinanceCsv, useRewardFinance } from "@/api/referrals";
import { StatCard } from "@/components/kit";
import { DataTable } from "@/components/DataTable";
import { CardSkeleton, ErrorState } from "@/components/states";
import { GrowthPage, Section } from "@/components/growth/GrowthPage";
import { formatMinor } from "@/lib/format";

/** Finance report (GRW-P2-B3): issued, redeemed, reversed, expired and outstanding for a month, the patient's own refund credit apart from platform-funded lots, and the statement that Kiorex revenue is not affected. Finance and super admin only. */
export default function RewardsFinancePage() {
  const { t, i18n } = useTranslation(); const lang = i18n.language; const [month, setMonth] = useState(new Date().toISOString().slice(0, 7)); const q = useRewardFinance(month); const m = (n: number, c = "EGP") => formatMinor(n, lang, c);
  const forbidden = q.error instanceof ApiError && q.error.status === 403 && !q.error.isFeatureDisabled;
  const csv = async () => { try { const text = await downloadFinanceCsv(month); const url = URL.createObjectURL(new Blob([text], { type: "text/csv" })); const a = document.createElement("a"); a.href = url; a.download = `rewards-finance-${month}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); } catch { toast.error(t("states.errorTitle")); } };
  return (
    <GrowthPage section="rewards" toolbar={<label className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">{t("growth.rewards.month")}</span><input type="month" className="h-11 rounded-xl border border-input bg-card px-3 text-sm" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} data-testid="finance-month" /></label>}
      actions={<button type="button" className="inline-flex h-11 items-center gap-2 rounded-xl border px-4 text-sm font-semibold hover:bg-accent disabled:opacity-50" onClick={() => void csv()} disabled={!q.data} data-testid="finance-csv"><Download className="h-4 w-4" aria-hidden="true" />{t("growth.rewards.exportCsv")}</button>}>
      <Link to="/growth/rewards" className="text-sm font-semibold text-primary hover:underline">{t("growth.rewards.back")}</Link>
      {q.isLoading ? <CardSkeleton rows={3} /> : forbidden ? <p className="kx-card p-4 text-sm" role="status" data-testid="finance-forbidden">{t("growth.rewards.financeOnly")}</p> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : q.data && (
        <>
          <section aria-label={t("growth.rewards.totals")} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="finance-totals">
            <StatCard label={t("growth.rewards.issued")} value={m(q.data.totals.issuedMinor)} /><StatCard label={t("growth.rewards.redeemed")} value={m(q.data.totals.redeemedMinor)} /><StatCard label={t("growth.rewards.reversed")} value={m(q.data.totals.reversedMinor)} /><StatCard label={t("growth.rewards.expired")} value={m(q.data.totals.expiredMinor)} />
          </section>
          <Section title={t("growth.rewards.outstanding")} id="fin-out" hint={t("growth.rewards.outstandingHint")}>
            <DataTable caption={t("growth.rewards.outstanding")} rows={q.data.outstanding} rowKey={(r) => `${r.market}/${r.currency}`} empty={t("growth.rewards.nothingOutstanding")} columns={[
              { key: "m", header: t("growth.common.market"), cell: (r) => `${r.market} · ${r.currency}` }, { key: "p", header: t("growth.rewards.platformFunded"), cell: (r) => m(r.platformFundedMinor, r.currency) },
              { key: "s", header: t("growth.rewards.serviceRecovery"), cell: (r) => m(r.serviceRecoveryMinor, r.currency) }, { key: "r", header: t("growth.rewards.refundCredit"), cell: (r) => <span data-testid="refund-credit-liability">{m(r.refundCreditLiabilityMinor, r.currency)}</span> },
              { key: "t", header: t("growth.rewards.total"), cell: (r) => <b>{m(r.totalMinor, r.currency)}</b> },
            ]} />
          </Section>
          <Section title={t("growth.rewards.byKind")} id="fin-rows">
            <DataTable caption={t("growth.rewards.byKind")} rows={q.data.rows} rowKey={(r) => `${r.market}-${r.kind}-${r.funding}-${r.ruleVersionId}-${r.campaignId ?? ""}`} empty={t("growth.rewards.noMovements")} columns={[
              { key: "k", header: t("growth.rewards.kind"), cell: (r) => r.kind }, { key: "f", header: t("growth.rewards.funding"), cell: (r) => t(`growth.rewards.fundingKinds.${r.funding}`, r.funding) }, { key: "i", header: t("growth.rewards.issued"), cell: (r) => m(r.issuedMinor, r.currency) },
              { key: "r", header: t("growth.rewards.redeemed"), cell: (r) => m(r.redeemedMinor, r.currency) }, { key: "v", header: t("growth.rewards.reversed"), cell: (r) => m(r.reversedMinor, r.currency) }, { key: "e", header: t("growth.rewards.expired"), cell: (r) => m(r.expiredMinor, r.currency) },
            ]} />
          </Section>
          <p className="rounded-xl border bg-card p-3 text-sm" data-testid="finance-note">{t("growth.rewards.revenueEffect", { amount: m(q.data.kiorexRevenueEffectMinor) })} {t("growth.rewards.recoverableLoss", { amount: m(q.data.recoverableLossMinor) })} {t("growth.rewards.needsHuman")}</p>
        </>)}
    </GrowthPage>
  );
}
