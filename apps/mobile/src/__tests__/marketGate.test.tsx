import { act, render, screen } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import i18n from "@/i18n";
import { ThemeProvider } from "@/theme";
import { MarketGateBanner } from "@/components/feature";

let mockMarkets: { code: string; live: boolean; flag: string; state: string }[] | undefined;
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ status: "signedOut" }) }));
jest.mock("@/api/features", () => ({ useMarkets: () => ({ data: mockMarkets, isLoading: false }) }));
jest.mock("@/api/hooks", () => ({ useFlags: () => ({ data: { market: "EG", flags: {} } }), useMe: () => ({ data: undefined }) }));
const wrap = () => render(<SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 800 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}><ThemeProvider><MarketGateBanner /></ThemeProvider></SafeAreaProvider>);

describe("market launch gate (ADR-024)", () => {
  afterEach(async () => { await act(async () => { await i18n.changeLanguage("ar"); }); });
  it("market awaiting its gate shows an explanatory banner (EN)", async () => {
    await act(async () => { await i18n.changeLanguage("en"); });
    mockMarkets = [{ code: "EG", live: false, flag: "market.eg.live", state: "AWAITING_GATE" }];
    await wrap();
    expect(screen.getByTestId("market-gate")).toBeTruthy();
    expect(screen.getByText("Kiorex is not live in your market yet")).toBeTruthy();
  });
  it("Arabic copy", async () => {
    mockMarkets = [{ code: "EG", live: false, flag: "market.eg.live", state: "AWAITING_GATE" }];
    await wrap();
    expect(screen.getByText("كيوريكس لم يُطلق في سوقك بعد")).toBeTruthy();
  });
  it("live market (or unknown) renders nothing: fail open, the API still enforces", async () => {
    mockMarkets = [{ code: "EG", live: true, flag: "market.eg.live", state: "LIVE" }];
    await wrap();
    expect(screen.queryByTestId("market-gate")).toBeNull();
  });
});
