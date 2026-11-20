import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useAuth } from "@/auth/AuthProvider";
import { useTranslation } from "react-i18next";
import { useSearchDoctors, useSpecialties } from "@/api/hooks";
import { useAddresses, useCareTypes, useHomeDistricts } from "@/api/homecare";
import type { CareType, SearchParams } from "@/api/types";
import { CareTypeTiles } from "@/components/homecare";
import { defaultAddress, districtLabel } from "@/lib/homecare";
import { useFeature } from "@/hooks/useFeature";
import { DoctorCard } from "@/components/bits";
import { EmergencyBanner } from "@/components/EmergencyBanner";
import { MarketGateBanner } from "@/components/feature";
import { FamilySwitcher } from "@/components/FamilySwitcher";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { FiltersSheet, SlotTakenSheet } from "@/components/Sheets";
import { Button, Chip, Field, Row, Screen, T } from "@/components/ui";
import { useStartBooking } from "@/hooks/useStartBooking";
import { isEmergencyQuery } from "@/lib/emergency";
import { mapKeywordToSpecialty, track } from "@/lib/analytics";
import { pick } from "@/lib/format";
import { UnavailableState } from "@/components/states";
import { ApiError } from "@/api/errors";

const activeFilters = (p: SearchParams) => [p.maxFee, p.gender, p.minRating, p.availableWithinDays, p.acceptsDeposit, p.sort && p.sort !== "earliest" ? p.sort : undefined].filter((v) => v !== undefined && v !== "").length;

export default function Results() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ q?: string; specialty?: string; careType?: string; loc?: string }>();
  const { status } = useAuth();
  const [params0, setParams] = useState<SearchParams>({ q: params.q, specialty: params.specialty, careType: params.careType as CareType | undefined, serviceLocation: params.loc === "HOME" ? "HOME" : undefined });
  const careTypes = useCareTypes();
  const homeFlag = useFeature("kiorex.home_visits");
  const home = params0.serviceLocation === "HOME";
  const districts = useHomeDistricts(home);
  const addresses = useAddresses(home && status === "signedIn");
  const myDistrict = defaultAddress(addresses.data)?.district;
  useEffect(() => { if (home && !params0.district && myDistrict) setParams((p) => ({ ...p, district: myDistrict })); }, [home, params0.district, myDistrict]);
  const selectedCare = careTypes.data?.find((c) => c.code === params0.careType);
  const careOff = !!selectedCare && !selectedCare.enabled;
  const [text, setText] = useState(params.q ?? "");
  const [filters, setFilters] = useState(false);
  const booking = useStartBooking();
  const specialties = useSpecialties();

  const emergencyLocal = isEmergencyQuery(params0.q ?? "");
  const search = useSearchDoctors(params0, !emergencyLocal && !careOff && !(home && !params0.district));
  const emergency = emergencyLocal || !!search.data?.emergency; // server may also flag emergency terms (no results then)

  useEffect(() => { if (search.data && !emergency) track("results_viewed", { specialtyCode: params0.specialty ?? mapKeywordToSpecialty(params0.q ?? "") }); }, [search.data, emergency, params0.specialty, params0.q]);

  const submit = () => setParams((p) => ({ ...p, q: text.trim() || undefined, specialty: undefined }));
  const title = useMemo(() => (params0.specialty ? pick(specialties.data?.find((s) => s.code === params0.specialty) ?? { nameAr: "", nameEn: "" }, "name", i18n.language) : t("results.title")), [params0.specialty, specialties.data, i18n.language, t]);
  const n = activeFilters(params0);

  return (
    <>
      <Stack.Screen options={{ title }} />
      <Screen style={{ gap: 12 }} testID="results">
        <Field testID="results-search" label={t("search.label")} value={text} onChangeText={(v) => { setText(v); }} onSubmitEditing={submit} returnKeyType="search" placeholder={t("home.searchPlaceholder")} />
        {isEmergencyQuery(text) ? null : <Row gap={8}><Button testID="results-submit" style={{ flex: 1 }} small title={t("search.submit")} icon="search" onPress={submit} /><Chip testID="open-filters" icon="filter" label={`${t("results.filters")}${n ? ` (${n})` : ""}`} selected={n > 0} onPress={() => setFilters(true)} /></Row>}
        <MarketGateBanner />
        {careTypes.data?.length ? <CareTypeTiles items={careTypes.data} selected={params0.careType} onSelect={(c) => setParams((p) => ({ ...p, careType: p.careType === c.code ? undefined : c.code, serviceLocation: c.code === "HOME_NURSING" ? "HOME" : p.serviceLocation }))} /> : null}
        <Row gap={8} style={{ flexWrap: "wrap" }}>
          <Chip testID="loc-any" icon="pin" label={t("hv.inClinic")} selected={!home} onPress={() => setParams((p) => ({ ...p, serviceLocation: undefined, district: undefined }))} />
          <Chip testID="loc-home" icon="home" label={t("hv.atHome")} selected={home} onPress={() => setParams((p) => ({ ...p, serviceLocation: "HOME" }))} />
        </Row>
        {home ? (
          <View testID="district-picker" style={{ gap: 6 }}>
            <T variant="label">{t("hv.yourDistrict")}</T>
            {districts.isLoading ? <LoadingState /> : (districts.data ?? []).length === 0 ? <T variant="small" muted>{t("hv.noDistricts")}</T> : (
              <Row style={{ flexWrap: "wrap" }}>{(districts.data ?? []).map((d) => <Chip key={d.district} testID={`search-district-${d.district}`} label={`${districtLabel(d.district, i18n.language)} (${d.homeEnabledProviders})`} selected={params0.district === d.district} onPress={() => setParams((p) => ({ ...p, district: d.district }))} />)}</Row>
            )}
            {!homeFlag.enabled ? <UnavailableState featureKey="kiorex.home_visits" scope={homeFlag.scope ?? "GATE"} /> : null}
          </View>
        ) : null}
        <FamilySwitcher />
        {emergency || isEmergencyQuery(text) ? <EmergencyBanner /> : careOff ? <View testID="care-awaiting"><UnavailableState featureKey={selectedCare?.flag ?? "kiorex.category"} scope="GATE" /></View> : home && !params0.district ? <T variant="small" muted testID="pick-district-hint">{t("hv.pickDistrictFirst")}</T> : search.isLoading ? <LoadingState /> : search.error ? (
          search.error instanceof ApiError && search.error.isFeatureDisabled ? <UnavailableState featureKey={search.error.featureKey} /> : <ErrorState error={search.error} onRetry={() => void search.refetch()} />
        ) : (
          <View style={{ gap: 12 }}>
            <T variant="small" muted accessibilityLiveRegion="polite">{t("results.count", { count: search.data?.total ?? 0 })}</T>
            {search.data?.marketsLive?.length === 0 ? <UnavailableState scope="GATE" featureKey="market" /> : null}
            {search.data?.items.length === 0 && search.data.marketsLive?.length !== 0 ? <EmptyState title={home ? t("hv.noHomeProviders") : t("results.emptyTitle")} hint={home ? t("hv.noHomeProvidersHint", { district: districtLabel(params0.district, i18n.language) }) : t("results.emptyHint")} /> : null}
            {search.data?.items.map((d) => (
              <DoctorCard key={d.id} d={d} home={home} onOpen={() => router.push(home ? `/doctor/${d.id}?loc=HOME` : `/doctor/${d.id}`)} onPickSlot={(s) => (home ? router.push(`/doctor/${d.id}?loc=HOME`) : booking.start(d, s))} />
            ))}
          </View>
        )}
        {booking.unavailable ? <UnavailableState /> : null}
        {booking.failed ? <T color="#B91C1C" accessibilityRole="alert">{t("booking.holdFailed")}</T> : null}
      </Screen>
      <FiltersSheet visible={filters} onClose={() => setFilters(false)} value={params0} onApply={(v) => { setParams(v); setFilters(false); }} />
      <SlotTakenSheet alternatives={booking.alternatives} onClose={booking.clearAlternatives} onPick={booking.startAlternative} />
    </>
  );
}
