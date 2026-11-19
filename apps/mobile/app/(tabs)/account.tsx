import { Alert, Platform, Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/auth/AuthProvider";
import { useMe } from "@/api/hooks";
import { EmptyState } from "@/components/states";
import { Icon, type IconName } from "@/components/Icon";
import { Button, Card, Chip, Row, Screen, T } from "@/components/ui";
import { setLanguage, type Lang } from "@/i18n";
import { useTheme, type ThemePref } from "@/theme";
import { pick } from "@/lib/format";

function NavRow({ icon, label, onPress, testID, danger }: { icon: IconName; label: string; onPress: () => void; testID?: string; danger?: boolean }) {
  const { colors } = useTheme();
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={{ minHeight: 52, flexDirection: "row", alignItems: "center", gap: 12 }}>
      <Icon name={icon} color={danger ? colors.danger : colors.ink} />
      <T style={{ flex: 1 }} color={danger ? colors.danger : undefined}>{label}</T>
      <Icon name="chevron" size={18} color={colors.muted} mirror />
    </Pressable>
  );
}

export default function Account() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { status, logout, user } = useAuth();
  const { pref, setPref } = useTheme();
  const me = useMe(status === "signedIn");

  const switchLang = async (l: Lang) => {
    if (i18n.language === l) return;
    const restart = await setLanguage(l);
    if (restart && Platform.OS !== "web") Alert.alert(t("settings.language"), t("settings.restart"));
  };

  const settings = (
    <Card style={{ gap: 12 }}>
      <T variant="h2">{t("account.more")}</T>
      <View style={{ gap: 8 }}><T variant="label">{t("settings.language")}</T>
        <Row><Chip testID="lang-ar" label={t("settings.ar")} selected={i18n.language === "ar"} onPress={() => void switchLang("ar")} /><Chip testID="lang-en" label={t("settings.en")} selected={i18n.language === "en"} onPress={() => void switchLang("en")} /></Row></View>
      <View style={{ gap: 8 }}><T variant="label">{t("settings.theme")}</T>
        <Row style={{ flexWrap: "wrap" }}>{(["system", "light", "dark"] as ThemePref[]).map((p) => <Chip key={p} testID={`theme-${p}`} label={t(`settings.${p}`)} selected={pref === p} onPress={() => setPref(p)} />)}</Row></View>
    </Card>
  );

  if (status !== "signedIn") {
    return <Screen style={{ paddingTop: insets.top + 12, gap: 16 }}><EmptyState icon="user" title={t("account.signedOutTitle")} action={<Button title={t("signIn.cta")} icon="shield" onPress={() => router.push("/sign-in")} />} />{settings}</Screen>;
  }
  const name = me.data ? pick(me.data, "name", i18n.language) : user?.name ?? "";
  return (
    <Screen style={{ paddingTop: insets.top + 12, gap: 16 }} testID="account">
      <T variant="title" accessibilityRole="header">{t("account.title")}</T>
      <Card style={{ gap: 4 }}>
        <T variant="label" muted>{t("account.name")}</T><T testID="account-name" weight="semibold">{name || "—"}</T>
        <T variant="label" muted style={{ marginTop: 8 }}>{t("account.phone")}</T><T style={{ writingDirection: "ltr", textAlign: i18n.language === "ar" ? "right" : "left" }}>{me.data?.phone ?? user?.phone ?? "—"}</T>
        <T variant="caption" muted style={{ marginTop: 8 }}>{t("account.managedBy")}</T>
      </Card>
      <Card style={{ paddingVertical: 4 }}>
        <NavRow testID="nav-family" icon="users" label={t("account.familyTitle")} onPress={() => router.push("/settings/family")} />
        <NavRow testID="nav-sharing" icon="lock" label={t("records.sharing")} onPress={() => router.push("/records/sharing")} />
        <NavRow testID="nav-pharmacy-orders" icon="pill" label={t("pharmacy.myOrders")} onPress={() => router.push("/pharmacy/orders")} />
        <NavRow testID="nav-lab-bookings" icon="flask" label={t("lab.myBookings")} onPress={() => router.push("/lab/bookings")} />
        <NavRow testID="nav-followups-acc" icon="bell" label={t("records.followUps")} onPress={() => router.push("/records/follow-ups")} />
        <NavRow testID="nav-consents" icon="shield" label={t("account.consentsTitle")} onPress={() => router.push("/settings/consents")} />
        <NavRow testID="nav-sessions" icon="device" label={t("account.sessionsTitle")} onPress={() => router.push("/settings/sessions")} />
      </Card>
      {settings}
      <Card style={{ paddingVertical: 4 }}>
        <NavRow testID="nav-delete" icon="trash" danger label={t("account.deleteTitle")} onPress={() => router.push("/settings/delete")} />
        <NavRow testID="sign-out" icon="logout" label={t("account.signOut")} onPress={() => { void logout().then(() => router.replace("/sign-in")); }} />
      </Card>
    </Screen>
  );
}
