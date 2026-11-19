import { useEffect, useMemo, type ReactNode } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
// Core encoder only (pure JS, no canvas/fs): the package root pulls in Node-only renderers that Metro cannot bundle.
import QRCode from "qrcode/lib/core/qrcode";
import Svg, { Rect } from "react-native-svg";
import { useAuth } from "@/auth/AuthProvider";
import { useFeature } from "@/hooks/useFeature";
import type { BookingChannel } from "@/api/types";
import { useMarkets } from "@/api/features";
import { useFlags, useMe } from "@/api/hooks";
import { Badge, Banner, Button, T } from "./ui";
import { EmptyState, LoadingState, UnavailableState } from "./states";
import { useTheme } from "@/theme";

/** Auth-required screens: signed-out users get a sign-in prompt instead of a failing request. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const { t } = useTranslation();
  const router = useRouter();
  if (status === "loading") return <LoadingState />;
  if (status !== "signedIn") return <EmptyState icon="lock" title={t("common.signInRequired")} hint={t("common.signInRequiredHint")} action={<Button testID="require-sign-in" title={t("signIn.cta")} icon="shield" onPress={() => router.push("/sign-in")} />} />;
  return <>{children}</>;
}

/** Flag OFF (global/market/org) or awaiting a launch gate ⇒ localized "temporarily unavailable"; existing data elsewhere is never hidden. */
export function FlagScreen({ flag, children }: { flag: string; children: ReactNode }) {
  const f = useFeature(flag);
  return f.enabled ? <>{children}</> : <UnavailableState featureKey={flag} scope={f.scope} />;
}

const CHANNEL_KEY: Record<BookingChannel, string> = { MARKETPLACE: "marketplace", CLINIC_LINK: "clinicLink", WHATSAPP: "whatsapp" };
/** Where the booking came from (marketplace / clinic booking link / WhatsApp). */
export function ChannelBadge({ channel }: { channel: BookingChannel | undefined }) {
  const { t } = useTranslation();
  if (!channel) return null;
  return <Badge testID={`channel-${channel}`} tone={channel === "MARKETPLACE" ? "ink" : channel === "WHATSAPP" ? "success" : "ocean"} icon={channel === "WHATSAPP" ? "phone" : channel === "CLINIC_LINK" ? "pin" : "search"} label={t(`channel.${CHANNEL_KEY[channel]}`)} />;
}

/** Launch gate (ADR-024): the patient's market must be LIVE. Not live ⇒ explanatory banner, never a broken screen. */
export function useMarketGate() {
  const markets = useMarkets();
  const flags = useFlags();
  const { status } = useAuth();
  const me = useMe(status === "signedIn");
  const code = (me.data?.market ?? flags.data?.market ?? "EG").toUpperCase();
  const entry = markets.data?.find((m) => m.code.toUpperCase() === code);
  // Unknown (offline / not listed) fails open: the API still enforces with 403 FEATURE_DISABLED.
  return { market: code, live: entry ? entry.live : true, state: entry?.state, loading: markets.isLoading };
}

export function MarketGateBanner() {
  const { t } = useTranslation();
  const g = useMarketGate();
  if (g.live) return null;
  return <Banner testID="market-gate" tone="warning" title={t("market.awaitingTitle")} body={t("market.awaitingBody", { market: g.market })} />;
}

/** Real scannable QR (pure-JS matrix → SVG; no native module). The payload is the prescription verification URL/token only. */
export function QrCode({ value, size = 200 }: { value: string; size?: number }) {
  const { t } = useTranslation();
  const { scheme } = useTheme();
  const m = useMemo(() => { try { return QRCode.create(value, { errorCorrectionLevel: "M" }).modules; } catch { return null; } }, [value]);
  if (!m) return null;
  const n = m.size; const q = 2; const cell = size / (n + q * 2);
  const rects: ReactNode[] = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (m.get(y, x)) rects.push(<Rect key={`${x}-${y}`} x={(x + q) * cell} y={(y + q) * cell} width={cell + 0.4} height={cell + 0.4} fill="#000" />);
  // Always dark-on-white (scanners need contrast), also in dark mode.
  return (
    <View testID="qr-code" accessible accessibilityRole="image" accessibilityLabel={t("records.qrLabel")} style={{ backgroundColor: "#fff", padding: 6, borderRadius: 12, alignSelf: "center", borderWidth: scheme === "dark" ? 0 : 1, borderColor: "#E2E8F0" }}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>{rects}</Svg>
    </View>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) { return <T variant="h2" accessibilityRole="header">{children}</T>; }

/** Re-run an effect once on mount (analytics beacons etc.). */
export const useOnce = (fn: () => void) => { // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(fn, []);
};
