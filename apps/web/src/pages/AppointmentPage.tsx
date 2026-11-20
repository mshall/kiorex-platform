import { ChannelBadge } from "@/components/ChannelBadge";
import { useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CalendarPlus, Hourglass, Navigation, Phone, Star, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useBooking, useCancelBooking, useDepositCheckout, useRescheduleBooking, useSlots, useVisitType } from "@/api/hooks";
import { ApiError } from "@/api/errors";
import type { Slot } from "@/api/types";
import { ErrorState, LoadingState } from "@/components/states";
import { StatusTimeline } from "@/components/StatusTimeline";
import { ClinicMap, directionsUrl } from "@/components/ClinicMap";
import { SlotButton } from "@/components/SlotButton";
import { formatDayLong, formatMoney, formatTime, pick } from "@/lib/format";
import { buildIcs, downloadIcs } from "@/lib/ics";
import { statusVariant } from "./AppointmentsPage";
import { usePatient } from "@/hooks/usePatient";
import { cn } from "@/lib/utils";
import { FamilySharePanel, HomeFee, HomeProgress, SafetyCardPanel, VisitAddressView } from "@/components/HomeVisitBits";
import { PageHeader, Stepper } from "@/components/kit";
import { ConfirmedMoment } from "@/components/ConfirmedMoment";
import { DateBlock } from "@/components/AppointmentTicket";
import { DoctorAvatar } from "@/components/DoctorAvatar";

export default function AppointmentPage() {
  const { id = "" } = useParams();
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const q = useBooking(id, { poll: true });
  const cancel = useCancelBooking();
  const reschedule = useRescheduleBooking();
  const intent = useDepositCheckout();
  const { nameOf } = usePatient();
  const justBooked = (useLocation().state as { justBooked?: boolean } | null)?.justBooked === true;
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reschedOpen, setReschedOpen] = useState(false);
  const b = q.data;
  const vt = useVisitType(b);
  const slots = useSlots(b?.doctor.id ?? "", reschedOpen ? b?.visitType.id : undefined);
  const nextSlots = useMemo(() => (slots.data ?? []).filter((s) => s.startsAt !== b?.startsAt).slice(0, 9), [slots.data, b?.startsAt]);

  if (q.isLoading) return <LoadingState />;
  if (q.error || !b) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;

  const policyMsg = (e: unknown) => {
    if (e instanceof ApiError && e.code === "CANCELLATION_WINDOW_CLOSED") return t("appointment.windowClosed");
    if (e instanceof ApiError && e.code === "SLOT_TAKEN") return t("booking.slotTakenTitle");
    return t("appointment.actionFailed");
  };
  const onCancel = () => cancel.mutate({ bookingId: b.id }, {
    onSuccess: () => { setCancelOpen(false); toast.success(t("appointment.cancelled")); },
    onError: (e) => { setCancelOpen(false); toast.error(policyMsg(e)); },
  });
  const onResched = (slot: Slot) => reschedule.mutate({ bookingId: b.id, slot }, {
    onSuccess: () => { setReschedOpen(false); toast.success(t("appointment.rescheduled")); },
    onError: (e) => toast.error(policyMsg(e)),
  });
  const onPayLink = () => intent.mutate(b.id, { onSuccess: (r) => window.location.assign(b.deposit.payUrl ?? r.checkoutUrl ?? "/"), onError: () => toast.error(t("checkout.depositFailed")) });

  const clinicCancelled = b.status === "CANCELLED" && b.cancellation.byClinic && !b.home?.aborted;
  const active = ["PENDING_CLINIC", "CONFIRMED"].includes(b.status);
  const refundable = b.deposit.status === "PAID";
  const isHome = b.serviceLocation === "HOME";
  const homeLive = isHome && !!b.home && (["PENDING_CLINIC", "CONFIRMED", "CHECKED_IN", "COMPLETED", "NO_SHOW"].includes(b.status) || !!b.home.aborted); // an unsafe abort ends as CANCELLED but keeps its home sub-state

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeader title={t("appointment.title")} />
        <div className="flex items-center gap-2"><ChannelBadge channel={b.channel} /><Badge variant={statusVariant(b.status)} data-testid="appt-status">{t(`status.${b.status}`)}</Badge></div>
      </div>

      {justBooked && b.status === "CONFIRMED" && <ConfirmedMoment booking={b} />}
      {justBooked && <Stepper steps={[t("flow.choose"), t("flow.confirm"), t("flow.done")]} current={3} label={t("flow.label")} />}

      {b.status === "PENDING_CLINIC" && (
        <div role="status" className="flex gap-3 rounded-xl border border-warning/50 bg-warning-soft p-4" data-testid="pending-clinic">
          <Hourglass className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden="true" />
          <div><p className="font-semibold text-warning">{t("appointment.pendingTitle")}</p><p className="text-sm">{t("appointment.pendingBody")}{b.pendingDueAt && ` ${t("appointment.pendingDue", { time: formatTime(b.pendingDueAt, lang) })}`}</p></div>
        </div>
      )}
      {clinicCancelled && (
        <div role="status" className="flex gap-3 rounded-xl border border-destructive/40 bg-card p-4" data-testid="clinic-cancelled">
          <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
          <div><p className="font-semibold">{t("appointment.clinicCancelledTitle")}</p>{b.cancellation.reason && <p className="text-sm">{t("appointment.reason")}: {b.cancellation.reason}</p>}{b.deposit.status === "REFUNDED" && <p className="text-sm">{t("appointment.autoRefund")}</p>}
            <Link to={`/doctors/${b.doctor.id}`} className="mt-2 inline-flex min-h-11 items-center text-ocean underline underline-offset-4">{t("appointment.findAlternatives")}</Link></div>
        </div>
      )}

      <section className="kx-card space-y-3 p-5">
        <div className="flex items-start gap-4">
          <DateBlock iso={b.startsAt} />
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center gap-2 text-lg font-semibold"><DoctorAvatar name={pick(b.doctor, "name", lang)} size="sm" className="[&>span]:h-8 [&>span]:w-8 [&>span]:text-sm" />{pick(b.doctor, "name", lang)}</div>
            <p className="text-sm text-muted-foreground">{vt ? pick(vt, "name", lang) : ""} · {nameOf(b.patient.id)}</p>
            <p data-testid="appt-time">{formatDayLong(b.startsAt, lang)} · <b dir="ltr">{formatTime(b.startsAt, lang)}</b></p>
            {isHome ? <p className="text-sm text-muted-foreground" data-testid="appt-home">{t("hv.homeVisitAt")}</p> : <p className="text-sm text-muted-foreground">{pick(b.clinic, "name", lang)} · {pick(b.clinic, "address", lang)}</p>}
          </div>
        </div>
        {b.home && <HomeFee home={b.home} />}
        <div className="flex flex-wrap gap-2 pt-2">
          {!isHome && <a href={directionsUrl(b.clinic)} target="_blank" rel="noreferrer" className={cn(buttonVariants({ variant: "outline" }))}><Navigation className="rtl-flip" aria-hidden="true" />{t("appointment.directions")}</a>}
          {!isHome && <a href={`tel:${b.clinic.phone.replace(/\s/g, "")}`} className={cn(buttonVariants({ variant: "outline" }))}><Phone aria-hidden="true" />{t("appointment.call")}</a>}
          {active && <Button variant="outline" onClick={() => downloadIcs(`kiorex-${b.id}.ics`, buildIcs({ id: b.id, title: pick(b.doctor, "name", "en"), location: pick(b.clinic, "address", "en"), startsAt: b.startsAt, endsAt: b.endsAt }))}><CalendarPlus aria-hidden="true" />{t("appointment.addToCalendar")}</Button>}
        </div>
      </section>

      {b.deposit.status !== "NONE" && (
        <section className="kx-card space-y-2 p-5" data-testid="deposit-status">
          <h2 className="text-lg">{t("appointment.deposit")}</h2>
          <p className="text-sm">{t(`deposit.${b.deposit.status}`, { amount: formatMoney(b.deposit.requiredEgp, lang) })}</p>
          {b.deposit.status === "REQUIRED" && active && <Button onClick={onPayLink} disabled={intent.isPending} data-testid="pay-deposit-link">{t("appointment.payDeposit", { amount: formatMoney(b.deposit.requiredEgp, lang) })}</Button>}
        </section>
      )}

      {b.deposit.status === "HOLD_FOR_REVIEW" && <div role="status" className="rounded-xl border border-warning/50 bg-warning-soft p-4 text-sm" data-testid="deposit-hold-review">{t("hv.depositUnderReview")}</div>}
      {homeLive && b.home && <HomeProgress home={b.home} />}
      {isHome && b.home && <VisitAddressView home={b.home} />}
      {homeLive && <SafetyCardPanel bookingId={b.id} />}
      {isHome && active && <FamilySharePanel bookingId={b.id} />}

      <section className="kx-card p-5"><h2 className="mb-5 text-lg">{t("appointment.timeline")}</h2><StatusTimeline booking={b} /></section>

      {active && (
        <section className="flex flex-wrap gap-3">
          <Button variant="outline" disabled={!b.cancellation.canReschedule} onClick={() => setReschedOpen(true)} data-testid="reschedule">{t("appointment.reschedule")}</Button>
          <Button variant="outline" className="border-destructive text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={!b.cancellation.canCancel} onClick={() => setCancelOpen(true)} data-testid="cancel">{t("appointment.cancel")}</Button>
          {(!b.cancellation.canCancel || !b.cancellation.canReschedule) && <p className="w-full text-sm text-muted-foreground">{t("appointment.windowClosed")}</p>}
        </section>
      )}

      {b.reviewable && !b.reviewed && <Link to={`/appointments/${b.id}/review`} className={cn(buttonVariants({ variant: "pulse", size: "lg" }))} data-testid="leave-review"><Star aria-hidden="true" />{t("appointment.leaveReview")}</Link>}
      {b.reviewed && <p className="text-sm text-success">{t("appointment.reviewed")}</p>}

      {!isHome && <ClinicMap clinic={b.clinic} />}

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("appointment.cancelTitle")}</DialogTitle><DialogDescription>{refundable ? t("appointment.cancelRefund") : t("appointment.cancelBody")}</DialogDescription></DialogHeader>
          <DialogFooter><Button variant="outline" onClick={() => setCancelOpen(false)}>{t("appointment.keep")}</Button><Button variant="destructive" onClick={onCancel} disabled={cancel.isPending} data-testid="confirm-cancel">{t("appointment.confirmCancel")}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={reschedOpen} onOpenChange={setReschedOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("appointment.rescheduleTitle")}</DialogTitle><DialogDescription>{t("appointment.rescheduleBody")}</DialogDescription></DialogHeader>
          {slots.isLoading ? <LoadingState /> : nextSlots.length === 0 ? <p className="text-sm text-muted-foreground">{t("doctor.noSlots")}</p> : (
            <div className="flex flex-wrap gap-2">{nextSlots.map((s) => <SlotButton key={s.slotId} slot={s} onPick={onResched} disabled={reschedule.isPending} />)}</div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
