import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ApiError } from "@/api/errors";
import { useGrowthAccess } from "@/api/growth";
import { useLotLedger, useRewardActions, useRewardLots } from "@/api/referrals";
import { StatusChip } from "@/components/kit";
import { DataTable } from "@/components/DataTable";
import { CardSkeleton, ErrorState } from "@/components/states";
import { GrowthPage, Section } from "@/components/growth/GrowthPage";
import { formatDateTime, formatMinor } from "@/lib/format";

/** One lot: its append-only ledger and the hold or release controls (a held lot cannot be reserved). No entry can be edited or deleted: the database refuses it. */
export default function RewardLotPage() {
  const { id = "" } = useParams(); const { t, i18n } = useTranslation(); const lang = i18n.language; const access = useGrowthAccess().data?.capabilities; const act = useRewardActions();
  const ledger = useLotLedger(id); const lots = useRewardLots({}); const lot = lots.data?.find((l) => l.id === id);
  const fail = (e: unknown) => toast.error(e instanceof ApiError ? t(`growth.rewards.err.${e.code}`, { defaultValue: e.message }) : t("states.errorTitle"));
  return (
    <GrowthPage section="rewards">
      <Link to="/growth/rewards" className="text-sm font-semibold text-primary hover:underline">{t("growth.rewards.back")}</Link>
      {lot && <Section title={t("growth.rewards.lot")} id="lot-facts">
        <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-3" data-testid="lot-facts">
          <div><dt className="text-muted-foreground">{t("growth.referrals.colId")}</dt><dd className="font-mono text-xs" dir="ltr">{lot.id}</dd></div>
          <div><dt className="text-muted-foreground">{t("growth.rewards.patient")}</dt><dd><code className="text-xs" dir="ltr">{lot.patientRef}</code></dd></div>
          <div><dt className="text-muted-foreground">{t("growth.rewards.status")}</dt><dd><StatusChip tone={lot.status === "ACTIVE" ? "success" : lot.status === "HELD" ? "warning" : "neutral"}>{t(`growth.rewards.lotStatus.${lot.status}`, lot.status)}</StatusChip></dd></div>
          <div><dt className="text-muted-foreground">{t("growth.rewards.amount")}</dt><dd>{formatMinor(lot.amountMinor, lang, lot.currency)}</dd></div>
          <div><dt className="text-muted-foreground">{t("growth.rewards.available")}</dt><dd>{formatMinor(lot.availableMinor, lang, lot.currency)} · {t("growth.rewards.held")} {formatMinor(lot.heldMinor, lang, lot.currency)} · {t("growth.rewards.reserved")} {formatMinor(lot.reservedMinor, lang, lot.currency)}</dd></div>
          <div><dt className="text-muted-foreground">{t("growth.rewards.expires")}</dt><dd>{formatDateTime(lot.expiresAt, lang)}</dd></div>
        </dl>
        {access?.manage && <div className="mt-3 flex gap-2">
          <button type="button" className="inline-flex h-11 items-center rounded-xl border px-4 text-sm font-semibold hover:bg-accent disabled:opacity-50" disabled={act.hold.isPending || lot.availableMinor <= 0} onClick={() => act.hold.mutate({ id }, { onSuccess: () => toast.success(t("growth.rewards.holdDone")), onError: fail })} data-testid="lot-hold">{t("growth.rewards.hold")}</button>
          <button type="button" className="inline-flex h-11 items-center rounded-xl border px-4 text-sm font-semibold hover:bg-accent disabled:opacity-50" disabled={act.release.isPending || lot.heldMinor <= 0} onClick={() => act.release.mutate(id, { onSuccess: () => toast.success(t("growth.rewards.releaseDone")), onError: fail })} data-testid="lot-release">{t("growth.rewards.release")}</button></div>}
      </Section>}
      <Section title={t("growth.rewards.ledger")} id="lot-ledger" hint={t("growth.rewards.ledgerHint")}>
        {ledger.isLoading ? <CardSkeleton rows={3} /> : ledger.error ? <ErrorState error={ledger.error} onRetry={() => void ledger.refetch()} /> : (
          <DataTable caption={t("growth.rewards.ledger")} rows={ledger.data ?? []} rowKey={(r) => r.id} empty={t("growth.rewards.noEntries")} columns={[
            { key: "t", header: t("growth.rewards.entryType"), cell: (r) => <StatusChip tone={r.type === "ISSUE" ? "success" : r.type === "REVERSE" ? "danger" : "info"}>{r.type}</StatusChip> },
            { key: "a", header: t("growth.rewards.amount"), cell: (r) => formatMinor(r.amountMinor, lang) }, { key: "rc", header: t("growth.rewards.reasonCode"), cell: (r) => <code className="text-xs">{r.reasonCode}</code> },
            { key: "b", header: t("growth.rewards.booking"), cell: (r) => <code className="text-xs" dir="ltr">{r.bookingId ?? "—"}</code> }, { key: "ac", header: t("growth.rewards.actor"), cell: (r) => <code className="text-xs" dir="ltr">{r.actor}</code> },
            { key: "d", header: t("growth.referrals.colCreated"), cell: (r) => <span className="text-xs">{formatDateTime(r.createdAt, lang)}</span> },
          ]} />)}
      </Section>
    </GrowthPage>
  );
}
