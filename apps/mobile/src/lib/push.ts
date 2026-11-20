// Push registration (KXMNT). The device token is obtained from the OS (expo-notifications; on web a stable opaque installation id plus the
// browser Notification permission) and registered with POST /me/devices; the provider behind delivery is MESSAGING_MODE=mock|real server-side.
// All functions are fail-soft: they return null / false instead of throwing so the UI can show a calm message.
import { Platform } from "react-native";
import Constants from "expo-constants";
import { api, send } from "@/api/client";
import { prefs } from "./storage";

const K_ON = "kx-push-on";
const K_DEVICE = "kx-push-device-id";
const K_WEB = "kx-push-web-token";

export type PushPlatform = "IOS" | "ANDROID" | "WEB";
export const pushPlatform = (): PushPlatform => (Platform.OS === "ios" ? "IOS" : Platform.OS === "android" ? "ANDROID" : "WEB");
export type PushResult = { ok: true; deviceId: string } | { ok: false; reason: "denied" | "unsupported" | "failed" };

const randomToken = () => `web-${Array.from({ length: 4 }, () => Math.random().toString(16).slice(2, 10)).join("")}`;

/** Requests permission and returns the device token, or null (denied / unavailable). Never throws. */
export async function registerForPush(): Promise<string | null> {
  try {
    if (Platform.OS === "web") {
      const N = (globalThis as { Notification?: { permission: string; requestPermission: () => Promise<string> } }).Notification;
      if (!N) return null;
      const perm = N.permission === "granted" ? "granted" : await N.requestPermission();
      if (perm !== "granted") return null;
      let tok = await prefs.get(K_WEB);
      if (!tok) { tok = randomToken(); await prefs.set(K_WEB, tok); }
      return tok;
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Notifications = require("expo-notifications") as typeof import("expo-notifications"); // lazy: never loaded on web
    const cur = await Notifications.getPermissionsAsync();
    const status = cur.granted ? cur : await Notifications.requestPermissionsAsync();
    if (!status.granted) return null;
    const token = await Notifications.getDevicePushTokenAsync();
    return String(token.data);
  } catch (e) {
    if (typeof __DEV__ !== "undefined" && __DEV__) console.log("[push] registration skipped:", (e as Error).message);
    return null;
  }
}

export const pushSupported = (): boolean => Platform.OS !== "web" || typeof (globalThis as { Notification?: unknown }).Notification !== "undefined";
export const pushEnabledLocally = async (): Promise<string | null> => ((await prefs.get(K_ON)) === "1" ? await prefs.get(K_DEVICE) : null);

/** Enables push for this install: permission -> token -> POST /me/devices. */
export async function enablePush(locale: "ar" | "en"): Promise<PushResult> {
  if (!pushSupported()) return { ok: false, reason: "unsupported" };
  const token = await registerForPush();
  if (!token) return { ok: false, reason: "denied" };
  try {
    const dev = await send(api.POST("/api/v1/me/devices", { body: { platform: pushPlatform(), token, appVersion: Constants.expoConfig?.version, locale } }));
    await prefs.set(K_ON, "1"); await prefs.set(K_DEVICE, dev.id);
    return { ok: true, deviceId: dev.id };
  } catch { return { ok: false, reason: "failed" }; }
}

/** Disables push for this install: DELETE /me/devices/{id} (a 404 means it is already gone). */
export async function disablePush(deviceId: string | null): Promise<boolean> {
  try {
    if (deviceId) await send(api.DELETE("/api/v1/me/devices/{id}", { params: { path: { id: deviceId } } })).catch((e: { status?: number }) => { if (e?.status !== 404) throw e; });
    await prefs.set(K_ON, "0"); await prefs.set(K_DEVICE, "");
    return true;
  } catch { return false; }
}

/** After sign-in: if the user turned push on earlier, refresh the token (idempotent upsert; handles token rotation). Silent, never prompts. */
export async function refreshPushRegistration(locale: "ar" | "en"): Promise<void> {
  try { if ((await prefs.get(K_ON)) === "1") await enablePush(locale); } catch { /* ignore */ }
}
