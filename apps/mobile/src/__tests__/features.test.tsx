import type { ReactElement } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import i18n from "@/i18n";
import { ThemeProvider } from "@/theme";
import { UnavailableState } from "@/components/states";
import { ChannelBadge, QrCode } from "@/components/feature";
import { RecordCard } from "@/components/RecordCard";
import { WaitlistJoin } from "@/components/WaitlistJoin";
import { flatten } from "@/lib/records";
import { blobToPicked, isAllowedMime, MAX_UPLOAD_BYTES } from "@/lib/files";
import { isTerminalOrder, labCancellable, orderTone, pharmacyCancellable } from "@/lib/orders";
import { mockFetch } from "@/mocks/mockFetch";

const setLang = (l: string) => act(async () => { await i18n.changeLanguage(l); });
const wrap = (ui: ReactElement) => render(<SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 800 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}><ThemeProvider>{ui}</ThemeProvider></SafeAreaProvider>);
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ status: "signedOut" }) }));
jest.mock("@/hooks/usePatient", () => ({ usePatient: () => ({ selected: undefined }) }));
jest.mock("@/api/features", () => ({ useJoinWaitlist: () => ({ mutate: jest.fn(), isPending: false }) }));

describe("awaiting-gate / flag-OFF states (AR + EN)", () => {
  afterEach(async () => { await setLang("ar"); });
  it("GATE scope explains launch approval, never a dead end", async () => {
    await setLang("en");
    await wrap(<UnavailableState featureKey="kiorex.pharmacy_orders" scope="GATE" />);
    expect(screen.getByText("Not available yet")).toBeTruthy();
    expect(screen.getByText(/waiting for its launch approval/)).toBeTruthy();
  });
  it("plain flag OFF keeps the 'temporarily unavailable' copy", async () => {
    await setLang("en");
    await wrap(<UnavailableState featureKey="kiorex.lab_bookings" scope="GLOBAL" />);
    expect(screen.getByText("Temporarily unavailable")).toBeTruthy();
  });
  it("renders in Arabic", async () => {
    await wrap(<UnavailableState scope="GATE" />);
    expect(screen.getByText("غير متاح بعد")).toBeTruthy();
  });
});

describe("booking channel badge", () => {
  it.each([["MARKETPLACE", "كيوريكس"], ["CLINIC_LINK", "رابط العيادة"], ["WHATSAPP", "واتساب"]] as const)("%s", async (c, label) => {
    await wrap(<ChannelBadge channel={c} />);
    expect(screen.getByTestId(`channel-${c}`)).toBeTruthy();
    expect(screen.getByText(label)).toBeTruthy();
  });
  it("renders nothing without a channel", async () => { await wrap(<ChannelBadge channel={undefined} />); expect(screen.queryByTestId(/channel-/)).toBeNull(); });
});

describe("records vault", () => {
  it("renders a prescription QR from the verification payload", async () => {
    await wrap(<QrCode value="https://kiorex.test/rx/verify?t=abc" />);
    expect(screen.getByTestId("qr-code")).toBeTruthy();
  });
  it("record card shows kind + source and opens on press", async () => {
    const onOpen = jest.fn();
    await wrap(<RecordCard onOpen={onOpen} r={{ id: "r1", kind: "LAB_RESULT", title: "CBC", source: "LAB", clinicId: null, dependantId: null, signedAt: "2030-01-01T10:00:00Z", hasFile: false, fileName: null, mimeType: null, sizeBytes: null, createdAt: "2030-01-01T10:00:00Z" }} />);
    expect(screen.getByText("من المعمل")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("record-r1"));
    expect(onOpen).toHaveBeenCalled();
  });
  it("flattens shared content to label/value rows", () => {
    expect(flatten({ assessment: "Rhinitis", vitals: { bp: "120/80", empty: null } })).toEqual([["assessment", "Rhinitis"], ["vitals · bp", "120/80"]]);
  });
  it("upload guards: only PDF/JPEG/PNG up to 5 MB", async () => {
    expect(isAllowedMime("application/pdf")).toBe(true);
    expect(isAllowedMime("application/zip")).toBe(false);
    expect(await blobToPicked(new Blob(["x"]), "a.zip", "application/zip")).toBe("type");
    expect(await blobToPicked({ size: MAX_UPLOAD_BYTES + 1 } as Blob, "a.pdf", "application/pdf")).toBe("size");
  });
});

describe("pharmacy / lab status helpers", () => {
  it("tones + cancel windows", () => {
    expect(orderTone("READY")).toBe("success"); expect(orderTone("REJECTED")).toBe("danger"); expect(orderTone("PENDING_PAYMENT")).toBe("warning");
    expect(pharmacyCancellable("SUBMITTED")).toBe(true); expect(pharmacyCancellable("READY")).toBe(false);
    expect(labCancellable("PAID")).toBe(true); expect(labCancellable("RESULT_RELEASED")).toBe(false);
    expect(isTerminalOrder("DISPENSED")).toBe(true);
  });
});

describe("waitlist join", () => {
  it("signed-out users are sent to sign in, not to a failing request", async () => {
    await wrap(<WaitlistJoin providerId="d1" typeId="t1" />);
    expect(screen.getByTestId("waitlist-card")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("join-waitlist"));
    expect(screen.queryByTestId("waitlist-sheet")).toBeNull();
  });
});

describe("offline mock mirrors the real wire for the new endpoints", () => {
  const call = (method: string, path: string, body?: unknown) => mockFetch(new Request(`http://x/api/v1${path}`, { method, ...(body ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}) }));
  it("vault rejects unsupported types and accepts a PNG", async () => {
    expect((await call("POST", "/me/vault/uploads", { fileName: "a.zip", mimeType: "application/zip", contentBase64: "eA==" })).status).toBe(400);
    expect((await call("POST", "/me/vault/uploads", { fileName: "a.png", mimeType: "image/png", contentBase64: "eA==" })).status).toBe(201);
  });
  it("waitlist accept returns a held booking (5-minute hold)", async () => {
    const wl = await (await call("GET", "/waitlist")).json();
    const offer = wl[0].offers[0];
    const r = await call("POST", `/waitlist/offers/${offer.id}/accept`);
    expect(r.status).toBe(200);
    expect((await r.json()).status).toBe("HELD");
  });
});
