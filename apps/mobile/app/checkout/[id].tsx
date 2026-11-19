import { useEffect, useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useBooking, useConfirmBooking, useDoctor, useReleaseHold } from "@/api/hooks";
import type { Slot } from "@/api/types";
import { Icon } from "@/components/Icon";
import { SlotTakenSheet } from "@/components/Sheets";
import { EmptyState, ErrorState, LoadingState, UnavailableState } from "@/components/states";
import { Banner, Button, Card, Checkbox, Row, Screen, T } from "@/components/ui";
import { useCountdown } from "@/hooks/useCountdown";
import { useDepositPay } from "@/hooks/useDepositPay";
import { useFeature } from "@/hooks/useFeature";
import { usePatient } from "@/hooks/usePatient";
import { useStartBooking } from "@/hooks/useStartBooking";
import { track } from "@/lib/analytics";
import { bookingLanded, classifyBookingError } from "@/lib/booking-state";
import { formatCountdown, formatDayLong, formatMoney, formatTime, pick } from "@/lib/format";
import { useTheme } from "@/theme";

export default function Checkout() {
  const { id = "" } = useLocalSearchParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const router = useRouter();
  const { colors } = useTheme();
  const booking = useBooking(id);
  const b = booking.data;
  const doctor = useDoctor(b?.providerId ?? "");
  const confirm = useConfirmBooking();
  const release = useReleaseHold();
  const restart = useStartBooking();
  const deposits = useFeature("kiorex.pay_deposits");
  const { patients } = usePatient();
  const { pay, busy: payBusy } = useDepositPay();
  const [consentData, setConsentData] = useState(false);
  const [consentReminders, setConsentReminders] = useState(true);
  const [alternatives, setAlternatives] = useState<Slot[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [pending, setPending] = useState(false);
  const [inFlow, setInFlow] = useState(false); // suppresses the auto-redirect while confirm → deposit is running
  const { remainingMs, expired } = useCountdown(b?.status === "HELD" ? b.holdExpiresAt : null);

  // A booking that already progressed belongs on its appointment page (unless we just confirmed a pending-clinic booking).
  useEffect(() => { if (b && b.status !== "HELD" && b.status !== "EXPIRED" && !pending && !inFlow) router.replace(`/appointment/${b.id}`); }, [b, pending, inFlow, router]);

  if (booking.isLoading) return <LoadingState />;
  if (booking.error || !b) return <ErrorState error={booking.error} onRetry={() => void booking.refetch()} />;
  const vt = doctor.data?.visitTypes.find((v) => v.id === b.typeId);
  const patientName = b.dependantId ? patients.find((p) => p.dependantId === b.dependantId)?.name : patients.find((p) => p.relationship === "self")?.name;

  if (pending) {
    return (
      <Screen testID="checkout-pending" style={{ gap: 16 }} footer={<Button testID="view-appointment" title={t("home.viewDetails")} onPress={() => router.replace(`/appointment/${b.id}`)} />}>
        <EmptyState icon="clock" title={t("checkout.pendingTitle")} hint={t("checkout.pendingBody")} />
        {b.confirmationDueAt ? <Banner tone="ink" body={t("appointment.pendingDue", { time: `${formatDayLong(b.confirmationDueAt, lang)} · ${formatTime(b.confirmationDueAt, lang)}` })} /> : null}
      </Screen>
    );
  }
  if (b.status === "EXPIRED" || expired) {
    return (
      <Screen><EmptyState icon="clock" title={t("checkout.expiredTitle")} hint={t("checkout.expiredBody")}
        action={<Button testID="pick-another" title={t("checkout.pickAnother")} onPress={() => router.replace(`/doctor/${b.providerId}`)} />} /></Screen>
    );
  }

  const depositDue = b.depositStatus === "REQUIRED";
  const lowTime = remainingMs != null && remainingMs < 60_000;
  const canConfirm = consentData && !confirm.isPending && !payBusy;

  const onConfirm = () => {
    setMessage(null); setInFlow(true);
    // The server uses the booking id as the idempotency key: tapping twice or retrying can never create a second booking.
    confirm.mutate({ id: b.id, marketplaceConsent: consentData, remindersConsent: consentReminders }, {
      onSuccess: async (res) => {
        track("booking_confirmed", { bookingId: res.id, doctorId: res.providerId, hasDeposit: res.depositStatus !== "NONE" });
        if (res.depositStatus === "REQUIRED" && deposits.enabled) {
          const outcome = await pay(res.id); // deposit via the hosted checkout (WebBrowser); never blocks the confirmed booking
          if (outcome !== "paid") setMessage(t("checkout.depositCancelled"));
        }
        if (res.status === "PENDING_CLINIC") setPending(true); else router.replace(`/appointment/${res.id}`);
      },
      onError: async (e) => {
        const a = classifyBookingError(e);
        setInFlow(false);
        track("booking_failed", { code: a.kind === "generic" ? a.code : a.kind.toUpperCase(), doctorId: b.providerId });
        if (a.kind === "slot_taken") setAlternatives(a.alternatives.map((x) => ({ slotId: x.startsAt, startsAt: x.startsAt, endsAt: x.endsAt, visitTypeId: b.typeId })));
        else if (a.kind === "hold_expired") void booking.refetch();
        else if (a.kind === "unavailable") setUnavailable(true);
        else if (a.kind === "lookup_first") {
          // KXMBK05: outcome unknown → look the booking up before any retry; the idempotency key never changes.
          const fresh = await booking.refetch();
          if (bookingLanded(fresh.data)) router.replace(`/appointment/${b.id}`); else setMessage(t("checkout.timeout"));
        } else setMessage(t("checkout.confirmFailed"));
      },
    });
  };

  return (
    <>
      <Screen testID="checkout" style={{ gap: 14 }} footer={
        <View style={{ gap: 6 }}>
          <Button testID="confirm-booking" title={confirm.isPending || payBusy ? t("states.loading") : t("checkout.confirm")} loading={confirm.isPending || payBusy} disabled={!canConfirm} onPress={onConfirm} />
          {!consentData ? <T variant="caption" muted style={{ textAlign: "center" }}>{t("checkout.consentRequired")}</T> : null}
        </View>}>
        <View testID="hold-countdown" accessibilityRole="timer" style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 14, borderRadius: 14, borderWidth: 1, borderColor: lowTime ? colors.warning : colors.border, backgroundColor: lowTime ? colors.warningSoft : colors.surface }}>
          <Row gap={8} style={{ flex: 1 }}><Icon name="clock" color={colors.pulse} /><T variant="small" weight="medium" style={{ flex: 1 }}>{t("checkout.holdLabel")}</T></Row>
          <T testID="countdown-value" forceLatin weight="bold" style={{ fontSize: 26, writingDirection: "ltr" }} accessibilityLabel={t("checkout.holdRemaining", { time: formatCountdown(remainingMs ?? 0) })}>{formatCountdown(remainingMs ?? 0)}</T>
        </View>

        <Card style={{ gap: 8 }} testID="summary">
          <T variant="h2">{b.doctor ? pick(b.doctor, "name", lang) : ""}</T>
          {b.clinic ? <T variant="small" muted>{pick(b.clinic, "name", lang)} · {pick(b.clinic, "address", lang)}</T> : null}
          <T>{formatDayLong(b.startsAt, lang)} · <T weight="bold">{formatTime(b.startsAt, lang)}</T></T>
          <Row gap={6}><Icon name="user" size={16} color={colors.ink2} /><T variant="small">{t("checkout.patient")}: </T><T variant="small" weight="bold" testID="checkout-patient">{patientName ?? "—"}</T></Row>
          {vt ? <Row style={{ justifyContent: "space-between", borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 }}><T>{pick(vt, "name", lang)}</T><T weight="bold">{formatMoney(vt.feeEgp, lang)}</T></Row> : null}
        </Card>

        {depositDue ? (
          <Card testID="deposit-panel" style={{ gap: 8, borderColor: colors.warning }}>
            <Row gap={8}><Icon name="card" color={colors.ink2} /><T variant="h2">{t("checkout.depositTitle")}</T></Row>
            <T variant="small" muted>{t("checkout.depositBody", { amount: formatMoney(b.depositAmountMinor / 100, lang) })}</T>
            {!deposits.enabled ? <UnavailableState featureKey="kiorex.pay_deposits" /> : <T variant="small" color={colors.ink}>{t("checkout.depositAfterConfirm")}</T>}
          </Card>
        ) : null}

        <Card style={{ gap: 2 }}>
          <T variant="h2" style={{ marginBottom: 4 }}>{t("checkout.consents")}</T>
          <Checkbox testID="consent-data" checked={consentData} onChange={setConsentData} label={t("checkout.consentData")} />
          <Checkbox testID="consent-reminders" checked={consentReminders} onChange={setConsentReminders} label={t("checkout.consentReminders")} />
        </Card>
        {message ? <Banner tone="warning" body={message} testID="checkout-message" /> : null}
        {unavailable ? <UnavailableState /> : null}
        <Button variant="ghost" title={t("common.cancel")} onPress={() => { release.mutate(b.id, { onSettled: () => router.back() }); }} />
      </Screen>
      <SlotTakenSheet alternatives={alternatives} onClose={() => setAlternatives(null)} onPick={(s) => { setAlternatives(null); restart.start({ id: b.providerId }, s); }} />
    </>
  );
}
