import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderApp } from "@/test/utils";
import { PreferenceCentre } from "@/components/consent/PreferenceCentre";

/** GRW-P2-E additions to the patient preference centre: the four message classes explained, three part of the service and only marketing optional. */
const view = {
  version: 1, draftWording: false, textVersions: { analytics: "v1", marketing: "v1" },
  serviceMessages: [{ purpose: "TRANSACTIONAL", required: true }, { purpose: "SECURITY", required: true }, { purpose: "CLINICAL", required: true }],
  reminders: { consent: false, updatedAt: null }, analytics: { consent: false, textVersion: null, updatedAt: null },
  marketing: { available: false, anyConsent: false, channels: [] }, quietHours: { start: null, end: null, defaultStart: 21, defaultEnd: 9, timezone: "Africa/Cairo" }, caps: { perDay: 1, perWeek: 3 }, withdrawalPropagationSeconds: 60,
};
vi.mock("@/auth/AuthProvider", async (orig) => ({ ...(await orig<typeof import("@/auth/AuthProvider")>()), useAuth: () => ({ status: "signedIn", login: vi.fn() }) }));
vi.mock("@/api/consent", async (orig) => ({
  ...(await orig<typeof import("@/api/consent")>()),
  usePreferences: () => ({ data: view, isLoading: false, error: null, refetch: vi.fn() }),
  useUpdatePreferences: () => ({ mutate: vi.fn(), isPending: false }),
  useUnsubscribeMarketing: () => ({ mutate: vi.fn(), isPending: false }),
}));

describe("PreferenceCentre message classes (GRW-P2-E)", () => {
  it.each([["en", "Part of the service", "Your choice", "Marketing"], ["ar", "جزء من الخدمة", "قرارك", "التسويق"]] as const)("%s: four classes, three required and one optional, marketing says quiet hours and the limit", async (lang, required, optional, marketing) => {
    renderApp(<PreferenceCentre />, { lang });
    const section = await screen.findByTestId("pc-classes");
    for (const c of ["TRANSACTIONAL", "SECURITY", "CLINICAL", "MARKETING"]) expect(within(section).getByTestId(`pc-class-${c}`)).toBeInTheDocument();
    expect(within(section).getAllByText(required)).toHaveLength(3);
    expect(within(section).getAllByText(optional)).toHaveLength(1);
    expect(within(within(section).getByTestId("pc-class-MARKETING")).getByText(marketing)).toBeInTheDocument();
    expect(section.textContent).not.toMatch(/consent\.centre/);
  });
});
