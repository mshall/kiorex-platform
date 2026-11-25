import { useRef } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Crown, Info } from "lucide-react";
import { ApiError } from "@/api/errors";
import { newRequestKey, useConvertPoints, useLoyaltyHistory, useLoyaltyMe } from "@/api/loyalty";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/kit";
import { CardSkeleton, ErrorState, UnavailableState } from "@/components/states";
import { formatDate, formatMinor } from "@/lib/format";
import PartnerCode from "./PartnerCode";

/**
 * `/loyalty`: my tier, my points, the exchange for a voucher and my recent activity (GRW-P4-D). Points are shown as a count, never as money: there is no cash figure, no top-up, no transfer and no withdrawal on this page.
 * Exchanging uses one key per tap, so a double tap or a retry can never spend twice.
 */
export default function LoyaltyHome() {
  const { t, i18n } = useTranslation(); const lang = i18n.language; const me = useLoyaltyMe(); const hist = useLoyaltyHistory(); const convert = useConvertPoints(); const key = useRef<string | null>(null);
  const off = me.error instanceof ApiError && me.error.isFeatureDisabled; const err = convert.error instanceof ApiError ? convert.error : null;
  const tap = () => { key.current ??= newRequestKey(); convert.mutate(key.current, { onSuccess: () => { key.current = null; } }); };
  const d = me.data;
  return (
    <div className="container max-w-2xl space-y-6 py-8" data-testid="loyalty-page">
      <meta name="robots" content="noindex" />
      <PageHeader title={t("loyalty.title")} hint={t("loyalty.hint")} icon={<Crown />} />
      {me.isLoading ? <CardSkeleton rows={3} /> : off ? <UnavailableState featureKey={(me.error as ApiError).featureKey} awaiting={(me.error as ApiError).isAwaitingApproval} /> : !d ? <ErrorState error={me.error} onRetry={() => void me.refetch()} /> : (
        <>
          <p className="flex items-start gap-2 rounded-xl border bg-card p-3 text-sm" data-testid="loyalty-not-money"><Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{t("loyalty.notMoney")}</p>
          <section className="kx-card space-y-2 p-5" aria-labelledby="loy-tier" data-testid="loyalty-tier">
            <h2 id="loy-tier" className="text-lg">{t("loyalty.tierTitle")}</h2>
            <p className="text-2xl font-semibold" data-testid="loyalty-tier-name">{t(`loyalty.tier.${d.tier}`)}</p>
            {d.tierSince && <p className="text-sm text-muted-foreground">{t("loyalty.since", { date: formatDate(d.tierSince, lang) })}</p>}
            <p className="text-sm" data-testid="loyalty-progress">{t("loyalty.progress", { done: d.window.completed, months: d.window.months })}</p>
            {d.next ? <p className="text-sm text-muted-foreground" data-testid="loyalty-next">{t("loyalty.next", { remaining: d.next.remaining, tier: t(`loyalty.tier.${d.next.tier}`) })}</p> : d.tier !== "NONE" ? <p className="text-sm text-muted-foreground">{t("loyalty.topTier")}</p> : <p className="text-sm text-muted-foreground" data-testid="loyalty-no-tiers">{t("loyalty.noTiers")}</p>}
          </section>
          <section className="kx-card space-y-2 p-5" aria-labelledby="loy-points" data-testid="loyalty-points">
            <h2 id="loy-points" className="text-lg">{t("loyalty.pointsTitle")}</h2>
            <p className="text-2xl font-semibold tabular-nums" data-testid="loyalty-balance">{t("loyalty.points", { count: d.points.balance })}</p>
            {d.points.expiringSoon ? <p className="text-sm text-muted-foreground" data-testid="loyalty-expiring">{t("loyalty.expiring", { points: d.points.expiringSoon.points, date: formatDate(d.points.expiringSoon.at, lang) })}</p> : d.points.balance === 0 ? <p className="text-sm text-muted-foreground">{t("loyalty.noPoints")}</p> : null}
          </section>
          <section className="kx-card space-y-3 p-5" aria-labelledby="loy-convert" data-testid="loyalty-convert">
            <h2 id="loy-convert" className="text-lg">{t("loyalty.convertTitle")}</h2>
            {!d.conversion.open ? <p className="text-sm text-muted-foreground" data-testid="loyalty-convert-closed">{t("loyalty.convertClosed")}</p> : (
              <>
                <p className="text-sm">{t("loyalty.convertText", { points: d.conversion.pointsRequired, value: formatMinor(d.conversion.valueMinor, lang, d.conversion.currency) })}</p>
                <p className="text-xs text-muted-foreground">{t("loyalty.blocksLeft", { count: d.conversion.blocksLeftThisYear })}</p>
                {!d.conversion.canConvert && d.points.balance < d.conversion.pointsRequired && <p className="text-sm text-muted-foreground" data-testid="loyalty-not-enough">{t("loyalty.notEnough", { points: d.conversion.pointsRequired })}</p>}
                <Button className="min-h-11 w-full sm:w-auto" disabled={!d.conversion.canConvert || convert.isPending} onClick={tap} data-testid="loyalty-convert-button">{convert.isPending ? t("loyalty.converting") : t("loyalty.convert", { points: d.conversion.pointsRequired })}</Button>
              </>)}
            {err && <p role="alert" className="rounded-xl border border-danger/40 bg-danger/5 p-3 text-sm" data-testid="loyalty-convert-error">{t(`loyalty.errors.${err.code}`, { defaultValue: t("loyalty.errors.GENERIC") })}</p>}
            {convert.data && <p role="status" className="rounded-xl border border-success/40 bg-success/5 p-3 text-sm" data-testid="loyalty-converted">{t("loyalty.converted", { value: formatMinor(convert.data.amountMinor, lang, convert.data.currency) })} <Link className="font-semibold text-primary underline" to="/referral/rewards">{t("loyalty.openRewards")}</Link></p>}
          </section>
          <PartnerCode />
          <section className="kx-card space-y-2 p-5" aria-labelledby="loy-hist" data-testid="loyalty-history">
            <h2 id="loy-hist" className="text-lg">{t("loyalty.historyTitle")}</h2>
            {hist.isLoading ? <CardSkeleton rows={2} /> : !hist.data?.items.length ? <p className="text-sm text-muted-foreground">{t("loyalty.historyEmpty")}</p> : (
              <ul className="divide-y">{hist.data.items.map((e) => <li key={e.id} className="flex items-center justify-between gap-3 py-2 text-sm"><span>{t(`loyalty.type.${e.type}`)} <span className="text-xs text-muted-foreground">{formatDate(e.at, lang)}</span></span><span className={`tabular-nums font-semibold ${e.direction === "IN" ? "text-success" : ""}`}>{e.direction === "IN" ? "+" : "-"}{e.points}</span></li>)}</ul>)}
          </section>
        </>)}
    </div>
  );
}
