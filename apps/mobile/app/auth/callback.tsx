import { useEffect, useRef } from "react";
import { Platform, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/auth/AuthProvider";
import { Spinner } from "@/components/ui";

// OIDC redirect target (kiorex://auth/callback · http://localhost:8081/auth/callback).
// Native: the in-app browser session resolves inside AuthProvider.login(). Web: full-page redirect, so the code is exchanged here.
WebBrowser.maybeCompleteAuthSession();

export default function AuthCallback() {
  const { t } = useTranslation();
  const { status, completeWebLogin } = useAuth();
  const router = useRouter();
  const { code, state, error } = useLocalSearchParams<{ code?: string; state?: string; error?: string }>();
  const started = useRef(false);
  useEffect(() => {
    if (Platform.OS !== "web" || started.current || status === "loading") return;
    started.current = true;
    if (status === "signedIn") return;
    if (error || !code) { router.replace("/sign-in"); return; }
    void completeWebLogin({ code, state }).then((ok) => router.replace(ok ? "/(tabs)" : "/sign-in"));
  }, [status, code, state, error, completeWebLogin, router]);
  useEffect(() => { if (status === "signedIn") router.replace("/(tabs)"); }, [status, router]);
  return <View style={{ flex: 1, justifyContent: "center" }}><Spinner label={t("signIn.signingIn")} /></View>;
}
