import type { ReactElement } from "react";
import { Linking } from "react-native";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import i18n from "@/i18n";
import { ThemeProvider } from "@/theme";
import { ServiceCards, WhatsAppCard } from "@/components/ServiceCards";
import { SERVICE_CARDS, availability, whatsappUrl } from "@/lib/services";

const mockPush = jest.fn();
let mockFlags: Record<string, { enabled: boolean; scope?: string; reason?: string }> = {};
jest.mock("expo-router", () => ({ useRouter: () => ({ push: (...a: unknown[]) => mockPush(...a) }) }));
jest.mock("@/api/hooks", () => ({ useFlags: () => ({ data: { market: "EG", flags: mockFlags }, isLoading: false }) }));
const setLang = (l: string) => act(async () => { await i18n.changeLanguage(l); });
const wrap = (ui: ReactElement) => render(<SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 800 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}><ThemeProvider>{ui}</ThemeProvider></SafeAreaProvider>);

beforeEach(() => { mockPush.mockReset(); mockFlags = {}; });
afterEach(async () => { await setLang("ar"); });

describe("services helpers", () => {
  it("whatsappUrl keeps digits only and rejects unset / implausible numbers", () => {
    expect(whatsappUrl("+20 100 123 4567")).toBe("https://wa.me/201001234567");
    expect(whatsappUrl(undefined)).toBeNull();
    expect(whatsappUrl("")).toBeNull();
    expect(whatsappUrl("abc")).toBeNull();
    expect(whatsappUrl("123")).toBeNull();
  });
  it("availability distinguishes available / awaiting approval / paused", () => {
    expect(availability({ enabled: true })).toBe("available");
    expect(availability({ enabled: false, awaiting: true })).toBe("awaiting");
    expect(availability({ enabled: false })).toBe("paused");
  });
  it("covers the five web service cards", () => { expect(SERVICE_CARDS.map((c) => c.id)).toEqual(["telemedicine", "pharmacy", "lab", "safety", "reminders"]); });
});

describe("service cards (EN)", () => {
  it("shows availability badges from the flag API and opens the service", async () => {
    await setLang("en");
    mockFlags = { "kiorex.pharmacy_orders": { enabled: false, scope: "GATE", reason: "AWAITING_GATE" }, "kiorex.lab_bookings": { enabled: false, scope: "GLOBAL" } };
    await wrap(<ServiceCards />);
    expect(screen.getByText("Pharmacy")).toBeTruthy();
    expect(screen.getByTestId("svc-pharmacy-badge")).toHaveTextContent("Awaiting approval");
    expect(screen.getByTestId("svc-lab-badge")).toHaveTextContent("Temporarily unavailable");
    expect(screen.getByTestId("svc-telemedicine-badge")).toHaveTextContent("Available");
    await fireEvent.press(screen.getByTestId("svc-lab"));
    expect(mockPush).toHaveBeenCalledWith("/lab");
    expect(screen.getByTestId("svc-lab").props.accessibilityLabel).toMatch(/Lab tests\..*Temporarily unavailable/);
  });
});

describe("WhatsApp booking card", () => {
  it("opens wa.me only when the number is configured", async () => {
    await setLang("en");
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined as never);
    await wrap(<WhatsAppCard number="+20 100 123 4567" />);
    expect(screen.getByText("Book on WhatsApp")).toBeTruthy();
    expect(screen.getByTestId("whatsapp-privacy")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("whatsapp-link"));
    expect(open).toHaveBeenCalledWith("https://wa.me/201001234567");
    open.mockRestore();
  });
  it("shows the 'announced at launch' note and no link without a number", async () => {
    await setLang("en");
    await wrap(<WhatsAppCard number={undefined} />);
    expect(screen.queryByTestId("whatsapp-link")).toBeNull();
    expect(screen.getByTestId("whatsapp-soon")).toBeTruthy();
  });
  it("hides the action when the flag is off", async () => {
    mockFlags = { "kiorex.whatsapp_booking": { enabled: false } };
    await wrap(<WhatsAppCard number="201001234567" />);
    expect(screen.queryByTestId("whatsapp-link")).toBeNull();
    expect(screen.getByTestId("whatsapp-badge")).toHaveTextContent("غير متاحة مؤقتًا");
  });
  it("renders Arabic copy", async () => {
    await wrap(<WhatsAppCard number="201001234567" />);
    expect(screen.getByText("احجز عبر واتساب")).toBeTruthy();
    expect(screen.getByLabelText("افتح واتساب")).toBeTruthy();
  });
});
