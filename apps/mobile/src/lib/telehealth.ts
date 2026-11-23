// Clinic-owned video visit (P2P WebRTC hosted by the Clinic). Pure helpers, no network and no React: unit-tested in __tests__/telehealth.test.ts.
// The app never hosts media or mints tokens. It shows the booking's `telehealth` block and opens the Clinic's patient page (`joinUrl` = .../v/<token>)
// in a WebView, where the Clinic page runs the call. Camera/microphone setup lives in app.config.ts (iOS usage strings, Android permissions).
import type { Booking } from "@/api/types";

export type Telehealth = NonNullable<Booking["telehealth"]>;
export type TelePhase = "inPerson" | "cancelled" | "ended" | "missed" | "beforeWindow" | "open" | "live" | "windowPassed" | "noLink";

export function telehealthPhase(t: Telehealth, now = Date.now()): TelePhase {
  if (t.state === "IN_PERSON") return "inPerson";
  if (t.state === "CANCELLED") return "cancelled";
  if (t.state === "ENDED") return "ended";
  if (t.state === "MISSED") return "missed";
  if (!t.joinUrl) return "noLink";
  if (now > new Date(t.closesAt).getTime()) return "windowPassed";
  if (t.state === "LIVE") return "live";
  return now < new Date(t.opensAt).getTime() ? "beforeWindow" : "open";
}
export const canJoin = (p: TelePhase) => p === "open" || p === "live";

/** The WebView may only stay on the Clinic origin that issued the link (https, or http for local dev hosts). Everything else is handed to the system browser. */
export function sameOrigin(url: string, joinUrl: string): boolean {
  try { const a = new URL(url); const b = new URL(joinUrl); return a.origin === b.origin; } catch { return false; }
}
export const isWebUrl = (u: string | null | undefined): u is string => { try { const p = new URL(u ?? ""); return p.protocol === "https:" || p.protocol === "http:"; } catch { return false; } };

/**
 * react-native-webview settings for a WebRTC call page.
 * iOS: allowsInlineMediaPlayback (video plays inside the page, not full screen), mediaPlaybackRequiresUserAction=false (remote video/audio autoplays),
 *      mediaCapturePermissionGrantType: the Clinic origin is the only page we load, so the camera/mic prompt is granted after the OS prompt (NSCamera/NSMicrophoneUsageDescription).
 * Android: RNCWebChromeClient.onPermissionRequest maps the page's getUserMedia request to RECORD_AUDIO / CAMERA and asks the OS; we also ask up front (see requestAndroidMediaPermissions).
 */
export const WEBVIEW_MEDIA_PROPS = {
  allowsInlineMediaPlayback: true,
  mediaPlaybackRequiresUserAction: false,
  mediaCapturePermissionGrantType: "grant" as const,
  javaScriptEnabled: true,
  domStorageEnabled: true,
  allowsFullscreenVideo: true,
  setSupportMultipleWindows: false,
  allowsLinkPreview: false,
  incognito: true, // no cookies or cache kept for the call page
  cacheEnabled: false,
};

/** Permissions the call page needs (documented for QA and the native config test). */
export const ANDROID_MEDIA_PERMISSIONS = ["android.permission.CAMERA", "android.permission.RECORD_AUDIO"] as const;
