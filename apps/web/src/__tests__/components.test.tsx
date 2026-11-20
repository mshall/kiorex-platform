import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/mocks/server";
import { markSlotTaken, mockBookings, mutateBooking } from "@/test/mocks/handlers";
import { renderApp } from "@/test/utils";
import { DoctorCard } from "@/components/DoctorCard";
import { EmergencyBanner } from "@/components/EmergencyBanner";
import { SlotTakenDialog } from "@/components/SlotTakenDialog";
import { StatusTimeline } from "@/components/StatusTimeline";
import { ErrorState } from "@/components/states";
import { ApiError } from "@/api/errors";
import ResultsPage from "@/pages/ResultsPage";
import DoctorProfilePage from "@/pages/DoctorProfilePage";
import CheckoutPage from "@/pages/CheckoutPage";
import AppointmentPage from "@/pages/AppointmentPage";
import ReviewPage from "@/pages/ReviewPage";
import AccountPage from "@/pages/AccountPage";
import { slotsFor, summaryFor, seeds } from "@/test/mocks/data";
import type { Booking } from "@/api/types";
const mockConsents = () => true;

describe("DoctorCard", () => {
  it("renders verified badge, fee, distance and 3 slots in Arabic", () => {
    renderApp(<DoctorCard doctor={summaryFor(seeds[0])} onPickSlot={() => {}} />);
    expect(screen.getByTestId("verified-badge")).toBeInTheDocument();
    expect(screen.getAllByTestId("slot-button")).toHaveLength(3);
    expect(screen.getByText("د. ليلى حسن")).toBeInTheDocument();
  });
  it("fires onPickSlot", async () => {
    let picked = "";
    renderApp(<DoctorCard doctor={summaryFor(seeds[0])} onPickSlot={(_d, s) => (picked = s.slotId)} />);
    await userEvent.click(screen.getAllByTestId("slot-button")[0]);
    expect(picked).toMatch(/^\d{4}-/);
  });
});

describe("EmergencyBanner", () => { it("offers 123 and no booking CTA", () => { renderApp(<EmergencyBanner />); expect(screen.getByRole("alert")).toHaveTextContent("123"); expect(screen.getByRole("link")).toHaveAttribute("href", "tel:123"); }); });

describe("SlotTakenDialog", () => {
  it("lists the alternatives", () => {
    renderApp(<SlotTakenDialog alternatives={slotsFor("d1", "d1-first").slice(0, 3)} onPick={() => {}} onClose={() => {}} />);
    expect(screen.getAllByTestId("slot-button")).toHaveLength(3);
  });
});

describe("StatusTimeline", () => {
  it("marks the latest state as current", () => {
    const b = { timeline: [{ status: "INTENT", at: "2026-12-01T10:00:00Z", note: null }, { status: "HELD", at: "2026-12-01T10:00:01Z", note: null }, { status: "CONFIRMED", at: "2026-12-01T10:01:00Z", note: null }] } as unknown as Booking;
    renderApp(<StatusTimeline booking={b} />);
    const items = screen.getAllByRole("listitem").filter((li) => !li.hasAttribute("data-upcoming")); // ghost "still to come" steps are extra
    expect(items).toHaveLength(2); expect(items[1]).toHaveAttribute("aria-current", "step");
  });
});

describe("ErrorState", () => {
  it("renders 'temporarily unavailable' for 403 FEATURE_DISABLED (KX-08 §08)", () => {
    renderApp(<ErrorState error={new ApiError(403, "FEATURE_DISABLED", "off", { key: "kiorex.marketplace" })} />);
    expect(screen.getByTestId("feature-unavailable")).toHaveAttribute("data-feature", "kiorex.marketplace");
    expect(screen.getByText("غير متاح مؤقتًا")).toBeInTheDocument();
  });
  it("English copy", () => { renderApp(<ErrorState error={new ApiError(403, "FEATURE_DISABLED", "off")} />, { lang: "en" }); expect(screen.getByText("Temporarily unavailable")).toBeInTheDocument(); });
});

describe("ResultsPage", () => {
  it("lists doctors from the (real-shaped) search API", async () => {
    renderApp(<ResultsPage />, { route: "/search" });
    await waitFor(() => expect(screen.getAllByTestId("doctor-card").length).toBeGreaterThan(0));
    expect(screen.getByTestId("result-count")).toHaveTextContent("6");
  });
  it("shows empty state when nothing matches", async () => {
    server.use(http.get("/api/v1/search/providers", () => HttpResponse.json({ items: [], total: 0, page: 1, pageSize: 20 })));
    renderApp(<ResultsPage />, { route: "/search" });
    expect(await screen.findByTestId("empty-state")).toBeInTheDocument();
  });
  it("shows an error state with retry on 500", async () => {
    server.use(http.get("/api/v1/search/providers", () => HttpResponse.json({ code: "BOOM", message: "x" }, { status: 500 })));
    renderApp(<ResultsPage />, { route: "/search" });
    expect(await screen.findByTestId("error-state", {}, { timeout: 5000 })).toBeInTheDocument();
  });
  it("shows the flag-OFF state when the API answers FEATURE_DISABLED", async () => {
    server.use(http.get("/api/v1/search/providers", () => HttpResponse.json({ code: "FEATURE_DISABLED", message: "off", key: "kiorex.marketplace", scope: "global" }, { status: 403 })));
    renderApp(<ResultsPage />, { route: "/search" });
    expect(await screen.findByTestId("feature-unavailable")).toBeInTheDocument();
  });
  it("replaces results with emergency guidance for urgent queries", async () => {
    renderApp(<ResultsPage />, { route: "/search?q=chest%20pain" });
    expect(await screen.findByTestId("emergency-banner")).toBeInTheDocument();
    expect(screen.queryByTestId("doctor-card")).not.toBeInTheDocument();
  });
});

describe("DoctorProfilePage", () => {
  it("shows policy before booking and a disabled continue button until a slot is chosen", async () => {
    renderApp(<Routes><Route path="/doctors/:id" element={<DoctorProfilePage />} /></Routes>, { route: "/doctors/d1" });
    expect(await screen.findByTestId("cancellation-policy")).toBeInTheDocument();
    expect(screen.getByTestId("continue-booking")).toBeDisabled();
    fireEvent.click((await screen.findAllByTestId("slot-button"))[0]);
    await waitFor(() => expect(screen.getByTestId("continue-booking")).toBeEnabled());
  });
});

describe("Checkout (hold → consent → confirm)", () => {
  async function hold(doctorId = "d1") {
    const slot = slotsFor(doctorId, `${doctorId}-first`)[0];
    const r = await fetch("/api/v1/bookings", { method: "POST", body: JSON.stringify({ providerId: doctorId, typeId: `${doctorId}-first`, startsAt: slot.startsAt, endsAt: slot.endsAt }) });
    return (await r.json()) as { id: string };
  }
  const page = (id: string) => renderApp(<Routes><Route path="/checkout/:bookingId" element={<CheckoutPage />} /><Route path="/appointments/:id" element={<div data-testid="appt-page" />} /></Routes>, { route: `/checkout/${id}` });

  it("shows the 5-minute countdown and gates confirm on the data consent", async () => {
    const b = await hold(); page(b.id);
    expect(await screen.findByTestId("hold-countdown")).toHaveTextContent(/0[45]:\d\d/);
    expect(screen.getByTestId("confirm-booking")).toBeDisabled();
    await userEvent.click(screen.getByTestId("consent-data"));
    expect(screen.getByTestId("confirm-booking")).toBeEnabled();
    await userEvent.click(screen.getByTestId("confirm-booking"));
    expect(await screen.findByTestId("appt-page")).toBeInTheDocument();
  });
  it("explains the deposit (paid after confirmation) when the visit type requires one", async () => {
    const b = await hold("d2"); page(b.id);
    expect(await screen.findByTestId("deposit-panel")).toHaveTextContent(/١٥٠|150/);
  });
  it("shows an expired-hold state", async () => {
    const b = await hold(); mutateBooking(b.id, { status: "EXPIRED", holdExpiresAt: null });
    page(b.id);
    expect(await screen.findByTestId("pick-another")).toBeInTheDocument();
  });
  it("a taken slot returns SLOT_TAKEN with 3 alternatives (flat error extras)", async () => {
    const slot = slotsFor("d1", "d1-first")[0]; markSlotTaken("d1", slot.slotId);
    const r = await fetch("/api/v1/bookings", { method: "POST", body: JSON.stringify({ providerId: "d1", typeId: "d1-first", startsAt: slot.startsAt }) });
    expect(r.status).toBe(409); const j = await r.json();
    expect(j.code).toBe("SLOT_TAKEN"); expect(j.alternatives).toHaveLength(3);
  });
  it("confirm on a lapsed hold surfaces HOLD_EXPIRED (422)", async () => {
    const b = await hold(); mutateBooking(b.id, { holdExpiresAt: new Date(Date.now() - 1000).toISOString() });
    const r = await fetch(`/api/v1/bookings/${b.id}/confirm`, { method: "POST", body: JSON.stringify({ marketplaceConsent: true }) });
    expect(r.status).toBe(422); expect((await r.json()).code).toBe("HOLD_EXPIRED");
  });
});

describe("Appointment (status, pending-clinic, deposit link, review)", () => {
  const appt = (id: string) => renderApp(<Routes><Route path="/appointments/:id" element={<AppointmentPage />} /><Route path="/appointments/:id/review" element={<ReviewPage />} /></Routes>, { route: `/appointments/${id}` });
  async function confirmed(doctorId: string) {
    const slot = slotsFor(doctorId, `${doctorId}-first`)[0];
    const h = await (await fetch("/api/v1/bookings", { method: "POST", body: JSON.stringify({ providerId: doctorId, typeId: `${doctorId}-first`, startsAt: slot.startsAt }) })).json();
    await fetch(`/api/v1/bookings/${h.id}/confirm`, { method: "POST", body: JSON.stringify({ marketplaceConsent: true }) });
    return h.id as string;
  }
  it("shows the pending-clinic state with a due time and a pay-deposit link", async () => {
    appt(await confirmed("d2"));
    expect(await screen.findByTestId("pending-clinic")).toBeInTheDocument();
    expect(screen.getByTestId("pay-deposit-link")).toBeInTheDocument();
  });
  it("cancels a confirmed appointment", async () => {
    appt(await confirmed("d1"));
    await userEvent.click(await screen.findByTestId("cancel"));
    await userEvent.click(await screen.findByTestId("confirm-cancel"));
    await waitFor(() => expect(screen.getByTestId("appt-status")).toHaveTextContent("ملغى"));
  });
  it("only a completed visit can be reviewed; submitting marks it reviewed", async () => {
    appt("kx_bk_done");
    await userEvent.click(await screen.findByTestId("leave-review"));
    await userEvent.click((await screen.findAllByRole("radio", { name: "5" }))[0]);
    await userEvent.click(screen.getByTestId("submit-review"));
    await waitFor(() => expect(mockBookings().find((b) => b.id === "kx_bk_done")?.reviewed).toBe(true));
  });
});

describe("Account", () => {
  it("toggles a consent and rejects adult dependants", async () => {
    renderApp(<AccountPage />);
    await userEvent.click(await screen.findByRole("tab", { name: "الموافقات" }));
    const sw = await screen.findAllByRole("switch");
    await userEvent.click(sw[2]); // record sharing
    await waitFor(() => expect(mockConsents()).toBeTruthy());
    const r = await fetch("/api/v1/me/dependants", { method: "POST", body: JSON.stringify({ nameEn: "Adult", dateOfBirth: "1990-01-01", relationship: "OTHER" }) });
    expect(r.status).toBe(400); expect((await r.json()).code).toBe("DEPENDANT_ADULT");
  });
});
