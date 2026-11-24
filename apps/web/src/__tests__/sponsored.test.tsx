import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/mocks/server";
import { renderApp } from "@/test/utils";
import CheckoutPage from "@/pages/CheckoutPage";
import { slotsFor } from "@/test/mocks/data";
import { depositAfterSponsored } from "@/api/sponsored";
import en from "@/i18n/sponsored.en.json";
import ar from "@/i18n/sponsored.ar.json";

const Q = "/api/v1/growth/v1/promotions/quote";
const quote = (o: Record<string, unknown> = {}) => ({ quote: { promotionId: "prm_1", amountMinor: 5000, currency: "EGP", endsAt: "2027-02-10T21:59:00.000Z", label: { ar: "خصم برعاية عيادة النيل حتى 2027-02-10", en: "Discount sponsored by Nile Clinic until 2027-02-10" }, sponsor: { ar: "عيادة النيل", en: "Nile Clinic" }, ...o } });
async function hold(doctorId = "d2") {
  const slot = slotsFor(doctorId, `${doctorId}-first`)[0];
  const r = await fetch("/api/v1/bookings", { method: "POST", body: JSON.stringify({ providerId: doctorId, typeId: `${doctorId}-first`, startsAt: slot.startsAt, endsAt: slot.endsAt }) });
  return (await r.json()) as { id: string };
}
const page = (id: string, lang: "ar" | "en") => renderApp(<Routes><Route path="/checkout/:bookingId" element={<CheckoutPage />} /></Routes>, { route: `/checkout/${id}`, lang });

describe("sponsored discount at checkout (GRW-P2-S)", () => {
  it("English and Arabic carry the same keys, and neither calls it a Kiorex discount", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(ar).sort());
    expect(JSON.stringify(en)).toMatch(/not a Kiorex discount/);
  });
  it("shows 'sponsored by <clinic> until <date>', the minus amount and the reduced deposit in English", async () => {
    server.use(http.get(Q, () => HttpResponse.json(quote())));
    const b = await hold(); page(b.id, "en");
    expect(await screen.findByTestId("sponsored-label")).toHaveTextContent("Discount sponsored by Nile Clinic until 2027-02-10");
    expect(screen.getByTestId("sponsored-amount")).toHaveTextContent(/−.*50/); expect(screen.getByTestId("sponsored-amount")).toHaveAttribute("dir", "ltr");
    expect(screen.getByTestId("sponsored-line")).toHaveAttribute("role", "group");
    expect(screen.getByTestId("sponsored-note")).toHaveTextContent(/not a Kiorex discount/i);
    expect(screen.getByTestId("due-now")).toHaveTextContent(/100/); // 150 deposit - 50
  });
  it("renders in Arabic (RTL document) with the Arabic label", async () => {
    server.use(http.get(Q, () => HttpResponse.json(quote())));
    const b = await hold(); page(b.id, "ar");
    expect(await screen.findByTestId("sponsored-label")).toHaveTextContent("خصم برعاية عيادة النيل حتى 2027-02-10");
    expect(document.documentElement.dir).toBe("rtl"); expect(screen.getByTestId("sponsored-note")).toHaveTextContent("ليس خصمًا من كيوركس");
  });
  it("shows nothing when there is no quote, when the flag is OFF (403) or on an outage; the deposit is the full amount", async () => {
    for (const res of [() => HttpResponse.json({ quote: null }), () => HttpResponse.json({ code: "FEATURE_DISABLED" }, { status: 403 }), () => HttpResponse.json({}, { status: 500 })]) {
      server.use(http.get(Q, res)); const b = await hold(); const { unmount } = page(b.id, "en");
      await screen.findByTestId("deposit-panel"); expect(screen.queryByTestId("sponsored-line")).toBeNull(); expect(screen.getByTestId("due-now")).toHaveTextContent(/150/); unmount();
    }
  });
  it("still lets the patient confirm (the discount never blocks a booking)", async () => {
    server.use(http.get(Q, () => HttpResponse.json(quote())));
    const b = await hold(); page(b.id, "en"); await screen.findByTestId("sponsored-line");
    await userEvent.click(screen.getByTestId("consent-data")); expect(screen.getByTestId("confirm-booking")).toBeEnabled();
  });
  it("deposit math: the card never goes below one minor unit", () => {
    expect(depositAfterSponsored(150, 5000)).toBe(100); expect(depositAfterSponsored(50, 9000)).toBe(0.01); expect(depositAfterSponsored(150, 0)).toBe(150);
  });
});
