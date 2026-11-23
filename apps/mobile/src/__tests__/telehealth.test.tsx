import type { ReactElement } from "react";
import fs from "node:fs";
import path from "node:path";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import i18n from "@/i18n";
import { ThemeProvider } from "@/theme";
import { TelehealthVisit } from "@/components/TelehealthVisit";
import { canJoin, isWebUrl, sameOrigin, telehealthPhase, WEBVIEW_MEDIA_PROPS, ANDROID_MEDIA_PERMISSIONS, type Telehealth } from "@/lib/telehealth";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: (...a: unknown[]) => mockPush(...a) }) }));
const wrap = (ui: ReactElement) => render(<SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 800 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}><ThemeProvider>{ui}</ThemeProvider></SafeAreaProvider>);
const min = (m: number) => new Date(Date.now() + m * 60_000).toISOString();
const tv = (over: Partial<Telehealth> = {}): Telehealth => ({ sessionId: "ths_1", state: "SCHEDULED", joinUrl: "https://clinic.example.test/v/tok", opensAt: min(-5), closesAt: min(120), movedFrom: null, ...over });

beforeEach(async () => { mockPush.mockReset(); await act(async () => { await i18n.changeLanguage("en"); }); });
afterAll(async () => { await act(async () => { await i18n.changeLanguage("ar"); }); });

describe("Clinic-owned video visit helpers", () => {
  it("phases follow state, link and join window", () => {
    expect(telehealthPhase(tv({ opensAt: min(30) }))).toBe("beforeWindow");
    expect(telehealthPhase(tv())).toBe("open");
    expect(telehealthPhase(tv({ state: "LIVE" }))).toBe("live");
    expect(telehealthPhase(tv({ closesAt: min(-1) }))).toBe("windowPassed");
    expect(telehealthPhase(tv({ state: "IN_PERSON", joinUrl: null }))).toBe("inPerson");
    expect(telehealthPhase(tv({ state: "CANCELLED", joinUrl: null }))).toBe("cancelled");
    expect(telehealthPhase(tv({ state: "ENDED", joinUrl: null }))).toBe("ended");
    expect(telehealthPhase(tv({ state: "MISSED", joinUrl: null }))).toBe("missed");
    expect(telehealthPhase(tv({ joinUrl: null }))).toBe("noLink");
    expect(canJoin("open") && canJoin("live") && !canJoin("beforeWindow")).toBe(true);
  });
  it("the WebView stays on the Clinic origin; only http(s) links are accepted", () => {
    expect(sameOrigin("https://clinic.example.test/v/tok/room", "https://clinic.example.test/v/tok")).toBe(true);
    expect(sameOrigin("https://evil.example/x", "https://clinic.example.test/v/tok")).toBe(false);
    expect(sameOrigin("not a url", "https://clinic.example.test/v/tok")).toBe(false);
    expect(isWebUrl("https://a.test/x")).toBe(true);
    expect(isWebUrl("javascript:alert(1)")).toBe(false);
    expect(isWebUrl(null)).toBe(false);
  });
  it("WebView media settings allow inline autoplaying camera/microphone calls", () => {
    expect(WEBVIEW_MEDIA_PROPS).toMatchObject({ allowsInlineMediaPlayback: true, mediaPlaybackRequiresUserAction: false, javaScriptEnabled: true, setSupportMultipleWindows: false, incognito: true });
    expect(WEBVIEW_MEDIA_PROPS.mediaCapturePermissionGrantType).toBe("grant");
  });
});

describe("native camera / microphone configuration", () => {
  const appJson = JSON.parse(fs.readFileSync(path.join(__dirname, "../../app.json"), "utf8")).expo;
  it("iOS has camera + microphone usage strings (also localised AR/EN); Android declares CAMERA and RECORD_AUDIO", () => {
    expect(appJson.ios.infoPlist.NSCameraUsageDescription).toMatch(/camera/i);
    expect(appJson.ios.infoPlist.NSMicrophoneUsageDescription).toMatch(/microphone/i);
    for (const l of ["ar", "en"]) {
      const d = JSON.parse(fs.readFileSync(path.join(__dirname, `../i18n/infoplist/${l}.json`), "utf8"));
      expect(d.NSCameraUsageDescription?.length).toBeGreaterThan(10); expect(d.NSMicrophoneUsageDescription?.length).toBeGreaterThan(10);
    }
    expect(appJson.android.permissions).toEqual(expect.arrayContaining(["CAMERA", "RECORD_AUDIO"]));
    expect(ANDROID_MEDIA_PERMISSIONS).toEqual(["android.permission.CAMERA", "android.permission.RECORD_AUDIO"]);
  });
  it("react-native-webview is a dependency and the join screen is registered", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "../../package.json"), "utf8"));
    expect(pkg.dependencies["react-native-webview"]).toBeTruthy();
    expect(fs.existsSync(path.join(__dirname, "../../app/telemedicine/join/[bookingId].tsx"))).toBe(true);
    expect(fs.readFileSync(path.join(__dirname, "../../app/_layout.tsx"), "utf8")).toContain("telemedicine/join/[bookingId]");
  });
});

describe("TelehealthVisit card", () => {
  it("open window: Join video visit routes to the in-app WebView screen", async () => {
    await wrap(<TelehealthVisit bookingId="kx_bk_1" telehealth={tv()} />);
    await fireEvent.press(screen.getByTestId("join-video-visit"));
    expect(mockPush).toHaveBeenCalledWith("/telemedicine/join/kx_bk_1");
    expect(screen.getByText("Join video visit")).toBeTruthy();
  });
  it("before the window: countdown shown and the button is disabled", async () => {
    await wrap(<TelehealthVisit bookingId="kx_bk_1" telehealth={tv({ opensAt: min(30), closesAt: min(150) })} />);
    expect(screen.getByTestId("telehealth-countdown")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("join-video-visit"));
    expect(mockPush).not.toHaveBeenCalled();
  });
  it("moved / in-person / cancelled states", async () => {
    const a = await wrap(<TelehealthVisit bookingId="b" telehealth={tv({ movedFrom: min(-1000) })} />);
    expect(screen.getByTestId("telehealth-moved")).toBeTruthy(); await a.unmount();
    const b = await wrap(<TelehealthVisit bookingId="b" telehealth={tv({ state: "IN_PERSON", joinUrl: null })} />);
    expect(screen.getByTestId("telehealth-note")).toBeTruthy(); expect(screen.queryByTestId("join-video-visit")).toBeNull(); await b.unmount();
    await wrap(<TelehealthVisit bookingId="b" telehealth={tv({ state: "CANCELLED", joinUrl: null })} />);
    expect(screen.queryByTestId("join-video-visit")).toBeNull();
  });
  it("renders in Arabic", async () => {
    await act(async () => { await i18n.changeLanguage("ar"); });
    await wrap(<TelehealthVisit bookingId="b" telehealth={tv()} />);
    expect(screen.getByText("انضم إلى الزيارة بالفيديو")).toBeTruthy();
  });
});
