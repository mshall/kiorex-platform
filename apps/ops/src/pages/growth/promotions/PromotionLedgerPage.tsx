import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useSponsoredLedger } from "@/api/sponsoredPromotions";
import { StatCard, StatusChip } from "@/components/kit";
import { DataTable } from "@/components/DataTable";
import { CardSkeleton, ErrorState } from "@/components/states";
import { GrowthPage, Section } from "@/components/growth/GrowthPage";
import { fmtN } from "@/lib/growthFormat";
import { formatDateTime } from "@/lib/format";

/** The distinct `provider-sponsored discount` line per booking (GRW-P2-S): opaque booking ids, signed amounts, state; totals by state. Never a patient. */
export default function PromotionLedgerPage() {
  const { id = "" } = useParams(); const { t, i18n } = useTranslation(); const q = useSponsoredLedger(id);
  return (
    <GrowthPage section="sponsored-promotions">
      <Link to={`/growth/sponsored-promotions/${encodeURIComponent(id)}`} className="text-sm font-semibold text-primary hover:underline">{t("growth.sponsored.back")}</Link>
      {q.isLoading ? <CardSkeleton rows={3} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : q.data && (
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label={t("growth.sponsored.byState")} data-testid="sponsored-bystate">
            {q.data.byState.map((s) => <StatCard key={s.state} label={t(`growth.sponsored.lineState.${s.state}`, s.state)} value={<span className="tabular-nums">{fmtN(Math.round(s.amountMinor / 100))}</span>} hint={t("growth.sponsored.bookings", { count: s.count })} />)}
          </section>
          <Section title={t("growth.sponsored.ledgerTitle")} id="sp-ledger" hint={t("growth.sponsored.ledgerHint")}>
            <DataTable caption={t("growth.sponsored.ledgerTitle")} rows={q.data.lines} rowKey={(r) => r.id} empty={t("growth.sponsored.ledgerEmpty")} columns={[
              { key: "b", header: t("growth.sponsored.colBooking"), cell: (r) => <code className="text-xs" dir="ltr">{r.bookingIntentId}</code> },
              { key: "l", header: t("growth.sponsored.colLine"), cell: () => <span>{t("growth.sponsored.lineName")}</span> },
              { key: "a", header: t("growth.sponsored.colAmount"), cell: (r) => <span className="tabular-nums" dir="ltr">{fmtN(Math.round(r.signedAmountMinor / 100))} {r.currency}</span> },
              { key: "s", header: t("growth.sponsored.colStatus"), cell: (r) => <StatusChip tone={r.state === "DEBITED" ? "success" : r.state === "REVERSED" || r.state === "RELEASED" ? "neutral" : "info"}>{t(`growth.sponsored.lineState.${r.state}`, r.state)}</StatusChip> },
              { key: "d", header: t("growth.sponsored.colUpdated"), cell: (r) => <span className="text-xs">{formatDateTime(r.updatedAt ?? r.createdAt, i18n.language)}</span> },
            ]} />
          </Section>
        </>
      )}
    </GrowthPage>
  );
}
