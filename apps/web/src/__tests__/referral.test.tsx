import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/mocks/server";
import { renderApp } from "@/test/utils";
import ReferralPage from "@/pages/referral/ReferralPage";
import MyRewards from "@/pages/referral/MyRewards";
import InviteLanding from "@/pages/referral/InviteLanding";
import AccountPage from "@/pages/AccountPage";
import { normaliseCode } from "@/api/referral";
import en from "@/i18n/referral.en.json";
import ar from "@/i18n/referral.ar.json";

const R = "/api/v1/growth/v1/referral";
const me = (o: Record<string, unknown> = {}) => ({ code: "7K3M9QPX", status: "ACTIVE", inviteUrl: "https://kiorex.com/ar/eg/invite/7K3M9QPX", counts: { invited: 5, signedUp: 3, qualified: 1 }, capsRemaining: { last30Days: 2, thisYear: 4 }, rewards: { activeCount: 1, activeMinor: 15_000, currency: "EGP" }, ...o });
const lot = (o: Record<string, unknown> = {}) => ({ id: "l1", kind: "REFERRER", mode: "COUPON", amountMinor: 15_000, currency: "EGP", status: "ACTIVE", expiresAt: "2027-09-01T00:00:00Z", ...o });
const flat = (o: unknown, p = ""): string[] => (o && typeof o === "object" ? Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => flat(v, p ? `${p}.${k}` : k)) : [p]);
const base = (k: string) => k.replace(/_(zero|one|two|few|many|other)$/, "");

beforeEach(() => { try { localStorage.clear(); } catch { /* */ } });

describe("referral strings", () => {
  it("English and Arabic have the same keys (plural forms aside)", () => { const a = new Set(flat(en).map(base)); const b = new Set(flat(ar).map(base)); expect([...a].filter((k) => !b.has(k))).toEqual([]); expect([...b].filter((k) => !a.has(k))).toEqual([]); });
  it("code validation accepts Crockford codes only and normalises case", () => { expect(normaliseCode("7k3m9qpx")).toBe("7K3M9QPX"); expect(normaliseCode("7K3M9QPI")).toBeNull(); expect(normaliseCode("https://evil.example")).toBeNull(); expect(normaliseCode("7K3M9QP")).toBeNull(); expect(normaliseCode(undefined)).toBeNull(); });
});

describe("ReferralPage (GRW-P2-B3)", () => {
  it("shows the code, link, QR, counts and caps in English; the copy button copies the link and records a COPY share event", async () => {
    let event: unknown = null; const write = vi.fn(async () => undefined); Object.defineProperty(navigator, "clipboard", { value: { writeText: write }, configurable: true });
    server.use(http.get(`${R}/me`, () => HttpResponse.json(me())), http.post(`${R}/invites`, async ({ request }) => { event = await request.json(); return HttpResponse.json({ inviteUrl: me().inviteUrl, code: "7K3M9QPX", shareText: "hi" }); }));
    renderApp(<ReferralPage />, { lang: "en" });
    expect(await screen.findByTestId("invite-code")).toHaveTextContent("7K3M9QPX"); expect(screen.getByTestId("invite-link")).toHaveValue("https://kiorex.com/ar/eg/invite/7K3M9QPX");
    expect(await screen.findByTestId("invite-qr")).toBeInTheDocument();
    const counts = within(screen.getByTestId("referral-counts")); expect(counts.getByText("Friends invited")).toBeInTheDocument(); expect(counts.getByText("Completed a first visit")).toBeInTheDocument();
    expect(screen.getByTestId("referral-caps")).toHaveTextContent(/4 more friends this year/);
    await userEvent.click(screen.getByTestId("invite-copy")); await waitFor(() => expect(write).toHaveBeenCalledWith("https://kiorex.com/ar/eg/invite/7K3M9QPX")); await waitFor(() => expect(event).toEqual({ channel: "COPY", locale: "en" }));
    expect(screen.getByTestId("referral-terms")).toHaveAttribute("data-needs-human", "true");
  });
  it("renders in Arabic with Arabic-Indic digits and an accessible link input", async () => {
    server.use(http.get(`${R}/me`, () => HttpResponse.json(me())));
    renderApp(<ReferralPage />, { lang: "ar" });
    const counts = await screen.findByTestId("referral-counts"); expect(counts).toHaveTextContent("٥"); expect(counts).toHaveTextContent("أصدقاء تمت دعوتهم");
    expect(screen.getByLabelText("رابط دعوتك")).toBeInTheDocument();
  });
  it("a suspended invite disables the share buttons and says so", async () => {
    server.use(http.get(`${R}/me`, () => HttpResponse.json(me({ status: "SUSPENDED" }))));
    renderApp(<ReferralPage />, { lang: "en" });
    expect(await screen.findByTestId("invite-suspended")).toBeInTheDocument(); expect(screen.getByTestId("invite-share")).toBeDisabled(); expect(screen.getByTestId("invite-copy")).toBeDisabled();
  });
  it("zero invites shows the friendly empty state", async () => {
    server.use(http.get(`${R}/me`, () => HttpResponse.json(me({ counts: { invited: 0, signedUp: 0, qualified: 0 }, capsRemaining: undefined }))));
    renderApp(<ReferralPage />, { lang: "en" });
    expect(await screen.findByText("No invites yet")).toBeInTheDocument();
  });
  it("flag OFF (403 FEATURE_DISABLED) shows the unavailable state, never a broken page", async () => {
    server.use(http.get(`${R}/me`, () => HttpResponse.json({ code: "FEATURE_DISABLED", key: "growth.patient_referral", scope: "GATE" }, { status: 403 })));
    renderApp(<ReferralPage />, { lang: "en" });
    expect(await screen.findByTestId("feature-unavailable")).toHaveAttribute("data-feature", "growth.patient_referral");
  });
  it("an API error shows the error state with a retry; a cached copy from the device is shown, labelled, instead when it exists", async () => {
    server.use(http.get(`${R}/me`, () => HttpResponse.json({ code: "INTERNAL", message: "x" }, { status: 500 })));
    const { unmount } = renderApp(<ReferralPage />, { lang: "en" }); expect(await screen.findByTestId("error-state")).toBeInTheDocument(); unmount();
    localStorage.setItem("kx.referral.me.v1", JSON.stringify(me()));
    renderApp(<ReferralPage />, { lang: "en" }); expect(await screen.findByTestId("referral-cached")).toBeInTheDocument(); expect(screen.getByTestId("invite-code")).toHaveTextContent("7K3M9QPX");
  });
  it("a good answer is cached on the device without any name or contact data", async () => {
    server.use(http.get(`${R}/me`, () => HttpResponse.json(me())));
    renderApp(<ReferralPage />, { lang: "en" }); await screen.findByTestId("invite-code");
    const raw = localStorage.getItem("kx.referral.me.v1")!; expect(JSON.parse(raw).code).toBe("7K3M9QPX"); expect(raw).not.toMatch(/phone|email|name|sub/i);
  });
});

describe("MyRewards (GRW-P2-B3)", () => {
  it("lists active vouchers and credit with expiry, and past lines under history; states the closed-loop rule", async () => {
    server.use(http.get(`${R}/rewards`, () => HttpResponse.json({ items: [lot(), lot({ id: "l2", kind: "REFEREE", mode: "CREDIT", amountMinor: 5000, status: "EXPIRED" }), lot({ id: "l3", status: "REVERSED" })], nextCursor: null })));
    renderApp(<MyRewards />, { lang: "en" });
    const active = await screen.findByTestId("rewards-active"); expect(within(active).getByTestId("reward-l1")).toHaveTextContent(/Voucher/); expect(within(active).getByTestId("reward-l1")).toHaveTextContent(/150/);
    expect(within(screen.getByTestId("rewards-history")).getAllByRole("listitem")).toHaveLength(2); expect(screen.getByTestId("rewards-rule")).toHaveTextContent(/cannot be withdrawn/i);
  });
  it("an unrevealed voucher shows its code once on request and never again from the page state", async () => {
    let reveals = 0;
    server.use(http.get(`${R}/rewards`, () => HttpResponse.json({ items: [lot({ couponState: "UNREVEALED" }), lot({ id: "l9", couponState: "REVEALED" })] })), http.post("/api/v1/growth/v1/rewards/:id/reveal", () => { reveals++; return HttpResponse.json({ code: "KX-AB12-CD34" }); }));
    renderApp(<MyRewards />, { lang: "en" });
    await userEvent.click(await screen.findByTestId("reveal-l1")); expect(await screen.findByTestId("coupon-l1")).toHaveTextContent("KX-AB12-CD34"); expect(reveals).toBe(1); expect(screen.getByTestId("revealed-l9")).toBeInTheDocument();
    expect(localStorage.length === 0 || !JSON.stringify({ ...localStorage }).includes("KX-AB12")).toBe(true);
  });
  it("shows the empty state and the Arabic copy", async () => {
    server.use(http.get(`${R}/rewards`, () => HttpResponse.json({ items: [] })));
    renderApp(<MyRewards />, { lang: "ar" }); expect(await screen.findByText("لا توجد مكافآت بعد")).toBeInTheDocument();
  });
  it("shows the flag-off state", async () => {
    server.use(http.get(`${R}/rewards`, () => HttpResponse.json({ code: "FEATURE_DISABLED", key: "growth.rewards", scope: "GLOBAL" }, { status: 403 })));
    renderApp(<MyRewards />, { lang: "en" }); expect(await screen.findByTestId("feature-unavailable")).toBeInTheDocument();
  });
});

describe("InviteLanding (GRW-P2-B3)", () => {
  const page = () => <Routes><Route path="/invite/:code" element={<InviteLanding />} /></Routes>;
  it("signed in: claims the code once and shows a neutral accepted message", async () => {
    let claims = 0; let body: unknown = null;
    server.use(http.post(`${R}/claim`, async ({ request }) => { claims++; body = await request.json(); return HttpResponse.json({ status: "SIGNED_UP" }); }));
    renderApp(page(), { route: "/invite/7k3m9qpx", lang: "en" });
    expect(await screen.findByTestId("invite-accepted")).toBeInTheDocument(); expect(body).toEqual({ code: "7K3M9QPX" }); expect(claims).toBe(1);
    expect(document.body.textContent).not.toMatch(/Amira|friend named/i);
  });
  it("every refusal reads the same, whatever the reason", async () => {
    for (const r of [{ status: "REJECTED", reason: "RF_SELF" }, { status: "EXPIRED" }]) {
      server.use(http.post(`${R}/claim`, () => HttpResponse.json(r))); const { unmount } = renderApp(page(), { route: "/invite/7K3M9QPX", lang: "en" });
      expect(await screen.findByTestId("invite-invalid")).toHaveTextContent("This invite cannot be used"); expect(document.body.textContent).not.toMatch(/RF_SELF|self/i); unmount();
    }
  });
  it("a malformed code (or a URL in the code position) is invalid and never claimed", async () => {
    let claims = 0; server.use(http.post(`${R}/claim`, () => { claims++; return HttpResponse.json({ status: "SIGNED_UP" }); }));
    renderApp(page(), { route: "/invite/https%3A%2F%2Fevil.example", lang: "en" }); expect(await screen.findByTestId("invite-invalid")).toBeInTheDocument(); expect(claims).toBe(0);
  });
});

describe("Account entry (GRW-P2-B3)", () => {
  it("shows the invite entry only when the bootstrap says features.referral is true", async () => {
    server.use(http.get("/api/v1/bootstrap", () => HttpResponse.json({ features: { referral: false } })));
    const a = renderApp(<AccountPage />, { lang: "en" }); await screen.findByTestId("link-addresses"); expect(screen.queryByTestId("link-referral")).toBeNull(); a.unmount();
    server.use(http.get("/api/v1/bootstrap", () => HttpResponse.json({ features: { referral: true } })));
    renderApp(<AccountPage />, { lang: "en" }); expect(await screen.findByTestId("link-referral")).toHaveAttribute("href", "/referral");
  });
});
