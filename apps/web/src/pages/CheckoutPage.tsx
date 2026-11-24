import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AlarmClock, CalendarClock, CreditCard, Lock, MapPin, ShieldCheck, UserRound } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useBooking, useConfirmBooking, useDepositCheckout, useVisitType } from "@/api/hooks";
import { withSandboxReturn } from "@/lib/sandboxPay";
import { ApiError } from "@/api/errors";
import type { Slot } from "@/api/types";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { SlotTakenDialog } from "@/components/SlotTakenDialog";
import { useCountdown } from "@/hooks/useCountdown";
import { altSlots, useStartBooking } from "@/hooks/useStartBooking";
import { usePatient } from "@/hooks/usePatient";
import { useFeature } from "@/hooks/useFeature";
import { formatDayLong, formatMoney, formatTime, pick } from "@/lib/format";
import { track } from "@/lib/analytics";
import { cn } from "@/lib/utils";
import { HomeFee, VisitAddressView } from "@/components/HomeVisitBits";
import { PageHeader, Stepper } from "@/components/kit";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { HoldRing } from "@/components/HoldRing";
import { DoctorAvatar } from "@/components/DoctorAvatar";
import { SponsoredDiscountLine } from "@/components/SponsoredDiscountLine";
import { depositAfterSponsored, useSponsoredQuote } from "@/api/sponsored";

export default function CheckoutPage() {
  const { bookingId = "" } = useParams();
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const nav = useNavigate();
  const booking = useBooking(bookingId);
  const confirm = useConfirmBooking();
  const intent = useDepositCheckout();
  const { nameOf } = usePatient();
  const restart = useStartBooking();
  const deposits = useFeature("kiorex.pay_deposits");
  const [consentData, setConsentData] = useState(false);
  const [consentReminders, setConsentReminders] = useState(true);
  const [alternatives, setAlternatives] = useState<Slot[] | null>(null);
  const desktop = useMediaQuery("(min-width: 1024px)");
  const b = booking.data;
  const vt = useVisitType(b);
  const sponsoredQuote = useSponsoredQuote(bookingId, b?.status === "HELD").data ?? null; // GRW-P2-S: null when flag OFF or nothing applies
  const { remainingMs, expired } = useCountdown(b?.status === "HELD" ? b.holdExpiresAt : null);

  // Revisiting a booking that already progressed goes to its appointment page.
  useEffect(() => { if (b && b.status !== "HELD" && b.status !== "EXPIRED") nav(`/appointments/${b.id}`, { replace: true, state: confirm.isPending || confirm.isSuccess ? { justBooked: true } : undefined }); }, [b, nav, confirm.isPending, confirm.isSuccess]);

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
  const canConfirm = consentData && !confirm.isPending;

  const onConfirm = () =>
    confirm.mutate({ bookingId: b.id, marketplaceConsent: consentData, remindersConsent: consentReminders }, {
      onSuccess: (res) => {
        const detail = `/appointments/${res.id}`;
        // "You will pay the deposit right after confirming": go straight to Kiorex Pay; the appointment page keeps a pay button if the patient comes back unpaid.
        if (hasDeposit && deposits.enabled) {
          intent.mutate(res.id, {
            onSuccess: (r) => { if (r.checkoutUrl) window.location.assign(withSandboxReturn(r.checkoutUrl, window.location.origin + detail)); else nav(detail, { replace: true, state: { justBooked: true } }); },
            onError: () => { toast.error(t("checkout.depositFailed")); nav(detail, { replace: true, state: { justBooked: true } }); },
          });
          return;
        }
        nav(detail, { replace: true, state: { justBooked: true } });
      },
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

  const feeEgp = vt?.feeEgp;
  const dueNow = hasDeposit ? (sponsoredQuote ? depositAfterSponsored(b.deposit.requiredEgp, sponsoredQuote.amountMinor) : b.deposit.requiredEgp) : 0;
  const confirmBtn = (
    <Button size="lg" className="w-full" disabled={!canConfirm} onClick={onConfirm} data-testid="confirm-booking">
      {confirm.isPending ? t("states.loading") : t("checkout.confirm")}
    </Button>
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-24 lg:pb-0">
      <Stepper steps={[t("flow.choose"), t("flow.confirm"), t("flow.done")]} current={1} label={t("flow.label")} className="mx-auto max-w-xl" />
      <PageHeader title={t("checkout.title")} hint={t("checkout.subtitle")} className="mb-0" />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-5">
          <HoldRing remainingMs={remainingMs ?? 0} />

          <section className="kx-card space-y-4 p-5" aria-label={t("checkout.summary")}>
            <div className="flex items-center gap-4">
              <DoctorAvatar name={pick(b.doctor, "name", lang)} verified={b.doctor.verified} size="lg" />
              <div className="min-w-0"><p className="text-lg font-semibold">{pick(b.doctor, "name", lang)}</p><p className="text-sm text-muted-foreground">{vt ? pick(vt, "name", lang) : "…"}{vt && ` · ${t("doctor.minutes", { count: vt.durationMin })}`}</p></div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex items-start gap-3 rounded-xl bg-muted/60 p-3"><CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-ocean" aria-hidden="true" /><div><p className="text-sm font-medium">{formatDayLong(b.startsAt, lang)}</p><p className="kx-label-num text-sm text-muted-foreground" dir="ltr">{formatTime(b.startsAt, lang)}</p></div></div>
              <div className="flex items-start gap-3 rounded-xl bg-muted/60 p-3"><MapPin className="mt-0.5 h-5 w-5 shrink-0 text-ocean" aria-hidden="true" />
                {b.home ? <p className="text-sm font-medium" data-testid="checkout-home">{t("hv.homeVisitAt")}</p> : <div><p className="text-sm font-medium">{pick(b.clinic, "name", lang)}</p><p className="text-sm text-muted-foreground">{pick(b.clinic, "address", lang)}</p></div>}</div>
            </div>
          </section>

          <section className="kx-card flex items-center gap-4 p-5" aria-labelledby="patient-title">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent text-lg font-semibold text-primary" aria-hidden="true">{nameOf(b.patient.id).slice(0, 1)}</span>
            <div className="min-w-0 flex-1"><h2 id="patient-title" className="text-xs font-medium text-muted-foreground">{t("checkout.patient")}</h2><p className="truncate font-semibold" data-testid="checkout-patient">{nameOf(b.patient.id)}</p></div>
            <Link to={`/doctors/${b.doctor.id}`} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-ocean hover:underline"><UserRound className="h-4 w-4" aria-hidden="true" />{t("checkout.changePatient")}</Link>
          </section>
          {b.home && <VisitAddressView home={b.home} />}

          <section className="kx-card space-y-1 p-5" aria-labelledby="consent-title">
            <h2 id="consent-title" className="mb-1 flex items-center gap-2 text-lg"><ShieldCheck className="h-5 w-5 text-ocean" aria-hidden="true" />{t("checkout.consents")}</h2>
            <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl p-2 hover:bg-accent/60">
              <Checkbox checked={consentData} onCheckedChange={(c) => setConsentData(c === true)} data-testid="consent-data" className="mt-0.5" />
              <span className="text-sm">{t("checkout.consentData")} <span className="text-xs font-medium text-destructive">{t("checkout.requiredTag")}</span></span>
            </label>
            <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl p-2 hover:bg-accent/60">
              <Checkbox checked={consentReminders} onCheckedChange={(c) => setConsentReminders(c === true)} data-testid="consent-reminders" className="mt-0.5" />
              <span className="text-sm">{t("checkout.consentReminders")}</span>
            </label>
          </section>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-24" aria-label={t("checkout.payment")}>
          <section className="kx-card space-y-4 p-5 shadow-float">
            <h2 className="text-lg">{t("checkout.payment")}</h2>
            {b.home ? <HomeFee home={b.home} /> : (
              <dl className="space-y-2 text-sm">
                <div className="flex items-baseline justify-between gap-3"><dt>{t("checkout.visitFee")}<span className="block text-xs text-muted-foreground">{t("checkout.payAtClinic")}</span></dt><dd className="kx-label-num font-semibold">{feeEgp != null ? formatMoney(feeEgp, lang) : "…"}</dd></div>
              </dl>
            )}
            {sponsoredQuote && <SponsoredDiscountLine quote={sponsoredQuote} lang={lang} />}
            {hasDeposit && (
              <div className="space-y-1 rounded-xl border border-warning/50 bg-warning-soft p-3" data-testid="deposit-panel">
                <p className="flex items-center gap-2 text-sm font-semibold text-warning"><CreditCard className="h-4 w-4" aria-hidden="true" />{t("checkout.depositTitle")}<span className="kx-label-num ms-auto">{formatMoney(b.deposit.requiredEgp, lang)}</span></p>
                <p className="text-xs text-foreground">{t("checkout.depositBody", { amount: formatMoney(b.deposit.requiredEgp, lang) })}</p>
                <p className="text-xs font-medium">{t("checkout.depositAfter")}</p>
                {!deposits.enabled && <p className="text-xs text-warning">{t("unavailable.body")}</p>}
              </div>
            )}
            <div className="flex items-baseline justify-between border-t pt-3"><span className="text-sm font-medium">{t("checkout.dueNow")}</span><span className={cn("kx-label-num font-semibold", dueNow > 0 ? "text-2xl" : "text-base text-success")} data-testid="due-now">{dueNow > 0 ? formatMoney(dueNow, lang) : t("checkout.nothingNow")}</span></div>
            {desktop && confirmBtn}
            {!consentData && <p className="text-center text-xs text-muted-foreground">{t("checkout.consentRequired")}</p>}
            <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground"><Lock className="h-3.5 w-3.5" aria-hidden="true" />{t("checkout.secure")}</p>
          </section>
        </aside>
      </div>
      {!desktop && <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 p-3 backdrop-blur-md"><div className="container px-0">{confirmBtn}</div></div>}

      <SlotTakenDialog alternatives={alternatives} onClose={() => setAlternatives(null)} onPick={(s) => { setAlternatives(null); restart.start(b.doctor.id, s); }} />
    </div>
  );
}
