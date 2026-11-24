import type { ReactElement } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SafeAreaProvider } from "react-native-safe-area-context";
import i18n from "@/i18n";
import { ThemeProvider } from "@/theme";
import { ContinuityCards, cardHref } from "@/modules/continuity/ContinuityCards";
import { clearCard, currentCard, rememberCard, CONTINUITY_HEADER, CONTINUITY_PATHS, type ContinuityCard } from "@/modules/continuity/api";
import en from "@/i18n/locales/en.json";
import ar from "@/i18n/locales/ar.json";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
const mockSend = jest.fn();
jest.mock("@/api/client", () => ({
  api: { GET: (p: string) => mockSend("GET", p), PUT: (p: string, o: unknown) => mockSend("PUT", p, o), POST: (p: string, o: unknown) => mockSend("POST", p, o) },
  send: async (p: Promise<unknown>) => { const r = (await p) as { data?: unknown; ok?: boolean }; if (r.ok === false) throw new Error("http"); return r.data; },
}));

const setLang = (l: string) => act(async () => { await i18n.changeLanguage(l); });
const card = (o: Partial<ContinuityCard> = {}): ContinuityCard => ({ id: "ep_abcdefghij", kind: "RX_TO_PHARMACY", toProduct: "PHARMACY", expiresAt: "2027-03-01T00:00:00Z", recordId: "kx_rec_1", path: "/pharmacy", ...o });
const wrap = (ui: ReactElement) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 320, height: 800 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}><ThemeProvider>{ui}</ThemeProvider></SafeAreaProvider></QueryClientProvider>);
const answer = (cards: ContinuityCard[], o: Record<string, unknown> = {}) => mockSend.mockImplementation(async (m: string) => (m === "GET" ? { data: { enabled: true, consent: false, cards, ...o } } : { data: { granted: true, dismissed: true } }));
const flat = (o: unknown, p = ""): string[] => (o && typeof o === "object" ? Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => flat(v, p ? `${p}.${k}` : k)) : [p]);

beforeEach(() => { mockPush.mockClear(); mockSend.mockReset(); clearCard(); });
afterEach(async () => { await setLang("ar"); });

describe("continuity cards on the patient app (GRW-P4-A)", () => {
  it("English and Arabic carry the same keys; the copy has no condition, drug or test", () => {
    expect(flat((en as any).continuity).sort()).toEqual(flat((ar as any).continuity).sort());
    expect(JSON.stringify((en as any).continuity)).not.toMatch(/diagnos|symptom|cancer|diabet|antibiotic|blood count|discount|coupon/i);
  });
  it("renders nothing when the package is OFF, locked or answers an error", async () => {
    mockSend.mockImplementation(async () => ({ data: { enabled: false, consent: false, cards: [] } }));
    const a = await wrap(<ContinuityCards />); await waitFor(() => expect(mockSend).toHaveBeenCalled()); await act(async () => { await Promise.resolve(); }); expect(screen.queryByTestId("continuity-cards")).toBeNull(); await a.unmount();
    mockSend.mockImplementation(async () => ({ ok: false })); const b = await wrap(<ContinuityCards />); await waitFor(() => expect(mockSend).toHaveBeenCalled()); await act(async () => { await Promise.resolve(); }); expect(screen.queryByTestId("continuity-cards")).toBeNull();
  });
  it("English: the exact pharmacy copy, a 44 pt dismiss target, the connect choice off by default with the draft marker", async () => {
    await setLang("en"); answer([card()]); await wrap(<ContinuityCards />);
    expect(await screen.findByText("Send your prescription to a pharmacy")).toBeTruthy();
    expect(screen.getByTestId("continuity-consent").props.accessibilityState).toEqual({ checked: false });
    expect(screen.getByText(/pending legal review/)).toBeTruthy();
    expect(screen.getByTestId("continuity-dismiss-rx").props.accessibilityLabel).toBe("Hide this card: Send your prescription to a pharmacy");
    expect(JSON.stringify(screen.toJSON())).not.toMatch(/amoxicillin|kx_rec|enc_/i);
  });
  it("Arabic: the Arabic title, intro and call to action", async () => {
    await setLang("ar"); answer([card({ id: "ep_labbbbbbbb", kind: "LAB_ORDER_TO_LAB", toProduct: "LAB", path: "/lab", recordId: undefined })]); await wrap(<ContinuityCards />);
    expect(await screen.findByText("احجز تحليلك")).toBeTruthy(); expect(screen.getByText("تابع رعايتك")).toBeTruthy(); expect(screen.getByText("احجز التحليل")).toBeTruthy();
  });
  it("opening a card remembers it for 30 minutes, goes to the existing screen and saves the consent only when the choice changed", async () => {
    await setLang("en"); answer([card()]); await wrap(<ContinuityCards />);
    await fireEvent.press(await screen.findByTestId("continuity-open-rx"));
    expect(mockPush).toHaveBeenCalledWith("/pharmacy"); expect(currentCard()).toBe("ep_abcdefghij");
    expect(mockSend.mock.calls.some((c) => c[0] === "PUT")).toBe(false);
    await fireEvent.press(screen.getByTestId("continuity-consent")); await fireEvent.press(screen.getByTestId("continuity-open-rx"));
    await waitFor(() => expect(mockSend.mock.calls.find((c) => c[0] === "PUT")?.[2]).toEqual({ body: { granted: true, source: "app" } }));
  });
  it("dismiss hides it through the API", async () => {
    await setLang("en"); answer([card()]); await wrap(<ContinuityCards />);
    await fireEvent.press(await screen.findByTestId("continuity-dismiss-rx"));
    await waitFor(() => expect(mockSend.mock.calls.find((c) => c[0] === "POST")?.[1]).toBe("/api/v1/growth/v1/continuity/cards/ep_abcdefghij/dismiss"));
  });
  it("the target screens and the 30 minute window; the header goes on the three requests only", () => {
    expect([card(), card({ kind: "LAB_ORDER_TO_LAB" }), card({ kind: "CARE_PLAN_TO_HOME_VISIT" })].map(cardHref)).toEqual(["/pharmacy", "/lab", "/care-plans"]);
    rememberCard("ep_abcdefghij", 1_000); expect(currentCard(1_000 + 29 * 60_000)).toBe("ep_abcdefghij"); expect(currentCard(1_000 + 31 * 60_000)).toBeNull();
    rememberCard("bad id!"); expect(currentCard()).toBeNull();
    expect(CONTINUITY_HEADER).toBe("X-Kx-Continuity"); expect([...CONTINUITY_PATHS]).toEqual(["/api/v1/pharmacy/orders", "/api/v1/lab/bookings", "/api/v1/care-plans"]);
  });
});
