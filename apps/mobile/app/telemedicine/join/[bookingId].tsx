import { useCallback, useEffect, useState } from "react";
import { Linking, PermissionsAndroid, Platform, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { WebView, type WebViewNavigation } from "react-native-webview";
import { useBooking } from "@/api/hooks";
import { RequireAuth } from "@/components/feature";
import { ErrorState, LoadingState } from "@/components/states";
import { Banner, Button, Card, Screen, T } from "@/components/ui";
import { ANDROID_MEDIA_PERMISSIONS, canJoin, isWebUrl, sameOrigin, telehealthPhase, WEBVIEW_MEDIA_PROPS } from "@/lib/telehealth";

/** Android: ask for camera + microphone before the page does (the WebView also maps getUserMedia to these via onPermissionRequest). */
async function requestAndroidMediaPermissions(): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  const r = await PermissionsAndroid.requestMultiple([...ANDROID_MEDIA_PERMISSIONS]);
  return ANDROID_MEDIA_PERMISSIONS.every((p) => r[p] === PermissionsAndroid.RESULTS.GRANTED);
}

function Body({ bookingId }: { bookingId: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const q = useBooking(bookingId, { poll: false });
  const tv = q.data?.telehealth ?? null;
  const [perm, setPerm] = useState<"pending" | "ok" | "denied">(Platform.OS === "android" ? "pending" : "ok");
  const [failed, setFailed] = useState(false);
  const [nonce, setNonce] = useState(0);
  useEffect(() => { if (Platform.OS === "android") void requestAndroidMediaPermissions().then((ok) => setPerm(ok ? "ok" : "denied")); }, []);
  const joinUrl = tv?.joinUrl ?? null;
  const external = useCallback((u: string) => { void Linking.openURL(u).catch(() => undefined); }, []);
  if (q.isLoading) return <LoadingState />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!tv || !isWebUrl(joinUrl) || !canJoin(telehealthPhase(tv))) {
    return <Screen testID="tele-join-unavailable" style={{ gap: 12 }}><Banner tone="warning" body={t("tele.visit.unavailable")} /><Button title={t("tele.back")} variant="secondary" onPress={() => router.back()} /></Screen>;
  }
  if (perm === "pending") return <LoadingState />;
  if (perm === "denied") {
    return (
      <Screen testID="tele-join-permission" style={{ gap: 12 }}>
        <Banner tone="warning" title={t("tele.visit.permissionTitle")} body={t("tele.visit.permissionBody")} />
        <Button testID="open-settings" title={t("tele.visit.openSettings")} onPress={() => void Linking.openSettings()} />
        <Button testID="open-browser" variant="secondary" title={t("tele.visit.openBrowser")} onPress={() => external(joinUrl)} />
      </Screen>
    );
  }
  if (Platform.OS === "web") {
    // Expo web: no WebView. The Clinic page opens in a browser tab (the browser asks for camera/microphone itself).
    return <Screen testID="tele-join-web" style={{ gap: 12 }}><Card style={{ gap: 8 }}><T>{t("tele.visit.hint")}</T><Button testID="open-browser" icon="video" title={t("tele.visit.join")} onPress={() => external(joinUrl)} /></Card></Screen>;
  }
  const onNav = (e: WebViewNavigation) => { if (sameOrigin(e.url, joinUrl) || e.url === "about:blank") return true; if (isWebUrl(e.url)) external(e.url); return false; };
  return (
    <View testID="tele-join" style={{ flex: 1 }}>
      {failed ? (
        <Screen style={{ gap: 12 }}>
          <Banner tone="warning" testID="tele-join-error" body={t("tele.visit.openError")} />
          <Button title={t("states.retry", { defaultValue: "Try again" })} onPress={() => { setFailed(false); setNonce((n) => n + 1); }} />
          <Button variant="secondary" title={t("tele.visit.openBrowser")} onPress={() => external(joinUrl)} />
        </Screen>
      ) : (
        <WebView
          key={nonce}
          testID="tele-webview"
          source={{ uri: joinUrl }}
          originWhitelist={[new URL(joinUrl).origin]}
          onShouldStartLoadWithRequest={onNav}
          onError={() => setFailed(true)}
          onHttpError={(e) => { if (e.nativeEvent.statusCode >= 400) setFailed(true); }}
          {...WEBVIEW_MEDIA_PROPS}
        />
      )}
    </View>
  );
}

export default function TeleJoin() {
  const { bookingId = "" } = useLocalSearchParams<{ bookingId: string }>();
  return <RequireAuth><Stack.Screen options={{ title: "" }} /><Body bookingId={bookingId} /></RequireAuth>;
}
