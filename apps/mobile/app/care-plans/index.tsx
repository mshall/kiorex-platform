import { useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { ApiError } from "@/api/errors";
import { useCarePlans, useRequestCarePlan } from "@/api/homecare";
import { useDoctor } from "@/api/hooks";
import type { Address } from "@/api/types";
import { AddressPicker, ConfirmAddressButton } from "@/components/homecare";
import { FlagScreen, RequireAuth } from "@/components/feature";
import { EmptyState, ErrorState, LoadingState, UnavailableState } from "@/components/states";
import { Badge, Banner, Button, Card, Field, Row, Screen, T } from "@/components/ui";
import { classifyHomeError, districtLabel } from "@/lib/homecare";
import { formatDay, formatTime, pick } from "@/lib/format";

/** KXMHV08 (P3 draft): request a recurring home-nursing care plan. Behind kiorex.home_visits + nurse.care_plans (GKN1): the awaiting-gate state shows until both are effective. */
function Body() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const router = useRouter();
  const { providerId } = useLocalSearchParams<{ providerId?: string }>();
  const plans = useCarePlans();
  const request = useRequestCarePlan();
  const provider = useDoctor(providerId ?? "");
  const [address, setAddress] = useState<Address | undefined>();
  const [start, setStart] = useState("");
  const [notes, setNotes] = useState("");
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [gated, setGated] = useState<string | null>(null);
  const gate = gated ?? (plans.error instanceof ApiError && plans.error.isFeatureDisabled ? (plans.error.details?.scope as string | undefined) ?? "GATE" : null);
  const validDate = !start || /^\d{4}-\d{2}-\d{2}$/.test(start);

  const submit = () => {
    if (!providerId || !address) return;
    setMsg(null);
    request.mutate({ providerId, addressId: address.id, preferredStartDate: start || undefined, notes: notes.trim() || undefined }, {
      onSuccess: () => { setNotes(""); setStart(""); setMsg({ tone: "success", text: t("carePlan.requested") }); router.setParams({ providerId: undefined as never }); },
      onError: (e) => {
        const c = classifyHomeError(e);
        if (c.kind === "feature_disabled") setGated((e as ApiError).details?.scope as string ?? "GATE");
        else setMsg({ tone: "danger", text: c.kind === "out_of_coverage" ? t("hv.outOfCoverageBody", { district: districtLabel(c.district, lang) }) : c.kind === "address_not_confirmed" ? t("hv.confirmFirst") : t("carePlan.failed") });
      },
    });
  };

  return (
    <Screen testID="care-plans" style={{ gap: 12 }}>
      <Banner tone="ink" body={t("carePlan.draftNote")} />
      {msg ? <Banner tone={msg.tone} body={msg.text} testID="care-plan-message" /> : null}
      {gate ? <View testID="care-plan-gate"><UnavailableState featureKey="nurse.care_plans" scope={gate === "GLOBAL" ? "GATE" : gate} /></View> : null}
      {providerId && !gate ? (
        <Card style={{ gap: 10 }} testID="care-plan-form">
          <T variant="h2">{t("carePlan.request")}</T>
          {provider.data ? <T weight="medium">{pick(provider.data.summary, "name", lang)}</T> : null}
          <T variant="label">{t("hv.visitAddress")}</T>
          <AddressPicker value={address?.id} onChange={setAddress} districtFilter={provider.data?.coverageDistricts} />
          {address && !address.confirmed ? <ConfirmAddressButton address={address} /> : null}
          <Field testID="plan-start" label={`${t("carePlan.start")} (YYYY-MM-DD)`} value={start} onChangeText={setStart} placeholder="2026-12-01" keyboardType="numbers-and-punctuation" style={{ writingDirection: "ltr" }} />
          <Field testID="plan-notes" label={t("carePlan.notes")} value={notes} onChangeText={setNotes} multiline maxLength={1000} style={{ minHeight: 80, paddingTop: 12, textAlignVertical: "top" }} />
          <Button testID="submit-plan" disabled={!address || !validDate} loading={request.isPending} title={t("carePlan.submit")} onPress={submit} />
        </Card>
      ) : null}
      {plans.isLoading ? <LoadingState /> : plans.error && !gate ? <ErrorState error={plans.error} onRetry={() => void plans.refetch()} /> : !gate && !plans.data?.length ? (
        <EmptyState icon="calendarPlus" title={t("carePlan.empty")} hint={t("carePlan.emptyHint")} />
      ) : (plans.data ?? []).map((p) => (
        <Card key={p.id} testID={`plan-${p.id}`} style={{ gap: 6 }}>
          <Row style={{ justifyContent: "space-between" }}><T weight="semibold">{districtLabel(p.district, lang) || t("carePlan.title")}</T><Badge tone={p.status === "CONFIRMED" ? "success" : p.status === "REJECTED" ? "danger" : p.status === "ENDED" ? "muted" : "warning"} label={t(`carePlan.status.${p.status}`)} /></Row>
          <T variant="small" muted>{t("carePlan.completed", { count: p.completedVisits })}</T>
          {p.visits.slice(0, 5).map((v) => <T key={v.bookingId} variant="small">{formatDay(v.startsAt, lang)} · {formatTime(v.startsAt, lang)}</T>)}
        </Card>
      ))}
      {!providerId && !gate ? <Button testID="find-nurse" variant="secondary" icon="search" title={t("carePlan.find")} onPress={() => router.push({ pathname: "/results", params: { careType: "HOME_NURSING", loc: "HOME" } })} /> : null}
    </Screen>
  );
}
export default function CarePlans() { return <RequireAuth><FlagScreen flag="kiorex.home_visits"><FlagScreen flag="nurse.care_plans"><Body /></FlagScreen></FlagScreen></RequireAuth>; }
