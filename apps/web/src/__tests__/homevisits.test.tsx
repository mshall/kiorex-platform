import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/mocks/server";
import { renderApp } from "@/test/utils";
import AddressesPage from "@/pages/AddressesPage";
import CarePlansPage from "@/pages/CarePlansPage";
import VisitStatusPage from "@/pages/VisitStatusPage";
import { CareTypeTabs } from "@/components/CareTypeTabs";
import { FamilySharePanel, HomeFee, HomeProgress, SafetyCardPanel, VisitAddressView } from "@/components/HomeVisitBits";
import { HomeVisitPicker } from "@/components/HomeVisitPicker";
import type { HomeBooking } from "@/api/types";

const addr = (o = {}) => ({ id: "a1", label: "Home", governorate: "cairo", district: "nasr-city", street: "12 Tahrir St", building: "4", floor: "2", flat: "7", landmark: null, lat: null, lng: null, hasPin: false, pinSource: null, confirmed: true, confirmedAt: new Date().toISOString(), isDefault: true, createdAt: new Date().toISOString(), summary: "Home · nasr-city · cairo", ...o });
const home = (o: Partial<HomeBooking> = {}): HomeBooking => ({
  district: "nasr-city", subState: "ASSIGNED", trackingEnabled: true, eta: { minutes: null, shared: false }, assignee: null, assignmentPending: false, aborted: null,
  steps: [{ key: "CONFIRMED", at: "2026-11-20T10:00:00Z", reached: true }, { key: "ON_THE_WAY", at: null, reached: false }, { key: "ARRIVED", at: null, reached: false }, { key: "FINISHED", at: null, reached: false }],
  fee: { visitFeeMinor: 40000, homeSurchargeMinor: 10000, totalMinor: 50000, depositRequired: true, currency: "EGP" },
  address: { governorate: "cairo", district: "nasr-city", masked: false, address: { street: "12 Tahrir St", building: "4" } }, safety: { reportProblemSlaMinutes: 60, emergencyNumber: "123" }, ...o,
} as HomeBooking);

describe("care-type categories (KXMDS01)", () => {
  it("shows Doctors · Physiotherapy · Home nursing and locks a category awaiting its gate", async () => {
    const picked: (string | undefined)[] = [];
    renderApp(<CareTypeTabs onPick={(c) => picked.push(c)} />, { lang: "en" });
    expect(await screen.findByTestId("care-DOCTORS")).toBeInTheDocument();
    const physio = screen.getByTestId("care-PHYSIOTHERAPY");
    await waitFor(() => expect(physio).toHaveAttribute("data-locked", "true"));
    await userEvent.click(physio);
    await userEvent.click(screen.getByTestId("care-HOME_NURSING"));
    expect(picked).toEqual(["HOME_NURSING"]);
  });
  it("renders Arabic labels", async () => {
    renderApp(<CareTypeTabs onPick={() => {}} />, { lang: "ar" });
    expect(await screen.findByText("تمريض منزلي")).toBeInTheDocument();
  });
});

describe("address book (KXMHV01)", () => {
  it("lists addresses masked by default and reveals doorstep lines only on request", async () => {
    server.use(http.get("/api/v1/me/addresses", () => HttpResponse.json([addr()])));
    renderApp(<AddressesPage />, { lang: "en" });
    expect(await screen.findByTestId("address-summary")).toHaveTextContent("Home · nasr-city · cairo");
    expect(screen.getByTestId("address-lines")).toHaveTextContent("••••");
    expect(screen.queryByText(/Tahrir/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("reveal-address"));
    expect(screen.getByTestId("address-lines")).toHaveTextContent("12 Tahrir St");
  });
  it("adds, edits, confirms and deletes", async () => {
    let list = [addr({ confirmed: false })]; const calls: string[] = [];
    server.use(
      http.get("/api/v1/me/addresses", () => HttpResponse.json(list)),
      http.post("/api/v1/me/addresses", async ({ request }) => { const b = (await request.json()) as Record<string, string>; calls.push(`POST ${b.label}`); list = [...list, addr({ id: "a2", label: b.label, isDefault: false })]; return HttpResponse.json(list[1], { status: 201 }); }),
      http.put("/api/v1/me/addresses/:id", async ({ request }) => { calls.push(`PUT ${((await request.json()) as { label: string }).label}`); return HttpResponse.json(list[0]); }),
      http.post("/api/v1/me/addresses/:id/confirm", () => { calls.push("CONFIRM"); list = [addr()]; return HttpResponse.json(list[0]); }),
      http.delete("/api/v1/me/addresses/:id", ({ params }) => { calls.push(`DELETE ${String(params.id)}`); list = list.filter((a) => a.id !== params.id); return HttpResponse.json({ ok: true }); }),
    );
    renderApp(<AddressesPage />, { lang: "en" });
    await userEvent.click(await screen.findByTestId("confirm-address"));
    await waitFor(() => expect(calls).toContain("CONFIRM"));
    await userEvent.click(screen.getByTestId("add-address"));
    for (const [k, v] of [["label", "Mum"], ["governorate", "cairo"], ["district", "maadi"], ["street", "9 Road"]]) await userEvent.type(await screen.findByTestId(`addr-${k}`), v);
    await userEvent.click(screen.getByTestId("save-address"));
    await waitFor(() => expect(calls).toContain("POST Mum"));
    await userEvent.click((await screen.findAllByTestId("edit-address"))[0]);
    await userEvent.type(await screen.findByTestId("addr-label"), "!");
    await userEvent.click(screen.getByTestId("save-address"));
    await waitFor(() => expect(calls.some((c) => c.startsWith("PUT"))).toBe(true));
    await userEvent.click((await screen.findAllByTestId("delete-address"))[1]);
    await userEvent.click(await screen.findByTestId("confirm-delete-address"));
    await waitFor(() => expect(calls).toContain("DELETE a2"));
  });
  it("empty state", async () => {
    server.use(http.get("/api/v1/me/addresses", () => HttpResponse.json([])));
    renderApp(<AddressesPage />, { lang: "ar" });
    expect(await screen.findByTestId("empty-state")).toBeInTheDocument();
  });
  it("error state", async () => {
    server.use(http.get("/api/v1/me/addresses", () => HttpResponse.json({ code: "X", message: "x" }, { status: 500 })));
    renderApp(<AddressesPage />);
    expect(await screen.findByTestId("error-state")).toBeInTheDocument();
  });
});

describe("home address picker and coverage (KXMHV02)", () => {
  it("shows the OUT_OF_COVERAGE message when the district is not covered, and the confirm prompt for unconfirmed addresses", async () => {
    server.use(http.get("/api/v1/me/addresses", () => HttpResponse.json([addr({ confirmed: false })])));
    let chosen = "";
    renderApp(<HomeVisitPicker coverageDistricts={["maadi"]} value="a1" onChange={(a) => { chosen = a?.id ?? ""; }} />, { lang: "en" });
    expect(await screen.findByTestId("out-of-coverage")).toHaveTextContent("does not visit your district");
    expect(screen.getByTestId("address-unconfirmed")).toBeInTheDocument();
    expect(chosen).toBe("");
  });
  it("covered district shows no warning", async () => {
    server.use(http.get("/api/v1/me/addresses", () => HttpResponse.json([addr()])));
    renderApp(<HomeVisitPicker coverageDistricts={["nasr-city"]} value="a1" onChange={() => {}} />);
    await screen.findByTestId("home-picker");
    expect(screen.queryByTestId("out-of-coverage")).not.toBeInTheDocument();
  });
});

describe("home booking timeline and checkout bits", () => {
  it("fee breakdown shows the surcharge as its own line", () => {
    renderApp(<HomeFee home={home()} />, { lang: "en" });
    expect(screen.getByTestId("fee-surcharge")).toBeInTheDocument();
    expect(screen.getByTestId("fee-total")).toHaveTextContent("500");
  });
  it("assigned: nurse card; en route: ETA only when shared; aborted-unsafe: review notice and no steps", () => {
    const { unmount } = renderApp(<HomeProgress home={home({ assignee: { displayName: "Nurse Mona", photoUrl: null, badge: "Registered nurse", profession: "NURSE" } })} />, { lang: "en" });
    expect(screen.getByTestId("assignee")).toHaveTextContent("Nurse Mona"); unmount();
    const r2 = renderApp(<HomeProgress home={home({ subState: "EN_ROUTE", eta: { minutes: 12, shared: true } })} />, { lang: "en" });
    expect(screen.getByTestId("eta")).toHaveTextContent("12"); r2.unmount();
    const r3 = renderApp(<HomeProgress home={home({ subState: "EN_ROUTE", eta: { minutes: 12, shared: false } })} />, { lang: "en" });
    expect(screen.queryByTestId("eta")).not.toBeInTheDocument(); r3.unmount();
    renderApp(<HomeProgress home={home({ subState: "ABORTED_UNSAFE", aborted: { abortedAt: "2026-11-20T11:00:00Z", noShow: false, depositUnderReview: true } })} />, { lang: "en" });
    expect(screen.getByTestId("aborted-unsafe")).toBeInTheDocument();
    expect(screen.getByTestId("deposit-review")).toBeInTheDocument();
    expect(screen.queryByTestId("home-steps")).not.toBeInTheDocument();
  });
  it("agency booking waiting for assignment", () => {
    renderApp(<HomeProgress home={home({ assignmentPending: true })} />, { lang: "ar" });
    expect(screen.getByTestId("assignment-pending")).toBeInTheDocument();
  });
  it("masked address 24 h after the visit shows only the district", () => {
    renderApp(<VisitAddressView home={home({ address: { governorate: "cairo", district: "nasr-city", masked: true, address: null } })} />, { lang: "en" });
    expect(screen.getByTestId("address-masked")).toBeInTheDocument();
    expect(screen.queryByTestId("address-lines")).not.toBeInTheDocument();
  });
});

describe("safety card + report a problem (KXMHV09)", () => {
  it("shows provider photo/name/badge, the emergency number and reports with the 1 h SLA", async () => {
    let body: unknown;
    server.use(
      http.get("/api/v1/bookings/:id/safety-card", () => HttpResponse.json({ bookingId: "b1", assignmentPending: false, emergencyNumber: "123", provider: { displayName: "Nurse Mona", photoUrl: null, badge: "Registered nurse" }, reportProblem: { slaMinutes: 60 }, familyShare: { max: 3, active: 0 } })),
      http.post("/api/v1/bookings/:id/report-problem", async ({ request }) => { body = await request.json(); return HttpResponse.json({ id: "c1", category: "HOME_SAFETY", slaDueAt: new Date().toISOString(), homeVisit: true, status: "OPEN" }, { status: 201 }); }),
    );
    renderApp(<SafetyCardPanel bookingId="b1" />, { lang: "en" });
    expect(await screen.findByTestId("safety-name")).toHaveTextContent("Nurse Mona");
    expect(screen.getByTestId("emergency-call")).toHaveAttribute("href", "tel:123");
    await userEvent.click(screen.getByTestId("report-problem"));
    await userEvent.click(await screen.findByTestId("submit-problem"));
    await waitFor(() => expect(body).toEqual({ category: "SAFETY" }));
  });
});

describe("family share (KXMHV07)", () => {
  it("needs both consents, creates a link once, lists contacts masked, and can stop", async () => {
    let shares: unknown[] = []; let posted: Record<string, unknown> = {};
    server.use(
      http.get("/api/v1/bookings/:id/family-shares", () => HttpResponse.json(shares)),
      http.post("/api/v1/bookings/:id/family-shares", async ({ request }) => { posted = (await request.json()) as Record<string, unknown>; shares = [{ id: "s1", bookingId: "b1", contactName: "Sara", phoneMasked: "+20•••••6789", status: "ACTIVE", locale: "en", createdAt: new Date().toISOString() }]; return HttpResponse.json({ ...(shares[0] as object), link: "https://kiorex.test/visit-status/TOKEN" }, { status: 201 }); }),
      http.delete("/api/v1/bookings/:id/family-shares/:sid", () => { shares = []; return HttpResponse.json({ ok: true }); }),
    );
    renderApp(<FamilySharePanel bookingId="b1" />, { lang: "en" });
    await userEvent.type(await screen.findByTestId("share-name"), "Sara");
    const phone = screen.getByTestId("share-phone"); await userEvent.clear(phone); await userEvent.type(phone, "+201001234567");
    expect(screen.getByTestId("share-submit")).toBeDisabled();
    await userEvent.click(screen.getByTestId("share-attest"));
    expect(screen.getByTestId("share-submit")).toBeDisabled();
    await userEvent.click(screen.getByTestId("share-consent"));
    await userEvent.click(screen.getByTestId("share-submit"));
    expect(await screen.findByTestId("share-link")).toHaveTextContent("TOKEN");
    expect(posted).toMatchObject({ contactName: "Sara", consentAttested: true, visitStatusSharingConsent: true });
    expect(await screen.findByTestId("share-row")).toHaveTextContent("+20•••••6789");
    await userEvent.click(within(screen.getByTestId("share-row")).getByRole("button"));
    await waitFor(() => expect(screen.queryByTestId("share-row")).not.toBeInTheDocument());
  });
  it("public family link shows status only and can stop; a dead link is a friendly empty state", async () => {
    let stopped = false;
    server.use(
      http.get("/api/v1/public/visit-status/:t", () => HttpResponse.json({ patientFirstName: "Hoda", startsAt: "2026-11-21T10:00:00Z", status: "CONFIRMED", subState: "EN_ROUTE", steps: [{ key: "CONFIRMED", reached: true, at: null }, { key: "ON_THE_WAY", reached: true, at: null }], eta: { minutes: 9, shared: true }, provider: { displayName: "Nurse Mona", badge: "RN" }, stopped: false })),
      http.post("/api/v1/public/visit-status/:t/stop", () => { stopped = true; return HttpResponse.json({ ok: true }); }),
    );
    const { unmount } = renderApp(<Routes><Route path="/visit-status/:token" element={<VisitStatusPage />} /></Routes>, { route: "/visit-status/TOKEN", lang: "en" });
    expect(await screen.findByTestId("family-eta")).toHaveTextContent("9");
    expect(document.body.textContent).not.toMatch(/street|EGP|\+20/i);
    await userEvent.click(screen.getByTestId("family-stop"));
    await waitFor(() => expect(stopped).toBe(true));
    unmount();
    server.use(http.get("/api/v1/public/visit-status/:t", () => HttpResponse.json({ code: "LINK_NOT_FOUND", message: "gone" }, { status: 404 })));
    renderApp(<Routes><Route path="/visit-status/:token" element={<VisitStatusPage />} /></Routes>, { route: "/visit-status/X" });
    expect(await screen.findByTestId("empty-state")).toBeInTheDocument();
  });
});

describe("care plans (KXMHV08, P3 draft)", () => {
  it("shows the awaiting-gate state when the API answers 403 FEATURE_DISABLED on request", async () => {
    server.use(
      http.get("/api/v1/care-plans", () => HttpResponse.json([])),
      http.get("/api/v1/me/addresses", () => HttpResponse.json([addr()])),
      http.get("/api/v1/search/providers", () => HttpResponse.json({ items: [{ id: "n1", nameEn: "Nile Nursing", nameAr: "النيل للتمريض", specialty: "nursing" }], total: 1, page: 1, pageSize: 20 })),
      http.post("/api/v1/care-plans", () => HttpResponse.json({ code: "FEATURE_DISABLED", message: "off", key: "nurse.care_plans", scope: "GATE" }, { status: 403 })),
    );
    renderApp(<CarePlansPage />, { lang: "en" });
    await screen.findByRole("option", { name: /Nile Nursing/ });
    await userEvent.selectOptions(screen.getByTestId("plan-provider"), "n1");
    await screen.findByRole("option", { name: /Home · nasr-city/ });
    await userEvent.selectOptions(screen.getByTestId("plan-address"), "a1");
    await userEvent.click(screen.getByTestId("plan-submit"));
    const un = await screen.findByTestId("feature-unavailable");
    expect(un).toHaveAttribute("data-awaiting", "true");
  });
  it("lists existing plans", async () => {
    server.use(http.get("/api/v1/care-plans", () => HttpResponse.json([{ id: "p1", status: "CONFIRMED", district: "nasr-city", providerId: "n1", completedVisits: 1, visits: [{ startsAt: "2026-11-22T10:00:00Z", endsAt: "2026-11-22T11:00:00Z", homeState: null, bookingId: null, status: "CONFIRMED" }], createdAt: "2026-11-20T00:00:00Z", confirmedAt: null, endedAt: null, endedReason: null }])));
    renderApp(<CarePlansPage />, { lang: "en" });
    expect(await screen.findByTestId("plan-row")).toHaveTextContent("1 of 1");
  });
});
