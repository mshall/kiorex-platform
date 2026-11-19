import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { BellRing, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { useDoctor } from "@/api/hooks";
import { ApiError } from "@/api/errors";
import { useAcceptOffer, useCancelWaitlist, useDeclineOffer, useWaitlist, type WaitlistEntry, type WaitlistOffer } from "@/api/services";
import { CardSkeleton, EmptyState, ErrorState } from "@/components/states";
import { useCountdown } from "@/hooks/useCountdown";
import { formatCountdown, formatDateTime, formatDate, pick } from "@/lib/format";
import { cn } from "@/lib/utils";

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
  return (
    <li className="rounded-xl border border-pulse/50 bg-pulse/10 p-4" data-testid="waitlist-offer" data-entry={entryId}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <p className="font-semibold">{t("waitlist.offerTitle")}</p>
          <p className="text-sm" data-testid="offer-slot">{formatDateTime(offer.startsAt, i18n.language)}</p>
          {live && <p className="inline-flex items-center gap-1 text-sm text-muted-foreground" aria-live="polite"><Clock className="h-4 w-4" aria-hidden="true" />{t("waitlist.expiresIn")} <b dir="ltr" className="kx-label-num">{formatCountdown(cd.remainingMs ?? 0)}</b></p>}
          {offer.status !== "OFFERED" && <Badge variant="secondary">{t(`waitlist.offerStatus.${offer.status}`)}</Badge>}
          {offer.status === "OFFERED" && cd.expired && <Badge variant="secondary">{t("waitlist.offerStatus.EXPIRED")}</Badge>}
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
  const doctor = useDoctor(e.providerId);
  const cancel = useCancelWaitlist();
  const vt = doctor.data?.visitTypes.find((v) => v.id === e.typeId);
  const open = ["WAITING", "OFFERED"].includes(e.status);
  const offers = e.offers.filter((o) => o.status === "OFFERED" || e.status === "OFFERED");
  return (
    <li className="kx-card space-y-3 p-5" data-testid="waitlist-entry" data-status={e.status}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 className="text-lg"><Link className="hover:underline" to={`/doctors/${e.providerId}`}>{doctor.data ? pick(doctor.data.summary, "name", i18n.language) : "…"}</Link></h3>
          <p className="text-sm text-muted-foreground">{vt ? pick(vt, "name", i18n.language) : ""} · {e.preferredTo ? t("waitlist.until", { date: formatDate(e.preferredTo, i18n.language) }) : t("waitlist.windows.any")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={e.status === "OFFERED" ? "pulse" : e.status === "BOOKED" ? "success" : open ? "info" : "secondary"}>{t(`waitlist.entryStatus.${e.status}`)}</Badge>
          {open && <Button variant="ghost" size="sm" onClick={() => cancel.mutate(e.id, { onSuccess: () => toast.success(t("waitlist.left")), onError: () => toast.error(t("waitlist.errors.generic")) })} disabled={cancel.isPending} data-testid="waitlist-leave">{t("waitlist.leave")}</Button>}
        </div>
      </div>
      {offers.length > 0 && <ul className="space-y-2">{offers.map((o) => <OfferRow key={o.id} offer={o} entryId={e.id} />)}</ul>}
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
      <div className="flex flex-wrap items-center gap-3"><BellRing className="h-7 w-7 text-ocean" aria-hidden="true" /><h1 className="text-2xl">{t("waitlist.title")}</h1></div>
      <p className="max-w-2xl text-muted-foreground">{t("waitlist.intro")}</p>
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
