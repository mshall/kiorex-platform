import { ensureNotificationChannels, NOTIFICATION_CHANNELS } from "@/lib/notificationChannels";

describe("Android notification channels", () => {
  const mk = () => { const calls: Array<[string, Record<string, unknown>]> = []; return { calls, n: { AndroidImportance: { DEFAULT: 3, HIGH: 4 }, setNotificationChannelAsync: async (id: string, c: Record<string, unknown>) => { calls.push([id, c]); } } }; };
  it("creates every channel the API can name, in the app language, on Android only", async () => {
    const { calls, n } = mk();
    expect(await ensureNotificationChannels("android", n, "ar")).toBe(NOTIFICATION_CHANNELS.length);
    expect(calls.map((c) => c[0])).toEqual(["kiorex-default", "kiorex-bookings", "kiorex-reminders", "kiorex-orders"]);
    expect(calls[1][1]).toMatchObject({ name: "الحجوزات والمدفوعات", importance: 4 });
    const ios = mk();
    expect(await ensureNotificationChannels("ios", ios.n)).toBe(0);
    expect(ios.calls).toHaveLength(0);
  });
  it("never throws when the OS refuses a channel", async () => {
    await expect(ensureNotificationChannels("android", { setNotificationChannelAsync: async () => { throw new Error("denied"); } })).resolves.toBe(0);
  });
  it("matches the channel ids the API sends (apps/api pushChannelFor)", () => {
    expect(NOTIFICATION_CHANNELS.map((c) => c.id)).toEqual(expect.arrayContaining(["kiorex-bookings", "kiorex-reminders", "kiorex-orders", "kiorex-default"]));
  });
});
