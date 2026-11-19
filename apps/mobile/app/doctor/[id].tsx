import { useEffect, useMemo, useState } from "react";
import { Linking, ScrollView, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { useDoctor, useDoctorReviews, useSlots } from "@/api/hooks";
import type { Slot } from "@/api/types";
import { Avatar, SlotButton, Stars, VerifiedBadge } from "@/components/bits";
import { FamilySwitcher } from "@/components/FamilySwitcher";
import { Icon } from "@/components/Icon";
import { SlotTakenSheet } from "@/components/Sheets";
import { ErrorState, LoadingState, UnavailableState } from "@/components/states";
import { Badge, Button, Card, Chip, Row, Screen, Stack as VStack, T } from "@/components/ui";
import { useFeature } from "@/hooks/useFeature";
import { useStartBooking } from "@/hooks/useStartBooking";
import { useAuth } from "@/auth/AuthProvider";
import { dayKey, formatDay, formatDayLong, formatMoney, formatNumber, formatTime, pick } from "@/lib/format";
import { addRecent } from "@/lib/recent";
import { directionsUrl, telUrl } from "@/lib/calendar";
import { track } from "@/lib/analytics";
import { useTheme } from "@/theme";

export default function DoctorProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { colors } = useTheme();
  const { status } = useAuth();
  const doctor = useDoctor(id);
  const reviews = useDoctorReviews(id);
  const marketplace = useFeature("kiorex.marketplace");
  const [typeId, setTypeId] = useState<string>();
  const [day, setDay] = useState<string>();
  const [slot, setSlot] = useState<Slot>();
  const booking = useStartBooking();
  const d = doctor.data;

  useEffect(() => { if (d && !typeId) setTypeId(d.visitTypes[0]?.id); }, [d, typeId]);
  useEffect(() => {
    if (d) void addRecent({ id: d.summary.id, nameAr: d.summary.nameAr, nameEn: d.summary.nameEn, specialty: d.summary.specialtyCode });
  }, [d]);
  const slots = useSlots(id, typeId);
  const byDay = useMemo(() => {
    const m = new Map<string, Slot[]>();
    for (const s of slots.data ?? []) { const k = dayKey(s.startsAt); m.set(k, [...(m.get(k) ?? []), s]); }
    return m;
  }, [slots.data]);
  const days = [...byDay.keys()];
  useEffect(() => { if (days.length && (!day || !byDay.has(day))) { setDay(days[0]); setSlot(undefined); } }, [days, day, byDay]);
  useEffect(() => { if (slots.data?.length) track("slot_viewed", { doctorId: id, visitTypeId: typeId }); }, [slots.data?.length, id, typeId]);

  if (doctor.isLoading) return <LoadingState />;
  if (doctor.error || !d) return <ErrorState error={doctor.error} onRetry={() => void doctor.refetch()} />;
  const s = d.summary;
  const pol = d.cancellationPolicy;
  const polText = pick(pol, "text", lang) || (pol.freeCancelHoursBefore != null ? t("doctor.policyHours", { hours: pol.freeCancelHoursBefore }) : t("doctor.policyAsk"));
  const vt = d.visitTypes.find((v) => v.id === typeId);
  const bookable = d.bookable && marketplace.enabled;

  return (
    <>
      <Stack.Screen options={{ title: pick(s, "name", lang) }} />
      <Screen testID="doctor-profile" style={{ gap: 14 }}
        footer={bookable ? (
          <VStack gap={6}>
            {slot ? <T variant="small" accessibilityLiveRegion="polite">{t("doctor.selected")}: {formatDayLong(slot.startsAt, lang)} · {formatTime(slot.startsAt, lang)}{vt ? ` · ${formatMoney(vt.feeEgp, lang)}` : ""}</T> : <T variant="small" muted>{t("doctor.pickSlot")}</T>}
            <Button testID="continue-booking" disabled={!slot} loading={booking.isPending} title={status === "signedIn" ? t("doctor.continue") : t("doctor.signInToBook")} onPress={() => slot && booking.start(s, slot)} />
          </VStack>
        ) : undefined}>
        <Card style={{ gap: 12 }}>
          <Row gap={14} style={{ alignItems: "flex-start" }}>
            <Avatar name={pick(s, "name", lang)} size={64} />
            <View style={{ flex: 1, gap: 4 }}>
              <T variant="title" accessibilityRole="header">{pick(s, "name", lang)}</T>
              {pick(d, "title", lang) ? <T muted>{pick(d, "title", lang)}</T> : null}
              <Row style={{ flexWrap: "wrap" }}>{s.verified ? <VerifiedBadge /> : null}{s.depositRequired ? <Badge tone="warning" label={t("doctor.depositRequired")} /> : null}</Row>
            </View>
          </Row>
          {s.ratingAvg ? <Row gap={8}><Stars value={s.ratingAvg} size={18} /><T variant="small" accessibilityLabel={t("doctor.ratingLabel", { avg: s.ratingAvg, count: s.ratingCount })}>{formatNumber(s.ratingAvg, lang)} · {t("doctor.reviewsCount", { count: s.ratingCount })}</T></Row> : <T variant="small" muted>{t("doctor.noReviews")}</T>}
        </Card>

        {!marketplace.enabled ? <UnavailableState featureKey="kiorex.marketplace" /> : null}

        {bookable ? (
          <Card style={{ gap: 12 }}>
            <T variant="h2" accessibilityRole="header">{t("doctor.bookTitle")}</T>
            <FamilySwitcher />
            <T variant="label">{t("doctor.visitType")}</T>
            <Row style={{ flexWrap: "wrap" }}>{d.visitTypes.map((v) => <Chip key={v.id} testID={`vt-${v.id}`} label={`${pick(v, "name", lang)} · ${formatMoney(v.feeEgp, lang)}`} selected={v.id === typeId} onPress={() => { setTypeId(v.id); setDay(undefined); setSlot(undefined); }} />)}</Row>
            {slots.isLoading ? <LoadingState /> : slots.error ? <ErrorState error={slots.error} onRetry={() => void slots.refetch()} /> : days.length === 0 ? (
              <View><T weight="medium">{t("doctor.noSlots")}</T><T variant="small" muted>{t("doctor.noSlotsHint")}</T></View>
            ) : (
              <>
                <T variant="label">{t("doctor.days")}</T>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                  {days.map((k) => <Chip key={k} testID={`day-${k}`} label={formatDay(byDay.get(k)![0].startsAt, lang)} selected={k === day} onPress={() => { setDay(k); setSlot(undefined); }} />)}
                </ScrollView>
                <T variant="label">{t("doctor.times")}</T>
                <Row style={{ flexWrap: "wrap" }}>{(day ? byDay.get(day) ?? [] : []).map((sl) => <SlotButton key={sl.startsAt} slot={sl} selected={slot?.startsAt === sl.startsAt} onPress={() => setSlot(sl)} />)}</Row>
              </>
            )}
          </Card>
        ) : null}

        {/* Cancellation policy is shown BEFORE booking (KX-03 §06). Wording comes from the clinic; no refund terms are invented here. */}
        <Card testID="policy" style={{ gap: 6 }}>
          <Row gap={8}><Icon name="clock" size={18} color={colors.ink2} /><T variant="h2">{t("doctor.policyTitle")}</T></Row>
          <T>{polText}</T>
          {pol.depositRefundable === false ? <T variant="small" color={colors.warning}>{t("doctor.depositNonRefundable")}</T> : null}
        </Card>

        <Card style={{ gap: 8 }}>
          <T variant="h2">{t("doctor.clinic")}</T>
          <T weight="medium">{pick(d.clinic, "name", lang)}</T>
          <T variant="small" muted>{pick(d.clinic, "address", lang)}</T>
          <Row gap={8} style={{ flexWrap: "wrap" }}>
            <Button small variant="secondary" icon="pin" title={t("appointment.directions")} onPress={() => void Linking.openURL(directionsUrl(d.clinic))} />
            {d.clinic.phone ? <Button small variant="secondary" icon="phone" title={t("doctor.callClinic")} onPress={() => void Linking.openURL(telUrl(d.clinic.phone))} /> : null}
          </Row>
        </Card>

        <Card testID="reviews" style={{ gap: 10 }}>
          <T variant="h2">{t("doctor.reviews")}</T>
          {reviews.isLoading ? <LoadingState /> : !reviews.data?.items.length ? (
            <View><T weight="medium">{t("doctor.noReviews")}</T><T variant="small" muted>{t("doctor.noReviewsHint")}</T></View>
          ) : reviews.data.items.map((r) => (
            <View key={r.id} style={{ gap: 4, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10 }}>
              <Row style={{ justifyContent: "space-between" }}><Stars value={r.rating} /><Badge tone="muted" label={t("doctor.verifiedVisit")} /></Row>
              {r.text ? <T>{r.text}</T> : null}
              {r.clinicReply ? <View style={{ backgroundColor: colors.soft, borderRadius: 10, padding: 10 }}><T variant="caption" weight="semibold" color={colors.ink}>{t("doctor.clinicReply")}</T><T variant="small">{r.clinicReply}</T></View> : null}
            </View>
          ))}
        </Card>
      </Screen>
      <SlotTakenSheet alternatives={booking.alternatives} onClose={booking.clearAlternatives} onPick={booking.startAlternative} />
    </>
  );
}
