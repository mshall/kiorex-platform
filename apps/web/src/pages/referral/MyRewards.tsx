import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Ticket, Wallet } from "lucide-react";
import { ApiError } from "@/api/errors";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useReferralRewards, useRevealCoupon, type RewardLine, type RewardStatus } from "@/api/referral";
import { CardSkeleton, EmptyState, ErrorState, UnavailableState } from "@/components/states";
import { PageHeader, StatusChip, type Tone } from "@/components/kit";
import { formatDate, formatMinor } from "@/lib/format";

const TONE: Record<RewardStatus, Tone> = { ACTIVE: "success", HELD: "warning", EXHAUSTED: "neutral", EXPIRED: "neutral", REVERSED: "danger" };

function Line({ r, lang }: { r: RewardLine; lang: string }) {
  const { t } = useTranslation(); const reveal = useRevealCoupon(); const [code, setCode] = useState<string | null>(null);
  const show = () => reveal.mutate(r.id, { onSuccess: (x) => setCode(x.code), onError: () => toast.error(t("referral.revealFailed")) });
  const left = r.remainingMinor ?? r.amountMinor;
  return (
    <li className="kx-card flex flex-wrap items-center justify-between gap-3 p-4" data-testid={`reward-${r.id}`} data-status={r.status}>
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent text-primary" aria-hidden="true">{r.mode === "COUPON" ? <Ticket className="h-5 w-5" /> : <Wallet className="h-5 w-5" />}</span>
        <div className="min-w-0"><p className="font-semibold">{t(`referral.kind.${r.kind}`, r.kind)} · {t(r.mode === "COUPON" ? "referral.voucher" : "referral.credit")}</p>
          <p className="text-sm text-muted-foreground">{r.status === "ACTIVE" ? t("referral.expiresOn", { date: formatDate(r.expiresAt, lang) }) : t("referral.endedOn", { date: formatDate(r.expiresAt, lang) })}</p></div>
      </div>
      <div className="text-end"><p className="kx-label-num text-lg font-semibold">{formatMinor(r.status === "ACTIVE" ? left : r.amountMinor, lang, r.currency)}</p><StatusChip tone={TONE[r.status]}>{t(`referral.status.${r.status}`)}</StatusChip></div>
      {r.mode === "COUPON" && r.status === "ACTIVE" && (code ? <div className="basis-full rounded-xl bg-muted p-3 text-center" role="status" data-testid={`coupon-${r.id}`}><p className="kx-label-num text-xl font-semibold tracking-widest"><bdi dir="ltr">{code}</bdi></p><p className="mt-1 text-xs text-muted-foreground">{t("referral.codeOnce")}</p></div>
        : r.couponState === "UNREVEALED" ? <div className="basis-full"><Button variant="outline" size="sm" onClick={show} disabled={reveal.isPending} data-testid={`reveal-${r.id}`}>{t("referral.reveal")}</Button><p className="mt-1 text-xs text-muted-foreground">{t("referral.revealHint")}</p></div>
        : r.couponState === "REVEALED" ? <p className="basis-full text-xs text-muted-foreground" data-testid={`revealed-${r.id}`}>{t("referral.alreadyShown")}</p> : null)}
    </li>
  );
}

/** `/referral/rewards`: voucher and credit lines with expiry and history. A reward is only usable on a Kiorex booking; it is never money you can withdraw or send. */
export default function MyRewards() {
  const { t, i18n } = useTranslation(); const lang = i18n.language; const q = useReferralRewards();
  const off = q.error instanceof ApiError && q.error.isFeatureDisabled;
  const items = q.data?.items ?? []; const active = items.filter((r) => r.status === "ACTIVE" || r.status === "HELD"); const past = items.filter((r) => !(r.status === "ACTIVE" || r.status === "HELD"));
  return (
    <div className="container max-w-3xl space-y-6 py-8" data-testid="rewards-page">
      <meta name="robots" content="noindex" />
      <PageHeader title={t("referral.rewardsTitle")} hint={t("referral.rewardsHint")} icon={<Wallet />} actions={<Link to="/referral" className="text-sm font-semibold text-primary hover:underline">{t("referral.back")}</Link>} />
      {q.isLoading ? <CardSkeleton rows={3} /> : off ? <UnavailableState featureKey={(q.error as ApiError).featureKey} awaiting={(q.error as ApiError).isAwaitingApproval} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : items.length === 0 ? <EmptyState title={t("referral.noRewardsTitle")} hint={t("referral.noRewardsHint")} icon={<Ticket />} /> : (
        <>
          <section aria-labelledby="rw-active"><h2 id="rw-active" className="mb-2 text-lg">{t("referral.activeRewards")}</h2>{active.length ? <ul className="space-y-3" data-testid="rewards-active">{active.map((r) => <Line key={r.id} r={r} lang={lang} />)}</ul> : <p className="text-sm text-muted-foreground">{t("referral.noActive")}</p>}</section>
          {past.length > 0 && <section aria-labelledby="rw-history"><h2 id="rw-history" className="mb-2 text-lg">{t("referral.history")}</h2><ul className="space-y-3" data-testid="rewards-history">{past.map((r) => <Line key={r.id} r={r} lang={lang} />)}</ul></section>}
          <p className="text-sm text-muted-foreground" data-testid="rewards-rule">{t("referral.rewardRule")}</p>
          <details className="rounded-xl border bg-card p-4 text-sm" data-needs-human="true"><summary className="cursor-pointer font-semibold">{t("referral.terms")}</summary><p className="mt-2 text-muted-foreground">{t("referral.termsPlaceholder")}</p></details>
        </>)}
    </div>
  );
}
