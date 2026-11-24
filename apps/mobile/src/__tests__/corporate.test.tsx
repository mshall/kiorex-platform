import type { ReactElement } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import i18n from "@/i18n";
import { ThemeProvider } from "@/theme";
import { ApiError } from "@/api/errors";
import CorporateScreen from "../../app/(tabs)/(more)/corporate/index";
import { cleanCorporateCode } from "@/modules/corporate/api";

/** GRW-P4-C on the patient app: join with a code or a verified e-mail, my allowance (usage, never a cash balance), leave; AR and EN, flag off, calm errors. */
const mockJoin = jest.fn(); const mockLeave = jest.fn();
let mockMe: { data?: unknown; error?: unknown; isLoading: boolean }; let mockJoinState: { error?: unknown; isPending: boolean };
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn(), canGoBack: () => true, back: jest.fn() }) }));
jest.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ status: "signedIn" }) }));
jest.mock("@/lib/haptics", () => ({ haptic: { tap: jest.fn(), press: jest.fn(), success: jest.fn(), select: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock("@/components/feature", () => ({ ...jest.requireActual("@/components/feature"), RequireAuth: ({ children }: { children: ReactElement }) => children }));
jest.mock("@/modules/corporate/api", () => ({
  ...jest.requireActual("@/modules/corporate/api"),
  useCorporateMe: () => ({ ...mockMe, refetch: jest.fn() }), useJoinCorporate: () => ({ mutate: mockJoin, ...mockJoinState }), useLeaveCorporate: () => ({ mutate: mockLeave, isPending: false }),
}));
const member = (o: Record<string, unknown> = {}) => ({ member: true, verifiedBy: "CODE", enrolledAt: "2027-02-01T00:00:00Z", programme: { sponsor: "Nile Logistics", endsAt: "2027-12-31T00:00:00Z", currency: "EGP" }, allowance: { capMinor: 30_000, usedMinor: 10_000, heldMinor: 5_000, remainingMinor: 15_000 }, ...o });
const wrap = (ui: ReactElement) => render(<SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 800 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}><ThemeProvider>{ui}</ThemeProvider></SafeAreaProvider>);
const setLang = (l: string) => act(async () => { await i18n.changeLanguage(l); });
const flat = (o: unknown, p = ""): string[] => (o && typeof o === "object" ? Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => flat(v, p ? `${p}.${k}` : k)) : [p]);
beforeEach(async () => { mockJoin.mockReset(); mockLeave.mockReset(); mockMe = { data: { member: false }, isLoading: false }; mockJoinState = { isPending: false }; await setLang("en"); });
afterEach(async () => { await setLang("ar"); });

describe("corporate strings and code rule", () => {
  it("English and Arabic carry the same corporate keys", () => {
    const en = i18n.getResourceBundle("en", "translation").corporate; const ar = i18n.getResourceBundle("ar", "translation").corporate;
    expect(flat(en).filter((k) => !flat(ar).includes(k))).toEqual([]); expect(flat(ar).filter((k) => !flat(en).includes(k))).toEqual([]);
  });
  it("cleans a code like the server", () => { expect(cleanCorporateCode("a7kq2-m9xot")).toBe("A7KQ2M9X0T"); expect(cleanCorporateCode("A7KQ2-M9X0U")).toBeNull(); expect(cleanCorporateCode("abc")).toBeNull(); });
});

describe("corporate screen (EN)", () => {
  it("the Join button stays off until the code is well formed, then posts the cleaned code", async () => {
    await wrap(<CorporateScreen />);
    expect(screen.getByTestId("corporate-submit").props.accessibilityState.disabled).toBe(true);
    await fireEvent.changeText(screen.getByTestId("corporate-code"), "a7kq2-m9xot");
    expect(screen.getByTestId("corporate-submit").props.accessibilityState.disabled).toBeFalsy();
    await fireEvent.press(screen.getByTestId("corporate-submit")); expect(mockJoin).toHaveBeenCalledWith("A7KQ2M9X0T");
  });
  it("the e-mail path posts no code", async () => { await wrap(<CorporateScreen />); await fireEvent.press(screen.getByTestId("corporate-email")); expect(mockJoin).toHaveBeenCalledWith(undefined); });
  it.each([["CORPORATE_CODE_EXPIRED", /expired/], ["CORPORATE_ALREADY_MEMBER", /already in/], ["CORPORATE_EMAIL_NOT_VERIFIED", /Verify your work e-mail/], ["SOMETHING_ELSE", /Something went wrong/]] as const)("%s reads calmly and never echoes the code", async (code, re) => {
    mockJoinState = { error: new ApiError(422, code, "x"), isPending: false }; await wrap(<CorporateScreen />);
    expect(screen.getByTestId("corporate-error")).toBeTruthy(); expect(screen.getByText(re)).toBeTruthy(); expect(screen.queryByText(/A7KQ2/)).toBeNull();
  });
  it("a member sees the sponsor, the end date and the allowance as usage (used and held together), the no-cash-value text, and the anonymity promise", async () => {
    mockMe = { data: member(), isLoading: false }; await wrap(<CorporateScreen />);
    expect(screen.getByText("You are in the Nile Logistics programme")).toBeTruthy(); expect(screen.getByTestId("corporate-allowance")).toBeTruthy();
    expect(screen.getByLabelText(/Your allowance: .*300/)).toBeTruthy(); expect(screen.getByLabelText(/Used or held: .*150/)).toBeTruthy(); expect(screen.getByLabelText(/Left: .*150/)).toBeTruthy();
    expect(screen.getByTestId("corporate-how").props.children).toMatch(/no cash value/i); expect(screen.getByTestId("corporate-privacy")).toBeTruthy();
  });
  it("leaving asks first, then leaves", async () => {
    mockMe = { data: member(), isLoading: false }; await wrap(<CorporateScreen />);
    await fireEvent.press(screen.getByTestId("corporate-leave")); expect(mockLeave).not.toHaveBeenCalled(); expect(screen.getByTestId("corporate-leave-confirm")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("corporate-leave-yes")); expect(mockLeave).toHaveBeenCalled();
  });
  it("flag off shows the unavailable state, never the form", async () => {
    mockMe = { error: new ApiError(403, "FEATURE_DISABLED", "off", { key: "growth.corporate", scope: "GATE" }), isLoading: false }; await wrap(<CorporateScreen />);
    expect(screen.queryByTestId("corporate-code")).toBeNull(); expect(screen.getByTestId("unavailable")).toBeTruthy();
  });
});

describe("corporate screen (AR)", () => {
  it("renders Arabic text, Arabic-Indic digits for the allowance and the code field stays left-to-right", async () => {
    await setLang("ar"); mockMe = { data: member(), isLoading: false }; await wrap(<CorporateScreen />);
    expect(screen.getByText("أنت في برنامج Nile Logistics")).toBeTruthy(); expect(screen.getByLabelText(/رصيدك المسموح: .*٣٠٠/)).toBeTruthy();
    mockMe = { data: { member: false }, isLoading: false }; await wrap(<CorporateScreen />);
    expect(screen.getAllByTestId("corporate-code").at(-1)!.props.style).toEqual(expect.arrayContaining([expect.objectContaining({ writingDirection: "ltr", textAlign: "left" })]));
  });
});
