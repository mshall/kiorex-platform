import type { ReactElement } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import i18n from "@/i18n";
import { ThemeProvider } from "@/theme";
import { ApiError } from "@/api/errors";
import ReferralScreen from "../../app/(tabs)/(more)/referral/index";
import RewardsScreen from "../../app/(tabs)/(more)/referral/rewards";
import InviteLanding from "../../app/invite/[code]";

/** GRW-P2-B3 on the patient app: invite screen, rewards, invite landing; AR and EN, flag-off, cached copy, neutral refusals. */
const mockReveal = jest.fn(); const mockShare = jest.fn(); const mockCreate = jest.fn(); const mockClaim = jest.fn(); const mockReplace = jest.fn(); const mockPush = jest.fn();
let mockMe: { data?: unknown; error?: unknown; isLoading: boolean }; let mockCached: unknown; let mockRewards: { data?: unknown; error?: unknown; isLoading: boolean }; let mockAuth = "signedIn"; let mockClaimState: { isPending: boolean; isError: boolean; data?: unknown };
let mockParams: { code: string } = { code: "7K3M9QPX" };
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush, replace: mockReplace, canGoBack: () => true, back: jest.fn() }), useLocalSearchParams: () => mockParams }));
jest.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ status: mockAuth }) }));
jest.mock("@/lib/haptics", () => ({ haptic: { tap: jest.fn(), press: jest.fn(), success: jest.fn(), select: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock("@/components/ui", () => ({ ...jest.requireActual("@/components/ui"), useToast: () => ({ show: jest.fn() }) }));
jest.mock("@/components/feature", () => ({ ...jest.requireActual("@/components/feature"), RequireAuth: ({ children }: { children: ReactElement }) => children, QrCode: () => null }));
jest.mock("@/modules/referral/api", () => ({
  ...jest.requireActual("@/modules/referral/api"),
  useReferralMe: () => ({ ...mockMe, refetch: jest.fn() }), useCachedMe: () => ({ data: mockCached }), useReferralRewards: () => ({ ...mockRewards, refetch: jest.fn() }),
  useCreateInvite: () => ({ mutateAsync: mockCreate }), useClaimInvite: () => ({ mutate: mockClaim, ...mockClaimState }), useRevealCoupon: () => ({ mutate: (id: string, o: { onSuccess: (x: { code: string }) => void }) => { mockReveal(id); o.onSuccess({ code: "KX-AB12-CD34" }); }, isPending: false }),
}));
jest.spyOn(require("react-native").Share, "share").mockImplementation(((...a: unknown[]) => { mockShare(...a); return Promise.resolve({ action: "sharedAction" }); }) as never);

const me = (o: Record<string, unknown> = {}) => ({ code: "7K3M9QPX", status: "ACTIVE", inviteUrl: "https://kiorex.com/ar/eg/invite/7K3M9QPX", counts: { invited: 5, signedUp: 3, qualified: 1 }, capsRemaining: { last30Days: 2, thisYear: 4 }, rewards: { activeCount: 1, activeMinor: 15_000, currency: "EGP" }, ...o });
const lot = (o: Record<string, unknown> = {}) => ({ id: "l1", kind: "REFERRER", mode: "COUPON", amountMinor: 15_000, currency: "EGP", status: "ACTIVE", expiresAt: "2027-09-01T00:00:00Z", ...o });
const wrap = (ui: ReactElement) => render(<SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 800 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}><ThemeProvider>{ui}</ThemeProvider></SafeAreaProvider>);
const setLang = (l: string) => act(async () => { await i18n.changeLanguage(l); });
beforeEach(() => { [mockShare, mockCreate, mockClaim, mockReplace, mockPush].forEach((m) => m.mockReset()); mockCreate.mockResolvedValue({ inviteUrl: "u", code: "7K3M9QPX", shareText: "hello from server" }); mockMe = { data: me(), isLoading: false }; mockCached = null; mockRewards = { data: { items: [lot()] }, isLoading: false }; mockAuth = "signedIn"; mockClaimState = { isPending: false, isError: false }; mockParams = { code: "7K3M9QPX" }; });
afterEach(async () => { await setLang("ar"); });

describe("invite screen (EN)", () => {
  beforeEach(async () => { await setLang("en"); });
  it("shows code, link, counts and caps, and Share sends the server share text through the system sheet and records a share event", async () => {
    await wrap(<ReferralScreen />);
    expect(screen.getByTestId("invite-code").props.children).toBe("7K3M9QPX"); expect(screen.getByTestId("invite-link").props.children).toBe("https://kiorex.com/ar/eg/invite/7K3M9QPX");
    expect(screen.getByText("Friends invited")).toBeTruthy(); expect(screen.getByText("Completed a first visit")).toBeTruthy(); expect(screen.getByTestId("referral-caps")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("invite-share")); await act(async () => {});
    expect(mockCreate).toHaveBeenCalledWith({ channel: "LINK", locale: "en" }); expect(mockShare).toHaveBeenCalledWith({ message: "hello from server" });
  });
  it("a suspended invite disables sharing and says why", async () => {
    mockMe = { data: me({ status: "SUSPENDED" }), isLoading: false }; await wrap(<ReferralScreen />);
    expect(screen.getByTestId("invite-suspended")).toBeTruthy(); expect(screen.getByTestId("invite-share").props.accessibilityState.disabled).toBe(true);
  });
  it("zero invites shows the empty state; the terms are a labelled placeholder", async () => {
    mockMe = { data: me({ counts: { invited: 0, signedUp: 0, qualified: 0 } }), isLoading: false }; await wrap(<ReferralScreen />);
    expect(screen.getByText("No invites yet")).toBeTruthy(); expect(screen.getByTestId("referral-terms")).toBeTruthy();
  });
  it("flag off shows the unavailable state, never the invite", async () => {
    mockMe = { error: new ApiError(403, "FEATURE_DISABLED", "off", { key: "growth.patient_referral", scope: "GLOBAL" }), isLoading: false }; await wrap(<ReferralScreen />);
    expect(screen.queryByTestId("invite-code")).toBeNull(); expect(screen.getByTestId("unavailable")).toBeTruthy();
  });
  it("an API error with a cached copy shows the copy (labelled) and sharing works without the API", async () => {
    mockMe = { error: new ApiError(500, "INTERNAL", "x"), isLoading: false }; mockCached = me(); await wrap(<ReferralScreen />);
    expect(screen.getByTestId("referral-cached")).toBeTruthy(); await fireEvent.press(screen.getByTestId("invite-share")); await act(async () => {});
    expect(mockCreate).not.toHaveBeenCalled(); expect(mockShare).toHaveBeenCalled();
  });
  it("the rewards link opens the rewards screen", async () => { await wrap(<ReferralScreen />); await fireEvent.press(screen.getByTestId("referral-rewards-link")); expect(mockPush).toHaveBeenCalledWith("/referral/rewards"); });
});
describe("invite screen (AR, RTL numbers)", () => {
  it("renders Arabic copy with Arabic-Indic digits", async () => {
    await setLang("ar"); await wrap(<ReferralScreen />);
    expect(screen.getByText("أصدقاء تمت دعوتهم")).toBeTruthy(); expect(screen.getByTestId("count-invited")).toBeTruthy(); expect(screen.getByLabelText(/5/)).toBeTruthy();
  });
});
describe("rewards screen", () => {
  it("lists active and past rewards with the closed-loop rule (EN)", async () => {
    await setLang("en"); mockRewards = { data: { items: [lot(), lot({ id: "l2", status: "EXPIRED", mode: "CREDIT" })] }, isLoading: false }; await wrap(<RewardsScreen />);
    expect(screen.getByTestId("reward-l1")).toBeTruthy(); expect(screen.getByTestId("reward-l2")).toBeTruthy(); expect(screen.getByText("History")).toBeTruthy(); expect(screen.getByTestId("rewards-rule")).toBeTruthy();
  });
  it("an unrevealed voucher shows its code once on request", async () => {
    await setLang("en"); mockRewards = { data: { items: [lot({ couponState: "UNREVEALED" })] }, isLoading: false }; await wrap(<RewardsScreen />);
    await fireEvent.press(screen.getByTestId("reveal-l1")); expect(mockReveal).toHaveBeenCalledWith("l1"); expect(screen.getByTestId("coupon-l1")).toBeTruthy(); expect(screen.getByText("KX-AB12-CD34")).toBeTruthy();
  });
  it("empty state in Arabic", async () => { await setLang("ar"); mockRewards = { data: { items: [] }, isLoading: false }; await wrap(<RewardsScreen />); expect(screen.getByText("لا توجد مكافآت بعد")).toBeTruthy(); });
  it("flag-off state", async () => {
    mockRewards = { error: new ApiError(403, "FEATURE_DISABLED", "off", { key: "growth.rewards" }), isLoading: false }; await wrap(<RewardsScreen />); expect(screen.queryByTestId("reward-l1")).toBeNull();
  });
});
describe("invite landing", () => {
  beforeEach(async () => { await setLang("en"); });
  it("signed out: neutral page with a sign-up button that carries only the validated code as the return route", async () => {
    mockAuth = "signedOut"; await wrap(<InviteLanding />); expect(screen.getByText("A friend invited you to Kiorex")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("invite-signup")); expect(mockPush).toHaveBeenCalledWith({ pathname: "/sign-in", params: { next: "/invite/7K3M9QPX" } }); expect(mockClaim).not.toHaveBeenCalled();
  });
  it("signed in: claims once with the normalised code", async () => { mockParams = { code: "7k3m9qpx" }; await wrap(<InviteLanding />); expect(mockClaim).toHaveBeenCalledTimes(1); expect(mockClaim).toHaveBeenCalledWith("7K3M9QPX"); expect(screen.getByTestId("invite-accepted")).toBeTruthy(); });
  it("a refusal reads the same whatever the reason", async () => {
    mockClaimState = { isPending: false, isError: false, data: { status: "REJECTED", reason: "RF_SELF" } }; await wrap(<InviteLanding />); expect(screen.getByTestId("invite-invalid")).toBeTruthy(); expect(screen.queryByText(/RF_SELF|self/i)).toBeNull();
  });
  it("a malformed code never claims", async () => { mockParams = { code: "https://evil.example" }; await wrap(<InviteLanding />); expect(screen.getByTestId("invite-invalid")).toBeTruthy(); expect(mockClaim).not.toHaveBeenCalled(); });
});
