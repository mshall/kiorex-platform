import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AlarmClock, CreditCard, UserRound } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useBooking, useConfirmBooking, useVisitType } from "@/api/hooks";
import { ApiError } from "@/api/errors";
import type { Slot } from "@/api/types";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { SlotTakenDialog } from "@/components/SlotTakenDialog";
import { useCountdown } from "@/hooks/useCountdown";
import { altSlots, useStartBooking } from "@/hooks/useStartBooking";
import { usePatient } from "@/hooks/usePatient";
import { useFeature } from "@/hooks/useFeature";
import { formatCountdown, formatDayLong, formatMoney, formatTime, pick } from "@/lib/format";
import { track } from "@/lib/analytics";
import { cn } from "@/lib/utils";
import { HomeFee, VisitAddressView } from "@/components/HomeVisitBits";
import { PageHeader, Stepper } from "@/components/kit";

export default function CheckoutPage() {
  const { bookingId = "" } = useParams();
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const nav = useNavigate();
  const booking = useBooking(bookingId);
  const confirm = useConfirmBooking();
  const { nameOf } = usePatient();
  const restart = useStartBooking();
  const deposits = useFeature("kiorex.pay_deposits");
  const [consentData, setConsentData] = useState(false);
  const [consentReminders, setConsentReminders] = useState(true);
  const [alternatives, setAlternatives] = useState<Slot[] | null>(null);
  const b = booking.data;
  const vt = useVisitType(b);
  const { remainingMs, expired } = useCountdown(b?.status === "HELD" ? b.holdExpiresAt : null);

  // Revisiting a booking that already progressed goes to its appointment page.
  useEffect(() => { if (b && b.status !== "HELD" && b.status !== "EXPIRED") nav(`/appointments/${b.id}`, { replace: true }); }, [b, nav]);

  if (booking.isLoading) return <LoadingState />;
  if (booking.error) return <ErrorState error={booking.error} onRetry={() => void booking.refetch()} />;
  if (!b) return null;

  const isExpired = b.status === "EXPIRED" || expired;
  if (isExpired) {
    return (
      <div className="mx-auto max-w-xl"><EmptyState icon={<AlarmClock className="h-10 w-10" aria-hidden="true" />} title={t("checkout.expiredTitle")} hint={t("checkout.expiredBody")}
        action={<Link to={`/doctors/${b.doctor.id}`} className={cn(buttonVariants())} data-testid="pick-another">{t("checkout.pickAnother")}</Link>} /></div>
    );
  }

  const hasDeposit = b.deposit.status === "REQUIRED";
  const lowTime = remainingMs != null && remainingMs < 60_000;
  const canConfirm = consentData && !confirm.isPending;

  const onConfirm = () =>
    confirm.mutate({ bookingId: b.id, marketplaceConsent: consentData, remindersConsent: consentReminders }, {
      onSuccess: (res) => { nav(`/appointments/${res.id}`, { replace: true, state: { justBooked: true } }); },
      onError: async (e) => {
        if (e instanceof ApiError) {
          track("booking_failed", { code: e.code, providerId: b.doctor.id });
          if (e.code === "SLOT_TAKEN" || e.code === "BOOKING_REJECTED" || e.code === "HOLD_EXPIRED") {
            const alts = altSlots(e.details?.alternatives, b.visitType.id);
            if (e.code === "HOLD_EXPIRED") void booking.refetch();
            if (e.code !== "HOLD_EXPIRED" || alts.length) setAlternatives(alts);
            return;
          }
          toast.error(t("checkout.confirmFailed")); return;
        }
        // Network error / timeout (KXMBK05): look the booking up before any retry. The booking id is the idempotency key, so a retry cannot double-book.
        const fresh = await booking.refetch();
        if (fresh.data && (fresh.data.status === "CONFIRMED" || fresh.data.status === "PENDING_CLINIC")) nav(`/appointments/${b.id}`, { replace: true });
        else toast.error(t("checkout.timeout"));
      },
    });

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Stepper steps={[t("flow.choose"), t("flow.confirm"), t("flow.done")]} current={1} label={t("flow.label")} />
      <PageHeader title={t("checkout.title")} />
      <div role="timer" aria-live="off" data-testid="hold-countdown" className={cn("flex items-center justify-between rounded-xl border p-4", lowTime ? "border-warning bg-warning-soft" : "bg-card")}>
        <span className="flex items-center gap-2 text-sm font-medium"><AlarmClock className="h-5 w-5 text-pulse" aria-hidden="true" />{t("checkout.holdLabel")}</span>
        <span className="text-2xl font-semibold kx-label-num" dir="ltr" aria-label={t("checkout.holdRemaining", { time: formatCountdown(remainingMs ?? 0) })}>{formatCountdown(remainingMs ?? 0)}</span>
      </div>

      <section className="kx-card space-y-3 p-5" aria-label={t("checkout.summary")}>
        <p className="text-lg font-semibold">{pick(b.doctor, "name", lang)}</p>
        {b.home ? <p className="text-sm text-muted-foreground" data-testid="checkout-home">{t("hv.homeVisitAt")}</p> : <p className="text-sm text-muted-foreground">{pick(b.clinic, "name", lang)} · {pick(b.clinic, "address", lang)}</p>}
        <p>{formatDayLong(b.startsAt, lang)} · <b dir="ltr">{formatTime(b.startsAt, lang)}</b></p>
        <p className="flex items-center gap-2 text-sm"><UserRound className="h-4 w-4 text-ocean" aria-hidden="true" />{t("checkout.patient")}: <b data-testid="checkout-patient">{nameOf(b.patient.id)}</b></p>
        {b.home ? <><p className="border-t pt-3 text-sm">{vt ? pick(vt, "name", lang) : "…"}</p><HomeFee home={b.home} /></> : (
          <div className="flex items-center justify-between border-t pt-3"><span>{vt ? pick(vt, "name", lang) : "…"}</span><b className="kx-label-num">{vt ? formatMoney(vt.feeEgp, lang) : ""}</b></div>
        )}
      </section>
      {b.home && <VisitAddressView home={b.home} />}

      {hasDeposit && (
        <section className="kx-card space-y-2 border-warning/50 p-5" aria-labelledby="dep-title" data-testid="deposit-panel">
          <h2 id="dep-title" className="flex items-center gap-2 text-lg"><CreditCard className="h-5 w-5 text-ocean" aria-hidden="true" />{t("checkout.depositTitle")}</h2>
          <p className="text-sm text-muted-foreground">{t("checkout.depositBody", { amount: formatMoney(b.deposit.requiredEgp, lang) })}</p>
          <p className="text-sm font-medium">{t("checkout.depositAfter")}</p>
          {!deposits.enabled && <p className="text-sm text-warning">{t("unavailable.body")}</p>}
        </section>
      )}

      <section className="kx-card space-y-1 p-5" aria-labelledby="consent-title">
        <h2 id="consent-title" className="mb-2 text-lg">{t("checkout.consents")}</h2>
        <label className="flex min-h-11 items-start gap-3 py-1">
          <Checkbox checked={consentData} onCheckedChange={(c) => setConsentData(c === true)} data-testid="consent-data" className="mt-0.5" />
          <span className="text-sm">{t("checkout.consentData")}</span>
        </label>
        <label className="flex min-h-11 items-start gap-3 py-1">
          <Checkbox checked={consentReminders} onCheckedChange={(c) => setConsentReminders(c === true)} data-testid="consent-reminders" className="mt-0.5" />
          <span className="text-sm">{t("checkout.consentReminders")}</span>
        </label>
      </section>

      <Button size="lg" className="w-full" disabled={!canConfirm} onClick={onConfirm} data-testid="confirm-booking">
        {confirm.isPending ? t("states.loading") : t("checkout.confirm")}
      </Button>
      {!consentData && <p className="text-center text-xs text-muted-foreground">{t("checkout.consentRequired")}</p>}

      <SlotTakenDialog alternatives={alternatives} onClose={() => setAlternatives(null)} onPick={(s) => { setAlternatives(null); restart.start(b.doctor.id, s); }} />
    </div>
  );
}
