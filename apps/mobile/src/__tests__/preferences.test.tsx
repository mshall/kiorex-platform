import type { ReactElement } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import i18n from "@/i18n";
import { ThemeProvider } from "@/theme";
import Preferences from "../../app/(tabs)/(more)/settings/preferences";
import { mockFetch } from "@/mocks/mockFetch";

/** GRW-P1-I on the patient app: the same preference and consent APIs as the web, AR and EN, nothing pre-ticked, service messages never switchable. */
const mockUpdate = jest.fn();
const mockUnsub = jest.fn();
const mockSetGrowth = jest.fn();
let mockView: Record<string, unknown>;
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ status: "signedIn" }) }));
jest.mock("@/lib/growthConsent", () => ({ setGrowthConsent: (...a: unknown[]) => mockSetGrowth(...a) }));
jest.mock("@/components/ui", () => ({ ...jest.requireActual("@/components/ui"), useToast: () => ({ show: jest.fn() }) }));
jest.mock("@/api/preferences", () => ({
  ...jest.requireActual("@/api/preferences"),
  usePreferences: () => ({ data: mockView, isLoading: false, error: null, refetch: jest.fn() }),
  useUpdatePreferences: () => ({ mutate: (b: unknown, o?: { onSuccess?: () => void }) => { mockUpdate(b); o?.onSuccess?.(); }, isPending: false }),
  useUnsubscribeMarketing: () => ({ mutate: (_: unknown, o?: { onSuccess?: () => void }) => { mockUnsub(); o?.onSuccess?.(); }, isPending: false }),
}));

const view = (over: Record<string, unknown> = {}) => ({
  version: 1, draftWording: true, textVersions: { analytics: "TODO_NEEDS_HUMAN_v0", marketing: "TODO_NEEDS_HUMAN_v0" },
  serviceMessages: [{ purpose: "TRANSACTIONAL", required: true }, { purpose: "SECURITY", required: true }, { purpose: "CLINICAL", required: true }],
  reminders: { consent: false, updatedAt: null }, analytics: { consent: false, textVersion: null, updatedAt: null },
  marketing: { available: false, anyConsent: false, channels: ["WHATSAPP", "SMS", "EMAIL", "PUSH"].map((channel) => ({ channel, marketingConsent: false, channelEnabled: true, suppressed: false, quietStart: null, quietEnd: null })) },
  quietHours: { start: null, end: null, defaultStart: 21, defaultEnd: 9, timezone: "Africa/Cairo" }, caps: { perDay: 1, perWeek: 3 }, withdrawalPropagationSeconds: 60, ...over,
});
const wrap = (ui: ReactElement) => render(<SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 800 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}><ThemeProvider>{ui}</ThemeProvider></SafeAreaProvider>);
const setLang = (l: string) => act(async () => { await i18n.changeLanguage(l); });
beforeEach(() => { mockUpdate.mockReset(); mockUnsub.mockReset(); mockSetGrowth.mockReset(); mockView = view(); });
afterEach(async () => { await setLang("ar"); });

describe("preference centre on the app (EN)", () => {
  beforeEach(async () => { await setLang("en"); });
  it("shows the three service messages as always on, and every optional choice OFF by default", async () => {
    await wrap(<Preferences />);
    expect(screen.getByText("Bookings and receipts")).toBeTruthy();
    expect(screen.getByText("Security and sign-in")).toBeTruthy();
    expect(screen.getByText("Care alerts")).toBeTruthy();
    expect(screen.getAllByText("Always on")).toHaveLength(3);
    for (const id of ["pref-reminders", "pref-analytics", "pref-marketing-WHATSAPP", "pref-marketing-SMS", "pref-marketing-EMAIL", "pref-marketing-PUSH"]) expect(screen.getByTestId(id).props.value).toBe(false);
    expect(screen.getByTestId("prefs-marketing-inactive")).toBeTruthy();
  });
  it("a switch sends exactly that change with the app as the source", async () => {
    await wrap(<Preferences />);
    await fireEvent(screen.getByTestId("pref-reminders"), "valueChange", true);
    expect(mockUpdate).toHaveBeenLastCalledWith({ reminders: true });
    await fireEvent(screen.getByTestId("pref-marketing-SMS"), "valueChange", true);
    expect(mockUpdate).toHaveBeenLastCalledWith({ marketing: { SMS: true } });
  });
  it("measurement follows the account choice on this device (grant and withdrawal)", async () => {
    await wrap(<Preferences />);
    await fireEvent(screen.getByTestId("pref-analytics"), "valueChange", true);
    expect(mockUpdate).toHaveBeenLastCalledWith({ analytics: true });
    expect(mockSetGrowth).toHaveBeenLastCalledWith("granted");
    await fireEvent(screen.getByTestId("pref-analytics"), "valueChange", false);
    expect(mockSetGrowth).toHaveBeenLastCalledWith("denied");
  });
  it("unsubscribe is disabled until a marketing consent exists, then one tap withdraws all", async () => {
    const { rerender } = await wrap(<Preferences />);
    expect(screen.getByTestId("pref-unsubscribe").props.accessibilityState?.disabled).toBe(true);
    mockView = view({ marketing: { available: true, anyConsent: true, channels: view().marketing.channels.map((c) => (c.channel === "EMAIL" ? { ...c, marketingConsent: true } : c)) } });
    await rerender(<SafeAreaProvider><ThemeProvider><Preferences /></ThemeProvider></SafeAreaProvider>);
    expect(screen.getByTestId("pref-marketing-EMAIL").props.value).toBe(true);
    await fireEvent.press(screen.getByTestId("pref-unsubscribe"));
    expect(mockUnsub).toHaveBeenCalledTimes(1);
  });
  it("quiet hours: the stepper wraps around midnight and a custom window can be reset to the default", async () => {
    await wrap(<Preferences />);
    expect(screen.getByTestId("pref-quiet-start-value")).toHaveTextContent("21:00");
    await fireEvent.press(screen.getByTestId("pref-quiet-start-inc"));
    expect(mockUpdate).toHaveBeenLastCalledWith({ quietHours: { start: 22, end: 9 } });
    await fireEvent.press(screen.getByTestId("pref-quiet-end-dec"));
    expect(mockUpdate).toHaveBeenLastCalledWith({ quietHours: { start: 21, end: 8 } });
    expect(screen.queryByTestId("pref-quiet-reset")).toBeNull();
  });
  it("wraps 23 to 00 and 00 to 23", async () => {
    mockView = view({ quietHours: { start: 23, end: 0, defaultStart: 21, defaultEnd: 9, timezone: "Africa/Cairo" } });
    await wrap(<Preferences />);
    await fireEvent.press(screen.getByTestId("pref-quiet-start-inc"));
    expect(mockUpdate).toHaveBeenLastCalledWith({ quietHours: { start: 0, end: 0 } });
    await fireEvent.press(screen.getByTestId("pref-quiet-end-dec"));
    expect(mockUpdate).toHaveBeenLastCalledWith({ quietHours: { start: 23, end: 23 } });
    await fireEvent.press(screen.getByTestId("pref-quiet-reset"));
    expect(mockUpdate).toHaveBeenLastCalledWith({ quietHours: null });
  });
  it("a channel the person stopped with STOP says so", async () => {
    mockView = view({ marketing: { available: true, anyConsent: false, channels: view().marketing.channels.map((c) => (c.channel === "WHATSAPP" ? { ...c, suppressed: true } : c)) } });
    await wrap(<Preferences />);
    expect(screen.getByText("Stopped by you (STOP)")).toBeTruthy();
  });
});

describe("preference centre on the app (AR)", () => {
  it("renders in Arabic with the same choices", async () => {
    await setLang("ar");
    await wrap(<Preferences />);
    expect(screen.getByText("رسائل الخدمة")).toBeTruthy();
    expect(screen.getByText("الرسائل التسويقية")).toBeTruthy();
    expect(screen.getByText("واتساب")).toBeTruthy();
    expect(screen.getAllByText("يعمل دائمًا")).toHaveLength(3);
  });
});

describe("offline fixture (mock mode) keeps the preference contract", () => {
  const call = async (method: string, path: string, body?: unknown) => { const r = await mockFetch(new Request(`http://mock${path}`, { method, headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) })); return r.json(); };
  it("GET, PUT and unsubscribe behave like the real API (OFF by default, marketing never available while locked)", async () => {
    const a = await call("GET", "/api/v1/me/preferences");
    expect(a.reminders.consent).toBe(false); expect(a.marketing.available).toBe(false); expect(a.serviceMessages).toHaveLength(3);
    const b = await call("PUT", "/api/v1/me/preferences", { marketing: { SMS: true } });
    expect(b.marketing.anyConsent).toBe(true);
    const c = await call("POST", "/api/v1/me/preferences/unsubscribe-marketing");
    expect(c.marketing.anyConsent).toBe(false);
  });
});
