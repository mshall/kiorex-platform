import type { ReactElement } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import i18n from "@/i18n";
import { ThemeProvider } from "@/theme";
import { EmergencyBanner } from "@/components/EmergencyBanner";
import { StatusTimeline } from "@/components/StatusTimeline";
import { UnavailableState, ErrorState } from "@/components/states";
import { ApiError } from "@/api/errors";
import { SafeAreaProvider } from "react-native-safe-area-context";

const setLang = (l: string) => act(async () => { await i18n.changeLanguage(l); });
const wrap = (ui: ReactElement) => render(<SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 800 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}><ThemeProvider>{ui}</ThemeProvider></SafeAreaProvider>);

describe("EmergencyBanner (KX-16 H07)", () => {
  afterEach(async () => { await setLang("ar"); });
  it("shows 123 guidance in Arabic and calls the number", async () => {
    const onCall = jest.fn();
    await wrap(<EmergencyBanner onCall={onCall} />);
    expect(screen.getByTestId("emergency-banner")).toBeTruthy();
    expect(screen.getByText("يبدو أن هذه حالة طارئة")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("call-emergency"));
    expect(onCall).toHaveBeenCalledWith("123");
  });
  it("renders in English", async () => {
    await setLang("en");
    await wrap(<EmergencyBanner onCall={() => {}} />);
    expect(screen.getByText("This sounds like an emergency")).toBeTruthy();
    expect(screen.getByText("Call 123")).toBeTruthy();
  });
  it("offers no booking affordance", async () => {
    await wrap(<EmergencyBanner onCall={() => {}} />);
    expect(screen.queryByTestId("continue-booking")).toBeNull();
  });
});

describe("StatusTimeline (KX-03 §05)", () => {
  const booking = { timeline: [
    { status: "INTENT" as const, at: "2030-01-01T09:00:00Z" },
    { status: "HELD" as const, at: "2030-01-01T09:01:00Z" },
    { status: "PENDING_CLINIC" as const, at: "2030-01-01T09:03:00Z" },
    { status: "CONFIRMED" as const, at: "2030-01-01T09:30:00Z" },
  ] };
  it("lists reached states (skipping INTENT) with localized labels", async () => {
    await setLang("en");
    await wrap(<StatusTimeline booking={booking} />);
    expect(screen.getByText("Time held")).toBeTruthy();
    expect(screen.getByText("Waiting for the clinic")).toBeTruthy();
    expect(screen.getByText("Confirmed")).toBeTruthy();
    expect(screen.queryByText("Started")).toBeNull();
  });
  it("Arabic labels", async () => {
    await setLang("ar");
    await wrap(<StatusTimeline booking={booking} />);
    expect(screen.getByText(i18n.t("status.CONFIRMED"))).toBeTruthy();
  });
});

describe("feature flag OFF ⇒ temporarily unavailable (AR/EN)", () => {
  it("English", async () => {
    await setLang("en");
    await wrap(<UnavailableState featureKey="kiorex.marketplace" />);
    expect(screen.getByText("Temporarily unavailable")).toBeTruthy();
  });
  it("Arabic", async () => {
    await setLang("ar");
    await wrap(<UnavailableState />);
    expect(screen.getByTestId("unavailable")).toBeTruthy();
    expect(screen.queryByText("Temporarily unavailable")).toBeNull();
  });
  it("403 FEATURE_DISABLED from the API renders as unavailable, other errors as retryable", async () => {
    await setLang("en");
    const r = await wrap(<ErrorState error={new ApiError(403, "FEATURE_DISABLED", "off", { key: "kiorex.pay_deposits" })} />);
    expect(screen.getByTestId("unavailable")).toBeTruthy();
    r.unmount();
    const retry = jest.fn();
    await wrap(<ErrorState error={new ApiError(500, "X", "x")} onRetry={retry} />);
    await fireEvent.press(screen.getByText("Try again"));
    expect(retry).toHaveBeenCalled();
  });
});
