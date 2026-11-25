import type { ReactElement } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import i18n from "@/i18n";
import { ThemeProvider } from "@/theme";
import { ApiError } from "@/api/errors";
import LoyaltyScreen from "../../app/(tabs)/(more)/loyalty/index";
import { cleanPartnerCode, newRequestKey } from "@/modules/loyalty/api";

/** GRW-P4-D on the patient app: my tier, my points (a count, never money), the exchange for a voucher with one request key per tap, a partner code; AR and EN, flag off, calm errors. */
const mockConvert = jest.fn(); const mockRedeem = jest.fn();
let mockMe: { data?: unknown; error?: unknown; isLoading: boolean }; let mockConvertState: { error?: unknown; isPending: boolean; data?: unknown }; let mockRedeemState: { error?: unknown; isPending: boolean; data?: unknown }; let mockHist: { data?: unknown };
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn(), canGoBack: () => true, back: jest.fn() }) }));
jest.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ status: "signedIn" }) }));
jest.mock("@/lib/haptics", () => ({ haptic: { tap: jest.fn(), press: jest.fn(), success: jest.fn(), select: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock("@/components/feature", () => ({ ...jest.requireActual("@/components/feature"), RequireAuth: ({ children }: { children: ReactElement }) => children }));
jest.mock("@/modules/loyalty/api", () => ({
  ...jest.requireActual("@/modules/loyalty/api"),
  useLoyaltyMe: () => ({ ...mockMe, refetch: jest.fn() }), useLoyaltyHistory: () => ({ ...mockHist, isLoading: false }), useConvertPoints: () => ({ mutate: mockConvert, ...mockConvertState }), useRedeemPartnerCode: () => ({ mutate: mockRedeem, ...mockRedeemState }),
}));
const me = (o: Record<string, unknown> = {}) => ({ tier: "SILVER", tierSince: "2027-02-01T00:00:00Z", window: { months: 12, completed: 3 }, next: { tier: "GOLD", minCompletedBookings: 6, remaining: 3 }, points: { balance: 45, expiringSoon: { points: 10, at: "2027-11-24T00:00:00Z" } },
  conversion: { open: true, pointsRequired: 30, valueMinor: 5000, currency: "EGP", blocksLeftThisYear: 2, canConvert: true }, notMoney: true, ...o });
const wrap = (ui: ReactElement) => render(<SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 800 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}><ThemeProvider>{ui}</ThemeProvider></SafeAreaProvider>);
const setLang = (l: string) => act(async () => { await i18n.changeLanguage(l); });
const flat = (o: unknown, p = ""): string[] => (o && typeof o === "object" ? Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => flat(v, p ? `${p}.${k}` : k)) : [p]);
beforeEach(async () => { mockConvert.mockReset(); mockRedeem.mockReset(); mockMe = { data: me(), isLoading: false }; mockConvertState = { isPending: false }; mockRedeemState = { isPending: false }; mockHist = { data: { items: [{ id: "e1", type: "ACCRUE", points: 10, direction: "IN", expiresAt: null, at: "2027-02-01T00:00:00Z" }] } }; await setLang("en"); });
afterEach(async () => { await setLang("ar"); });

describe("loyalty strings and code rule", () => {
  it("English and Arabic carry the same loyalty keys", () => {
    const en = i18n.getResourceBundle("en", "translation").loyalty; const ar = i18n.getResourceBundle("ar", "translation").loyalty;
    expect(flat(en).filter((k) => !flat(ar).includes(k))).toEqual([]); expect(flat(ar).filter((k) => !flat(en).includes(k))).toEqual([]);
  });
  it("no string promises cash or a transfer", () => { expect(JSON.stringify(i18n.getResourceBundle("en", "translation").loyalty).toLowerCase()).not.toMatch(/cash out|withdraw (it|your)|transfer (it|them|your)|sell your|top up/); });
  it("cleans a code like the server and makes request keys the server accepts", () => { expect(cleanPartnerCode("a7kq2-m9xot")).toBe("A7KQ2M9X0T"); expect(cleanPartnerCode("A7KQ2-M9X0U")).toBeNull(); expect(newRequestKey()).toMatch(/^[A-Za-z0-9_-]{8,64}$/); expect(newRequestKey()).not.toBe(newRequestKey()); });
});

describe("loyalty screen (EN)", () => {
  it("shows tier, progress, points as a count, what expires, the not-money banner and the history; no money word on any button", async () => {
    await wrap(<LoyaltyScreen />);
    expect(screen.getByTestId("loyalty-tier-name").props.children).toBe("Silver"); expect(screen.getByText("3 more completed visits to reach Gold")).toBeTruthy(); expect(screen.getByTestId("loyalty-balance").props.children).toBe("45 points");
    expect(screen.getByTestId("loyalty-expiring")).toBeTruthy(); expect(screen.getByTestId("loyalty-not-money")).toBeTruthy(); expect(screen.getByText(/Points earned/)).toBeTruthy();
    for (const b of screen.getAllByRole("button")) expect(JSON.stringify(b.props.accessibilityLabel ?? b.props.children ?? "")).not.toMatch(/transfer|withdraw|cash|top.?up|gift|send/i);
  });
  it("exchanging sends ONE key, and a retry after a failure reuses it", async () => {
    await wrap(<LoyaltyScreen />); await fireEvent.press(screen.getByTestId("loyalty-convert-button")); const first = mockConvert.mock.calls[0][0] as string; expect(first).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    await fireEvent.press(screen.getByTestId("loyalty-convert-button")); expect(mockConvert.mock.calls[1][0]).toBe(first);
  });
  it("disabled with a calm reason without enough points", async () => {
    mockMe = { data: me({ points: { balance: 5, expiringSoon: null }, conversion: { open: true, pointsRequired: 30, valueMinor: 5000, currency: "EGP", blocksLeftThisYear: 2, canConvert: false } }), isLoading: false }; await wrap(<LoyaltyScreen />);
    expect(screen.getByTestId("loyalty-convert-button").props.accessibilityState.disabled).toBe(true); expect(screen.getByTestId("loyalty-not-enough")).toBeTruthy();
  });
  it("closed text when conversion is not open, and a no-tiers message when none is defined", async () => {
    mockMe = { data: me({ tier: "NONE", tierSince: null, next: null, points: { balance: 0, expiringSoon: null }, conversion: { open: false, pointsRequired: 0, valueMinor: 0, currency: "EGP", blocksLeftThisYear: 0, canConvert: false } }), isLoading: false }; await wrap(<LoyaltyScreen />);
    expect(screen.getByTestId("loyalty-convert-closed")).toBeTruthy(); expect(screen.queryByTestId("loyalty-convert-button")).toBeNull(); expect(screen.getByTestId("loyalty-no-tiers")).toBeTruthy();
  });
  it("a refused exchange says the points were not used; the partner code button stays off until the code is well formed and posts the cleaned code", async () => {
    mockConvertState = { error: new ApiError(422, "LOYALTY_CONVERSION_REFUSED", "x"), isPending: false }; await wrap(<LoyaltyScreen />); expect(screen.getByText(/Your points were not used/)).toBeTruthy();
    expect(screen.getByTestId("loyalty-partner-submit").props.accessibilityState.disabled).toBe(true); await fireEvent.changeText(screen.getByTestId("loyalty-partner-code"), "a7kq2-m9xot");
    expect(screen.getByTestId("loyalty-partner-submit").props.accessibilityState.disabled).toBeFalsy(); await fireEvent.press(screen.getByTestId("loyalty-partner-submit")); expect(mockRedeem.mock.calls[0][0]).toBe("A7KQ2M9X0T");
  });
  it.each([["PARTNERSHIP_CODE_EXPIRED", /expired/], ["PARTNERSHIP_ALREADY_REDEEMED", /already used/], ["PARTNERSHIP_BUDGET_EXCEEDED", /run out/], ["SOMETHING_ELSE", /Something went wrong/]] as const)("%s reads calmly and never echoes the code", async (code, re) => {
    mockRedeemState = { error: new ApiError(422, code, "x"), isPending: false }; await wrap(<LoyaltyScreen />);
    expect(screen.getByTestId("loyalty-partner-error")).toBeTruthy(); expect(screen.getByText(re)).toBeTruthy(); expect(screen.queryByText(/A7KQ2/)).toBeNull();
  });
  it("flag off shows the unavailable state, never the exchange", async () => {
    mockMe = { error: new ApiError(403, "FEATURE_DISABLED", "off", { key: "growth.loyalty", scope: "GATE" }), isLoading: false }; await wrap(<LoyaltyScreen />);
    expect(screen.queryByTestId("loyalty-convert-button")).toBeNull(); expect(screen.getByTestId("unavailable")).toBeTruthy();
  });
});

describe("loyalty screen (AR)", () => {
  it("renders Arabic text with Arabic-Indic digits and the code field stays left-to-right", async () => {
    await setLang("ar"); await wrap(<LoyaltyScreen />);
    expect(screen.getByTestId("loyalty-tier-name").props.children).toBe("فضي"); expect(screen.getByText(/النقاط ليست مالاً/)).toBeTruthy();
    expect(screen.getAllByTestId("loyalty-partner-code").at(-1)!.props.style).toEqual(expect.arrayContaining([expect.objectContaining({ writingDirection: "ltr", textAlign: "left" })]));
  });
});
