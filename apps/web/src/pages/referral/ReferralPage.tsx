import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ChevronRight, Gift, WifiOff } from "lucide-react";
import { ApiError } from "@/api/errors";
import { cachedReferralMe, useReferralMe, type ReferralMe } from "@/api/referral";
import { CardSkeleton, EmptyState, ErrorState, UnavailableState } from "@/components/states";
import { PageHeader, StatCard } from "@/components/kit";
import { InviteShare } from "@/components/referral/InviteShare";
import { useOnline } from "@/hooks/useOnline";
import { formatMinor, formatNumber } from "@/lib/format";

const n = (v: number | undefined, lang: string) => formatNumber(v ?? 0, lang, 0);

/** `/referral`: the patient's invite screen (GRW-P2-B3). Counts only: "friends invited, joined, completed first visit"; nothing about who. */
export default function ReferralPage() {
  const { t, i18n } = useTranslation(); const lang = i18n.language; const online = useOnline(); const q = useReferralMe();
  const off = q.error instanceof ApiError && q.error.isFeatureDisabled;
  const cached = !q.data && q.error && !off ? cachedReferralMe() : undefined;
  const me: ReferralMe | undefined = q.data ?? cached;
  return (
    <div className="container max-w-3xl space-y-6 py-8" data-testid="referral-page">
      <meta name="robots" content="noindex" />
      <PageHeader title={t("referral.title")} hint={t("referral.hint")} icon={<Gift />} />
      {q.isLoading ? <CardSkeleton rows={3} /> : off ? <UnavailableState featureKey={(q.error as ApiError).featureKey} awaiting={(q.error as ApiError).isAwaitingApproval} /> : !me ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : (
        <>
          {cached && <p role="status" className="flex items-center gap-2 rounded-xl border bg-card p-3 text-sm" data-testid="referral-cached"><WifiOff className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />{online ? t("referral.cachedOnline") : t("referral.cachedOffline")}</p>}
          <InviteShare me={me} offline={!!cached} />
          <section aria-label={t("referral.progress")} className="grid gap-3 sm:grid-cols-3" data-testid="referral-counts">
            <StatCard label={t("referral.invited")} value={n(me.counts.invited, lang)} />
            <StatCard label={t("referral.joined")} value={n(me.counts.signedUp, lang)} />
            <StatCard label={t("referral.completed")} value={n(me.counts.qualified, lang)} tone="ok" />
          </section>
          {(me.counts.invited ?? 0) === 0 && <EmptyState title={t("referral.emptyTitle")} hint={t("referral.emptyHint")} icon={<Gift />} />}
          {me.capsRemaining?.thisYear !== undefined && <p className="text-sm text-muted-foreground" data-testid="referral-caps">{t("referral.capsLeft", { count: me.capsRemaining.thisYear })}</p>}
          <Link to="/referral/rewards" className="kx-card flex min-h-14 items-center justify-between gap-3 p-4 hover:bg-accent" data-testid="referral-rewards-link">
            <span><span className="block font-semibold">{t("referral.rewardsTitle")}</span><span className="block text-sm text-muted-foreground">{me.rewards?.activeCount ? t("referral.rewardsSummary", { count: me.rewards.activeCount, amount: formatMinor(me.rewards.activeMinor ?? 0, lang, me.rewards.currency ?? "EGP") }) : me.rewards ? t("referral.rewardsNone") : t("referral.rewardsHint")}</span></span>
            <ChevronRight className="h-5 w-5 shrink-0 rtl:rotate-180" aria-hidden="true" />
          </Link>
          <details className="rounded-xl border bg-card p-4 text-sm" data-testid="referral-terms" data-needs-human="true"><summary className="cursor-pointer font-semibold">{t("referral.terms")}</summary><p className="mt-2 text-muted-foreground">{t("referral.termsPlaceholder")}</p></details>
        </>)}
    </div>
  );
}
