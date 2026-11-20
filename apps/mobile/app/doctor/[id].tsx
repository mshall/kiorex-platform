import { useEffect, useMemo, useState } from "react";
import { Linking, ScrollView, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useDoctor, useDoctorReviews, useSlots } from "@/api/hooks";
import { useAddresses } from "@/api/homecare";
import type { Address, ServiceLocation } from "@/api/types";
import type { Slot } from "@/api/types";
import { Avatar, SlotButton, Stars, VerifiedBadge } from "@/components/bits";
import { FamilySwitcher } from "@/components/FamilySwitcher";
import { Icon } from "@/components/Icon";
import { SlotTakenSheet } from "@/components/Sheets";
import { ErrorState, LoadingState, UnavailableState } from "@/components/states";
import { Badge, Banner, Button, Card, Chip, Row, Screen, Stack as VStack, T } from "@/components/ui";
import { ApiError } from "@/api/errors";
import { useFeature } from "@/hooks/useFeature";
import { useStartBooking } from "@/hooks/useStartBooking";
import { useAuth } from "@/auth/AuthProvider";
import { dayKey, formatDay, formatDayLong, formatMoney, formatNumber, formatTime, pick } from "@/lib/format";
import { addRecent } from "@/lib/recent";
import { directionsUrl, telUrl } from "@/lib/calendar";
import { track } from "@/lib/analytics";
import { WaitlistJoin } from "@/components/WaitlistJoin";
import { AddressPicker, ConfirmAddressButton, OutOfCoverage } from "@/components/homecare";
import { badgeText, CARE_TYPE_KEY, classifyHomeError, districtLabel, locationsOf, visitTypesFor } from "@/lib/homecare";
import { useTheme } from "@/theme";

export default function DoctorProfile() {
  const { id, loc: locParam } = useLocalSearchParams<{ id: string; loc?: string }>();
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { colors } = useTheme();
  const { status } = useAuth();
  const doctor = useDoctor(id);
  const reviews = useDoctorReviews(id);
  const marketplace = useFeature("kiorex.marketplace");
  const homeFlag = useFeature("kiorex.home_visits");
  const [loc, setLoc] = useState<ServiceLocation | undefined>(locParam === "HOME" ? "HOME" : undefined);
  const [address, setAddress] = useState<Address | undefined>();
  const addresses = useAddresses(status === "signedIn");
  const [typeId, setTypeId] = useState<string>();
  const [day, setDay] = useState<string>();
  const [slot, setSlot] = useState<Slot>();
  const booking = useStartBooking();
  const d = doctor.data;

  const locations = d ? locationsOf(d.visitTypes) : [];
  const activeLoc: ServiceLocation = loc && locations.includes(loc) ? loc : locations[0] ?? "IN_CLINIC";
  const isHomeVisit = activeLoc === "HOME";
  const types = d ? visitTypesFor(d.visitTypes, activeLoc) : [];
  useEffect(() => { if (d && (!typeId || !types.some((v) => v.id === typeId))) setTypeId(types[0]?.id); }, [d, typeId, activeLoc]); // eslint-disable-line react-hooks/exhaustive-deps
  const covered = !address || !d?.coverageDistricts.length || d.coverageDistricts.includes(address.district);
  useEffect(() => {
    if (d) void addRecent({ id: d.summary.id, nameAr: d.summary.nameAr, nameEn: d.summary.nameEn, specialty: d.summary.specialtyCode });
  }, [d]);
  const slots = useSlots(id, typeId, { serviceLocation: activeLoc, district: covered ? address?.district : undefined });
  const byDay = useMemo(() => {
    const m = new Map<string, Slot[]>();
    for (const s of slots.data ?? []) { const k = dayKey(s.startsAt); m.set(k, [...(m.get(k) ?? []), s]); }
    return m;
  }, [slots.data]);
  const days = [...byDay.keys()];
  useEffect(() => { if (days.length && (!day || !byDay.has(day))) { setDay(days[0]); setSlot(undefined); } }, [days, day, byDay]);
  useEffect(() => { if (slots.data?.length) track("slot_viewed", { providerId: id }); }, [slots.data?.length, id, typeId]);

  if (doctor.isLoading) return <LoadingState />;
  if (doctor.error || !d) return <ErrorState error={doctor.error} onRetry={() => void doctor.refetch()} />;
  const s = d.summary;
  const pol = d.cancellationPolicy;
  const polText = pick(pol, "text", lang) || (pol.freeCancelHoursBefore != null ? t("doctor.policyHours", { hours: pol.freeCancelHoursBefore }) : t("doctor.policyAsk"));
  const vt = d.visitTypes.find((v) => v.id === typeId);
  const categoryOff = !d.categoryEnabled;
  const homeOff = isHomeVisit && !homeFlag.enabled;
  const bookable = d.bookable && marketplace.enabled && !categoryOff && !homeOff;
  const slotsError = slots.error ? classifyHomeError(slots.error) : null;

  return (
    <>
      <Stack.Screen options={{ title: pick(s, "name", lang) }} />
      <Screen testID="doctor-profile" style={{ gap: 14 }}
        footer={bookable ? (
          <VStack gap={6}>
            {slot ? <T variant="small" accessibilityLiveRegion="polite">{t("doctor.selected")}: {formatDayLong(slot.startsAt, lang)} · {formatTime(slot.startsAt, lang)}{vt ? ` · ${formatMoney(vt.feeEgp, lang)}` : ""}{isHomeVisit && vt && vt.surchargeEgp ? ` (${t("hv.includesSurcharge", { amount: formatMoney(vt.surchargeEgp, lang) })})` : ""}</T> : <T variant="small" muted>{t("doctor.pickSlot")}</T>}
            <Button testID="continue-booking" loading={booking.isPending} title={status === "signedIn" ? t("doctor.continue") : t("doctor.signInToBook")} onPress={() => slot && booking.start(s, slot, isHomeVisit && address ? { addressId: address.id } : undefined)} disabled={!slot || (isHomeVisit && (!address || !covered))} />
          </VStack>
        ) : undefined}>
        <Card style={{ gap: 12 }}>
          <Row gap={14} style={{ alignItems: "flex-start" }}>
            <Avatar name={pick(s, "name", lang)} size={64} />
            <View style={{ flex: 1, gap: 4 }}>
              <T variant="title" accessibilityRole="header">{pick(s, "name", lang)}</T>
              {pick(d, "title", lang) ? <T muted>{pick(d, "title", lang)}</T> : null}
              <Row style={{ flexWrap: "wrap" }}>{s.verified ? <VerifiedBadge /> : null}{s.professionBadge ? <Badge tone="ocean" icon="shield" label={badgeText(s.professionBadge, lang)} /> : null}{d.careType !== "DOCTORS" ? <Badge tone="ink" label={t(`careType.${CARE_TYPE_KEY[d.careType]}`)} /> : null}{d.homeEnabled ? <Badge tone="success" icon="home" label={t("hv.visitsAtHome")} /> : null}{s.depositRequired ? <Badge tone="warning" label={t("doctor.depositRequired")} /> : null}</Row>
            </View>
          </Row>
          {s.ratingAvg ? <Row gap={8}><Stars value={s.ratingAvg} size={18} /><T variant="small" accessibilityLabel={t("doctor.ratingLabel", { avg: s.ratingAvg, count: s.ratingCount })}>{formatNumber(s.ratingAvg, lang)} · {t("doctor.reviewsCount", { count: s.ratingCount })}</T></Row> : <T variant="small" muted>{t("doctor.noReviews")}</T>}
        </Card>

        {!marketplace.enabled ? <UnavailableState featureKey="kiorex.marketplace" /> : null}
        {marketplace.enabled && categoryOff ? <UnavailableState featureKey="kiorex.category" scope="GATE" /> : null}
        {marketplace.enabled && !categoryOff && homeOff ? <UnavailableState featureKey="kiorex.home_visits" scope={homeFlag.scope ?? "GATE"} /> : null}
        {d.assignsClinician && isHomeVisit ? <Banner tone="ink" testID="agency-note" body={t("hv.agencyAssigns")} /> : null}

        {bookable ? (
          <Card style={{ gap: 12 }}>
            <T variant="h2" accessibilityRole="header">{t("doctor.bookTitle")}</T>
            <FamilySwitcher />
            {locations.length > 1 ? (
              <>
                <T variant="label">{t("hv.whereLabel")}</T>
                <Row style={{ flexWrap: "wrap" }}>{locations.map((l) => <Chip key={l} testID={`loc-${l}`} icon={l === "HOME" ? "home" : "pin"} label={t(l === "HOME" ? "hv.atHome" : "hv.inClinic")} selected={l === activeLoc} onPress={() => { setLoc(l); setDay(undefined); setSlot(undefined); }} />)}</Row>
              </>
            ) : null}
            {isHomeVisit ? (
              <View style={{ gap: 8 }}>
                <T variant="label">{t("hv.visitAddress")}</T>
                {status !== "signedIn" ? <Button testID="home-sign-in" small variant="secondary" icon="shield" title={t("doctor.signInToBook")} onPress={() => router.push({ pathname: "/sign-in", params: { next: `/doctor/${id}?loc=HOME` } })} /> : (
                  <AddressPicker value={address?.id} onChange={(a) => { setAddress(a); setSlot(undefined); setDay(undefined); booking.clearHomeError(); }} districtFilter={d.coverageDistricts} />
                )}
                {d.coverageDistricts.length ? <T variant="caption" muted>{t("hv.coverage")}: {d.coverageDistricts.map((c) => districtLabel(c, lang)).join(", ")}</T> : null}
                {address && !covered ? <OutOfCoverage error={new ApiError(422, "OUT_OF_COVERAGE", "", { district: address.district, coverageDistricts: d.coverageDistricts })} /> : null}
                {slotsError?.kind === "out_of_coverage" ? <OutOfCoverage error={slots.error} onPickProvider={(pid) => router.push(`/doctor/${pid}?loc=HOME`)} /> : null}
                {address && covered && !address.confirmed ? <Banner tone="warning" testID="address-unconfirmed" body={t("hv.confirmFirst")}><ConfirmAddressButton address={address} onDone={() => void addresses.refetch().then((r) => { const u = r.data?.find((x) => x.id === address.id); if (u) setAddress(u); })} /></Banner> : null}
              </View>
            ) : null}
            <T variant="label">{t("doctor.visitType")}</T>
            <Row style={{ flexWrap: "wrap" }}>{types.map((v) => <Chip key={v.id} testID={`vt-${v.id}`} label={`${pick(v, "name", lang)} · ${formatMoney(v.feeEgp, lang)}`} selected={v.id === typeId} onPress={() => { setTypeId(v.id); setDay(undefined); setSlot(undefined); }} />)}</Row>
            {isHomeVisit && !address ? <T variant="small" muted>{t("hv.pickAddressFirst")}</T> : slots.isLoading && slots.fetchStatus !== "idle" ? <LoadingState /> : slots.error ? (slotsError?.kind === "out_of_coverage" ? null : <ErrorState error={slots.error} onRetry={() => void slots.refetch()} />) : !slots.data ? null : days.length === 0 ? (
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

        {booking.homeError ? (
          <View testID="home-error">{classifyHomeError(booking.homeError).kind === "out_of_coverage" ? <OutOfCoverage error={booking.homeError} onPickProvider={(pid) => router.push(`/doctor/${pid}?loc=HOME`)} /> : <Banner tone="warning" body={t(classifyHomeError(booking.homeError).kind === "address_not_confirmed" ? "hv.confirmFirst" : "hv.addressProblem")} />}</View>
        ) : null}

        {bookable && d.careType === "HOME_NURSING" && d.homeEnabled ? <Button testID="request-care-plan" variant="secondary" icon="calendarPlus" title={t("carePlan.request")} onPress={() => router.push({ pathname: "/care-plans", params: { providerId: id } })} /> : null}

        {bookable && !isHomeVisit ? <WaitlistJoin providerId={id} typeId={typeId} /> : null}

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
