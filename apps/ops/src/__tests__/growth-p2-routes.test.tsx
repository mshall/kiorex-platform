import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderOps } from "@/test/utils";
import { GROWTH_SECTIONS } from "@/components/growth/sections";

/** GRW-P2-X1: every Phase 2 to 4 route is registered up front; each owning package replaces pages/growth/<name>/Page.tsx. Until then the page is the honest planned state. */
const PAGES = import.meta.glob("../pages/growth/*/Page.tsx");
const KEYS = ["campaigns", "approvals", "promotions", "referrals", "rewards", "whatsapp", "assistant", "lifecycle", "experiments", "attribution-models", "sponsored-promotions", "cohorts", "review-queue", "onboarding", "recommendations", "automation", "corporate", "loyalty", "cross-product"];

describe("Phase 2 to 4 growth routes", () => {
  it("every route has a page file and a section row with a phase and a package id", () => {
    expect(Object.keys(PAGES).map((p) => p.split("/")[3]).sort()).toEqual([...KEYS].sort());
    for (const k of KEYS) { const s = GROWTH_SECTIONS.find((x) => x.key === k); expect(s, k).toBeTruthy(); expect(s!.to).toBe(`/growth/${k}`); if (s!.status === "planned") { expect(s!.phase, k).toBeGreaterThanOrEqual(2); expect(s!.pkg, k).toMatch(/^GRW-P\d-[A-Z]\d?$/); } }
  });
  it.each(KEYS)("%s renders (planned or live) in English and Arabic without crashing", async (k) => {
    const mod = (await PAGES[`../pages/growth/${k}/Page.tsx`]!()) as { default: () => import("react").ReactElement };
    const Page = mod.default;
    for (const lang of ["en", "ar"] as const) {
      const { unmount } = renderOps(<Page />, { route: `/growth/${k}`, lang });
      expect(await screen.findByRole("heading", { level: 1 })).toBeInTheDocument();
      unmount();
    }
  });
});
