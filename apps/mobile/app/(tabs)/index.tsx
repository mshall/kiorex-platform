import { useCallback, useState } from "react";
import { ScrollView, View, Pressable } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/auth/AuthProvider";
import { useBookings, useSpecialties } from "@/api/hooks";
import { useCareTypes } from "@/api/homecare";
import { CareTypeTiles } from "@/components/homecare";
import { Avatar } from "@/components/bits";
import { EmergencyBanner } from "@/components/EmergencyBanner";
import { FamilySwitcher } from "@/components/FamilySwitcher";
import { Icon } from "@/components/Icon";
import { Wordmark } from "@/components/Logo";
import { Badge, Button, Card, Chip, Field, Row, T } from "@/components/ui";
import { MarketGateBanner } from "@/components/feature";
import { useFeature } from "@/hooks/useFeature";
import type { IconName } from "@/components/Icon";
import { isEmergencyQuery } from "@/lib/emergency";
import { isUpcoming } from "@/lib/booking-state";
import { formatDayLong, formatTime, pick } from "@/lib/format";
import { getRecent, type RecentDoctor } from "@/lib/recent";
import { mapKeywordToSpecialty, track } from "@/lib/analytics";
import { useTheme } from "@/theme";
import { usePatient } from "@/hooks/usePatient";

function Tile({ icon, label, flag, href, testID }: { icon: IconName; label: string; flag: string; href: string; testID: string }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const f = useFeature(flag);
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={f.enabled ? label : `${label}. ${t("unavailable.title")}`} onPress={() => router.push(href as never)}
      style={{ flexBasis: "47%", flexGrow: 1, minHeight: 88, padding: 12, gap: 8, borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, opacity: f.enabled ? 1 : 0.7 }}>
      <Icon name={icon} color={f.enabled ? colors.ink : colors.muted} />
      <T weight="semibold">{label}</T>
      {f.enabled ? null : <Badge tone="warning" label={t("unavailable.short")} />}
    </Pressable>
  );
}

/** Patient services. A tile stays visible when its flag is OFF and opens a localized "temporarily unavailable" state (never a dead end). */
function Services() {
  const { t } = useTranslation();
  return (
    <View style={{ gap: 10 }}>
      <T variant="h2" accessibilityRole="header">{t("home.services")}</T>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        <Tile testID="tile-pharmacy" icon="pill" label={t("services.pharmacy")} flag="kiorex.pharmacy_orders" href="/pharmacy" />
        <Tile testID="tile-lab" icon="flask" label={t("services.lab")} flag="kiorex.lab_bookings" href="/lab" />
        <Tile testID="tile-tele" icon="video" label={t("services.telemedicine")} flag="kiorex.telemedicine" href="/telemedicine" />
        <Tile testID="tile-waitlist" icon="clock" label={t("services.waitlist")} flag="kiorex.marketplace" href="/waitlist" />
        <Tile testID="tile-addresses" icon="pin" label={t("address.title")} flag="kiorex.home_visits" href="/settings/addresses" />
        <Tile testID="tile-care-plans" icon="calendarPlus" label={t("carePlan.title")} flag="nurse.care_plans" href="/care-plans" />
      </View>
    </View>
  );
}

export default function Home() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const router = useRouter();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { status, user } = useAuth();
  const signedIn = status === "signedIn";
  const { selected } = usePatient();
  const specialties = useSpecialties();
  const careTypes = useCareTypes();
  const bookings = useBookings(signedIn);
  const [q, setQ] = useState("");
  const [recent, setRecent] = useState<RecentDoctor[]>([]);
  useFocusEffect(useCallback(() => { void getRecent().then(setRecent); }, []));

  const emergency = isEmergencyQuery(q); // matched locally; the text is never sent while it is an emergency term
  const upcoming = (bookings.data ?? []).filter((b) => isUpcoming(b)).sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
  const submit = () => {
    if (emergency || !q.trim()) return;
    track("search_started", { specialtyCode: mapKeywordToSpecialty(q) }); // keyword → specialty code BEFORE logging
    router.push({ pathname: "/results", params: { q: q.trim() } });
  };
  const name = user?.name ?? selected?.name;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.ground }} contentContainerStyle={{ padding: 16, paddingTop: insets.top + 20, gap: 18, paddingBottom: 32 }} keyboardShouldPersistTaps="handled" testID="home">
      <Row style={{ justifyContent: "space-between" }}>
        <View style={{ gap: 2 }}>
          <Wordmark size={16} />
          <T variant="display" accessibilityRole="header">{signedIn && name ? t("home.greeting", { name }) : t("home.greetingAnon")}</T>
        </View>
      </Row>

      <View style={{ gap: 10 }}>
        <Field testID="search-input" label={t("search.label")} value={q} onChangeText={setQ} placeholder={t("home.searchPlaceholder")} returnKeyType="search" onSubmitEditing={submit} />
        {emergency ? <EmergencyBanner /> : <Button testID="search-submit" title={t("search.submit")} icon="search" onPress={submit} disabled={!q.trim()} />}
      </View>

      {careTypes.data?.length ? (
        <View style={{ gap: 10 }} testID="care-types">
          <T variant="h2" accessibilityRole="header">{t("careType.title")}</T>
          <CareTypeTiles items={careTypes.data} onSelect={(c) => router.push({ pathname: "/results", params: { careType: c.code, ...(c.code === "HOME_NURSING" ? { loc: "HOME" } : {}) } })} />
        </View>
      ) : null}

      <View style={{ gap: 10 }}>
        <T variant="h2">{t("search.specialties")}</T>
        <Row style={{ flexWrap: "wrap" }} gap={8}>
          {[...(specialties.data ?? [])].sort((a, b) => pick(a, "name", lang).localeCompare(pick(b, "name", lang), lang)).map((s) => (
            <Chip key={s.code} testID={`chip-${s.code}`} label={pick(s, "name", lang)} onPress={() => { track("search_started", { specialtyCode: s.code }); router.push({ pathname: "/results", params: { specialty: s.code } }); }} />
          ))}
        </Row>
      </View>

      <MarketGateBanner />
      <Services />

      {signedIn ? <FamilySwitcher /> : (
        <Card style={{ gap: 10 }}>
          <T weight="medium">{t("home.signInPrompt")}</T>
          <Button testID="home-sign-in" title={t("signIn.cta")} icon="shield" onPress={() => router.push("/sign-in")} />
        </Card>
      )}

      {signedIn ? (
        <View style={{ gap: 10 }}>
          <T variant="h2">{t("home.upcoming")}</T>
          {upcoming ? (
            <Card testID="upcoming-card" onPress={() => router.push(`/appointment/${upcoming.id}`)} accessibilityLabel={t("home.upcoming")} style={{ gap: 8, borderColor: colors.ink, borderWidth: 1.5 }}>
              <Row style={{ justifyContent: "space-between" }}><T variant="h2" style={{ flex: 1 }}>{upcoming.doctor ? pick(upcoming.doctor, "name", lang) : ""}</T><Badge tone={upcoming.status === "CONFIRMED" ? "success" : "warning"} label={t(`status.${upcoming.status}`)} /></Row>
              <Row gap={6}><Icon name="calendar" size={16} color={colors.ink2} /><T variant="small">{formatDayLong(upcoming.startsAt, lang)} · {formatTime(upcoming.startsAt, lang)}</T></Row>
              {upcoming.clinic ? <Row gap={6}><Icon name="pin" size={16} color={colors.ink2} /><T variant="small" muted>{pick(upcoming.clinic, "name", lang)}</T></Row> : null}
            </Card>
          ) : (
            <Card style={{ gap: 4 }}><T weight="medium">{t("home.noUpcoming")}</T><T variant="small" muted>{t("home.noUpcomingHint")}</T></Card>
          )}
        </View>
      ) : null}

      <View style={{ gap: 10 }}>
        <T variant="h2">{t("home.recent")}</T>
        {recent.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
            {recent.map((d) => (
              <Pressable key={d.id} testID={`recent-${d.id}`} accessibilityRole="button" accessibilityLabel={pick(d, "name", lang)} onPress={() => router.push(`/doctor/${d.id}`)}
                style={{ minWidth: 140, alignItems: "center", gap: 6, padding: 12, backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border }}>
                <Avatar name={pick(d, "name", lang)} size={48} /><T variant="small" weight="medium" style={{ textAlign: "center" }}>{pick(d, "name", lang)}</T>
              </Pressable>
            ))}
          </ScrollView>
        ) : <T variant="small" muted>{t("home.recentEmpty")}</T>}
      </View>
      <T variant="caption" muted style={{ textAlign: "center" }}>{t("footer.emergency")}</T>
    </ScrollView>
  );
}
