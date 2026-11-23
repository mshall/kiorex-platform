import { useEffect } from "react";
import { ScrollView, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/auth/AuthProvider";
import { Lockup } from "@/components/Logo";
import { PulseLine } from "@/components/Pulse";
import { Button, T } from "@/components/ui";
import { useTheme } from "@/theme";
import { config } from "@/lib/config";
import { Icon } from "@/components/Icon";

// DEV ONLY. The condition must stay an inline literal expression: Metro folds `__DEV__` and EXPO_PUBLIC_* per file, so a production bundle drops the require and with it ./dev/* (asserted by scripts/check-no-dev-test-users.mjs).
const DevTestUsers = __DEV__ && process.env.EXPO_PUBLIC_DEV_TEST_USERS !== "false" ? (require("@/dev/DevTestUsers") as typeof import("@/dev/DevTestUsers")).DevTestUsers : null;

/** Onboarding / sign-in (KX-03 §06, KX-04): one action — Continue with Kiorex Passport. */
export default function SignIn() {
  const { t } = useTranslation();
  const router = useRouter();
  const { next } = useLocalSearchParams<{ next?: string }>();
  const { login, busy, error, status } = useAuth();
  const { colors, scheme } = useTheme();
  const insets = useSafeAreaInsets();

  const go = async () => { await login(); };
  useEffect(() => { if (status === "signedIn") router.replace((next as never) ?? "/(tabs)"); }, [status, next, router]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.ground }}>
      <LinearGradient colors={scheme === "dark" ? ["#161835", "#0B2A3D"] : ["#3730A3", "#0369A1"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ paddingTop: insets.top + 40, paddingBottom: 44, paddingHorizontal: 24, alignItems: "center", gap: 20, borderBottomLeftRadius: 36, borderBottomRightRadius: 36 }}>
        <Lockup height={44} light />
        <View style={{ alignItems: "center", gap: 8, marginTop: 8 }}>
          <T variant="display" color="#FFFFFF" style={{ textAlign: "center" }} accessibilityRole="header">{t("signIn.title")}</T>
          <T color="#DCDBEF" style={{ textAlign: "center", maxWidth: 340 }}>{t("signIn.subtitle")}</T>
        </View>
        <PulseLine width={150} loop={false} color="#F08A75" />
      </LinearGradient>
      <ScrollView contentContainerStyle={{ padding: 24, gap: 14 }} keyboardShouldPersistTaps="handled">
        {error ? <T testID="sign-in-error" color={colors.danger} style={{ textAlign: "center" }} accessibilityRole="alert">{t(error)}</T> : null}
        <Button testID="continue-passport" title={t("signIn.cta")} icon="shield" loading={busy} onPress={go} />
        <Button testID="browse-doctors" variant="secondary" title={t("signIn.browse")} icon="search" onPress={() => router.replace("/(tabs)")} />
        <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start", paddingTop: 4 }}>
          <Icon name="shield" size={16} color={colors.muted} />
          <T variant="caption" muted style={{ flex: 1 }}>{t("signIn.passportNote")}</T>
        </View>
        {DevTestUsers ? <DevTestUsers busy={busy} onPick={(phone) => void login(phone)} /> : null}
        {config.mock ? <T variant="caption" color={colors.pulse} style={{ textAlign: "center" }}>{t("signIn.mockNote")}</T> : null}
        <T variant="caption" muted style={{ textAlign: "center" }}>{t("footer.emergency")}</T>
      </ScrollView>
    </View>
  );
}
