import { useState } from "react";
import { Linking, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useBooking, useCancelBooking, useMyReviews, useRescheduleBooking, useSlots } from "@/api/hooks";
import type { Slot } from "@/api/types";
import { SlotButton, VerifiedBadge } from "@/components/bits";
import { Icon } from "@/components/Icon";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { StatusTimeline } from "@/components/StatusTimeline";
import { Badge, Banner, Button, Card, Row, Screen, Sheet, T } from "@/components/ui";
import { useDepositPay } from "@/hooks/useDepositPay";
import { useFeature } from "@/hooks/useFeature";
import { canReview, classifyBookingError } from "@/lib/booking-state";
import { directionsUrl, googleCalendarUrl, telUrl } from "@/lib/calendar";
import { formatDay, formatDayLong, formatMoney, formatTime, pick } from "@/lib/format";
import { useTheme } from "@/theme";

export default function AppointmentDetail() {
  const { id = "" } = useLocalSearchParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const router = useRouter();
  const { colors } = useTheme();
  const booking = useBooking(id, { poll: true });
  const b = booking.data;
  const cancel = useCancelBooking();
  const resched = useRescheduleBooking();
  const reviews = useMyReviews(b?.status === "COMPLETED");
  const reviewsOn = useFeature("kiorex.reviews");
  const { pay, busy } = useDepositPay();
  const [sheet, setSheet] = useState<"cancel" | "reschedule" | null>(null);
  const [pick1, setPick1] = useState<Slot>();
  const [msg, setMsg] = useState<string | null>(null);
  const slots = useSlots(b?.providerId ?? "", sheet === "reschedule" ? b?.typeId : undefined);

  if (booking.isLoading) return <LoadingState />;
  if (booking.error || !b) return <ErrorState error={booking.error} onRetry={() => void booking.refetch()} />;

  const active = b.status === "PENDING_CLINIC" || b.status === "CONFIRMED";
  const reviewedIds = new Set<string>(((reviews.data ?? []) as { bookingId?: string }[]).map((r) => r.bookingId ?? ""));
  const clinic = b.clinic;
  const calEvent = { id: b.id, title: `Kiorex · ${b.doctor?.nameEn ?? ""}`.trim(), location: clinic?.addressEn ?? "", startsAt: b.startsAt, endsAt: b.endsAt };
  const open = (url: string) => void Linking.openURL(url).catch(() => setMsg(t("appointment.actionFailed")));
  const err = (e: unknown) => { const a = classifyBookingError(e); setMsg(a.kind === "window_closed" ? t("appointment.windowClosed") : t("appointment.actionFailed")); };
  const nearby = (slots.data ?? []).filter((s) => s.startsAt !== b.startsAt).slice(0, 12);
  const clinicCancelled = b.status === "CANCELLED" && String(b.cancelledBy).toUpperCase().startsWith("CLINIC");

  return (
    <>
      <Screen testID="appointment" style={{ gap: 14 }}>
        <Card style={{ gap: 8 }}>
          <Row style={{ justifyContent: "space-between" }}><T variant="title" style={{ flex: 1 }} accessibilityRole="header">{b.doctor ? pick(b.doctor, "name", lang) : ""}</T><Badge testID="status-badge" tone={b.status === "CONFIRMED" || b.status === "COMPLETED" ? "success" : b.status === "CANCELLED" || b.status === "NO_SHOW" ? "danger" : "warning"} label={t(`status.${b.status}`)} /></Row>
          <VerifiedBadge />
          <Row gap={6}><Icon name="calendar" size={18} color={colors.ink2} /><T>{formatDayLong(b.startsAt, lang)} · <T weight="bold">{formatTime(b.startsAt, lang)}</T></T></Row>
          {clinic ? <Row gap={6} style={{ alignItems: "flex-start" }}><Icon name="pin" size={18} color={colors.ink2} /><View style={{ flex: 1 }}><T weight="medium">{pick(clinic, "name", lang)}</T><T variant="small" muted>{pick(clinic, "address", lang)}</T></View></Row> : null}
        </Card>

        {b.status === "PENDING_CLINIC" ? <Banner tone="ink" testID="pending-banner" title={t("appointment.pendingTitle")} body={`${t("appointment.pendingBody")}${b.confirmationDueAt ? " " + t("appointment.pendingDue", { time: `${formatDay(b.confirmationDueAt, lang)} ${formatTime(b.confirmationDueAt, lang)}` }) : ""}`} /> : null}
        {clinicCancelled ? (
          <Banner tone="danger" testID="clinic-cancelled" title={t("appointment.clinicCancelledTitle")}>
            {b.cancellationReason ? <T variant="small">{t("appointment.reason")}: {b.cancellationReason}</T> : null}
            {b.depositStatus === "REFUNDED" ? <T variant="small">{t("appointment.autoRefund")}</T> : null}
            <Button small variant="secondary" title={t("appointment.findAlternatives")} onPress={() => router.push(`/doctor/${b.providerId}`)} />
          </Banner>
        ) : null}
        {msg ? <Banner tone="warning" body={msg} testID="appointment-message" /> : null}

        {b.depositStatus !== "NONE" ? (
          <Card style={{ gap: 8 }} testID="deposit-card">
            <Row gap={8}><Icon name="card" color={colors.ink2} /><T variant="h2">{t("appointment.deposit")}</T></Row>
            <T variant="small">{t(`deposit.${b.depositStatus}`, { amount: formatMoney(b.depositAmountMinor / 100, lang), defaultValue: b.depositStatus })}</T>
            {b.depositStatus === "REQUIRED" && active ? <Button testID="pay-deposit" icon="card" loading={busy} title={t("appointment.payDeposit", { amount: formatMoney(b.depositAmountMinor / 100, lang) })} onPress={() => void pay(b.id).then((o) => { if (o !== "paid") setMsg(t("checkout.depositCancelled")); void booking.refetch(); })} /> : null}
          </Card>
        ) : null}

        <Card style={{ gap: 6 }}>
          <T variant="h2" style={{ marginBottom: 6 }}>{t("appointment.timeline")}</T>
          <StatusTimeline booking={b} />
        </Card>

        {(active || b.status === "COMPLETED" || b.status === "CHECKED_IN") && clinic ? (
          <Row gap={8} style={{ flexWrap: "wrap" }}>
            <Button testID="directions" small variant="secondary" icon="pin" title={t("appointment.directions")} onPress={() => open(directionsUrl({ lat: clinic.latitude ?? null, lng: clinic.longitude ?? null, nameEn: clinic.nameEn ?? "", addressEn: clinic.addressEn ?? "" }))} />
            {clinic.phone ? <Button testID="call-clinic" small variant="secondary" icon="phone" title={t("appointment.call")} onPress={() => open(telUrl(clinic.phone!))} /> : null}
            {active ? <Button testID="add-calendar" small variant="secondary" icon="calendarPlus" title={t("appointment.addToCalendar")} onPress={() => open(googleCalendarUrl(calEvent))} /> : null}
          </Row>
        ) : null}

        {b.status === "CONFIRMED" ? <Button testID="reschedule" variant="secondary" title={t("appointment.reschedule")} onPress={() => { setPick1(undefined); setSheet("reschedule"); }} /> : null}
        {active ? <Button testID="cancel-booking" variant="danger" title={t("appointment.cancel")} onPress={() => setSheet("cancel")} /> : null}
        {canReview(b, reviewedIds) && reviewsOn.enabled ? <Button testID="leave-review" icon="star" title={t("appointment.leaveReview")} onPress={() => router.push(`/review/${b.id}`)} /> : null}
        {b.status === "COMPLETED" && reviewedIds.has(b.id) ? <T variant="small" muted>{t("appointment.reviewed")}</T> : null}
        {b.status === "EXPIRED" ? <EmptyState icon="clock" title={t("status.EXPIRED")} action={<Button title={t("checkout.pickAnother")} onPress={() => router.replace(`/doctor/${b.providerId}`)} />} /> : null}
      </Screen>

      <Sheet visible={sheet === "cancel"} onClose={() => setSheet(null)} title={t("appointment.cancelTitle")} testID="cancel-sheet"
        footer={<Row gap={10}><Button style={{ flex: 1 }} variant="secondary" title={t("appointment.keep")} onPress={() => setSheet(null)} /><Button testID="confirm-cancel" style={{ flex: 1 }} variant="danger" loading={cancel.isPending} title={t("appointment.confirmCancel")}
          onPress={() => cancel.mutate({ id: b.id }, { onSuccess: () => { setSheet(null); setMsg(t("appointment.cancelled")); }, onError: (e) => { setSheet(null); err(e); } })} /></Row>}>
        <T>{b.depositStatus === "PAID" ? t("appointment.cancelRefund") : t("appointment.cancelBody")}</T>
      </Sheet>

      <Sheet visible={sheet === "reschedule"} onClose={() => setSheet(null)} title={t("appointment.rescheduleTitle")} testID="reschedule-sheet"
        footer={<Button testID="confirm-reschedule" disabled={!pick1} loading={resched.isPending} title={t("appointment.confirmReschedule")}
          onPress={() => pick1 && resched.mutate({ id: b.id, startsAt: pick1.startsAt, endsAt: pick1.endsAt }, { onSuccess: () => { setSheet(null); setMsg(t("appointment.rescheduled")); }, onError: (e) => { setSheet(null); err(e); } })} />}>
        <T muted>{t("appointment.rescheduleBody")}</T>
        {slots.isLoading ? <LoadingState /> : nearby.length === 0 ? <T>{t("appointment.noAlternatives")}</T> : (
          <Row style={{ flexWrap: "wrap" }}>{nearby.map((s) => <SlotButton key={s.startsAt} slot={s} showDay selected={pick1?.startsAt === s.startsAt} onPress={() => setPick1(s)} />)}</Row>
        )}
      </Sheet>
    </>
  );
}
