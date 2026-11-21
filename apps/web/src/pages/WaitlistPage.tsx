import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { BellRing, ChevronDown, Clock } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { ApiError } from "@/api/errors";
import { useAcceptOffer, useCancelWaitlist, useDeclineOffer, useWaitlist, type WaitlistEntry, type WaitlistOffer } from "@/api/services";
import { CardSkeleton, EmptyState, ErrorState } from "@/components/states";
import { useCountdown } from "@/hooks/useCountdown";
import { formatCountdown, formatDateTime, formatDate, pick } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader, StatusChip } from "@/components/kit";
import { DoctorAvatar } from "@/components/DoctorAvatar";

function OfferRow({ offer, entryId }: { offer: WaitlistOffer; entryId: string }) {
  const { t, i18n } = useTranslation();
  const nav = useNavigate();
  const accept = useAcceptOffer();
  const decline = useDeclineOffer();
  const cd = useCountdown(offer.status === "OFFERED" ? offer.expiresAt : null);
  const live = offer.status === "OFFERED" && !cd.expired;
  const onAccept = () =>
    accept.mutate(offer.id, {
      onSuccess: (b) => nav(`/checkout/${b.id}`),
      onError: (e) => {
        if (e instanceof ApiError && e.code === "SLOT_TAKEN") toast.error(t("waitlist.errors.taken"));
        else if (e instanceof ApiError && (e.status === 410 || e.code === "OFFER_EXPIRED")) toast.error(t("waitlist.errors.expired"));
        else toast.error(e instanceof ApiError && e.isFeatureDisabled ? t("unavailable.title") : t("waitlist.errors.generic"));
      },
    });
  if (!live) return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-muted/40 px-4 py-2.5 text-sm text-muted-foreground" data-testid="waitlist-offer" data-entry={entryId}>
      <span className="kx-label-num">{formatDateTime(offer.startsAt, i18n.language)}</span>
      <StatusChip tone="neutral">{t(`waitlist.offerStatus.${offer.status === "OFFERED" ? "EXPIRED" : offer.status}`)}</StatusChip>
    </li>
  );
  return (
    <li className="relative overflow-hidden rounded-2xl border border-pulse/60 bg-linear-to-br from-pulse/15 via-card to-card p-4 shadow-card" data-testid="waitlist-offer" data-entry={entryId}>
      <span className="absolute inset-y-0 inset-s-0 w-1 bg-pulse" aria-hidden="true" />
      <div className="flex flex-wrap items-center justify-between gap-3 ps-2">
        <div className="space-y-1">
          <p className="flex items-center gap-2 font-semibold"><BellRing className="h-4 w-4 text-pulse motion-safe:animate-pulse" aria-hidden="true" />{t("waitlist.offerTitle")}</p>
          <p className="text-lg font-semibold" data-testid="offer-slot">{formatDateTime(offer.startsAt, i18n.language)}</p>
          {live && <p className="inline-flex items-center gap-1.5 text-sm text-muted-foreground" aria-live="polite"><Clock className="h-4 w-4" aria-hidden="true" />{t("waitlist.expiresIn")} <b dir="ltr" className="kx-label-num text-foreground">{formatCountdown(cd.remainingMs ?? 0)}</b></p>}
          {offer.status !== "OFFERED" && <StatusChip tone="neutral">{t(`waitlist.offerStatus.${offer.status}`)}</StatusChip>}
          {offer.status === "OFFERED" && cd.expired && <StatusChip tone="neutral">{t("waitlist.offerStatus.EXPIRED")}</StatusChip>}
        </div>
        {live && (
          <div className="flex gap-2">
            <Button onClick={onAccept} disabled={accept.isPending} data-testid="offer-accept">{accept.isPending ? t("states.loading") : t("waitlist.accept")}</Button>
            <Button variant="outline" onClick={() => decline.mutate(offer.id, { onError: () => toast.error(t("waitlist.errors.generic")) })} disabled={decline.isPending} data-testid="offer-decline">{t("waitlist.decline")}</Button>
          </div>
        )}
      </div>
    </li>
  );
}

function EntryCard({ e }: { e: WaitlistEntry }) {
  const { t, i18n } = useTranslation();
  const cancel = useCancelWaitlist();
  const open = ["WAITING", "OFFERED"].includes(e.status);
  const offers = e.offers.filter((o) => o.status === "OFFERED" || e.status === "OFFERED");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 15_000); return () => clearInterval(id); }, []);
  const isLive = (o: WaitlistOffer) => o.status === "OFFERED" && new Date(o.expiresAt).getTime() > now;
  const liveOffers = offers.filter(isLive); const pastOffers = offers.filter((o) => !isLive(o));
  return (
    <li className="kx-card space-y-3 p-5" data-testid="waitlist-entry" data-status={e.status}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <DoctorAvatar name={e.doctor ? pick(e.doctor, "name", i18n.language) : ""} photoUrl={undefined} size="md" />
          <div className="min-w-0 space-y-1">
          <h3 className="text-lg"><Link className="hover:underline" to={`/doctors/${e.providerId}`}>{e.doctor ? pick(e.doctor, "name", i18n.language) : "…"}</Link></h3>
          <p className="text-sm text-muted-foreground">{pick(e, "clinicName", i18n.language)} · {e.preferredTo ? t("waitlist.until", { date: formatDate(e.preferredTo, i18n.language) }) : t("waitlist.windows.any")}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusChip tone={e.status === "OFFERED" ? "warning" : e.status === "BOOKED" ? "success" : open ? "info" : "neutral"}>{t(`waitlist.entryStatus.${e.status}`)}</StatusChip>
          {open && <Button variant="ghost" size="sm" onClick={() => cancel.mutate(e.id, { onSuccess: () => toast.success(t("waitlist.left")), onError: () => toast.error(t("waitlist.errors.generic")) })} disabled={cancel.isPending} data-testid="waitlist-leave">{t("waitlist.leave")}</Button>}
        </div>
      </div>
      {liveOffers.length > 0 && <ul className="space-y-2">{liveOffers.map((o) => <OfferRow key={o.id} offer={o} entryId={e.id} />)}</ul>}
      {pastOffers.length > 0 && <details className="group rounded-xl border bg-card"><summary className="flex min-h-11 cursor-pointer items-center justify-between px-4 text-sm font-medium text-muted-foreground">{t("p3.earlierOffers", { count: pastOffers.length })}<ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" aria-hidden="true" /></summary><ul className="space-y-2 p-3 pt-0">{pastOffers.map((o) => <OfferRow key={o.id} offer={o} entryId={e.id} />)}</ul></details>}
      {e.status === "WAITING" && <p className="text-sm text-muted-foreground">{t("waitlist.waitingHint")}</p>}
    </li>
  );
}

export default function WaitlistPage() {
  const { t } = useTranslation();
  const q = useWaitlist();
  const items = q.data ?? [];
  const offered = items.filter((e) => e.status === "OFFERED");
  const rest = items.filter((e) => e.status !== "OFFERED");
  return (
    <div className="space-y-6">
      <PageHeader icon={<BellRing />} title={t("waitlist.title")} hint={t("waitlist.intro")} />
      {q.isLoading ? <CardSkeleton rows={2} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : items.length === 0 ? (
        <EmptyState icon={<BellRing className="h-10 w-10" aria-hidden="true" />} title={t("waitlist.empty")} hint={t("waitlist.emptyHint")} action={<Link to="/search" className={cn(buttonVariants())}>{t("home.findDoctor")}</Link>} />
      ) : (
        <>
          {offered.length > 0 && <section aria-labelledby="offers-h" className="space-y-3"><h2 id="offers-h" className="text-xl">{t("waitlist.offers")}</h2><ul className="space-y-3" data-testid="offers-inbox">{offered.map((e) => <EntryCard key={e.id} e={e} />)}</ul></section>}
          {rest.length > 0 && <section aria-labelledby="entries-h" className="space-y-3"><h2 id="entries-h" className="text-xl">{t("waitlist.entries")}</h2><ul className="space-y-3">{rest.map((e) => <EntryCard key={e.id} e={e} />)}</ul></section>}
        </>
      )}
    </div>
  );
}
