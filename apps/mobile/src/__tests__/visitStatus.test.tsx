import type { ReactElement } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import i18n from "@/i18n";
import { ThemeProvider } from "@/theme";
import { ApiError } from "@/api/errors";
import { isValidToken, toVisitView } from "@/lib/visitStatus";
import { VisitStepsTimeline } from "@/components/VisitStepsTimeline";
import VisitStatusScreen from "../../app/visit-status/[token]";

let mockQuery: Record<string, unknown> = {};
const mockStop = jest.fn();
let mockStopState: Record<string, unknown> = { isPending: false, isSuccess: false };
let mockToken: string | string[] = "tok_1234567890";
jest.mock("expo-router", () => ({ Stack: { Screen: () => null }, useLocalSearchParams: () => ({ token: mockToken }), useRouter: () => ({ push: jest.fn() }) }));
jest.mock("@/api/visitStatus", () => ({ usePublicVisitStatus: () => mockQuery, useStopVisitStatus: () => ({ mutate: (...a: unknown[]) => mockStop(...a), ...mockStopState }) }));
const setLang = (l: string) => act(async () => { await i18n.changeLanguage(l); });
const wrap = (ui: ReactElement) => render(<SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 800 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}><ThemeProvider>{ui}</ThemeProvider></SafeAreaProvider>);

const raw = { patientFirstName: "Youssef", startsAt: "2030-01-05T10:00:00Z", subState: null, stopped: false, status: "ON_THE_WAY",
  steps: [{ key: "CONFIRMED", reached: true, at: "2030-01-05T08:00:00Z" }, { key: "ON_THE_WAY", reached: true, at: null }, { key: "ARRIVED", reached: false, at: null }],
  eta: { shared: true, minutes: 18 }, provider: { displayName: "Nurse Heba", phone: "+201000000000" },
  // hostile extras that must never render
  address: "12 Secret St", fee: 450, phone: "+201111111111", reason: "chest pain" };

beforeEach(() => { mockStop.mockReset(); mockStopState = { isPending: false, isSuccess: false }; mockToken = "tok_1234567890"; mockQuery = { isLoading: false, error: null, data: toVisitView(raw as never), refetch: jest.fn() }; });
afterEach(async () => { await setLang("ar"); });

describe("toVisitView", () => {
  it("whitelists fields: address, fee, phone and reason cannot pass through", () => {
    const v = toVisitView(raw as never);
    expect(Object.keys(v).sort()).toEqual(["etaMinutes", "firstName", "providerName", "startsAt", "steps", "stopped"]);
    expect(JSON.stringify(v)).not.toMatch(/Secret|450|\+2010|chest/);
    expect(v.etaMinutes).toBe(18);
  });
  it("hides ETA and provider when stopped or ETA not shared", () => {
    expect(toVisitView({ ...raw, stopped: true } as never)).toMatchObject({ etaMinutes: null, providerName: null });
    expect(toVisitView({ ...raw, eta: { shared: false, minutes: 5 } } as never).etaMinutes).toBeNull();
  });
  it("validates tokens", () => { expect(isValidToken("tok_1234567890")).toBe(true); expect(isValidToken("../x")).toBe(false); expect(isValidToken(undefined)).toBe(false); });
});

describe("visit-status screen", () => {
  it("renders steps, ETA, provider and the privacy note (EN) and never address/fee/phone/reason", async () => {
    await setLang("en");
    await wrap(<VisitStatusScreen />);
    expect(screen.getByText("Youssef's home visit")).toBeTruthy();
    expect(screen.getByTestId("family-eta")).toHaveTextContent("About 18 min away");
    expect(screen.getByText("Your family member's visit is with Nurse Heba.")).toBeTruthy();
    expect(screen.getByTestId("family-step-ON_THE_WAY")).toBeTruthy();
    expect(screen.getByTestId("family-step-ARRIVED").props.accessibilityLabel).toBe("Arrived, not yet");
    expect(screen.queryByText(/Secret|450|\+2010|\+2011|chest/)).toBeNull();
    expect(screen.getByTestId("family-privacy")).toBeTruthy();
  });
  it("stop button calls the stop mutation", async () => {
    await setLang("en");
    await wrap(<VisitStatusScreen />);
    await fireEvent.press(screen.getByTestId("family-stop"));
    expect(mockStop).toHaveBeenCalled();
  });
  it("shows the confirmation after stopping instead of the button", async () => {
    await setLang("en");
    mockStopState = { isPending: false, isSuccess: true };
    await wrap(<VisitStatusScreen />);
    expect(screen.queryByTestId("family-stop")).toBeNull();
    expect(screen.getByTestId("family-stop-done")).toBeTruthy();
  });
  it("stopped visit shows the neutral banner only", async () => {
    await setLang("en");
    mockQuery = { ...mockQuery, data: toVisitView({ ...raw, stopped: true } as never) };
    await wrap(<VisitStatusScreen />);
    expect(screen.getByTestId("family-stopped")).toBeTruthy();
    expect(screen.queryByTestId("family-stop")).toBeNull();
    expect(screen.queryByTestId("family-provider")).toBeNull();
  });
  it("404 shows the gone state", async () => {
    await setLang("en");
    mockQuery = { isLoading: false, data: undefined, error: new ApiError(404, "NOT_FOUND", "x"), refetch: jest.fn() };
    await wrap(<VisitStatusScreen />);
    expect(screen.getByText("This link is no longer active")).toBeTruthy();
    expect(screen.queryByTestId("family-stop")).toBeNull();
  });
  it("a malformed token shows the gone state without querying", async () => {
    await setLang("en");
    mockToken = "../etc";
    await wrap(<VisitStatusScreen />);
    expect(screen.getByText("This link is no longer active")).toBeTruthy();
  });
  it("renders Arabic", async () => {
    await wrap(<VisitStatusScreen />);
    expect(screen.getByText("زيارة Youssef المنزلية")).toBeTruthy();
    expect(screen.getByText("إيقاف هذه التحديثات")).toBeTruthy();
    expect(screen.getByTestId("family-eta")).toHaveTextContent("على بُعد حوالي 18 دقيقة");
  });
});

describe("VisitStepsTimeline", () => {
  it("labels each step with its state for screen readers", async () => {
    await setLang("en");
    await wrap(<VisitStepsTimeline steps={[{ key: "CONFIRMED", reached: true, at: null }, { key: "FINISHED", reached: false, at: null }]} />);
    expect(screen.getByTestId("family-step-CONFIRMED").props.accessibilityLabel).toBe("Confirmed, done");
    expect(screen.getByTestId("family-step-FINISHED").props.accessibilityLabel).toBe("Finished, not yet");
  });
});

describe("mock API for the public link", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const call = (method: string, path: string) => require("@/mocks/mockFetch").mockFetch(new Request(`http://x/api/v1${path}`, { method }));
  it("serves a status, a gone (404) link and a stop", async () => {
    const ok = await call("GET", "/public/visit-status/tok_1234567890"); expect(ok.status).toBe(200);
    const body = await ok.json(); expect(Object.keys(body)).not.toEqual(expect.arrayContaining(["address", "fee", "phone", "reason"]));
    expect((await call("GET", "/public/visit-status/gone-token")).status).toBe(404);
    expect((await call("POST", "/public/visit-status/tok_1234567890/stop")).status).toBe(200);
    expect((await (await call("GET", "/public/visit-status/tok_1234567890")).json()).stopped).toBe(true);
  });
});
