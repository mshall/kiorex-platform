import { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useTeleProviders, useTeleSessions, useTeleVisits } from "@/api/features";
import { TelehealthVisit } from "@/components/TelehealthVisit";
import { useAuth } from "@/auth/AuthProvider";
import { FlagScreen } from "@/components/feature";
import { Avatar } from "@/components/bits";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { Badge, Banner, Card, Field, Row, Screen, T } from "@/components/ui";
import { isEmergencyQuery } from "@/lib/emergency";
import { EmergencyBanner } from "@/components/EmergencyBanner";
import { formatDay, formatTime, pick } from "@/lib/format";

export const teleTone = (s: string) => (s === "IN_PROGRESS" ? "success" : s === "WAITING" ? "warning" : s === "ENDED" || s === "CANCELLED" ? "muted" : "ink") as "success" | "warning" | "muted" | "ink";

function Body() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const router = useRouter();
  const { status } = useAuth();
  const [q, setQ] = useState("");
  const emergency = isEmergencyQuery(q);
  const providers = useTeleProviders(emergency ? "" : q);
  const sessions = useTeleSessions(status === "signedIn");
  const visits = useTeleVisits(status === "signedIn");
  return (
    <Screen testID="telemedicine" style={{ gap: 12 }}>
      <Banner tone="ink" body={t("tele.mockNote")} />
      {status === "signedIn" && visits.data?.length ? (
        <View style={{ gap: 8 }} testID="tele-visits">
          <T variant="h2" accessibilityRole="header">{t("tele.visit.title")}</T>
          {visits.data.map((v) => <View key={v.bookingId} style={{ gap: 6 }}><T variant="small" muted>{v.doctor ? pick(v.doctor, "name", lang) : ""} · {formatDay(v.startsAt, lang)} {formatTime(v.startsAt, lang)}</T><TelehealthVisit bookingId={v.bookingId} telehealth={v.telehealth} /></View>)}
        </View>
      ) : null}
      {status === "signedIn" ? (
        <View style={{ gap: 8 }}>
          <T variant="h2" accessibilityRole="header">{t("tele.mySessions")}</T>
          {sessions.isLoading ? <LoadingState /> : sessions.error ? <ErrorState error={sessions.error} onRetry={() => void sessions.refetch()} /> : !sessions.data?.length ? <T variant="small" muted>{t("tele.noSessions")}</T> : sessions.data.map((s) => (
            <Card key={s.id} testID={`tsession-${s.id}`} onPress={() => router.push(`/telemedicine/room/${s.id}`)} accessibilityLabel={t("tele.openRoom")} style={{ gap: 6 }}>
              <Row style={{ justifyContent: "space-between" }}><View style={{ flex: 1 }}><T weight="semibold">{formatDay(s.scheduledStartsAt, lang)} · {formatTime(s.scheduledStartsAt, lang)}</T></View><Badge tone={teleTone(s.status)} label={t(`tele.status.${s.status}`)} /></Row>
            </Card>
          ))}
        </View>
      ) : null}
      <T variant="h2" accessibilityRole="header">{t("tele.findTitle")}</T>
      <Field testID="tele-search" label={t("tele.search")} placeholder={t("tele.searchPlaceholder")} value={q} onChangeText={setQ} />
      {emergency ? <EmergencyBanner /> : providers.isLoading ? <LoadingState /> : providers.error ? <ErrorState error={providers.error} onRetry={() => void providers.refetch()} /> : !providers.data?.items.length ? <EmptyState icon="video" title={t("tele.noProviders")} hint={t("tele.noProvidersHint")} /> : providers.data.items.map((p) => (
        <Card key={p.id} testID={`tele-doc-${p.id}`} onPress={() => router.push(`/doctor/${p.id}`)} accessibilityLabel={pick(p, "name", lang)} style={{ gap: 6 }}>
          <Row gap={12}><Avatar name={pick(p, "name", lang)} size={44} /><View style={{ flex: 1 }}><T weight="semibold">{pick(p, "name", lang)}</T>{p.specialty ? <T variant="small" muted>{p.specialty}</T> : null}</View><Badge tone="ocean" icon="video" label={t("tele.video")} /></Row>
          {p.nextSlots?.[0]?.startsAt ? <T variant="small" muted>{t("tele.nextSlot", { day: formatDay(p.nextSlots[0].startsAt, lang), time: formatTime(p.nextSlots[0].startsAt, lang) })}</T> : null}
        </Card>
      ))}
    </Screen>
  );
}
export default function TelemedicineHome() { return <FlagScreen flag="kiorex.telemedicine"><Body /></FlagScreen>; }
