import { useEffect } from "react";
import { View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/auth/AuthProvider";
import { KiorexMark } from "@/components/Logo";
import { Button, T } from "@/components/ui";
import { useTheme } from "@/theme";
import { config } from "@/lib/config";
import { Icon } from "@/components/Icon";

/** Onboarding / sign-in (KX-03 §06, KX-04): one action — Continue with Kiorex Passport. */
export default function SignIn() {
  const { t } = useTranslation();
  const router = useRouter();
  const { next } = useLocalSearchParams<{ next?: string }>();
  const { login, busy, error, status } = useAuth();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const go = async () => { await login(); };
  useEffect(() => { if (status === "signedIn") router.replace((next as never) ?? "/(tabs)"); }, [status, next, router]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.ground }}>
      <LinearGradient colors={["#3730A3", "#0369A1"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ paddingTop: insets.top + 48, paddingBottom: 48, paddingHorizontal: 24, alignItems: "center", gap: 18, borderBottomLeftRadius: 32, borderBottomRightRadius: 32 }}>
        <KiorexMark width={96} light />
        <T forceLatin weight="bold" style={{ color: "#fff", fontSize: 28, letterSpacing: 6 }}>KIOREX</T>
        <T variant="title" color="#FFFFFF" style={{ textAlign: "center" }} accessibilityRole="header">{t("signIn.title")}</T>
        <T color="#E0E7FF" style={{ textAlign: "center" }}>{t("signIn.subtitle")}</T>
      </LinearGradient>
      <View style={{ padding: 24, gap: 14 }}>
        {error ? <T testID="sign-in-error" color={colors.danger} style={{ textAlign: "center" }} accessibilityRole="alert">{t(error)}</T> : null}
        <Button testID="continue-passport" title={t("signIn.cta")} icon="shield" loading={busy} onPress={go} />
        <Button testID="browse-doctors" variant="secondary" title={t("signIn.browse")} icon="search" onPress={() => router.replace("/(tabs)")} />
        <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
          <Icon name="shield" size={16} color={colors.muted} />
          <T variant="caption" muted style={{ flex: 1 }}>{t("signIn.passportNote")}</T>
        </View>
        {config.mock ? <T variant="caption" color={colors.pulse} style={{ textAlign: "center" }}>{t("signIn.mockNote")}</T> : null}
        <T variant="caption" muted style={{ textAlign: "center" }}>{t("footer.emergency")}</T>
      </View>
    </View>
  );
}
