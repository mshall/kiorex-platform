import { useEffect, useState } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useFonts } from "expo-font";
import { Jost_400Regular, Jost_500Medium, Jost_600SemiBold, Jost_700Bold } from "@expo-google-fonts/jost";
import { IBMPlexSansArabic_400Regular, IBMPlexSansArabic_500Medium, IBMPlexSansArabic_600SemiBold, IBMPlexSansArabic_700Bold } from "@expo-google-fonts/ibm-plex-sans-arabic";
import { useTranslation } from "react-i18next";
import { bootstrapI18n } from "@/i18n";
import { ThemeProvider, fontFamily, useTheme } from "@/theme";
import { ToastProvider } from "@/components/ui";
import { AnimatedSplash } from "@/components/AnimatedSplash";
import { AuthProvider } from "@/auth/AuthProvider";
import { PatientProvider } from "@/hooks/usePatient";
import { setAnalyticsSink } from "@/lib/analytics";
import { ApiError } from "@/api/errors";
import { api } from "@/api/client";
import { usePushRouting } from "@/hooks/usePushRouting";

void SplashScreen.preventAutoHideAsync();

// Analytics: privacy-safe whitelist only (lib/analytics) → POST /analytics/events (public, fire-and-forget; never blocks the UI).
setAnalyticsSink((batch) => {
  if (__DEV__) console.log("[analytics]", JSON.stringify(batch.map((e) => ({ n: e.name, p: e.props }))));
  void api.POST("/api/v1/analytics/events", { body: { events: batch.map((e) => ({ name: e.name, props: e.props })) } }).catch(() => {});
});

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 20_000, retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2 } },
});

function Shell() {
  usePushRouting();
  const { t, i18n } = useTranslation();
  const { colors, scheme } = useTheme();
  const common = { headerStyle: { backgroundColor: colors.surface }, headerShadowVisible: false, animation: "slide_from_right" as const, headerLargeTitleShadowVisible: false, headerTintColor: colors.ink, headerTitleStyle: { fontFamily: fontFamily(i18n.language, "semibold"), color: colors.text }, contentStyle: { backgroundColor: colors.ground }, headerBackButtonDisplayMode: "minimal" as const };
  return (
    <>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <Stack screenOptions={common}>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
        <Stack.Screen name="auth/callback" options={{ headerShown: false }} />
        <Stack.Screen name="auth/logout" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="checkout/[id]" options={{ title: t("checkout.title"), gestureEnabled: false, animation: "slide_from_bottom" }} />
        <Stack.Screen name="visit-status/[token]" options={{ title: t("hv.familyScreenTitle"), headerShown: false }} />
        <Stack.Screen name="telemedicine/room/[id]" options={{ title: t("tele.roomTitle") }} />
        <Stack.Screen name="telemedicine/join/[bookingId]" options={{ title: t("tele.visit.title") }} />
        <Stack.Screen name="+not-found" options={{ title: t("notFound.title") }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const [i18nReady, setI18nReady] = useState(false);
  const [fontsLoaded, fontError] = useFonts({ Jost_400Regular, Jost_500Medium, Jost_600SemiBold, Jost_700Bold, IBMPlexSansArabic_400Regular, IBMPlexSansArabic_500Medium, IBMPlexSansArabic_600SemiBold, IBMPlexSansArabic_700Bold });
  useEffect(() => { void bootstrapI18n().finally(() => setI18nReady(true)); }, []);
  const ready = i18nReady && (fontsLoaded || !!fontError);
  const [splash, setSplash] = useState(true);
  useEffect(() => { if (ready) void SplashScreen.hideAsync(); }, [ready]);
  if (!ready) return null;
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <AuthProvider>
            <PatientProvider>
              <ToastProvider>
                <Shell />
              </ToastProvider>
            </PatientProvider>
            {splash ? <AnimatedSplash onDone={() => setSplash(false)} /> : null}
          </AuthProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
