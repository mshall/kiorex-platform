import { useEffect } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/auth/AuthProvider";
import { BrandHeader } from "@/components/BrandHeader";
import { LanguageMenu } from "@/components/LanguageMenu";
import { PulseLine } from "@/components/Pulse";
import { Button, T } from "@/components/ui";
import { layeredShadow, radii, space, useTheme } from "@/theme";
import { Icon } from "@/components/Icon";

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

  const tint = scheme === "dark" ? "rgba(139,133,240,0.14)" : "rgba(55,48,163,0.07)";
  return (
    <View style={{ flex: 1, backgroundColor: colors.ground }}>
      {/* the only decoration: a whisper of indigo at the very top of the screen, fading to the ground colour (no banner) */}
      <LinearGradient pointerEvents="none" aria-hidden colors={[tint, "rgba(0,0,0,0)"]} style={{ position: "absolute", top: 0, left: 0, right: 0, height: 280 }} />
      <BrandHeader><LanguageMenu testID="language-menu" /></BrandHeader>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + space[5] }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={{ paddingHorizontal: 24, paddingTop: space[5], paddingBottom: space[4], gap: space[2] }}>
          <T variant="display" accessibilityRole="header" testID="signin-title">{t("signIn.title")}</T>
          <T color={colors.muted} testID="signin-subtitle">{t("signIn.subtitle")}</T>
          <View style={{ marginTop: space[2] }}><PulseLine width={96} loop={false} /></View>
        </View>
        <View style={{ marginHorizontal: space[4], padding: space[5], gap: space[3], borderRadius: radii.xl, backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, ...layeredShadow(scheme) }} testID="signin-card">
          {error ? <T testID="sign-in-error" color={colors.danger} style={{ textAlign: "center" }} accessibilityRole="alert">{t(error)}</T> : null}
          <Button testID="continue-passport" title={t("signIn.cta")} icon="shield" loading={busy} onPress={go} />
          <Button testID="browse-doctors" variant="secondary" title={t("signIn.browse")} icon="search" onPress={() => router.replace("/(tabs)")} />
          <View style={{ flexDirection: "row", gap: space[2], alignItems: "flex-start", paddingTop: space[1] }}>
            <Icon name="shield" size={16} color={colors.muted} />
            <T variant="caption" muted style={{ flex: 1 }}>{t("signIn.passportNote")}</T>
          </View>
        </View>
        <View style={{ paddingHorizontal: space[4], paddingTop: space[4], gap: space[3] }}>
          <T variant="caption" muted style={{ textAlign: "center" }}>{t("footer.emergency")}</T>
        </View>
      </ScrollView>
    </View>
  );
}
