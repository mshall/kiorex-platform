// Push registration STUB (KXMNT, MESSAGING_MODE=log). Requests permission and logs the device token; the API-side
// registration endpoint is not part of the contract yet, so nothing is sent. Never throws.
import { Platform } from "react-native";

export async function registerForPush(): Promise<string | null> {
  if (Platform.OS === "web") return null;
  try {
    const Notifications = await import("expo-notifications");
    const cur = await Notifications.getPermissionsAsync();
    const status = cur.granted ? cur : await Notifications.requestPermissionsAsync();
    if (!status.granted) { console.log("[push:log] permission not granted"); return null; }
    const token = await Notifications.getDevicePushTokenAsync();
    console.log("[push:log] device token registered (stub, not sent to API)", String(token.data).slice(0, 8) + "…");
    return String(token.data);
  } catch (e) {
    console.log("[push:log] registration skipped:", (e as Error).message);
    return null;
  }
}
