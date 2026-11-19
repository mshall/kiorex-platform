import { useEffect } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/auth/AuthProvider";
import { Spinner } from "@/components/ui";

// OIDC redirect target (kiorex://auth/callback · http://localhost:8081/auth/callback). On web the popup posts the result
// back to the opener and closes; on native the in-app browser session resolves in AuthProvider.login().
WebBrowser.maybeCompleteAuthSession();

export default function AuthCallback() {
  const { t } = useTranslation();
  const { status } = useAuth();
  const router = useRouter();
  useEffect(() => { if (status === "signedIn") router.replace("/(tabs)"); }, [status, router]);
  return <View style={{ flex: 1, justifyContent: "center" }}><Spinner label={t("signIn.signingIn")} /></View>;
}
