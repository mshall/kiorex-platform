// Android notification channels (API 26+): the server names one of these ids in every push (FCM android.notification.channel_id / Expo channelId,
// see apps/api messaging/adapters.ts pushChannelFor). An unknown id falls back to the OS default channel and loses the sound / importance settings,
// so the ids here and in the API must stay in sync. Created before the permission prompt (required for the Android 13 POST_NOTIFICATIONS dialog to appear).
export const NOTIFICATION_CHANNELS = [
  { id: "kiorex-default", nameEn: "General", nameAr: "عام", importance: "DEFAULT" },
  { id: "kiorex-bookings", nameEn: "Bookings and payments", nameAr: "الحجوزات والمدفوعات", importance: "HIGH" },
  { id: "kiorex-reminders", nameEn: "Reminders", nameAr: "التذكيرات", importance: "HIGH" },
  { id: "kiorex-orders", nameEn: "Orders, labs and visits", nameAr: "الطلبات والتحاليل والزيارات", importance: "DEFAULT" },
] as const;
export type NotificationChannelId = (typeof NOTIFICATION_CHANNELS)[number]["id"];

type Notif = { setNotificationChannelAsync?: (id: string, c: never) => Promise<unknown>; AndroidImportance?: object };

/** Idempotent; a no-op off Android. Never throws. */
export async function ensureNotificationChannels(os: string, Notifications: Notif, lang: "ar" | "en" = "en"): Promise<number> {
  if (os !== "android" || !Notifications.setNotificationChannelAsync) return 0;
  let n = 0;
  for (const c of NOTIFICATION_CHANNELS) {
    try {
      await Notifications.setNotificationChannelAsync(c.id, { name: lang === "ar" ? c.nameAr : c.nameEn, importance: (Notifications.AndroidImportance as Record<string, number> | undefined)?.[c.importance] ?? 3, vibrationPattern: [0, 250, 250, 250], lightColor: "#3730A3", showBadge: true } as never);
      n++;
    } catch { /* channel creation is best effort */ }
  }
  return n;
}
