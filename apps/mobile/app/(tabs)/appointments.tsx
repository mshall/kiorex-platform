import { useState } from "react";
import { RefreshControl, View } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/auth/AuthProvider";
import { useBookings } from "@/api/hooks";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { Icon } from "@/components/Icon";
import { ChannelBadge } from "@/components/feature";
import { Badge, Button, Card, Chip, Row, Screen, T } from "@/components/ui";
import { isUpcoming } from "@/lib/booking-state";
import { formatDayLong, formatTime, pick } from "@/lib/format";
import type { Booking } from "@/api/types";
import { useTheme } from "@/theme";

const tone = (s: Booking["status"]) => (s === "CONFIRMED" || s === "COMPLETED" || s === "CHECKED_IN" ? "success" : s === "CANCELLED" || s === "NO_SHOW" ? "danger" : "warning");

export default function Appointments() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { status } = useAuth();
  const q = useBookings(status === "signedIn");
  const [tab, setTab] = useState<"upcoming" | "past">("upcoming");

  if (status !== "signedIn") {
    return <Screen style={{ paddingTop: insets.top }}><EmptyState icon="calendar" title={t("states.notSignedIn")} action={<Button title={t("signIn.cta")} icon="shield" onPress={() => router.push("/sign-in")} />} /></Screen>;
  }
  const all = (q.data ?? []).filter((b) => b.status !== "EXPIRED" && b.status !== "INTENT");
  const upcoming = all.filter((b) => isUpcoming(b) || (b.status === "HELD" && b.holdExpiresAt != null && new Date(b.holdExpiresAt) > new Date())).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const past = all.filter((b) => !upcoming.includes(b) && b.status !== "HELD").sort((a, b) => b.startsAt.localeCompare(a.startsAt));
  const list = tab === "upcoming" ? upcoming : past;

  return (
    <Screen style={{ paddingTop: insets.top + 12, gap: 14 }} refresh={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={colors.ink} />} testID="appointments">
      <T variant="title" accessibilityRole="header">{t("appointments.title")}</T>
      <Row gap={8} style={{ flexWrap: "wrap" }}>
        <Chip testID="waitlist-link" icon="clock" label={t("waitlist.title")} onPress={() => router.push("/waitlist")} />
        <Chip testID="tab-upcoming" label={t("appointments.upcoming")} selected={tab === "upcoming"} onPress={() => setTab("upcoming")} />
        <Chip testID="tab-past" label={t("appointments.past")} selected={tab === "past"} onPress={() => setTab("past")} />
      </Row>
      {q.isLoading ? <LoadingState /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : list.length === 0 ? (
        <EmptyState icon="calendar" title={t(`appointments.empty.${tab}`)} />
      ) : list.map((b) => (
        <Card key={b.id} testID={`appt-${b.id}`} onPress={() => router.push(b.status === "HELD" ? `/checkout/${b.id}` : `/appointment/${b.id}`)} accessibilityLabel={b.doctor ? pick(b.doctor, "name", lang) : ""} style={{ gap: 8 }}>
          <Row style={{ justifyContent: "space-between" }}><T variant="h2" style={{ flex: 1 }}>{b.doctor ? pick(b.doctor, "name", lang) : ""}</T><Badge tone={tone(b.status)} label={t(`status.${b.status}`)} /></Row>
          <Row gap={6}><Icon name="calendar" size={16} color={colors.ink2} /><T variant="small">{formatDayLong(b.startsAt, lang)} · {formatTime(b.startsAt, lang)}</T></Row>
          <ChannelBadge channel={b.channel} />
          {b.clinic ? <Row gap={6}><Icon name="pin" size={16} color={colors.ink2} /><T variant="small" muted>{pick(b.clinic, "name", lang)}</T></Row> : null}
        </Card>
      ))}
      <View />
    </Screen>
  );
}
