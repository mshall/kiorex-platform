import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/mocks/server";
import { renderApp } from "@/test/utils";
import TelemedicinePage from "@/pages/TelemedicinePage";
import { TelehealthVisit, telehealthPhase } from "@/components/TelehealthVisit";
import type { Telehealth } from "@/api/types";

const min = (m: number) => new Date(Date.now() + m * 60_000).toISOString();
const tv = (over: Partial<Telehealth> = {}): Telehealth => ({ sessionId: "ths_1", state: "SCHEDULED", joinUrl: "https://clinic.example.test/v/tok", opensAt: min(-5), closesAt: min(120), movedFrom: null, ...over });

describe("Clinic-owned video visit (P2P): phases", () => {
  it("derives the phase from state, link and the join window", () => {
    expect(telehealthPhase(tv({ opensAt: min(30) }))).toBe("beforeWindow");
    expect(telehealthPhase(tv())).toBe("open");
    expect(telehealthPhase(tv({ state: "LIVE" }))).toBe("live");
    expect(telehealthPhase(tv({ closesAt: min(-1) }))).toBe("windowPassed");
    expect(telehealthPhase(tv({ state: "ENDED", joinUrl: null }))).toBe("ended");
    expect(telehealthPhase(tv({ state: "MISSED", joinUrl: null }))).toBe("missed");
    expect(telehealthPhase(tv({ state: "CANCELLED", joinUrl: null }))).toBe("cancelled");
    expect(telehealthPhase(tv({ state: "IN_PERSON", joinUrl: null }))).toBe("inPerson");
    expect(telehealthPhase(tv({ joinUrl: null }))).toBe("noLink");
  });
});

describe("TelehealthVisit card", () => {
  it("open window: the Join video visit button opens the Clinic page in a new tab", () => {
    renderApp(<TelehealthVisit telehealth={tv()} />, { lang: "en" });
    const a = screen.getByTestId("tele-join-visit");
    expect(a).toHaveAttribute("href", "https://clinic.example.test/v/tok");
    expect(a).toHaveAttribute("target", "_blank");
    expect(a).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(a).toHaveTextContent("Join video visit");
  });
  it("before the window: countdown and a disabled button, no link", () => {
    renderApp(<TelehealthVisit telehealth={tv({ opensAt: min(30), closesAt: min(150) })} />, { lang: "en" });
    expect(screen.getByTestId("tele-countdown")).toBeInTheDocument();
    expect(screen.getByTestId("tele-join-visit-disabled")).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByTestId("tele-join-visit")).toBeNull();
  });
  it("moved visit shows the previous time; in-person conversion and cancellation withdraw the button", () => {
    const { unmount } = renderApp(<TelehealthVisit telehealth={tv({ movedFrom: min(-1000) })} />, { lang: "en" });
    expect(screen.getByTestId("tele-moved")).toBeInTheDocument();
    unmount();
    const r = renderApp(<TelehealthVisit telehealth={tv({ state: "IN_PERSON", joinUrl: null })} />, { lang: "en" });
    expect(screen.getByTestId("tele-phase-note")).toHaveTextContent(/in-person/i);
    expect(screen.queryByTestId("tele-join-visit")).toBeNull();
    r.unmount();
    renderApp(<TelehealthVisit telehealth={tv({ state: "CANCELLED", joinUrl: null })} />, { lang: "en" });
    expect(screen.getByTestId("telehealth-visit")).toHaveAttribute("data-phase", "cancelled");
    expect(screen.queryByTestId("tele-join-visit")).toBeNull();
  });
  it("renders in Arabic", () => {
    renderApp(<TelehealthVisit telehealth={tv()} />, { lang: "ar" });
    expect(screen.getByTestId("tele-join-visit")).toHaveTextContent("انضم إلى الزيارة بالفيديو");
  });
});

describe("Telemedicine page lists Clinic-owned visits", () => {
  it("shows the visits section with the join button", async () => {
    server.use(http.get("/api/v1/telemedicine/visits", () => HttpResponse.json([{ bookingId: "kx_bk_1", status: "CONFIRMED", startsAt: min(10), endsAt: min(40), doctor: { nameEn: "Dr Laila", nameAr: "د. ليلى", specialty: "dermatology" }, telehealth: tv() }])));
    renderApp(<TelemedicinePage />, { lang: "en" });
    expect(await screen.findByTestId("tele-visits")).toBeInTheDocument();
    expect(screen.getByTestId("tele-join-visit")).toHaveAttribute("href", "https://clinic.example.test/v/tok");
  });
});
