import { useEffect, useState } from "react";
import { Pressable, Switch, View } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import Constants from "expo-constants";
import { Lockup } from "@/components/Logo";
import { TabFrame } from "@/components/BrandHeader";
import { LanguageMenu } from "@/components/LanguageMenu";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/auth/AuthProvider";
import { useDevices, useMe } from "@/api/hooks";
import { useQueryClient } from "@tanstack/react-query";
import { disablePush, enablePush, pushEnabledLocally, pushSupported } from "@/lib/push";
import { EmptyState, LoadingState } from "@/components/states";
import { Icon, type IconName } from "@/components/Icon";
import { Button, Card, Chip, Row, Screen, T, useToast } from "@/components/ui";
import { space, useTheme, type ThemePref } from "@/theme";
import { pick } from "@/lib/format";
import { SignOutSheet } from "@/components/SignOutSheet";

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

/** Push registration (KXMNT): a switch that registers / removes THIS device through /me/devices. */
function PushCard() {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const toast = useToast();
  const qc = useQueryClient();
  const devices = useDevices();
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void pushEnabledLocally().then((id) => setDeviceId(id || null)); }, []);
  const known = !!deviceId && (devices.data ?? []).some((d) => d.id === deviceId);
  const on = devices.isSuccess ? known : !!deviceId;
  const toggle = async (next: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      if (next) {
        const r = await enablePush(i18n.language.startsWith("en") ? "en" : "ar");
        if (r.ok) { setDeviceId(r.deviceId); toast.show(t("account.pushOn")); }
        else toast.show(t(r.reason === "denied" ? "account.pushDenied" : r.reason === "unsupported" ? "account.pushUnsupported" : "account.pushFailed"), "error");
      } else {
        const ok = await disablePush(deviceId);
        if (ok) { setDeviceId(null); toast.show(t("account.pushOff"), "info"); } else toast.show(t("account.pushFailed"), "error");
      }
      await qc.invalidateQueries({ queryKey: ["devices"] });
    } finally { setBusy(false); }
  };
  return (
    <Card style={{ gap: 10 }} testID="push-card">
      <Row gap={12} style={{ alignItems: "flex-start" }}>
        <View style={{ flex: 1, gap: 4 }}>
          <T variant="h2">{t("account.pushTitle")}</T>
          <T variant="small" muted>{t("account.pushHint")}</T>
        </View>
        <Switch testID="push-toggle" value={on} disabled={busy || !pushSupported()} onValueChange={(v) => void toggle(v)} accessibilityLabel={t("account.pushToggle")}
          trackColor={{ false: colors.borderStrong, true: colors.ink }} thumbColor={colors.surface} ios_backgroundColor={colors.borderStrong} />
      </Row>
      {devices.isSuccess ? <T variant="caption" muted testID="push-devices">{t("account.pushDevices", { count: devices.data.length })}</T> : null}
    </Card>
  );
}

export default function Account() { return <TabFrame><AccountInner /></TabFrame>; }
function AccountInner() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { status, user } = useAuth();
  const [signOutOpen, setSignOutOpen] = useState(false);
  const { pref, setPref } = useTheme();
  const me = useMe(status === "signedIn");

  const settings = (
    <Card style={{ gap: 12 }}>
      <T variant="h2">{t("account.more")}</T>
      <LanguageMenu variant="row" testID="settings-language" />
      <View style={{ gap: 8 }}><T variant="label">{t("settings.theme")}</T>
        <Row style={{ flexWrap: "wrap" }}>{(["light", "dark", "system"] as ThemePref[]).map((p) => <Chip key={p} testID={`theme-${p}`} label={t(`settings.${p}`)} selected={pref === p} onPress={() => setPref(p)} />)}</Row></View>
    </Card>
  );

  if (status === "loading") return <Screen underHeader style={{ paddingTop: space[2] }}><LoadingState /></Screen>;
  if (status !== "signedIn") {
    return <Screen underHeader style={{ paddingTop: space[2], gap: 16 }}><EmptyState icon="user" title={t("account.signedOutTitle")} action={<Button title={t("signIn.cta")} icon="shield" onPress={() => router.push("/sign-in")} />} />{settings}</Screen>;
  }
  const name = me.data ? pick(me.data, "name", i18n.language) : user?.name ?? "";
  return (
    <Screen underHeader title={t("account.title")} style={{ paddingTop: space[2], gap: 16 }} testID="account">
      <Card style={{ gap: 4 }}>
        <T variant="label" muted>{t("account.name")}</T><T testID="account-name" weight="semibold">{name || "—"}</T>
        <T variant="label" muted style={{ marginTop: 8 }}>{t("account.phone")}</T><T style={{ writingDirection: "ltr", textAlign: i18n.language === "ar" ? "right" : "left" }}>{me.data?.phone ?? user?.phone ?? "—"}</T>
        <T variant="caption" muted style={{ marginTop: 8 }}>{t("account.managedBy")}</T>
      </Card>
      <Button testID="sign-out-top" variant="secondary" icon="logout" title={t("account.signOut")} accessibilityLabel={t("account.signOut")} onPress={() => setSignOutOpen(true)} />
      <Card style={{ paddingVertical: 4 }}>
        <NavRow testID="nav-services" icon="list" label={t("services.title")} onPress={() => router.push("/services" as never)} />
        <NavRow testID="nav-family" icon="users" label={t("account.familyTitle")} onPress={() => router.push("/settings/family")} />
        <NavRow testID="nav-addresses" icon="pin" label={t("address.title")} onPress={() => router.push("/settings/addresses")} />
        <NavRow testID="nav-care-plans" icon="calendarPlus" label={t("carePlan.title")} onPress={() => router.push("/care-plans")} />
        <NavRow testID="nav-sharing" icon="lock" label={t("records.sharing")} onPress={() => router.push("/records/sharing")} />
        <NavRow testID="nav-pharmacy-orders" icon="pill" label={t("pharmacy.myOrders")} onPress={() => router.push("/pharmacy/orders")} />
        <NavRow testID="nav-lab-bookings" icon="flask" label={t("lab.myBookings")} onPress={() => router.push("/lab/bookings")} />
        <NavRow testID="nav-followups-acc" icon="bell" label={t("records.followUps")} onPress={() => router.push("/records/follow-ups")} />
        <NavRow testID="nav-consents" icon="shield" label={t("account.consentsTitle")} onPress={() => router.push("/settings/consents")} />
        <NavRow testID="nav-preferences" icon="bell" label={t("account.prefsTitle")} onPress={() => router.push("/settings/preferences" as never)} />
        <NavRow testID="nav-sessions" icon="device" label={t("account.sessionsTitle")} onPress={() => router.push("/settings/sessions")} />
      </Card>
      <PushCard />
      {settings}
      <Card style={{ paddingVertical: 4 }}>
        <NavRow testID="nav-delete" icon="trash" danger label={t("account.deleteTitle")} onPress={() => router.push("/settings/delete")} />
      </Card>
      <Card style={{ gap: 8 }} testID="account-about">
        <Lockup height={56} />
        <T variant="caption" muted forceLatin>v{Constants.expoConfig?.version ?? "1.0.0"}</T>
      </Card>
      <Button testID="sign-out" variant="danger" icon="logout" title={t("account.signOut")} accessibilityLabel={t("account.signOut")} onPress={() => setSignOutOpen(true)} />
      <SignOutSheet visible={signOutOpen} onClose={() => setSignOutOpen(false)} />
    </Screen>
  );
}
