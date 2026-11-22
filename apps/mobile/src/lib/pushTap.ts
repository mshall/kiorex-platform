import { Platform } from "react-native";
import { makeTapDeduper } from "./pushRoute";

type Go = (data: unknown) => void;
/** Notification taps: foreground/background (listener) and cold start (last response). Returns an unsubscribe. No-op on web. Never throws. */
export function installNotificationTapHandler(go: Go): () => void {
  if (Platform.OS === "web") return () => {};
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const N = require("expo-notifications") as typeof import("expo-notifications");
    const fresh = makeTapDeduper();
    const handle = (r: import("expo-notifications").NotificationResponse | null | undefined) => {
      if (!r || !fresh(`${r.notification.request.identifier}:${r.actionIdentifier}:${r.notification.date}`)) return;
      go(r.notification.request.content.data);
    };
    void Promise.resolve(N.getLastNotificationResponse?.()).then(handle).catch(() => {});
    const sub = N.addNotificationResponseReceivedListener(handle);
    return () => sub.remove();
  } catch { return () => {}; }
}
