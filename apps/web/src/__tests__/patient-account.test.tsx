import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/mocks/server";
import { renderApp } from "@/test/utils";
import NotificationsPage from "@/pages/NotificationsPage";
import AccountPage from "@/pages/AccountPage";
import RecordDetailPage from "@/pages/RecordDetailPage";
import { withSandboxReturn } from "@/lib/sandboxPay";
import { deviceLabel } from "@/lib/device";
import { localizeAddressSummary } from "@/lib/districts";
import { formatCountdown } from "@/lib/format";

const inbox = [
  { id: "n1", kind: "WAITLIST_OFFER", bookingId: null, body: "A slot opened with Dr Tamer", readAt: null, createdAt: new Date().toISOString() },
  { id: "n2", kind: "BOOKING_CONFIRMED", bookingId: "b1", body: "Confirmed", readAt: new Date().toISOString(), createdAt: new Date().toISOString() },
];
const prefs = (enabled = true) => (["WHATSAPP", "PUSH", "SMS", "EMAIL"] as const).map((channel) => ({ sub: "s", channel, enabled, quietStart: null, quietEnd: null }));

describe("notifications (KXM-NT-01/02)", () => {
  it("lists the inbox, marks one read and saves a channel opt-out", async () => {
    let read = "";
    let pref: { channel: string; body: unknown } | null = null;
    server.use(
      http.get("/api/v1/me/notifications", () => HttpResponse.json(inbox)),
      http.post("/api/v1/me/notifications/:id/read", ({ params }) => { read = String(params.id); return HttpResponse.json({ ok: true }); }),
      http.get("/api/v1/me/notification-preferences", () => HttpResponse.json(prefs())),
      http.put("/api/v1/me/notification-preferences/:channel", async ({ params, request }) => { pref = { channel: String(params.channel), body: await request.json() }; return HttpResponse.json({}); }),
    );
    renderApp(<NotificationsPage />, { lang: "en" });
    expect(await screen.findAllByTestId("notification")).toHaveLength(2);
    expect(screen.getByText("Waitlist offer")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Mark as read" }));
    await waitFor(() => expect(read).toBe("n1"));
    await userEvent.click(await screen.findByRole("switch", { name: "WhatsApp" }));
    await waitFor(() => expect(pref).toEqual({ channel: "WHATSAPP", body: { enabled: false } }));
  });
  it("shows an empty state in Arabic", async () => {
    server.use(http.get("/api/v1/me/notifications", () => HttpResponse.json([])), http.get("/api/v1/me/notification-preferences", () => HttpResponse.json(prefs())));
    renderApp(<NotificationsPage />, { lang: "ar" });
    expect(await screen.findByText("لا توجد إشعارات بعد")).toBeInTheDocument();
  });
});

describe("account: profile edit, data export, sign-out", () => {
  it("edits the profile, downloads the export and offers sign-out on every screen size", async () => {
    let body: Record<string, unknown> | null = null;
    let exported = false;
    server.use(
      http.put("/api/v1/me/profile", async ({ request }) => { body = (await request.json()) as Record<string, unknown>; return HttpResponse.json({}); }),
      http.post("/api/v1/me/export", () => { exported = true; return HttpResponse.json({ id: "x", generatedAt: new Date().toISOString(), profile: {}, dependants: [], consents: [] }); }),
    );
    URL.createObjectURL = () => "blob:x"; URL.revokeObjectURL = () => {};
    renderApp(<AccountPage />, { lang: "en" });
    expect(await screen.findByTestId("account-sign-out")).toBeInTheDocument();
    await userEvent.click(await screen.findByTestId("export-data"));
    await waitFor(() => expect(exported).toBe(true));
    await userEvent.click(await screen.findByTestId("edit-profile"));
    const en = await screen.findByLabelText("Name (English)");
    await userEvent.clear(en); await userEvent.type(en, "Amira S");
    await userEvent.type(screen.getByLabelText("Email"), "amira@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(body).toMatchObject({ nameEn: "Amira S", email: "amira@example.com", preferredLocale: "ar" }));
  });
});

describe("record detail: lab result", () => {
  it("shows a secure-link button instead of a raw field dump and hides internal ids", async () => {
    server.use(http.get("/api/v1/me/vault/:id", () => HttpResponse.json({ id: "r1", kind: "LAB_RESULT", title: "Lab report", source: "LAB", clinicId: "l1", dependantId: null, signedAt: new Date().toISOString(), hasFile: false, fileName: null, mimeType: null, sizeBytes: null, createdAt: new Date().toISOString(), report: { reportId: "rep_1", orderId: "o1", labId: "l1", reportVersion: 2, secureLink: "http://localhost:5193/r/abc" } })));
    renderApp(<Routes><Route path="/records/:id" element={<RecordDetailPage />} /></Routes>, { route: "/records/r1", lang: "en" });
    const a = await screen.findByTestId("lab-secure-link");
    expect(a).toHaveAttribute("href", "http://localhost:5193/r/abc");
    expect(a).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(screen.getByTestId("record-title")).toHaveTextContent("Lab result");
    expect(screen.queryByText("rep_1")).not.toBeInTheDocument();
    expect(screen.getByText("Report version 2")).toBeInTheDocument();
  });
  it("never links a non-http secure link", async () => {
    server.use(http.get("/api/v1/me/vault/:id", () => HttpResponse.json({ id: "r1", kind: "LAB_RESULT", title: null, source: "LAB", clinicId: "l1", dependantId: null, signedAt: null, hasFile: false, fileName: null, mimeType: null, sizeBytes: null, createdAt: new Date().toISOString(), report: { secureLink: "javascript:alert(1)" } })));
    renderApp(<Routes><Route path="/records/:id" element={<RecordDetailPage />} /></Routes>, { route: "/records/r1", lang: "en" });
    await screen.findByTestId("record-content");
    expect(screen.queryByTestId("lab-secure-link")).not.toBeInTheDocument();
  });
});

describe("sandbox payment return", () => {
  it("adds returnUrl to the sandbox checkout only", () => {
    expect(withSandboxReturn("http://localhost:4000/api/v1/pay/fake-checkout/pay_1", "http://localhost:5180/appointments/b1")).toBe("http://localhost:4000/api/v1/pay/fake-checkout/pay_1?returnUrl=http%3A%2F%2Flocalhost%3A5180%2Fappointments%2Fb1");
    expect(withSandboxReturn("https://pay.example.com/checkout/abc", "http://x")).toBe("https://pay.example.com/checkout/abc");
  });
});

describe("patient-facing formatting", () => {
  it("names a device instead of dumping the user agent", () => {
    expect(deviceLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/159.0 Safari/537.36")).toBe("Chrome · macOS");
    expect(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1")).toBe("Safari · iOS");
    expect(deviceLabel("node")).toBe("node");
  });
  it("localises district and governorate in the masked address summary but not the patient's own label", () => {
    expect(localizeAddressSummary("Home · heliopolis · Cairo", "ar")).toBe("Home · مصر الجديدة · القاهرة");
    expect(localizeAddressSummary("Home · nasr-city · Cairo", "en")).toBe("Home · Nasr City · Cairo");
  });
  it("counts down by the hour for a visit days away", () => { expect(formatCountdown(157_490_000)).toBe("43:44:50"); });
});
